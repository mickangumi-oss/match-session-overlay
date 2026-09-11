"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isKnownHistoryActRecord,
  mergeHistoryActProvenance,
  normalizeStoredHistoryAct,
  readHistoryActProvenance,
} = require("../src/history-act-provenance");

test("missing and blank raw Act fields stay unscoped", () => {
  assert.deepEqual(readHistoryActProvenance({}), {
    actId: null,
    actIdKnown: false,
    actIdSource: null,
  });
  assert.deepEqual(readHistoryActProvenance({ replay_season_id: "" }), {
    actId: null,
    actIdKnown: false,
    actIdSource: null,
  });
});

test("explicit Act 0 remains distinct from an unscoped value", () => {
  assert.deepEqual(readHistoryActProvenance({ replay_season_id: 0 }), {
    actId: 0,
    actIdKnown: true,
    actIdSource: "replay_season_id",
  });
  assert.equal(isKnownHistoryActRecord({ actId: 0, actIdKnown: true }), true);
  assert.equal(isKnownHistoryActRecord({ actId: 0 }), false);
});

test("legacy stored Act 0 is read as unknown without rewriting the file", () => {
  assert.deepEqual(normalizeStoredHistoryAct({ actId: 0 }), {
    actId: null,
    actIdKnown: false,
  });
  assert.deepEqual(normalizeStoredHistoryAct({ actId: 13 }), {
    actId: 13,
    actIdKnown: true,
  });
});

test("refreshing a legacy Act 0 row with unknown Act evidence clears the false scope", () => {
  assert.deepEqual(mergeHistoryActProvenance(
    { actId: 0 },
    { actId: null, actIdKnown: false },
  ), {
    actId: null,
    actIdKnown: false,
  });
  assert.deepEqual(mergeHistoryActProvenance(
    { actId: 0, actIdKnown: true },
    { actId: null, actIdKnown: false },
  ), {
    actId: 0,
    actIdKnown: true,
  });
});
