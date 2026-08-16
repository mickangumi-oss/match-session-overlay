"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runner = path.join(root, "test-local", "run-local-qa.cjs");
const target = process.argv[2] || "all";

if (!fs.existsSync(runner)) {
  console.log(`[qa:${target}] SKIP: test-local/ is not installed in this checkout.`);
  process.exit(0);
}

const result = spawnSync(process.execPath, [runner, target], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, MATCH_OVERLAY_QA_LOCAL: "1" },
});
process.exit(result.status ?? 1);
