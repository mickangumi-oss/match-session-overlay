"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(
  path.join(__dirname, "..", "src", "renderer", "stats.css"),
  "utf8",
);

test("vertical rank label stays left-aligned while rank values use the right column", () => {
  assert.match(css, /\.stats-window\.vertical \.rank-group > small \{[^}]*justify-self:\s*start;/s);
  assert.match(css, /\.stats-window\.vertical \.rank-group > strong \{[^}]*grid-column:\s*2;/s);
  assert.match(css, /\.stats-window\.vertical \.rank-group > \.rank-delta \{[^}]*justify-self:\s*center;/s);
});
