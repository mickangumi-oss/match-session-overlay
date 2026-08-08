"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_RANKING_HOME,
  buildRankingHomeCatalog,
  normalizeMasterRanking,
  rankingCharacterSlug,
  rankingCacheKey,
  rankingHomeLabel,
  rankingRequestQuery,
  shouldRefreshRanking,
} = require("../src/ranking-model");
const { normalizeSocialPage } = require("../src/social-model");
const {
  DISPLAY_ITEM_KEYS,
  defaultDisplayItems,
} = require("../src/display-settings");
const { buildPresentationState } = require("../src/presentation-model");

function fixtureRankingPage({ rank = 321, profileId = "synthetic-profile-a", characterId = 77 } = {}) {
  return {
    pageProps: {
      home_category_id: [
        { value: 0, label: "All homes" },
        { value: 1, label: "Synthetic region one" },
        { value: 7, label: "Country group" },
      ],
      home_id: [
        { value: 0, label: "All countries" },
        { value: 41, label: "Synthetic country" },
      ],
      character_id: [{ value: characterId, url_name: "character-synthetic" }],
      master_rating_ranking: {
        my_ranking_info: {
          master_rating_ranking: rank,
          rating: 1701,
          character_id: characterId,
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
} = {}) {
  return {
    registered_at: 1_700_000_000,
    fighter_banner_info: {
      favorite_character_id: characterId,
      favorite_character_name: "Synthetic character",
      favorite_character_tool_name: "synthetic-character",
      last_play_at: 1_700_000_200,
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
}

test("HOME catalog and official ranking query preserve grouped selections", () => {
  const catalog = buildRankingHomeCatalog(fixtureRankingPage());
  assert.deepEqual(catalog, {
    all: { value: "all", label: "All homes" },
    regions: [{ value: "region:1", label: "Synthetic region one" }],
    countries: [{ value: "country:41", label: "Synthetic country" }],
  });
  assert.equal(rankingHomeLabel(catalog, "country:41"), "Synthetic country");
  assert.equal(rankingHomeLabel(catalog, "unknown"), "All homes");

  assert.deepEqual(rankingRequestQuery({
    characterSlug: "character-synthetic",
    homeKey: "region:1",
  }), {
    character_filter: 4,
    character_id: "character-synthetic",
    platform: 1,
    home_filter: 2,
    home_category_id: 1,
    home_id: 0,
    page: 1,
    season_type: 1,
  });
  assert.deepEqual(rankingRequestQuery({
    characterSlug: "CHARACTER-SYNTHETIC",
    homeKey: "country:41",
  }), {
    character_filter: 4,
    character_id: "character-synthetic",
    platform: 1,
    home_filter: 3,
    home_category_id: 7,
    home_id: 41,
    page: 1,
    season_type: 1,
  });
  assert.equal(DEFAULT_RANKING_HOME, "all");
});

test("ranking result requires exact profile and character identity", () => {
  const page = fixtureRankingPage();
  assert.deepEqual(normalizeMasterRanking(page, {
    profileId: "synthetic-profile-a",
    characterId: 77,
  }), { rank: 321, rating: 1701, characterId: 77 });
  assert.equal(normalizeMasterRanking(page, {
    profileId: "synthetic-profile-other",
    characterId: 77,
  }), null);
  assert.equal(normalizeMasterRanking(page, {
    profileId: "synthetic-profile-a",
    characterId: 78,
  }), null);
  assert.equal(normalizeMasterRanking(fixtureRankingPage({ rank: 0 }), {
    profileId: "synthetic-profile-a",
    characterId: 77,
  }), null);
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

test("ranking cache keys isolate locale, player, character, HOME, and act", () => {
  const base = {
    locale: "en",
    profileId: "synthetic-profile-a",
    characterId: 77,
    homeKey: "all",
    act: 1,
  };
  const baseKey = rankingCacheKey(base);
  for (const changed of [
    { locale: "ja-jp" },
    { profileId: "synthetic-profile-b" },
    { characterId: 78 },
    { homeKey: "region:1" },
    { act: 2 },
  ]) {
    assert.notEqual(rankingCacheKey({ ...base, ...changed }), baseKey);
  }
});

test("ranking refresh only follows allowed Master-MR transitions", () => {
  const master = { isMaster: true, previousMr: 1600, currentMr: 1600 };
  assert.equal(shouldRefreshRanking({ ...master, initial: true }), true);
  assert.equal(shouldRefreshRanking({ ...master, homeChanged: true }), true);
  assert.equal(shouldRefreshRanking({ ...master, characterChanged: true }), true);
  assert.equal(shouldRefreshRanking({ ...master, newRankedMatchCount: 1 }), false);
  assert.equal(shouldRefreshRanking({
    ...master,
    currentMr: 1601,
    newRankedMatchCount: 2,
  }), true);
  assert.equal(shouldRefreshRanking({
    isMaster: true,
    previousMr: null,
    currentMr: 1500,
    newRankedMatchCount: 1,
  }), true);
  assert.equal(shouldRefreshRanking({
    ...master,
    currentMr: 1601,
    newRankedMatchCount: 0,
  }), false);
  assert.equal(shouldRefreshRanking({
    initial: true,
    isMaster: false,
    previousMr: 1600,
    currentMr: 1601,
  }), false);
});

test("non-Master ranking stays null for the UI dash representation", () => {
  const presentation = buildPresentationState({ ranking: { rank: null, status: "ready" } });
  assert.equal(presentation.mrRank, null);
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

test("social players sort online first, retain official order within each group, and hide zero-only hub servers", () => {
  const page = normalizeSocialPage({
    pageProps: {
      friend_list: [
        fixtureSocialEntry({
          profileId: "synthetic-offline-first",
          name: "Synthetic offline first",
          characterId: 101,
          status: "LOGOUT",
          battleHubServer: "0000",
        }),
        fixtureSocialEntry({
          profileId: "synthetic-online-first",
          name: "Synthetic online first",
          characterId: 102,
          status: "BATTLE_HUB",
          battleHubServer: "007",
        }),
        fixtureSocialEntry({
          profileId: "synthetic-online-second",
          name: "Synthetic online second",
          characterId: 103,
          status: "MENU",
        }),
        fixtureSocialEntry({
          profileId: "synthetic-offline-second",
          name: "Synthetic offline second",
          characterId: 104,
          status: "OFFLINE",
        }),
      ],
    },
  }, "friends");

  assert.deepEqual(page.players.map((player) => player.profileId), [
    "synthetic-online-first",
    "synthetic-online-second",
    "synthetic-offline-first",
    "synthetic-offline-second",
  ]);
  assert.equal(page.players[0].battleHubServer, "007");
  assert.equal(page.players[2].battleHubServer, "");
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

test("MR RANK is a shared output item and management has independent visibility", () => {
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
  assert.doesNotMatch(indexHtml, /data-display-card="mrRank"/);
});

test("management DOM contains every moved setting and ranking/social control exactly once", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8",
  );
  for (const id of [
    "currentMrRank",
    "currentMrRankHome",
    "rankingHomeInput",
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
