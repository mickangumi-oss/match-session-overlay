"use strict";

const ROUND_RESULT_CODES = Object.freeze(["V", "C", "T", "D", "OD", "SA", "CA", "P"]);
const ROUND_RESULT_MIN_CODE = 1;
const ROUND_RESULT_MAX_CODE = 8;
const ROUND_TREND_LIMIT = 100;
const ROUND_TREND_MATCH_TYPES = Object.freeze(["ranked", "battleHub", "casual"]);

function validRoundCode(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= ROUND_RESULT_MIN_CODE && value <= ROUND_RESULT_MAX_CODE;
}

function valuesFromSummary(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.values)) return value.values;
  if (Array.isArray(value.battles)) {
    return value.battles.flatMap((battle) => Array.isArray(battle?.values) ? battle.values : []);
  }
  return null;
}

function timestampForRecord(record) {
  const value = Number(record?.playedAt ?? record?.uploadedAt ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function displayDate(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 100000000000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function roundRecordFingerprint(record) {
  return JSON.stringify([
    record?.actId ?? null,
    record?.matchType ?? null,
    record?.characterId ?? null,
    record?.opponentCharacterId ?? null,
    record?.opponentUserCode ?? null,
    record?.result ?? null,
    record?.roundResults ?? null,
  ]);
}

function emptySide() {
  return {
    matches: 0,
    wonRounds: null,
    unknownRounds: 0,
    codes: ROUND_RESULT_CODES.map((code) => ({ code, count: null, percentage: null })),
  };
}

function buildSide(values) {
  const side = emptySide();
  if (!Array.isArray(values)) return side;
  side.matches = 1;
  let wonRounds = 0;
  for (const value of values) {
    if (validRoundCode(value)) {
      wonRounds += 1;
      const item = side.codes[value - 1];
      item.count = (item.count ?? 0) + 1;
    } else if (value !== 0) {
      side.unknownRounds += 1;
    }
  }
  side.wonRounds = wonRounds;
  for (const item of side.codes) {
    item.percentage = wonRounds > 0 ? (item.count ?? 0) / wonRounds * 100 : null;
  }
  return side;
}

function mergeSide(target, source) {
  if (source.matches > 0) target.matches += 1;
  if (source.wonRounds != null) target.wonRounds = (target.wonRounds ?? 0) + source.wonRounds;
  target.unknownRounds += source.unknownRounds;
  for (let index = 0; index < target.codes.length; index += 1) {
    const sourceItem = source.codes[index];
    if (sourceItem.count != null) target.codes[index].count = (target.codes[index].count ?? 0) + sourceItem.count;
  }
}

function finalizeSide(side) {
  const wonRounds = side.wonRounds;
  for (const item of side.codes) {
    item.percentage = wonRounds > 0 ? (item.count ?? 0) / wonRounds * 100 : null;
  }
  return side;
}

function buildRoundTrend(records, {
  opponentUserCode = null,
  characterId = null,
  limit = ROUND_TREND_LIMIT,
  matchTypes = null,
  actId = null,
  // When a row is selected, only matches strictly before that row belong to
  // the historical trend. A zero/invalid cutoff keeps the legacy behaviour.
  beforeTimestamp = null,
} = {}) {
  const normalizedOpponent = opponentUserCode == null ? null : String(opponentUserCode);
  const normalizedCharacter = Number(characterId) > 0 ? Number(characterId) : null;
  const cutoff = Number(beforeTimestamp);
  const hasCutoff = Number.isFinite(cutoff) && cutoff > 0;
  const allowedMatchTypes = Array.isArray(matchTypes)
    ? new Set(matchTypes.map((value) => String(value)))
    : null;
  const expectedActId = Number(actId);
  const hasActId = Number.isInteger(expectedActId) && expectedActId > 0;
  const candidates = (Array.isArray(records) ? records : [])
    .filter((record) => {
      if (normalizedOpponent && String(record.opponentUserCode ?? "") !== normalizedOpponent) return false;
      if (normalizedCharacter != null && Number(record.opponentCharacterId) !== normalizedCharacter) return false;
      return true;
    });
  const hasRoundSummary = (record) => {
    if (!record?.roundResults) return false;
    return valuesFromSummary(record.roundResults.self) != null ||
      valuesFromSummary(record.roundResults.opponent) != null;
  };
  const futureExcludedCount = hasCutoff
    ? candidates.filter((record) => timestampForRecord(record) >= cutoff).length
    : 0;
  const cutoffCandidates = hasCutoff
    ? candidates.filter((record) => timestampForRecord(record) > 0 && timestampForRecord(record) < cutoff)
    : candidates;
  const candidateTimestamps = candidates
    .map((record) => timestampForRecord(record))
    .filter((timestamp) => timestamp > 0);
  const candidateTimestampMin = candidateTimestamps.length ? Math.min(...candidateTimestamps) : 0;
  const candidateTimestampMax = candidateTimestamps.length ? Math.max(...candidateTimestamps) : 0;
  const missingRoundMatches = cutoffCandidates.filter((record) => !hasRoundSummary(record)).length;
  const missingTimestampMatches = hasCutoff
    ? candidates.filter((record) => timestampForRecord(record) <= 0).length
    : 0;
  const actMismatchMatches = hasActId
    ? cutoffCandidates.filter((record) => Number(record?.actId) !== expectedActId).length
    : 0;
  const modeMismatchMatches = allowedMatchTypes
    ? cutoffCandidates.filter((record) => !allowedMatchTypes.has(String(record?.matchType ?? ""))).length
    : 0;
  const strictContract = Boolean(allowedMatchTypes || hasActId);
  const missingReplayIdMatches = strictContract
    ? cutoffCandidates.filter((record) => !String(record?.replayId ?? "").trim()).length
    : 0;
  const unknownResultMatches = strictContract
    ? cutoffCandidates.filter((record) => record?.result != null && !["win", "loss", "draw"].includes(String(record.result))).length
    : 0;
  const filtered = cutoffCandidates
    .filter((record) => hasRoundSummary(record))
    .filter((record) => !hasActId || Number(record?.actId) === expectedActId)
    .filter((record) => !allowedMatchTypes || allowedMatchTypes.has(String(record?.matchType ?? "")))
    .filter((record) => !strictContract || record?.result == null || ["win", "loss", "draw"].includes(String(record.result)))
    .sort((left, right) => timestampForRecord(right) - timestampForRecord(left));
  const seenReplayIds = new Map();
  let duplicateExactCount = 0;
  let duplicateConflictCount = 0;
  const deduplicated = filtered.filter((record) => {
    const replayId = String(record?.replayId ?? "").trim();
    if (!replayId) return true;
    const fingerprint = roundRecordFingerprint(record);
    const previous = seenReplayIds.get(replayId);
    if (previous) {
      if (previous === fingerprint) duplicateExactCount += 1;
      else duplicateConflictCount += 1;
      return false;
    }
    seenReplayIds.set(replayId, fingerprint);
    return true;
  });
  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || ROUND_TREND_LIMIT));
  const limitExcludedCount = Math.max(0, deduplicated.length - normalizedLimit);
  const source = deduplicated.slice(0, normalizedLimit);

  const self = emptySide();
  const opponent = emptySide();
  let matchedMatches = 0;
  let from = null;
  let to = null;
  for (const record of source) {
    const selfValues = valuesFromSummary(record.roundResults.self);
    const opponentValues = valuesFromSummary(record.roundResults.opponent);
    if (selfValues == null && opponentValues == null) continue;
    const timestamp = timestampForRecord(record);
    if (timestamp > 0) {
      from = from == null ? timestamp : Math.min(from, timestamp);
      to = to == null ? timestamp : Math.max(to, timestamp);
    }
    const selfRecord = buildSide(selfValues);
    const opponentRecord = buildSide(opponentValues);
    mergeSide(self, selfRecord);
    mergeSide(opponent, opponentRecord);
    if (selfValues != null && opponentValues != null) matchedMatches += 1;
  }
  finalizeSide(self);
  finalizeSide(opponent);
  const hasData = source.length > 0;
  const hasBothSides = self.matches > 0 && opponent.matches > 0;
  const hasRounds = self.wonRounds > 0 && opponent.wonRounds > 0;
  const hasUnknown = self.unknownRounds > 0 || opponent.unknownRounds > 0;
  const status = missingRoundMatches > 0 || missingTimestampMatches > 0 || actMismatchMatches > 0 || modeMismatchMatches > 0 || missingReplayIdMatches > 0 || unknownResultMatches > 0 || duplicateConflictCount > 0
    ? "partial"
    : !hasData
    ? "unavailable"
    : hasUnknown && !hasRounds
      ? "unknown"
      : !hasBothSides
        ? "partial"
        : !hasRounds
          ? "insufficient_sample"
          : hasUnknown
            ? "partial"
            : "ready";
  return {
    status,
    limit: Math.max(1, Math.floor(Number(limit) || ROUND_TREND_LIMIT)),
    matchCount: source.length,
    matchedMatches,
    missingRoundMatches,
    missingTimestampMatches,
    actMismatchMatches,
    modeMismatchMatches,
    missingReplayIdMatches,
    unknownResultMatches,
    duplicateExactCount,
    duplicateConflictCount,
    futureExcludedCount,
    roomExcludedCount: modeMismatchMatches,
    parseMissingCount: missingReplayIdMatches + unknownResultMatches,
    limitExcludedCount,
    candidateCount: candidates.length,
    diagnostics: {
      candidateCount: candidates.length,
      selectedMatches: source.length,
      candidateTimestampMin,
      candidateTimestampMax,
      beforeCutoffCount: cutoffCandidates.length,
      missingRoundMatches,
      missingTimestampMatches,
      actMismatchMatches,
      modeMismatchMatches,
      missingReplayIdMatches,
      unknownResultMatches,
      duplicateExactCount,
      duplicateConflictCount,
      futureExcludedCount,
      roomExcludedCount: modeMismatchMatches,
      parseMissingCount: missingReplayIdMatches + unknownResultMatches,
      limitExcludedCount,
    },
    scope: {
      actId: hasActId ? expectedActId : null,
      cutoff: hasCutoff ? cutoff : null,
      matchTypes: allowedMatchTypes ? [...allowedMatchTypes].sort() : null,
      limit: Math.max(1, Math.floor(Number(limit) || ROUND_TREND_LIMIT)),
    },
    period: from == null ? null : { from: displayDate(from), to: displayDate(to) },
    self,
    opponent,
    codes: ROUND_RESULT_CODES,
    source: "history-round-results",
  };
}

function annotateRoundTrendAcquisition(
  trend,
  { complete = false, reason = null } = {},
) {
  const acquisitionComplete = complete === true;
  const nextStatus = acquisitionComplete && Number(trend?.matchCount) === 0
    ? "insufficient_sample"
    : acquisitionComplete
      ? "ready"
      : reason === "RETRIEVAL_FAILED"
        ? "error"
        : "partial";
  return {
    ...trend,
    status: nextStatus,
    reason: reason ?? trend?.reason ?? null,
    acquisitionComplete,
    zeroIsUnknown: !acquisitionComplete,
  };
}

function buildRoundTrendFailure(scope = {}, { status = "partial", reason = "ACT_SCOPE_MISSING" } = {}) {
  const trend = buildRoundTrend([], scope);
  return {
    ...trend,
    status,
    reason,
    acquisitionComplete: false,
    zeroIsUnknown: true,
  };
}

function combineRoundTrends(selfTrend, opponentTrend, { limit = ROUND_TREND_LIMIT } = {}) {
  const self = selfTrend?.self ?? emptySide();
  const opponent = opponentTrend?.self ?? emptySide();
  const hasData = self.matches > 0 || opponent.matches > 0;
  const hasBothSides = self.matches > 0 && opponent.matches > 0;
  const hasRounds = self.wonRounds > 0 && opponent.wonRounds > 0;
  const hasUnknown = self.unknownRounds > 0 || opponent.unknownRounds > 0;
  const calculatedStatus = !hasData
    ? "unavailable"
    : hasUnknown && !hasRounds
      ? "unknown"
      : !hasBothSides
        ? "partial"
        : !hasRounds
          ? "insufficient_sample"
          : hasUnknown
            ? "partial"
            : "ready";
  const statusPriority = {
    ready: 0,
    unavailable: 1,
    insufficient_sample: 2,
    unknown: 3,
    partial: 4,
    error: 5,
  };
  const sourceStatuses = [
    selfTrend?.status ?? (self.matches > 0 ? "ready" : "unavailable"),
    opponentTrend?.status ?? (opponent.matches > 0 ? "ready" : "unavailable"),
  ];
  const acquisitionComplete = selfTrend?.acquisitionComplete === true &&
    opponentTrend?.acquisitionComplete === true;
  const sourceStatus = sourceStatuses.reduce(
    (highest, value) => statusPriority[value] > statusPriority[highest] ? value : highest,
    "ready",
  );
  const selfScope = selfTrend?.scope ?? null;
  const opponentScope = opponentTrend?.scope ?? null;
  const scopeMismatch = !selfScope || !opponentScope || JSON.stringify(selfScope) !== JSON.stringify(opponentScope);
  const status = scopeMismatch
    ? sourceStatus === "ready" ? "partial" : sourceStatus
    : sourceStatus === "ready" ? calculatedStatus : sourceStatus;
  const zeroIsUnknown = !acquisitionComplete || sourceStatuses.some((sourceStatus, index) =>
    ["error", "unavailable", "partial"].includes(sourceStatus) &&
    (index === 0 ? self.matches : opponent.matches) === 0,
  );
  const trendDiagnostics = (trend) => trend?.diagnostics ?? {
    candidateCount: Number(trend?.candidateCount) || 0,
    selectedMatches: Number(trend?.matchCount) || 0,
    candidateTimestampMin: Number(trend?.candidateTimestampMin) || 0,
    candidateTimestampMax: Number(trend?.candidateTimestampMax) || 0,
    beforeCutoffCount: Number(trend?.beforeCutoffCount) || 0,
    missingRoundMatches: Number(trend?.missingRoundMatches) || 0,
    missingTimestampMatches: Number(trend?.missingTimestampMatches) || 0,
    actMismatchMatches: Number(trend?.actMismatchMatches) || 0,
    modeMismatchMatches: Number(trend?.modeMismatchMatches) || 0,
    missingReplayIdMatches: Number(trend?.missingReplayIdMatches) || 0,
    unknownResultMatches: Number(trend?.unknownResultMatches) || 0,
    duplicateExactCount: Number(trend?.duplicateExactCount) || 0,
    duplicateConflictCount: Number(trend?.duplicateConflictCount) || 0,
    futureExcludedCount: Number(trend?.futureExcludedCount) || 0,
    roomExcludedCount: Number(trend?.roomExcludedCount) || 0,
    parseMissingCount: Number(trend?.parseMissingCount) || 0,
    limitExcludedCount: Number(trend?.limitExcludedCount) || 0,
  };
  const selfDiagnostics = trendDiagnostics(selfTrend);
  const opponentDiagnostics = trendDiagnostics(opponentTrend);
  const combinedCount = (key) => selfDiagnostics[key] + opponentDiagnostics[key];
  return {
    status,
    limit: Math.max(1, Math.floor(Number(limit) || ROUND_TREND_LIMIT)),
    matchCount: Math.max(self.matches, opponent.matches),
    matchedMatches: Math.min(self.matches, opponent.matches),
    period: null,
    sourceStatuses,
    acquisitionComplete,
    zeroIsUnknown,
    reason: selfTrend?.reason ?? opponentTrend?.reason ?? null,
    scope: scopeMismatch ? null : selfScope,
    candidateCount: (Number(selfTrend?.candidateCount) || 0) + (Number(opponentTrend?.candidateCount) || 0),
    selectedMatches: Math.max(self.matches, opponent.matches),
    futureExcludedCount: combinedCount("futureExcludedCount"),
    roomExcludedCount: combinedCount("roomExcludedCount"),
    duplicateExactCount: combinedCount("duplicateExactCount"),
    duplicateConflictCount: combinedCount("duplicateConflictCount"),
    missingRoundMatches: combinedCount("missingRoundMatches"),
    parseMissingCount: combinedCount("parseMissingCount"),
    limitExcludedCount: combinedCount("limitExcludedCount"),
    diagnostics: {
      self: selfDiagnostics,
      opponent: opponentDiagnostics,
      scopeMismatch,
    },
    self,
    opponent,
    codes: ROUND_RESULT_CODES,
    source: "history-round-results-comparison",
  };
}

module.exports = {
  ROUND_RESULT_CODES,
  ROUND_TREND_MATCH_TYPES,
  ROUND_TREND_LIMIT,
  buildRoundTrend,
  annotateRoundTrendAcquisition,
  buildRoundTrendFailure,
  combineRoundTrends,
};
