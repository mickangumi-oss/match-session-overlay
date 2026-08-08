"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPresentationState } = require("../src/presentation-model");

test("all presentation surfaces receive the same synthetic values", () => {
  const input = {
    sourceState: {
      currentRating: 1527,
      ratingType: "MR",
      stats: {
        ranked: { wins: 7, losses: 5, ratingDelta: 27 },
      },
    },
    player: { name: "SYNTHETIC PLAYER", characterId: 26, characterDisplayName: "AKUMA", mr: 1527 },
    matchType: "ranked",
    median: {
      medianRating: 1526,
      medianRatingType: "MR",
      medianRatingSampleCount: 12,
    },
    achievements: {
      sessionPeakRating: 1560,
      sessionPeakRatingType: "MR",
      rankDelta: 286,
    },
  };
  const management = buildPresentationState(input);
  const windowView = buildPresentationState(input);
  const overlay = buildPresentationState(input);
  assert.deepEqual(management, windowView);
  assert.deepEqual(management, overlay);
  assert.equal(management.currentCharacter, "AKUMA");
  assert.equal(management.playerName, "SYNTHETIC PLAYER");
  assert.equal(management.sessionPeakRating, 1560);
  assert.equal(management.mrRankDelta, 286);
  assert.equal(management.winRate.toFixed(1), "58.3");
});

test("changing match type builds a fresh mode-specific presentation", () => {
  const sourceState = {
    stats: {
      ranked: { wins: 7, losses: 5, ratingDelta: 27 },
      battleHub: { wins: 2, losses: 6, ratingDelta: 0 },
    },
  };
  const ranked = buildPresentationState({ sourceState, matchType: "ranked" });
  const battleHub = buildPresentationState({
    sourceState,
    matchType: "battleHub",
  });
  assert.deepEqual(
    { wins: ranked.wins, losses: ranked.losses, delta: ranked.ratingDelta },
    { wins: 7, losses: 5, delta: 27 },
  );
  assert.deepEqual(
    {
      wins: battleHub.wins,
      losses: battleHub.losses,
      delta: battleHub.ratingDelta,
    },
    { wins: 2, losses: 6, delta: null },
  );
});
