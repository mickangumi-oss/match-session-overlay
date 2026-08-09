"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { fetchCompleteFriendSnapshot } = require("../src/friend-snapshot");

function page(number, totalPages, ids) {
  return {
    page: number,
    totalPages,
    players: ids.map((profileId) => ({
      profileId,
      name: `SYNTHETIC ${profileId}`,
      online: false,
    })),
  };
}

test("every FRIENDS source page is fetched exactly once and combined", async () => {
  const calls = [];
  const pages = [null, page(1, 3, ["synthetic-a"]), page(2, 3, ["synthetic-b"]), page(3, 3, ["synthetic-c"])];
  const result = await fetchCompleteFriendSnapshot({
    fetchPage: async (number) => {
      calls.push(number);
      return pages[number];
    },
    normalizePage: (value) => value,
  });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(result.friends.map(({ profileId }) => profileId), [
    "synthetic-a",
    "synthetic-b",
    "synthetic-c",
  ]);
});

test("an authentication seed reuses page one without a duplicate request", async () => {
  const calls = [];
  await fetchCompleteFriendSnapshot({
    seedPage: page(1, 2, ["synthetic-a"]),
    fetchPage: async (number) => {
      calls.push(number);
      return page(2, 2, ["synthetic-b"]);
    },
    normalizePage: (value) => value,
  });
  assert.deepEqual(calls, [2]);
});

test("a rejected page leaves the caller without a partial snapshot", async () => {
  await assert.rejects(
    fetchCompleteFriendSnapshot({
      fetchPage: async (number) => {
        if (number === 2) throw new Error("SYNTHETIC_NETWORK_FAILURE");
        return page(1, 2, ["synthetic-a"]);
      },
      normalizePage: (value) => value,
    }),
    /SYNTHETIC_NETWORK_FAILURE/,
  );
});

test("clamped, empty, and moving source pages are rejected as incomplete", async () => {
  const cases = [
    page(1, 2, ["synthetic-b"]),
    page(2, 2, []),
    page(2, 3, ["synthetic-b"]),
    page(2, 2, ["synthetic-a"]),
  ];
  for (const second of cases) {
    await assert.rejects(
      fetchCompleteFriendSnapshot({
        fetchPage: async (number) => number === 1
          ? page(1, 2, ["synthetic-a"])
          : second,
        normalizePage: (value) => value,
      }),
      /SOCIAL_PAGE_INCOMPLETE/,
    );
  }
});
