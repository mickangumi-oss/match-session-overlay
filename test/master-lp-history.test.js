"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeReplay } = require("../src/source-client");

const root = path.join(__dirname, "..");

test("a synthetic MASTER replay preserves MR and LP in parallel", () => {
  const replay = normalizeReplay({
    replay_id: "synthetic-replay-001",
    replay_battle_type: 1,
    replay_battle_type_name: "Ranked Match",
    uploaded_at: 1_700_000_000,
    player1_info: {
      player: { short_id: "1000000001", fighter_id: "SYNTHETIC PLAYER" },
      playing_character_id: 26,
      playing_character_name: "SYNTHETIC CHARACTER",
      master_rating: 1510,
      league_point: 123456,
      round_results: [1, 1],
    },
    player2_info: {
      player: { short_id: "1000000002", fighter_id: "SYNTHETIC OPPONENT" },
      playing_character_id: 1,
      playing_character_name: "SYNTHETIC OPPONENT CHARACTER",
      master_rating: 1500,
      league_point: 120000,
      round_results: [0, 0],
    },
  }, "1000000001");

  assert.equal(replay.ownRatingType, "MR");
  assert.equal(replay.ownRating, 1510);
  assert.equal(replay.ownMr, 1510);
  assert.equal(replay.ownLp, 123456);
});

test("history storage and charts keep MASTER LP separate from the primary MR display", () => {
  const main = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8");

  assert.match(main, /ownMr:\s*finiteOrNull\(/);
  assert.match(main, /ownLp:\s*finiteOrNull\(/);
  assert.match(main, /ownLp:\s*replay\?\.ownLp \?\? replay\?\.lp \?\? previous\?\.ownLp/);
  assert.match(main, /function applyCurrentProfileRatingsToHistory/);
  assert.match(renderer, /function historyRatingValue/);
  assert.match(renderer, /normalizedType === "MR" \? record\?\.ownMr : record\?\.ownLp/);
  assert.match(renderer, /record\.ownRating == null \? "—" : `\$\{record\.ownRatingType \|\| ""\} \$\{record\.ownRating\}`/);
});

test("opponent-character statistics use the full filtered history set", () => {
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/style.css"), "utf8");

  assert.match(html, /<script src="\.\.\/history-opponent-character-stats\.js"><\/script>/);
  assert.match(html, /id="historyOpponentStatsBody"/);
  assert.match(html, /id="historyOpponentMatchesSort"/);
  assert.match(html, /id="historyOpponentWinRateSort"/);
  assert.match(renderer, /const records = filteredHistoryRecords\(\);[\s\S]*?renderOpponentCharacterStats\(records\);/);
  assert.doesNotMatch(renderer, /renderOpponentCharacterStats\(pageRecords\)/);
  assert.match(renderer, /let historyOpponentSort = \{ key: "matches", direction: "desc" \}/);
  assert.match(renderer, /historyOpponentSort\.key === "matches"/);
  assert.match(renderer, /historyOpponentSort\.key === "winRate"/);
  assert.match(renderer, /historyOpponentSort\.direction/);
  assert.match(html, /id="historyOpponentWinRateHeader" aria-sort="none"/);
  assert.match(css, /grid-template-rows:\s*auto 356px auto minmax\(0, 1fr\)/);
  assert.match(css, /\.history-table-scroll \{ height: 100%; max-height: none; overflow-x: hidden; overflow-y: auto; \}/);
  assert.match(css, /\.history-match-table \{ table-layout: fixed; \}/);
  assert.match(css, /\.history-opponent-stats-scroll \{[^}]*overflow: auto;/);
});

test("match history omits the own-player column while retaining the opponent link column", () => {
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/style.css"), "utf8");

  const historyTable = html.match(/<table class="history-match-table">([\s\S]*?)<\/table>/)?.[1] || "";
  assert.match(historyTable, /date[\s\S]*result[\s\S]*matchType[\s\S]*myCharacter[\s\S]*rating[\s\S]*opponent[\s\S]*opponentCharacter[\s\S]*opponentRating/);
  assert.doesNotMatch(historyTable, /data-i18n="player"/);
  assert.doesNotMatch(renderer, /record\.ownName \|\| "—"/);
  assert.match(renderer, /if \(index === 5\) \{[\s\S]*opponentUserCode/);
  assert.equal((css.match(/\.history-match-table th:nth-child\(/g) || []).length, 8);
});
