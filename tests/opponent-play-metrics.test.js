"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PLAY_APPROVED_FIELD_CONTRACT,
  comparePlayProfiles,
  normalizePlayProfile,
} = require("../src/opponent-play-metrics");

const VERIFIED_FIXTURE_CONTRACT = Object.freeze({
  version: "buckler-play.v1",
  source: "sanitized-fixture",
  saLevelAvailable: true,
  paths: Object.freeze({
    "driveGaugeUsage.driveParry": "drive_gauge_usage.drive_parry",
    "driveGaugeUsage.driveImpact": "drive_gauge_usage.drive_impact",
    "driveGaugeUsage.overdriveArts": "drive_gauge_usage.overdrive_arts",
    "driveGaugeUsage.parryDriveRush": "drive_gauge_usage.parry_drive_rush",
    "driveGaugeUsage.cancelDriveRush": "drive_gauge_usage.cancel_drive_rush",
    "driveGaugeUsage.driveReversal": "drive_gauge_usage.drive_reversal",
    "driveGaugeUsage.damage": "drive_gauge_usage.damage",
    "saGaugeUsage.level1": "battle_stats.gauge_rate_sa_lv1",
    "saGaugeUsage.level2": "battle_stats.gauge_rate_sa_lv2",
    "saGaugeUsage.level3": "battle_stats.gauge_rate_sa_lv3",
    "saGaugeUsage.ca": "battle_stats.gauge_rate_ca",
    "directActions.driveReversal": "direct_actions.drive_reversal",
    "directActions.driveParrySuccess": "direct_actions.drive_parry_success",
    "directActions.driveParryThrowOpponent": "direct_actions.drive_parry_throw_opponent",
    "directActions.driveParryThrownByOpponent": "direct_actions.drive_parry_thrown_by_opponent",
    "directActions.justParry": "direct_actions.just_parry",
    "driveImpactSelf.landed": "drive_impact_self.landed",
    "driveImpactSelf.punishCounter": "drive_impact_self.punish_counter",
    "driveImpactSelf.counteredOpponent": "drive_impact_self.countered_opponent",
    "driveImpactOpponent.received": "drive_impact_opponent.received",
    "driveImpactOpponent.punishCounter": "drive_impact_opponent.punish_counter",
    "driveImpactOpponent.returnedByOpponent": "drive_impact_opponent.returned_by_opponent",
    "stun.dealt": "stun.dealt",
    "stun.received": "stun.received",
    "throws.landed": "throws.landed",
    "throws.received": "throws.received",
    "throws.teched": "throws.teched",
    "cornerTime.opponentCornered": "corner_time.opponent_cornered",
    "cornerTime.selfCornered": "corner_time.self_cornered",
  }),
});

function playPayload(overrides = {}) {
  return {
    pageProps: {
      play: {
        period: { from: "2026-08-01", to: "2026-08-31" },
        sample_count: 20,
        scope: { mode: "ranked", act: "13", character: "1", version: "fixture-v1" },
        drive_gauge_usage: {
          drive_parry: { percentage: 10.94 },
          drive_impact: { percentage: 2.1 },
          overdrive_arts: { percentage: 21.16 },
          parry_drive_rush: { percentage: 4.85 },
          cancel_drive_rush: { percentage: 35.89 },
          drive_reversal: { percentage: 0.5 },
          damage: { percentage: 24.53 },
        },
        battle_stats: {
          gauge_rate_drive_guard: 0.1094,
          gauge_rate_drive_impact: 0.021,
          gauge_rate_drive_arts: 0.2116,
          gauge_rate_drive_rush_from_parry: 0.0485,
          gauge_rate_drive_rush_from_cancel: 0.3589,
          gauge_rate_drive_reversal: 0.005,
          gauge_rate_drive_other: 0.2453,
          drive_reversal: { average: 1.2, denominator: 20 },
          drive_parry: { average: 2.2, denominator: 20 },
          just_parry: { average: 3.2, denominator: 20 },
          gauge_rate_sa_lv1: 0.2985,
          gauge_rate_sa_lv2: 0.0895,
          gauge_rate_sa_lv3: 0.4477,
          gauge_rate_ca: 0.1641,
        },
        direct_actions: {
          drive_reversal: { average: 1.2, denominator: 20 },
          drive_parry_success: { average: 2.2, denominator: 20 },
          drive_parry_throw_opponent: { average: 0.3, denominator: 20 },
          drive_parry_thrown_by_opponent: { average: 0.4, denominator: 20 },
          just_parry: { average: 3.2, denominator: 20 },
        },
        drive_impact_self: {
          landed: { average: 0.15, denominator: 20 },
          punish_counter: { average: 0.05, denominator: 20 },
          countered_opponent: { average: 0.1, denominator: 20 },
        },
        drive_impact_opponent: {
          received: { average: 0.2, denominator: 20 },
          punish_counter: { average: 0.04, denominator: 20 },
          returned_by_opponent: { average: 0.1, denominator: 20 },
        },
        stun: {
          dealt: { average: 0.1, denominator: 20 },
          received: { average: 0.05, denominator: 20 },
        },
        throws: {
          landed: { average: 0.25, denominator: 20 },
          received: { average: 0.2, denominator: 20 },
          teched: { average: 0.15, denominator: 20 },
        },
        corner_time: {
          opponent_cornered: { seconds: 12, denominator: 20 },
          self_cornered: { seconds: 8, denominator: 20 },
        },
        ...overrides,
      },
    },
  };
}

test("normalizes the explicit PLAY comparison field contract", () => {
  const result = normalizePlayProfile(playPayload(), { verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT });
  assert.equal(result.status, "ready");
  assert.equal(result.sampleCount, 20);
  assert.equal(result.fieldRoot, "pageProps.play");
  assert.equal(result.groups[0].items[0].value, 10.94);
  assert.equal(result.groups[2].items[0].average, 1.2);
  assert.equal(result.groups[2].items[0].denominator, 20);
  assert.equal(result.groups[1].items[0].value, 29.85);
  assert.equal(result.groups[1].items[1].value, 8.95);
  assert.equal(result.groups[1].items[2].value, 44.77);
  assert.equal(result.groups[1].items[3].value, 16.41);
  assert.equal(result.groups[7].items[0].unit, "seconds");
  assert.equal(result.scopeComplete, true);
  assert.equal(result.comparableCount, 29);
  assert.equal(result.saLevelAvailable, true);
  assert.equal(result.saDistributionValid, true);
});

test("reads the production flat battle_stats values for action, throw, stun, and corner metrics", () => {
  const payload = playPayload();
  payload.pageProps.play.battle_stats = {
    gauge_rate_drive_guard: 0.1094,
    gauge_rate_drive_impact: 0.021,
    gauge_rate_drive_arts: 0.2116,
    gauge_rate_drive_rush_from_parry: 0.0485,
    gauge_rate_drive_rush_from_cancel: 0.3589,
    gauge_rate_drive_reversal: 0.005,
    gauge_rate_drive_other: 0.2453,
    gauge_rate_sa_lv1: 0.2985,
    gauge_rate_sa_lv2: 0.0895,
    gauge_rate_sa_lv3: 0.4477,
    gauge_rate_ca: 0.1641,
    drive_reversal: 1.2,
    drive_parry: 2.2,
    throw_drive_parry: 0.3,
    received_throw_drive_parry: 0.4,
    just_parry: 3.2,
    drive_impact: 0.15,
    punish_counter: 0.05,
    drive_impact_to_drive_impact: 0.1,
    received_drive_impact: 0.2,
    received_punish_counter: 0.04,
    received_drive_impact_to_drive_impact: 0.1,
    stun: 0.1,
    received_stun: 0.05,
    throw_count: 0.25,
    received_throw_count: 0.2,
    throw_tech: 0.15,
    corner_time: 12,
    cornered_time: 8,
  };

  const result = normalizePlayProfile(payload, {
    verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT,
  });
  const item = (groupId, itemId) => result.groups
    .find((group) => group.id === groupId).items
    .find((candidate) => candidate.id === itemId);

  assert.equal(result.status, "ready");
  assert.equal(item("directActions", "driveReversal").value, 1.2);
  assert.equal(item("directActions", "driveReversal").comparable, true);
  assert.equal(item("driveImpactSelf", "landed").value, 0.15);
  assert.equal(item("stun", "received").value, 0.05);
  assert.equal(item("throws", "teched").value, 0.15);
  assert.equal(item("cornerTime", "opponentCornered").value, 12);
  assert.equal(item("cornerTime", "opponentCornered").unit, "seconds");
});

test("keeps flat corner seconds including zero and rejects invalid durations", () => {
  const payload = playPayload();
  payload.pageProps.play.sample_count = 10;
  payload.pageProps.play.battle_stats = {
    corner_time: "0.0",
    cornered_time: 8.4,
  };
  const result = normalizePlayProfile(payload, { verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT });
  const item = (id) => result.groups.find((group) => group.id === "cornerTime").items.find((candidate) => candidate.id === id);
  assert.equal(item("opponentCornered").value, 0);
  assert.equal(item("opponentCornered").unit, "seconds");
  assert.equal(item("opponentCornered").comparable, true);
  assert.equal(item("selfCornered").value, 8.4);

  const invalid = normalizePlayProfile({
    pageProps: { play: { sample_count: 10, battle_stats: { corner_time: -1, cornered_time: "Infinity" } } },
  }, { verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT });
  const invalidItem = (id) => invalid.groups.find((group) => group.id === "cornerTime").items.find((candidate) => candidate.id === id);
  assert.equal(invalidItem("opponentCornered").value, null);
  assert.equal(invalidItem("selfCornered").value, null);
});

test("displays official corner seconds when PLAY omits sample metadata", () => {
  const payload = {
    props: { pageProps: { play: { battle_stats: { corner_time: 12.4, cornered_time: 0 } } } },
  };
  const result = normalizePlayProfile(payload, { verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT });
  const item = (id) => result.groups.find((group) => group.id === "cornerTime").items.find((candidate) => candidate.id === id);
  assert.equal(item("opponentCornered").value, 12.4);
  assert.equal(item("opponentCornered").comparable, true);
  assert.equal(item("selfCornered").value, 0);
  assert.equal(item("selfCornered").comparable, true);
  assert.equal(result.sampleCount, null);
});

test("pairs self and opponent only when period and sample count agree", () => {
  const result = comparePlayProfiles(playPayload(), playPayload(), {
    verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.samePeriod, true);
  assert.equal(result.sameSample, true);
  assert.equal(result.sameScope, true);
  assert.equal(result.radarEligible, false);
  assert.equal(result.groups[0].items[0].self.value, 10.94);
  assert.equal(result.groups[0].items[0].opponent.value, 10.94);
});

test("candidate-only PLAY paths never reach READY without a verified contract", () => {
  const result = comparePlayProfiles(playPayload(), playPayload());
  assert.equal(result.status, "unavailable");
  assert.equal(result.fieldMap.contractVersion, null);
  assert.equal(result.fieldMap.pairedItems, 0);
  assert.equal(result.groups[0].items[0].self.value, null);
});

test("does not convert missing PLAY fields into zero", () => {
  const result = comparePlayProfiles({}, {});
  assert.equal(result.status, "unavailable");
  assert.equal(result.groups[0].items[0].self.value, null);
  assert.equal(result.groups[0].items[0].opponent.value, null);
});

test("mismatched period or sample count remains insufficient", () => {
  const result = comparePlayProfiles(
    playPayload(),
    playPayload({ period: { from: "2026-07-01", to: "2026-07-31" }, sample_count: 19 }),
    { verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT },
  );
  assert.equal(result.status, "insufficient_sample");
  assert.equal(result.samePeriod, false);
  assert.equal(result.sameSample, false);
});

test("keeps the comparison window bounded at one hundred while retaining a real count", () => {
  const result = normalizePlayProfile(playPayload({ sample_count: 140 }));
  assert.equal(result.sampleCount, 140);
  assert.equal(result.withinWindow, false);
});

test("fails closed for zero samples and zero denominators while retaining valid zero metrics", () => {
  const zeroSample = comparePlayProfiles(
    playPayload({ sample_count: 0 }),
    playPayload({ sample_count: 0 }),
    { verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT },
  );
  assert.notEqual(zeroSample.status, "ready");
  assert.equal(zeroSample.selfSampleCount, 0);

  const zeroDenominator = comparePlayProfiles(
    playPayload({ direct_actions: { drive_reversal: { average: 0, denominator: 0 } } }),
    playPayload({ direct_actions: { drive_reversal: { average: 0, denominator: 0 } } }),
    { verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT },
  );
  assert.notEqual(zeroDenominator.status, "ready");

  const validZero = normalizePlayProfile(
    playPayload({ drive_gauge_usage: { drive_parry: { percentage: 0 } } }),
    { verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT },
  );
  assert.equal(validZero.groups[0].items[0].value, 0);
  assert.equal(validZero.groups[0].items[0].comparable, true);
});

test("rejects negative, non-finite, and out-of-range PLAY metric values", () => {
  const invalid = normalizePlayProfile(
    playPayload({
      drive_gauge_usage: {
        drive_parry: { percentage: -1 },
        drive_impact: { percentage: 101 },
        overdrive_arts: { percentage: "Infinity" },
      },
      direct_actions: {
        drive_reversal: { average: -1, denominator: 20 },
      },
    }),
    { verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT },
  );
  assert.equal(invalid.groups[0].items[0].value, null);
  assert.equal(invalid.groups[0].items[1].value, null);
  assert.equal(invalid.groups[0].items[2].value, null);
  assert.equal(invalid.groups[2].items[0].average, null);
  assert.notEqual(invalid.status, "ready");
});

test("distinguishes partial and retrieval error states", () => {
  const partial = comparePlayProfiles(playPayload(), null, {
    opponentError: true,
    verifiedFieldContract: VERIFIED_FIXTURE_CONTRACT,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.selfStatus, "ready");
  assert.equal(partial.opponentStatus, "error");
  const error = comparePlayProfiles(null, null, { selfError: true, opponentError: true });
  assert.equal(error.status, "error");
  assert.equal(error.selfStatus, "error");
  assert.equal(error.opponentStatus, "error");
});
