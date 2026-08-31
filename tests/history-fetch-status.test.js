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

test("new history rows are published only after the profile refresh", () => {
  const start = main.indexOf("async function fetchLocalMatchHistory");
  assert.notEqual(start, -1);
  const end = main.indexOf("async function selectHistoryProfile", start);
  const source = main.slice(start, end);
  const profileRefresh = source.indexOf("await refreshProfilePlayer");
  const merge = source.indexOf(
    "mergeMatchHistory(importReplays, player.profileId, { persist: false, notify: false })",
  );
  const persist = source.indexOf("persistMatchHistoryStore(player.profileId, fetchedStore)");
  const terminal = source.indexOf('status: "complete"');
  const progressClear = source.indexOf("matchHistoryFetchProgress = null", terminal);
  assert.ok(profileRefresh >= 0, "new rows must trigger a profile refresh");
  assert.ok(merge > profileRefresh, "history rows must merge after profile refresh");
  assert.ok(persist > merge, "history rows must persist after the guarded merge");
  assert.ok(terminal > persist, "complete status must follow guarded persistence");
  assert.ok(progressClear > terminal, "progress must be cleared after complete status");
  assert.match(source, /historyProfileCoversLatestRecord\(nextPlayer, \[\.\.\.existing\.records, \.\.\.importReplays\]\)/);
  assert.match(source, /publishHistoryState = false/);
  assert.match(source, /throw new Error\("PROFILE_REFRESH_NOT_CONFIRMED"\)/);
  assert.match(source, /fetchTerminalStateSent = true/);
  assert.match(source, /!fetchTerminalStateSent/);
  assert.match(source, /newReplayCount === 0 && completedReplays\.length/);
});

test("history polling does not persist a new row before profile verification", () => {
  const start = main.indexOf("async function runHistoryViewPoll");
  const end = main.indexOf("function historyViewTrackerState", start);
  const source = main.slice(start, end);
  const profileRefresh = source.indexOf("await refreshProfilePlayer");
  const merge = source.indexOf("mergeMatchHistory(replays, profileId, { notify: false })");
  const persist = source.indexOf("persistMatchHistoryStore(profileId, fetchedStore)");
  assert.ok(profileRefresh >= 0, "new rows must trigger a profile refresh");
  assert.ok(merge > profileRefresh, "polled rows must merge after profile refresh");
  assert.ok(persist > merge, "polled rows must persist after the guarded merge");
  assert.match(source, /historyProfileCoversLatestRecord\(refreshedPlayer, \[\.\.\.store\.records, \.\.\.replays\]\)/);
});
