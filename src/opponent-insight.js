(function exposeOpponentInsight(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.matchOpponentInsight = api;
})(typeof globalThis === "object" ? globalThis : this, function createOpponentInsight() {
"use strict";

const RATING_TYPES = Object.freeze(["MR", "LP"]);
const INSIGHT_MATCH_LIMIT = 20;
const OPPONENT_INSIGHT_ALGORITHM_VERSION = "historical-before-match-v1";

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validRating(value, ratingType) {
  const number = finitePositive(value);
  // Keep malformed/out-of-range official payloads out of a derived estimate.
  // MR is a bounded master-rating scale; LP is a cumulative point scale and
  // can legitimately exceed 100,000 in official battle-log responses.
  const upperBound = ratingType === "MR" ? 10000 : ratingType === "LP" ? 1000000 : 0;
  return number != null && number <= upperBound && ["MR", "LP"].includes(ratingType)
    ? number
    : null;
}

function timestampOf(record) {
  const value = Number(record?.playedAt ?? record?.uploadedAt);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function recordRating(record, ratingType) {
  const type = String(ratingType ?? "").toUpperCase();
  if (type === "MR") return validRating(record?.ownMr ?? (record?.ownRatingType === "MR" ? record?.ownRating : null), type);
  if (type === "LP") return validRating(record?.ownLp ?? (record?.ownRatingType === "LP" ? record?.ownRating : null), type);
  return null;
}

function selectedOpponentRating(record, ratingType) {
  const type = String(ratingType ?? "").toUpperCase();
  if (type === "MR") return validRating(record?.opponentMr ?? (record?.opponentRatingType === "MR" ? record?.opponentRating : null), type);
  if (type === "LP") return validRating(record?.opponentLp ?? (record?.opponentRatingType === "LP" ? record?.opponentRating : null), type);
  return null;
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const ratingType = ["MR", "LP"].includes(String(value.ratingType ?? "").toUpperCase())
    ? String(value.ratingType).toUpperCase()
    : null;
  const finite = (candidate) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? number : null;
  };
  const positiveOrNull = (candidate) => validRating(candidate, ratingType);
  const profileId = (candidate) => {
    const text = String(candidate ?? "").replace(/\s/g, "");
    return /^\d{4,12}$/.test(text) ? text : null;
  };
  const character = finite(value.characterId);
  const status = ["ready", "insufficient", "empty", "error"].includes(value.status)
    ? value.status
    : "insufficient";
  const sampleCount = finite(value.sampleCount);
  const snapshot = {
    status,
    algorithmVersion: String(value.algorithmVersion ?? "").slice(0, 64) || OPPONENT_INSIGHT_ALGORITHM_VERSION,
    cutoffReplayId: String(value.cutoffReplayId ?? "").trim().slice(0, 120) || null,
    cutoffPlayedAt: finite(value.cutoffPlayedAt),
    historyOwnerProfileId: profileId(value.historyOwnerProfileId),
    opponentUserCode: profileId(value.opponentUserCode),
    characterId: character != null && character > 0 && character <= 100000 ? Math.floor(character) : null,
    ratingType,
    matchTimeRating: ratingType ? positiveOrNull(value.matchTimeRating) : null,
    sampleCount: sampleCount != null && sampleCount >= 0 ? Math.floor(sampleCount) : 0,
    wins: finite(value.wins) != null && finite(value.wins) >= 0 ? Math.floor(finite(value.wins)) : 0,
    losses: finite(value.losses) != null && finite(value.losses) >= 0 ? Math.floor(finite(value.losses)) : 0,
    draws: finite(value.draws) != null && finite(value.draws) >= 0 ? Math.floor(finite(value.draws)) : 0,
    potential: ratingType ? positiveOrNull(value.potential) : null,
    capturedAt: finite(value.capturedAt),
    complete: value.complete === true,
    reason: String(value.reason ?? "").slice(0, 120) || null,
  };
  return snapshot;
}

function snapshotObject(value) {
  const out = {};
  for (const type of RATING_TYPES) {
    const normalized = normalizeSnapshot(value?.[type]);
    if (normalized) out[type] = normalized;
  }
  return Object.keys(out).length ? out : null;
}

function mergeSnapshotObject(existing, incoming) {
  const previous = snapshotObject(existing) ?? {};
  const next = snapshotObject(incoming) ?? {};
  const merged = { ...previous };
  for (const type of RATING_TYPES) {
    if (!next[type]) continue;
    if (previous[type]?.status === "ready" && previous[type].complete === true) {
      continue;
    }
    merged[type] = next[type];
  }
  return Object.keys(merged).length ? merged : null;
}

function buildHistoricalOpponentSnapshots({
  records,
  selectedRecord,
  historyOwnerProfileId,
  opponentUserCode,
  characterId,
  potentialRatingValue,
  limit = INSIGHT_MATCH_LIMIT,
  capturedAt = Date.now(),
  historyComplete = true,
} = {}) {
  const selectedReplayId = String(selectedRecord?.replayId ?? "").trim();
  const owner = String(historyOwnerProfileId ?? "").replace(/\s/g, "");
  const opponent = String(opponentUserCode ?? selectedRecord?.opponentUserCode ?? "").replace(/\s/g, "");
  const targetCharacterId = finitePositive(characterId ?? selectedRecord?.opponentCharacterId);
  const source = Array.isArray(records) ? records : [];
  const cutoff = source.find((record) => String(record?.replayId ?? "").trim() === selectedReplayId) ?? null;
  const cutoffPlayedAt = timestampOf(cutoff);
  const base = {
    algorithmVersion: OPPONENT_INSIGHT_ALGORITHM_VERSION,
    cutoffReplayId: selectedReplayId || null,
    cutoffPlayedAt,
    historyOwnerProfileId: owner || null,
    opponentUserCode: opponent || null,
    characterId: targetCharacterId,
    capturedAt: Number.isFinite(Number(capturedAt)) ? Number(capturedAt) : Date.now(),
  };
  const invalid = (reason, complete = historyComplete) => Object.fromEntries(RATING_TYPES.map((type) => [type, {
    ...base,
    status: "insufficient",
    ratingType: null,
    matchTimeRating: null,
    sampleCount: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    potential: null,
    complete,
    reason,
  }]));
  if (!selectedReplayId || !cutoff || cutoffPlayedAt == null || targetCharacterId == null) {
    return invalid(
      !selectedReplayId
        ? "cutoff-replay-id-missing"
        : !cutoff
          ? "cutoff-not-found"
          : !targetCharacterId
            ? "character-missing"
            : "cutoff-time-missing",
      false,
    );
  }
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(INSIGHT_MATCH_LIMIT, Math.floor(Number(limit)))) : INSIGHT_MATCH_LIMIT;
  const prior = source
    .filter((record) => String(record?.replayId ?? "").trim() !== selectedReplayId)
    .filter((record) => record?.matchType === "ranked")
    .filter((record) => finitePositive(record?.characterId) === targetCharacterId)
    // Equality is intentionally excluded: replayId identifies the cutoff and
    // time alone cannot establish which same-time match came first.
    .filter((record) => {
      const timestamp = timestampOf(record);
      return timestamp != null && timestamp < cutoffPlayedAt;
    })
    .sort((a, b) => timestampOf(a) - timestampOf(b))
    .slice(-count);
  const wins = prior.filter((record) => record?.result === "win").length;
  const losses = prior.filter((record) => record?.result === "loss").length;
  const draws = prior.filter((record) => record?.result === "draw").length;
  return Object.fromEntries(RATING_TYPES.map((type) => {
    const endpoint = selectedOpponentRating(selectedRecord, type);
    const values = prior.map((record) => recordRating(record, type)).filter((value) => value != null);
    const ratingTypeKnown = String(selectedRecord?.opponentRatingType ?? "").toUpperCase() === type || endpoint != null;
    const complete = historyComplete;
    let status = "ready";
    let reason = null;
    let potential = null;
    if (!ratingTypeKnown) {
      status = "insufficient";
      reason = "rating-type-unknown";
    } else if (endpoint == null) {
      status = "insufficient";
      reason = "match-time-rating-missing-or-out-of-range";
    } else if (values.length < 1 || typeof potentialRatingValue !== "function") {
      status = "insufficient";
      reason = values.length < 1 ? "sample-insufficient" : "potential-unavailable";
    } else {
      potential = potentialRatingValue([...values, endpoint], type);
      if (!validRating(potential, type)) {
        status = "insufficient";
        reason = "potential-out-of-range";
        potential = null;
      }
    }
    return [type, {
      ...base,
      status,
      ratingType: ratingTypeKnown ? type : null,
      matchTimeRating: endpoint,
      sampleCount: values.length,
      wins,
      losses,
      draws,
      potential,
      complete,
      reason,
    }];
  }));
}

function recentRecords(records, characterId, limit = 20) {
  const id = finitePositive(characterId);
  const requestedLimit = Number(limit);
  const count = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(INSIGHT_MATCH_LIMIT, Math.floor(requestedLimit)))
    : INSIGHT_MATCH_LIMIT;
  return (Array.isArray(records) ? records : [])
    .filter((record) => record?.matchType === "ranked")
    .filter((record) => id == null || finitePositive(record?.characterId ?? record?.opponentCharacterId) === id)
    .sort((a, b) => Number(a?.playedAt ?? a?.uploadedAt) - Number(b?.playedAt ?? b?.uploadedAt))
    .slice(-count);
}

function buildOpponentOfficialInsight({ records, characterId, player, deriveHistoryRatingSeries, potentialRatingValue, limit = 20 } = {}) {
  const selected = recentRecords(records, characterId, limit);
  const result = { matches: selected.length, wins: 0, losses: 0, draws: 0, record: [], ratings: {} };
  for (const record of selected) {
    if (record?.result === "win") result.wins += 1;
    else if (record?.result === "loss") result.losses += 1;
    else result.draws += 1;
  }
  for (const type of RATING_TYPES) {
    const series = typeof deriveHistoryRatingSeries === "function"
      ? deriveHistoryRatingSeries(selected, player, type, { characterId })
      : { records: selected, values: [] };
    const values = (series.values ?? []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
    result.ratings[type] = {
      values,
      potential: values.length >= 2 && typeof potentialRatingValue === "function"
        ? potentialRatingValue(values.slice(-INSIGHT_MATCH_LIMIT), type)
        : null,
      currentValue: finitePositive(series.currentValue),
      currentApplied: Boolean(series.currentApplied),
    };
  }
  return result;
}

function selectOtherCharacterPeakMr(profileCharacterRatings, targetCharacterId) {
  const target = finitePositive(targetCharacterId);
  return (Array.isArray(profileCharacterRatings) ? profileCharacterRatings : [])
    .filter((entry) => finitePositive(entry?.characterId) != null && finitePositive(entry.characterId) !== target)
    .map((entry) => ({ characterId: Number(entry.characterId), characterDisplayName: String(entry.characterDisplayName ?? entry.characterName ?? "").trim(), peakMr: finitePositive(entry.peakMr) }))
    .filter((entry) => entry.peakMr != null)
    .sort((a, b) => b.peakMr - a.peakMr)[0] ?? null;
}

return {
  INSIGHT_MATCH_LIMIT,
  OPPONENT_INSIGHT_ALGORITHM_VERSION,
  buildOpponentOfficialInsight,
  buildHistoricalOpponentSnapshots,
  normalizeSnapshot,
  snapshotObject,
  mergeSnapshotObject,
  recentRecords,
  selectOtherCharacterPeakMr,
};
});
