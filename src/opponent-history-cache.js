"use strict";

function invalidateScopedOfficialHistoryCache(
  cache,
  {
    ownerProfileId = null,
    opponentProfileId = null,
    requestedLocale = null,
    selectedActId = null,
    cacheKeyForProfile,
  } = {},
) {
  if (!cache || typeof cache.delete !== "function" || typeof cacheKeyForProfile !== "function") return [];
  const profileIds = [...new Set([ownerProfileId, opponentProfileId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
  const deletedKeys = [];
  for (const profileId of profileIds) {
    const key = cacheKeyForProfile(profileId, requestedLocale, selectedActId);
    if (!key) continue;
    cache.delete(key);
    deletedKeys.push(key);
  }
  return deletedKeys;
}

function completedHistoryReplayState(
  cache,
  {
    profileId = null,
    requestedLocale = null,
    selectedActId = null,
    requiredReplayId = null,
    beforeTimestamp: _beforeTimestamp = null,
    requiredHistoryMatches = 20,
    cacheKeyForProfile,
  } = {},
) {
  if (!cache || typeof cache.get !== "function" || typeof cacheKeyForProfile !== "function") return "absent";
  const profile = String(profileId ?? "").trim();
  const replayId = String(requiredReplayId ?? "").trim();
  if (!profile || !replayId) return "absent";
  const key = cacheKeyForProfile(profile, requestedLocale, selectedActId);
  const history = cache.get(key)?.history;
  if (!history || history.complete !== true) return "absent";
  const selected = Array.isArray(history.records)
    ? history.records.find((record) => String(record?.replayId ?? "").trim() === replayId)
    : null;
  if (!selected) return "missing";
  const hasRoundResults = (side) => Array.isArray(side?.values) || Array.isArray(side?.battles);
  const targetCount = Number.isFinite(Number(requiredHistoryMatches))
    ? Math.max(1, Math.floor(Number(requiredHistoryMatches)))
    : 20;
  if (targetCount > 20 && history.records.length < targetCount) {
    return "missing";
  }
  return hasRoundResults(selected.roundResults?.self) || hasRoundResults(selected.roundResults?.opponent)
    ? "present"
    : "missing-round-results";
}

function explicitActHistoryCacheIsValid(
  history,
  {
    profileId = null,
    requestedLocale = null,
    selectedActId = null,
    requiredReplayId = null,
    beforeTimestamp = null,
    generation = null,
  } = {},
) {
  if (!history || history.complete !== true) return false;
  const requestedAct = Number(selectedActId);
  if (!Number.isInteger(requestedAct) || requestedAct < 0) return false;
  const proof = history.scopeProof;
  if (proof?.method !== "verified-request" || proof.requestedAct !== requestedAct ||
    proof.selectedReplayPresent !== true || proof.complete !== true || proof.mixedAct !== false) return false;
  const identity = history.scopeIdentity;
  if (!identity || String(identity.profileId ?? "") !== String(profileId ?? "") ||
    String(identity.requestedLocale ?? "") !== String(requestedLocale ?? "") ||
    Number(identity.requestedAct) !== requestedAct ||
    String(identity.requiredReplayId ?? "") !== String(requiredReplayId ?? "") ||
    Number(identity.beforeTimestamp ?? 0) !== Number(beforeTimestamp ?? 0) ||
    Number(identity.generation) !== Number(generation)) return false;
  const replayId = String(requiredReplayId ?? "").trim();
  const selected = Array.isArray(history.records)
    ? history.records.find((record) => String(record?.replayId ?? "").trim() === replayId)
    : null;
  return Boolean(selected && Number(selected.actId) === requestedAct);
}

async function acquireScopedOfficialHistories({
  cache,
  ownerProfileId,
  opponentProfileId,
  requestedLocale,
  selectedActId,
  requiredReplayId,
  selectedRecord = null,
  beforeTimestamp = null,
  requiredHistoryMatches = 20,
  forceRefresh = false,
  actIndependent = false,
  cacheKeyForProfile,
  acquireOfficialHistory,
  requestScopeProof = null,
  generation,
  assertGeneration = () => {},
  productionReceipt = null,
} = {}) {
  if (typeof acquireOfficialHistory !== "function") {
    throw new Error("HISTORY_ACQUIRE_HANDLER_MISSING");
  }
  if (typeof cacheKeyForProfile !== "function") {
    throw new Error("HISTORY_CACHE_KEY_HANDLER_MISSING");
  }
  const cacheKey = (profileId) => cacheKeyForProfile(profileId, requestedLocale, selectedActId);
  const replayId = String(requiredReplayId ?? "").trim();
  const hasReplay = (history) => Boolean(replayId) && Array.isArray(history?.records) && history.records.some(
    (record) => String(record?.replayId ?? "").trim() === replayId,
  );
  const opponentOutsideOfficialWindow = (history) => {
    const selectedAt = Number(selectedRecord?.playedAt ?? selectedRecord?.uploadedAt);
    const timestamps = (history?.records ?? [])
      .map((record) => Number(record?.playedAt ?? record?.uploadedAt))
      .filter((value) => Number.isFinite(value) && value > 0);
    return timestamps.length >= 100 && timestamps.length === (history?.records ?? []).length &&
      Number.isFinite(selectedAt) && selectedAt > 0 &&
      selectedAt < Math.min(...timestamps);
  };
  const profiles = [
    { profileId: opponentProfileId, role: "history.opponent" },
    { profileId: ownerProfileId, role: "history.owner" },
  ];
  const priorScopedEntries = new Map(profiles.map(({ profileId }) => {
    const key = cacheKey(profileId);
    return [key, cache?.get?.(key)];
  }));
  const explicitActRequest = actIndependent !== true &&
    ["explicit-season-request", "verified-request-context"].includes(requestScopeProof);
  const cacheReplayStates = profiles.map(({ profileId }) =>
    explicitActRequest
      ? explicitActHistoryCacheIsValid(cache?.get?.(cacheKey(profileId))?.history, {
          profileId, requestedLocale, selectedActId, requiredReplayId, beforeTimestamp, generation,
        }) && completedHistoryReplayState(cache, {
          profileId, requestedLocale, selectedActId, requiredReplayId, beforeTimestamp,
          requiredHistoryMatches, cacheKeyForProfile: cacheKey,
        }) === "present" ? "present" : "absent"
      : completedHistoryReplayState(cache, {
      profileId,
      requestedLocale,
      selectedActId,
      requiredReplayId,
      beforeTimestamp,
      requiredHistoryMatches,
      cacheKeyForProfile: cacheKey,
      }),
  );
  if (forceRefresh !== true && cacheReplayStates.every((state) => state === "present")) {
    assertGeneration(generation);
    const cachedHistory = (profileId) => cache.get(cacheKey(profileId))?.history;
    const officialHistory = cachedHistory(opponentProfileId);
    const ownerHistory = cachedHistory(ownerProfileId);
    return {
      officialHistory,
      ownerHistory,
      officialHistoryStatus: "ready",
      ownerHistoryStatus: "ready",
      officialHistoryError: null,
      ownerHistoryError: null,
      status: "ready",
    };
  }

  const acquireRole = async ({ profileId, role }, cacheReplayState) => {
    assertGeneration(generation);
    const scopedKey = cacheKey(profileId);
    const priorEntry = cache?.get?.(scopedKey);
    const canUseCached = forceRefresh !== true && cacheReplayState === "present" && priorEntry?.history;
    if (canUseCached) {
      return { history: priorEntry.history, status: "ready", error: null };
    }

    // Detach only this profile's stale entry while refreshing it. Keep the
    // prior value available so a failed refresh cannot erase complete data.
    cache?.delete?.(scopedKey);
    let history = null;
    let error = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        history = await acquireOfficialHistory({
          profileId,
          requestedLocale,
          selectedRecord,
          actId: selectedActId,
          actIndependent,
          beforeTimestamp,
          requiredHistoryMatches,
          requestScopeProof,
          generation,
          productionReceipt,
          productionRole: role,
        });
        assertGeneration(generation);
        const scopedReplayPresent = explicitActRequest
          ? explicitActHistoryCacheIsValid(history, {
              profileId, requestedLocale, selectedActId, requiredReplayId, beforeTimestamp, generation,
            })
          : hasReplay(history);
        error = history?.complete === true
          ? scopedReplayPresent ? null : new Error(explicitActRequest && hasReplay(history)
            ? "ACT_SCOPE_MISSING"
            : role === "history.opponent"
              ? opponentOutsideOfficialWindow(history)
                ? "OPPONENT_OFFICIAL_SELECTED_REPLAY_OUT_OF_RANGE"
                : "OPPONENT_OFFICIAL_SELECTED_REPLAY_MISSING"
              : "OWNER_OFFICIAL_SELECTED_REPLAY_MISSING")
          : new Error("HISTORY_SCOPE_INCOMPLETE");
      } catch (caught) {
        assertGeneration(generation);
        history = cache?.get?.(scopedKey)?.history ?? history;
        error = caught instanceof Error ? caught : new Error(
          typeof caught?.message === "string" ? caught.message : String(caught ?? "HISTORY_SCOPE_INCOMPLETE"),
        );
      }
      if (!["OPPONENT_OFFICIAL_SELECTED_REPLAY_MISSING", "OPPONENT_OFFICIAL_SELECTED_REPLAY_OUT_OF_RANGE", "OWNER_OFFICIAL_SELECTED_REPLAY_MISSING"].includes(error?.message) || attempt === 1) break;
      cache?.delete?.(scopedKey);
      history = null;
    }

    if (error) {
      const currentEntry = cache?.get?.(scopedKey);
      if (priorEntry?.history?.complete === true) {
        cache?.set?.(scopedKey, priorEntry);
        history = priorEntry.history;
      } else if (!history && currentEntry?.history) {
        history = currentEntry.history;
      }
      if (!history && priorEntry?.history) history = priorEntry.history;
      return { history, status: "partial", error };
    }
    return { history, status: "ready", error: null };
  };

  let roleResults;
  try {
    roleResults = await Promise.all(profiles.map((profile, index) =>
      acquireRole(profile, cacheReplayStates[index]),
    ));
    assertGeneration(generation);
  } catch (error) {
    // A generation/profile/locale transition invalidates this whole result.
    // Restore only the exact scoped entries captured above; discard entries
    // written by the now-stale requests and leave every other key untouched.
    for (const [key, entry] of priorScopedEntries) {
      if (entry === undefined) cache?.delete?.(key);
      else cache?.set?.(key, entry);
    }
    throw error;
  }
  const [opponentResult, ownerResult] = roleResults;
  return {
    officialHistory: opponentResult.history ?? null,
    ownerHistory: ownerResult.history ?? null,
    officialHistoryStatus: opponentResult.status,
    ownerHistoryStatus: ownerResult.status,
    officialHistoryError: opponentResult.error,
    ownerHistoryError: ownerResult.error,
    status: opponentResult.status === "ready" && ownerResult.status === "ready" ? "ready" : "partial",
  };
}

module.exports = {
  invalidateScopedOfficialHistoryCache,
  completedHistoryReplayState,
  acquireScopedOfficialHistories,
};
