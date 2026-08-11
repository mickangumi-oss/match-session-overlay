"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SOCIAL_IDLE_SUSPEND_MS,
  SOCIAL_MANUAL_COOLDOWN_MS,
  SOCIAL_REFRESH_INTERVAL_MS,
  manualSocialRefreshAllowed,
  shouldSuspendSocialRefresh,
  socialRefreshDelayMs,
} = require("../src/social-refresh-policy");

test("social refresh uses an independent five-minute interval", () => {
  assert.equal(SOCIAL_REFRESH_INTERVAL_MS, 300_000);
  assert.equal(socialRefreshDelayMs({ lastSuccessfulAt: null, immediate: true }), 0);
  assert.equal(socialRefreshDelayMs({ immediate: false, jitterMs: 0 }), 300_000);
});

test("recent data prevents an immediate window-show request", () => {
  const now = 1_000_000;
  assert.equal(socialRefreshDelayMs({
    immediate: true,
    lastSuccessfulAt: now - 30_000,
    now,
    jitterMs: 0,
  }), SOCIAL_REFRESH_INTERVAL_MS);
});

test("manual refresh has a sixty-second cooldown", () => {
  assert.equal(SOCIAL_MANUAL_COOLDOWN_MS, 60_000);
  assert.equal(manualSocialRefreshAllowed(160_000, 159_999), false);
  assert.equal(manualSocialRefreshAllowed(160_000, 160_000), true);
});

test("six idle hours suspend only when tracking and the game are both stopped", () => {
  const now = 10_000_000 + SOCIAL_IDLE_SUSPEND_MS;
  const base = { lastActivityAt: 10_000_000, now };
  assert.equal(shouldSuspendSocialRefresh(base), true);
  assert.equal(shouldSuspendSocialRefresh({ ...base, trackingActive: true }), false);
  assert.equal(shouldSuspendSocialRefresh({ ...base, gameRunning: true }), false);
});

test("social failures never retry sooner than the normal interval", () => {
  assert.equal(socialRefreshDelayMs({ consecutiveFailures: 1, jitterMs: 0 }), 300_000);
  assert.equal(socialRefreshDelayMs({ consecutiveFailures: 3, jitterMs: 0 }), 900_000);
  assert.equal(socialRefreshDelayMs({ consecutiveFailures: 4, jitterMs: 0 }), 1_800_000);
});
