"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer", "renderer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "renderer", "style.css"), "utf8");

test("MR and LP share one period and date display control", () => {
  assert.equal((html.match(/id="historyRatingPeriod"/g) ?? []).length, 1);
  assert.equal((html.match(/id="historyRatingDateMode"/g) ?? []).length, 1);
  assert.match(html, /<option value="all"[^>]*data-i18n="historyRatingPeriodAll"/);
  assert.match(html, /<option value="week"[^>]*data-i18n="historyRatingPeriodWeek"/);
  assert.match(html, /<option value="played"[^>]*data-i18n="historyRatingDatePlayed"/);
  assert.match(html, /<option value="all"[^>]*data-i18n="historyRatingDateAll"/);
  assert.match(html, /id="historyRatingWeekPrevious"/);
  assert.match(html, /id="historyRatingWeekNext"/);
  assert.match(html, /class="history-rating-heading"/);
});

test("period and date changes redraw both rating charts from one shared series", () => {
  const chartRenderer = renderer.slice(
    renderer.indexOf("function renderHistoryRatingCharts("),
    renderer.indexOf("\nfunction drawHistoryRatingChart(", renderer.indexOf("function renderHistoryRatingCharts(")),
  );
  assert.match(chartRenderer, /drawHistoryRatingChart\(records, "MR"/);
  assert.match(chartRenderer, /drawHistoryRatingChart\(records, "LP"/);
  assert.match(renderer, /buildHistoryRatingSeries\(records/);
  assert.match(renderer, /dateMode/);
  assert.match(css, /\.history-rating-toolbar\s*\{/);
  assert.match(css, /\.history-rating-heading\s*\{/);
  assert.match(css, /\.history-rating-date-select\s*\{/);
  assert.match(css, /\.history-rating-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
});
