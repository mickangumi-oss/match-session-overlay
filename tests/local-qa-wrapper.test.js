"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runLocalQa } = require("../scripts/run-local-qa");

test("local QA fails closed when its runner is missing", () => {
  const messages = [];
  const missingRunner = path.join(
    os.tmpdir(),
    "match-session-overlay-missing-runner",
    `${process.pid}-${Date.now()}.cjs`,
  );
  const originalError = console.error;
  console.error = (...args) => messages.push(args.join(" "));
  try {
    assert.equal(
      runLocalQa({ runnerPath: missingRunner, targetName: "contract" }),
      2,
    );
  } finally {
    console.error = originalError;
  }

  assert.match(messages.join("\n"), /FAIL: test-local\/ QA harness is unavailable/);
});
