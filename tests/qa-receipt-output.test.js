"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  configuredQaReceiptDirectory,
  createQaReceiptWriter,
  sanitizeReceipt,
} = require("../src/qa-receipt-output");

function receipt() {
  return {
    schema: "mso.production-receipt.v1",
    operation: "test",
    scope: { locale: "ja-jp", requestedAct: 13, requestedModes: ["ranked", "room", "casual"], profileIdPresent: true },
    events: [{ stage: "stats", status: "ok", rawPayload: "secret", httpStatus: 200, rowCount: 2 }],
    final: { status: "ready", reason: "OK" },
  };
}

test("QA receipt directory requires an explicit direct child run id", () => {
  const root = path.join(os.tmpdir(), "mso-qa-root");
  assert.equal(configuredQaReceiptDirectory({ root, argv: [], env: {} }), null);
  assert.equal(configuredQaReceiptDirectory({ root, argv: [`--qa-receipt-dir=${root}`], env: {} }), null);
  assert.equal(configuredQaReceiptDirectory({ root, argv: [`--qa-receipt-dir=${path.join(root, "run-01")}`], env: {} }), path.join(root, "run-01"));
  assert.equal(configuredQaReceiptDirectory({ root, argv: [`--qa-receipt-dir=${path.join(root, "..", "escape")}`], env: {} }), null);
});

test("QA receipt writer emits only bounded allowlisted JSONL and fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-qa-root-"));
  const directory = path.join(root, "run-01");
  fs.mkdirSync(directory);
  try {
    const writer = createQaReceiptWriter({ root, directory });
    assert.equal(writer.enabled, true);
    assert.equal(writer.write(receipt()), true);
    const parsed = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
    assert.deepEqual(parsed.scope.requestedModes, ["ranked", "casual"]);
    assert.equal(parsed.events[0].rawPayload, undefined);
    assert.equal(parsed.events[0].httpStatus, 200);
    assert.deepEqual(sanitizeReceipt(receipt()), parsed);
    assert.equal(createQaReceiptWriter({ root, directory, fileName: "other.json" }).enabled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("QA receipt preserves computed stats fields including decimal win rate", () => {
  const sanitized = sanitizeReceipt({
    schema: "mso.production-receipt.v1",
    events: [{
      stage: "stats.final",
      selectedMode: "all",
      sourceModes: "ranked,casual,battleHub",
      allBattleCount: 209,
      allWinCount: 103,
      allWinRate: 49.28,
      displayRowCount: 33,
      trueZero: false,
      partialMissingModes: "",
    }],
  });
  assert.deepEqual(sanitized.events[0], {
    stage: "stats.final",
    selectedMode: "all",
    sourceModes: "ranked,casual,battleHub",
    allBattleCount: 209,
    allWinCount: 103,
    allWinRate: 49.28,
    displayRowCount: 33,
    trueZero: false,
    partialMissingModes: "",
  });
});

test("serialized QA receipt preserves sanitized IPC Act boundary fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-qa-root-"));
  const directory = path.join(root, "run-ipc-scope");
  fs.mkdirSync(directory);
  try {
    const writer = createQaReceiptWriter({ root, directory });
    assert.equal(writer.write({
      schema: "mso.production-receipt.v1",
      operation: "opponent-context",
      events: [{
        stage: "context.ipc-scope",
        ipcSelectedAct: 0,
        ipcSelectedActSelector: "latest",
        ipcCurrentAct: 13,
        ipcActSelectionSource: "latest",
        ipcSelectedRecordAct: null,
        ipcSelectedRecordActPresent: false,
      }, {
        stage: "context.opponent-scope",
        profileScopeDigest: "a1b2c3d4",
        cacheScopeDigest: "e5f6a7b8",
        scopeSource: "selected-history-row",
      }, {
        stage: "context.round-summary",
        cutoffTimestamp: 1700000000,
        selfCandidateMinTimestamp: 1600000000,
        selfCandidateMaxTimestamp: 1690000000,
        selfBeforeCutoff: 20,
        selfAfterCutoff: 80,
        opponentCandidateMinTimestamp: 1600000000,
        opponentCandidateMaxTimestamp: 1690000000,
        opponentBeforeCutoff: 4,
        opponentAfterCutoff: 50,
      }],
      final: { status: "partial", reason: "ACT_SCOPE_MISMATCH" },
    }), true);
    const parsed = JSON.parse(fs.readFileSync(writer.filePath, "utf8"));
    assert.deepEqual(parsed.events[0], {
      stage: "context.ipc-scope",
      ipcSelectedAct: 0,
      ipcSelectedActSelector: "latest",
      ipcCurrentAct: 13,
      ipcActSelectionSource: "latest",
      ipcSelectedRecordActPresent: false,
    });
    assert.deepEqual(parsed.events[1], {
      stage: "context.opponent-scope",
      profileScopeDigest: "a1b2c3d4",
      cacheScopeDigest: "e5f6a7b8",
      scopeSource: "selected-history-row",
    });
    assert.equal(parsed.events[2].cutoffTimestamp, 1700000000);
    assert.equal(parsed.events[2].selfBeforeCutoff, 20);
    assert.equal(parsed.events[2].opponentBeforeCutoff, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
