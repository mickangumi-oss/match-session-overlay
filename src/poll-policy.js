"use strict";

const MIN_POLL_INTERVAL_SECONDS = 120;
const IDLE_SLOWDOWN_AFTER_MS = 30 * 60 * 1000;
const IDLE_AUTO_STOP_AFTER_MS = 60 * 60 * 1000;
const IDLE_POLL_INTERVAL_MS = 5 * 60 * 1000;
const SERVICE_REQUEST_MIN_GAP_MS = 1500;
const POLL_JITTER_MAX_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const ERROR_BACKOFF_MS = [
  2 * 60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
];

function inactivityMs(lastNewMatchAt, now = Date.now()) {
  if (lastNewMatchAt == null || lastNewMatchAt === "") return 0;
  if (!Number.isFinite(Number(lastNewMatchAt))) return 0;
  return Math.max(0, Number(now) - Number(lastNewMatchAt));
}

function shouldAutoStopForInactivity(lastNewMatchAt, now = Date.now()) {
  return inactivityMs(lastNewMatchAt, now) >= IDLE_AUTO_STOP_AFTER_MS;
}

function successfulPollDelayMs({
  configuredIntervalSeconds,
  lastNewMatchAt,
  now = Date.now(),
  jitterMs = 0,
}) {
  const configuredMs =
    Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      Number(configuredIntervalSeconds) || MIN_POLL_INTERVAL_SECONDS,
    ) * 1000;
  const baseDelay =
    inactivityMs(lastNewMatchAt, now) >= IDLE_SLOWDOWN_AFTER_MS
      ? Math.max(configuredMs, IDLE_POLL_INTERVAL_MS)
      : configuredMs;
  return baseDelay + Math.min(POLL_JITTER_MAX_MS, Math.max(0, Number(jitterMs) || 0));
}

function errorBackoffMs(consecutiveFailures) {
  const index = Math.min(
    ERROR_BACKOFF_MS.length - 1,
    Math.max(0, Number(consecutiveFailures) - 1),
  );
  return ERROR_BACKOFF_MS[index];
}

module.exports = {
  ERROR_BACKOFF_MS,
  IDLE_AUTO_STOP_AFTER_MS,
  IDLE_POLL_INTERVAL_MS,
  IDLE_SLOWDOWN_AFTER_MS,
  MAX_CONSECUTIVE_FAILURES,
  MIN_POLL_INTERVAL_SECONDS,
  POLL_JITTER_MAX_MS,
  SERVICE_REQUEST_MIN_GAP_MS,
  errorBackoffMs,
  inactivityMs,
  shouldAutoStopForInactivity,
  successfulPollDelayMs,
};
