"use strict";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildPresentationState({
  sourceState = {},
  player = null,
  matchType = "ranked",
  median = {},
  ranking = {},
} = {}) {
  const selected = sourceState.stats?.[matchType] ?? {};
  const wins = Math.max(0, Math.trunc(finiteNumber(selected.wins) ?? 0));
  const losses = Math.max(0, Math.trunc(finiteNumber(selected.losses) ?? 0));
  const total = wins + losses;
  const playerMr = finiteNumber(player?.mr);
  const playerLp = finiteNumber(player?.lp);
  const trackedRating = finiteNumber(sourceState.currentRating);
  const currentRating = trackedRating ?? playerMr ?? playerLp;
  const ratingType =
    trackedRating != null && ["MR", "LP"].includes(sourceState.ratingType)
      ? sourceState.ratingType
      : playerMr != null
        ? "MR"
        : playerLp != null
          ? "LP"
          : sourceState.ratingType === "LP"
            ? "LP"
            : "MR";
  const delta = matchType === "ranked" ? finiteNumber(selected.ratingDelta) ?? 0 : null;
  const medianRating = finiteNumber(median.medianRating);
  const medianSampleCount = Math.max(
    0,
    Math.trunc(finiteNumber(median.medianRatingSampleCount) ?? 0),
  );

  return {
    matchType,
    wins,
    losses,
    winRate: total ? (wins / total) * 100 : 0,
    currentRating,
    ratingType,
    ratingDelta: delta,
    potentialRating: medianRating,
    potentialRatingType: median.medianRatingType || ratingType,
    potentialSampleCount: medianSampleCount,
    currentCharacter: String(player?.characterDisplayName ?? "").trim(),
    characterId: Number(player?.characterId) || null,
    mrRank: ranking.rank != null &&
      Number.isFinite(Number(ranking.rank)) &&
      Number(ranking.rank) > 0
      ? Math.trunc(Number(ranking.rank))
      : null,
    mrRankHome: String(ranking.homeLabel ?? "").trim(),
    mrRankLoading: ranking.status === "loading",
  };
}

module.exports = { buildPresentationState };
