"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("metric visibility switches apply to output surfaces but not management", () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  const statsSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "stats.js"),
    "utf8",
  );
  const managementHtml = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8",
  );
  const managementVisibilityBlock = rendererSource.slice(
    rendererSource.indexOf("function renderDisplayItemVisibility"),
    rendererSource.indexOf("function renderDisplaySettings"),
  );

  assert.doesNotMatch(managementVisibilityBlock, /card\.classList\.toggle/);
  assert.match(statsSource, /displayItems\[card\.dataset\.displayCard\]/);
  assert.match(
    managementHtml,
    /class="monitor-metric monitor-character"[\s\S]*?id="currentCharacter"/,
  );
  assert.doesNotMatch(
    managementHtml,
    /data-display-card="currentCharacter"/,
  );
  assert.match(managementHtml, /id="monitorPlayerName"/);
  assert.match(managementHtml, /id="sessionPeakRating"/);
  assert.doesNotMatch(managementHtml, /data-display-card="sessionPeak"/);
});
