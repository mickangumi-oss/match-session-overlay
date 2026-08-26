"use strict";

async function fetchHistoryPagesConcurrently(
  fetchPage,
  {
    maxPages = 10,
    pageSize = 10,
    concurrency = maxPages,
    onPage = null,
  } = {},
) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage must be a function.");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new TypeError("maxPages must be a positive integer.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError("pageSize must be a positive integer.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("concurrency must be a positive integer.");
  }
  if (onPage != null && typeof onPage !== "function") {
    throw new TypeError("onPage must be a function when provided.");
  }

  const results = [];
  let nextPage = 1;
  let completedPages = 0;

  const fetchAndPublish = async (page) => {
    const result = await fetchPage(page);
    results.push({ page, result });
    completedPages += 1;
    if (onPage) {
      await onPage({
        ...result,
        page,
        completedPages,
        totalPages: maxPages,
        replays: Array.isArray(result?.replays) ? [...result.replays] : [],
      });
    }
    return result;
  };

  const worker = async () => {
    while (true) {
      const page = nextPage++;
      if (page > maxPages) return;
      await fetchAndPublish(page);
    }
  };
  const workerCount = Math.min(concurrency, maxPages);
  const settled = await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker()),
  );
  const failure = settled.find((entry) => entry.status === "rejected");
  if (failure) throw failure.reason;

  return results
    .sort((left, right) => left.page - right.page)
    .flatMap(({ result }) =>
      Array.isArray(result?.replays) ? result.replays : [],
    );
}

module.exports = { fetchHistoryPagesConcurrently };
