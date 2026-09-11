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
const { scheduleHistoryBackfill } = require("../src/history-backfill-scheduler");
const { filterHistoryBackfillReplays } = require("../src/history-backfill-filter");

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

test("startup history import waits for latest Act proof and refreshes stored rows once per scope", () => {
  const start = renderer.indexOf("function recheckHistoryReadiness");
  const end = renderer.indexOf("async function selectHistoryTarget", start);
  const source = renderer.slice(start, end);
  assert.match(source, /currentActId = verifiedCurrentHistoryActId\(state\)/);
  assert.match(source, /if \(currentActId == null\)/);
  assert.match(source, /historyAutoFetchScopeKey/);
  assert.doesNotMatch(source, /hasStoredRecords/);
  assert.match(source, /historyAutoFetchAttemptedScope === scopeKey/);
});

test("history target selection publishes local rows before optional locale backfill", () => {
  const start = main.indexOf("async function selectHistoryProfile");
  const end = main.indexOf("async function clearHistoryProfileSelection", start);
  const source = main.slice(start, end);
  const publish = source.indexOf("sendHistoryState();");
  const backfill = source.indexOf("scheduleHistoryBackfill({");
  assert.ok(publish >= 0, "target selection must publish the local history");
  assert.ok(backfill > publish, "optional locale backfill must start after publication");
  assert.match(source, /generation === privateDataGeneration/);
  assert.match(source, /activeHistoryProfileId\(\) === localeBackfillProfileId/);
  assert.match(source, /serviceLocale\(\) === localeBackfillLocale/);
  assert.match(source, /matchHistoryFetchScopeToken === selectionScopeToken/);
  assert.match(main, /matchHistoryFetchProfileId === normalizedProfileId/);
  assert.match(main, /matchHistoryFetchLocale === requestedLocale/);
  assert.match(main, /const initialStoredRecords = store\.records\.map/);
});

test("history backfill publishes only after a current delayed enrichment", async () => {
  let resolveBackfill;
  let current = true;
  let published = 0;
  const backfill = new Promise((resolve) => { resolveBackfill = resolve; });
  const startedAt = Date.now();
  const scheduled = scheduleHistoryBackfill({
    backfill: () => backfill,
    isCurrent: () => current,
    publish: () => { published += 1; },
  });
  await Promise.resolve();
  assert.ok(Date.now() - startedAt < 100, "selection must not wait for backfill");
  assert.equal(published, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveBackfill();
  await scheduled;
  assert.equal(published, 1);
});

test("history backfill drops stale and rejected enrichment without clearing display", async () => {
  let rejectBackfill;
  let current = true;
  let published = 0;
  const scheduled = scheduleHistoryBackfill({
    backfill: () => new Promise((_, reject) => { rejectBackfill = reject; }),
    isCurrent: () => current,
    publish: () => { published += 1; },
  });
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  current = false;
  rejectBackfill(new Error("synthetic backfill failure"));
  await scheduled;
  assert.equal(published, 0);
});

test("history backfill drops a stale successful enrichment", async () => {
  let resolveBackfill;
  let current = true;
  let published = 0;
  const scheduled = scheduleHistoryBackfill({
    backfill: () => new Promise((resolve) => { resolveBackfill = resolve; }),
    isCurrent: () => current,
    publish: () => { published += 1; },
  });
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  current = false;
  resolveBackfill();
  await scheduled;
  assert.equal(published, 0);
});

test("history backfill cannot publish replays that were not already stored", () => {
  const labelReplays = filterHistoryBackfillReplays(
    [{ replayId: "known" }],
    [{ replayId: "known" }, { replayId: "new" }],
  );
  assert.deepEqual(labelReplays.map((replay) => replay.replayId), ["known"]);
});

test("history backfill uses a fixed record snapshot during a concurrent merge", () => {
  const storeRecords = [{ replayId: "known" }];
  const initialStoredRecords = storeRecords.map((record) => ({ replayId: record.replayId }));
  storeRecords.push({ replayId: "new" });
  const labelReplays = filterHistoryBackfillReplays(
    initialStoredRecords,
    [{ replayId: "known" }, { replayId: "new" }],
  );
  assert.deepEqual(labelReplays.map((replay) => replay.replayId), ["known"]);
});

test("Act changes refresh a changed scope but retain the scoped context cache", () => {
  const start = renderer.indexOf("function selectHistoryRecord");
  const end = renderer.indexOf("function renderHistoryTable", start);
  const source = renderer.slice(start, end);
  assert.match(source, /historyOpponentProfileState\.requestScope === requestScope/);
  assert.match(source, /requestScope,\r?\n    context: null/);
  const actHandler = renderer.slice(renderer.indexOf('elements.historyAct?.addEventListener("change"'), renderer.indexOf('elements.historyRatingPeriod?.addEventListener', renderer.indexOf('elements.historyAct?.addEventListener("change"')));
  assert.doesNotMatch(actHandler, /forceRefresh:\s*true/);
});
