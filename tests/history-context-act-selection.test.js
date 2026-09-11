"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "main.js"),
  "utf8",
);

test("latest opponent context ignores the renderer's convenience Act", () => {
  assert.match(
    mainSource,
    /if \(actSelectionSource !== "explicit"\) \{\s*requestedActId = null;\s*\}/,
  );
  assert.doesNotMatch(
    mainSource,
    /actSelectionSource !== "explicit" && normalizeHistoryActId\(requestedActId\) === 0/,
  );
  assert.match(
    mainSource,
    /selectorResolution\.selector === "latest"[\s\S]*?requestedActId = selectorResolution\.actId[\s\S]*?normalizedRequestedActId = selectorResolution\.actId/,
  );
  assert.doesNotMatch(mainSource, /const selectorMismatch =/);
  assert.match(
    mainSource,
    /const probedAct = normalizePositiveActId\(actProbe\?\.act\)/,
  );
  assert.match(
    mainSource,
    /const recordForActScope = actSelectionSource === "explicit"\s*\?\s*resolvedRecord\s*:\s*\{ \.\.\.resolvedRecord, actId: null \}/,
  );
  assert.match(mainSource, /Act scope is required only for the optional round-trend acquisition/);
  assert.match(mainSource, /let historyAcquireError = null/);
  assert.match(mainSource, /officialHistory\?\.complete === true/);
});
