"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ERROR_BACKOFF_MS,
  IDLE_AUTO_STOP_AFTER_MS,
  SERVICE_REQUEST_MIN_GAP_MS,
  errorBackoffMs,
  retryAfterMilliseconds,
  shouldAutoStopForInactivity,
  successfulPollDelayMs,
} = require("../src/poll-policy");

test("poll policy preserves the official-service spacing and bounded backoff", () => {
  assert.equal(SERVICE_REQUEST_MIN_GAP_MS, 1500);
  assert.equal(errorBackoffMs(1), ERROR_BACKOFF_MS[0]);
  assert.equal(errorBackoffMs(99), ERROR_BACKOFF_MS.at(-1));
  assert.equal(successfulPollDelayMs({ configuredIntervalSeconds: 120 }), 120_000);
});

test("poll policy stops only after the configured inactivity boundary", () => {
  const now = 2_000_000_000_000;
  assert.equal(shouldAutoStopForInactivity(now - IDLE_AUTO_STOP_AFTER_MS + 1, now), false);
  assert.equal(shouldAutoStopForInactivity(now - IDLE_AUTO_STOP_AFTER_MS, now), true);
});

test("Retry-After supports seconds and HTTP dates with a maximum delay", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.equal(retryAfterMilliseconds("120", now, 600_000), 120_000);
  assert.equal(
    retryAfterMilliseconds("Tue, 01 Jan 2030 00:05:00 GMT", now, 600_000),
    300_000,
  );
  assert.equal(retryAfterMilliseconds("99999", now, 600_000), 600_000);
  assert.equal(retryAfterMilliseconds("invalid", now, 600_000), 0);
});
