(function exposeHistoryOpponentCharacterStats(globalScope) {
  "use strict";

  function recordTimestamp(record) {
    const timestamps = [record?.playedAt, record?.uploadedAt]
      .map(Number)
      .filter(Number.isFinite);
    return timestamps.length ? Math.max(...timestamps) : Number.NEGATIVE_INFINITY;
  }

  function filterHistoryRecords(records, filters = {}, dateKeyForRecord = () => "") {
    const from = String(filters.from ?? "");
    const to = String(filters.to ?? "");
    const mode = String(filters.mode ?? "all");
    const character = String(filters.character ?? "all");
    return (Array.isArray(records) ? records : []).filter((record) => {
      const date = String(dateKeyForRecord(record) ?? "");
      return (!from || date >= from) &&
        (!to || date <= to) &&
        (mode === "all" || record?.matchType === mode) &&
        (character === "all" || String(record?.characterId ?? "") === character);
    });
  }

  function sortOpponentCharacterStats(entries, options = {}) {
    const sortKey = options.key === "winRate" ? "winRate" : "matches";
    const direction = options.direction === "asc" ? 1 : -1;
    return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
      const matches = Number(left?.matches) - Number(right?.matches);
      const winRate = Number(left?.winRate) - Number(right?.winRate);
      if (sortKey === "winRate") {
        if (winRate) return winRate * direction;
        if (matches) return matches * -1;
      } else {
        if (matches) return matches * direction;
        if (winRate) return winRate * -1;
      }
      return String(left?.label ?? "").localeCompare(String(right?.label ?? ""));
    });
  }

  function buildOpponentCharacterStats(records) {
    const statsByCharacterId = new Map();

    for (const record of Array.isArray(records) ? records : []) {
      const characterId = Number(record?.opponentCharacterId);
      if (!Number.isFinite(characterId) || characterId <= 0) continue;

      const entry = statsByCharacterId.get(characterId) ?? {
        characterId,
        label: "",
        labelTimestamp: Number.NEGATIVE_INFINITY,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      entry.matches += 1;
      if (record?.result === "win") entry.wins += 1;
      else if (record?.result === "loss") entry.losses += 1;
      else entry.draws += 1;

      const label = String(record?.opponentCharacterName ?? "").trim();
      const timestamp = recordTimestamp(record);
      if (label && timestamp >= entry.labelTimestamp) {
        entry.label = label;
        entry.labelTimestamp = timestamp;
      }
      statsByCharacterId.set(characterId, entry);
    }

    return sortOpponentCharacterStats([...statsByCharacterId.values()]
      .map(({ labelTimestamp, ...entry }) => ({
        ...entry,
        winRate:
          entry.wins + entry.losses > 0
            ? (entry.wins / (entry.wins + entry.losses)) * 100
            : 0,
      })));
  }

  const api = {
    buildOpponentCharacterStats,
    filterHistoryRecords,
    sortOpponentCharacterStats,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.matchHistoryOpponentCharacterStats = api;
})(typeof window !== "undefined" ? window : globalThis);
