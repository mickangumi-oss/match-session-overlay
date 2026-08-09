"use strict";

function incompleteSnapshotError() {
  const error = new Error("SOCIAL_PAGE_INCOMPLETE");
  error.code = "SOCIAL_PAGE_INCOMPLETE";
  return error;
}

function validPageNumber(value) {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

async function fetchCompleteFriendSnapshot({ fetchPage, normalizePage, seedPage = null } = {}) {
  if (typeof fetchPage !== "function" || typeof normalizePage !== "function") {
    throw new TypeError("FRIEND_SNAPSHOT_FETCH_REQUIRED");
  }
  const first = seedPage ?? normalizePage(await fetchPage(1), 1);
  if (validPageNumber(first?.page) !== 1) throw incompleteSnapshotError();
  const expectedTotalPages = validPageNumber(first?.totalPages);
  const pages = [first];

  for (let page = 2; page <= expectedTotalPages; page += 1) {
    const normalized = normalizePage(await fetchPage(page), page);
    if (
      validPageNumber(normalized?.page) !== page ||
      validPageNumber(normalized?.totalPages) !== expectedTotalPages ||
      !Array.isArray(normalized?.players) ||
      normalized.players.length === 0
    ) {
      throw incompleteSnapshotError();
    }
    pages.push(normalized);
  }

  const byProfileId = new Map();
  for (const normalized of pages) {
    for (const player of Array.isArray(normalized?.players) ? normalized.players : []) {
      const profileId = String(player?.profileId ?? "").trim();
      if (!profileId) continue;
      // A repeated profile across source pages means the boundaries moved
      // during the walk. Reject the whole walk instead of treating an omitted
      // friend as a completed OFFLINE state.
      if (byProfileId.has(profileId)) throw incompleteSnapshotError();
      byProfileId.set(profileId, player);
    }
  }
  return { pages, friends: [...byProfileId.values()] };
}

module.exports = { fetchCompleteFriendSnapshot };
