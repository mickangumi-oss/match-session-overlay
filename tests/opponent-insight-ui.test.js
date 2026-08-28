const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("history table keeps the approved layout and opponent insight fields", () => {
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/style.css");
  const header = html.match(/<table class="history-match-table">\s*<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  assert.ok(header, "history table header should exist");
  assert.equal((header[1].match(/<th\b/g) || []).length, 9);
  assert.doesNotMatch(header[1], /potentialDifference/);
  assert.match(html, /<script src="\.\.\/opponent-insight\.js"><\/script>/);
  assert.match(html, /id="historyOpponentPotentialMr"/);
  assert.match(html, /id="historyOpponentPotentialLp"/);
  assert.match(html, /data-i18n="historyOpponentOtherPeak">CURRENT OTHER CHARACTER PEAK MR/);
  assert.doesNotMatch(html, /history-reference-badge/);
  assert.doesNotMatch(html, /id="historyOpponent(?:Current|Peak)Rating(?:Label)?"/);
  assert.doesNotMatch(css, /history-difference/);
});

test("renderer keeps opponent insight state independent from history rows", () => {
  const renderer = read("src/renderer/renderer.js");
  assert.match(renderer, /historyOpponentInsightCache = new Map/);
  assert.match(renderer, /renderHistoryTable\(pageRecords\)/);
  assert.match(renderer, /historyOpponentInsightCache\.delete\(insightKey\)/);
  assert.match(renderer, /historyOpponentPotentialMr/);
  assert.match(renderer, /historyOpponentPotentialLp/);
  assert.doesNotMatch(renderer, /historyPotentialDifference/);
  assert.match(renderer, /historyOwnerProfileId: historyState\?\.profileId/);
  assert.match(renderer, /replayId: nextRecord\.replayId/);
  assert.match(renderer, /selectedRecord: nextRecord/);
  assert.doesNotMatch(renderer, /selectHistoryRecord\(selectedRecord, \{ forceRefresh: true \}\)/);
});

test("main forwards the normalized other-character peak without a second selector", () => {
  const main = read("src/main.js");
  assert.match(main, /const enrichedContext = \{\s*\.\.\.context,\s*opponentInsight,/);
  assert.doesNotMatch(main, /const otherPeakMr = selectOtherCharacterPeakMr/);
  assert.match(main, /OPPONENT_PEAK_PROFILE_API_PATH\s*=\s*\n?\s*"\/6\/buckler\/api\/profile\/play\/act\/highest\/master_rating_info"/);
  assert.match(main, /targetShortId:\s*Number\(normalizedProfileId\)/);
  assert.match(main, /targetSeasonId,/);
  assert.match(main, /peak: false/);
  assert.match(main, /headers: requestHeaders/);
  assert.match(main, /Origin: SERVICE_ORIGIN/);
  assert.match(main, /Referer:/);
  assert.doesNotMatch(main, /Cookie:/);
  assert.match(main, /peakProfileData,/);
});

test("opponent context fetches the bounded official history window only on demand", () => {
  const main = read("src/main.js");
  assert.match(main, /OPPONENT_INSIGHT_MAX_PAGES = Math\.ceil\(/);
  assert.match(main, /INSIGHT_MATCH_LIMIT \/ MATCH_HISTORY_PAGE_SIZE/);
  assert.match(main, /fetchHistoryPagesConcurrently\(/);
  assert.match(main, /maxPages: OPPONENT_INSIGHT_MAX_PAGES/);
  assert.match(main, /concurrency: OPPONENT_INSIGHT_FETCH_CONCURRENCY/);
  assert.match(main, /opponentInsight,/);
  assert.match(main, /const orderedReplays = await fetchMatchHistoryPages/);
  assert.doesNotMatch(main, /fetchOpponentRecordsForPotentialSnapshots/);
  assert.doesNotMatch(main, /potentialSnapshotOwnHistoryComplete/);
  assert.match(main, /buildHistoricalOpponentSnapshots/);
  assert.match(main, /opponentInsightSnapshots/);
  assert.match(main, /record\.replayId === requestedReplayId/);
  assert.match(main, /historyOwnerProfileId/);
  assert.match(main, /const hasPersistedSnapshot = Object\.keys\(storedSnapshots \?\? \{\}\)\.length > 0/);
  assert.match(main, /const officialHistory = hasPersistedSnapshot/);
  assert.match(main, /if \(!hasPersistedSnapshot\)/);
});
