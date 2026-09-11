"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeReplay,
  normalizeStoredRoundResults,
  sanitizeRoundResultArray,
  summarizeRoundResults,
} = require("../src/source-client");

function replay({ player1Rounds, player2Rounds, target = "1000", ...actFields } = {}) {
  const player = (rounds) => ({
    player: { short_id: rounds === player1Rounds ? "1000" : "2000" },
    round_results: rounds,
  });
  const raw = {
    replay_id: "synthetic-replay",
    replay_battle_type: 1,
    replay_battle_type_name: "RANKED MATCH",
    uploaded_at: 1_700_000_000,
    ...actFields,
    player1_info: player(player1Rounds),
    player2_info: player(player2Rounds),
  };
  return normalizeReplay(raw, target);
}

test("distinguishes an unscoped Act from an explicit historical Act 0", () => {
  const missing = replay({ player1Rounds: [1], player2Rounds: [0] });
  assert.equal(missing.actId, null);
  assert.equal(missing.actIdKnown, false);

  const blank = replay({
    player1Rounds: [1],
    player2Rounds: [0],
    replay_season_id: "",
  });
  assert.equal(blank.actId, null);
  assert.equal(blank.actIdKnown, false);

  const explicitZero = replay({
    player1Rounds: [1],
    player2Rounds: [0],
    replay_season_id: 0,
  });
  assert.equal(explicitZero.actId, 0);
  assert.equal(explicitZero.actIdKnown, true);

  const explicitLatest = replay({
    player1Rounds: [1],
    player2Rounds: [0],
    replay_season_id: "13",
  });
  assert.equal(explicitLatest.actId, 13);
  assert.equal(explicitLatest.actIdKnown, true);
});

test("preserves player1/player2 round order after binding self and opponent", () => {
  const result = replay({ player1Rounds: [5, 0, 8], player2Rounds: [1, 4, 9] });
  assert.deepEqual(result.roundResults.self.values, [5, 0, 8]);
  assert.deepEqual(result.roundResults.opponent.values, [1, 4, 9]);
  assert.deepEqual(result.roundResults.self.counts, { "0": 1, "5": 1, "8": 1 });
  assert.deepEqual(result.roundResults.opponent.counts, { "1": 1, "4": 1, "9": 1 });
});

test("binds the same arrays to self/opponent when the target is player2", () => {
  const result = replay({ player1Rounds: [2], player2Rounds: [7, 0], target: "2000" });
  assert.deepEqual(result.roundResults.self.values, [7, 0]);
  assert.deepEqual(result.roundResults.opponent.values, [2]);
  assert.equal(result.result, "draw");
});

test("fails closed for unknown or malformed codes while retaining diagnostics", () => {
  const unknown = replay({ player1Rounds: [9], player2Rounds: [0] });
  assert.equal(unknown.result, "unknown");
  assert.deepEqual(unknown.roundResults.self.values, [9]);

  const malformed = replay({ player1Rounds: ["5", true], player2Rounds: [0] });
  assert.equal(malformed.result, "unknown");
  assert.deepEqual(malformed.roundResults.self.values, []);

  const mixed = replay({ player1Rounds: [1, 9], player2Rounds: [0, 0] });
  assert.equal(mixed.result, "unknown");
});

test("derives a result only from known integer codes 1 through 8 and zero", () => {
  const result = replay({ player1Rounds: [1, 0], player2Rounds: [0, 0] });
  assert.equal(result.result, "win");
});

test("does not classify all-zero round results as a draw", () => {
  assert.equal(replay({ player1Rounds: [0], player2Rounds: [0] }).result, "unknown");
  assert.equal(replay({ player1Rounds: [0, 0], player2Rounds: [0, 0] }).result, "unknown");
  assert.equal(replay({ player1Rounds: [0], player2Rounds: [1, 0] }).result, "loss");
});

test("does not infer a draw from empty round arrays", () => {
  const bothEmpty = replay({ player1Rounds: [], player2Rounds: [] });
  assert.equal(bothEmpty.result, "unknown");
  assert.deepEqual(bothEmpty.roundResults.self.values, []);
  assert.deepEqual(bothEmpty.roundResults.opponent.values, []);

  const oneEmpty = replay({ player1Rounds: [], player2Rounds: [1] });
  assert.equal(oneEmpty.result, "unknown");
});

test("keeps missing side explicit without inventing an empty result", () => {
  const result = replay({ player1Rounds: [6], player2Rounds: undefined });
  assert.deepEqual(result.roundResults.self.values, [6]);
  assert.equal(result.roundResults.opponent, null);
  assert.equal(result.result, "unknown");
  assert.equal(normalizeReplay({ player1_info: {}, player2_info: {} }, "1000"), null);
});

test("retains unknown bounded integer codes and drops malformed values", () => {
  assert.deepEqual(sanitizeRoundResultArray([0, 8, 9, 255, -1, 256, 1.5, "5", true, null]), [0, 8, 9, 255]);
  assert.deepEqual(summarizeRoundResults([9, 9, 0]), {
    values: [9, 9, 0],
    count: 3,
    counts: { "0": 1, "9": 2 },
  });
});

test("preserves multi-battle round groups for selected-match display", () => {
  const result = replay({
    player1Rounds: [[1, 0, 5], [0, 6]],
    player2Rounds: [[0, 2, 0], [7, 0]],
  });
  assert.deepEqual(result.roundResults.self.battles.map((battle) => battle.values), [[1, 0, 5], [0, 6]]);
  assert.deepEqual(result.roundResults.opponent.battles.map((battle) => battle.values), [[0, 2, 0], [7, 0]]);
});

test("retains official character labels with the requested locale", () => {
  const result = normalizeReplay({
    replay_id: "localized-replay",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_000,
    player1_info: {
      player: { short_id: "1000" },
      playing_character_name: "Ed",
    },
    player2_info: {
      player: { short_id: "2000" },
      playing_character_name: "Ken",
    },
  }, "1000", "en");
  assert.deepEqual(result.characterNamesByLocale, {
    en: { own: "Ed", opponent: "Ken" },
  });
});

test("prefers localized replay display labels over stable English tool names", () => {
  const result = normalizeReplay({
    replay_id: "localized-display-precedence",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_001,
    player1_info: {
      player: { short_id: "1000" },
      playing_character_id: 1,
      playing_character_name: "GOUKI",
      playing_character_display_name: "豪鬼",
    },
    player2_info: {
      player: { short_id: "2000" },
      playing_character_id: 2,
      playing_character_name: "ALEX",
      playing_character_display_name: "アレックス",
    },
  }, "1000", "ja-jp");
  assert.deepEqual(result.characterNamesByLocale, {
    "ja-jp": { own: "豪鬼", opponent: "アレックス" },
  });
  assert.equal(result.ownCharacterName, "豪鬼");
  assert.equal(result.opponentCharacterName, "アレックス");
});

test("accepts the official alpha/display aliases used by localized payloads", () => {
  const result = normalizeReplay({
    replay_id: "localized-alpha-alias",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_002,
    player1_info: {
      player: { short_id: "1000" },
      playing_character_id: 3,
      playing_character_name: "ZANGIEF",
      character_alpha: "桑吉尔夫",
    },
    player2_info: {
      player: { short_id: "2000" },
      playing_character_id: 4,
      playing_character_name: "CAMMY",
      character: { display_name: "嘉米" },
    },
  }, "1000", "zh-hans");
  assert.deepEqual(result.characterNamesByLocale, {
    "zh-hans": { own: "桑吉尔夫", opponent: "嘉米" },
  });
});

test("does not let an empty primary character id hide a valid alias", () => {
  const result = normalizeReplay({
    replay_id: "character-id-alias",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_003,
    player1_info: {
      player: { short_id: "1000" },
      playing_character_id: 0,
      characterId: 5,
      playing_character_display_name: "ブランカ",
    },
    player2_info: {
      player: { short_id: "2000" },
      playing_character_id: null,
      character_id: 6,
      playing_character_display_name: "リリー",
    },
  }, "1000", "ja-jp");
  assert.equal(result.characterId, 5);
  assert.equal(result.opponentCharacterId, 6);
});

test("does not register canonical English names as non-English labels", () => {
  const result = normalizeReplay({
    replay_id: "non-english-canonical-only",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_004,
    player1_info: {
      player: { short_id: "1000" },
      playing_character_id: 7,
      playing_character_name: "RYU",
    },
    player2_info: {
      player: { short_id: "2000" },
      playing_character_id: 8,
      playing_character_name: "TERRY",
    },
  }, "1000", "zh-hans");
  assert.equal(result.ownCharacterName, "");
  assert.equal(result.opponentCharacterName, "");
  assert.equal(result.characterNamesByLocale, undefined);
});

test("non-English locale payloads never register internal names when display fields are absent", () => {
  const locales = [
    "ja-jp", "en", "de", "es-es", "es-us", "fr", "it", "ko-kr",
    "zh-hans", "zh-hant", "pt-br", "pl", "ru", "ar",
  ];
  for (const locale of locales) {
    const result = normalizeReplay({
      replay_id: `canonical-only-${locale}`,
      replay_battle_type: 1,
      uploaded_at: 1_700_000_005,
      player1_info: {
        player: { short_id: "1000" },
        playing_character_id: 1,
        playing_character_name: "GOUKI",
      },
      player2_info: {
        player: { short_id: "2000" },
        playing_character_id: 2,
        playing_character_name: "ALEX",
      },
    }, "1000", locale);
    if (locale === "en") {
      assert.deepEqual(result.characterNamesByLocale, {
        en: { own: "GOUKI", opponent: "ALEX" },
      });
    } else {
      assert.equal(result.characterNamesByLocale, undefined, locale);
      assert.equal(result.ownCharacterName, "", locale);
      assert.equal(result.opponentCharacterName, "", locale);
    }
  }
});

test("maps the official battle input enum to C and M", () => {
  const modern = normalizeReplay({
    replay_id: "modern-input",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_000,
    player1_info: {
      player: { short_id: "1000" },
      battle_input_type: 1,
      battle_input_type_name: "[t]モダン",
      round_results: [1],
    },
    player2_info: {
      player: { short_id: "2000" },
      battle_input_type: 0,
      battle_input_type_name: "[t]クラシック",
      round_results: [0],
    },
  }, "1000");
  const classic = normalizeReplay({
    replay_id: "classic-input",
    replay_battle_type: 1,
    uploaded_at: 1_700_000_000,
    player1_info: {
      player: { short_id: "1000" },
      battle_input_type: 1,
      battle_input_type_name: "[t]モダン",
      round_results: [1],
    },
    player2_info: {
      player: { short_id: "2000" },
      battle_input_type: 0,
      battle_input_type_name: "[t]クラシック",
      round_results: [0],
    },
  }, "2000");
  assert.equal(modern.opponentBattleInputType, "C");
  assert.equal(classic.opponentBattleInputType, "M");
});

test("old records without round results remain compatible and stored summaries are re-sanitized", () => {
  assert.equal(normalizeStoredRoundResults(undefined), null);
  assert.equal(normalizeStoredRoundResults({}), null);
  assert.deepEqual(normalizeStoredRoundResults({ self: { values: [3, "4", 10] } }), {
    self: { values: [3, 10], count: 2, counts: { "3": 1, "10": 1 } },
    opponent: null,
  });
});

test("history persistence reads the optional summary without backfilling old records", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(main, /const normalizedRoundResults = normalizeStoredRoundResults\(value\.roundResults\)/);
  assert.match(main, /\.\.\.\(normalizedRoundResults \? \{ roundResults: normalizedRoundResults \} : \{\}\)/);
  assert.match(main, /\["win", "loss", "draw", "unknown"\]/);

  const opponentInsight = fs.readFileSync(path.join(__dirname, "..", "src", "opponent-insight.js"), "utf8");
  assert.match(opponentInsight, /else if \(record\?\.result === "draw"\) result\.draws \+= 1/);
});
