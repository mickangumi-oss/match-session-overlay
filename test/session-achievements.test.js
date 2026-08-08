"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSessionAchievementState,
  updateSessionAchievements,
} = require("../src/session-achievements");

function update(previous, overrides = {}) {
  return updateSessionAchievements(previous, {
    profileId: "synthetic-profile-a",
    characterId: 26,
    ratingType: "MR",
    currentRating: 1500,
    homeKey: "region:asia",
    currentRank: 416,
    ...overrides,
  });
}

test("session peak retains the highest official profile rating until reset", () => {
  const first = update(createSessionAchievementState());
  const peak = update(first.state, { currentRating: 1612, currentRank: 300 });
  const dropped = update(peak.state, { currentRating: 1540, currentRank: 350 });
  assert.equal(dropped.sessionPeakRating, 1612);
  assert.equal(dropped.rankDelta, 66);

  const reset = update(createSessionAchievementState(), {
    currentRating: 1540,
    currentRank: 350,
  });
  assert.equal(reset.sessionPeakRating, 1540);
  assert.equal(reset.rankDelta, 0);
});

test("ranking delta follows lower-is-better rank movement", () => {
  const first = update(createSessionAchievementState());
  assert.equal(first.rankDelta, 0);
  assert.equal(update(first.state, { currentRank: 130 }).rankDelta, 286);
  assert.equal(update(first.state, { currentRank: 536 }).rankDelta, -120);
});

test("player character rating type and HOME isolate incomparable values", () => {
  const first = update(createSessionAchievementState(), {
    currentRating: 10_000_000,
    ratingType: "LP",
    currentRank: null,
  });
  assert.equal(first.sessionPeakRating, 10_000_000);
  assert.equal(first.rankDelta, null);

  const playerChanged = update(first.state, {
    profileId: "synthetic-profile-b",
    currentRating: 1400,
    currentRank: 900,
  });
  assert.equal(playerChanged.sessionPeakRating, 1400);
  assert.equal(playerChanged.rankDelta, 0);

  const homeChanged = update(playerChanged.state, {
    profileId: "synthetic-profile-b",
    homeKey: "all",
    currentRank: 1200,
  });
  assert.equal(homeChanged.rankDelta, 0);

  const characterChanged = update(homeChanged.state, {
    profileId: "synthetic-profile-b",
    characterId: 1,
    currentRating: 1300,
    currentRank: 2000,
  });
  assert.equal(characterChanged.sessionPeakRating, 1300);
  assert.equal(characterChanged.rankDelta, 0);
});

test("a cached loading rank never becomes a new HOME baseline", () => {
  const first = update(createSessionAchievementState());
  const loading = update(first.state, {
    homeKey: "all",
    currentRank: 999,
    rankingReady: false,
  });
  assert.equal(loading.initialRank, null);
  assert.equal(loading.rankDelta, null);
  const ready = update(loading.state, {
    homeKey: "all",
    currentRank: 1200,
    rankingReady: true,
  });
  assert.equal(ready.initialRank, 1200);
  assert.equal(ready.rankDelta, 0);
});

test("read-only history achievements cannot overwrite the live session", () => {
  const liveStart = update(createSessionAchievementState());
  const livePeak = update(liveStart.state, {
    currentRating: 1612,
    currentRank: 130,
  });
  const history = update(createSessionAchievementState(), {
    profileId: "synthetic-history-profile",
    characterId: 1,
    currentRating: 1900,
    currentRank: 50,
  });
  assert.equal(history.sessionPeakRating, 1900);

  const liveAfterHistory = update(livePeak.state, {
    currentRating: 1540,
    currentRank: 150,
  });
  assert.equal(liveAfterHistory.sessionPeakRating, 1612);
  assert.equal(liveAfterHistory.initialRank, 416);
  assert.equal(liveAfterHistory.rankDelta, 266);
});
