"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const guard = path.join(root, "scripts", "build-guard.js");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("normal build is mechanically locked without temporary approval", () => {
  const result = spawnSync(process.execPath, [guard], {
    cwd: root,
    env: { ...process.env, MATCH_OVERLAY_BUILD_UNLOCK: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BUILD_LOCKED/);
  assert.match(packageJson.scripts.build, /build-guard\.js/);
});

test("build guard accepts only an explicit non-persistent approval value", () => {
  const result = spawnSync(process.execPath, [guard], {
    cwd: root,
    env: { ...process.env, MATCH_OVERLAY_BUILD_UNLOCK: "one-time-test-approval" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
});
