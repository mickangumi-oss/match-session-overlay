"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { fetchHistoryPagesConcurrently } = require("../src/history-page-fetch");

test("bounded history pool returns all matches in page order", async () => {
  const started = [];
  const published = [];
  let active = 0;
  let maxActive = 0;
  const replays = await fetchHistoryPagesConcurrently(
    async (page) => {
      started.push(page);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return {
          rawCount: page === 10 ? 5 : 10,
          totalPages: 10,
          replays: Array.from({ length: 10 }, (_, index) => ({ page, index })),
        };
      } finally {
        active -= 1;
      }
    },
    {
      maxPages: 10,
      pageSize: 10,
      concurrency: 3,
      onPage: ({ page, completedPages }) => published.push({ page, completedPages }),
    },
  );
  assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(replays.length, 100);
  assert.deepEqual([...new Set(replays.map((replay) => replay.page))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(published.map(({ completedPages }) => completedPages), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(published.map(({ page }) => page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(maxActive <= 3);
});

test("refills a free slot before the slowest page in the current group finishes", async () => {
  const started = [];
  const startedAt = new Map();
  let pageTwoFinishedAt = 0;
  let active = 0;
  let maxActive = 0;
  const replays = await fetchHistoryPagesConcurrently(
    async (page) => {
      started.push(page);
      startedAt.set(page, Date.now());
      active += 1;
      maxActive = Math.max(maxActive, active);
      const delay = page === 2 ? 120 : page >= 5 && page <= 7 ? 80 : 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (page === 2) pageTwoFinishedAt = Date.now();
      active -= 1;
      return { rawCount: page === 10 ? 5 : 10, totalPages: 10, replays: [{ page }] };
    },
    { maxPages: 10, pageSize: 10, concurrency: 3 },
  );

  assert.equal(replays.length, 10);
  assert.equal(started.length, 10);
  assert.ok(startedAt.get(5) < pageTwoFinishedAt);
  assert.ok(maxActive <= 3);
});

test("a short page stops future batches without dropping the current batch", async () => {
  const calls = [];
  const replays = await fetchHistoryPagesConcurrently(
    async (page) => {
      calls.push(page);
      return { rawCount: page === 1 ? 3 : 0, replays: page === 1 ? [{ page }] : [] };
    },
    { maxPages: 10, pageSize: 10, concurrency: 3 },
  );

  assert.deepEqual(calls.sort((left, right) => left - right), [1]);
  assert.deepEqual(replays.map((replay) => replay.page), [1]);
});

test("totalPages stops before launching pages beyond the official total", async () => {
  const calls = [];
  const replays = await fetchHistoryPagesConcurrently(async (page) => {
    calls.push(page);
    return { rawCount: 10, totalPages: 2, replays: [{ page }] };
  }, { maxPages: 10, pageSize: 10, concurrency: 3 });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(replays.map((replay) => replay.page), [1, 2]);
});

function sharedHundredRecordPage(counter, delayMs = 4) {
  return async (page) => {
    counter.count += 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      rawCount: page === 10 ? 5 : 10,
      totalPages: 10,
      replays: Array.from({ length: page === 10 ? 5 : 10 }, (_, index) => ({ page, index })),
    };
  };
}

for (const [label, lateDelayMs] of [["import-first", 0], ["backfill-first", 12]]) {
  test(`shared history pool coalesces ${label} consumers`, async () => {
    const counter = { count: 0 };
    const events = [[], []];
    const fetchPage = sharedHundredRecordPage(counter);
    const first = fetchHistoryPagesConcurrently(fetchPage, {
      maxPages: 10, pageSize: 10, concurrency: 3,
      shareKey: `synthetic-${label}`,
      onPage: (event) => events[0].push(event.page),
    });
    if (lateDelayMs) await new Promise((resolve) => setTimeout(resolve, lateDelayMs));
    const second = fetchHistoryPagesConcurrently(fetchPage, {
      maxPages: 10, pageSize: 10, concurrency: 3,
      shareKey: `synthetic-${label}`,
      onPage: (event) => events[1].push(event.page),
    });
    const [firstRows, secondRows] = await Promise.all([first, second]);
    assert.equal(counter.count, 10);
    assert.equal(firstRows.length, 95);
    assert.equal(secondRows.length, 95);
    assert.deepEqual(events[0], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(events[1], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
}

test("shared history pool isolates consumer callback failure and retries after producer failure", async () => {
  const counter = { count: 0 };
  const fetchPage = sharedHundredRecordPage(counter, 1);
  const healthy = fetchHistoryPagesConcurrently(fetchPage, {
    maxPages: 10, pageSize: 10, concurrency: 3, shareKey: "synthetic-consumer-failure",
  });
  const failing = fetchHistoryPagesConcurrently(fetchPage, {
    maxPages: 10, pageSize: 10, concurrency: 3,
    shareKey: "synthetic-consumer-failure",
    onPage: () => { throw new Error("consumer-only"); },
  });
  const [healthyRows, failingResult] = await Promise.all([
    healthy,
    failing.then(() => null, (error) => error.message),
  ]);
  assert.equal(healthyRows.length, 95);
  assert.equal(failingResult, "consumer-only");
  assert.equal(counter.count, 10);

  let failedOnce = true;
  const retryPage = async (page) => {
    if (failedOnce) {
      failedOnce = false;
      throw new Error("producer-failure");
    }
    return { rawCount: 1, totalPages: 1, replays: [{ page }] };
  };
  await assert.rejects(
    fetchHistoryPagesConcurrently(retryPage, { shareKey: "synthetic-retry" }),
    /producer-failure/,
  );
  const retried = await fetchHistoryPagesConcurrently(retryPage, { shareKey: "synthetic-retry" });
  assert.equal(retried.length, 1);
});

test("shared history pool keeps scopes separate and replays completed pages to a late consumer", async () => {
  const counters = { A: 0, B: 0 };
  const page = (scope) => async (pageNumber) => {
    counters[scope] += 1;
    await new Promise((resolve) => setTimeout(resolve, pageNumber === 1 ? 8 : 2));
    return { rawCount: pageNumber === 10 ? 5 : 10, totalPages: 10, replays: [{ scope, pageNumber }] };
  };
  const firstEvents = [];
  const first = fetchHistoryPagesConcurrently(page("A"), {
    maxPages: 10, pageSize: 10, concurrency: 3, shareKey: "scope-A",
    onPage: ({ page: pageNumber }) => firstEvents.push(pageNumber),
  });
  await new Promise((resolve) => setTimeout(resolve, 12));
  const late = fetchHistoryPagesConcurrently(page("A"), {
    maxPages: 10, pageSize: 10, concurrency: 3, shareKey: "scope-A",
  });
  const other = fetchHistoryPagesConcurrently(page("B"), {
    maxPages: 10, pageSize: 10, concurrency: 3, shareKey: "scope-B",
  });
  await Promise.all([first, late, other]);
  assert.equal(counters.A, 10);
  assert.equal(counters.B, 10);
  assert.deepEqual([...firstEvents].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
