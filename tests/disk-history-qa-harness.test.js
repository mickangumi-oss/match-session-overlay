"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");

test("disk-history QA hook is fail-closed and excluded from the packaged app", () => {
  assert.match(main, /app\.isPackaged/);
  assert.match(main, /MATCH_OVERLAY_QA_LOCAL/);
  assert.match(main, /MATCH_OVERLAY_QA_DISK_HISTORY/);
  assert.match(main, /MATCH_OVERLAY_QA_DISK_HISTORY_GUARD/);
  assert.match(main, /\.mso-qa-disk-history-v1/);
  assert.match(builder, /- src\/\*\*\/\*/);
  assert.doesNotMatch(builder, /test-local/);
  assert.doesNotMatch(builder, /mso-p1-disk/);
});
