"use strict";

// This module deliberately has no timer, IPC, or Electron dependency.  A caller
// gives it completed FRIENDS snapshots and decides when to render the returned
// batch.  Keeping the transition state here makes a failed/partial refresh a
// no-op rather than an accidental logout for every missing friend.

const DEFAULT_AGGREGATION_MS = 3_000;
const DEFAULT_DISPLAY_MS = 5_000;

function profileIdOf(player) {
  if (!player || typeof player.profileId !== "string") return "";
  return player.profileId.trim();
}

function normalizedFriend(player) {
  const profileId = profileIdOf(player);
  if (!profileId) return null;
  return {
    profileId,
    name: String(player.name ?? "").trim(),
    online: player.online === true,
  };
}

function normalizeFriends(friends) {
  const byProfileId = new Map();
  for (const player of Array.isArray(friends) ? friends : []) {
    const friend = normalizedFriend(player);
    // A profile ID, rather than a localized/display name, is the sole key. The
    // first record wins so duplicate source rows cannot manufacture a change.
    if (friend && !byProfileId.has(friend.profileId)) {
      byProfileId.set(friend.profileId, friend);
    }
  }
  return [...byProfileId.values()];
}

function createFriendOnlineNotificationState() {
  return { accounts: {} };
}

function cloneState(state) {
  const accounts = {};
  for (const [accountId, account] of Object.entries(state?.accounts ?? {})) {
    accounts[accountId] = {
      epoch: Number(account?.epoch) || 0,
      baselineReady: account?.baselineReady === true,
      lastSnapshotVersion: Number.isFinite(account?.lastSnapshotVersion)
        ? Number(account.lastSnapshotVersion)
        : null,
      profiles: Object.fromEntries(
        Object.entries(account?.profiles ?? {}).map(([profileId, profile]) => [
          profileId,
          { ...profile },
        ]),
      ),
    };
  }
  return { accounts };
}

function accountKey(accountId) {
  return typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : "";
}

function emptyResult(state, reason) {
  return { state, newlyOnline: [], notificationPlayers: [], accepted: false, reason };
}

/**
 * Applies one completed FRIENDS snapshot.
 *
 * `complete` and `succeeded` must both be true before any profile state is
 * changed. `accountEpoch` is captured when a request starts; passing the epoch
 * returned by getFriendNotificationAccountEpoch prevents a pre-reset response
 * from repopulating a cleared account. `snapshotVersion` is optional but, when
 * supplied, rejects older responses for the same account.
 */
function applyFriendOnlineSnapshot(state, {
  accountId,
  friends,
  complete = false,
  succeeded = true,
  accountEpoch,
  snapshotVersion,
  snapshotAt = Date.now(),
  notificationsEnabled = true,
  gameRunning = true,
  gameRunningOnly = false,
} = {}) {
  const current = cloneState(state);
  const key = accountKey(accountId);
  if (!key) return emptyResult(current, "ACCOUNT_REQUIRED");

  const existing = current.accounts[key] ?? {
    epoch: 0,
    baselineReady: false,
    lastSnapshotVersion: null,
    profiles: {},
  };
  current.accounts[key] = existing;

  if (accountEpoch != null && Number(accountEpoch) !== existing.epoch) {
    return emptyResult(current, "STALE_ACCOUNT_EPOCH");
  }
  if (!succeeded || !complete) return emptyResult(current, "INCOMPLETE_SNAPSHOT");

  const version = Number(snapshotVersion);
  if (Number.isFinite(version) && existing.lastSnapshotVersion != null && version < existing.lastSnapshotVersion) {
    return emptyResult(current, "STALE_SNAPSHOT");
  }

  const normalized = normalizeFriends(friends);
  const successfulAt = Number.isFinite(Number(snapshotAt))
    ? Number(snapshotAt)
    : Date.now();
  const nextProfiles = Object.fromEntries(
    normalized.map((friend) => [friend.profileId, {
      online: friend.online,
      name: friend.name,
      lastSuccessfulAt: successfulAt,
      notificationHandledForCurrentOnlineState: friend.online,
    }]),
  );

  if (!existing.baselineReady) {
    existing.baselineReady = true;
    existing.profiles = nextProfiles;
    if (Number.isFinite(version)) existing.lastSnapshotVersion = version;
    return {
      state: current,
      newlyOnline: [],
      notificationPlayers: [],
      accepted: true,
      reason: "INITIAL_BASELINE",
    };
  }

  const newlyOnline = normalized.filter((friend) =>
    existing.profiles[friend.profileId]?.online === false && friend.online,
  );
  existing.profiles = nextProfiles;
  if (Number.isFinite(version)) existing.lastSnapshotVersion = version;

  // The state is deliberately updated even while the game is stopped.  This
  // consumes the transition, so starting the game later cannot show it late.
  const mayNotify = notificationsEnabled && (!gameRunningOnly || gameRunning);
  return {
    state: current,
    newlyOnline,
    notificationPlayers: mayNotify ? newlyOnline : [],
    accepted: true,
    reason: mayNotify || newlyOnline.length === 0 ? "APPLIED" : "NOTIFICATION_SUPPRESSED",
  };
}

function getFriendNotificationAccountEpoch(state, accountId) {
  const account = state?.accounts?.[accountKey(accountId)];
  return Number(account?.epoch) || 0;
}

function resetFriendOnlineNotificationAccount(state, accountId) {
  const next = cloneState(state);
  const key = accountKey(accountId);
  if (!key) return next;
  const previousEpoch = Number(next.accounts[key]?.epoch) || 0;
  // Keep the incremented epoch as a tombstone so an old in-flight request is
  // distinguishable from the first request after logout/data deletion.
  next.accounts[key] = {
    epoch: previousEpoch + 1,
    baselineReady: false,
    lastSnapshotVersion: null,
    profiles: {},
  };
  return next;
}

function createFriendOnlineNotificationBatch(players, now = Date.now(), {
  aggregationMs = DEFAULT_AGGREGATION_MS,
  displayMs = DEFAULT_DISPLAY_MS,
} = {}) {
  const entries = normalizeFriends(players).filter((player) => player.online);
  if (!entries.length) return null;
  const openedAt = Number(now);
  const safeOpenedAt = Number.isFinite(openedAt) ? openedAt : Date.now();
  const safeAggregationMs = Math.max(0, Number(aggregationMs) || 0);
  const safeDisplayMs = Math.max(0, Number(displayMs) || 0);
  return {
    openedAt: safeOpenedAt,
    collectUntil: safeOpenedAt + safeAggregationMs,
    dismissAt: safeOpenedAt + safeAggregationMs + safeDisplayMs,
    players: entries.map(({ profileId, name }) => ({ profileId, name })),
  };
}

function mergeFriendOnlineNotificationBatch(batch, players, now = Date.now(), options) {
  if (!batch || Number(now) > Number(batch.dismissAt)) {
    return createFriendOnlineNotificationBatch(players, now, options);
  }
  const merged = new Map((Array.isArray(batch.players) ? batch.players : [])
    .map((player) => [profileIdOf(player), {
      profileId: profileIdOf(player),
      name: String(player?.name ?? "").trim(),
    }])
    .filter(([profileId]) => profileId));
  for (const player of normalizeFriends(players)) {
    if (player.online && !merged.has(player.profileId)) {
      merged.set(player.profileId, { profileId: player.profileId, name: player.name });
    }
  }
  return { ...batch, players: [...merged.values()] };
}

function friendOnlineNotificationView(batch) {
  const players = Array.isArray(batch?.players) ? batch.players : [];
  const unique = new Map();
  for (const player of players) {
    const profileId = profileIdOf(player);
    if (profileId && !unique.has(profileId)) unique.set(profileId, String(player.name ?? "").trim());
  }
  const names = [...unique.values()].slice(0, 2);
  const count = unique.size;
  return {
    count,
    names,
    remainingCount: Math.max(0, count - names.length),
    titleKey: count === 1 ? "friendOnline" : "friendsOnline",
  };
}

module.exports = {
  DEFAULT_AGGREGATION_MS,
  DEFAULT_DISPLAY_MS,
  applyFriendOnlineSnapshot,
  createFriendOnlineNotificationBatch,
  createFriendOnlineNotificationState,
  friendOnlineNotificationView,
  getFriendNotificationAccountEpoch,
  mergeFriendOnlineNotificationBatch,
  resetFriendOnlineNotificationAccount,
};
