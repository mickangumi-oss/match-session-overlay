"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "run-release-security.js");
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;

function printConfig(args, environment = {}) {
  const result = spawnSync(process.execPath, [script, ...args, "--print-config"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  return result;
}

test("security preflight uses the separated Terra/high profile", () => {
  const result = printConfig(["--preflight"]);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.profile, "preflight");
  assert.equal(config.model, "gpt-5.6-terra");
  assert.equal(config.effort, "high");
  assert.match(config.outputDirectory, new RegExp(`v${version.replaceAll(".", "\\.")}-preflight$`));
});

test("formal release profile remains strict and separate from preflight output", () => {
  const release = printConfig([]);
  const preflight = printConfig(["--preflight"]);
  assert.equal(release.status, 0, release.stderr);
  assert.equal(preflight.status, 0, preflight.stderr);
  const releaseConfig = JSON.parse(release.stdout);
  const preflightConfig = JSON.parse(preflight.stdout);
  assert.equal(releaseConfig.profile, "release");
  assert.equal(releaseConfig.model, "gpt-5.6-sol");
  assert.equal(releaseConfig.effort, "xhigh");
  assert.notEqual(releaseConfig.outputDirectory, preflightConfig.outputDirectory);
});

test("preflight accepts an explicit positive cost cap only", () => {
  const capped = printConfig(["--preflight"], {
    CODEX_SECURITY_PREFLIGHT_MAX_COST: "4.5",
  });
  assert.equal(capped.status, 0, capped.stderr);
  assert.equal(JSON.parse(capped.stdout).maxCost, "4.5");

  const invalid = printConfig(["--preflight"], {
    CODEX_SECURITY_PREFLIGHT_MAX_COST: "zero",
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /positive number/);
});

test("unknown wrapper options are rejected before a scan starts", () => {
  const result = spawnSync(process.execPath, [script, "--unexpected"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported option: --unexpected/);
});
