"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchCompleteBattlelogForAct } = require("../src/opponent-battlelog-fetch");

function page(pageNumber, {
  totalPages = 1,
  responsePage = pageNumber,
  responseActId = 13,
  hasReplayList = true,
  rawCount = 1,
  normalizedCount = rawCount,
  replays = [{ replayId: `replay-${pageNumber}`, actId: 13 }],
} = {}) {
  return {
    totalPages,
    responsePage,
    responseActId,
    hasReplayList,
    rawCount,
    normalizedCount,
    replays,
  };
}

function fetcherFrom(pages, { delays = {}, failures = {} } = {}) {
  return async ({ page: pageNumber }) => {
    if (delays[pageNumber]) await new Promise((resolve) => setTimeout(resolve, delays[pageNumber]));
    if (failures[pageNumber]) throw new Error(failures[pageNumber]);
    return pages[pageNumber] ?? page(pageNumber, { totalPages: pages.length - 1 });
  };
}

test("fetches all pages in order, caps concurrent production requests at three, and reports scoped progress", async () => {
  const totalPages = 22;
  const pages = Array.from({ length: totalPages + 1 }, (_, pageNumber) => page(pageNumber, {
    totalPages,
    replays: [{ replayId: `replay-${pageNumber}`, actId: 13 }],
  }));
  let active = 0;
  let maxActive = 0;
  const fetched = [];
  const progress = [];
  const result = await fetchCompleteBattlelogForAct({
    profileId: "12345678",
    locale: "ja-jp",
    act: 13,
    generation: 4,
    selectedOwnCharacterId: "all",
    requestToken: 9,
    fetchPage: async ({ page: pageNumber }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      fetched.push(pageNumber);
      await new Promise((resolve) => setTimeout(resolve, pageNumber % 2 ? 1 : 3));
      active -= 1;
      return pages[pageNumber];
    },
    assertGeneration: () => {},
    publishProgress: (value) => progress.push(value),
    concurrency: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.records.length, totalPages);
  assert.equal(maxActive, 3);
  assert.deepEqual(result.records.map((record) => record.__sourcePage), Array.from({ length: totalPages }, (_, index) => index + 1));
  assert.equal(progress[0].requestToken, 9);
  assert.equal(progress.at(-1).totalPages, totalPages);
  assert.equal(new Set(fetched).size, totalPages);
});

test("stops before any extra request when total_page exceeds the safe limit", async () => {
  const requested = [];
  const result = await fetchCompleteBattlelogForAct({
    act: 13,
    safeMaxPages: 100,
    fetchPage: async ({ page: pageNumber }) => {
      requested.push(pageNumber);
      return page(pageNumber, { totalPages: 101 });
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.reasons, ["TOTAL_PAGE_LIMIT_EXCEEDED"]);
  assert.deepEqual(requested, [1]);
});

test("distinguishes an explicit zero replay list from a missing replay list", async () => {
  const explicitZero = await fetchCompleteBattlelogForAct({
    act: 13,
    fetchPage: async () => page(1, { rawCount: 0, normalizedCount: 0, replays: [] }),
  });
  const missingList = await fetchCompleteBattlelogForAct({
    act: 13,
    fetchPage: async () => page(1, { hasReplayList: false, rawCount: 0, normalizedCount: 0, replays: [] }),
  });

  assert.equal(explicitZero.ok, true);
  assert.deepEqual(explicitZero.records, []);
  assert.equal(missingList.ok, false);
  assert.deepEqual(missingList.diagnostics.reasons, ["REPLAY_LIST_MISSING"]);
});

test("fails closed for missing or changed page, Act, list, count, and total metadata", async (t) => {
  const cases = [
    ["page", page(1, { responsePage: null }), "PAGE_NUMBER_MISSING_OR_MISMATCH"],
    ["Act", page(1, { responseActId: null, recordActId: null }), "ACT_METADATA_MISSING_OR_MISMATCH"],
    ["list", page(1, { hasReplayList: false }), "REPLAY_LIST_MISSING"],
    ["normalization", page(1, { rawCount: 2, normalizedCount: 1 }), "REPLAY_NORMALIZATION_INCOMPLETE"],
  ];
  for (const [label, response, reason] of cases) {
    await t.test(label, async () => {
      const result = await fetchCompleteBattlelogForAct({
        act: 13,
        fetchPage: async () => response,
      });
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics.reasons.includes(reason), true);
    });
  }

  const changedPage = await fetchCompleteBattlelogForAct({
    act: 13,
    fetchPage: async ({ page: pageNumber }) => page(pageNumber, {
      totalPages: 2,
      responsePage: pageNumber === 2 ? 1 : pageNumber,
    }),
  });
  const changedAct = await fetchCompleteBattlelogForAct({
    act: 13,
    fetchPage: async ({ page: pageNumber }) => page(pageNumber, {
      totalPages: 2,
      responseActId: pageNumber === 2 ? 12 : 13,
    }),
  });
  const changedTotal = await fetchCompleteBattlelogForAct({
    act: 13,
    fetchPage: async ({ page: pageNumber }) => page(pageNumber, {
      totalPages: pageNumber === 2 ? 3 : 2,
    }),
  });
  assert.equal(changedPage.diagnostics.reasons.includes("PAGE_NUMBER_MISSING_OR_MISMATCH"), true);
  assert.equal(changedAct.diagnostics.reasons.includes("ACT_METADATA_MISSING_OR_MISMATCH"), true);
  assert.equal(changedTotal.diagnostics.reasons.includes("TOTAL_PAGE_CHANGED"), true);
});

test("propagates a page failure and a cancelled generation instead of returning partial READY data", async () => {
  await assert.rejects(
    fetchCompleteBattlelogForAct({
      act: 13,
      fetchPage: fetcherFrom([null, page(1, { totalPages: 2 }), null], { failures: { 2: "PAGE_FAILED" } }),
    }),
    /PAGE_FAILED/,
  );

  let checks = 0;
  await assert.rejects(
    fetchCompleteBattlelogForAct({
      act: 13,
      fetchPage: async ({ page: pageNumber }) => page(pageNumber, { totalPages: 2 }),
      assertGeneration: () => {
        checks += 1;
        if (checks > 1) throw new Error("PRIVATE_DATA_CLEARED");
      },
    }),
    /PRIVATE_DATA_CLEARED/,
  );
});
