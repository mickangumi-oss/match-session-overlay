"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  OTHER_MATCH_HISTORY_LIMIT,
  OWN_MATCH_HISTORY_LIMIT,
  matchHistoryRetentionLimit,
  retainNewestMatchHistory,
} = require("../src/match-history-retention");

const syntheticRecords = (count) =>
  Array.from({ length: count }, (_, index) => ({
    replayId: `synthetic-replay-${index}`,
    uploadedAt: index + 1,
  }));

test("own player history retains the newest 5000 synthetic records", () => {
  const limit = matchHistoryRetentionLimit({
    profileId: "900000000001",
    ownProfileId: "900000000001",
    viewedProfileId: null,
  });
  const retained = retainNewestMatchHistory(syntheticRecords(5050), limit);

  assert.equal(limit, OWN_MATCH_HISTORY_LIMIT);
  assert.equal(retained.length, 5000);
  assert.equal(retained[0].uploadedAt, 5050);
  assert.equal(retained.at(-1).uploadedAt, 51);
});

test("selected other player history deletes records older than the newest 100", () => {
  const limit = matchHistoryRetentionLimit({
    profileId: "900000000002",
    ownProfileId: "900000000001",
    viewedProfileId: "900000000002",
  });
  const retained = retainNewestMatchHistory(syntheticRecords(160), limit);

  assert.equal(limit, OTHER_MATCH_HISTORY_LIMIT);
  assert.equal(retained.length, 100);
  assert.equal(retained[0].uploadedAt, 160);
  assert.equal(retained.at(-1).uploadedAt, 61);
});

test("unknown ownership does not destructively trim history before authentication", () => {
  assert.equal(
    matchHistoryRetentionLimit({
      profileId: "900000000003",
      ownProfileId: null,
      viewedProfileId: null,
    }),
    OWN_MATCH_HISTORY_LIMIT,
  );
});

test("main process trims an existing other-player store when it is selected", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8",
  );

  assert.match(
    mainSource,
    /historyViewPlayer = nextHistoryViewPlayer;[\s\S]*?trimMatchHistoryStore\(selectedProfileId, selectedStore\)[\s\S]*?persistMatchHistoryStore\(selectedProfileId, selectedStore\)/,
  );
  assert.match(
    mainSource,
    /retainNewestMatchHistory\([\s\S]*?historyRetentionLimit\(normalizedProfileId\)/,
  );
});
