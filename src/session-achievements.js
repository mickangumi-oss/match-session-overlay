"use strict";

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeIdentity(value) {
  return String(value ?? "").trim();
}

function createSessionAchievementState() {
  return {
    ratingScopeKey: "",
    peakRating: null,
    rankingScopeKey: "",
    initialRank: null,
  };
}

function updateSessionAchievements(previous, {
  profileId,
  characterId,
  ratingType,
  currentRating,
  homeKey,
  currentRank,
  rankingReady = true,
} = {}) {
  const state = previous && typeof previous === "object"
    ? { ...createSessionAchievementState(), ...previous }
    : createSessionAchievementState();
  const normalizedProfileId = normalizeIdentity(profileId);
  const normalizedCharacterId = finitePositive(characterId);
  const normalizedRatingType = ratingType === "LP" ? "LP" : "MR";
  const ratingScopeKey = normalizedProfileId && normalizedCharacterId != null
    ? `${normalizedProfileId}:${normalizedCharacterId}:${normalizedRatingType}`
    : "";
  const rating = finitePositive(currentRating);

  if (state.ratingScopeKey !== ratingScopeKey) {
    state.ratingScopeKey = ratingScopeKey;
    state.peakRating = rating;
  } else if (rating != null) {
    state.peakRating = state.peakRating == null
      ? rating
      : Math.max(Number(state.peakRating), rating);
  }

  const normalizedHomeKey = normalizeIdentity(homeKey) || "all";
  const rankingScopeKey = ratingScopeKey && normalizedRatingType === "MR"
    ? `${normalizedProfileId}:${normalizedCharacterId}:${normalizedHomeKey}`
    : "";
  const rank = finitePositive(currentRank);
  if (state.rankingScopeKey !== rankingScopeKey) {
    state.rankingScopeKey = rankingScopeKey;
    state.initialRank = rankingReady && rank != null ? Math.trunc(rank) : null;
  } else if (state.initialRank == null && rankingReady && rank != null) {
    state.initialRank = Math.trunc(rank);
  }

  const normalizedRank = rank == null ? null : Math.trunc(rank);
  const rankDelta = normalizedRank != null && state.initialRank != null
    ? Math.trunc(state.initialRank - normalizedRank)
    : null;

  return {
    state,
    sessionPeakRating: finitePositive(state.peakRating),
    sessionPeakRatingType: normalizedRatingType,
    initialRank: state.initialRank,
    rankDelta,
  };
}

module.exports = {
  createSessionAchievementState,
  updateSessionAchievements,
};
