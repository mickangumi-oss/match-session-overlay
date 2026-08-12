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
  baselineRating,
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
  const baseline = finitePositive(baselineRating);
  const peakCandidate = rating == null
    ? baseline
    : baseline == null
      ? rating
      : Math.max(rating, baseline);

  if (state.ratingScopeKey !== ratingScopeKey) {
    state.ratingScopeKey = ratingScopeKey;
    state.peakRating = peakCandidate;
  } else if (peakCandidate != null) {
    state.peakRating = state.peakRating == null
      ? peakCandidate
      : Math.max(Number(state.peakRating), peakCandidate);
  }

  const rankingScopeKey = ratingScopeKey;
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
