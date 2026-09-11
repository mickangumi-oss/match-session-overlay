"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOpponentCharacterStats,
  filterHistoryRecords,
} = require("../src/history-opponent-character-stats");

test("filters opponent stats by the normalized official input type", () => {
  const records = [
    { opponentCharacterId: 1, result: "win", opponentBattleInputType: "C" },
    { opponentCharacterId: 1, result: "loss", opponentBattleInputType: "M" },
    { opponentCharacterId: 2, result: "draw", opponentBattleInputType: null },
  ];
  assert.equal(filterHistoryRecords(records, { inputType: "all" }).length, 3);
  assert.deepEqual(filterHistoryRecords(records, { inputType: "C" }), [records[0]]);
  assert.deepEqual(filterHistoryRecords(records, { inputType: "M" }), [records[1]]);
});

test("filters history by explicit Act without treating missing Act data as zero", () => {
  const records = [
    { replayId: "ACT-13", actId: 13, matchType: "ranked" },
    { replayId: "ACT-12", actId: 12, matchType: "casual" },
    { replayId: "ACT-UNKNOWN", actId: null, matchType: "battleHub" },
  ];
  assert.deepEqual(
    filterHistoryRecords(records, { act: "13" }).map((record) => record.replayId),
    ["ACT-13"],
  );
  assert.deepEqual(
    filterHistoryRecords(records, { act: "12" }).map((record) => record.replayId),
    ["ACT-12"],
  );
  assert.deepEqual(
    filterHistoryRecords(records, { act: "all" }).map((record) => record.replayId),
    ["ACT-13", "ACT-12", "ACT-UNKNOWN"],
  );
});

test("latest view may include unscoped rows but explicit Act never adopts them", () => {
  const records = [
    { replayId: "ACT-13", actId: 13, actIdKnown: true },
    { replayId: "ACT-0", actId: 0, actIdKnown: true },
    { replayId: "LEGACY-0", actId: 0 },
    { replayId: "UNKNOWN", actId: null, actIdKnown: false },
  ];
  assert.deepEqual(
    filterHistoryRecords(records, { act: "13", includeUnknownAct: true })
      .map((record) => record.replayId),
    ["ACT-13", "LEGACY-0", "UNKNOWN"],
  );
  assert.deepEqual(
    filterHistoryRecords(records, { act: "0", includeUnknownAct: false })
      .map((record) => record.replayId),
    ["ACT-0"],
  );
});

test("uses the selected locale label retained on the history record", () => {
  const stats = buildOpponentCharacterStats([
    {
      opponentCharacterId: 31,
      opponentCharacterName: "",
      characterNamesByLocale: {
        "ja-jp": { opponent: "アレックス" },
        en: { opponent: "Alex" },
      },
      result: "win",
      uploadedAt: 1_700_000_000,
    },
  ], { locale: "en" });

  assert.equal(stats.length, 1);
  assert.equal(stats[0].label, "Alex");
  assert.equal(stats[0].winRate, 100);
});

test("does not fall back to a different locale snapshot", () => {
  const stats = buildOpponentCharacterStats([
    {
      opponentCharacterId: 99,
      opponentCharacterName: "日本語名",
      characterNamesByLocale: { "ja-jp": { opponent: "日本語名" } },
      result: "loss",
      uploadedAt: 1_700_000_000,
    },
  ], { locale: "ko-kr" });

  assert.equal(stats.length, 1);
  assert.equal(stats[0].label, "");
});
