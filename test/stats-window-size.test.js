"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compactStatsWindowInitialSize,
  expandBoundsToMinimumHeight,
  resizeBoundsForGraphVisibility,
  statsWindowSizeConstraints,
} = require("../src/stats-window-size");

const preset = {
  minWidth: 700,
  minHeight: 250,
  maxWidth: 1200,
  maxHeight: 700,
};

test("display item changes keep a current size below the new recommended minimum", () => {
  assert.deepEqual(
    statsWindowSizeConstraints(preset, { width: 520, height: 210 }),
    {
      minWidth: 520,
      minHeight: 210,
      maxWidth: 1200,
      maxHeight: 700,
    },
  );
});

test("adding cards expands height without changing position or width", () => {
  assert.deepEqual(
    expandBoundsToMinimumHeight(
      { x: 40, y: 50, width: 380, height: 430 },
      { minHeight: 759, maxHeight: 1100 },
    ),
    { x: 40, y: 50, width: 380, height: 759 },
  );
  assert.deepEqual(
    expandBoundsToMinimumHeight(
      { x: 40, y: 50, width: 380, height: 820 },
      { minHeight: 759, maxHeight: 1100 },
    ),
    { x: 40, y: 50, width: 380, height: 820 },
  );
});

test("display item changes keep a current size above the normal maximum", () => {
  assert.deepEqual(
    statsWindowSizeConstraints(preset, { width: 1280, height: 760 }),
    {
      minWidth: 700,
      minHeight: 250,
      maxWidth: 1280,
      maxHeight: 760,
    },
  );
});

test("mode and orientation changes continue to use the full preset constraints", () => {
  assert.deepEqual(statsWindowSizeConstraints(preset), preset);
});

test("a new stats window starts ten percent smaller without crossing its minimum", () => {
  assert.deepEqual(
    compactStatsWindowInitialSize({
      width: 1050,
      height: 300,
      minWidth: 764,
      minHeight: 240,
    }),
    { width: 945, height: 270 },
  );
  assert.deepEqual(
    compactStatsWindowInitialSize({
      width: 420,
      height: 220,
      minWidth: 420,
      minHeight: 220,
    }),
    { width: 420, height: 220 },
  );
});

test("turning off a vertical graph removes its content height and keeps width", () => {
  assert.deepEqual(
    resizeBoundsForGraphVisibility(
      { x: 40, y: 50, width: 380, height: 690 },
      { height: 720 },
      { height: 482, minHeight: 474, maxHeight: 1100 },
    ),
    { x: 40, y: 50, width: 380, height: 474 },
  );
});

test("turning a graph back on restores only its content height", () => {
  assert.deepEqual(
    resizeBoundsForGraphVisibility(
      { x: 40, y: 50, width: 420, height: 500 },
      { height: 482 },
      { height: 720, minHeight: 604, maxHeight: 1100 },
    ),
    { x: 40, y: 50, width: 420, height: 738 },
  );
});
