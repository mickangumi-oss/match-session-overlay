"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyFriendOnlineSnapshot,
  createFriendOnlineNotificationBatch,
  createFriendOnlineNotificationState,
  friendOnlineNotificationView,
  getFriendNotificationAccountEpoch,
  mergeFriendOnlineNotificationBatch,
  resetFriendOnlineNotificationAccount,
} = require("../src/friend-online-notifications");

const accountId = "synthetic-account";
const friend = (profileId, online, name = profileId) => ({ profileId, online, name });
const complete = (state, friends, options = {}) => applyFriendOnlineSnapshot(state, {
  accountId,
  friends,
  complete: true,
  snapshotAt: 1_000,
  ...options,
});

test("the first complete snapshot establishes a silent baseline", () => {
  const result = complete(createFriendOnlineNotificationState(), [friend("alpha", true)]);
  assert.equal(result.reason, "INITIAL_BASELINE");
  assert.equal(result.accepted, true);
  assert.deepEqual(result.notificationPlayers, []);
  assert.equal(result.state.accounts[accountId].profiles.alpha.online, true);
  assert.equal(result.state.accounts[accountId].profiles.alpha.lastSuccessfulAt, 1_000);
  assert.equal(
    result.state.accounts[accountId].profiles.alpha.notificationHandledForCurrentOnlineState,
    true,
  );
});

test("only an offline-to-online transition notifies, including a later relogin", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false)]).state;
  let result = complete(state, [friend("alpha", true)]);
  assert.deepEqual(result.notificationPlayers.map((player) => player.profileId), ["alpha"]);
  state = result.state;
  assert.deepEqual(complete(state, [friend("alpha", true)]).notificationPlayers, []);
  state = complete(state, [friend("alpha", false)]).state;
  result = complete(state, [friend("alpha", true)]);
  assert.deepEqual(result.notificationPlayers.map((player) => player.profileId), ["alpha"]);
});

test("profile IDs, not display names, identify friends", () => {
  let state = complete(createFriendOnlineNotificationState(), [
    friend("one", false, "Same Name"),
    friend("two", false, "Same Name"),
  ]).state;
  const result = complete(state, [friend("one", false, "Renamed"), friend("two", true, "Same Name")]);
  assert.deepEqual(result.notificationPlayers, [friend("two", true, "Same Name")]);
});

test("duplicate source rows produce one notification and retain the first row", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false)]).state;
  const result = complete(state, [friend("alpha", true, "First"), friend("alpha", true, "Second")]);
  assert.deepEqual(result.notificationPlayers, [friend("alpha", true, "First")]);
});

test("failed and partial snapshots neither change state nor create notifications", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false), friend("beta", true)]).state;
  for (const options of [{ succeeded: false }, { complete: false }]) {
    const result = applyFriendOnlineSnapshot(state, { accountId, friends: [friend("alpha", true)], ...options });
    assert.equal(result.reason, options.succeeded === false ? "INCOMPLETE_SNAPSHOT" : "INCOMPLETE_SNAPSHOT");
    assert.deepEqual(result.notificationPlayers, []);
    assert.deepEqual(result.state.accounts[accountId].profiles, state.accounts[accountId].profiles);
  }
  const result = complete(state, [friend("alpha", false), friend("beta", true)]);
  assert.deepEqual(result.notificationPlayers, []);
});

test("game-off transitions update the baseline without a delayed notification", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false)]).state;
  const stopped = complete(state, [friend("alpha", true)], { gameRunningOnly: true, gameRunning: false });
  assert.equal(stopped.reason, "NOTIFICATION_SUPPRESSED");
  assert.deepEqual(stopped.notificationPlayers, []);
  const started = complete(stopped.state, [friend("alpha", true)], { gameRunningOnly: true, gameRunning: true });
  assert.deepEqual(started.notificationPlayers, []);
});

test("disabled notifications also consume the transition", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false)]).state;
  state = complete(state, [friend("alpha", true)], { notificationsEnabled: false }).state;
  assert.deepEqual(complete(state, [friend("alpha", true)]).notificationPlayers, []);
});

test("account state is isolated and a reset rejects stale in-flight results", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false)]).state;
  const other = applyFriendOnlineSnapshot(state, {
    accountId: "synthetic-other-account", friends: [friend("alpha", true)], complete: true,
  });
  assert.equal(other.reason, "INITIAL_BASELINE");
  const epoch = getFriendNotificationAccountEpoch(other.state, accountId);
  state = resetFriendOnlineNotificationAccount(other.state, accountId);
  const stale = complete(state, [friend("alpha", true)], { accountEpoch: epoch });
  assert.equal(stale.reason, "STALE_ACCOUNT_EPOCH");
  const fresh = complete(stale.state, [friend("alpha", true)], {
    accountEpoch: getFriendNotificationAccountEpoch(stale.state, accountId),
  });
  assert.equal(fresh.reason, "INITIAL_BASELINE");
  assert.equal(fresh.state.accounts["synthetic-other-account"].profiles.alpha.online, true);
});

test("an older version cannot overwrite a newer complete snapshot", () => {
  let state = complete(createFriendOnlineNotificationState(), [friend("alpha", false)], { snapshotVersion: 10 }).state;
  state = complete(state, [friend("alpha", true)], { snapshotVersion: 12 }).state;
  const stale = complete(state, [friend("alpha", false)], { snapshotVersion: 11 });
  assert.equal(stale.reason, "STALE_SNAPSHOT");
  assert.equal(stale.state.accounts[accountId].profiles.alpha.online, true);
});

test("a single batch deduplicates notifications and exposes at most two names", () => {
  const batch = createFriendOnlineNotificationBatch([
    friend("a", true, "Synthetic A"), friend("b", true, "Synthetic B"), friend("c", true, "Synthetic C"),
  ], 100);
  const merged = mergeFriendOnlineNotificationBatch(batch, [friend("b", true, "Different"), friend("d", true, "Synthetic D")], 200);
  assert.deepEqual(friendOnlineNotificationView(merged), {
    count: 4,
    names: ["Synthetic A", "Synthetic B"],
    remainingCount: 2,
    titleKey: "friendsOnline",
  });
  assert.equal(merged.collectUntil, 3100);
  assert.equal(merged.dismissAt, 8100);
});

test("a new batch begins only after the existing toast lifetime expires", () => {
  const initial = createFriendOnlineNotificationBatch([friend("a", true)], 100, { aggregationMs: 3, displayMs: 5 });
  const active = mergeFriendOnlineNotificationBatch(initial, [friend("b", true)], 108);
  assert.equal(friendOnlineNotificationView(active).count, 2);
  const next = mergeFriendOnlineNotificationBatch(initial, [friend("c", true, "Synthetic C")], 109);
  assert.deepEqual(friendOnlineNotificationView(next).names, ["Synthetic C"]);
});
