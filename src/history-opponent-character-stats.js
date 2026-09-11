(function exposeHistoryOpponentCharacterStats(globalScope) {
  "use strict";

  const JAPANESE_SOURCE_LABEL = /[\u3040-\u30ff\u3400-\u9fff]/u;

  function recordTimestamp(record) {
    const timestamps = [record?.playedAt, record?.uploadedAt]
      .map(Number)
      .filter(Number.isFinite);
    return timestamps.length ? Math.max(...timestamps) : Number.NEGATIVE_INFINITY;
  }

  function knownActRecord(record) {
    const actId = Number(record?.actId);
    if (!Number.isInteger(actId) || actId < 0 || record?.actIdKnown === false) return false;
    return actId > 0 || record?.actIdKnown === true;
  }

  function filterHistoryRecords(records, filters = {}, dateKeyForRecord = () => "") {
    const from = String(filters.from ?? "");
    const to = String(filters.to ?? "");
    const mode = String(filters.mode ?? "all");
    const character = String(filters.character ?? "all");
    const act = String(filters.act ?? "all");
    const includeUnknownAct = filters.includeUnknownAct === true;
    const inputType = String(filters.inputType ?? "all");
    return (Array.isArray(records) ? records : []).filter((record) => {
      const date = String(dateKeyForRecord(record) ?? "");
      const actMatches = act === "all" ||
        (knownActRecord(record) && String(record.actId) === act) ||
        (includeUnknownAct && !knownActRecord(record));
      return (!from || date >= from) &&
        (!to || date <= to) &&
        (mode === "all" || record?.matchType === mode) &&
        actMatches &&
        (inputType === "all" || record?.opponentBattleInputType === inputType) &&
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

  function buildOpponentCharacterStats(records, options = {}) {
    const locale = String(options.locale ?? "").trim();
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

      const localizedLabel = locale
        ? record?.characterNamesByLocale?.[locale]?.opponent
        : "";
      const hasLocaleSnapshot = Boolean(
        record?.characterNamesByLocale &&
        typeof record.characterNamesByLocale === "object" &&
        !Array.isArray(record.characterNamesByLocale),
      );
      const candidateLabel = String(
        localizedLabel ?? (hasLocaleSnapshot ? "" : record?.opponentCharacterName ?? ""),
      ).trim();
      // A non-Japanese locale must not render a retained Japanese source
      // label while its selected-locale snapshot is missing. Leave the label
      // empty so the shared ID resolver can provide a verified mapping or an
      // explicit unknown marker instead.
      const label = locale && locale !== "ja-jp" && JAPANESE_SOURCE_LABEL.test(candidateLabel)
        ? ""
        : candidateLabel;
      const timestamp = recordTimestamp(record);
      if (label && timestamp >= entry.labelTimestamp) {
        entry.label = label;
        entry.labelTimestamp = timestamp;
      }
      statsByCharacterId.set(characterId, entry);
    }

    return sortOpponentCharacterStats([...statsByCharacterId.values()]
      .map((entry) => {
        const publicEntry = { ...entry };
        delete publicEntry.labelTimestamp;
        return {
          ...publicEntry,
          winRate:
            entry.wins + entry.losses > 0
              ? (entry.wins / (entry.wins + entry.losses)) * 100
              : 0,
        };
      }));
  }

  const api = {
    buildOpponentCharacterStats,
    filterHistoryRecords,
    sortOpponentCharacterStats,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.matchHistoryOpponentCharacterStats = api;
})(typeof window !== "undefined" ? window : globalThis);
