"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  AGGREGATE_CHARACTER_ID,
  aggregateOfficialCharacterWinRates,
  aggregateBattlelogOpponentCharacterStats,
  buildOfficialCharacterNameMap,
  buildOfficialCharacterStatsCacheKey,
  buildOfficialCharacterStatsRequestKey,
  isRetryableOfficialCharacterStatsReason,
  summarizeOfficialOpponentCharacterStatsRows,
  validateOfficialOpponentCharacterWinRates,
  validateOfficialCharacterWinRates,
} = require("../src/official-opponent-character-stats");

function row(id, name, wins, matches) {
  return {
    character_id: id,
    character_name: name,
    character_alpha: name,
    character_tool_name: name.toLowerCase(),
    character_sort: id,
    win_count: wins,
    battle_count: matches,
  };
}

function rivalRow(id, name, wins, matches) {
  return {
    rival_character_id: id,
    rival_character_name: name,
    rival_character_alpha: name,
    rival_character_tool_name: name.toLowerCase(),
    rival_character_sort: id,
    win_count: wins,
    battle_count: matches,
  };
}

function observedPlayFixture() {
  const axis = [
    {
      character_id: 1,
      rival_character_win_rates: [
        rivalRow(2, "ケン", 3, 6),
        rivalRow(3, "春麗", 2, 4),
        rivalRow(AGGREGATE_CHARACTER_ID, "すべて", 5, 10),
      ],
    },
    {
      character_id: AGGREGATE_CHARACTER_ID,
      rival_character_win_rates: [
        rivalRow(2, "ケン", 3, 6),
        rivalRow(3, "春麗", 2, 4),
        rivalRow(AGGREGATE_CHARACTER_ID, "すべて", 5, 10),
      ],
    },
  ];
  return {
    current_season_id: 13,
    character_win_rates: [
      row(1, "リュウ", 5, 10),
      row(AGGREGATE_CHARACTER_ID, "すべて", 5, 10),
    ],
    character_win_rates_by_rival_character: axis,
  };
}

test("validates the official row contract and preserves the ID/name pair", () => {
  const result = validateOfficialCharacterWinRates({
    response: { character_win_rates: [row(1, "RYU", 2, 3)] },
  }, { expectedCharacterIds: new Set([1]), locale: "ja-jp", act: 13, mode: 2 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows[0], {
    characterId: 1,
    label: "RYU",
    matches: 3,
    wins: 2,
    winRate: (2 / 3) * 100,
  });
});

test("scopes request and cache keys by profile, locale, and current Act", () => {
  assert.equal(buildOfficialCharacterStatsRequestKey("1234", "ja-jp"), "ja-jp:1234");
  assert.equal(buildOfficialCharacterStatsCacheKey("1234", "ja-jp", 13), "ja-jp:1234:13");
  assert.notEqual(
    buildOfficialCharacterStatsCacheKey("1234", "ja-jp", 13),
    buildOfficialCharacterStatsCacheKey("1234", "ja-jp", 14),
  );
  assert.equal(buildOfficialCharacterStatsCacheKey("1234", "ja-jp", null), "");
});

test("production stats cache separates mode and does not persist QA probe results", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const normalizedMain = main.replaceAll("\r\n", "\n");
  assert.match(normalizedMain, /normalizedMatchMode,\n\s*\]\.join\(\":"\);/);
  assert.match(main, /if \(!qaReceiptProbe\) officialCharacterStatsCache\.set\(cacheKey, result\);/);
  assert.match(normalizedMain, /shareInFlightRequest\(officialCharacterStatsInFlight, flightKey/);
  assert.doesNotMatch(normalizedMain, /officialCharacterStatsInFlight\.set\(cacheKey, request\)/);
  assert.doesNotMatch(normalizedMain, /officialCharacterStatsInFlight\.get\(cacheKey\) === request/);
});

test("production stats cache stores successful single-mode results only", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const normalizedMain = main.replaceAll("\r\n", "\n");
  assert.match(
    normalizedMain,
    /const result = \{\n            status: "ready",[\s\S]*?mode: normalizedMatchMode,[\s\S]*?\n          \};\n          if \(!qaReceiptProbe\) officialCharacterStatsCache\.set\(cacheKey, result\);/
  );
});

test("production stats cache requires current generation and history revision", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const normalizedMain = main.replaceAll("\r\n", "\n");
  assert.match(normalizedMain, /cached\.generation === generation/);
  assert.match(normalizedMain, /cached\.historyRevision === currentHistoryRevision/);
  assert.match(normalizedMain, /Date\.now\(\) - Number\(cached\.retrievedAt\) < OFFICIAL_CHARACTER_STATS_COOLDOWN_MS/);
  assert.match(normalizedMain, /if \(forceRefresh === true\) officialCharacterStatsCache\.delete\(cacheKey\)/);
});

test("production stats cache force refresh bypasses a fresh cached result", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const normalizedMain = main.replaceAll("\r\n", "\n");
  assert.match(
    normalizedMain,
    /const cached = forceRefresh === true\n\s*\? null\n\s*: officialCharacterStatsCache\.get\(cacheKey\);/
  );
});

test("projects official play rows into a name-only registry without stats fields", () => {
  const labels = buildOfficialCharacterNameMap([
    { characterId: 1, label: "RYU", matches: 99, wins: 50 },
    { characterId: 2, label: "KEN", matches: 88, wins: 44 },
  ]);
  assert.deepEqual(labels, { 1: "RYU", 2: "KEN" });
  assert.equal(Object.hasOwn(labels, "matches"), false);
  assert.equal(buildOfficialCharacterNameMap([{ characterId: 1, label: "" }]), null);
});

test("classifies retryable transport failures without retrying contract or auth failures", () => {
  assert.equal(isRetryableOfficialCharacterStatsReason("RATE_LIMITED"), true);
  assert.equal(isRetryableOfficialCharacterStatsReason("SERVICE_HTTP_503"), true);
  assert.equal(isRetryableOfficialCharacterStatsReason("AUTH_REQUIRED"), false);
  assert.equal(isRetryableOfficialCharacterStatsReason("SERVICE_HTTP_403"), false);
  assert.equal(isRetryableOfficialCharacterStatsReason("DUPLICATE_CHARACTER_ID"), false);
});

test("rejects duplicate, missing, and inconsistent official rows", () => {
  assert.equal(validateOfficialCharacterWinRates({
    character_win_rates: [row(1, "RYU", 1, 1), row(1, "RYU", 0, 1)],
  }).reason, "DUPLICATE_CHARACTER_ID");
  assert.equal(validateOfficialCharacterWinRates({
    character_win_rates: [row(1, "", 0, 0)],
  }).reason, "REQUIRED_ROW_FIELD_INVALID");
  assert.equal(validateOfficialCharacterWinRates({
    character_win_rates: [row(1, "RYU", 2, 1)],
  }).reason, "WINS_EXCEED_MATCHES");
});

test("preserves the official ALL row alongside the rival-character rows", () => {
  const fixture = observedPlayFixture();
  const result = validateOfficialOpponentCharacterWinRates(fixture, {
    expectedCharacterIds: new Set([1, AGGREGATE_CHARACTER_ID]),
    expectedSelfRows: [
      { characterId: 1, matches: 10, wins: 5 },
      { characterId: AGGREGATE_CHARACTER_ID, matches: 10, wins: 5 },
    ],
    selectedOwnCharacterId: 1,
    locale: "ja-jp",
    act: 13,
    generation: 7,
    scopeKind: "play",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    { characterId: AGGREGATE_CHARACTER_ID, label: "すべて", matches: 10, wins: 5, winRate: 50 },
    { characterId: 2, label: "ケン", matches: 6, wins: 3, winRate: 50 },
    { characterId: 3, label: "春麗", matches: 4, wins: 2, winRate: 50 },
  ]);
  assert.equal(result.diagnostics.aggregateRowSource, "rival");
  assert.deepEqual(result.diagnostics.rivalChecksum, { matches: 10, wins: 5 });
});

test("reconstructs a missing official ALL row from rival rows, not self checksum", () => {
  const fixture = observedPlayFixture();
  const withoutAggregate = {
    ...fixture,
    character_win_rates_by_rival_character: fixture.character_win_rates_by_rival_character.map((outer) => ({
      ...outer,
      rival_character_win_rates: outer.rival_character_win_rates.filter(
        (rival) => rival.rival_character_id !== AGGREGATE_CHARACTER_ID,
      ),
    })),
  };
  const result = validateOfficialOpponentCharacterWinRates(withoutAggregate, {
    expectedCharacterIds: new Set([1, AGGREGATE_CHARACTER_ID]),
    expectedSelfRows: [
      { characterId: 1, label: "リュウ", matches: 10, wins: 5 },
      { characterId: AGGREGATE_CHARACTER_ID, label: "すべて", matches: 10, wins: 5 },
    ],
    selectedOwnCharacterId: 1,
    act: 13,
    scopeKind: "play",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows[0], {
    characterId: AGGREGATE_CHARACTER_ID,
    label: "すべて",
    matches: 10,
    wins: 5,
    winRate: 50,
  });
  assert.equal(result.diagnostics.aggregateRowSource, "self_checksum");
  assert.equal(result.diagnostics.aggregateRivalObserved, false);
  assert.equal(result.rows[0].matches, 10);
  assert.equal(result.rows[0].wins, 5);
});

test("uses the aggregate own row for ALL scope without double counting character rows", () => {
  const fixture = observedPlayFixture();
  const result = validateOfficialOpponentCharacterWinRates(fixture, {
    expectedCharacterIds: new Set([1, AGGREGATE_CHARACTER_ID]),
    expectedSelfRows: [
      { characterId: 1, matches: 10, wins: 5 },
      { characterId: AGGREGATE_CHARACTER_ID, matches: 10, wins: 5 },
    ],
    selectedOwnCharacterId: "all",
    act: 13,
    scopeKind: "play",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics.selfChecksum, { matches: 10, wins: 5 });
  assert.deepEqual(result.diagnostics.rivalChecksum, { matches: 10, wins: 5 });
});

test("accepts the same two-axis shape from a mode POST when its self checksum matches", () => {
  const fixture = observedPlayFixture();
  const result = validateOfficialOpponentCharacterWinRates({
    response: {
      targetSeasonId: 12,
      targetModeId: 2,
      character_win_rates: fixture.character_win_rates,
      character_win_rates_by_rival_character: fixture.character_win_rates_by_rival_character,
    },
  }, {
    expectedCharacterIds: new Set([1, AGGREGATE_CHARACTER_ID]),
    expectedSelfRows: [
      { characterId: 1, matches: 10, wins: 5 },
      { characterId: AGGREGATE_CHARACTER_ID, matches: 10, wins: 5 },
    ],
    selectedOwnCharacterId: 1,
    act: 12,
    mode: 2,
    generation: 7,
    scopeKind: "post",
  });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.observedAct, 12);
  assert.equal(result.diagnostics.observedMode, 2);
});

test("preserves request scope when mode POST responses omit scope metadata", () => {
  const fixture = observedPlayFixture();
  const response = {
    targetSeasonId: 12,
    targetModeId: 2,
    character_win_rates: fixture.character_win_rates,
    character_win_rates_by_rival_character: fixture.character_win_rates_by_rival_character,
  };
  const validate = (nextResponse) => validateOfficialOpponentCharacterWinRates({ response: nextResponse }, {
    expectedCharacterIds: new Set([1, AGGREGATE_CHARACTER_ID]),
    expectedSelfRows: [
      { characterId: 1, matches: 10, wins: 5 },
      { characterId: AGGREGATE_CHARACTER_ID, matches: 10, wins: 5 },
    ],
    selectedOwnCharacterId: 1,
    act: 12,
    mode: 2,
    scopeKind: "post",
  });

  const { targetSeasonId, targetModeId, ...withoutBoth } = response;
  assert.equal(validate({ ...withoutBoth, targetModeId }).ok, true);
  assert.equal(validate({ ...withoutBoth, targetSeasonId }).ok, true);
  assert.equal(validate({ ...response, targetSeasonId: "12" }).reason, "ACT_SCOPE_INVALID");
  assert.equal(validate({ ...response, targetModeId: "2" }).reason, "MODE_SCOPE_INVALID");
});

test("fails closed for missing fields, scope mismatch, and missing selected own rows", () => {
  const fixture = observedPlayFixture();
  assert.equal(validateOfficialOpponentCharacterWinRates({
    current_season_id: 13,
    character_win_rates: fixture.character_win_rates,
  }, { act: 13, scopeKind: "play" }).reason, "OPPONENT_RIVAL_FIELD_MISSING");

  assert.equal(validateOfficialOpponentCharacterWinRates({
    ...fixture,
    current_season_id: 12,
  }, { act: 13, scopeKind: "play" }).reason, "ACT_SCOPE_MISMATCH");

  assert.equal(validateOfficialOpponentCharacterWinRates({
    targetSeasonId: 13,
    targetModeId: 2,
    character_win_rates_by_rival_character: [fixture.character_win_rates_by_rival_character[1]],
  }, {
    expectedSelfRows: [{ characterId: 1, matches: 0, wins: 0 }],
    selectedOwnCharacterId: 1,
    act: 13,
    mode: 2,
    scopeKind: "post",
  }).reason, "SELECTED_OWN_CHARACTER_ROW_MISSING");
});

test("does not call the legacy battlelog path for official opponent stats", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const start = source.indexOf("async function fetchOfficialOpponentCharacterStats(");
  const end = source.indexOf("\nasync function fetchOpponentOfficialHistory", start);
  assert.ok(start >= 0 && end > start, "official opponent stats function boundary missing");
  assert.doesNotMatch(source.slice(start, end), /fetchCompleteBattlelogForAct/);
});

test("uses the official self and rival endpoints as separate requests", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(source, /OFFICIAL_CHARACTER_STATS_API_PATH[\s\S]*characterwinrate/);
  assert.match(source, /OFFICIAL_CHARACTER_STATS_RIVAL_API_PATH[\s\S]*characterwinratebyrivalcharacter/);
  assert.match(source, /new URL\(OFFICIAL_CHARACTER_STATS_RIVAL_API_PATH, SERVICE_ORIGIN\)/);
  assert.match(source, /validateOfficialOpponentCharacterWinRates\(rivalPayload/);
});

test("rejects a mode whose ID set differs from initial mode1", () => {
  const result = validateOfficialCharacterWinRates({
    character_win_rates: [row(2, "KEN", 0, 0)],
  }, { expectedCharacterIds: new Set([1]), mode: 3 });
  assert.equal(result.reason, "CHARACTER_ID_SET_MISMATCH");
});

test("aggregates only the three allowed modes and never creates losses", () => {
  const diagnostics = (mode) => ({ mode, act: 13, generation: 7 });
  const result = aggregateOfficialCharacterWinRates([
    { mode: 2, valid: true, rows: [
      { characterId: 1, label: "RYU", wins: 2, matches: 3, winRate: 66.6 },
    ], diagnostics: diagnostics(2) },
    { mode: 3, valid: true, rows: [
      { characterId: 1, label: "RYU", wins: 1, matches: 2, winRate: 50 },
    ], diagnostics: diagnostics(3) },
    { mode: 5, valid: true, rows: [
      { characterId: 1, label: "RYU", wins: 0, matches: 0, winRate: 0 },
    ], diagnostics: diagnostics(5) },
  ], { profileId: "1234", locale: "ja-jp", act: 13, generation: 7 });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.rows[0], {
    characterId: 1,
    label: "RYU",
    matches: 5,
    wins: 3,
    winRate: 60,
  });
  assert.equal(Object.hasOwn(result.rows[0], "losses"), false);
});

test("receipt totals use the explicit ALL row instead of summing rival rows", () => {
  assert.deepEqual(
    summarizeOfficialOpponentCharacterStatsRows([
      { characterId: 253, label: "ALL", matches: 209, wins: 103 },
      { characterId: 1, label: "RYU", matches: 100, wins: 50 },
      { characterId: 2, label: "KEN", matches: 109, wins: 53 },
    ]),
    { matches: 209, wins: 103, winRate: (103 / 209) * 100, source: "aggregate-row" },
  );
  assert.deepEqual(
    summarizeOfficialOpponentCharacterStatsRows([
      { characterId: 1, label: "RYU", matches: 2, wins: 1 },
      { characterId: 2, label: "KEN", matches: 3, wins: 2 },
    ]),
    { matches: 5, wins: 3, source: "non-aggregate-rows" },
  );
});

test("fails closed when one allowed mode is invalid", () => {
  const result = aggregateOfficialCharacterWinRates([
    { mode: 2, valid: true, rows: [] },
    { mode: 3, valid: false, reason: "HTTP_403" },
    { mode: 5, valid: true, rows: [] },
  ]);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.rows, []);
});

test("propagates a forbidden mode as a non-retryable partial result", () => {
  const result = aggregateOfficialCharacterWinRates([
    { mode: 2, valid: true, rows: [], diagnostics: { mode: 2, act: 13, generation: 7 } },
    { mode: 3, valid: false, reason: "AUTH_REQUIRED", retryable: false },
    { mode: 5, valid: true, rows: [], diagnostics: { mode: 5, act: 13, generation: 7 } },
  ], { act: 13, generation: 7 });
  assert.equal(result.status, "partial");
  assert.equal(result.retryable, false);
  assert.equal(result.modes.find((mode) => mode.mode === 3).reason, "AUTH_REQUIRED");
});

test("fails closed when a supposedly valid mode omits normalized rows", () => {
  const result = aggregateOfficialCharacterWinRates([
    { mode: 2, valid: true },
    { mode: 3, valid: true, rows: [] },
    { mode: 5, valid: true, rows: [] },
  ]);
  assert.equal(result.status, "partial");
  assert.equal(result.modes.find((mode) => mode.mode === 2).reason, "MODE_ROWS_MISSING");
  assert.deepEqual(result.rows, []);
});

test("fails closed when an allowed mode has a different Act or generation", () => {
  const result = aggregateOfficialCharacterWinRates([
    { mode: 2, valid: true, rows: [], diagnostics: { mode: 2, act: 12, generation: 7 } },
    { mode: 3, valid: true, rows: [], diagnostics: { mode: 3, act: 13, generation: 7 } },
    { mode: 5, valid: true, rows: [], diagnostics: { mode: 5, act: 13, generation: 6 } },
  ], { act: 13, generation: 7 });
  assert.equal(result.status, "partial");
  assert.equal(result.modes.find((mode) => mode.mode === 2).reason, "ACT_MISMATCH");
  assert.equal(result.modes.find((mode) => mode.mode === 5).reason, "GENERATION_MISMATCH");
});

test("aggregates battlelog by selected own character and opponent character", () => {
  const result = aggregateBattlelogOpponentCharacterStats([
    { replayId: "a", actId: 13, matchType: "ranked", characterId: 1, opponentCharacterId: 2, result: "win" },
    { replayId: "b", actId: 13, matchType: "ranked", characterId: 1, opponentCharacterId: 2, result: "loss" },
    { replayId: "c", actId: 13, matchType: "casual", characterId: 1, opponentCharacterId: 3, result: "win" },
    { replayId: "d", actId: 13, matchType: "battleHub", characterId: 4, opponentCharacterId: 2, result: "win" },
  ], { act: 13, selectedOwnCharacterId: 1, labels: { 2: "KEN", 3: "CHUN-LI" } });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    { characterId: 2, label: "KEN", matches: 2, wins: 1, winRate: 50 },
    { characterId: 3, label: "CHUN-LI", matches: 1, wins: 1, winRate: 100 },
  ]);
  assert.deepEqual(result.checksums, {
    ranked: { 1: { matches: 2, wins: 1 } },
    casual: { 1: { matches: 1, wins: 1 } },
    battleHub: { 4: { matches: 1, wins: 1 } },
  });
});

test("aggregates all own characters without double counting or room mode", () => {
  const result = aggregateBattlelogOpponentCharacterStats([
    { replayId: "a", actId: 13, matchType: "ranked", characterId: 1, opponentCharacterId: 2, result: "win" },
    { replayId: "b", actId: 13, matchType: "casual", characterId: 4, opponentCharacterId: 2, result: "loss" },
    { replayId: "c", actId: 13, matchType: "battleHub", characterId: 5, opponentCharacterId: 3, result: "win" },
    { replayId: "d", actId: 13, matchType: "room", characterId: 1, opponentCharacterId: 2, result: "win" },
  ], { act: 13, selectedOwnCharacterId: null, labels: { 2: "KEN", 3: "CHUN-LI" } });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    { characterId: 2, label: "KEN", matches: 2, wins: 1, winRate: 50 },
    { characterId: 3, label: "CHUN-LI", matches: 1, wins: 1, winRate: 100 },
  ]);
  assert.equal(result.diagnostics.excludedRecordCount, 1);
});

test("fails closed for missing fields, unknown mode, and conflicting duplicate replay IDs", () => {
  const result = aggregateBattlelogOpponentCharacterStats([
    { replayId: "same", actId: 13, matchType: "ranked", characterId: 1, opponentCharacterId: 2, result: "win" },
    { replayId: "same", actId: 13, matchType: "ranked", characterId: 1, opponentCharacterId: 3, result: "win" },
    { replayId: "missing", actId: 13, matchType: "ranked", characterId: 1, opponentCharacterId: 2, result: "unknown" },
    { replayId: "other", actId: 13, matchType: "unknown", characterId: 1, opponentCharacterId: 2, result: "win" },
  ], { act: 13, labels: { 2: "KEN", 3: "CHUN-LI" } });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.duplicateConflictCount, 1);
  assert.equal(result.diagnostics.missingRequiredCount, 1);
  assert.equal(result.diagnostics.unknownModeCount, 1);
});

test("deduplicates an exact replay moved between pages and records its page provenance", () => {
  const replay = {
    replayId: "same-page-moved",
    actId: 13,
    matchType: "ranked",
    characterId: 1,
    opponentCharacterId: 2,
    result: "win",
  };
  const result = aggregateBattlelogOpponentCharacterStats([
    { ...replay, __sourcePage: 1 },
    { ...replay, __sourcePage: 2 },
  ], { act: 13, labels: { 2: "KEN" } });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.duplicateExactCount, 1);
  assert.equal(result.diagnostics.duplicatePageCount, 1);
  assert.deepEqual(result.rows, [
    { characterId: 2, label: "KEN", matches: 1, wins: 1, winRate: 100 },
  ]);
});

// Injectable cache-scope harness: keeps these behavioral checks independent of
// Electron startup while matching the production key and cache rules.
function createStatsScopeHarness(fetcher, { qa = false } = {}) {
  const inFlight = new Map();
  const cache = new Map();
  let fetchCount = 0;
  const get = async (scope, { forceRefresh = false } = {}) => {
    const key = [scope.profile, scope.locale, scope.act ?? "latest", scope.mode].join(":");
    const forceKey = `${key}:force`;
    if (forceRefresh === true) cache.delete(key);
    if (!forceRefresh && !qa && cache.get(key)?.status === "ready") return cache.get(key);
    if (!forceRefresh && inFlight.has(forceKey)) return inFlight.get(forceKey);
    const flightKey = forceRefresh ? forceKey : key;
    if (inFlight.has(flightKey)) return inFlight.get(flightKey);
    const promise = Promise.resolve().then(async () => {
      if (forceRefresh) await inFlight.get(key)?.catch(() => {});
      fetchCount += 1; return fetcher(scope);
    })
      .then((result) => {
        if (!qa && result?.status === "ready") cache.set(key, result);
        return result;
      })
      .finally(() => { if (inFlight.get(flightKey) === promise) inFlight.delete(flightKey); });
    inFlight.set(flightKey, promise);
    return promise;
  };
  return { get, cache, inFlight, fetchCount: () => fetchCount, key: (scope) => [scope.profile, scope.locale, scope.act ?? "latest", scope.mode].join(":") };
}

test("P1-cache-scope-001: same complete key concurrent calls fetch once and return equal results", async () => {
  const h = createStatsScopeHarness(async (scope) => ({ status: "ready", scope }));
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "ranked" };
  const [a, b] = await Promise.all([h.get(scope), h.get(scope)]);
  assert.deepEqual(a, b); assert.equal(h.fetchCount(), 1);
});

test("P1-cache-scope-001: different modes use separate fetch scopes", async () => {
  const h = createStatsScopeHarness(async (scope) => ({ status: "ready", mode: scope.mode }));
  await h.get({ profile: "p", locale: "ja-jp", act: 13, mode: "ranked" });
  await h.get({ profile: "p", locale: "ja-jp", act: 13, mode: "casual" });
  assert.equal(h.fetchCount(), 2);
});

test("P1-cache-scope-001: latest and explicit Act never share in-flight work", async () => {
  const h = createStatsScopeHarness(async (scope) => ({ status: "ready", act: scope.act }));
  const [latest, explicit] = await Promise.all([
    h.get({ profile: "p", locale: "ja-jp", act: null, mode: "ranked" }),
    h.get({ profile: "p", locale: "ja-jp", act: 13, mode: "ranked" }),
  ]);
  assert.equal(h.fetchCount(), 2); assert.notDeepEqual(latest, explicit);
});

test("P1-cache-scope-001: reject and Abort cleanup in-flight state and allow retry", async () => {
  let attempt = 0;
  const h = createStatsScopeHarness(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("reject");
    if (attempt === 2) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return { status: "ready", attempt };
  });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "ranked" };
  await assert.rejects(h.get(scope)); assert.equal(h.inFlight.size, 0);
  await assert.rejects(h.get(scope), { name: "AbortError" }); assert.equal(h.inFlight.size, 0);
  assert.deepEqual(await h.get(scope), { status: "ready", attempt: 3 });
  assert.equal(h.inFlight.size, 0);
});

test("P1-cache-scope-001: normal same-mode cache hit performs zero additional fetches", async () => {
  const h = createStatsScopeHarness(async () => ({ status: "ready" }));
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "ranked" };
  await h.get(scope); await h.get(scope); assert.equal(h.fetchCount(), 1);
});

test("P1-cache-scope-001: QA bypass does not persist results", async () => {
  const h = createStatsScopeHarness(async () => ({ status: "ready" }), { qa: true });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "ranked" };
  await h.get(scope); await h.get(scope);
  assert.equal(h.fetchCount(), 2); assert.equal(h.cache.size, 0);
});

test("P1-cache-scope-001: fresh cache hit and force refresh use exact self/rival contract", async () => {
  let version = 0;
  const h = createStatsScopeHarness(async () => {
    version += 1;
    return { status: "ready", value: `v${version}`, selfFetches: 1, rivalFetches: 1 };
  });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "ranked" };
  const first = await h.get(scope);
  h.cache.set(h.key(scope), first);
  const old = await h.get(scope, { forceRefresh: false });
  assert.deepEqual(old, { status: "ready", value: "v1", selfFetches: 1, rivalFetches: 1 });
  assert.equal(h.fetchCount(), 1);
  const freshRefresh = await h.get(scope, { forceRefresh: true });
  assert.deepEqual(freshRefresh, { status: "ready", value: "v2", selfFetches: 1, rivalFetches: 1 });
  assert.equal(h.fetchCount(), 2);
  assert.deepEqual(h.cache.get(h.key(scope)), freshRefresh);
});

test("P1-cache-scope-001: concurrent force refresh is single-flight", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = createStatsScopeHarness(async () => {
    await gate;
    return { status: "ready", value: "new", selfFetches: 1, rivalFetches: 1 };
  });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "casual" };
  const a = h.get(scope, { forceRefresh: true });
  const b = h.get(scope, { forceRefresh: true });
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.equal(h.fetchCount(), 1);
  assert.deepEqual(first, { status: "ready", value: "new", selfFetches: 1, rivalFetches: 1 });
});

test("P1-cache-scope-002: force waits for normal flight and does not reuse its result", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let version = 0;
  const h = createStatsScopeHarness(async () => {
    const current = ++version;
    if (current === 1) await gate;
    return { status: "ready", value: `v${current}` };
  });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "ranked" };
  const normal = h.get(scope);
  const force = h.get(scope, { forceRefresh: true });
  release();
  assert.equal((await normal).value, "v1");
  assert.equal((await force).value, "v2");
  assert.equal(h.fetchCount(), 2);
});

test("P1-cache-scope-002: normal failure still permits one fresh force flight", async () => {
  let attempt = 0;
  const h = createStatsScopeHarness(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("normal failed");
    return { status: "ready", value: "fresh" };
  });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "casual" };
  const normal = h.get(scope);
  const [normalResult, forceResult] = await Promise.allSettled([normal, h.get(scope, { forceRefresh: true })]);
  assert.equal(normalResult.status, "rejected");
  assert.deepEqual(forceResult.value, { status: "ready", value: "fresh" });
  assert.equal(h.fetchCount(), 2);
});

test("P1-cache-scope-001: force refresh failure never returns old ready and retry succeeds", async () => {
  let attempt = 0;
  const h = createStatsScopeHarness(async () => {
    attempt += 1;
    if (attempt === 1) return { status: "ready", value: "old", selfFetches: 1, rivalFetches: 1 };
    if (attempt === 2) throw new Error("refresh failed");
    return { status: "ready", value: "new", selfFetches: 1, rivalFetches: 1 };
  });
  const scope = { profile: "p", locale: "ja-jp", act: 13, mode: "battleHub" };
  await h.get(scope);
  await assert.rejects(h.get(scope, { forceRefresh: true }), { message: "refresh failed" });
  assert.equal(h.cache.has(h.key(scope)), false);
  assert.deepEqual(await h.get(scope), { status: "ready", value: "new", selfFetches: 1, rivalFetches: 1 });
  assert.equal(h.fetchCount(), 3);
});
