"use strict";

const {
  configuredQaReceiptDirectory,
  createQaReceiptWriter,
} = require("./qa-receipt-output");

const PRODUCTION_RECEIPT_SCHEMA = "mso.production-receipt.v1";
const ALLOWED_MATCH_MODES = Object.freeze(["ranked", "battleHub", "casual"]);
const qaReceiptWriter = createQaReceiptWriter({
  directory: configuredQaReceiptDirectory(),
});
const SAFE_EVENT_KEYS = new Set([
  "status",
  "classification",
  "contentType",
  "httpStatus",
  "httpStatusClass",
  "expectedContentType",
  "responseShape",
  "selfFieldState",
  "rivalFieldState",
  "scopeFieldState",
  "outerRowCount",
  "nestedRowCount",
  "requiredPayload",
  "requiredFieldCount",
  "normalizedCount",
  "rawCount",
  "page",
  "totalPages",
  "requestedAct",
  "responseAct",
  "probedAct",
  "resolvedAct",
  "actSource",
  "ipcSelectedAct",
  "ipcSelectedActSelector",
  "ipcCurrentAct",
  "ipcActSelectionSource",
  "ipcSelectedRecordAct",
  "ipcSelectedRecordActPresent",
  "networkAttempted",
  "cacheHitScope",
  "ownCharacterId",
  "selectionSource",
  "outerMatchCount",
  "actScopeVerified",
  "mode",
  "modeName",
  "selectedMode",
  "sourceModes",
  "rowCount",
  "allRowPresent",
  "allBattleCount",
  "allWinCount",
  "allWinRate",
  "displayRowCount",
  "trueZero",
  "partialMissingModes",
  "targetMatches",
  "targetRounds",
  "candidateCount",
  "selectedMatches",
  "cutoffExcluded",
  "futureExcluded",
  "roomExcluded",
  "duplicateExact",
  "duplicateConflict",
  "roundMissing",
  "parseMissing",
  "limitExcluded",
  "selfCandidateCount",
  "selfSelectedMatches",
  "selfCutoffExcluded",
  "selfRoomExcluded",
  "selfDuplicateExact",
  "selfDuplicateConflict",
  "selfRoundMissing",
  "selfParseMissing",
  "selfLimitExcluded",
  "opponentCandidateCount",
  "opponentSelectedMatches",
  "opponentCutoffExcluded",
  "opponentRoomExcluded",
  "opponentDuplicateExact",
  "opponentDuplicateConflict",
  "opponentRoundMissing",
  "opponentParseMissing",
  "opponentLimitExcluded",
  "profileScopeDigest",
  "cacheScopeDigest",
  "scopeSource",
  "selfStopReason",
  "opponentStopReason",
  "cutoffTimestamp",
  "selfCandidateMinTimestamp",
  "selfCandidateMaxTimestamp",
  "selfBeforeCutoff",
  "selfAfterCutoff",
  "opponentCandidateMinTimestamp",
  "opponentCandidateMaxTimestamp",
  "opponentBeforeCutoff",
  "opponentAfterCutoff",
  "profileIdPresent",
  "reason",
]);

function finiteInteger(value, { min = 0 } = {}) {
  return Number.isInteger(Number(value)) && Number(value) >= min ? Number(value) : null;
}

function safeValue(key, value) {
  if (key === "status" || key === "classification" || key === "contentType" ||
      key === "httpStatusClass" || key === "expectedContentType" || key === "responseShape" ||
      key === "selfFieldState" || key === "rivalFieldState" || key === "scopeFieldState" ||
      key === "requiredPayload" || key === "modeName" || key === "actSource" ||
      key === "ipcSelectedActSelector" || key === "ipcActSelectionSource" ||
      key === "cacheHitScope" || key === "selectionSource" || key === "selectedMode" ||
      key === "sourceModes" || key === "partialMissingModes" || key === "reason" ||
      key === "profileScopeDigest" || key === "cacheScopeDigest" || key === "scopeSource" ||
      key === "selfStopReason" || key === "opponentStopReason") {
    return typeof value === "string" ? value.slice(0, 80) : null;
  }
  if (key === "httpStatus" || key === "page" || key === "totalPages" || key === "requestedAct" ||
      key === "responseAct" || key === "probedAct" || key === "resolvedAct" || key === "ownCharacterId" || key === "outerMatchCount" || key === "mode" || key === "rowCount" || key === "requiredFieldCount" ||
      key === "normalizedCount" || key === "rawCount" || key === "targetMatches" || key === "targetRounds" ||
      key === "outerRowCount" || key === "nestedRowCount" || key === "allBattleCount" ||
      key === "allWinCount" || key === "displayRowCount" || key === "ipcSelectedAct" ||
      key === "ipcCurrentAct" || key === "ipcSelectedRecordAct" || key === "targetMatches" ||
      key === "targetRounds" || key === "candidateCount" || key === "selectedMatches" ||
      key === "cutoffExcluded" || key === "futureExcluded" || key === "roomExcluded" ||
      key === "duplicateExact" || key === "duplicateConflict" || key === "roundMissing" ||
      key === "parseMissing" || key === "limitExcluded" || key === "selfCandidateCount" ||
      key === "selfSelectedMatches" || key === "selfCutoffExcluded" || key === "selfRoomExcluded" ||
      key === "selfDuplicateExact" || key === "selfDuplicateConflict" || key === "selfRoundMissing" ||
      key === "selfParseMissing" || key === "selfLimitExcluded" || key === "opponentCandidateCount" ||
      key === "opponentSelectedMatches" || key === "opponentCutoffExcluded" || key === "opponentRoomExcluded" ||
      key === "opponentDuplicateExact" || key === "opponentDuplicateConflict" || key === "opponentRoundMissing" ||
      key === "opponentParseMissing" || key === "opponentLimitExcluded" || key === "cutoffTimestamp" ||
      key === "selfCandidateMinTimestamp" || key === "selfCandidateMaxTimestamp" || key === "selfBeforeCutoff" ||
      key === "selfAfterCutoff" || key === "opponentCandidateMinTimestamp" || key === "opponentCandidateMaxTimestamp" ||
      key === "opponentBeforeCutoff" || key === "opponentAfterCutoff") {
    return finiteInteger(value);
  }
  if (key === "actScopeVerified" || key === "allRowPresent" || key === "profileIdPresent" || key === "trueZero" || key === "networkAttempted" || key === "ipcSelectedRecordActPresent") {
    return value === true;
  }
  if (key === "allWinRate") {
    return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100
      ? Math.round(Number(value) * 100) / 100
      : null;
  }
  return undefined;
}

function createProductionReceipt({
  operation = "unknown",
  locale = null,
  requestedAct = null,
  requestedModes = ALLOWED_MATCH_MODES,
  profileId = null,
} = {}) {
  const modes = Array.isArray(requestedModes)
    ? requestedModes.filter((mode) => ALLOWED_MATCH_MODES.includes(mode))
    : [...ALLOWED_MATCH_MODES];
  return {
    schema: PRODUCTION_RECEIPT_SCHEMA,
    operation: String(operation).slice(0, 80),
    scope: {
      locale: typeof locale === "string" ? locale.slice(0, 16) : null,
      requestedAct: finiteInteger(requestedAct),
      requestedModes: modes,
      profileIdPresent: Boolean(String(profileId ?? "").trim()),
    },
    events: [],
    final: { status: "partial", reason: "IN_PROGRESS" },
  };
}

function recordProductionReceipt(receipt, stage, details = {}) {
  if (!receipt || typeof receipt !== "object" || !Array.isArray(receipt.events)) return receipt;
  const event = { stage: String(stage ?? "unknown").slice(0, 80) };
  for (const [key, value] of Object.entries(details ?? {})) {
    if (!SAFE_EVENT_KEYS.has(key)) continue;
    const safe = safeValue(key, value);
    if (safe !== undefined && safe !== null) event[key] = safe;
  }
  receipt.events.push(event);
  if (receipt.events.length > 64) receipt.events.splice(0, receipt.events.length - 64);
  return receipt;
}

function finalizeProductionReceipt(receipt, { status = "partial", reason = "UNAVAILABLE" } = {}) {
  if (!receipt || typeof receipt !== "object") return null;
  const allowedStatuses = new Set(["ready", "partial", "unavailable"]);
  receipt.final = {
    status: allowedStatuses.has(status) ? status : "partial",
    reason: typeof reason === "string" ? reason.slice(0, 80) : "UNAVAILABLE",
  };
  qaReceiptWriter.write(receipt);
  return receipt;
}

function classifyHttpResponse(response, { expectedContentType = null } = {}) {
  const status = finiteInteger(response?.status);
  const httpStatusClass = status == null ? "unknown" : `${Math.floor(status / 100)}xx`;
  const rawContentType = String(response?.headers?.get?.("content-type") ?? "").toLowerCase();
  const redirectedToLogin = String(response?.url ?? "").includes("/auth/loginep");
  const contentType = rawContentType.includes("json")
    ? "json"
    : rawContentType.includes("html")
      ? "html"
      : rawContentType
        ? "other"
        : "missing";
  let classification = "http_error";
  if (status === 401 || status === 403 || redirectedToLogin) classification = "auth_required";
  else if (status === 429) classification = "rate_limited";
  else if (response?.ok === true && expectedContentType && contentType !== expectedContentType) classification = "content_type_mismatch";
  else if (response?.ok === true) classification = "ok";
  return {
    status: response?.ok === true && classification === "ok" ? "ok" : "unavailable",
    classification,
    httpStatus: status,
    httpStatusClass,
    contentType,
    ...(expectedContentType ? { expectedContentType } : {}),
  };
}

function classifyPayloadShape(payload) {
  if (Array.isArray(payload)) return payload.length ? "array" : "empty-array";
  if (payload && typeof payload === "object") return Object.keys(payload).length ? "object" : "empty-object";
  return "invalid";
}

module.exports = {
  ALLOWED_MATCH_MODES,
  PRODUCTION_RECEIPT_SCHEMA,
  classifyHttpResponse,
  classifyPayloadShape,
  createProductionReceipt,
  finalizeProductionReceipt,
  recordProductionReceipt,
};
