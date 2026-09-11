"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRoundTrend,
  combineRoundTrends,
  annotateRoundTrendAcquisition,
  buildRoundTrendFailure,
  ROUND_RESULT_CODES,
  ROUND_TREND_MATCH_TYPES,
} = require("../src/round-results-summary");

function record({ replayId = null, matchType = null, actId = null, result = null, self = null, opponent = null, playedAt = 1, opponentUserCode = "2000", opponentCharacterId = 7 } = {}) {
  return {
    replayId,
    matchType,
    actId,
    result,
    playedAt,
    opponentUserCode,
    opponentCharacterId,
    roundResults: {
      self: self == null ? null : { values: self },
      opponent: opponent == null ? null : { values: opponent },
    },
  };
}

test("aggregates approved round symbols by each side's won-round denominator", () => {
  const result = buildRoundTrend([
    record({ self: [1, 2, 0], opponent: [3, 4, 0] }),
    record({ self: [1, 8], opponent: [5, 6], playedAt: 2 }),
  ], { opponentUserCode: "2000", characterId: 7 });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.codes, ROUND_RESULT_CODES);
  assert.equal(result.matchCount, 2);
  assert.equal(result.matchedMatches, 2);
  assert.equal(result.self.matches, 2);
  assert.equal(result.self.wonRounds, 4);
  assert.equal(result.self.codes[0].count, 2);
  assert.equal(result.self.codes[0].percentage, 50);
  assert.equal(result.opponent.wonRounds, 4);
  assert.equal(result.opponent.codes[2].count, 1);
});

test("unknown, empty, and missing values never become zero or READY", () => {
  const result = buildRoundTrend([
    record({ self: [1, 9, 0], opponent: [2, 0] }),
    record({ self: [], opponent: [] , playedAt: 2 }),
    record({ self: null, opponent: [1], playedAt: 3 }),
  ], { opponentUserCode: "2000", characterId: 7 });
  assert.equal(result.status, "partial");
  assert.equal(result.self.wonRounds, 1);
  assert.equal(result.opponent.wonRounds, 2);
  assert.equal(result.self.codes[0].count, 1);
  assert.equal(result.opponent.codes[1].percentage, 50);
});

test("filters the selected opponent and character without exposing identifiers", () => {
  const result = buildRoundTrend([
    record({ self: [1], opponent: [2], opponentUserCode: "other", opponentCharacterId: 8 }),
    record({ self: [1], opponent: [2], playedAt: 2 }),
  ], { opponentUserCode: "2000", characterId: 7 });
  assert.equal(result.matchCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "opponentUserCode"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "characterId"), false);
});

test("uses only earlier opponent history before the selected match and caps at twenty", () => {
  const records = Array.from({ length: 24 }, (_, index) => record({
    playedAt: index + 1,
    self: [1],
    opponent: [2],
  }));
  const result = buildRoundTrend(records, {
    opponentUserCode: "2000",
    characterId: 7,
    beforeTimestamp: 23,
    limit: 20,
  });
  assert.equal(result.matchCount, 20);
  assert.equal(result.matchedMatches, 20);
  assert.equal(result.period.from, "1970-01-01");
  assert.equal(result.period.to, "1970-01-01");
});

test("retains every approved round code on both sides and excludes zero or missing values", () => {
  const result = buildRoundTrend([
    record({ self: [1, 2, 3, 4, 5, 6, 7, 8, 0], opponent: [8, 7, 6, 5, 4, 3, 2, 1, 0] }),
    record({ self: null, opponent: null, playedAt: 2 }),
  ]);
  assert.deepEqual(result.codes, ["V", "C", "T", "D", "OD", "SA", "CA", "P"]);
  assert.equal(result.self.wonRounds, 8);
  assert.equal(result.opponent.wonRounds, 8);
  for (const side of [result.self, result.opponent]) {
    assert.deepEqual(side.codes.map((item) => item.count), [1, 1, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(side.codes.map((item) => item.percentage), Array(8).fill(12.5));
  }
  assert.equal(result.self.unknownRounds, 0);
  assert.equal(result.opponent.unknownRounds, 0);
});

test("combines both sides from the same approved modes without self-side opponent filtering", () => {
  const selfTrend = buildRoundTrend([
    record({ self: [1], opponent: [2], playedAt: 10 }),
  ], { opponentUserCode: "2000", characterId: 7, beforeTimestamp: 20, limit: 20 });
  const opponentTrend = buildRoundTrend([
    record({ self: [3], opponent: [4], playedAt: 1, opponentUserCode: "9999", opponentCharacterId: 99 }),
    record({ self: [5], opponent: [6], playedAt: 2, opponentUserCode: "8888", opponentCharacterId: 88 }),
  ], { beforeTimestamp: 20, limit: 20 });
  const result = combineRoundTrends(selfTrend, opponentTrend, { limit: 20 });
  assert.equal(result.self.matches, 1);
  assert.equal(result.opponent.matches, 2);
  assert.equal(result.opponent.wonRounds, 2);
  assert.equal(result.opponent.codes[2].count, 1);
  assert.equal(result.opponent.codes[4].count, 1);
});

test("uses at most twenty earlier matches per side and excludes other modes and the selected row", () => {
  const ownerRecords = Array.from({ length: 23 }, (_, index) => record({
    replayId: `owner-${index}`,
    playedAt: index + 1,
    self: [1],
    opponent: [2],
    opponentUserCode: index === 0 ? "selected-opponent" : "other-opponent",
    opponentCharacterId: index === 0 ? 7 : 8,
    matchType: index === 1 ? "room" : "ranked",
    actId: 13,
  }));
  const trend = buildRoundTrend(ownerRecords, {
    beforeTimestamp: 23,
    limit: 20,
    matchTypes: ROUND_TREND_MATCH_TYPES,
    actId: 13,
  });

  assert.equal(trend.matchCount, 20);
  assert.equal(trend.self.matches, 20);
  assert.equal(trend.opponent.matches, 20);
  assert.equal(trend.self.wonRounds, 20);
  assert.equal(trend.opponent.wonRounds, 20);
  assert.equal(trend.period.to, "1970-01-01");
});

test("marks missing rounds, timestamp, Act, and mode metadata as partial instead of silently reporting READY", () => {
  const trend = buildRoundTrend([
    record({ replayId: "valid", matchType: "ranked", actId: 13, playedAt: 1, self: [1], opponent: [2] }),
    record({ replayId: "missing-rounds", matchType: "ranked", actId: 13, playedAt: 2 }),
    record({ replayId: "missing-time", matchType: "ranked", actId: 13, playedAt: 0, self: [1], opponent: [2] }),
    record({ replayId: "wrong-act", matchType: "ranked", actId: 12, playedAt: 3, self: [1], opponent: [2] }),
    record({ replayId: "wrong-mode", matchType: "room", actId: 13, playedAt: 4, self: [1], opponent: [2] }),
    { matchType: "ranked", actId: 13, playedAt: 5, result: "unknown", roundResults: { self: { values: [1] }, opponent: { values: [2] } } },
  ], {
    beforeTimestamp: 10,
    actId: 13,
    matchTypes: ROUND_TREND_MATCH_TYPES,
  });

  assert.equal(trend.status, "partial");
  assert.equal(trend.matchCount, 1);
  assert.equal(trend.missingRoundMatches, 1);
  assert.equal(trend.missingTimestampMatches, 1);
  assert.equal(trend.actMismatchMatches, 1);
  assert.equal(trend.modeMismatchMatches, 1);
  assert.equal(trend.missingReplayIdMatches, 1);
  assert.equal(trend.unknownResultMatches, 1);
  assert.equal(trend.self.matches, 1);
  assert.equal(trend.opponent.matches, 1);
});

test("keeps the displayed sample counts honest for 20/20, 2/20, 20/3, and zero samples", () => {
  const trendFor = (count, prefix) => buildRoundTrend(
    Array.from({ length: count }, (_, index) => record({
      replayId: `${prefix}-${index}`,
      matchType: "ranked",
      actId: 13,
      playedAt: index + 1,
      self: [1],
      opponent: [2],
    })),
    { beforeTimestamp: 100, actId: 13, matchTypes: ROUND_TREND_MATCH_TYPES, limit: 20 },
  );
  for (const [selfCount, opponentCount] of [[20, 20], [2, 20], [20, 3], [0, 0]]) {
    const result = combineRoundTrends(
      trendFor(selfCount, `self-${selfCount}`),
      trendFor(opponentCount, `opponent-${opponentCount}`),
      { limit: 20 },
    );
    assert.equal(result.self.matches, selfCount);
    assert.equal(result.opponent.matches, opponentCount);
  }
});

test("never restores READY when either combined side carries an incomplete trend", () => {
  const valid = buildRoundTrend([
    record({ replayId: "valid", matchType: "ranked", actId: 13, playedAt: 1, self: [1], opponent: [2] }),
  ], { beforeTimestamp: 10, actId: 13, matchTypes: ROUND_TREND_MATCH_TYPES });
  const incompleteRecords = [
    record({ replayId: "missing-rounds", matchType: "ranked", actId: 13, playedAt: 1 }),
    record({ replayId: "missing-time", matchType: "ranked", actId: 13, playedAt: 0, self: [1], opponent: [2] }),
    record({ replayId: "wrong-act", matchType: "ranked", actId: 12, playedAt: 1, self: [1], opponent: [2] }),
    record({ replayId: "wrong-mode", matchType: "room", actId: 13, playedAt: 1, self: [1], opponent: [2] }),
    record({ replayId: "unknown-result", matchType: "ranked", actId: 13, playedAt: 1, result: "unknown", self: [1], opponent: [2] }),
    { matchType: "ranked", actId: 13, playedAt: 1, roundResults: { self: { values: [1] }, opponent: { values: [2] } } },
  ];
  for (const [index, item] of incompleteRecords.entries()) {
    const incomplete = buildRoundTrend([item], {
      beforeTimestamp: 10,
      actId: 13,
      matchTypes: ROUND_TREND_MATCH_TYPES,
    });
    const combined = combineRoundTrends(incomplete, valid, { limit: 20 });
    assert.notEqual(combined.status, "ready", `case ${index} must not be READY`);
    assert.equal(combined.sourceStatuses[0], incomplete.status);
    assert.ok(combined.diagnostics.self);
  }
});

test("propagates duplicate conflicts and rejects a combined scope mismatch", () => {
  const duplicateConflict = buildRoundTrend([
    record({ replayId: "conflict", matchType: "ranked", actId: 13, playedAt: 1, self: [1], opponent: [2] }),
    record({ replayId: "conflict", matchType: "ranked", actId: 13, playedAt: 2, self: [3], opponent: [2] }),
  ], { beforeTimestamp: 10, actId: 13, matchTypes: ROUND_TREND_MATCH_TYPES });
  const valid = buildRoundTrend([
    record({ replayId: "valid", matchType: "ranked", actId: 13, playedAt: 1, self: [1], opponent: [2] }),
  ], { beforeTimestamp: 10, actId: 13, matchTypes: ROUND_TREND_MATCH_TYPES });
  const otherAct = buildRoundTrend([
    record({ replayId: "other-act", matchType: "ranked", actId: 12, playedAt: 1, self: [1], opponent: [2] }),
  ], { beforeTimestamp: 10, actId: 12, matchTypes: ROUND_TREND_MATCH_TYPES });

  assert.equal(duplicateConflict.status, "partial");
  assert.equal(duplicateConflict.duplicateConflictCount, 1);
  assert.equal(combineRoundTrends(valid, otherAct).status, "partial");
  assert.equal(combineRoundTrends(valid, otherAct).diagnostics.scopeMismatch, true);
});

test("deduplicates replay ids before counting selected-history rounds", () => {
  const records = [1, 2, 3].map((playedAt) => ({
    replayId: "DUPLICATE-REPLAY",
    playedAt,
    roundResults: { self: { values: [1] }, opponent: { values: [0] } },
  }));
  const trend = buildRoundTrend(records, { limit: 20 });
  assert.equal(trend.matchCount, 1);
  assert.equal(trend.self.wonRounds, 1);
});

test("distinguishes a complete zero sample from scope or retrieval failure", () => {
  const scope = { beforeTimestamp: 100, limit: 20, matchTypes: ROUND_TREND_MATCH_TYPES, actId: 13 };
  const completeZero = annotateRoundTrendAcquisition(buildRoundTrend([], scope), { complete: true });
  const scopeFailure = buildRoundTrendFailure(scope, { reason: "ACT_SCOPE_MISSING" });
  const retrievalFailure = buildRoundTrendFailure(scope, { status: "error", reason: "RETRIEVAL_FAILED" });
  assert.equal(completeZero.status, "insufficient_sample");
  assert.equal(completeZero.zeroIsUnknown, false);
  assert.equal(scopeFailure.status, "partial");
  assert.equal(scopeFailure.zeroIsUnknown, true);
  assert.equal(retrievalFailure.status, "error");
  assert.equal(retrievalFailure.zeroIsUnknown, true);
  assert.equal(combineRoundTrends(completeZero, completeZero).status, "insufficient_sample");
  assert.equal(combineRoundTrends(scopeFailure, retrievalFailure).zeroIsUnknown, true);
});
