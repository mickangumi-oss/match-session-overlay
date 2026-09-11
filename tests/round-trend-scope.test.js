"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeRequestedActId,
  verifyScopedHistoryPage,
  stampScopedHistoryRecords,
  buildScopedRoundTrendContext,
} = require("../src/round-trend-scope");

function page(overrides = {}) {
  return {
    rawCount: 1,
    normalizedCount: 1,
    hasReplayList: true,
    totalPages: 2,
    responsePage: 1,
    responseActId: 13,
    replays: [{ replayId: "A", actId: null }],
    ...overrides,
  };
}

test("requires a numeric positive Act from the renderer", () => {
  assert.deepEqual(normalizeRequestedActId(null), {
    ok: false,
    reason: "ACT_SCOPE_MISSING",
    actId: null,
  });
  assert.equal(normalizeRequestedActId("13").reason, "ACT_SCOPE_INVALID");
  assert.equal(normalizeRequestedActId(13).ok, true);
  assert.deepEqual(normalizeRequestedActId(0), { ok: true, reason: null, actId: 0 });
});

test("accepts official Act 0 as an explicit historical scope", () => {
  const result = verifyScopedHistoryPage({
    pageResult: page({ responseActId: 0, replays: [{ replayId: "A", actId: 0 }] }),
    page: 1,
    requestedActId: 0,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(stampScopedHistoryRecords([{ replayId: "A", actId: null }], 0).records, [
    { replayId: "A", actId: 0, actIdKnown: true },
  ]);
});

test("accepts response-level Act proof and stamps records missing per-replay Act", () => {
  const result = verifyScopedHistoryPage({
    pageResult: page(),
    page: 1,
    requestedActId: 13,
  });
  assert.equal(result.ok, true);
  const stamped = stampScopedHistoryRecords(page().replays, 13);
  assert.deepEqual(stamped.records.map((record) => record.actId), [13]);
});

test("accepts record-level proof when every replay has the requested Act", () => {
  const result = verifyScopedHistoryPage({
    pageResult: page({ responseActId: null, replays: [{ replayId: "A", actId: 13 }] }),
    page: 1,
    requestedActId: 13,
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "records");
});

test("accepts verified current-Act request proof when the battlelog omits Act metadata", () => {
  const result = verifyScopedHistoryPage({
    pageResult: page({ responseActId: null, replays: [{ replayId: "A", actId: null }] }),
    page: 1,
    requestedActId: 13,
    requestScopeVerified: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "verified-request");
});

test("accepts Act-independent battlelog pages and keeps Act metadata diagnostic-only", () => {
  const result = verifyScopedHistoryPage({
    pageResult: page({ responseActId: 0, replays: [{ replayId: "A", actId: 0 }] }),
    page: 1,
    requestedActId: null,
    actIndependent: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestedActId, null);
  assert.equal(result.source, "act-independent");
});

test("rejects missing, mismatched, and conflicting scope evidence", () => {
  assert.equal(verifyScopedHistoryPage({
    pageResult: page({ responseActId: null, replays: [{ replayId: "A", actId: null }] }),
    page: 1,
    requestedActId: 13,
  }).reason, "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH");
  assert.equal(verifyScopedHistoryPage({
    pageResult: page({ responseActId: 12 }),
    page: 1,
    requestedActId: 13,
  }).reason, "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH");
  assert.equal(verifyScopedHistoryPage({
    pageResult: page({ replays: [{ replayId: "A", actId: 13 }, { replayId: "B", actId: 12 }] }),
    page: 1,
    requestedActId: 13,
  }).reason, "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH");
});

test("requires response proof for a genuinely empty scoped page", () => {
  assert.equal(verifyScopedHistoryPage({
    pageResult: page({ rawCount: 0, normalizedCount: 0, responseActId: 13, replays: [] }),
    page: 1,
    requestedActId: 13,
  }).ok, true);
  assert.equal(verifyScopedHistoryPage({
    pageResult: page({ rawCount: 0, normalizedCount: 0, responseActId: null, replays: [] }),
    page: 1,
    requestedActId: 13,
  }).ok, false);
});

test("production trend context backfills a legacy selected row only from scoped sources", () => {
  const selectedRecord = { replayId: "selected", playedAt: 100, actId: null };
  const scopedSelectedRecord = { ...selectedRecord, actId: 13 };
  const prior = (replayId, playedAt, selfCode, opponentCode, matchType = "ranked") => ({
    replayId,
    playedAt,
    actId: 13,
    matchType,
    result: "win",
    roundResults: { self: { values: [selfCode] }, opponent: { values: [opponentCode] } },
  });
  const result = buildScopedRoundTrendContext({
    selectedRecord,
    selectedActId: 13,
    ownerRecords: [scopedSelectedRecord, prior("owner-1", 99, 1, 0), prior("owner-future", 101, 2, 0)],
    opponentRecords: [scopedSelectedRecord, prior("opponent-1", 98, 3, 0)],
    ownerComplete: true,
    opponentComplete: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.selectedRecord.actId, 13);
  assert.equal(result.roundTrend.self.matches, 1);
  assert.equal(result.roundTrend.opponent.matches, 1);
  assert.equal(result.roundTrend.status, "ready");
});

test("Act-independent round trend does not reject a legacy selected-row Act", () => {
  const result = buildScopedRoundTrendContext({
    selectedRecord: { replayId: "selected", playedAt: 100, actId: 0 },
    selectedActId: null,
    actIndependent: true,
    ownerRecords: [{
      replayId: "owner",
      playedAt: 99,
      matchType: "ranked",
      actId: 0,
      roundResults: { self: { values: [1] }, opponent: { values: [0] } },
    }],
    opponentRecords: [{
      replayId: "opponent",
      playedAt: 98,
      matchType: "casual",
      actId: 13,
      roundResults: { self: { values: [0] }, opponent: { values: [1] } },
    }],
    ownerComplete: true,
    opponentComplete: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.selectedActId, null);
  assert.equal(result.roundTrend.scope.actId, null);
});

test("round trend exposes cutoff and exclusion counters without an Act gate", () => {
  const valid = (replayId, playedAt) => ({
    replayId,
    playedAt,
    matchType: "ranked",
    roundResults: { self: { values: [1] }, opponent: { values: [0] } },
  });
  const result = buildScopedRoundTrendContext({
    selectedRecord: { replayId: "selected", playedAt: 100, actId: 0 },
    selectedActId: null,
    actIndependent: true,
    ownerRecords: [
      valid("a", 99),
      valid("a", 99),
      valid("future", 101),
      { replayId: "room", playedAt: 97, matchType: "room", roundResults: { self: { values: [1] } } },
      { replayId: "missing-round", playedAt: 96, matchType: "casual" },
      valid("b", 95),
    ],
    opponentRecords: [],
    ownerComplete: true,
    opponentComplete: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.roundTrend.futureExcludedCount, 1);
  assert.equal(result.roundTrend.roomExcludedCount, 1);
  assert.equal(result.roundTrend.duplicateExactCount, 1);
  assert.equal(result.roundTrend.missingRoundMatches, 1);
  assert.equal(result.roundTrend.scope.actId, null);
});

test("production trend context keeps missing Act and retrieval failure distinct from true zero", () => {
  const selectedRecord = { replayId: "selected", playedAt: 100, actId: null };
  const missing = buildScopedRoundTrendContext({ selectedRecord });
  assert.equal(missing.reason, "ACT_SCOPE_MISSING");
  assert.equal(missing.roundTrend.zeroIsUnknown, true);
  const failure = buildScopedRoundTrendContext({
    selectedRecord,
    selectedActId: 13,
    ownerComplete: false,
    opponentComplete: false,
  });
  assert.equal(failure.ok, true);
  assert.equal(failure.roundTrend.zeroIsUnknown, true);
  const zero = buildScopedRoundTrendContext({
    selectedRecord,
    selectedActId: 13,
    ownerComplete: true,
    opponentComplete: true,
  });
  assert.equal(zero.roundTrend.status, "insufficient_sample");
  assert.equal(zero.roundTrend.zeroIsUnknown, false);
});
