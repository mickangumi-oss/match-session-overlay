"use strict";

function filterHistoryBackfillReplays(records, replays) {
  const existingReplayIds = new Set(
    (Array.isArray(records) ? records : [])
      .map((record) => String(record?.replayId ?? ""))
      .filter(Boolean),
  );
  return (Array.isArray(replays) ? replays : []).filter((replay) =>
    existingReplayIds.has(String(replay?.replayId ?? "")),
  );
}

module.exports = { filterHistoryBackfillReplays };
