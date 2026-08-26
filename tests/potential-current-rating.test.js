"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  deriveHistoryRatingSeries,
} = require("../src/history-current-rating");
const { potentialRatingValue } = require("../src/potential-rating");

function record(replayId, playedAt, value, type = "MR", characterId = 1) {
  return {
    replayId,
    playedAt,
    uploadedAt: playedAt,
    matchType: "ranked",
    ownRating: value,
    ownRatingType: type,
    characterId,
  };
}

function profile(overrides = {}) {
  return {
    profileId: "1234567890",
    characterId: 1,
    mr: 1465,
    ratingSource: "profile",
    profileUpdatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("final official MR replaces only the derived terminal point", () => {
  const records = [
    record("a", 100, 1450),
    record("b", 200, 1455),
    record("c", 300, 1457),
  ];
  const original = structuredClone(records);
  const derived = deriveHistoryRatingSeries(records, profile(), "MR", {
    characterId: 1,
  });

  assert.deepEqual(derived.values, [1450, 1455, 1465]);
  assert.equal(derived.currentApplied, true);
  assert.deepEqual(records, original);
  assert.equal(records.at(-1).ownRating, 1457);
});

test("final official loss is included and equal current values are harmless", () => {
  const records = [record("a", 100, 1450), record("b", 200, 1457)];
  assert.deepEqual(
    deriveHistoryRatingSeries(records, profile({ mr: 1449 }), "MR", { characterId: 1 }).values,
    [1450, 1449],
  );
  const unchanged = deriveHistoryRatingSeries(records, profile({ mr: 1457 }), "MR", {
    characterId: 1,
  });
  assert.deepEqual(unchanged.values, [1450, 1457]);
  assert.equal(unchanged.currentApplied, true);
});

test("missing, non-profile, and mismatched-character values fall back to snapshots", () => {
  const records = [record("a", 100, 1450), record("b", 200, 1457)];
  assert.deepEqual(
    deriveHistoryRatingSeries(records, profile({ ratingSource: "search", mr: 1465 }), "MR", {
      characterId: 1,
    }).values,
    [1450, 1457],
  );
  assert.deepEqual(
    deriveHistoryRatingSeries(records, profile({ characterId: 2, mr: 1465 }), "MR", {
      characterId: 1,
    }).values,
    [1450, 1457],
  );
  assert.deepEqual(
    deriveHistoryRatingSeries(records, profile({ mr: null }), "MR", { characterId: 1 }).values,
    [1450, 1457],
  );
  assert.deepEqual(
    deriveHistoryRatingSeries(
      records,
      profile({ profileUpdatedAt: 150 }),
      "MR",
      { characterId: 1 },
    ).values,
    [1450, 1457],
  );
});

test("LP uses the LP profile value and does not cross the MR series", () => {
  const records = [
    record("a", 100, 18_000, "LP"),
    record("b", 200, 18_100, "LP"),
    record("mr", 300, 1_500, "MR"),
  ];
  const derived = deriveHistoryRatingSeries(
    records,
    profile({ mr: null, lp: 18_240 }),
    "LP",
    { characterId: 1 },
  );
  assert.deepEqual(derived.values, [18_000, 18_240]);
  assert.deepEqual(records.map((item) => item.ownRating), [18_000, 18_100, 1_500]);
});

test("parallel LP snapshots remain available when the primary match type is MR", () => {
  const records = [
    { ...record("a", 100, 1800, "MR"), ownMr: 1800, ownLp: 18_000 },
    { ...record("b", 200, 1810, "MR"), ownMr: 1810, ownLp: 18_120 },
  ];
  const derived = deriveHistoryRatingSeries(
    records,
    profile({ mr: 1810, lp: 18_240 }),
    "LP",
    { characterId: 1 },
  );
  assert.deepEqual(derived.values, [18_000, 18_240]);
  assert.equal(records.at(-1).ownLp, 18_120);
});

test("one sample still has no potential estimate, while twenty samples keep the existing limit", () => {
  const one = deriveHistoryRatingSeries([record("a", 100, 1450)], profile(), "MR", {
    characterId: 1,
  });
  assert.equal(potentialRatingValue(one.values, "MR"), null);

  const records = Array.from({ length: 20 }, (_, index) =>
    record(String(index), index + 1, 1400 + index),
  );
  const derived = deriveHistoryRatingSeries(records, profile({ mr: 1465 }), "MR", {
    characterId: 1,
  });
  assert.equal(derived.values.length, 20);
  assert.equal(derived.values.at(-1), 1465);
  assert.equal(
    potentialRatingValue(derived.values.slice(-20), "MR"),
    potentialRatingValue(derived.values, "MR"),
  );
});

test("history renderer consumes the same derived value instead of parallel persisted fields", () => {
  const rendererSource = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  const start = rendererSource.indexOf("function historyRatingValue(");
  const end = rendererSource.indexOf("\nfunction formatHistoryRating(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(rendererSource.slice(start, end), context);
  const value = context.historyRatingValue({
    ownRating: 1457,
    ownRatingType: "MR",
    ownMr: 9999,
    derivedOwnRating: 1465,
  }, "MR");
  assert.equal(value, 1465);
});

test("history detail potential uses the derived terminal profile value", () => {
  const rendererSource = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  const selectedStart = rendererSource.indexOf("function historySelectedCharacterId(");
  const start = rendererSource.indexOf("function selectHistoryPotentialRating(");
  const selectedEnd = rendererSource.indexOf("\nfunction historyDerivedRecordsForRating", selectedStart);
  const end = rendererSource.indexOf("\nfunction renderHistoryFetchStatus", start);
  assert.notEqual(selectedStart, -1);
  assert.notEqual(selectedEnd, -1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = {
    elements: { historyPotentialLabel: { textContent: "" } },
    historyDerivedRecordsForRating: (records) => records,
    historyRatingValue: (record) => Number(record.derivedOwnRating ?? record.ownRating),
    t: (_key, fallback) => fallback,
    window: { MatchPotentialRating: { potentialRatingValue } },
  };
  vm.runInNewContext(
    `${rendererSource.slice(selectedStart, selectedEnd)}\n${rendererSource.slice(start, end)}`,
    context,
  );

  const records = [
    record("a", 100, 1450),
    { ...record("b", 200, 1457), derivedRatingType: "MR", derivedOwnRating: 1465 },
  ];
  const result = context.selectHistoryPotentialRating(records, {
    characterId: 1,
    mr: 1465,
  });

  assert.equal(result.value, potentialRatingValue([1450, 1465], "MR"));
  assert.notEqual(result.value, potentialRatingValue([1450, 1457], "MR"));
});

test("history character filter drives potential and rating derivation", () => {
  const rendererSource = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  const selectedStart = rendererSource.indexOf("function historySelectedCharacterId(");
  const derivedStart = rendererSource.indexOf("function historyDerivedRecordsForRating(", selectedStart);
  const valueStart = rendererSource.indexOf("function historyRatingValue(", derivedStart);
  const selectStart = rendererSource.indexOf("function selectHistoryPotentialRating(", valueStart);
  const selectedEnd = rendererSource.indexOf("\nfunction historyDerivedRecordsForRating", selectedStart);
  const derivedEnd = rendererSource.indexOf("\nfunction historyRatingValue", derivedStart);
  const valueEnd = rendererSource.indexOf("\nfunction formatHistoryRating", valueStart);
  const selectEnd = rendererSource.indexOf("\nfunction renderHistoryFetchStatus", selectStart);
  assert.ok([selectedStart, derivedStart, valueStart, selectStart, selectedEnd, derivedEnd, valueEnd, selectEnd]
    .every((index) => index >= 0));

  const records = [
    record("ed-a", 100, 1800, "MR", 19),
    record("ed-b", 200, 1810, "MR", 19),
    record("terry-a", 300, 1880, "MR", 27),
    record("terry-b", 400, 1890, "MR", 27),
  ];
  const context = {
    elements: {
      historyCharacter: { value: "27" },
      historyPotentialLabel: { textContent: "" },
    },
    historyState: {
      records,
      player: { characterId: 19, mr: 1810 },
    },
    t: (_key, fallback) => fallback,
    window: {
      MatchHistoryCurrentRating: { deriveHistoryRatingSeries },
      MatchPotentialRating: { potentialRatingValue },
    },
  };
  const snippet = [
    rendererSource.slice(selectedStart, selectedEnd),
    rendererSource.slice(derivedStart, derivedEnd),
    rendererSource.slice(valueStart, valueEnd),
    rendererSource.slice(selectStart, selectEnd),
  ].join("\n");
  vm.runInNewContext(snippet, context);

  const result = context.selectHistoryPotentialRating(records, context.historyState.player);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.value, potentialRatingValue([1880, 1890], "MR"));
});
