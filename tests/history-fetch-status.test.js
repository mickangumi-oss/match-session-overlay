"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "src", "preload.js"), "utf8");
const renderer = fs.readFileSync(
  path.join(root, "src", "renderer", "renderer.js"),
  "utf8",
);

test("history progress is delivered separately from full history redraws", () => {
  assert.match(main, /webContents\.send\("history:progress"/);
  assert.match(main, /sendHistoryFetchProgress\(\);/);
  assert.match(preload, /onHistoryProgress:/);
  assert.match(preload, /ipcRenderer\.on\("history:progress"/);
  assert.match(renderer, /api\.onHistoryProgress\?\.\(\(progress\) =>/);
  assert.match(renderer, /historyState = \{ \.\.\.historyState, \.\.\.progress \};/);
  assert.match(renderer, /renderHistoryFetchStatus\(\);/);
});

test("the terminal import state is published before optional post-processing", () => {
  const start = main.indexOf("async function fetchLocalMatchHistory");
  assert.notEqual(start, -1);
  const end = main.indexOf("async function selectHistoryProfile", start);
  const source = main.slice(start, end);
  const terminal = source.indexOf('status: "complete"');
  const progressClear = source.indexOf("matchHistoryFetchProgress = null", terminal);
  const profileRefresh = source.indexOf("await refreshProfilePlayer", terminal);
  assert.ok(terminal >= 0, "complete summary must exist");
  assert.ok(progressClear > terminal, "progress must be cleared after summary creation");
  assert.ok(profileRefresh > progressClear, "optional profile refresh must not block completion UI");
  assert.match(source, /fetchTerminalStateSent = true/);
  assert.match(source, /!fetchTerminalStateSent/);
});
