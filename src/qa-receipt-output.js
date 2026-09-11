"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_QA_RECEIPT_ROOT = path.join(os.tmpdir(), "match-session-overlay", "qa");
const DEFAULT_QA_RECEIPT_FILE = "production-receipt.jsonl";
const MAX_QA_RECEIPT_BYTES = 256 * 1024;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RECEIPT_EVENT_KEYS = new Set([
  "stage",
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

function configuredQaReceiptDirectory({ argv = process.argv, env = process.env, root = DEFAULT_QA_RECEIPT_ROOT } = {}) {
  const argument = (Array.isArray(argv) ? argv : []).find((value) =>
    String(value).startsWith("--qa-receipt-dir=")
  );
  const explicit = argument
    ? String(argument).slice("--qa-receipt-dir=".length)
    : String(env?.MATCH_OVERLAY_QA_RECEIPT_DIR ?? "");
  if (!explicit) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(explicit);
  if (resolved === resolvedRoot || path.dirname(resolved) !== resolvedRoot) return null;
  if (!RUN_ID_PATTERN.test(path.basename(resolved))) return null;
  return resolved;
}

function sanitizeReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  const safe = {
    schema: typeof receipt.schema === "string" ? receipt.schema.slice(0, 80) : "",
    operation: typeof receipt.operation === "string" ? receipt.operation.slice(0, 80) : "unknown",
    scope: {
      locale: typeof receipt.scope?.locale === "string" ? receipt.scope.locale.slice(0, 16) : null,
      requestedAct: Number.isInteger(Number(receipt.scope?.requestedAct)) && Number(receipt.scope.requestedAct) >= 0
        ? Number(receipt.scope.requestedAct)
        : null,
      requestedModes: Array.isArray(receipt.scope?.requestedModes)
        ? receipt.scope.requestedModes.filter((value) => ["ranked", "battleHub", "casual"].includes(value))
        : [],
      profileIdPresent: receipt.scope?.profileIdPresent === true,
    },
    events: [],
    final: {
      status: ["ready", "partial", "unavailable"].includes(receipt.final?.status)
        ? receipt.final.status
        : "partial",
      reason: typeof receipt.final?.reason === "string" ? receipt.final.reason.slice(0, 80) : "UNAVAILABLE",
    },
  };
  for (const sourceEvent of Array.isArray(receipt.events) ? receipt.events.slice(-64) : []) {
    const event = {};
    for (const key of RECEIPT_EVENT_KEYS) {
      if (key === "stage") {
        if (typeof sourceEvent?.stage === "string") event.stage = sourceEvent.stage.slice(0, 80);
        continue;
      }
      const value = sourceEvent?.[key];
      if (typeof value === "string") event[key] = value.slice(0, 80);
      else if (typeof value === "boolean") event[key] = value;
      else if (Number.isInteger(value) && value >= 0) event[key] = value;
      else if (key === "allWinRate" && Number.isFinite(value) && value >= 0 && value <= 100) {
        event[key] = Math.round(value * 100) / 100;
      }
    }
    if (event.stage) safe.events.push(event);
  }
  return safe;
}

function createQaReceiptWriter({ directory = null, root = DEFAULT_QA_RECEIPT_ROOT, fileName = DEFAULT_QA_RECEIPT_FILE } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = directory ? path.resolve(directory) : null;
  const enabled = Boolean(
    resolvedDirectory &&
    resolvedDirectory !== resolvedRoot &&
    path.dirname(resolvedDirectory) === resolvedRoot &&
    RUN_ID_PATTERN.test(path.basename(resolvedDirectory)) &&
    fileName === DEFAULT_QA_RECEIPT_FILE,
  );
  const filePath = enabled ? path.join(resolvedDirectory, fileName) : null;
  return {
    enabled,
    directory: enabled ? resolvedDirectory : null,
    filePath,
    write(receipt) {
      if (!enabled) return false;
      try {
        const directoryStat = fs.lstatSync(resolvedDirectory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return false;
        if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) return false;
        const line = `${JSON.stringify(sanitizeReceipt(receipt))}\n`;
        const bytes = Buffer.byteLength(line, "utf8");
        const fd = fs.openSync(filePath, "a", 0o600);
        try {
          if (fs.fstatSync(fd).size + bytes > MAX_QA_RECEIPT_BYTES) return false;
          fs.writeSync(fd, line, null, "utf8");
          try { fs.fchmodSync(fd, 0o600); } catch { /* Windows ACLs may ignore POSIX mode bits. */ }
        } finally {
          fs.closeSync(fd);
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = {
  DEFAULT_QA_RECEIPT_FILE,
  DEFAULT_QA_RECEIPT_ROOT,
  MAX_QA_RECEIPT_BYTES,
  configuredQaReceiptDirectory,
  createQaReceiptWriter,
  sanitizeReceipt,
};
