"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSevenDayResultChart } = require("../src/history-chart-model");

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
