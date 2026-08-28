"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rendererSource = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
  "utf8",
);

test("closed history details still render the always-visible recent matches", () => {
  const scheduleStart = rendererSource.indexOf("function scheduleHistoryRender(");
  const scheduleEnd = rendererSource.indexOf("\nfunction setHistoryPanelOpen(", scheduleStart);
  assert.notEqual(scheduleStart, -1);
  assert.notEqual(scheduleEnd, -1);
  const scheduleSource = rendererSource.slice(scheduleStart, scheduleEnd);
  const closedBranch = scheduleSource.match(/if \(!historyPanelOpen\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";

  assert.match(closedBranch, /renderRecentHistoryPreview\(records\)/);
  assert.match(closedBranch, /return;/);
  assert.ok(
    closedBranch.indexOf("renderRecentHistoryPreview(records)") < closedBranch.indexOf("return;"),
    "the recent-history preview must render before the closed-panel early return",
  );
});

test("social pushes render without a panel visibility gate", () => {
  assert.match(rendererSource, /api\.onSocialState\?\.\(renderSocialState\)/);
});

test("session refresh keeps the tracking action in its active state", () => {
  const start = rendererSource.indexOf("function applyAuthenticatedPlayer(");
  const end = rendererSource.indexOf("\nasync function unwrap", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const applySource = rendererSource.slice(start, end);
  assert.match(
    applySource,
    /elements\.startTrackingButton\.disabled\s*=\s*\n?\s*Boolean\(trackerState\?\.readOnly\) \|\| !selectedPlayer \|\| Boolean\(trackerState\?\.active\)/,
  );
  assert.doesNotMatch(applySource, /startTrackingButton\.disabled\s*=\s*false/);
});
