"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
if (!fs.existsSync(path.join(root, ".git"))) process.exit(0);
const result = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
