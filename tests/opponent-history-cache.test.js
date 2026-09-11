"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  invalidateScopedOfficialHistoryCache,
  completedHistoryReplayState,
  acquireScopedOfficialHistories,
} = require("../src/opponent-history-cache");

function keyForProfile(profileId, locale, actId) {
  return `${locale}:${profileId}:${actId}`;
}

test("force refresh invalidates owner and opponent in the same locale and Act", () => {
  const cache = new Map([
    ["ja-jp:owner:13", { replayId: "old-owner" }],
    ["ja-jp:opponent:13", { replayId: "old-opponent" }],
    ["ja-jp:owner:12", { replayId: "other-act" }],
    ["en:owner:13", { replayId: "other-locale" }],
    ["ja-jp:other:13", { replayId: "other-profile" }],
  ]);

  const deleted = invalidateScopedOfficialHistoryCache(cache, {
    ownerProfileId: "owner",
    opponentProfileId: "opponent",
    requestedLocale: "ja-jp",
    selectedActId: 13,
    cacheKeyForProfile: keyForProfile,
  });

  assert.deepEqual(deleted.sort(), ["ja-jp:opponent:13", "ja-jp:owner:13"]);
  assert.equal(cache.has("ja-jp:owner:13"), false);
  assert.equal(cache.has("ja-jp:opponent:13"), false);
  assert.equal(cache.has("ja-jp:owner:12"), true);
  assert.equal(cache.has("en:owner:13"), true);
  assert.equal(cache.has("ja-jp:other:13"), true);
});

test("force refresh deletes one key when owner and opponent are the same profile", () => {
  const cache = new Map([["ja-jp:same:13", { replayId: "old" }]]);
  const deleted = invalidateScopedOfficialHistoryCache(cache, {
    ownerProfileId: "same",
    opponentProfileId: "same",
    requestedLocale: "ja-jp",
    selectedActId: 13,
    cacheKeyForProfile: keyForProfile,
  });
  assert.deepEqual(deleted, ["ja-jp:same:13"]);
  assert.equal(cache.size, 0);
});

test("completed cache requires selected replay round results without changing the cache key scope", () => {
  const cache = new Map([
    ["ja-jp:owner:13", { history: { complete: true, records: [{ replayId: "selected", roundResults: { self: { values: [1] } } }] } }],
    ["ja-jp:opponent:13", { history: { complete: true, records: [{ replayId: "other" }] } }],
    ["ja-jp:owner:12", { history: { complete: true, records: [{ replayId: "selected", roundResults: { self: { values: [1] } } }] } }],
  ]);
  const common = {
    requestedLocale: "ja-jp",
    selectedActId: 13,
    cacheKeyForProfile: keyForProfile,
  };
  assert.equal(completedHistoryReplayState(cache, { ...common, profileId: "owner", requiredReplayId: "selected" }), "present");
  assert.equal(completedHistoryReplayState(cache, { ...common, profileId: "opponent", requiredReplayId: "selected" }), "missing");
  assert.equal(completedHistoryReplayState(cache, { ...common, profileId: "owner", requiredReplayId: "unknown" }), "missing");
  assert.equal(completedHistoryReplayState(cache, { ...common, profileId: "owner", selectedActId: 12, requiredReplayId: "selected" }), "present");
  cache.set("ja-jp:owner:13", { history: { complete: true, records: [{ replayId: "selected" }] } });
  assert.equal(completedHistoryReplayState(cache, { ...common, profileId: "owner", requiredReplayId: "selected" }), "missing-round-results");
});

function completeHistory(replayId = "selected", withRounds = true) {
  return {
    complete: true,
    records: [{ replayId, ...(withRounds ? { roundResults: { self: { values: [1] }, opponent: { values: [0] } } } : {}) }],
  };
}

function scopedAcquireOptions(overrides = {}) {
  return {
    cache: new Map(),
    ownerProfileId: "owner",
    opponentProfileId: "opponent",
    requestedLocale: "ja-jp",
    selectedActId: 13,
    requiredReplayId: "selected",
    selectedRecord: { replayId: "selected", actId: 13 },
    cacheKeyForProfile: keyForProfile,
    generation: "generation-1",
    assertGeneration: () => {},
    ...overrides,
  };
}

test("production acquisition returns a complete cache hit without official fetch", async () => {
  const cache = new Map([
    ["ja-jp:owner:13", { history: completeHistory() }],
    ["ja-jp:opponent:13", { history: completeHistory() }],
  ]);
  let calls = 0;
  const result = await acquireScopedOfficialHistories(scopedAcquireOptions({
    cache,
    acquireOfficialHistory: async () => {
      calls += 1;
      throw new Error("SHOULD_NOT_FETCH");
    },
  }));
  assert.equal(calls, 0);
  assert.equal(result.ownerHistory.records[0].replayId, "selected");
  assert.equal(result.officialHistory.records[0].replayId, "selected");
});

test("Act-independent round acquisition does not require the selected replay in either side", async () => {
  const calls = [];
  const result = await acquireScopedOfficialHistories(scopedAcquireOptions({
    selectedActId: null,
    actIndependent: true,
    acquireOfficialHistory: async ({ profileId, actId, actIndependent }) => {
      calls.push({ profileId, actId, actIndependent });
      return completeHistory("other");
    },
  }));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.actId), [null, null]);
  assert.deepEqual(calls.map((call) => call.actIndependent), [true, true]);
  assert.equal(result.ownerHistory.records[0].replayId, "other");
  assert.equal(result.officialHistory.records[0].replayId, "other");
});

test("production acquisition invalidates both scopes and performs one bounded acquire after a cache miss", async () => {
  const cache = new Map([
    ["ja-jp:owner:13", { history: completeHistory("old") }],
    ["ja-jp:opponent:13", { history: completeHistory() }],
  ]);
  const calls = [];
  const result = await acquireScopedOfficialHistories(scopedAcquireOptions({
    cache,
    acquireOfficialHistory: async ({ profileId }) => {
      calls.push(profileId);
      return completeHistory();
    },
  }));
  assert.deepEqual(calls, ["opponent", "owner"]);
  assert.equal(cache.has("ja-jp:owner:13"), false);
  assert.equal(cache.has("ja-jp:opponent:13"), false);
  assert.equal(result.ownerHistory.records[0].replayId, "selected");
});

test("production acquisition retries once when the first acquire misses the selected replay", async () => {
  let attempt = 0;
  const result = await acquireScopedOfficialHistories(scopedAcquireOptions({
    acquireOfficialHistory: async () => {
      attempt += 1;
      return completeHistory(attempt > 2 ? "selected" : "other");
    },
  }));
  assert.equal(attempt, 4);
  assert.equal(result.ownerHistory.records[0].replayId, "selected");
});

test("production acquisition fails closed after the single retry still misses the selected replay", async () => {
  let attempt = 0;
  await assert.rejects(
    acquireScopedOfficialHistories(scopedAcquireOptions({
      acquireOfficialHistory: async () => {
        attempt += 1;
        return completeHistory("other");
      },
    })),
    { message: "HISTORY_SELECTED_REPLAY_SCOPE_MISSING" },
  );
  assert.equal(attempt, 4);
});

test("production acquisition does not retry incomplete, failed, or stale generations", async () => {
  for (const error of ["HISTORY_SCOPE_INCOMPLETE", "RETRIEVAL_FAILED", "STALE_GENERATION"]) {
    let calls = 0;
    await assert.rejects(
      acquireScopedOfficialHistories(scopedAcquireOptions({
        acquireOfficialHistory: async () => {
          calls += 1;
          throw new Error(error);
        },
        assertGeneration: () => {
          if (error === "STALE_GENERATION") throw new Error(error);
        },
      })),
      { message: error },
    );
    assert.equal(calls, error === "STALE_GENERATION" ? 0 : 1);
  }
});
