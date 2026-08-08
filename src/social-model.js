"use strict";

const SOCIAL_KINDS = new Set(["friends", "following"]);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeTimestamp(value) {
  const number = finitePositive(value);
  if (number == null) return null;
  return number < 10_000_000_000 ? number * 1000 : number;
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
    lastPlayedAt: normalizeTimestamp(banner.last_play_at),
    registeredAt: normalizeTimestamp(entry?.registered_at),
  };
}

function pageProps(data) {
  return data?.pageProps ?? data?.props?.pageProps ?? {};
}

function normalizeSocialPage(data, kind) {
  const normalizedKind = SOCIAL_KINDS.has(kind) ? kind : "friends";
  const props = pageProps(data);
  const source = normalizedKind === "following"
    ? props.followed_fighter_banner_list
    : props.friend_list;
  const players = (Array.isArray(source) ? source : [])
    .map(normalizeSocialPlayer)
    .filter(Boolean)
    // Keep the official order within each presence group while bringing
    // players who are currently online to the top of the page.
    .sort((left, right) => Number(right.online) - Number(left.online));
  const page = Math.max(1, Math.trunc(Number(props.page) || 1));
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

module.exports = { normalizeSocialPage, normalizeSocialPlayer };
