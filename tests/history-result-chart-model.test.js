"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildHistoryRatingPeriod,
  buildHistoryRatingSeries,
  buildSevenDayResultChart,
  dateKeyForHistoryRecord,
  dateKeyForTimestamp,
  filterHistoryRatingRecords,
  thinHistoryPoints,
} = require("../src/history-chart-model");

test("rating periods share one local calendar range", () => {
  const records = [
    { dateKey: "2026-08-03", value: 1 },
    { dateKey: "2026-08-09", value: 2 },
    { dateKey: "2026-08-10", value: 3 },
    { dateKey: "2026-08-16", value: 4 },
  ];
  const all = buildHistoryRatingPeriod(records, { mode: "all", todayKey: "2026-08-16" });
  assert.deepEqual(all, {
    mode: "all",
    weekOffset: 0,
    startDateKey: "2026-08-03",
    endDateKey: "2026-08-16",
  });

  const currentWeek = buildHistoryRatingPeriod(records, {
    mode: "week",
    todayKey: "2026-08-16",
    weekOffset: 0,
  });
  assert.deepEqual(currentWeek, {
    mode: "week",
    weekOffset: 0,
    startDateKey: "2026-08-10",
    endDateKey: "2026-08-16",
  });
  assert.deepEqual(
    filterHistoryRatingRecords(records, currentWeek).map((record) => record.dateKey),
    ["2026-08-10", "2026-08-16"],
  );

  const recent = buildHistoryRatingPeriod(records, {
    mode: "recent",
    todayKey: "2026-08-16",
  });
  assert.deepEqual(recent, {
    mode: "recent",
    weekOffset: 0,
    startDateKey: "2026-08-10",
    endDateKey: "2026-08-16",
  });
});

test("rating point thinning keeps endpoints and a large movement", () => {
  const points = [
    { value: 100 },
    { value: 101 },
    { value: 150 },
    { value: 102 },
    { value: 103 },
  ];
  assert.deepEqual(thinHistoryPoints(points, 3), [points[0], points[2], points[4]]);
  assert.deepEqual(thinHistoryPoints(points, 20), points);
  const leadingGap = [{ value: null }, { value: 100 }, { value: 100 }, { value: 100 }];
  assert.equal(thinHistoryPoints(leadingGap, 3).some((point) => point.value === 100), true);
});

test("play-day rating series uses the last rated match for each day", () => {
  const records = [
    { dateKey: "2026-08-12", playedAt: 1, mr: 2000 },
    { dateKey: "2026-08-12", playedAt: 2, mr: 2012 },
    { dateKey: "2026-08-14", playedAt: 3, mr: 1998 },
  ];
  const period = buildHistoryRatingPeriod(records, { mode: "all" });
  assert.deepEqual(
    buildHistoryRatingSeries(records, {
      period,
      dateMode: "played",
      valueForRecord: (record) => record.mr,
      timestampForRecord: (record) => record.playedAt,
    }).map(({ dateKey, value }) => ({ dateKey, value })),
    [
      { dateKey: "2026-08-12", value: 2012 },
      { dateKey: "2026-08-14", value: 1998 },
    ],
  );
});

test("all-day rating series carries the last value and keeps leading gaps empty", () => {
  const records = [
    { dateKey: "2026-08-09", playedAt: 1, mr: 1900 },
    { dateKey: "2026-08-11", playedAt: 2, mr: 1910 },
    { dateKey: "2026-08-13", playedAt: 3, mr: 1930 },
  ];
  const week = buildHistoryRatingPeriod(records, {
    mode: "week",
    todayKey: "2026-08-16",
  });
  const points = buildHistoryRatingSeries(records, {
    period: week,
    dateMode: "all",
    valueForRecord: (record) => record.mr,
    timestampForRecord: (record) => record.playedAt,
  });
  assert.deepEqual(points.map((point) => point.dateKey), [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13",
    "2026-08-14", "2026-08-15", "2026-08-16",
  ]);
  assert.deepEqual(points.map((point) => point.value), [1900, 1910, 1910, 1930, 1930, 1930, 1930]);

  const noPriorValue = buildHistoryRatingSeries([
    { dateKey: "2026-08-13", playedAt: 1, mr: 1930 },
  ], {
    period: week,
    dateMode: "all",
    valueForRecord: (record) => record.mr,
    timestampForRecord: (record) => record.playedAt,
  });
  assert.deepEqual(noPriorValue.map((point) => point.value), [null, null, null, 1930, 1930, 1930, 1930]);
});

test("all-day rating series returns no data points when a rating is absent", () => {
  const period = buildHistoryRatingPeriod([
    { dateKey: "2026-08-12" },
    { dateKey: "2026-08-14" },
  ], { mode: "all" });
  const points = buildHistoryRatingSeries([
    { dateKey: "2026-08-12", playedAt: 1, mr: null },
    { dateKey: "2026-08-14", playedAt: 2, mr: null },
  ], {
    period,
    dateMode: "all",
    valueForRecord: (record) => record.mr,
    timestampForRecord: (record) => record.playedAt,
  });
  assert.deepEqual(points.map((point) => point.value), [null, null, null]);
});

test("result chart selects the latest seven match dates and orders them oldest first", () => {
  const chart = buildSevenDayResultChart([
    { dateKey: "2026-08-01", result: "win" },
    { dateKey: "2026-08-02", result: "loss" },
    { dateKey: "2026-08-04", result: "win" },
    { dateKey: "2026-08-05", result: "loss" },
    { dateKey: "2026-08-07", result: "win" },
    { dateKey: "2026-08-08", result: "loss" },
    { dateKey: "2026-08-10", result: "win" },
    { dateKey: "2026-08-12", result: "win" },
  ]);

  assert.equal(chart.slotCount, 7);
  assert.deepEqual(
    chart.buckets.map((bucket) => bucket.dateKey),
    ["2026-08-02", "2026-08-04", "2026-08-05", "2026-08-07", "2026-08-08", "2026-08-10", "2026-08-12"],
  );
  assert.deepEqual(chart.buckets.map((bucket) => bucket.dayIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(chart.buckets.some((bucket) => bucket.dateKey === "2026-08-03"), false);
});

test("result chart aggregates same-day wins and losses into one bucket", () => {
  const chart = buildSevenDayResultChart([
    { dateKey: "2026-08-12", result: "win" },
    { dateKey: "2026-08-12", result: "loss" },
    { dateKey: "2026-08-12", result: "win" },
    { dateKey: "2026-08-12", result: "draw" },
  ]);

  assert.deepEqual(chart.buckets, [{
    dateKey: "2026-08-12",
    win: 2,
    loss: 1,
    draw: 1,
    dayIndex: 0,
    total: 4,
  }]);
});

test("result chart returns only existing dates when fewer than seven are available", () => {
  const chart = buildSevenDayResultChart([
    { dateKey: "2026-08-12", result: "win" },
    { dateKey: "2026-08-09", result: "loss" },
  ]);

  assert.equal(chart.slotCount, 2);
  assert.equal(chart.startDateKey, "2026-08-09");
  assert.equal(chart.endDateKey, "2026-08-12");
});

test("result chart keeps JST late-night and after-midnight matches on separate dates", () => {
  const lateNightStart = Date.UTC(2026, 7, 25, 14, 48, 0);
  const beforeMidnight = Date.UTC(2026, 7, 25, 14, 59, 59);
  const afterMidnight = Date.UTC(2026, 7, 25, 15, 0, 0);
  const firstVisibleAfterMidnight = Date.UTC(2026, 7, 25, 15, 2, 0);
  assert.equal(dateKeyForTimestamp(lateNightStart), "2026-08-25");
  assert.equal(dateKeyForTimestamp(beforeMidnight), "2026-08-25");
  assert.equal(dateKeyForTimestamp(afterMidnight), "2026-08-26");
  assert.equal(dateKeyForTimestamp(firstVisibleAfterMidnight), "2026-08-26");
  assert.equal(dateKeyForHistoryRecord({ playedAt: beforeMidnight }), "2026-08-25");
  assert.equal(dateKeyForHistoryRecord({ uploadedAt: afterMidnight / 1000 }), "2026-08-26");

  const records = [
    { playedAt: beforeMidnight, result: "loss" },
    { playedAt: afterMidnight, result: "win" },
    { playedAt: Date.UTC(2026, 7, 25, 15, 8, 0), result: "loss" },
    { playedAt: Date.UTC(2026, 7, 25, 15, 11, 0), result: "win" },
  ];
  const chart = buildSevenDayResultChart(records.map((record) => ({
    dateKey: dateKeyForHistoryRecord(record),
    result: record.result,
  })));
  assert.deepEqual(chart.buckets.map(({ dateKey, win, loss, total }) => ({ dateKey, win, loss, total })), [
    { dateKey: "2026-08-25", win: 0, loss: 1, total: 1 },
    { dateKey: "2026-08-26", win: 2, loss: 1, total: 3 },
  ]);
});

test("result chart date keys stay JST-stable when the process timezone is UTC", () => {
  const beforeMidnight = Date.UTC(2026, 7, 25, 14, 59, 59);
  const afterMidnight = Date.UTC(2026, 7, 25, 15, 0, 0);
  assert.equal(dateKeyForTimestamp(beforeMidnight, "Asia/Tokyo"), "2026-08-25");
  assert.equal(dateKeyForTimestamp(afterMidnight, "Asia/Tokyo"), "2026-08-26");
  assert.equal(dateKeyForTimestamp(beforeMidnight, "UTC"), "2026-08-25");
  assert.equal(dateKeyForTimestamp(afterMidnight, "UTC"), "2026-08-25");
});

test("result chart returns an empty state for an empty history", () => {
  const chart = buildSevenDayResultChart([]);
  assert.deepEqual(chart, {
    slotCount: 0,
    startDateKey: "",
    endDateKey: "",
    buckets: [],
  });
});
