"use strict";

const sharedHistoryFlights = new Map();

async function fetchHistoryPagesConcurrently(
  fetchPage,
  {
    maxPages = 10,
    pageSize = 10,
    concurrency = maxPages,
    onPage = null,
    shareKey = null,
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
  if (shareKey != null) {
    return fetchSharedHistoryPages(fetchPage, {
      maxPages,
      pageSize,
      concurrency,
      onPage,
      shareKey: String(shareKey),
    });
  }

  return fetchHistoryPagesDirect(fetchPage, { maxPages, pageSize, concurrency, onPage });
}

async function fetchSharedHistoryPages(fetchPage, options) {
  const { shareKey, onPage } = options;
  let flight = sharedHistoryFlights.get(shareKey);
  if (!flight) {
    const subscribers = new Set();
    const events = [];
    flight = {
      events,
      subscribers,
      promise: null,
    };
    flight.promise = fetchHistoryPagesDirect(fetchPage, {
      ...options,
      onPage: async (event) => {
        events.push(event);
        await Promise.all(
          [...subscribers].map((subscriber) => subscriber.deliver(event)),
        );
      },
    }).finally(() => {
      if (sharedHistoryFlights.get(shareKey) === flight) {
        sharedHistoryFlights.delete(shareKey);
      }
    });
    sharedHistoryFlights.set(shareKey, flight);
  }

  const subscriber = createHistoryPageSubscriber(onPage);
  flight.subscribers.add(subscriber);
  for (const event of flight.events) await subscriber.deliver(event);
  try {
    const result = await flight.promise;
    await subscriber.complete();
    return result;
  } finally {
    flight.subscribers.delete(subscriber);
  }
}

function createHistoryPageSubscriber(onPage) {
  let failed = null;
  const seen = new Set();
  return {
    async deliver(event) {
      const page = Number(event?.page);
      if (seen.has(page)) return;
      seen.add(page);
      if (failed || !onPage) return;
      try {
        await onPage({ ...event, replays: [...(event.replays ?? [])] });
      } catch (error) {
        failed = error;
      }
    },
    async complete() {
      if (failed) throw failed;
    },
  };
}

async function fetchHistoryPagesDirect(
  fetchPage,
  {
    maxPages = 10,
    pageSize = 10,
    concurrency = maxPages,
    onPage = null,
  } = {},
) {

  const results = [];
  let nextPage = 1;
  let completedPages = 0;
  let discoveredTotalPages = null;
  let terminalPage = false;

  const fetchAndPublish = async (page) => {
    const result = await fetchPage(page);
    results.push({ page, result });
    completedPages += 1;
    if (onPage) {
      await onPage({
        ...result,
        page,
        completedPages,
        totalPages: discoveredTotalPages ?? maxPages,
        replays: Array.isArray(result?.replays) ? [...result.replays] : [],
      });
    }
    return result;
  };

  const observe = (result) => {
    const totalPages = Number(result?.totalPages);
    if (Number.isInteger(totalPages) && totalPages > 0) {
      discoveredTotalPages = discoveredTotalPages == null
        ? totalPages
        : Math.min(discoveredTotalPages, totalPages);
    }
    const rawCount = Number(result?.rawCount);
    terminalPage ||= rawCount === 0 || (rawCount > 0 && rawCount < pageSize);
  };

  // Bootstrap page 1 before starting any overlap. This avoids launching
  // pages that a short/empty first page or totalPages metadata would make
  // unnecessary.
  const first = await fetchAndPublish(1);
  nextPage = 2;
  observe(first);

  // Keep the same bounded request count and concurrency, but refill a slot as
  // soon as a page completes. Waiting for an entire batch to settle leaves
  // otherwise-idle request slots unused when one page is slower than the rest.
  const active = new Map();
  const schedule = () => {
    while (
      !terminalPage &&
      active.size < concurrency &&
      nextPage <= maxPages &&
      (discoveredTotalPages == null || nextPage <= discoveredTotalPages)
    ) {
      const page = nextPage++;
      active.set(
        page,
        fetchAndPublish(page).then((result) => {
          observe(result);
          return result;
        }),
      );
    }
  };

  schedule();
  while (active.size > 0) {
    const completed = await Promise.race(
      [...active.entries()].map(async ([page, request]) => {
        try {
          return { page, status: "fulfilled", value: await request };
        } catch (reason) {
          return { page, status: "rejected", reason };
        }
      }),
    );
    active.delete(completed.page);
    if (completed.status === "rejected") {
      await Promise.allSettled(active.values());
      throw completed.reason;
    }
    schedule();
  }

  return results
    .sort((left, right) => left.page - right.page)
    .flatMap(({ result }) =>
      Array.isArray(result?.replays) ? result.replays : [],
    );
}

module.exports = { fetchHistoryPagesConcurrently };
