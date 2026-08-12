"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  explicitOtherPlayerRankingAllowed,
  normalizeLeagueRanking,
  normalizeMasterRanking,
  rankingCharacterSlug,
  rankingCacheKey,
  rankingRequestQuery,
  rankingRetryScopeMatches,
  resolveRankingFetchResult,
  shouldRefreshRanking,
} = require("../src/ranking-model");
const {
  normalizeSocialPage,
  paginateSocialPlayers,
  socialSourcePagePlan,
} = require("../src/social-model");
const {
  DISPLAY_ITEM_KEYS,
  defaultDisplayItems,
} = require("../src/display-settings");
const { buildPresentationState } = require("../src/presentation-model");

function fixtureRankingPage({
  rank = 999_999,
  filteredOrder = 321,
  profileId = "synthetic-profile-a",
  characterId = 22,
  characterSlug = "character-synthetic",
} = {}) {
  return {
    pageProps: {
      master_rating_ranking: {
        my_ranking_info: {
          order: filteredOrder,
          master_rating_ranking: rank,
          rating: 1701,
          character_id: characterId,
          character_tool_name: characterSlug,
          fighter_banner_info: { personal_info: { short_id: profileId } },
        },
      },
    },
  };
}

function fixtureLeagueRankingPage({
  rank = 8_539,
  profileId = "synthetic-profile-a",
  characterId = 22,
  characterSlug = "character-synthetic",
} = {}) {
  return {
    pageProps: {
      league_point_ranking: {
        my_ranking_info: {
          order: rank,
          league_point: 188_063,
          character_id: characterId,
          character_tool_name: characterSlug,
          fighter_banner_info: { personal_info: { short_id: profileId } },
        },
      },
    },
  };
}

function fixtureSocialEntry({
  profileId,
  name,
  characterId,
  status = "ONLINE",
  masterRating = 1600,
  battleHubServer = "007",
  lastPlayedAt = 1_700_000_200,
  lastLoginAt = null,
} = {}) {
  const entry = {
    registered_at: 1_700_000_000,
    fighter_banner_info: {
      favorite_character_id: characterId,
      favorite_character_name: "Synthetic character",
      favorite_character_tool_name: "synthetic-character",
      last_play_at: lastPlayedAt,
      personal_info: {
        short_id: profileId,
        fighter_id: name,
        platform_name: "Synthetic platform",
        platform_tool_name: "synthetic-platform",
      },
      favorite_character_league_info: {
        master_rating: masterRating,
        league_point: 0,
      },
      online_status_info: {
        online_status: 2,
        online_status_data: {
          online_status_name: status,
          online_status_type: 4,
        },
        battlehub_region_name: "Synthetic hub",
        battlehub_formated_server_no: battleHubServer,
      },
    },
  };
  if (lastLoginAt != null) {
    entry.fighter_banner_info.online_status_info.last_login_at = lastLoginAt;
  }
  return entry;
}

test("official ranking query always forces all homes and platforms", () => {
  assert.deepEqual(rankingRequestQuery({
    characterSlug: "character-synthetic",
  }), {
    character_filter: 4,
    character_id: "character-synthetic",
    platform: 1,
    home_filter: 1,
    home_category_id: 0,
    home_id: 0,
    page: 1,
    season_type: 1,
  });
  assert.deepEqual(rankingRequestQuery({
    characterSlug: "CHARACTER-SYNTHETIC",
  }), {
    character_filter: 4,
    character_id: "character-synthetic",
    platform: 1,
    home_filter: 1,
    home_category_id: 0,
    home_id: 0,
    page: 1,
    season_type: 1,
  });
});

test("MASTER ranking uses the character-filtered order and exact profile and character slug", () => {
  const page = fixtureRankingPage();
  assert.deepEqual(normalizeMasterRanking(page, {
    profileId: "synthetic-profile-a",
    characterSlug: "character-synthetic",
  }), {
    rank: 321,
    rating: 1701,
    characterId: 22,
    characterSlug: "character-synthetic",
  });
  assert.equal(normalizeMasterRanking(page, {
    profileId: "synthetic-profile-other",
    characterSlug: "character-synthetic",
  }), null);
  assert.equal(normalizeMasterRanking(page, {
    profileId: "synthetic-profile-a",
    characterSlug: "other-character",
  }), null);
  assert.equal(normalizeMasterRanking(fixtureRankingPage({ filteredOrder: 0 }), {
    profileId: "synthetic-profile-a",
    characterSlug: "character-synthetic",
  }), null);
});

test("league ranking uses filtered order and league points", () => {
  assert.deepEqual(normalizeLeagueRanking(fixtureLeagueRankingPage(), {
    profileId: "synthetic-profile-a",
    characterSlug: "character-synthetic",
  }), {
    rank: 8_539,
    rating: 188_063,
    characterId: 22,
    characterSlug: "character-synthetic",
  });
});

test("profile ranking fallback requires an authenticated account and explicit other-player history", () => {
  const valid = {
    playerProfileId: "synthetic-history-player",
    authenticatedProfileId: "synthetic-self-player",
    historyProfileId: "synthetic-history-player",
  };
  assert.equal(explicitOtherPlayerRankingAllowed(valid), true);
  assert.equal(explicitOtherPlayerRankingAllowed({
    ...valid,
    authenticatedProfileId: "",
  }), false);
  assert.equal(explicitOtherPlayerRankingAllowed({
    ...valid,
    historyProfileId: "",
  }), false);
  assert.equal(explicitOtherPlayerRankingAllowed({
    ...valid,
    playerProfileId: "synthetic-self-player",
  }), false);
});

test("temporarily missing official ranking preserves only the same-scope last known value", () => {
  const previous = {
    rank: 12_345,
    rating: 1_500,
    characterId: 77,
    updatedAt: 100,
  };
  const first = resolveRankingFetchResult({
    normalized: null,
    previous,
    retryAttempt: 0,
    now: 200,
  });
  assert.equal(first.cacheValue, previous);
  assert.equal(first.status, "loading");
  assert.equal(first.retryDelayMs, 5_000);

  const second = resolveRankingFetchResult({
    normalized: null,
    previous,
    retryAttempt: 1,
    now: 300,
  });
  assert.equal(second.cacheValue, previous);
  assert.equal(second.retryDelayMs, 15_000);

  const exhausted = resolveRankingFetchResult({
    normalized: null,
    previous: null,
    retryAttempt: 2,
    now: 400,
  });
  assert.equal(exhausted.cacheValue, null);
  assert.equal(exhausted.status, "error");
  assert.equal(exhausted.retryDelayMs, null);

  const recovered = resolveRankingFetchResult({
    normalized: { rank: 11_111, rating: 1_510, characterId: 77 },
    previous,
    retryAttempt: 1,
    now: 500,
  });
  assert.deepEqual(recovered, {
    cacheValue: {
      rank: 11_111,
      rating: 1_510,
      characterId: 77,
      updatedAt: 500,
    },
    status: "ready",
    retryDelayMs: null,
  });
});

test("ranking retry scope rejects stale identity, character, locale, or rank type", () => {
  const expected = {
    profileId: "synthetic-self",
    characterId: 77,
    locale: "ja-jp",
    ratingType: "MR",
  };
  const current = {
    authenticatedProfileId: "synthetic-self",
    playerProfileId: "synthetic-self",
    characterId: 77,
    locale: "ja-jp",
    ratingType: "MR",
  };
  assert.equal(rankingRetryScopeMatches(expected, current), true);
  for (const changed of [
    { authenticatedProfileId: "" },
    { playerProfileId: "synthetic-other" },
    { characterId: 78 },
    { locale: "en" },
    { ratingType: "LP" },
  ]) {
    assert.equal(rankingRetryScopeMatches(expected, { ...current, ...changed }), false);
  }
});

test("ranking uses the official current-player slug for the exact character id", () => {
  assert.equal(
    rankingCharacterSlug({ characterId: 22, character: "gouki" }, 22, {}),
    "gouki",
  );
  assert.equal(
    rankingCharacterSlug({ characterId: 1, character: "luke" }, 22, {}),
    "",
  );
  assert.equal(
    rankingCharacterSlug({ characterId: 22, character: "../gouki" }, 22, {}),
    "",
  );
});

test("ranking cache keys isolate locale, player, character slug, rank type, and act", () => {
  const base = {
    locale: "en",
    profileId: "synthetic-profile-a",
    characterId: 77,
    characterSlug: "character-synthetic",
    ratingType: "MR",
    act: 1,
  };
  const baseKey = rankingCacheKey(base);
  for (const changed of [
    { locale: "ja-jp" },
    { profileId: "synthetic-profile-b" },
    { characterId: 78 },
    { characterSlug: "other-character" },
    { ratingType: "LP" },
    { act: 2 },
  ]) {
    assert.notEqual(rankingCacheKey({ ...base, ...changed }), baseKey);
  }
});

test("ranking refresh runs initially and after every ranked match", () => {
  const ranked = { currentRating: 1600 };
  assert.equal(shouldRefreshRanking({ ...ranked, initial: true }), true);
  assert.equal(shouldRefreshRanking({ ...ranked, characterChanged: true }), true);
  assert.equal(shouldRefreshRanking({ ...ranked, newRankedMatchCount: 1 }), true);
  assert.equal(shouldRefreshRanking({
    currentRating: 188_063,
    newRankedMatchCount: 2,
  }), true);
  assert.equal(shouldRefreshRanking({
    ...ranked,
    newRankedMatchCount: 0,
  }), false);
  assert.equal(shouldRefreshRanking({
    initial: true,
    currentRating: null,
  }), false);
});

test("presentation exposes character ranks for MASTER and league bands", () => {
  const master = buildPresentationState({ ranking: { rank: 321, status: "ready", ratingType: "MR" } });
  const league = buildPresentationState({ ranking: { rank: 8_539, status: "ready", ratingType: "LP" } });
  assert.equal(master.mrRank, 321);
  assert.equal(league.mrRank, 8_539);
  const statsSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "stats.js"),
    "utf8",
  );
  assert.match(statsSource, /:\s*["']—["']/);
  assert.doesNotMatch(statsSource, /NOT MASTER/);
});

test("friends and following normalize separately while preserving each page", () => {
  const friends = normalizeSocialPage({
    pageProps: {
      page: 2,
      total_page: 3,
      friend_list: [fixtureSocialEntry({
        profileId: "synthetic-friend-profile",
        name: "Synthetic friend",
        characterId: 91,
      })],
    },
  }, "friends");
  const following = normalizeSocialPage({
    pageProps: {
      page: 1,
      total_pages: 2,
      followed_fighter_banner_list: [fixtureSocialEntry({
        profileId: "synthetic-follow-profile",
        name: "Synthetic follow",
        characterId: 92,
        status: "LOGOUT",
        masterRating: 0,
      })],
    },
  }, "following");

  assert.deepEqual(
    { kind: friends.kind, page: friends.page, totalPages: friends.totalPages, pageSize: friends.pageSize },
    { kind: "friends", page: 2, totalPages: 3, pageSize: 1 },
  );
  assert.deepEqual(
    { kind: following.kind, page: following.page, totalPages: following.totalPages, pageSize: following.pageSize },
    { kind: "following", page: 1, totalPages: 2, pageSize: 1 },
  );
  assert.equal(friends.players[0].profileId, "synthetic-friend-profile");
  assert.equal(friends.players[0].online, true);
  assert.equal(following.players[0].profileId, "synthetic-follow-profile");
  assert.equal(following.players[0].online, false);
  assert.equal(following.players[0].ratingType, null);
  assert.notEqual(friends.players[0].profileId, following.players[0].profileId);
});

test("social players sort online first then by latest official activity and hide zero-only hub servers", () => {
  const page = normalizeSocialPage({
    pageProps: {
      friend_list: [
        fixtureSocialEntry({
          profileId: "synthetic-offline-first",
          name: "Synthetic offline first",
          characterId: 101,
          status: "LOGOUT",
          battleHubServer: "0000",
          lastPlayedAt: 1_700_000_400,
        }),
        fixtureSocialEntry({
          profileId: "synthetic-online-first",
          name: "Synthetic online first",
          characterId: 102,
          status: "BATTLE_HUB",
          battleHubServer: "007",
          lastPlayedAt: 1_700_000_300,
        }),
        fixtureSocialEntry({
          profileId: "synthetic-online-second",
          name: "Synthetic online second",
          characterId: 103,
          status: "MENU",
          lastLoginAt: 1_700_000_500,
        }),
        fixtureSocialEntry({
          profileId: "synthetic-offline-second",
          name: "Synthetic offline second",
          characterId: 104,
          status: "OFFLINE",
          lastPlayedAt: 1_700_000_100,
        }),
      ],
    },
  }, "friends");

  assert.deepEqual(page.players.map((player) => player.profileId), [
    "synthetic-online-second",
    "synthetic-online-first",
    "synthetic-offline-first",
    "synthetic-offline-second",
  ]);
  assert.equal(page.players[0].lastLoginAt, 1_700_000_500_000);
  assert.equal(page.players[1].battleHubServer, "007");
  assert.equal(page.players[2].battleHubServer, "");
});

test("social activity sorting falls back to last play and remains stable on ties", () => {
  const page = normalizeSocialPage({
    pageProps: {
      followed_fighter_banner_list: [
        fixtureSocialEntry({
          profileId: "synthetic-tie-first",
          name: "Synthetic tie first",
          characterId: 105,
          status: "LOGOUT",
          lastPlayedAt: 1_700_000_200,
        }),
        fixtureSocialEntry({
          profileId: "synthetic-newest",
          name: "Synthetic newest",
          characterId: 106,
          status: "LOGOUT",
          lastPlayedAt: 1_700_000_900,
        }),
        fixtureSocialEntry({
          profileId: "synthetic-tie-second",
          name: "Synthetic tie second",
          characterId: 107,
          status: "LOGOUT",
          lastPlayedAt: 1_700_000_200,
        }),
      ],
    },
  }, "following");

  assert.deepEqual(page.players.map((player) => player.profileId), [
    "synthetic-newest",
    "synthetic-tie-first",
    "synthetic-tie-second",
  ]);
});

test("social display pagination keeps at most ten synthetic players per page", () => {
  const players = Array.from({ length: 25 }, (_, index) => ({
    profileId: `synthetic-page-${String(index + 1).padStart(2, "0")}`,
  }));
  const first = paginateSocialPlayers(players, 1);
  const second = paginateSocialPlayers(players, 2);
  const third = paginateSocialPlayers(players, 3);

  assert.equal(first.players.length, 10);
  assert.equal(second.players.length, 10);
  assert.equal(third.players.length, 5);
  assert.equal(first.totalPages, 3);
  assert.equal(second.players[0].profileId, "synthetic-page-11");
  assert.equal(third.players.at(-1).profileId, "synthetic-page-25");
  assert.equal(Math.max(first.pageSize, second.pageSize, third.pageSize), 10);
  for (const [count, pages] of [[0, 1], [1, 1], [10, 1], [11, 2], [20, 2], [21, 3]]) {
    const synthetic = Array.from({ length: count }, (_, index) => ({ profileId: `case-${count}-${index}` }));
    assert.equal(paginateSocialPlayers(synthetic, 999).totalPages, pages);
    assert.ok(paginateSocialPlayers(synthetic, 999).players.length <= 10);
  }
});

test("social app pages preserve overflow entries from each official source page", () => {
  const secondOfTwentyFive = socialSourcePagePlan({
    appPage: 2,
    sourcePageSize: 25,
    sourceTotalPages: 1,
    lastSourceCount: 25,
  });
  assert.deepEqual(secondOfTwentyFive, {
    appPage: 2,
    totalPages: 3,
    chunksPerSourcePage: 3,
    sourcePage: 1,
    sourceOffset: 10,
  });

  const lastRemotePage = socialSourcePagePlan({
    appPage: 3,
    sourcePageSize: 20,
    sourceTotalPages: 2,
    lastSourceCount: 5,
  });
  assert.equal(lastRemotePage.totalPages, 3);
  assert.equal(lastRemotePage.sourcePage, 2);
  assert.equal(lastRemotePage.sourceOffset, 0);

  const unknownLastPage = socialSourcePagePlan({
    appPage: 99,
    sourcePageSize: 20,
    sourceTotalPages: 2,
  });
  assert.equal(unknownLastPage.totalPages, 3);
  assert.equal(unknownLastPage.appPage, 3);
  assert.equal(unknownLastPage.sourcePage, 2);
});

test("social normalization distinguishes a requested page from an official clamp", () => {
  const missingPage = normalizeSocialPage({
    pageProps: { total_pages: 2, friend_list: [] },
  }, "friends", 2);
  assert.equal(missingPage.page, 2);

  const clampedPage = normalizeSocialPage({
    pageProps: { page: 1, total_pages: 1, friend_list: [] },
  }, "friends", 2);
  assert.equal(clampedPage.page, 1);
  assert.equal(clampedPage.totalPages, 1);
  const reducedListPlan = socialSourcePagePlan({
    appPage: 3,
    sourcePageSize: 20,
    sourceTotalPages: clampedPage.totalPages,
    lastSourceCount: 11,
  });
  assert.equal(reducedListPlan.appPage, 2);
  assert.equal(reducedListPlan.totalPages, 2);
});

test("social rank keeps an official name, rejects numeric IDs, and falls back to MASTER only for MR", () => {
  const named = fixtureSocialEntry({
    profileId: "synthetic-rank-named",
    name: "Synthetic rank named",
    characterId: 111,
    masterRating: 0,
  });
  named.fighter_banner_info.favorite_character_league_info.league_rank_name = "Synthetic Gold";

  const numericOnly = fixtureSocialEntry({
    profileId: "synthetic-rank-numeric",
    name: "Synthetic rank numeric",
    characterId: 112,
    masterRating: 0,
  });
  numericOnly.fighter_banner_info.favorite_character_league_info.league_rank_name = "0000";
  numericOnly.fighter_banner_info.favorite_character_league_info.rank_info = { name: "1234" };

  const masterFallback = fixtureSocialEntry({
    profileId: "synthetic-rank-master",
    name: "Synthetic rank master",
    characterId: 113,
    masterRating: 1701,
  });

  const page = normalizeSocialPage({
    pageProps: { friend_list: [named, numericOnly, masterFallback] },
  }, "friends");
  const players = new Map(page.players.map((player) => [player.profileId, player]));
  assert.equal(players.get("synthetic-rank-named").rankName, "Synthetic Gold");
  assert.equal(players.get("synthetic-rank-numeric").rankName, "");
  assert.equal(players.get("synthetic-rank-master").rankName, "MASTER");
});

test("PLAYER STATUS detail includes the normalized rank name", () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  assert.match(rendererSource, /detail\.textContent\s*=\s*\[player\.platform,\s*player\.characterName,\s*player\.rankName,\s*rating\]/);
});

test("PLAYER STATUS names route the synthetic profile code to history with immediate fetch", () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  assert.match(rendererSource, /name\.dataset\.socialHistoryCode\s*=\s*String\(player\.profileId\s*\?\?\s*["']{2}\)/);
  assert.match(rendererSource, /elements\.historyTargetCode\.value\s*=\s*userCode/);
  assert.match(rendererSource, /selectHistoryTarget\(userCode,\s*\{\s*autoFetch:\s*true\s*\}\)/);
});

test("current ranking is a shared output item and management has independent visibility", () => {
  assert.ok(DISPLAY_ITEM_KEYS.includes("mrRank"));
  assert.equal(defaultDisplayItems().mrRank, true);
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8",
  );
  const statsHtml = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "stats.html"),
    "utf8",
  );
  assert.match(indexHtml, /data-display-item="mrRank"/);
  assert.match(statsHtml, /data-display-card="mrRank"/);
  assert.match(indexHtml, /id="currentMrRank"/);
  assert.doesNotMatch(indexHtml, /id="rankingHomeInput"/);
  assert.doesNotMatch(indexHtml, /data-display-card="mrRank"/);
});

test("removed ranking metadata initialization is not referenced during startup", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8",
  );
  assert.doesNotMatch(mainSource, /ensureRankingMetadata/);
});

test("management DOM contains every moved setting and ranking/social control exactly once", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8",
  );
  for (const id of [
    "currentMrRank",
    "currentMrRankHome",
    "socialFriendsTab",
    "socialFollowingTab",
    "socialRefreshButton",
    "socialList",
    "socialPreviousButton",
    "socialNextButton",
    "languageInput",
    "launchAtLoginInput",
    "gameDetectionInput",
    "chooseGameButton",
    "clearDataButton",
    "checkUpdateButton",
  ]) {
    const matches = html.match(new RegExp(`id="${id}"`, "g")) ?? [];
    assert.equal(matches.length, 1, `${id} must be unique`);
  }
  const optionsStart = html.indexOf('id="optionsPanel"');
  for (const id of [
    "languageInput",
    "launchAtLoginInput",
    "gameDetectionInput",
    "chooseGameButton",
    "clearDataButton",
    "checkUpdateButton",
  ]) {
    assert.ok(html.indexOf(`id="${id}"`) > optionsStart, `${id} must be in options`);
  }
});
