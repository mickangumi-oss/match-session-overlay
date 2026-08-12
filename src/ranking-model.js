"use strict";

const RANKING_PROPAGATION_RETRY_DELAYS_MS = Object.freeze([5_000, 15_000]);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rankingPageProps(data) {
  return data?.pageProps ?? data?.props?.pageProps ?? {};
}

function rankingCharacterSlug(player, characterId) {
  const expectedCharacterId = Number(characterId);
  if (!Number.isFinite(expectedCharacterId) || expectedCharacterId <= 0) return "";
  const playerCharacterId = Number(player?.characterId);
  const officialPlayerSlug = String(
    player?.character ?? player?.characterToolName ?? "",
  ).trim().toLowerCase();
  // The current official ranking metadata identifies characters by slug
  // (for example `gouki`) rather than the numeric character id used by
  // profile/search responses. Use the slug only when it belongs to the exact
  // player character id; never borrow another character's slug.
  if (
    playerCharacterId === expectedCharacterId &&
    /^[a-z0-9_-]+$/.test(officialPlayerSlug)
  ) {
    return officialPlayerSlug;
  }
  return "";
}

function rankingRequestQuery({ characterSlug }) {
  return {
    character_filter: 4,
    character_id: String(characterSlug ?? "").trim().toLowerCase(),
    platform: 1,
    home_filter: 1,
    home_category_id: 0,
    home_id: 0,
    page: 1,
    season_type: 1,
  };
}

function normalizeRankingEntry(mine, {
  profileId,
  characterSlug,
  ratingField,
  rankField,
} = {}) {
  if (!mine || typeof mine !== "object") return null;
  const expectedProfileId = String(profileId ?? "").trim();
  const actualProfileId = String(
    mine?.fighter_banner_info?.personal_info?.short_id ?? "",
  ).trim();
  if (!expectedProfileId || actualProfileId !== expectedProfileId) return null;
  const expectedCharacterSlug = String(characterSlug ?? "").trim().toLowerCase();
  const actualCharacterSlug = String(mine.character_tool_name ?? "").trim().toLowerCase();
  if (!expectedCharacterSlug || actualCharacterSlug !== expectedCharacterSlug) return null;
  const rank = finitePositive(mine?.[rankField]);
  if (rank == null) return null;
  return {
    rank: Math.trunc(rank),
    rating: finitePositive(mine?.[ratingField]),
    characterId: Number(mine.character_id),
    characterSlug: actualCharacterSlug,
  };
}

function normalizeMasterRanking(data, options = {}) {
  return normalizeRankingEntry(
    rankingPageProps(data)?.master_rating_ranking?.my_ranking_info,
    { ...options, ratingField: "rating", rankField: "order" },
  );
}

function normalizeLeagueRanking(data, options = {}) {
  return normalizeRankingEntry(
    rankingPageProps(data)?.league_point_ranking?.my_ranking_info,
    { ...options, ratingField: "league_point", rankField: "order" },
  );
}

function rankingCacheKey({ locale, profileId, characterId, characterSlug, ratingType, act = 1 }) {
  return [
    String(locale ?? ""),
    String(profileId ?? ""),
    String(Number(characterId) || 0),
    String(characterSlug ?? "").trim().toLowerCase(),
    ratingType === "LP" ? "LP" : "MR",
    String(Number(act) || 1),
  ].join(":");
}

function shouldRefreshRanking({
  initial = false,
  characterChanged = false,
  newRankedMatchCount = 0,
  currentRating = null,
} = {}) {
  if (finitePositive(currentRating) == null) return false;
  return initial || characterChanged || Number(newRankedMatchCount) > 0;
}

function explicitOtherPlayerRankingAllowed({
  playerProfileId,
  authenticatedProfileId,
  historyProfileId,
} = {}) {
  const playerId = String(playerProfileId ?? "").trim();
  const authenticatedId = String(authenticatedProfileId ?? "").trim();
  const selectedHistoryId = String(historyProfileId ?? "").trim();
  return Boolean(
    playerId &&
      authenticatedId &&
      selectedHistoryId &&
      playerId === selectedHistoryId &&
      playerId !== authenticatedId,
  );
}

function resolveRankingFetchResult({
  normalized,
  previous = null,
  retryAttempt = 0,
  now = Date.now(),
} = {}) {
  if (normalized?.rank != null) {
    return {
      cacheValue: { ...normalized, updatedAt: now },
      status: "ready",
      retryDelayMs: null,
    };
  }
  const attempt = Math.max(0, Math.trunc(Number(retryAttempt) || 0));
  const retryDelayMs = RANKING_PROPAGATION_RETRY_DELAYS_MS[attempt] ?? null;
  return {
    cacheValue: previous?.rank != null ? previous : null,
    status: retryDelayMs == null ? "error" : "loading",
    retryDelayMs,
  };
}

function rankingRetryScopeMatches(expected = {}, current = {}) {
  return Boolean(
    String(expected.profileId ?? "").trim() &&
      String(current.authenticatedProfileId ?? "").trim() ===
        String(expected.profileId ?? "").trim() &&
      String(current.playerProfileId ?? "").trim() ===
        String(expected.profileId ?? "").trim() &&
      Number(current.characterId) === Number(expected.characterId) &&
      String(current.locale ?? "") === String(expected.locale ?? "") &&
      (current.ratingType === "LP" ? "LP" : "MR") ===
        (expected.ratingType === "LP" ? "LP" : "MR"),
  );
}

module.exports = {
  RANKING_PROPAGATION_RETRY_DELAYS_MS,
  explicitOtherPlayerRankingAllowed,
  normalizeLeagueRanking,
  normalizeMasterRanking,
  rankingCharacterSlug,
  rankingCacheKey,
  rankingRequestQuery,
  rankingRetryScopeMatches,
  resolveRankingFetchResult,
  shouldRefreshRanking,
};
