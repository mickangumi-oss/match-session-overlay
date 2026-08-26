"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { fetchHistoryPagesConcurrently } = require("../src/history-page-fetch");

test("ten history pages start together and return results in page order", async () => {
  const started = [];
  const releases = new Map();
  const published = [];
  const request = fetchHistoryPagesConcurrently(
    async (page) => {
      started.push(page);
      await new Promise((resolve) => releases.set(page, resolve));
      return {
        rawCount: page === 10 ? 5 : 10,
        replays: [{ page }],
      };
    },
    {
      maxPages: 10,
      pageSize: 10,
      concurrency: 10,
      onPage: ({ page, completedPages }) => published.push({ page, completedPages }),
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...started].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let page = 10; page >= 1; page -= 1) releases.get(page)();
  const replays = await request;

  assert.deepEqual(replays.map((replay) => replay.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(published.map(({ completedPages }) => completedPages), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(published.map(({ page }) => page), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test("a short first page still completes the already requested ten-page batch", async () => {
  const calls = [];
  const replays = await fetchHistoryPagesConcurrently(
    async (page) => {
      calls.push(page);
      return { rawCount: page === 1 ? 3 : 0, replays: page === 1 ? [{ page }] : [] };
    },
    { maxPages: 10, pageSize: 10, concurrency: 10 },
  );

  assert.deepEqual(calls.sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(replays.map((replay) => replay.page), [1]);
});
