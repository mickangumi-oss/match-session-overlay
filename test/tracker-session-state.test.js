"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildTrackerSessionPayload,
  restoreTrackerSession,
} = require("../src/tracker-session-state");
const { createEmptyMatchStats } = require("../src/source-client");
const { createSessionAchievementState } = require("../src/session-achievements");

function emptyTrackerState() {
  return {
    active: false,
    player: null,
    wins: 0,
    losses: 0,
    streak: 0,
    initialRating: null,
    currentRating: null,
    ratingType: "MR",
    characterId: null,
    characterStates: {},
    ratingDelta: 0,
    lastMatch: null,
    startedAt: null,
    updatedAt: null,
    lastNewMatchAt: null,
    nextPollAt: null,
    effectivePollIntervalSeconds: null,
    consecutiveFailures: 0,
    stopReason: null,
    seenReplayIds: [],
    stats: createEmptyMatchStats(),
    status: "停止中",
    overlayUrl: "http://127.0.0.1:38291/overlay",
  };
}

test("a synthetic previous session restores its score and graph without resuming network work", () => {
  const tracker = emptyTrackerState();
  tracker.active = true;
  tracker.player = { profileId: "SYNTHETIC-CODE", userCode: "SYNTHETIC-CODE", name: "SYNTHETIC PLAYER" };
  tracker.startedAt = 1_700_000_000_000;
  tracker.wins = 3;
  tracker.losses = 2;
  tracker.currentRating = 1422;
  tracker.initialRating = 1400;
  tracker.ratingDelta = 22;
  tracker.seenReplayIds = ["synthetic-replay-1", "synthetic-replay-2"];
  tracker.stats.ranked = {
    ...tracker.stats.ranked,
    wins: 3,
    losses: 2,
    matchCount: 5,
    initialRating: 1400,
    currentRating: 1422,
    currentRatingType: "MR",
    ratingDelta: 22,
    ratingHistory: [1400, 1410, 1422],
  };
  const achievement = { ratingScopeKey: "synthetic:26:MR", peakRating: 1430, rankingScopeKey: "synthetic:26:MR", initialRank: 300 };
  const payload = buildTrackerSessionPayload(tracker, achievement);
  const restored = restoreTrackerSession(payload, emptyTrackerState(), createSessionAchievementState());

  assert.equal(restored.restored, true);
  assert.equal(restored.trackerState.active, false);
  assert.equal(restored.trackerState.stopReason, "restart");
  assert.equal(restored.trackerState.wins, 3);
  assert.equal(restored.trackerState.losses, 2);
  assert.deepEqual(restored.trackerState.stats.ranked.ratingHistory, [1400, 1410, 1422]);
  assert.deepEqual(restored.trackerState.seenReplayIds, ["synthetic-replay-1", "synthetic-replay-2"]);
  assert.equal(restored.achievementState.peakRating, 1430);
  assert.equal(restored.achievementState.initialRank, 300);
});

test("empty or corrupt session data fails closed to an empty state", () => {
  const empty = emptyTrackerState();
  for (const payload of [null, {}, { version: 1, trackerState: { player: null } }]) {
    const restored = restoreTrackerSession(payload, empty, createSessionAchievementState());
    assert.equal(restored.restored, false);
    assert.equal(restored.trackerState.startedAt, null);
    assert.equal(restored.trackerState.player, null);
  }
});

test("main and management UI keep stopped sessions until an explicit reset or local-data clear", () => {
  const root = path.join(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8");

  assert.match(main, /trackerSessionPath = path\.join\(userDataPath, "tracker-session\.json"\)/);
  assert.match(main, /function sendTrackerState\(\) \{\s*const state = publicTrackerState\(\);\s*persistTrackerSession\(\)/);
  assert.match(main, /function stopTracking\(\{ discard = false \} = \{\}\)/);
  assert.match(main, /\["idle", "manual", "restart"\]\.includes\(trackerState\.stopReason\)/);
  assert.match(main, /stopTracking\(\{ discard: true \}\)/);
  assert.match(main, /fs\.rmSync\(trackerSessionPath, \{ force: true \}\)/);
  assert.match(renderer, /\["idle", "manual", "restart"\]\.includes\(state\.stopReason\)/);
  assert.match(renderer, /resetTrackingButton\.disabled = Boolean\(state\.readOnly\) \|\| !state\.startedAt/);
});
