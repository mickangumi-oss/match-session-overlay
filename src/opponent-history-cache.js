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
  return hasRoundResults(selected.roundResults?.self) || hasRoundResults(selected.roundResults?.opponent)
    ? "present"
    : "missing-round-results";
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
  const invalidate = () => invalidateScopedOfficialHistoryCache(cache, {
    ownerProfileId,
    opponentProfileId,
    requestedLocale,
    selectedActId,
    cacheKeyForProfile: cacheKey,
  });
  const cacheReplayStates = [ownerProfileId, opponentProfileId].map((profileId) =>
    completedHistoryReplayState(cache, {
      profileId,
      requestedLocale,
      selectedActId,
      requiredReplayId,
      cacheKeyForProfile: cacheKey,
    }),
  );
  let cacheRefreshUsed = forceRefresh === true || cacheReplayStates.some((state) =>
    ["missing", "missing-round-results"].includes(state),
  );
  if (cacheRefreshUsed) invalidate();
  if (!cacheRefreshUsed && cacheReplayStates.every((state) => state === "present")) {
    assertGeneration(generation);
    const cachedHistory = (profileId) => cache.get(cacheKey(profileId))?.history;
    return {
      officialHistory: cachedHistory(opponentProfileId),
      ownerHistory: cachedHistory(ownerProfileId),
    };
  }

  const acquire = async () => {
    assertGeneration(generation);
    const opponentHistory = await acquireOfficialHistory({
      profileId: opponentProfileId,
      requestedLocale,
      selectedRecord,
      actId: selectedActId,
      actIndependent,
      beforeTimestamp,
      requestScopeProof,
      generation,
      productionReceipt,
      productionRole: "history.opponent",
    });
    assertGeneration(generation);
    const ownerHistory = await acquireOfficialHistory({
      profileId: ownerProfileId,
      requestedLocale,
      selectedRecord,
      actId: selectedActId,
      actIndependent,
      beforeTimestamp,
      requestScopeProof,
      generation,
      productionReceipt,
      productionRole: "history.owner",
    });
    assertGeneration(generation);
    if (opponentHistory?.complete !== true || ownerHistory?.complete !== true) {
      throw new Error("HISTORY_SCOPE_INCOMPLETE");
    }
    const replayId = String(requiredReplayId ?? "").trim();
    const hasReplay = (history) => Array.isArray(history?.records) && history.records.some(
      (record) => String(record?.replayId ?? "").trim() === replayId,
    );
    if (actIndependent !== true && (!replayId || !hasReplay(opponentHistory) || !hasReplay(ownerHistory))) {
      throw new Error("HISTORY_SELECTED_REPLAY_SCOPE_MISSING");
    }
    return { officialHistory: opponentHistory, ownerHistory };
  };

  try {
    return await acquire();
  } catch (error) {
    if (error?.message !== "HISTORY_SELECTED_REPLAY_SCOPE_MISSING" || cacheRefreshUsed) throw error;
    cacheRefreshUsed = true;
    invalidate();
    return acquire();
  }
}

module.exports = {
  invalidateScopedOfficialHistoryCache,
  completedHistoryReplayState,
  acquireScopedOfficialHistories,
};
