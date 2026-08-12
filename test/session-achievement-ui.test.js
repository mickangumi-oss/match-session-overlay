"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("management header keeps identity and achievements independent from output visibility", () => {
  const html = read("src/renderer/index.html");
  const orderedIds = [
    "monitorPlayerName",
    "currentCharacter",
    "sessionPeakRating",
    "currentMrRank",
    "trackerStatus",
  ];
  let previous = -1;
  for (const id of orderedIds) {
    const index = html.indexOf(`id="${id}"`);
    assert.ok(index > previous, `${id} must follow the requested header order`);
    previous = index;
  }
  assert.match(html, /<span>CURRENT<\/span><span>CHARACTER<\/span>/);
  assert.match(html, /<span>SESSION<\/span><span>PEAK<\/span>/);
  assert.match(html, /<span>CHARACTER<\/span><span>RANK<\/span>/);
  assert.match(html, /data-display-item="sessionPeak"/);
  assert.doesNotMatch(html, /data-display-item="currentCharacter"/);
});

test("window and overlay omit identity and supplemental labels but show achievement cards", () => {
  const html = read("src/renderer/stats.html");
  const renderer = read("src/renderer/stats.js");
  assert.doesNotMatch(html, /data-display-card="currentCharacter"/);
  assert.doesNotMatch(html, /id="currentCharacter"/);
  assert.match(html, /data-display-card="sessionPeak"/);
  assert.match(html, /id="mrRankDelta"/);
  assert.doesNotMatch(html, /id="mrRankHome"/);
  assert.doesNotMatch(html, /id="medianRatingSample"/);
  assert.match(renderer, /elements\.mrRankDelta\.textContent/);
  assert.match(renderer, /elements\.sessionPeakRating\.textContent/);
});

test("numeric fitting includes large LP and six-digit rank output without horizontal transforms", () => {
  const renderer = read("src/renderer/stats.js");
  const css = read("src/renderer/stats.css");
  assert.match(renderer, /elements\.sessionPeakRating/);
  assert.match(renderer, /elements\.mrRank/);
  assert.match(renderer, /ResizeObserver/);
  assert.doesNotMatch(css, /transform:\s*scaleX\(/);
});

test("rank movement stays centered inside the CHARACTER RANK card", () => {
  const css = read("src/renderer/stats.css");
  assert.match(
    css,
    /\.stats-window \.rank-delta\s*\{[\s\S]*?text-align:\s*center;/,
  );
});

test("a missing potential rating never becomes a zero chart baseline", () => {
  const stats = read("src/renderer/stats.js");
  const renderer = read("src/renderer/renderer.js");
  for (const source of [stats, renderer]) {
    assert.match(
      source,
      /const potentialValue = potentialRating == null \? null : Number\(potentialRating\);/,
    );
    assert.match(
      source,
      /Number\.isFinite\(potentialValue\) && potentialValue > 0/,
    );
  }
});

test("live and read-only history presentations use separate achievement state", () => {
  const main = read("src/main.js");
  assert.match(main, /let sessionAchievementState = restoredTrackerSession\.achievementState/);
  assert.match(main, /let historySessionAchievementState = createSessionAchievementState\(\)/);
  assert.match(main, /historyView:\s*Boolean\(viewState\)/);
  assert.match(main, /historyView\s*\?\s*historySessionAchievementState\s*:\s*sessionAchievementState/);
});
