"use strict";

const MATCH_TYPES = ["ranked", "battleHub", "casual"];

function finiteOr(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function normalizeStats(source, fallback) {
  const result = structuredClone(fallback);
  if (!source || typeof source !== "object") return result;
  for (const matchType of MATCH_TYPES) {
    const value = source[matchType];
    if (!value || typeof value !== "object") continue;
    const base = result[matchType];
    base.wins = nonNegativeInteger(value.wins);
    base.losses = nonNegativeInteger(value.losses);
    base.matchCount = nonNegativeInteger(value.matchCount, base.wins + base.losses);
    base.initialRating = finiteOr(value.initialRating);
    base.currentRating = finiteOr(value.currentRating);
    base.currentRatingType = value.currentRatingType === "LP" ? "LP" : value.currentRatingType === "MR" ? "MR" : null;
    base.ratingDelta = finiteOr(value.ratingDelta);
    base.ratingHistory = (Array.isArray(value.ratingHistory) ? value.ratingHistory : [])
      .map((rating) => finiteOr(rating))
      .filter((rating) => rating != null)
      .slice(-5000);
  }
  return result;
}

function hasRetainedTrackerSession(state) {
  return Boolean(
    state?.player &&
    String(state.player.profileId ?? state.player.userCode ?? "").trim() &&
    state.startedAt != null &&
    state.startedAt !== "" &&
    Number.isFinite(Number(state.startedAt)),
  );
}

function normalizeCharacterStates(source, emptyStats) {
  if (!source || typeof source !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== "object") continue;
    result[key] = {
      wins: nonNegativeInteger(value.wins),
      losses: nonNegativeInteger(value.losses),
      streak: nonNegativeInteger(value.streak),
      initialRating: finiteOr(value.initialRating),
      currentRating: finiteOr(value.currentRating),
      ratingType: value.ratingType === "LP" ? "LP" : "MR",
      ratingDelta: finiteOr(value.ratingDelta, 0),
      lastMatch: value.lastMatch && typeof value.lastMatch === "object" ? value.lastMatch : null,
      stats: normalizeStats(value.stats, emptyStats),
    };
  }
  return result;
}

function restoreTrackerSession(payload, emptyTrackerState, emptyAchievementState) {
  const stored = payload?.version === 1 ? payload.trackerState : null;
  if (!stored || typeof stored !== "object" || !hasRetainedTrackerSession(stored)) {
    return {
      trackerState: structuredClone(emptyTrackerState),
      achievementState: structuredClone(emptyAchievementState),
      restored: false,
    };
  }
  const profileId = String(stored.player.profileId ?? stored.player.userCode ?? "").trim();
  const player = { ...stored.player, profileId, userCode: String(stored.player.userCode ?? profileId) };
  const trackerState = {
    ...structuredClone(emptyTrackerState),
    ...stored,
    active: false,
    player,
    wins: nonNegativeInteger(stored.wins),
    losses: nonNegativeInteger(stored.losses),
    streak: nonNegativeInteger(stored.streak),
    initialRating: finiteOr(stored.initialRating),
    currentRating: finiteOr(stored.currentRating),
    ratingType: stored.ratingType === "LP" ? "LP" : "MR",
    characterId: finiteOr(stored.characterId),
    ratingDelta: finiteOr(stored.ratingDelta, 0),
    startedAt: finiteOr(stored.startedAt),
    updatedAt: finiteOr(stored.updatedAt),
    lastNewMatchAt: finiteOr(stored.lastNewMatchAt),
    nextPollAt: null,
    effectivePollIntervalSeconds: null,
    consecutiveFailures: 0,
    stopReason: "restart",
    seenReplayIds: [...new Set(
      (Array.isArray(stored.seenReplayIds) ? stored.seenReplayIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    )].slice(-5000),
    stats: normalizeStats(stored.stats, emptyTrackerState.stats),
    characterStates: normalizeCharacterStates(stored.characterStates, emptyTrackerState.stats),
    status: "停止中",
    overlayUrl: emptyTrackerState.overlayUrl,
  };
  const achievement = payload.achievementState;
  const achievementState = achievement && typeof achievement === "object"
    ? {
        ...structuredClone(emptyAchievementState),
        ratingScopeKey: String(achievement.ratingScopeKey ?? ""),
        peakRating: finiteOr(achievement.peakRating),
        rankingScopeKey: String(achievement.rankingScopeKey ?? ""),
        initialRank: finiteOr(achievement.initialRank),
      }
    : structuredClone(emptyAchievementState);
  return { trackerState, achievementState, restored: true };
}

function buildTrackerSessionPayload(trackerState, achievementState) {
  if (!hasRetainedTrackerSession(trackerState)) return null;
  return {
    version: 1,
    trackerState,
    achievementState,
  };
}

module.exports = {
  buildTrackerSessionPayload,
  hasRetainedTrackerSession,
  restoreTrackerSession,
};
