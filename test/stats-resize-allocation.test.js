"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "..", "src", "renderer", "stats.css"),
  "utf8",
);
const main = fs.readFileSync(
  path.join(__dirname, "..", "src", "main.js"),
  "utf8",
);

test("combined output keeps a fixed graph track and gives extra height to cards", () => {
  assert.match(
    css,
    /\.stats-window:not\(\.no-chart\):not\(\.no-metrics\) \{[\s\S]*?--stats-chart-track-height: 160px;[\s\S]*?minmax\(44px, 1fr\)[\s\S]*?minmax\(70px, var\(--stats-chart-track-height\)\)/,
  );
  assert.match(
    css,
    /\.stats-window\.vertical:not\(\.no-chart\):not\(\.no-metrics\) \{[\s\S]*?--stats-chart-track-height: 210px/,
  );
  assert.match(
    css,
    /repeat\(var\(--visible-card-count, 1\), minmax\(68px, 1fr\)\)/,
  );
  assert.match(main, /const fixedGraphArea = graphVisible \? 210 : 0/);
  assert.match(main, /fixedLayoutMinimumHeight/);
  assert.match(
    main,
    /HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE = \{[\s\S]*?window: \{ width: 520, height: 229 \}[\s\S]*?overlay: \{ width: 520, height: 229 \}/,
  );
});

test("graph-only and no-chart layouts remain outside the fixed graph rule", () => {
  assert.match(css, /\.stats-window\.no-metrics \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(css, /\.stats-window\.no-chart \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(css, /\.stats-window\.no-metrics > \.stats-chart \{[\s\S]*?inset: 4px/);
  assert.match(
    css,
    /\.stats-window\.vertical\.no-chart:not\(\.no-metrics\) \.summary \{[\s\S]*?minmax\(68px, 1fr\)/,
  );
});
