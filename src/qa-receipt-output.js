"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_QA_RECEIPT_ROOT = path.join(os.tmpdir(), "match-session-overlay", "qa");
const DEFAULT_QA_RECEIPT_FILE = "production-receipt.jsonl";
const DEFAULT_QA_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_QA_RECEIPT_MAX_RUNS = 8;
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
  "selectedReplayPresent",
  "knownRecordCount",
  "unknownRecordCount",
  "mixedAct",
  "scopeProof",
  "complete",
  "actIndependent",
  "aggregation",
]);

function configuredQaReceiptDirectory({ argv = process.argv, env = process.env, root = DEFAULT_QA_RECEIPT_ROOT, allowOverride = false } = {}) {
  const argument = (Array.isArray(argv) ? argv : []).find((value) =>
    String(value).startsWith("--qa-receipt-dir=")
  );
  const explicit = argument
    ? String(argument).slice("--qa-receipt-dir=".length)
    : String(env?.MATCH_OVERLAY_QA_RECEIPT_DIR ?? "");
  if (!explicit || allowOverride !== true) return null;
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
      if (key === "scopeProof") {
        if (["verified-request", "verified-response", "verified-record", "rejected"].includes(value)) event[key] = value;
      } else if (key === "aggregation") {
        if (["all-ready", "history-ready", "peak-ready", "partial", "unavailable", "error"].includes(value)) event[key] = value;
      } else if (typeof value === "string") event[key] = value.slice(0, 80);
      else if (typeof value === "boolean") event[key] = value;
      else if (["knownRecordCount", "unknownRecordCount"].includes(key) && Number.isInteger(value) && value >= 0 && value <= 100000) event[key] = value;
      else if (Number.isInteger(value) && value >= 0) event[key] = value;
      else if (key === "allWinRate" && Number.isFinite(value) && value >= 0 && value <= 100) {
        event[key] = Math.round(value * 100) / 100;
      }
    }
    if (event.stage) safe.events.push(event);
  }
  return safe;
}

function pathIsUnsafe(value) {
  const text = String(value ?? "");
  return !path.isAbsolute(text) || text.startsWith("\\\\") || /^\\\\\?\\|^\\\\\.\\/i.test(text) || /^\\Device\\/i.test(text);
}

function canonicalExistingAncestor(value) {
  let current = path.resolve(value);
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    tail.unshift(path.basename(current));
    current = parent;
  }
  let canonical;
  try { canonical = fs.realpathSync.native(current); } catch { return null; }
  return { canonical, tail };
}

function containsReparseComponent(value) {
  let current = path.resolve(value);
  const components = [];
  while (true) {
    components.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const component of components) {
    try {
      if (fs.lstatSync(component).isSymbolicLink()) return true;
    } catch {
      // Nonexistent tail components are safe to validate lexically below.
    }
  }
  return false;
}

function validateContainedPath(root, target, { allowMissing = true } = {}) {
  if (pathIsUnsafe(root) || pathIsUnsafe(target)) return { ok: false, code: "PATH_UNSAFE" };
  const rootInfo = canonicalExistingAncestor(root);
  const targetInfo = canonicalExistingAncestor(target);
  if (!rootInfo || !targetInfo) return { ok: false, code: "PATH_REALPATH_UNAVAILABLE" };
  if (containsReparseComponent(root) || containsReparseComponent(target)) {
    return { ok: false, code: "PATH_REPARSE_COMPONENT" };
  }
  const canonicalRoot = path.resolve(rootInfo.canonical);
  const canonicalTarget = path.resolve(targetInfo.canonical, ...targetInfo.tail);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside) {
    return { ok: false, code: "PATH_OUTSIDE_USER_DATA" };
  }
  if (!allowMissing && !fs.existsSync(target)) return { ok: false, code: "PATH_MISSING" };
  const relativeParts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < relativeParts.length; index += 1) {
    const componentPath = path.join(canonicalRoot, ...relativeParts.slice(0, index + 1));
    try {
      if (fs.lstatSync(componentPath).isSymbolicLink()) return { ok: false, code: "PATH_REPARSE_COMPONENT" };
    } catch {
      if (!allowMissing) return { ok: false, code: "PATH_COMPONENT_UNAVAILABLE" };
    }
  }
  return { ok: true, root: canonicalRoot, target: canonicalTarget };
}

function result(ok, code) {
  return Object.freeze({ ok: ok === true, code: String(code) });
}

function createContainedDirectory(root, target) {
  const rootValidation = validateContainedPath(root, root, { allowMissing: false });
  if (!rootValidation.ok) return rootValidation;
  const resolvedRoot = rootValidation.root;
  const resolvedTarget = path.resolve(target);
  if (pathIsUnsafe(resolvedTarget)) return result(false, "PATH_UNSAFE");
  const relative = path.relative(resolvedRoot, resolvedTarget);
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside) return result(false, "PATH_OUTSIDE_USER_DATA");
  let current = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, component);
    const before = validateContainedPath(resolvedRoot, next);
    if (!before.ok) return before;
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return result(false, "PATH_REPARSE_COMPONENT");
    } else {
      try { fs.mkdirSync(next); } catch { return result(false, "DIRECTORY_CREATE_FAILED"); }
      const after = validateContainedPath(resolvedRoot, next, { allowMissing: false });
      if (!after.ok) {
        try { fs.rmdirSync(next); } catch { /* Remove only the just-created empty component. */ }
        return after;
      }
    }
    current = next;
  }
  return result(true, "DIRECTORY_READY");
}

function sanitizeDiagnosticStatus(status) {
  if (!status || typeof status !== "object") return null;
  return {
    schema: "mso.production-receipt-status.v1",
    runStatus: ["started", "write-ok", "write-failed", "flush-complete"].includes(status.runStatus)
      ? status.runStatus
      : "started",
    enabled: status.enabled === true,
    writeCount: Number.isInteger(status.writeCount) && status.writeCount >= 0 ? status.writeCount : 0,
    failedWriteCount: Number.isInteger(status.failedWriteCount) && status.failedWriteCount >= 0 ? status.failedWriteCount : 0,
    flushComplete: status.flushComplete === true,
  };
}

function writeAtomicJson(filePath, value, root = path.dirname(filePath)) {
  const containment = validateContainedPath(root, filePath);
  if (!containment.ok) return result(false, containment.code);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const temporaryContainment = validateContainedPath(root, temporaryPath);
  if (!temporaryContainment.ok) return result(false, temporaryContainment.code);
  let fd;
  let committed = false;
  try {
    try { fd = fs.openSync(temporaryPath, "wx", 0o600); } catch { return result(false, "ATOMIC_TEMP_CREATE_FAILED"); }
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const renameContainment = validateContainedPath(root, filePath);
    if (!renameContainment.ok) return result(false, renameContainment.code);
    try { fs.renameSync(temporaryPath, filePath); } catch { return result(false, "ATOMIC_RENAME_FAILED"); }
    committed = true;
  } finally {
    if (!committed) {
      try {
        if (fs.existsSync(temporaryPath) && !fs.lstatSync(temporaryPath).isSymbolicLink()) fs.unlinkSync(temporaryPath);
      } catch { /* Never remove another path when cleanup cannot be verified. */ }
    }
  }
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs may ignore POSIX mode bits. */ }
  return result(true, "ATOMIC_WRITE_COMPLETE");
}

function pruneQaReceiptRuns(root, {
  now = Date.now(),
  retentionMs = DEFAULT_QA_RECEIPT_RETENTION_MS,
  maxRuns = DEFAULT_QA_RECEIPT_MAX_RUNS,
} = {}) {
  const rootValidation = validateContainedPath(root, root, { allowMissing: false });
  if (!rootValidation.ok) return 0;
  const resolvedRoot = rootValidation.root;
  if (!fs.existsSync(resolvedRoot)) return 0;
  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => {
      const directory = path.join(resolvedRoot, entry.name);
      const validation = validateContainedPath(resolvedRoot, directory, { allowMissing: false });
      if (!validation.ok) return null;
      const stat = fs.lstatSync(directory);
      return { directory, mtimeMs: stat.mtimeMs };
    }).filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  let removed = 0;
  entries.forEach((entry, index) => {
    if (index < maxRuns && now - entry.mtimeMs <= retentionMs) return;
    const validation = validateContainedPath(resolvedRoot, entry.directory, { allowMissing: false });
    if (!validation.ok) return;
    fs.rmSync(entry.directory, { recursive: true, force: true });
    removed += 1;
  });
  return removed;
}

function createExclusiveJsonFile(root, directory, fileName, beforeOpen = null) {
  const filePath = path.join(directory, fileName);
  const directoryValidation = validateContainedPath(root, directory, { allowMissing: false });
  const fileValidation = validateContainedPath(root, filePath);
  if (!directoryValidation.ok || !fileValidation.ok) return { ok: false, code: directoryValidation.ok ? fileValidation.code : directoryValidation.code };
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink() || fs.existsSync(filePath)) {
    return { ok: false, code: "EXCLUSIVE_FILE_ALREADY_EXISTS" };
  }
  if (typeof beforeOpen === "function") beforeOpen(filePath);
  const finalValidation = validateContainedPath(root, filePath);
  if (!finalValidation.ok || fs.existsSync(filePath)) return { ok: false, code: finalValidation.ok ? "EXCLUSIVE_FILE_ALREADY_EXISTS" : finalValidation.code };
  try { return { ok: true, code: "EXCLUSIVE_FILE_READY", fd: fs.openSync(filePath, "wx", 0o600), filePath }; } catch {
    return { ok: false, code: "EXCLUSIVE_FILE_CREATE_FAILED" };
  }
}

function createQaReceiptWriter({ directory = null, root = DEFAULT_QA_RECEIPT_ROOT, fileName = DEFAULT_QA_RECEIPT_FILE, beforeExclusiveOpen = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = directory ? path.resolve(directory) : null;
  const containment = resolvedDirectory
    ? validateContainedPath(resolvedRoot, resolvedDirectory, { allowMissing: false })
    : { ok: false };
  const enabled = Boolean(
    containment.ok && resolvedDirectory &&
    resolvedDirectory !== resolvedRoot &&
    path.dirname(resolvedDirectory) === resolvedRoot &&
    RUN_ID_PATTERN.test(path.basename(resolvedDirectory)) &&
    fileName === DEFAULT_QA_RECEIPT_FILE &&
    fs.lstatSync(resolvedDirectory).isDirectory() &&
    !fs.lstatSync(resolvedDirectory).isSymbolicLink(),
  );
  let receiptFd = null;
  let statusFd = null;
  let exclusiveCode = "WRITER_DISABLED";
  if (enabled) {
    const receipt = createExclusiveJsonFile(resolvedRoot, resolvedDirectory, fileName, beforeExclusiveOpen);
    const status = receipt.ok ? createExclusiveJsonFile(resolvedRoot, resolvedDirectory, "diagnostic-status.json", beforeExclusiveOpen) : { ok: false, code: receipt.code };
    if (receipt.ok && status.ok) {
      receiptFd = receipt.fd;
      statusFd = status.fd;
      exclusiveCode = "EXCLUSIVE_FILES_READY";
    } else {
      if (receipt.ok) { try { fs.closeSync(receipt.fd); } catch { /* best effort */ } try { fs.unlinkSync(receipt.filePath); } catch { /* best effort */ } }
      if (status.ok) { try { fs.closeSync(status.fd); } catch { /* best effort */ } try { fs.unlinkSync(status.filePath); } catch { /* best effort */ } }
    }
  }
  const writerEnabled = enabled && receiptFd !== null && statusFd !== null;
  const filePath = writerEnabled ? path.join(resolvedDirectory, fileName) : null;
  return {
    enabled: writerEnabled,
    directory: writerEnabled ? resolvedDirectory : null,
    filePath,
    writeStatus(status) {
      if (!writerEnabled) return result(false, exclusiveCode);
      try {
        const containmentCheck = validateContainedPath(resolvedRoot, resolvedDirectory, { allowMissing: false });
        if (!containmentCheck.ok) return result(false, containmentCheck.code);
        const line = `${JSON.stringify(sanitizeDiagnosticStatus(status))}\n`;
        fs.ftruncateSync(statusFd, 0);
        fs.writeSync(statusFd, line, 0, Buffer.byteLength(line, "utf8"), 0, "utf8");
        fs.fsyncSync(statusFd);
        return result(true, "STATUS_WRITE_COMPLETE");
      } catch {
        return result(false, "STATUS_WRITE_FAILED");
      }
    },
    flush() {
      if (!writerEnabled) return result(false, exclusiveCode);
      try {
        fs.fsyncSync(receiptFd);
        return result(true, "FLUSH_COMPLETE");
      } catch {
        return result(false, "FLUSH_FAILED");
      }
    },
    write(receipt) {
      if (!writerEnabled) return result(false, exclusiveCode);
      try {
        const directoryValidation = validateContainedPath(resolvedRoot, resolvedDirectory, { allowMissing: false });
        const directoryStat = fs.lstatSync(resolvedDirectory);
        if (!directoryValidation.ok || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return result(false, "WRITE_PATH_REJECTED");
        if (fs.fstatSync(receiptFd).nlink > 1) return result(false, "RECEIPT_HARDLINK_REJECTED");
        const line = `${JSON.stringify(sanitizeReceipt(receipt))}\n`;
        const bytes = Buffer.byteLength(line, "utf8");
        if (fs.fstatSync(receiptFd).size + bytes > MAX_QA_RECEIPT_BYTES) return result(false, "RECEIPT_SIZE_LIMIT");
        fs.writeSync(receiptFd, line, null, "utf8");
        fs.fsyncSync(receiptFd);
        try { fs.fchmodSync(receiptFd, 0o600); } catch { /* Windows ACLs may ignore POSIX mode bits. */ }
        return result(true, "RECEIPT_WRITE_COMPLETE");
      } catch {
        return result(false, "RECEIPT_WRITE_FAILED");
      }
    },
  };
}

module.exports = {
  DEFAULT_QA_RECEIPT_FILE,
  DEFAULT_QA_RECEIPT_ROOT,
  DEFAULT_QA_RECEIPT_RETENTION_MS,
  DEFAULT_QA_RECEIPT_MAX_RUNS,
  MAX_QA_RECEIPT_BYTES,
  configuredQaReceiptDirectory,
  createQaReceiptWriter,
  createContainedDirectory,
  pruneQaReceiptRuns,
  sanitizeDiagnosticStatus,
  sanitizeReceipt,
  validateContainedPath,
  writeAtomicJson,
};
