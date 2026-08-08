"use strict";

const DEFAULT_RANKING_HOME = "all";

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sanitizeRankingHomeKey(value) {
  const key = String(value ?? "").trim();
  if (key === DEFAULT_RANKING_HOME) return key;
  if (/^region:\d{1,3}$/.test(key)) return key;
  if (/^country:\d{1,4}$/.test(key)) return key;
  return DEFAULT_RANKING_HOME;
}

function rankingHomeSelection(value) {
  const key = sanitizeRankingHomeKey(value);
  if (key.startsWith("region:")) {
    return {
      key,
      homeFilter: 2,
      homeCategoryId: Number(key.slice("region:".length)),
      homeId: 0,
    };
  }
  if (key.startsWith("country:")) {
    return {
      key,
      homeFilter: 3,
      homeCategoryId: 7,
      homeId: Number(key.slice("country:".length)),
    };
  }
  return { key: DEFAULT_RANKING_HOME, homeFilter: 1, homeCategoryId: 0, homeId: 0 };
}

function rankingPageProps(data) {
  return data?.pageProps ?? data?.props?.pageProps ?? {};
}

function normalizeOption(value, prefix) {
  const id = Number(value?.value);
  const label = String(value?.label ?? "").trim();
  if (!Number.isFinite(id) || id < 0 || !label) return null;
  return { value: `${prefix}:${id}`, label };
}

function buildRankingHomeCatalog(data) {
  const pageProps = rankingPageProps(data);
  const regions = (Array.isArray(pageProps.home_category_id)
    ? pageProps.home_category_id
    : [])
    .map((value) => normalizeOption(value, "region"))
    .filter((value) => value && !["region:0", "region:7"].includes(value.value));
  const countries = (Array.isArray(pageProps.home_id) ? pageProps.home_id : [])
    .map((value) => normalizeOption(value, "country"))
    .filter((value) => value && value.value !== "country:0");
  const allLabel = String(
    (pageProps.home_category_id ?? []).find(
      (value) => Number(value?.value) === 0,
    )?.label ?? "All",
  ).trim();
  return {
    all: { value: DEFAULT_RANKING_HOME, label: allLabel || "All" },
    regions,
    countries,
  };
}

function rankingHomeLabel(catalog, key) {
  const normalized = sanitizeRankingHomeKey(key);
  if (normalized === DEFAULT_RANKING_HOME) {
    return String(catalog?.all?.label ?? "All");
  }
  return (
    [...(catalog?.regions ?? []), ...(catalog?.countries ?? [])].find(
      (option) => option.value === normalized,
    )?.label ?? "—"
  );
}

function characterSlugForId(data, characterId) {
  const expected = Number(characterId);
  if (!Number.isFinite(expected) || expected <= 0) return "";
  const characters = rankingPageProps(data).character_id;
  if (!Array.isArray(characters)) return "";
  const match = characters.find((character) => Number(character?.value) === expected);
  return String(match?.url_name ?? match?.tool_name ?? "").trim().toLowerCase();
}

function buildCharacterSlugCatalog(data) {
  const characters = rankingPageProps(data).character_id;
  if (!Array.isArray(characters)) return {};
  return Object.fromEntries(
    characters
      .map((character) => {
        const id = Number(character?.value);
        const slug = String(
          character?.url_name ?? character?.tool_name ?? "",
        ).trim().toLowerCase();
        return Number.isFinite(id) && id > 0 && slug ? [String(id), slug] : null;
      })
      .filter(Boolean),
  );
}

function rankingCharacterSlug(player, characterId, catalog = {}) {
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
  const catalogSlug = String(catalog?.[String(expectedCharacterId)] ?? "")
    .trim()
    .toLowerCase();
  return /^[a-z0-9_-]+$/.test(catalogSlug) ? catalogSlug : "";
}

function rankingRequestQuery({ characterSlug, homeKey }) {
  const home = rankingHomeSelection(homeKey);
  return {
    character_filter: 4,
    character_id: String(characterSlug ?? "").trim().toLowerCase(),
    platform: 1,
    home_filter: home.homeFilter,
    home_category_id: home.homeCategoryId,
    home_id: home.homeId,
    page: 1,
    season_type: 1,
  };
}

function normalizeMasterRanking(data, { profileId, characterId } = {}) {
  const mine = rankingPageProps(data)?.master_rating_ranking?.my_ranking_info;
  if (!mine || typeof mine !== "object") return null;
  const expectedProfileId = String(profileId ?? "").trim();
  const actualProfileId = String(
    mine?.fighter_banner_info?.personal_info?.short_id ?? "",
  ).trim();
  if (!expectedProfileId || actualProfileId !== expectedProfileId) return null;
  if (Number(mine.character_id) !== Number(characterId)) return null;
  const rank = finitePositive(mine.master_rating_ranking);
  if (rank == null) return null;
  return {
    rank: Math.trunc(rank),
    rating: finitePositive(mine.rating),
    characterId: Number(mine.character_id),
  };
}

function rankingCacheKey({ locale, profileId, characterId, homeKey, act = 1 }) {
  return [
    String(locale ?? ""),
    String(profileId ?? ""),
    String(Number(characterId) || 0),
    sanitizeRankingHomeKey(homeKey),
    String(Number(act) || 1),
  ].join(":");
}

function shouldRefreshRanking({
  initial = false,
  homeChanged = false,
  characterChanged = false,
  newRankedMatchCount = 0,
  previousMr = null,
  currentMr = null,
  isMaster = false,
} = {}) {
  if (!isMaster) return false;
  if (initial || homeChanged || characterChanged) return true;
  return (
    Number(newRankedMatchCount) > 0 &&
    finitePositive(currentMr) != null &&
    (finitePositive(previousMr) == null || Number(previousMr) !== Number(currentMr))
  );
}

module.exports = {
  DEFAULT_RANKING_HOME,
  buildRankingHomeCatalog,
  buildCharacterSlugCatalog,
  characterSlugForId,
  normalizeMasterRanking,
  rankingCharacterSlug,
  rankingCacheKey,
  rankingHomeLabel,
  rankingHomeSelection,
  rankingRequestQuery,
  sanitizeRankingHomeKey,
  shouldRefreshRanking,
};
