"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const rendererSource = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
  "utf8",
);
const functionStart = rendererSource.indexOf("function historyRatingDelta(");
const functionEnd = rendererSource.indexOf("\nfunction filteredHistoryRecords(", functionStart);
assert.notEqual(functionStart, -1);
assert.notEqual(functionEnd, -1);
const context = {};
vm.runInNewContext(rendererSource.slice(functionStart, functionEnd), context);
const historyRatingDelta = context.historyRatingDelta;

test("latest MR uses the current profile MR instead of a later history record", () => {
  const latest = { ownRatingType: "MR", ownRating: 2000, characterId: 1, playedAt: 200 };
  const laterByTimestamp = { ownRatingType: "MR", ownRating: 2001, characterId: 1, playedAt: 300 };
  assert.equal(
    historyRatingDelta(latest, [latest, laterByTimestamp], { characterId: 1, mr: 2008 }, { useCurrentRating: true }),
    8,
  );
});

test("latest LP uses the current profile LP", () => {
  const latest = { ownRatingType: "LP", ownRating: 18000, characterId: 2, playedAt: 200 };
  assert.equal(
    historyRatingDelta(latest, [latest], { characterId: 2, lp: 18040 }, { useCurrentRating: true }),
    40,
  );
});

test("older rows keep using the next match rating", () => {
  const older = { ownRatingType: "MR", ownRating: 1990, characterId: 1, playedAt: 100 };
  const newer = { ownRatingType: "MR", ownRating: 1998, characterId: 1, playedAt: 200 };
  assert.equal(
    historyRatingDelta(older, [older, newer], { characterId: 1, mr: 2010 }),
    8,
  );
});

test("a missing current value does not create a false delta from zero", () => {
  const latest = { ownRatingType: "LP", ownRating: 18000, characterId: 2, playedAt: 200 };
  assert.equal(
    historyRatingDelta(latest, [latest], { characterId: 2, lp: null }, { useCurrentRating: true }),
    null,
  );
});
