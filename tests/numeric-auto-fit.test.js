"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src", "renderer", "renderer.js"), "utf8");
const stats = fs.readFileSync(path.join(root, "src", "renderer", "stats.js"), "utf8");
const managementCss = fs.readFileSync(path.join(root, "src", "renderer", "style.css"), "utf8");
const statsThemeCss = fs.readFileSync(
  path.join(root, "src", "renderer", "stats-midnight-glass.css"),
  "utf8",
);

test("metric and history card values use the management fit pass", () => {
  assert.match(renderer, /function fitScoreValue\(element, minimumSize = 8\)/);
  assert.match(stats, /function fitStatsValue\(element, minimumSize = 8\)/);
  const start = renderer.indexOf("function fitManagementScoreValues()");
  const end = renderer.indexOf("\nfunction renderNextUpdate", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const fitBlock = renderer.slice(start, end);
  for (const id of [
    "elements.medianRating",
    "elements.historyWinsLosses",
    "elements.historyWinRate",
    "elements.historyMaxStreak",
    "elements.historyMaxRating",
    "elements.historyPotentialRating",
    "elements.historyOpponentMatchRating",
    "elements.historyOpponentRecord",
    "elements.historyOpponentPotentialMr",
    "elements.historyOpponentPotentialLp",
    "elements.historyOpponentOtherRating",
  ]) {
    assert.ok(fitBlock.includes(id), `${id} must use the fit pass`);
  }
  assert.match(stats, /elements\.medianRating,[\s\S]*fitStatsValue\(element\)/);
});

test("card value typography does not block inline overflow fitting", () => {
  assert.doesNotMatch(
    managementCss,
    /\.potential-rating\s*\{[^}]*font-size:[^;}]+!important/s,
  );
  assert.doesNotMatch(
    statsThemeCss,
    /\.stats-window(?:\.vertical)? \.rank-delta\s*\{[^}]*font-size:[^;}]+!important/s,
  );
});
