"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clampBoundsToWorkArea,
  mainWindowInitialHeight,
} = require("../src/stats-window-size");

test("uses the 920 DIP initial height when the work area permits it", () => {
  assert.equal(mainWindowInitialHeight(1040), 920);
  assert.equal(mainWindowInitialHeight(960), 920);
});

test("clamps the initial height below 920 DIP on short work areas", () => {
  assert.equal(mainWindowInitialHeight(900), 900);
  assert.equal(mainWindowInitialHeight(820), 820);
  assert.equal(mainWindowInitialHeight(800), 800);
  assert.equal(mainWindowInitialHeight(760), 760);
});

test("clamps initial bounds to the DIP work area without changing an in-area size", () => {
  assert.deepEqual(
    clampBoundsToWorkArea(
      { x: 1700, y: 900, width: 900, height: 500 },
      { x: 0, y: 0, width: 1920, height: 1040 },
      8,
    ),
    { x: 1012, y: 532, width: 900, height: 500 },
  );
});

test("shrinks an oversized initial preset before positioning it", () => {
  assert.deepEqual(
    clampBoundsToWorkArea(
      { x: 0, y: 0, width: 1200, height: 1100 },
      { x: 0, y: 0, width: 1280, height: 720 },
      8,
    ),
    { x: 8, y: 8, width: 1200, height: 704 },
  );
});
