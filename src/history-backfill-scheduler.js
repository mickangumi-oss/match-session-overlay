"use strict";

function scheduleHistoryBackfill({ backfill, isCurrent, publish }) {
  return Promise.resolve()
    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
    .then(backfill)
    .then(() => {
      if (isCurrent()) publish();
    })
    .catch(() => {
      // Optional enrichment must never remove the already-published history.
    });
}

module.exports = { scheduleHistoryBackfill };
