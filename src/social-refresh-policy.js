"use strict";

const { errorBackoffMs } = require("./poll-policy");

const SOCIAL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SOCIAL_MANUAL_COOLDOWN_MS = 60 * 1000;
const SOCIAL_IDLE_SUSPEND_MS = 6 * 60 * 60 * 1000;
const SOCIAL_REFRESH_JITTER_MAX_MS = 10 * 1000;

function shouldSuspendSocialRefresh({
  lastActivityAt,
  now = Date.now(),
  trackingActive = false,
  gameRunning = false,
} = {}) {
  if (trackingActive || gameRunning) return false;
  return Math.max(0, Number(now) - Number(lastActivityAt || now)) >=
    SOCIAL_IDLE_SUSPEND_MS;
}

function socialRefreshDelayMs({
  immediate = false,
  lastSuccessfulAt = null,
  consecutiveFailures = 0,
  now = Date.now(),
  jitterMs = 0,
} = {}) {
  const elapsed = lastSuccessfulAt == null
    ? Infinity
    : Math.max(0, Number(now) - Number(lastSuccessfulAt));
  if (immediate && elapsed >= SOCIAL_REFRESH_INTERVAL_MS) return 0;
  const regularDelay = immediate
    ? Math.max(0, SOCIAL_REFRESH_INTERVAL_MS - elapsed)
    : SOCIAL_REFRESH_INTERVAL_MS;
  const failureDelay = consecutiveFailures > 0
    ? errorBackoffMs(consecutiveFailures)
    : 0;
  const base = Math.max(regularDelay, failureDelay, SOCIAL_REFRESH_INTERVAL_MS);
  return base + Math.min(
    SOCIAL_REFRESH_JITTER_MAX_MS,
    Math.max(0, Number(jitterMs) || 0),
  );
}

function manualSocialRefreshAllowed(availableAt, now = Date.now()) {
  return Number(now) >= Math.max(0, Number(availableAt) || 0);
}

module.exports = {
  SOCIAL_IDLE_SUSPEND_MS,
  SOCIAL_MANUAL_COOLDOWN_MS,
  SOCIAL_REFRESH_INTERVAL_MS,
  SOCIAL_REFRESH_JITTER_MAX_MS,
  manualSocialRefreshAllowed,
  shouldSuspendSocialRefresh,
  socialRefreshDelayMs,
};
