"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOpponentCharacterStats,
  filterHistoryRecords,
  sortOpponentCharacterStats,
} = require("../src/history-opponent-character-stats");

test("groups wins, losses, and draws by opponent character ID", () => {
  const stats = buildOpponentCharacterStats([
    { opponentCharacterId: 1, opponentCharacterName: "Ryu", result: "win" },
    { opponentCharacterId: 1, opponentCharacterName: "Ryu", result: "loss" },
    { opponentCharacterId: 1, opponentCharacterName: "Ryu", result: "draw" },
    { opponentCharacterId: 2, opponentCharacterName: "Ken", result: "win" },
  ]);

  assert.deepEqual(stats, [
    {
      characterId: 1,
      label: "Ryu",
      matches: 3,
      wins: 1,
      losses: 1,
      draws: 1,
      winRate: 50,
    },
    {
      characterId: 2,
      label: "Ken",
      matches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      winRate: 100,
    },
  ]);
});

test("uses the newest non-empty character name and ignores invalid IDs", () => {
  const stats = buildOpponentCharacterStats([
    { opponentCharacterId: 5, opponentCharacterName: "Luke", result: "win", uploadedAt: 20 },
    { opponentCharacterId: 5, opponentCharacterName: "", result: "loss", playedAt: 30 },
    { opponentCharacterId: 5, opponentCharacterName: "ルーク", result: "draw", playedAt: 40 },
    { opponentCharacterId: 0, opponentCharacterName: "Ignored", result: "win" },
    { opponentCharacterId: Number.NaN, opponentCharacterName: "Ignored", result: "win" },
  ]);

  assert.deepEqual(stats, [
    {
      characterId: 5,
      label: "ルーク",
      matches: 3,
      wins: 1,
      losses: 1,
      draws: 1,
      winRate: 50,
    },
  ]);
});

test("sorts by match count, then win rate, then label", () => {
  const stats = buildOpponentCharacterStats([
    { opponentCharacterId: 1, opponentCharacterName: "Charlie", result: "draw" },
    { opponentCharacterId: 1, opponentCharacterName: "Charlie", result: "draw" },
    { opponentCharacterId: 2, opponentCharacterName: "Bravo", result: "win" },
    { opponentCharacterId: 2, opponentCharacterName: "Bravo", result: "loss" },
    { opponentCharacterId: 3, opponentCharacterName: "Alpha", result: "win" },
    { opponentCharacterId: 3, opponentCharacterName: "Alpha", result: "loss" },
    { opponentCharacterId: 4, opponentCharacterName: "Delta", result: "win" },
    { opponentCharacterId: 4, opponentCharacterName: "Delta", result: "loss" },
  ]);

  assert.deepEqual(stats.map((entry) => entry.characterId), [3, 2, 4, 1]);
  assert.equal(stats.at(-1).winRate, 0);
});

test("sorts independently by match count or win rate in both directions", () => {
  const entries = [
    { characterId: 1, label: "Alpha", matches: 3, winRate: 25 },
    { characterId: 2, label: "Bravo", matches: 3, winRate: 75 },
    { characterId: 3, label: "Charlie", matches: 8, winRate: 40 },
    { characterId: 4, label: "Delta", matches: 8, winRate: 60 },
  ];

  assert.deepEqual(
    sortOpponentCharacterStats(entries, { key: "matches", direction: "desc" }).map((entry) => entry.characterId),
    [4, 3, 2, 1],
  );
  assert.deepEqual(
    sortOpponentCharacterStats(entries, { key: "matches", direction: "asc" }).map((entry) => entry.characterId),
    [2, 1, 4, 3],
  );
  assert.deepEqual(
    sortOpponentCharacterStats(entries, { key: "winRate", direction: "desc" }).map((entry) => entry.characterId),
    [2, 4, 3, 1],
  );
  assert.deepEqual(
    sortOpponentCharacterStats(entries, { key: "winRate", direction: "asc" }).map((entry) => entry.characterId),
    [1, 3, 4, 2],
  );
});

test("uses match count then label as stable win-rate tie breakers", () => {
  const entries = [
    { characterId: 1, label: "Bravo", matches: 3, winRate: 50 },
    { characterId: 2, label: "Alpha", matches: 3, winRate: 50 },
    { characterId: 3, label: "Charlie", matches: 8, winRate: 50 },
  ];

  assert.deepEqual(
    sortOpponentCharacterStats(entries, { key: "winRate", direction: "desc" }).map((entry) => entry.characterId),
    [3, 2, 1],
  );
});

test("date, mode, and own-character filters combine before aggregation", () => {
  const records = [
    { playedAt: "2026-08-01", matchType: "ranked", characterId: 1, opponentCharacterId: 10 },
    { playedAt: "2026-08-02", matchType: "ranked", characterId: 1, opponentCharacterId: 11 },
    { playedAt: "2026-08-02", matchType: "casual", characterId: 1, opponentCharacterId: 12 },
    { playedAt: "2026-08-02", matchType: "ranked", characterId: 2, opponentCharacterId: 13 },
    { playedAt: "2026-08-03", matchType: "ranked", characterId: 1, opponentCharacterId: 14 },
  ];
  const filtered = filterHistoryRecords(
    records,
    { from: "2026-08-02", to: "2026-08-02", mode: "ranked", character: "1" },
    (record) => record.playedAt,
  );
  assert.deepEqual(filtered.map((record) => record.opponentCharacterId), [11]);
});
