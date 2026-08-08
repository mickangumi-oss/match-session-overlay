"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("graph-only output removes the metric-row gap and fills the frame", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "stats.css"),
    "utf8",
  );
  const rootRule = css.match(/\.stats-window\.no-metrics\s*\{([^}]*)\}/)?.[1] ?? "";
  const chartRule =
    css.match(/\.stats-window\.no-metrics > \.stats-chart\s*\{([^}]*)\}/)?.[1] ?? "";
  const actionRule =
    css.match(
      /\.stats-window > \.floating-window-actions\s*\{([^}]*)\}/,
    )?.[1] ?? "";

  assert.match(rootRule, /grid-template-rows:\s*minmax\(0, 1fr\)/);
  assert.match(rootRule, /gap:\s*0\s*!important/);
  assert.match(rootRule, /padding:\s*4px\s*!important/);
  assert.match(chartRule, /position:\s*absolute\s*!important/);
  assert.match(chartRule, /inset:\s*4px/);
  assert.match(chartRule, /grid-column:\s*auto\s*!important/);
  assert.match(chartRule, /grid-row:\s*auto\s*!important/);
  assert.match(chartRule, /height:\s*auto\s*!important/);
  assert.match(chartRule, /min-height:\s*0/);
  assert.match(actionRule, /position:\s*absolute/);
  assert.match(actionRule, /top:\s*3px/);
});

test("graph-only output has readable orientation-specific minimum sizes", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8",
  );

  assert.match(
    mainSource,
    /horizontal:\s*\{\s*width:\s*420,\s*height:\s*220\s*\}/,
  );
  assert.match(
    mainSource,
    /vertical:\s*\{\s*width:\s*360,\s*height:\s*220\s*\}/,
  );
  assert.match(mainSource, /const graphOnly = metricCount === 0 && graphVisible/);
});

test("horizontal cards with a graph cannot shrink below a readable size", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8",
  );

  assert.match(
    mainSource,
    /const HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE = \{\s*width:\s*520,\s*height:\s*240,\s*\}/,
  );
  assert.match(
    mainSource,
    /const horizontalGraphWithMetrics = metricCount > 0 && graphVisible/,
  );
  assert.match(
    mainSource,
    /horizontalGraphWithMetrics\s*\? HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE\.height/,
  );
});
