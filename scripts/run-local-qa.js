"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runner = path.join(root, "test-local", "run-local-qa.cjs");
const target = process.argv[2] || "all";

function runLocalQa({ runnerPath = runner, targetName = target } = {}) {
  if (!fs.existsSync(runnerPath)) {
    console.error(
      `[qa:${targetName}] FAIL: test-local/ QA harness is unavailable. Restore the approved local harness before running this gate.`,
    );
    return 2;
  }

  const result = spawnSync(process.execPath, [runnerPath, targetName], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, MATCH_OVERLAY_QA_LOCAL: "1" },
  });
  return result.status ?? 1;
}

if (require.main === module) process.exit(runLocalQa());

module.exports = { runLocalQa };
