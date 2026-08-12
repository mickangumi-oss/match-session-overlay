"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyCurrentProfileRatings } = require("../src/history-current-rating");

test("current MR replaces only the newest ranked match for the current character", () => {
  const records = [
    { replayId: "old", matchType: "ranked", characterId: 26, uploadedAt: 100, ownMr: 1400 },
    { replayId: "new", matchType: "ranked", characterId: 26, uploadedAt: 200, ownMr: 1417 },
    { replayId: "other", matchType: "ranked", characterId: 1, uploadedAt: 300, ownMr: 1600 },
  ];

  assert.equal(
    applyCurrentProfileRatings(records, { characterId: 26, mr: 1422 }),
    true,
  );
  assert.equal(records[0].ownMr, 1400);
  assert.equal(records[1].ownMr, 1422);
  assert.equal(records[2].ownMr, 1600);
});

test("a replay-id scope updates only the newest newly fetched ranked match", () => {
  const records = [
    { replayId: "existing", matchType: "ranked", characterId: 26, uploadedAt: 300, ownMr: 1400 },
    { replayId: "new-1", matchType: "ranked", characterId: 26, uploadedAt: 100, ownMr: 1405 },
    { replayId: "new-2", matchType: "ranked", characterId: 26, uploadedAt: 200, ownMr: 1410 },
  ];

  applyCurrentProfileRatings(
    records,
    { characterId: 26, mr: 1422 },
    { replayIds: ["new-1", "new-2"] },
  );
  assert.equal(records[0].ownMr, 1400);
  assert.equal(records[1].ownMr, 1405);
  assert.equal(records[2].ownMr, 1422);
});

test("current ratings never leak into another character or casual match", () => {
  const records = [
    { replayId: "casual", matchType: "casual", characterId: 26, uploadedAt: 300, ownMr: 1300 },
    { replayId: "other", matchType: "ranked", characterId: 1, uploadedAt: 200, ownMr: 1500 },
  ];

  assert.equal(
    applyCurrentProfileRatings(records, { characterId: 26, mr: 1422 }),
    false,
  );
  assert.deepEqual(records.map((record) => record.ownMr), [1300, 1500]);
});

test("MASTER profile keeps current MR and supplemental LP on the same final point", () => {
  const records = [
    { replayId: "latest", matchType: "ranked", characterId: 26, uploadedAt: 200, ownMr: 1417, ownLp: 900000 },
  ];

  applyCurrentProfileRatings(records, { characterId: 26, mr: 1422, lp: 912345 });
  assert.equal(records[0].ownMr, 1422);
  assert.equal(records[0].ownLp, 912345);
});

test("an LP-band profile also replaces only the final LP graph point", () => {
  const records = [
    { replayId: "old", matchType: "ranked", characterId: 7, uploadedAt: 100, ownLp: 12000 },
    { replayId: "latest", matchType: "ranked", characterId: 7, uploadedAt: 200, ownLp: 12180 },
  ];

  applyCurrentProfileRatings(records, { characterId: 7, mr: null, lp: 12345 });
  assert.equal(records[0].ownLp, 12000);
  assert.equal(records[1].ownLp, 12345);
});
