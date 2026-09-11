"use strict";

// The PLAY page is a private, locale-scoped payload.  Keep the adapter
// deliberately explicit: a missing field is not a zero and unknown payload
// shapes must remain unavailable until a real field path is confirmed.

const PLAY_ROOTS = Object.freeze([
  "pageProps.play",
  "props.pageProps.play",
  "play",
  "pageProps.data.play",
  "pageProps.playData",
  "data.play",
]);
const PLAY_COMPARISON_WINDOW_LIMIT = 100;
const PLAY_FIELD_CONTRACT_VERSION = "buckler-play.v1";
const PLAY_FIELD_CONTRACT_SOURCES = Object.freeze(["approved", "sanitized-fixture"]);
const PLAY_APPROVED_FIELD_CONTRACT = Object.freeze({
  version: PLAY_FIELD_CONTRACT_VERSION,
  source: "approved",
  saLevelAvailable: true,
  paths: Object.freeze({
    "driveGaugeUsage.driveParry": "battle_stats.gauge_rate_drive_guard",
    "driveGaugeUsage.driveImpact": "battle_stats.gauge_rate_drive_impact",
    "driveGaugeUsage.overdriveArts": "battle_stats.gauge_rate_drive_arts",
    "driveGaugeUsage.parryDriveRush": "battle_stats.gauge_rate_drive_rush_from_parry",
    "driveGaugeUsage.cancelDriveRush": "battle_stats.gauge_rate_drive_rush_from_cancel",
    "driveGaugeUsage.driveReversal": "battle_stats.gauge_rate_drive_reversal",
    "driveGaugeUsage.damage": "battle_stats.gauge_rate_drive_other",
    "saGaugeUsage.level1": "battle_stats.gauge_rate_sa_lv1",
    "saGaugeUsage.level2": "battle_stats.gauge_rate_sa_lv2",
    "saGaugeUsage.level3": "battle_stats.gauge_rate_sa_lv3",
    "saGaugeUsage.ca": "battle_stats.gauge_rate_ca",
    "directActions.driveReversal": "battle_stats.drive_reversal",
    "directActions.driveParrySuccess": "battle_stats.drive_parry",
    "directActions.driveParryThrowOpponent": "battle_stats.throw_drive_parry",
    "directActions.driveParryThrownByOpponent": "battle_stats.received_throw_drive_parry",
    "directActions.justParry": "battle_stats.just_parry",
    "driveImpactSelf.landed": "battle_stats.drive_impact",
    "driveImpactSelf.punishCounter": "battle_stats.punish_counter",
    "driveImpactSelf.counteredOpponent": "battle_stats.drive_impact_to_drive_impact",
    "driveImpactOpponent.received": "battle_stats.received_drive_impact",
    "driveImpactOpponent.punishCounter": "battle_stats.received_punish_counter",
    "driveImpactOpponent.returnedByOpponent": "battle_stats.received_drive_impact_to_drive_impact",
    "stun.dealt": "battle_stats.stun",
    "stun.received": "battle_stats.received_stun",
    "throws.landed": "battle_stats.throw_count",
    "throws.received": "battle_stats.received_throw_count",
    "throws.teched": "battle_stats.throw_tech",
    "cornerTime.opponentCornered": "battle_stats.corner_time",
    "cornerTime.selfCornered": "battle_stats.cornered_time",
  }),
});

const PLAY_METRIC_GROUPS = Object.freeze([
  Object.freeze({
    id: "driveGaugeUsage",
    label: "ドライブゲージ使用分布",
    kind: "distribution",
    chart: "stacked100",
    items: Object.freeze([
      ["driveParry", "ドライブパリィ", ["driveGaugeUsage.driveParry", "battle_stats.gauge_rate_drive_guard", "drive_gauge_usage.drive_parry"]],
      ["driveImpact", "ドライブインパクト", ["driveGaugeUsage.driveImpact", "battle_stats.gauge_rate_drive_impact", "drive_gauge_usage.drive_impact"]],
      ["overdriveArts", "オーバードライブアーツ", ["driveGaugeUsage.overdriveArts", "battle_stats.gauge_rate_drive_arts", "drive_gauge_usage.overdrive_arts"]],
      ["parryDriveRush", "パリィドライブラッシュ", ["driveGaugeUsage.parryDriveRush", "battle_stats.gauge_rate_drive_rush_from_parry", "drive_gauge_usage.parry_drive_rush"]],
      ["cancelDriveRush", "キャンセルドライブラッシュ", ["driveGaugeUsage.cancelDriveRush", "battle_stats.gauge_rate_drive_rush_from_cancel", "drive_gauge_usage.cancel_drive_rush"]],
      ["driveReversal", "ドライブリバーサル", ["driveGaugeUsage.driveReversal", "battle_stats.gauge_rate_drive_reversal", "drive_gauge_usage.drive_reversal"]],
      ["damage", "ダメージ", ["driveGaugeUsage.damage", "battle_stats.gauge_rate_drive_other", "drive_gauge_usage.damage"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "percentage" }))),
  }),
  Object.freeze({
    id: "saGaugeUsage",
    label: "SAゲージ使用割合",
    kind: "distribution",
    chart: "stacked100",
    items: Object.freeze([
      ["level1", "Lv1", ["saGaugeUsage.level1", "battle_stats.gauge_rate_sa_lv1"]],
      ["level2", "Lv2", ["saGaugeUsage.level2", "battle_stats.gauge_rate_sa_lv2"]],
      ["level3", "Lv3", ["saGaugeUsage.level3", "battle_stats.gauge_rate_sa_lv3"]],
      ["ca", "CA", ["saGaugeUsage.ca", "battle_stats.gauge_rate_ca"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "ratioPercentage" }))),
  }),
  Object.freeze({
    id: "directActions",
    label: "ドライブリバーサル／ドライブパリィ／ジャストパリィ",
    kind: "direct",
    chart: "paired-bars",
    items: Object.freeze([
      ["driveReversal", "ドライブリバーサル使用", ["directActions.driveReversal", "battle_stats.drive_reversal", "direct_actions.drive_reversal"]],
      ["driveParrySuccess", "ドライブパリィ成功", ["directActions.driveParrySuccess", "battle_stats.drive_parry", "direct_actions.drive_parry_success"]],
      ["driveParryThrowOpponent", "相手のドライブパリィを投げた", ["directActions.driveParryThrowOpponent", "battle_stats.throw_drive_parry", "direct_actions.drive_parry_throw_opponent"]],
      ["driveParryThrownByOpponent", "自分のドライブパリィを投げられた", ["directActions.driveParryThrownByOpponent", "battle_stats.received_throw_drive_parry", "direct_actions.drive_parry_thrown_by_opponent"]],
      ["justParry", "ジャストパリィ", ["directActions.justParry", "battle_stats.just_parry", "direct_actions.just_parry"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "averageAndCount" }))),
  }),
  Object.freeze({
    id: "driveImpactSelf",
    label: "ドライブインパクト（自分の使用）",
    kind: "mutual-self",
    chart: "paired-bars",
    items: Object.freeze([
      ["landed", "決めた回数", ["driveImpactSelf.landed", "battle_stats.drive_impact", "drive_impact_self.landed"]],
      ["punishCounter", "パニッシュカウンターを決めた回数", ["driveImpactSelf.punishCounter", "battle_stats.punish_counter", "drive_impact_self.punish_counter"]],
      ["counteredOpponent", "相手のドライブインパクトに決めた回数", ["driveImpactSelf.counteredOpponent", "battle_stats.drive_impact_to_drive_impact", "drive_impact_self.countered_opponent"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "averageAndCount" }))),
  }),
  Object.freeze({
    id: "driveImpactOpponent",
    label: "ドライブインパクト（相手の使用）",
    kind: "mutual-opponent",
    chart: "paired-bars",
    items: Object.freeze([
      ["received", "受けた回数", ["driveImpactOpponent.received", "battle_stats.received_drive_impact", "drive_impact_opponent.received"]],
      ["punishCounter", "パニッシュカウンターを受けた回数", ["driveImpactOpponent.punishCounter", "battle_stats.received_punish_counter", "drive_impact_opponent.punish_counter"]],
      ["returnedByOpponent", "相手にドライブインパクトで返された回数", ["driveImpactOpponent.returnedByOpponent", "battle_stats.received_drive_impact_to_drive_impact", "drive_impact_opponent.returned_by_opponent"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "averageAndCount" }))),
  }),
  Object.freeze({
    id: "stun",
    label: "スタン",
    kind: "mutual",
    chart: "paired-bars",
    items: Object.freeze([
      ["dealt", "スタンさせた", ["stun.dealt", "battle_stats.stun", "stun.dealt_count"]],
      ["received", "スタンさせられた", ["stun.received", "battle_stats.received_stun", "stun.received_count"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "averageAndCount" }))),
  }),
  Object.freeze({
    id: "throws",
    label: "投げ",
    kind: "mutual",
    chart: "paired-bars",
    items: Object.freeze([
      ["landed", "投げ決めた", ["throws.landed", "battle_stats.throw_count", "throws.landed_count"]],
      ["received", "投げ受けた", ["throws.received", "battle_stats.received_throw_count", "throws.received_count"]],
      ["teched", "投げ抜け", ["throws.teched", "battle_stats.throw_tech", "throws.teched_count"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "averageAndCount" }))),
  }),
  Object.freeze({
    id: "cornerTime",
    label: "壁際（秒／戦）",
    kind: "time",
    chart: "paired-bars",
    items: Object.freeze([
      ["opponentCornered", "相手を追い詰めた時間", ["cornerTime.opponentCornered", "battle_stats.corner_time", "corner_time.opponent_cornered"]],
      ["selfCornered", "相手に追い詰められた時間", ["cornerTime.selfCornered", "battle_stats.cornered_time", "corner_time.self_cornered"]],
    ].map(([id, label, paths]) => Object.freeze({ id, label, paths, valueKind: "duration" }))),
  }),
]);

function ownPath(value, path) {
  let current = value;
  for (const part of String(path ?? "").split(".")) {
    if (!part || current == null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function firstValue(value, paths) {
  for (const path of paths ?? []) {
    const candidate = ownPath(value, path);
    if (candidate !== undefined && candidate !== null) return { value: candidate, path };
  }
  return { value: undefined, path: null };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readNumber(value, kind) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") {
    const number = finiteNumber(value);
    if (kind === "ratioPercentage" && (number == null || number < 0 || number > 1)) return null;
    if (kind === "ratioPercentage") return Number((number * 100).toFixed(2));
    return validateMetricNumber(number, kind);
  }
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const keys = kind === "percentage" || kind === "ratioPercentage"
    ? ["percentage", "percent", "ratio"]
    : kind === "average"
      ? ["average", "avg", "mean"]
      : kind === "count"
        ? ["count", "uses", "total", "value"]
        : kind === "duration"
          ? ["seconds", "durationSeconds", "duration", "value"]
          : ["value", "count", "average", "avg", "mean"];
  for (const key of keys) {
    const number = finiteNumber(value[key]);
    if (number != null) {
      if (kind === "ratioPercentage" && (number < 0 || number > 1)) return null;
      const normalized = kind === "ratioPercentage" ? Number((number * 100).toFixed(2)) : kind === "percentage" && key === "ratio" && number >= 0 && number <= 1 ? number * 100 : number;
      return validateMetricNumber(normalized, kind === "ratioPercentage" ? "percentage" : kind);
    }
  }
  return null;
}

function validateMetricNumber(number, kind) {
  if (number == null || !Number.isFinite(number)) return null;
  if (kind === "percentage") return number >= 0 && number <= 100 ? number : null;
  if (["average", "count", "duration"].includes(kind)) return number >= 0 ? number : null;
  return number;
}

function normalizeVerifiedFieldContract(contract) {
  if (
    !contract ||
    contract.version !== PLAY_FIELD_CONTRACT_VERSION ||
    !PLAY_FIELD_CONTRACT_SOURCES.includes(contract.source) ||
    !contract.paths ||
    typeof contract.paths !== "object" ||
    Array.isArray(contract.paths)
  ) {
    return null;
  }
  return contract;
}

function readScope(root) {
  const scope = firstValue(root, ["scope", "comparisonScope", "comparison_scope"]).value;
  const readScoped = (keys) => {
    const scopedValue = firstValue(scope, keys).value;
    if (scopedValue != null) return scopedValue;
    return firstValue(root, keys).value ?? null;
  };
  const value = {
    mode: readScoped(["mode", "matchMode", "match_mode"]),
    act: readScoped(["act", "actId", "act_id"]),
    character: readScoped(["character", "characterId", "character_id", "characterScope", "character_scope"]),
    version: readScoped(["version", "gameVersion", "game_version"]),
  };
  return {
    value,
    complete: Object.values(value).every((entry) => entry != null && entry !== ""),
  };
}

function readDenominator(value, group, item, average, count) {
  if (group.chart === "stacked100" && ["percentage", "ratioPercentage"].includes(item.valueKind)) {
    return { value: 100, label: "100%構成比" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, label: null };
  for (const key of ["denominator", "denom", "attempts", "sampleCount", "sample_count", "matches", "matchCount", "match_count"]) {
    const denominator = finiteNumber(value[key]);
    if (denominator != null && Number.isFinite(denominator) && denominator >= 0) return { value: denominator, label: key };
  }
  // `count` is retained as a compatibility fallback for older fixtures where
  // it represented the observation count. Explicit denominator/sampleCount
  // always wins so average-per-match metrics cannot be mislabelled.
  if (item.valueKind === "averageAndCount" && count != null) {
    return { value: count, label: "回数" };
  }
  return { value: null, label: null };
}

function readMetric(root, group, item, verifiedFieldContract, sampleCount) {
  if (group.id === "saGaugeUsage" && verifiedFieldContract?.saLevelAvailable === false) {
    return {
      value: null,
      average: null,
      count: null,
      valueKind: item.valueKind,
      unit: null,
      fieldPath: null,
      candidatePaths: item.paths,
      verified: false,
      denominator: null,
      denominatorLabel: null,
      comparable: false,
    };
  }
  const contractPath = verifiedFieldContract?.paths?.[`${group.id}.${item.id}`];
  // Candidate paths are diagnostic only.  A value contributes to a
  // comparison only when an approved contract names the exact path.
  if (typeof contractPath !== "string" || !item.paths.includes(contractPath)) {
    return {
      value: null,
      average: null,
      count: null,
      valueKind: item.valueKind,
      unit: null,
      fieldPath: null,
      candidatePaths: item.paths,
      verified: false,
      denominator: null,
      denominatorLabel: null,
      comparable: false,
    };
  }
  const found = firstValue(root, [contractPath]);
  if (found.value === undefined) {
    return {
      value: null,
      average: null,
      count: null,
      valueKind: item.valueKind,
      unit: null,
      fieldPath: null,
      candidatePaths: item.paths,
      verified: true,
      denominator: null,
      denominatorLabel: null,
      comparable: false,
    };
  }
  if (item.valueKind === "averageAndCount") {
    const average = readNumber(found.value, "average");
    const count = found.value && typeof found.value === "object"
      ? readNumber(found.value, "count")
      : null;
    const denominator = readDenominator(
      found.value,
      group,
      item,
      average,
      count,
    );
    const effectiveDenominator = denominator.value != null
      ? denominator
      : sampleCount != null
        ? { value: sampleCount, label: "sample_count" }
        : { value: PLAY_COMPARISON_WINDOW_LIMIT, label: "official_window" };
    return {
      value: average ?? count,
      average,
      count,
      valueKind: item.valueKind,
      unit: "average/count",
      fieldPath: average != null || count != null ? found.path : null,
      candidatePaths: item.paths,
      verified: true,
      denominator: effectiveDenominator.value,
      denominatorLabel: effectiveDenominator.label,
      comparable: (average ?? count) != null && effectiveDenominator.value > 0,
    };
  }
  // Buckler's gauge_rate fields are encoded as 0..1 ratios, while the
  // sanitized fixture contract keeps its legacy percentage values. Convert
  // only the verified official gauge-rate paths so both contracts remain
  // explicit and missing data never becomes a guessed zero.
  const metricKind = item.valueKind === "percentage" && found.path.startsWith("battle_stats.gauge_rate_drive_")
    ? "ratioPercentage"
    : item.valueKind;
  const value = readNumber(found.value, metricKind);
  const denominator = readDenominator(found.value, group, item, null, null);
  // Flat production values do not carry an embedded denominator.  When the
  // payload provides an explicit sample count, use it as the observation
  // denominator for count/duration metrics; never invent a zero or mark a
  // value comparable when no positive denominator is available.
  const effectiveDenominator = denominator.value != null
    ? denominator
    : sampleCount != null
      ? { value: sampleCount, label: "sample_count" }
      : { value: null, label: null };
  return {
    value,
    average: item.valueKind === "average" ? value : null,
    count: item.valueKind === "count" ? value : null,
    valueKind: item.valueKind,
    unit: ["percentage", "ratioPercentage"].includes(item.valueKind) ? "%" : item.valueKind === "duration" ? "seconds" : "count",
    fieldPath: value == null ? null : found.path,
    candidatePaths: item.paths,
    verified: true,
    denominator: effectiveDenominator.value,
    denominatorLabel: effectiveDenominator.label,
    // The official PLAY payload exposes corner durations as finite seconds
    // but does not expose a sample_count/denominator field. Keep those values
    // displayable (including a real 0.0) while the overall comparison remains
    // partial until a complete denominator contract is available.
    comparable: value != null && (
      (effectiveDenominator.value != null && effectiveDenominator.value > 0) ||
      item.valueKind === "duration"
    ),
  };
}

function findPlayRoot(payload) {
  for (const path of PLAY_ROOTS) {
    const root = ownPath(payload, path);
    if (root && typeof root === "object" && !Array.isArray(root)) return { root, path };
  }
  return { root: null, path: null };
}

function normalizePlayProfile(payload, { verifiedFieldContract = null } = {}) {
  const contract = normalizeVerifiedFieldContract(verifiedFieldContract);
  const { root, path: rootPath } = findPlayRoot(payload);
  const scope = readScope(root);
  const period = firstValue(root, ["period", "dateRange", "date_range", "timeframe", "range"]).value ?? null;
  const sampleCount = readNumber(firstValue(root, ["sampleCount", "sample_count", "matchCount", "match_count", "matches"]).value, "count");
  const groups = PLAY_METRIC_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    kind: group.kind,
    chart: group.chart,
    items: group.items.map((item) => ({
      id: item.id,
      label: item.label,
      ...readMetric(root, group, item, contract, sampleCount),
    })),
  }));
  const foundCount = groups.flatMap((group) => group.items).filter((item) => item.value != null).length;
  const comparableCount = groups.flatMap((group) => group.items).filter((item) => item.comparable).length;
  const saGroup = groups.find((group) => group.id === "saGaugeUsage");
  const saTotal = saGroup?.items.every((item) => item.value != null)
    ? saGroup.items.reduce((sum, item) => sum + Number(item.value), 0)
    : null;
  const saDistributionValid = saTotal != null && Math.abs(saTotal - 100) <= 0.5;
  if (saGroup && saTotal != null && !saDistributionValid) {
    for (const item of saGroup.items) item.comparable = false;
  }
  const finalComparableCount = groups.flatMap((group) => group.items).filter((item) => item.comparable).length;
  const expectedItems = contract
    ? groups
      .filter((group) => !(group.id === "saGaugeUsage" && contract.saLevelAvailable === false))
      .flatMap((group) => group.items).length
    : 0;
  return {
    status: root && foundCount > 0
      ? finalComparableCount < foundCount || (contract && foundCount < expectedItems)
        ? "partial"
        : "ready"
      : "unavailable",
    period,
    sampleCount: sampleCount != null && sampleCount >= 0 ? Math.floor(sampleCount) : null,
    withinWindow: sampleCount == null || (sampleCount > 0 && sampleCount <= PLAY_COMPARISON_WINDOW_LIMIT),
    groups,
    fieldRoot: rootPath,
    scope: scope.value,
    scopeComplete: scope.complete,
    foundCount,
    comparableCount,
    saDistributionValid,
    expectedItems,
    contractVersion: contract?.version ?? null,
    saLevelAvailable: contract?.saLevelAvailable !== false,
    verifiedFieldCount: foundCount,
  };
}

function comparePlayProfiles(
  selfPayload,
  opponentPayload,
  { selfError = false, opponentError = false, verifiedFieldContract = null } = {},
) {
  const self = normalizePlayProfile(selfPayload, { verifiedFieldContract });
  const opponent = normalizePlayProfile(opponentPayload, { verifiedFieldContract });
  const samePeriod = self.period == null || opponent.period == null || JSON.stringify(self.period) === JSON.stringify(opponent.period);
  const sameSample = self.sampleCount == null || opponent.sampleCount == null || self.sampleCount === opponent.sampleCount;
  const withinWindow = (self.sampleCount == null || self.withinWindow) && (opponent.sampleCount == null || opponent.withinWindow);
  const sameScope = !self.scopeComplete || !opponent.scopeComplete || JSON.stringify(self.scope) === JSON.stringify(opponent.scope);
  const groups = self.groups.map((group) => ({
    id: group.id,
    label: group.label,
    kind: group.kind,
    chart: group.chart,
    items: group.items.map((item) => ({
      id: item.id,
      label: item.label,
      self: item,
      opponent: opponent.groups.find((candidate) => candidate.id === group.id)?.items.find((candidate) => candidate.id === item.id) ?? null,
    })),
  }));
  const foundPairs = groups.flatMap((group) => group.items).filter((item) => item.self?.value != null && item.opponent?.value != null).length;
  const comparablePairs = groups.flatMap((group) => group.items).filter((item) => item.self?.comparable && item.opponent?.comparable).length;
  const expectedItems = groups
    .filter((group) => !(group.id === "saGaugeUsage" && verifiedFieldContract?.saLevelAvailable === false))
    .flatMap((group) => group.items).length;
  const hasSelfData = self.foundCount > 0;
  const hasOpponentData = opponent.foundCount > 0;
  const status = selfError || opponentError
    ? hasSelfData || hasOpponentData ? "partial" : "error"
    : comparablePairs === expectedItems && expectedItems > 0 && samePeriod && sameSample && sameScope && withinWindow
      ? "ready"
      : foundPairs > 0
        ? !samePeriod || !sameSample || !sameScope || !withinWindow
          ? "insufficient_sample"
          : "partial"
        : hasSelfData || hasOpponentData
          ? "partial"
          : "unavailable";
  const fieldGroups = groups.map((group) => ({
    id: group.id,
    items: group.items.map((item) => ({
      id: item.id,
      self: item.self?.fieldPath ?? null,
      opponent: item.opponent?.fieldPath ?? null,
    })),
  }));
  return {
    status,
    selfStatus: selfError ? "error" : self.status,
    opponentStatus: opponentError ? "error" : opponent.status,
    period: samePeriod ? self.period : null,
    selfSampleCount: self.sampleCount,
    opponentSampleCount: opponent.sampleCount,
    samePeriod,
    sameSample,
    sameScope,
    withinWindow,
    windowLimit: PLAY_COMPARISON_WINDOW_LIMIT,
    radarEligible: false,
    groups,
    source: "authenticated-play-profile",
    fieldMap: {
      selfRoot: self.fieldRoot,
      opponentRoot: opponent.fieldRoot,
      contractVersion: self.contractVersion ?? opponent.contractVersion,
      pairedItems: foundPairs,
      comparableItems: comparablePairs,
      verifiedItems: self.verifiedFieldCount + opponent.verifiedFieldCount,
      scope: { self: self.scope, opponent: opponent.scope },
      groups: fieldGroups,
      saLevelAvailable: self.saLevelAvailable && opponent.saLevelAvailable,
    },
  };
}

module.exports = {
  PLAY_APPROVED_FIELD_CONTRACT,
  PLAY_COMPARISON_WINDOW_LIMIT,
  PLAY_FIELD_CONTRACT_VERSION,
  PLAY_METRIC_GROUPS,
  comparePlayProfiles,
  normalizePlayProfile,
};
