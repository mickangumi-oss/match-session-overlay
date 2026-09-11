const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

function createHistoryActSelect() {
  return {
    value: "",
    options: [],
    replaceChildren() {
      this.options = [];
    },
    append(option) {
      this.options.push(option);
    },
  };
}

test("history table keeps the approved layout and opponent insight fields", () => {
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/style.css");
  const midnightCss = read("src/renderer/midnight-glass.css");
  const header = html.match(/<table class="history-match-table">\s*<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  assert.ok(header, "history table header should exist");
  assert.equal((header[1].match(/<th\b/g) || []).length, 10);
  assert.match(midnightCss, /\.history-match-table\{width:100%;min-width:0;table-layout:fixed\}/);
  assert.match(css, /\.history-table-card \{ display: grid; grid-template-rows: auto 400px auto;/);
  assert.doesNotMatch(css, /\.dashboard-history-panel \{ min-height: 220px; \}/);
  assert.match(midnightCss, /\.cockpit\{grid-template-rows:max-content auto\}/);
  assert.match(midnightCss, /\.main-column\{grid-template-rows:auto max-content!important\}/);
  assert.doesNotMatch(header[1], /potentialDifference/);
  assert.match(html, /<script src="\.\.\/opponent-insight\.js"><\/script>/);
  assert.match(html, /id="historyOpponentPotentialMr"/);
  assert.match(html, /id="historyOpponentPotentialLp"/);
  assert.match(html, /id="historySelectedRoundResults"/);
  assert.match(html, /id="historySelectedRoundResultsBody"/);
  assert.match(css, /\.history-selected-round-results/);
  assert.match(html, /data-i18n="historyOpponentOtherPeak">CURRENT OTHER CHARACTER PEAK MR/);
  assert.doesNotMatch(html, /history-reference-badge/);
  assert.doesNotMatch(html, /id="historyOpponent(?:Current|Peak)Rating(?:Label)?"/);
  assert.doesNotMatch(css, /history-difference/);
});

test("management action icons are supplemental and preserve their text labels", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const controls = [
    ["startTrackingButton", "startTrackingLabel"],
    ["nextUpdateInfo", "nextUpdateLabel"],
    ["resetTrackingButton", "reset"],
    ["stopTrackingButton", "end"],
    ["openHistoryButton", "matchHistory"],
    ["optionsButton", "options"],
    ["overlayLockButton", "overlayLockLabel"],
    ["toggleStatsButton", "toggleStatsLabel"],
  ];
  for (const [id, label] of controls) {
    const element = html.match(new RegExp(id === "nextUpdateInfo" ? `<span[^>]*id="${id}"[\\s\\S]*?<\\/span>` : `<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`));
    assert.ok(element, `${id} should exist`);
    assert.match(element[0], /<svg class="button-icon" aria-hidden="true" viewBox="0 0 16 16">/);
    assert.match(element[0], new RegExp(label === "startTrackingLabel" || label === "overlayLockLabel" || label === "toggleStatsLabel" || label === "nextUpdateLabel" ? `id="${label}"` : `data-i18n="${label}"`));
  }
  assert.match(html, /<span class="button-with-icon session-timer" id="nextUpdateInfo">/);
  assert.match(html, /id="nextUpdateLabel" data-i18n="nextUpdate"/);
  assert.match(html, /id="nextUpdateValue">--:--/);
  assert.match(renderer, /elements\.nextUpdateLabel\.textContent/);
  assert.match(renderer, /elements\.nextUpdateValue\.textContent/);
  assert.match(renderer, /elements\.overlayLockLabel\.textContent/);
  assert.match(renderer, /elements\.toggleStatsLabel\.textContent/);
});

test("options opens as an independent screen without replacing its controls", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const midnightCss = read("src/renderer/midnight-glass.css");
  assert.match(html, /<p class="kicker">OPTIONS<\/p>\s*<h3 data-i18n="options">/);
  assert.match(html, /id="optionsPanel"[\s\S]*id="closeOptionsButton"[\s\S]*data-i18n="backToManagement"/);
  assert.match(html, /id="optionsPanel"[\s\S]*id="graphMatchCountInput"/);
  assert.match(renderer, /document\.body\.classList\.toggle\("options-screen-open", open\)/);
  assert.match(midnightCss, /body\.options-screen-open\{overflow:hidden\}/);
  assert.match(midnightCss, /body\.options-screen-open \.display-panel>\.options-drawer\{[\s\S]*position:fixed[\s\S]*inset:12px/);
  assert.match(midnightCss, /body\.options-screen-open \.display-panel>\.options-drawer>\.options-category-grid\{[\s\S]*overflow:visible/);
});

test("matchup analysis renders the production comparison states without fixture data", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const midnightCss = read("src/renderer/midnight-glass.css");
  for (const id of [
    "matchupPanel",
    "openMatchupButton",
    "closeHistoryOpponentProfileButton",
    "closeMatchupButton",
    "matchupState",
    "refreshMatchupButton",
    "matchupMetrics",
    "matchupRoundCard",
    "matchupRoundState",
    "matchupRoundScope",
    "matchupRoundMetrics",
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  for (const legacy of ["matchupDonut", "matchupWinState", "matchupSelfRecord", "matchupOpponentRecord", "matchupWinSamples", "matchupWinRate", "MATCHUP WIN RATE", "matchupMetaMatches", "matchupMetaOpponent", "matchupCharacter", "matchupMatchRating", "matchupRecentRecord", "matchupPotentialMr", "matchupPotentialLp", "matchupOtherCharacter", "matchupOtherRating", "matchupHistoryCard", "matchupHistoryList", "matchupHistoryCount", "renderMatchupHistory"]) {
    assert.doesNotMatch(html, new RegExp(legacy), `${legacy} must stay out of the comparison panel`);
    assert.doesNotMatch(renderer, new RegExp(legacy), `${legacy} must stay out of comparison rendering`);
  }
  for (const id of ["matchupTargetUser", "matchupLocale", "matchupSource"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `${id} should not be rendered`);
    assert.doesNotMatch(renderer, new RegExp(`elements\\.${id}`), `${id} should not be referenced`);
  }
  assert.doesNotMatch(renderer, /matchupLocaleLabel|matchupSourcePath/);
  assert.match(renderer, /matchupStatusForContext\(context, profileStatus = null\)/);
  assert.match(renderer, /profileStatus === "loading"/);
  assert.match(renderer, /profileStatus === "error"/);
  assert.match(renderer, /syncOpenMatchupForHistoryProfile/);
  assert.match(renderer, /closeHistoryOpponentProfileButton/);
  assert.match(renderer, /selectHistoryRecord\(null\)/);
  assert.match(renderer, /matchupDisplayStatus/);
  assert.match(renderer, /renderPlayComparison\(playComparison\)/);
  assert.match(renderer, /renderRoundTrend\(context\?\.roundTrend/);
  assert.match(renderer, /sourceStatuses/);
  assert.match(renderer, /matchup-round-scope-side/);
  assert.doesNotMatch(renderer, /集計:.*上限/);
  assert.doesNotMatch(renderer, /MATCHUP_MOCK_METRICS|MATCHUP_MOCK_DRIVE_GAUGE_USAGE/);
  assert.match(html, /バトル傾向：過去100戦平均/);
  assert.match(html, /ラウンド傾向：取得できた対戦履歴を集計/);
  assert.doesNotMatch(renderer, /matchupPotentialMr|matchupMetaMatches|matchupCharacter/);
  assert.match(html, /id="closeMatchupButton"/);
  assert.match(midnightCss, /body\.matchup-screen-open\{overflow:hidden\}/);
  assert.match(midnightCss, /\.matchup-panel\{position:fixed/);
  assert.match(midnightCss, /@media\(max-width:840px\)\{\.matchup-panel/);
});

test("PLAY comparison uses the authenticated locale/profile play page without exposing identifiers", () => {
  const main = read("src/main.js");
  const preload = read("src/preload.js");
  assert.match(main, /fetchAuthenticatedPlayProfile/);
  assert.match(main, /profile\/\$\{encodeURIComponent\(normalizedProfileId\)\}\/play/);
  assert.match(main, /parseNextData\(html\)/);
  assert.match(main, /comparePlayProfiles\(/);
  assert.match(main, /PLAY_APPROVED_FIELD_CONTRACT/);
  assert.match(main, /verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT/);
  assert.match(preload, /history:opponent-context/);
  assert.doesNotMatch(main, /matchupTargetUser|matchupLocale|matchupSource/);
});

test("comparison labels use the locale pipeline and do not expose raw source metadata", () => {
  const renderer = read("src/renderer/renderer.js");
  const i18n = read("src/renderer/i18n.js");
  assert.match(renderer, /MATCHUP_GROUP_I18N/);
  assert.match(renderer, /MATCHUP_ITEM_I18N/);
  assert.match(renderer, /localeApi\?\.characterName/);
  assert.match(i18n, /function characterName\(value, id = null\)/);
  assert.doesNotMatch(renderer, /matchupSource|matchupLocaleLabel/);
  assert.doesNotMatch(i18n, /`#\$\{numericId\}`/);
  assert.match(i18n, /return mapped \|\| "—"/);
});

test("management potential rating stays anchored to the graph line", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  assert.doesNotMatch(html, /managementPotentialLabel/);
  assert.doesNotMatch(renderer, /managementPotentialLabel/);
  assert.match(renderer, /`POTENTIAL \$\{ratingType\} \$\{displayNumber\.integer\(potential\)\}`/);
  assert.match(renderer, /width - right - 2/);
  assert.match(renderer, /Math\.min\(\s*height - bottom - 2/);
});

test("renderer keeps opponent insight state independent from history rows", () => {
  const renderer = read("src/renderer/renderer.js");
  const preload = read("src/preload.js");
  assert.match(renderer, /historyOpponentInsightCache = new Map/);
  assert.match(renderer, /renderHistoryTable\(pageRecords\)/);
  assert.match(renderer, /historyOpponentInsightCache\.delete\(insightKey\)/);
  assert.match(renderer, /historyOpponentPotentialMr/);
  assert.match(renderer, /historyOpponentPotentialLp/);
  assert.doesNotMatch(renderer, /historyPotentialDifference/);
  assert.match(renderer, /historyOwnerProfileId: historyState\?\.profileId/);
  assert.match(renderer, /replayId: nextRecord\.replayId/);
  assert.match(renderer, /function historyOpponentContextActSelection/);
  assert.match(renderer, /selectedActId: explicit\s*\? selectedHistoryActId\(\)\s*:\s*verifiedCurrentHistoryActId\(state\)/);
  assert.match(renderer, /\.\.\.actSelection/);
  assert.match(renderer, /function selectedHistoryRoundTrendActId\(\)/);
  assert.match(renderer, /selectedRecord: nextRecord/);
  assert.match(renderer, /const requestScope = historyContextScopeKey\(historyState, nextRecord\)/);
  assert.match(renderer, /requestScope !== historyContextScopeKey\(historyState, nextRecord\)/);
  assert.match(renderer, /historyOpponentProfileRequestToken \+= 1/);
  assert.match(renderer, /selectHistoryRecord\(historyOpponentProfileState\.record, \{ forceRefresh: true \}\)/);
  assert.match(renderer, /function refetchLatestHistoryOpponentContextIfActChanged/);
  assert.match(renderer, /function historyLatestContextNeedsRefetch/);
  assert.match(renderer, /if \(historyLatestContextNeedsRefetch\(record\)\)/);
  assert.match(renderer, /refetchLatestHistoryOpponentContextIfActChanged\(historyState\)/);
  assert.match(preload, /selectedActId: payload\?\.selectedActId/);
  assert.doesNotMatch(renderer, /selectHistoryRecord\(selectedRecord, \{ forceRefresh: true \}\)/);
});

test("main forwards the normalized other-character peak without a second selector", () => {
  const main = read("src/main.js");
  assert.match(main, /const enrichedContext = \{\s*\.\.\.context,[\s\S]*opponentInsight,/);
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
  assert.match(main, /verifyScopedHistoryPage/);
  assert.match(main, /requestedActId/);
  assert.match(main, /HISTORY_SELECTED_REPLAY_SCOPE_MISSING/);
  assert.match(main, /fetchHistoryPagesConcurrently\(/);
  assert.match(main, /opponentInsight,/);
  assert.match(main, /const orderedReplays = await fetchMatchHistoryPages/);
  assert.doesNotMatch(main, /fetchOpponentRecordsForPotentialSnapshots/);
  assert.doesNotMatch(main, /potentialSnapshotOwnHistoryComplete/);
  assert.match(main, /buildHistoricalOpponentSnapshots/);
  assert.match(main, /opponentInsightSnapshots/);
  assert.match(main, /record\.replayId === requestedReplayId/);
  assert.match(main, /historyOwnerProfileId/);
  assert.match(main, /const hasPersistedSnapshot = Object\.keys\(storedSnapshots \?\? \{\}\)\.length > 0/);
  assert.match(main, /ownerHistoryChanged = ownerHistory\?\.complete === true/);
  assert.match(main, /acquireScopedOfficialHistories\(\{\s*cache: opponentOfficialHistoryCache/);
  assert.match(main, /requiredReplayId: requestedReplayId/);
  assert.match(main, /selectedRecord: scopedSelectedRecord/);
  assert.match(main, /assertGeneration: assertPrivateDataGeneration/);
  assert.match(main, /acquireOfficialHistory: \(params\) => fetchOpponentOfficialHistory\(params\)/);
  assert.doesNotMatch(main, /opponentOfficialHistoryCacheKey\([^\n]*selectedReplayId/);
  assert.doesNotMatch(main, /const hasPersistedRoundTrend = Boolean\(resolvedRecord\?\.opponentRoundTrend\)/);
  assert.match(main, /if \(!hasPersistedSnapshot && officialHistory\?\.complete === true\)/);
  assert.match(main, /profile\/\$\{encodeURIComponent\(normalizedProfileId\)\}\.json/);
});

test("history-selected Act remains authoritative over a companion PLAY Act marker", () => {
  const main = read("src/main.js");
  assert.match(main, /const scopedAct = selectedActId == null\s*\?\s*null\s*:/);
  assert.match(main, /id: String\(selectedActId\),/);
  assert.match(main, /actId: selectedActId/);
  assert.match(main, /peakActId: selectedActId/);
  assert.match(main, /const enrichedContext = \{\s*\.\.\.context,\s*\/\/ The profile PLAY payload[\s\S]*act: scopedAct,/);
});

test("history scope diagnostics retain sanitized current Act proof boundaries", () => {
  const main = read("src/main.js");
  assert.match(main, /buildHistoryActDiagnostic\(currentActState\)/);
  assert.match(main, /currentActReason/);
  assert.match(main, /currentActSource/);
  assert.match(main, /currentActVerified/);
  assert.match(main, /finalScopeReason/);
  assert.match(main, /actId = null,\s*actLabel = null/);
  assert.match(main, /actId: selectedActId/);
});

test("production receipt diagnostics expose sanitized HTTP, scope, stats, and round boundaries", () => {
  const main = read("src/main.js");
  const receipt = read("src/production-receipt.js");
  const historyCache = read("src/opponent-history-cache.js");
  assert.match(main, /classifyHttpResponse\(response/);
  assert.match(main, /productionReceipt/);
  assert.match(main, /stats\.final/);
  assert.match(historyCache, /productionRole: "history\.owner"/);
  assert.match(historyCache, /productionRole: "history\.opponent"/);
  assert.match(main, /context\.round-summary/);
  assert.match(main, /context\.ipc-scope/);
  assert.match(main, /ipcSelectedActSelector/);
  assert.match(main, /ipcSelectedRecordActPresent/);
  assert.match(receipt, /mso\.production-receipt\.v1/);
  assert.match(receipt, /ipcCurrentAct/);
  assert.doesNotMatch(receipt, /rawPayload/);
  assert.match(receipt, /SAFE_EVENT_KEYS/);
});

test("official opponent stats keeps Act 0 as a valid explicit scope", () => {
  const main = read("src/main.js");
  assert.match(main, /const act = requestedActId \?\? Number\(nameRegistry\.act\);/);
  assert.match(main, /if \(!Number\.isInteger\(act\) \|\| act < 0\)/);
  assert.doesNotMatch(main, /if \(!Number\.isInteger\(act\) \|\| act <= 0\)/);
});

test("official opponent stats separates the three mode scopes in renderer and IPC", () => {
  const renderer = read("src/renderer/renderer.js");
  const preload = read("src/preload.js");
  const main = read("src/main.js");
  assert.match(renderer, /const matchMode = String\(elements\.historyMatchType\?\.value/);
  assert.match(renderer, /requestToken,\s+matchMode/);
  assert.match(preload, /selectedOwnCharacterId = null, requestToken = null, matchMode = "all", actSelectionSource = "latest"/);
  assert.match(main, /normalizedMatchMode === "all"/);
  assert.match(main, /OFFICIAL_MATCH_MODE_IDS\[normalizedMatchMode\]/);
  assert.match(renderer, /historyActUserSelected \? "explicit" : "latest"/);
  assert.match(main, /OWN_CHARACTER_SCOPE_MISSING/);
  assert.match(main, /selectionSource/);
});

test("official stats can use the verified main-process current Act when latest is selected", () => {
  const main = read("src/main.js");
  assert.match(main, /const explicitActId = actSelectionSource === "explicit" && Number\.isInteger\(Number\(actId\)\)/);
  assert.match(main, /currentVerifiedHistoryActState\(normalizedProfileId\)/);
  assert.match(main, /verifiedCurrentAct\.currentActVerified === true/);
  assert.match(main, /const requestedActId = explicitActId \?\?/);
});

test("stats receipt totals prefer the explicit ALL row used by the UI", () => {
  const main = read("src/main.js");
  const stats = read("src/official-opponent-character-stats.js");
  assert.match(main, /summarizeOfficialOpponentCharacterStatsRows\(result\?\.rows\)/);
  assert.match(main, /allBattleCount: receiptTotals\.matches/);
  assert.match(main, /allWinCount: receiptTotals\.wins/);
  assert.match(stats, /source: "aggregate-row"/);
});

test("history Act defaults to the verified latest Act until the user selects an explicit Act", () => {
  const renderer = read("src/renderer/renderer.js");
  assert.match(renderer, /let historyActUserSelected = false/);
  assert.match(renderer, /historyActUserSelected = true/);
  const context = {
    historyActUserSelected: false,
    historyState: { currentActId: 13, currentActVerified: true },
    elements: { historyAct: createHistoryActSelect() },
    verifiedCurrentHistoryActId: (state = {}) => (
      state.currentActVerified === true && Number.isInteger(state.currentActId) && state.currentActId > 0
        ? state.currentActId
        : null
    ),
    normalizedHistoryActs: () => [
      { id: 13, label: "ACT 13", startDate: "", endDate: "" },
      { id: 12, label: "ACT 12", startDate: "", endDate: "" },
    ],
    document: {
      createElement: () => ({ dataset: {} }),
    },
    t: (_key, fallback) => fallback,
  };
  const selectedHistoryActId = vm.runInNewContext(
    `(${extractFunction(renderer, "selectedHistoryActId")})`,
    context,
  );
  const renderHistoryActControl = vm.runInNewContext(
    `(${extractFunction(renderer, "renderHistoryActControl")})`,
    context,
  );

  assert.equal(selectedHistoryActId(), 13);
  renderHistoryActControl(context.historyState);
  assert.equal(context.elements.historyAct.value, "13");

  context.historyActUserSelected = true;
  context.elements.historyAct.value = "12";
  assert.equal(selectedHistoryActId(), 12);
  renderHistoryActControl(context.historyState);
  assert.equal(context.elements.historyAct.value, "12");

  context.historyActUserSelected = false;
  const unavailableState = { currentActId: null, currentActVerified: false };
  renderHistoryActControl(unavailableState);
  assert.equal(context.elements.historyAct.value, "");
});
