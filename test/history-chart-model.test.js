"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildHistoryRatingAxis,
  buildSevenDayResultChart,
} = require("../src/history-chart-model");

test("a single day uses one of seven fixed calendar slots", () => {
  const model = buildSevenDayResultChart(
    [{ dateKey: "2042-05-10", result: "win" }],
  );
  assert.equal(model.slotCount, 7);
  assert.equal(model.startDateKey, "2042-05-04");
  assert.equal(model.endDateKey, "2042-05-10");
  assert.deepEqual(model.buckets.map((bucket) => bucket.dayIndex), [6]);
});

test("empty dates keep their spacing without producing buckets", () => {
  const model = buildSevenDayResultChart([
    { dateKey: "2042-05-04", result: "loss" },
    { dateKey: "2042-05-07", result: "win" },
    { dateKey: "2042-05-10", result: "win" },
  ]);
  assert.deepEqual(model.buckets.map((bucket) => bucket.dayIndex), [0, 3, 6]);
  assert.equal(model.buckets.length, 3);
});

test("more than seven days is clipped to the trailing seven days", () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    dateKey: `2042-05-${String(index + 1).padStart(2, "0")}`,
    result: index % 2 ? "loss" : "win",
  }));
  const model = buildSevenDayResultChart(records);
  assert.equal(model.startDateKey, "2042-05-04");
  assert.equal(model.endDateKey, "2042-05-10");
  assert.equal(model.buckets.length, 7);
});

test("the selected filter end date is the chart endpoint", () => {
  const model = buildSevenDayResultChart(
    [{ dateKey: "2042-05-03", result: "win" }],
    { endDateKey: "2042-05-08" },
  );
  assert.equal(model.startDateKey, "2042-05-02");
  assert.equal(model.endDateKey, "2042-05-08");
  assert.deepEqual(model.buckets.map((bucket) => bucket.dayIndex), [1]);
});

test("same-day wins and losses are one stacked bucket", () => {
  const model = buildSevenDayResultChart([
    { dateKey: "2042-05-10", result: "win" },
    { dateKey: "2042-05-10", result: "loss" },
    { dateKey: "2042-05-10", result: "win" },
  ]);
  assert.deepEqual(model.buckets[0], {
    dateKey: "2042-05-10",
    dayIndex: 6,
    win: 2,
    loss: 1,
    draw: 0,
    total: 3,
  });
});

test("large LP ranges use at most four readable axis labels", () => {
  const axis = buildHistoryRatingAxis([100, 120_000], "LP");
  assert.deepEqual(axis.ticks, [150_000, 100_000, 50_000, 0]);
  assert.ok(axis.ticks.length <= 4);
  assert.equal(axis.step, 50_000);
});

test("nearby LP values keep a minimum one-thousand-point grid", () => {
  const axis = buildHistoryRatingAxis([120_100, 120_900], "LP");
  assert.deepEqual(axis.ticks, [121_000, 120_000]);
  assert.equal(axis.step, 1000);
});
