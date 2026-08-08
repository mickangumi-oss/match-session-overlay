"use strict";

const SOCIAL_KINDS = new Set(["friends", "following"]);
const SOCIAL_DISPLAY_PAGE_SIZE = 10;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeTimestamp(value) {
  const number = finitePositive(value);
  if (number != null) return number < 10_000_000_000 ? number * 1000 : number;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function meaningfulHubValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^0+$/.test(normalized) ? normalized : "";
}

function officialRankName(banner, league, hasMasterRating) {
  const rankInfo = league?.league_rank_info ?? league?.rank_info ?? {};
  const candidates = [
    league?.league_rank_name,
    league?.rank_name,
    league?.league_name,
    rankInfo?.league_rank_name,
    rankInfo?.rank_name,
    rankInfo?.name,
    banner?.favorite_character_league_rank_name,
  ];
  const official = candidates
    .map((value) => String(value ?? "").trim())
    .find((value) => value && !/^\d+$/.test(value));
  // A positive MR is itself an exact MASTER classification. This fallback is
  // used only when the list payload omits its localized rank label.
  return official ?? (hasMasterRating ? "MASTER" : "");
}

function normalizeSocialPlayer(entry) {
  const banner = entry?.fighter_banner_info ?? {};
  const personal = banner.personal_info ?? {};
  const online = banner.online_status_info ?? {};
  const status = online.online_status_data ?? {};
  const statusName = String(status.online_status_name ?? "").trim();
  const league = banner.favorite_character_league_info ?? {};
  const profileId = String(personal.short_id ?? "").trim();
  const name = String(personal.fighter_id ?? "").trim();
  if (!profileId || !name) return null;
  const mr = finitePositive(league.master_rating);
  const lp = finitePositive(league.league_point);
  const lastLoginAt = normalizeTimestamp(
    online.last_login_at ??
    banner.last_login_at ??
    personal.last_login_at ??
    entry?.last_login_at,
  );
  const lastPlayedAt = normalizeTimestamp(banner.last_play_at);
  return {
    profileId,
    name,
    platform: String(personal.platform_name ?? "").trim(),
    platformKey: String(personal.platform_tool_name ?? "").trim(),
    characterId: Number(banner.favorite_character_id) || null,
    characterName: String(banner.favorite_character_name ?? "").trim(),
    characterKey: String(banner.favorite_character_tool_name ?? "").trim(),
    rating: mr ?? lp,
    ratingType: mr != null ? "MR" : lp != null ? "LP" : null,
    rankName: officialRankName(banner, league, mr != null),
    online: statusName
      ? !["LOGOUT", "OFFLINE"].includes(statusName.toUpperCase())
      : Number(online.online_status) > 1,
    statusName,
    statusType: Number(status.online_status_type) || null,
    battleHubRegion: meaningfulHubValue(online.battlehub_region_name),
    battleHubServer: meaningfulHubValue(online.battlehub_formated_server_no),
    lastLoginAt,
    lastPlayedAt,
    lastActivityAt: lastLoginAt ?? lastPlayedAt,
    registeredAt: normalizeTimestamp(entry?.registered_at),
  };
}

function socialActivityAt(player) {
  return Number(
    player?.lastLoginAt ?? player?.lastPlayedAt ?? player?.registeredAt ?? 0,
  ) || 0;
}

function sortSocialPlayers(players) {
  return [...(Array.isArray(players) ? players : [])]
    .map((player, index) => ({ player, index }))
    .sort((left, right) =>
      Number(right.player.online) - Number(left.player.online) ||
      socialActivityAt(right.player) - socialActivityAt(left.player) ||
      left.index - right.index)
    .map(({ player }) => player);
}

function paginateSocialPlayers(players, page = 1, pageSize = SOCIAL_DISPLAY_PAGE_SIZE) {
  const source = Array.isArray(players) ? players : [];
  const size = Math.max(1, Math.trunc(Number(pageSize) || SOCIAL_DISPLAY_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(source.length / size));
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Math.trunc(Number(page) || 1)),
  );
  const offset = (currentPage - 1) * size;
  const visiblePlayers = source.slice(offset, offset + size);
  return {
    page: currentPage,
    totalPages,
    pageSize: visiblePlayers.length,
    players: visiblePlayers,
  };
}

function socialSourcePagePlan({
  appPage = 1,
  sourcePageSize = SOCIAL_DISPLAY_PAGE_SIZE,
  sourceTotalPages = 1,
  lastSourceCount = null,
  displayPageSize = SOCIAL_DISPLAY_PAGE_SIZE,
} = {}) {
  const displaySize = Math.max(1, Math.trunc(Number(displayPageSize) || SOCIAL_DISPLAY_PAGE_SIZE));
  const sourceSize = Math.max(displaySize, Math.trunc(Number(sourcePageSize) || displaySize));
  const sourcePages = Math.max(1, Math.trunc(Number(sourceTotalPages) || 1));
  const chunksPerSourcePage = Math.max(1, Math.ceil(sourceSize / displaySize));
  const lastChunks = lastSourceCount == null
    ? 1
    : Math.max(1, Math.ceil(Math.max(0, Number(lastSourceCount) || 0) / displaySize));
  const totalPages = Math.max(
    1,
    (sourcePages - 1) * chunksPerSourcePage + lastChunks,
  );
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Math.trunc(Number(appPage) || 1)),
  );
  return {
    appPage: currentPage,
    totalPages,
    chunksPerSourcePage,
    sourcePage: Math.floor((currentPage - 1) / chunksPerSourcePage) + 1,
    sourceOffset: ((currentPage - 1) % chunksPerSourcePage) * displaySize,
  };
}

function pageProps(data) {
  return data?.pageProps ?? data?.props?.pageProps ?? {};
}

function normalizeSocialPage(data, kind, fallbackPage = 1) {
  const normalizedKind = SOCIAL_KINDS.has(kind) ? kind : "friends";
  const props = pageProps(data);
  const source = normalizedKind === "following"
    ? props.followed_fighter_banner_list
    : props.friend_list;
  const players = sortSocialPlayers((Array.isArray(source) ? source : [])
    .map(normalizeSocialPlayer)
    .filter(Boolean));
  const page = Math.max(
    1,
    Math.trunc(Number(props.page) || Number(fallbackPage) || 1),
  );
  const totalPages = Math.max(
    page,
    Math.trunc(Number(props.total_page ?? props.total_pages) || page),
  );
  return {
    kind: normalizedKind,
    page,
    totalPages,
    pageSize: players.length,
    players,
  };
}

module.exports = {
  normalizeSocialPage,
  normalizeSocialPlayer,
  paginateSocialPlayers,
  socialActivityAt,
  socialSourcePagePlan,
  sortSocialPlayers,
};
