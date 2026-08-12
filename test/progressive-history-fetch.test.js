"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
const rendererSource = fs.readFileSync(
  path.join(root, "src", "renderer", "renderer.js"),
  "utf8",
);
const i18nSource = fs.readFileSync(
  path.join(root, "src", "renderer", "i18n.js"),
  "utf8",
);

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf(") {", start) + 2;
  assert.ok(bodyStart > 1, `${name} must have a function body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} must have a closing brace`);
}

test("paginated history fetch publishes each synthetic page before deciding whether to stop", () => {
  const source = functionSource(mainSource, "fetchMatchHistoryPages");
  const callbackIndex = source.indexOf("await onPage({ ...result, page, replays: [...result.replays] });");
  const stopIndex = source.indexOf("if (result.rawCount < MATCH_HISTORY_PAGE_SIZE) break;");

  assert.match(source, /for \(let page = 1; page <= MATCH_HISTORY_MAX_PAGES; page \+= 1\)/);
  assert.match(source, /const result = await fetchRankedReplaysPage\(profileId, page\)/);
  assert.notEqual(callbackIndex, -1, "the page callback must receive only that page's records");
  assert.notEqual(stopIndex, -1, "the final short page must stop pagination");
  assert.ok(callbackIndex < stopIndex, "a short final page must still be published");
});

test("each fetched page merges records and publishes cumulative progress, then clears it", () => {
  const source = functionSource(mainSource, "fetchLocalMatchHistory");

  assert.match(source, /matchHistoryFetchProgress = \{[\s\S]*?page: 0,[\s\S]*?fetchedCount: 0,/);
  assert.match(source, /fetchedCount \+= replays\.length/);
  assert.match(source, /matchHistoryFetchProgress = \{[\s\S]*?page,[\s\S]*?maxPages: MATCH_HISTORY_MAX_PAGES,[\s\S]*?fetchedCount,/);
  assert.match(source, /const changed = mergeMatchHistory\(replays, player\.profileId\);/);
  assert.match(source, /if \(!changed\) sendHistoryState\(\);/);
  assert.match(source, /finally \{[\s\S]*?matchHistoryFetchInFlight = null;[\s\S]*?matchHistoryFetchProgress = null;[\s\S]*?sendHistoryState\(\);/);
});

test("renderer keeps the import action disabled and shows page/count progress while fetching", () => {
  const source = functionSource(rendererSource, "renderHistoryFetchStatus");

  assert.match(source, /const canFetch = Boolean\(historyState\.authenticated\)[\s\S]*?!historyState\.fetching/);
  assert.match(source, /fetchHistoryButton\.disabled = !canFetch/);
  assert.match(source, /historyState\.fetching\s*\?\s*t\("historyFetching", "Loading…"\)/);
  assert.match(source, /t\("historyFetchProgress", "Loading page \{page\}\/\{max\} · \{count\} fetched"\)/);
  assert.match(source, /replace\("\{page\}", String\(historyState\.fetchPage \|\| 1\)\)/);
  assert.match(source, /replace\("\{count\}", String\(historyState\.fetchedCount \|\| 0\)\)/);
});

test("English and Japanese include loading and fetched-count history messages", () => {
  assert.match(i18nSource, /historyFetching: "Loading…"/);
  assert.match(i18nSource, /historyFetchProgress: "Loading page \{page\}\/\{max\} · \{count\} fetched"/);
  assert.match(i18nSource, /historyFetching: "読み込み中…"/);
  assert.match(i18nSource, /historyFetchProgress: "読み込み中：\{page\}\/\{max\}ページ・\{count\}件取得済み"/);
});

test("selecting another history player refreshes that profile once for its MR rank", () => {
  const selectSource = functionSource(mainSource, "selectHistoryProfile");
  const rankingSource = functionSource(mainSource, "publicRankingState");

  assert.match(
    selectSource,
    /refreshProfilePlayer\(nextHistoryViewPlayer, \{\s*force: true,?\s*\}\)/,
  );
  assert.match(rankingSource, /explicitOtherPlayerRankingAllowed\(\{/);
  assert.match(rankingSource, /historyProfileId: historyViewPlayer\?\.profileId/);
  assert.match(rankingSource, /Number\(player\?\.mr\) > 0/);
  assert.match(rankingSource, /profileRank > 0/);
  assert.match(rankingSource, /homeKey: "all"/);
});

test("stopping a session cancels delayed ranking refreshes", () => {
  assert.match(functionSource(mainSource, "autoStopTracking"), /clearAllRankingRetryTimers\(\)/);
  assert.match(functionSource(mainSource, "stopTracking"), /clearAllRankingRetryTimers\(\)/);
});
