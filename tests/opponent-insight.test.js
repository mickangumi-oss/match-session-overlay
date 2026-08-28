const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOpponentOfficialInsight,
  buildHistoricalOpponentSnapshots,
  mergeSnapshotObject,
  normalizeSnapshot,
  selectOtherCharacterPeakMr,
} = require("../src/opponent-insight");
const { potentialRatingValue } = require("../src/potential-rating");

test("limits selected-character official history and preserves W/L/D", () => {
  const records = Array.from({ length: 25 }, (_, i) => ({
    characterId: 7,
    matchType: "ranked",
    result: i % 3 === 0 ? "win" : i % 3 === 1 ? "loss" : "draw",
    playedAt: i,
    ownMr: 1400 + i,
    ownRatingType: "MR",
  }));
  const out = buildOpponentOfficialInsight({
    records,
    characterId: 7,
    deriveHistoryRatingSeries: (selected) => ({
      values: selected.map((item) => item.ownMr),
    }),
    potentialRatingValue,
  });
  assert.equal(out.matches, 20);
  assert.equal(out.wins + out.losses + out.draws, 20);
  assert.equal(out.ratings.MR.values.length, 20);
});

test("uses injected terminal value and selects other-character peak MR", () => {
  const out = buildOpponentOfficialInsight({
    records: [{ characterId: 7, matchType: "ranked", result: "win", ownMr: 1400 }],
    characterId: 7,
    player: {},
    deriveHistoryRatingSeries: () => ({
      values: [1400, 1500],
      currentValue: 1510,
      currentApplied: true,
    }),
    potentialRatingValue,
  });
  assert.equal(out.ratings.MR.currentValue, 1510);
  assert.equal(out.ratings.MR.potential, 1450);
  assert.deepEqual(
    selectOtherCharacterPeakMr(
      [
        { characterId: 7, peakMr: 3000 },
        { characterId: 8, characterDisplayName: "Ryu", peakMr: 2200 },
        { characterId: 9, characterName: "Ken", peakMr: 2300 },
      ],
      7,
    ),
    { characterId: 9, characterDisplayName: "Ken", peakMr: 2300 },
  );
});

test("historical snapshots use exact cutoff, exclude selected/later rows, and keep MR/LP separate", () => {
  const records = [
    { replayId: "before-1", matchType: "ranked", characterId: 7, playedAt: 100, result: "win", ownMr: 1400, ownLp: 100 },
    { replayId: "before-2", matchType: "ranked", characterId: 7, playedAt: 200, result: "draw", ownMr: 1410, ownLp: 110 },
    { replayId: "other-character", matchType: "ranked", characterId: 8, playedAt: 250, result: "loss", ownMr: 3000, ownLp: 999 },
    { replayId: "cutoff", matchType: "ranked", characterId: 7, playedAt: 300, result: "loss", ownMr: 1500, ownLp: 120 },
    { replayId: "same-time", matchType: "ranked", characterId: 7, playedAt: 300, result: "win", ownMr: 9999, ownLp: 9999 },
    { replayId: "after", matchType: "ranked", characterId: 7, playedAt: 400, result: "win", ownMr: 9999, ownLp: 9999 },
  ];
  const selectedRecord = {
    replayId: "cutoff",
    opponentCharacterId: 7,
    opponentRatingType: "MR",
    opponentMr: 1500,
    opponentLp: 120,
  };
  const snapshots = buildHistoricalOpponentSnapshots({
    records,
    selectedRecord,
    historyOwnerProfileId: "1111",
    opponentUserCode: "2222",
    characterId: 7,
    potentialRatingValue,
  });
  assert.equal(snapshots.MR.status, "ready");
  assert.equal(snapshots.MR.wins, 1);
  assert.equal(snapshots.MR.losses, 0);
  assert.equal(snapshots.MR.draws, 1);
  assert.equal(snapshots.MR.sampleCount, 2);
  assert.equal(snapshots.MR.matchTimeRating, 1500);
  assert.equal(snapshots.LP.status, "ready");
  assert.equal(snapshots.LP.matchTimeRating, 120);
  assert.equal(snapshots.LP.sampleCount, 2);
  assert.equal(snapshots.MR.cutoffReplayId, "cutoff");
  assert.equal(snapshots.MR.historyOwnerProfileId, "1111");
});

test("missing cutoff or samples stays insufficient and snapshot normalization drops unknown keys", () => {
  const missing = buildHistoricalOpponentSnapshots({
    records: [],
    selectedRecord: { replayId: "missing", opponentCharacterId: 7 },
    historyOwnerProfileId: "1111",
    opponentUserCode: "2222",
    characterId: 7,
    potentialRatingValue,
  });
  assert.equal(missing.MR.status, "insufficient");
  assert.equal(missing.MR.potential, null);
  const normalized = normalizeSnapshot({
    status: "ready",
    ratingType: "MR",
    matchTimeRating: 1400,
    potential: 1390,
    complete: true,
    unknown: "must not persist",
  });
  assert.equal(normalized.unknown, undefined);
  assert.equal(normalized.ratingType, "MR");
});

test("completed snapshots survive reload normalization and are not overwritten", () => {
  const ready = {
    status: "ready",
    algorithmVersion: "historical-before-match-v1",
    cutoffReplayId: "r1",
    cutoffPlayedAt: 100,
    historyOwnerProfileId: "1111",
    opponentUserCode: "2222",
    characterId: 7,
    ratingType: "MR",
    matchTimeRating: 1500,
    sampleCount: 20,
    wins: 10,
    losses: 8,
    draws: 2,
    potential: 1490,
    capturedAt: 200,
    complete: true,
    reason: null,
  };
  const replaced = mergeSnapshotObject({ MR: ready }, {
    MR: { ...ready, potential: 1900, capturedAt: 300 },
    LP: { ...ready, ratingType: "LP", matchTimeRating: 100, potential: 101 },
  });
  assert.equal(replaced.MR.potential, 1490);
  assert.equal(replaced.LP.ratingType, "LP");
});

test("LP historical ratings accept cumulative values above 10,000 while MR remains bounded", () => {
  const snapshots = buildHistoricalOpponentSnapshots({
    records: [
      { replayId: "lp-before", matchType: "ranked", characterId: 7, playedAt: 100, result: "win", ownLp: 119000 },
      { replayId: "mr-before", matchType: "ranked", characterId: 7, playedAt: 200, result: "loss", ownMr: 1800 },
      { replayId: "cutoff", matchType: "ranked", characterId: 7, playedAt: 300, result: "draw" },
    ],
    selectedRecord: {
      replayId: "cutoff",
      opponentCharacterId: 7,
      opponentRatingType: "LP",
      opponentLp: 120000,
    },
    historyOwnerProfileId: "1111",
    opponentUserCode: "2222",
    characterId: 7,
    potentialRatingValue,
  });
  assert.equal(snapshots.LP.status, "ready");
  assert.equal(snapshots.LP.matchTimeRating, 120000);
  assert.equal(snapshots.LP.potential, 119500);
  assert.equal(snapshots.MR.status, "insufficient");
});
