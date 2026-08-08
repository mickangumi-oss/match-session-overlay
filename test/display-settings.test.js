"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyDisplayItemUpdate,
  defaultDisplayItems,
  sanitizeDisplayItems,
  visibleMetricCount,
} = require("../src/display-settings");

test("legacy graph setting migrates into the shared item map", () => {
  const items = sanitizeDisplayItems(null, { legacyGraphVisible: false });
  assert.equal(items.graph, false);
  assert.equal(items.currentRating, true);
  assert.equal(items.currentCharacter, true);
});

test("at least one display item is always retained", () => {
  const allOff = Object.fromEntries(
    Object.keys(defaultDisplayItems()).map((key) => [key, false]),
  );
  assert.throws(
    () => applyDisplayItemUpdate(defaultDisplayItems(), allOff),
    /DISPLAY_ITEM_REQUIRED/,
  );
  const repaired = sanitizeDisplayItems(allOff);
  assert.equal(repaired.record, true);
  assert.equal(visibleMetricCount(repaired), 1);
});

test("window mode and orientation never create separate item selections", () => {
  const shared = applyDisplayItemUpdate(defaultDisplayItems(), {
    winRate: false,
    currentCharacter: false,
  });
  const windowItems = { ...shared };
  const overlayItems = { ...shared };
  const verticalItems = { ...shared };
  assert.deepEqual(windowItems, overlayItems);
  assert.deepEqual(windowItems, verticalItems);
});
