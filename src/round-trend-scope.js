"use strict";

const {
  ROUND_TREND_MATCH_TYPES,
  annotateRoundTrendAcquisition,
  buildRoundTrend,
  buildRoundTrendFailure,
  combineRoundTrends,
} = require("./round-results-summary");
const { isKnownHistoryActRecord } = require("./history-act-provenance");

function normalizePositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeHistoryActId(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeRequestedActId(value) {
  if (value == null) return { ok: false, reason: "ACT_SCOPE_MISSING", actId: null };
  const actId = normalizeHistoryActId(value);
  return actId == null
    ? { ok: false, reason: "ACT_SCOPE_INVALID", actId: null }
    : { ok: true, reason: null, actId };
}

function normalizedRecordActIds(records) {
  return [...new Set(
    (Array.isArray(records) ? records : [])
      .filter((record) => isKnownHistoryActRecord(record))
      .map((record) => normalizeHistoryActId(record?.actId))
      .filter((value) => value != null),
  )].sort((left, right) => left - right);
}

function verifyScopedHistoryPage({
  pageResult,
  page,
  expectedTotalPages = null,
  requestedActId,
  actIndependent = false,
  requestScopeVerified = false,
} = {}) {
  const requested = normalizeRequestedActId(requestedActId);
  if (!requested.ok && actIndependent !== true) return requested;
  const totalPages = normalizePositiveInteger(pageResult?.totalPages);
  if (totalPages == null) return { ok: false, reason: "HISTORY_TOTAL_PAGE_INVALID" };
  if (expectedTotalPages != null && totalPages !== expectedTotalPages) {
    return { ok: false, reason: "HISTORY_TOTAL_PAGE_CHANGED" };
  }
  if (pageResult?.responsePage !== page) {
    return { ok: false, reason: "HISTORY_PAGE_NUMBER_MISSING_OR_MISMATCH" };
  }
  if (pageResult?.hasReplayList !== true) {
    return { ok: false, reason: "HISTORY_REPLAY_LIST_MISSING" };
  }
  if (pageResult?.normalizedCount !== pageResult?.rawCount) {
    return { ok: false, reason: "HISTORY_REPLAY_NORMALIZATION_INCOMPLETE" };
  }

  const responseActId = normalizeHistoryActId(pageResult?.responseActId);
  const recordActIds = normalizedRecordActIds(pageResult?.replays);
  const responseConflict = actIndependent !== true && responseActId != null && responseActId !== requested.actId;
  const recordConflict = actIndependent !== true && recordActIds.some((value) => value !== requested.actId);
  if (responseConflict || recordConflict) {
    return {
      ok: false,
      reason: "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH",
      requestedActId: requested.actId,
      responseActId,
      recordActIds,
    };
  }

  const hasExplicitEvidence = responseActId === requested.actId ||
    recordActIds.length === 1 && recordActIds[0] === requested.actId;
  if (actIndependent !== true && !hasExplicitEvidence && pageResult?.actScopeVerified !== true && requestScopeVerified !== true) {
    return {
      ok: false,
      reason: "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH",
      requestedActId: requested.actId,
      responseActId,
      recordActIds,
    };
  }
  return {
    ok: true,
    reason: null,
    requestedActId: requested.ok ? requested.actId : null,
    responseActId,
    recordActIds,
    totalPages,
    source: actIndependent === true
      ? "act-independent"
      : responseActId === requested.actId
        ? "response"
        : recordActIds.length === 1
          ? "records"
          : "verified-request",
  };
}

function stampScopedHistoryRecords(records, requestedActId) {
  const requested = normalizeRequestedActId(requestedActId);
  if (!requested.ok) return { ok: false, reason: requested.reason, records: [] };
  return {
    ok: true,
    reason: null,
    records: (Array.isArray(records) ? records : []).map((record) => ({
      ...record,
      actId: normalizeHistoryActId(record?.actId) ?? requested.actId,
      actIdKnown: true,
    })),
  };
}

function buildScopedRoundTrendContext({
  selectedRecord = null,
  selectedActId = null,
  actIndependent = false,
  ownerRecords = [],
  opponentRecords = [],
  ownerComplete = false,
  opponentComplete = false,
} = {}) {
  const requested = normalizeRequestedActId(selectedActId);
  const baseScope = {
    beforeTimestamp: Number(selectedRecord?.playedAt ?? selectedRecord?.uploadedAt) || null,
    limit: 20,
    matchTypes: ROUND_TREND_MATCH_TYPES,
    actId: requested.ok ? requested.actId : null,
  };
  if (!requested.ok && actIndependent !== true) {
    return {
      ok: false,
      reason: requested.reason,
      selectedRecord: null,
      roundTrend: buildRoundTrendFailure(baseScope, { reason: requested.reason }),
    };
  }
  const existingAct = normalizeHistoryActId(selectedRecord?.actId);
  if (actIndependent !== true && existingAct != null && existingAct !== requested.actId) {
    return {
      ok: false,
      reason: "ACT_SCOPE_MISMATCH",
      selectedRecord: null,
      roundTrend: buildRoundTrendFailure(baseScope, { reason: "ACT_SCOPE_MISMATCH" }),
    };
  }
  const scopedSelectedRecord = actIndependent === true
    ? { ...selectedRecord }
    : { ...selectedRecord, actId: requested.actId };
  const selfTrend = annotateRoundTrendAcquisition(buildRoundTrend(ownerRecords, baseScope), {
    complete: ownerComplete,
  });
  const opponentTrend = annotateRoundTrendAcquisition(buildRoundTrend(opponentRecords, baseScope), {
    complete: opponentComplete,
  });
  return {
    ok: true,
    reason: null,
    selectedActId: requested.ok ? requested.actId : null,
    selectedRecord: scopedSelectedRecord,
    roundTrend: combineRoundTrends(selfTrend, opponentTrend, { limit: 20 }),
  };
}

module.exports = {
  normalizePositiveInteger,
  normalizeHistoryActId,
  normalizeRequestedActId,
  normalizedRecordActIds,
  verifyScopedHistoryPage,
  stampScopedHistoryRecords,
  buildScopedRoundTrendContext,
};
