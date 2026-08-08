(function exposeHistoryChartModel(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  function dateOrdinal(dateKey) {
    const match = DATE_KEY_PATTERN.exec(String(dateKey ?? ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return Math.trunc(timestamp / DAY_MS);
  }

  function dateKeyFromOrdinal(ordinal) {
    const date = new Date(Number(ordinal) * DAY_MS);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function localTodayKey(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function buildSevenDayResultChart(
    records,
    { endDateKey = "", todayKey = localTodayKey() } = {},
  ) {
    const normalized = (Array.isArray(records) ? records : [])
      .map((record) => ({
        dateKey: String(record?.dateKey ?? ""),
        ordinal: dateOrdinal(record?.dateKey),
        result: String(record?.result ?? ""),
      }))
      .filter((record) => record.ordinal != null);
    const explicitEnd = dateOrdinal(endDateKey);
    const latestRecordOrdinal = normalized.length
      ? Math.max(...normalized.map((record) => record.ordinal))
      : null;
    const fallbackEnd = dateOrdinal(todayKey);
    const endOrdinal = explicitEnd ?? latestRecordOrdinal ?? fallbackEnd;
    if (endOrdinal == null) {
      return { slotCount: 7, startDateKey: "", endDateKey: "", buckets: [] };
    }
    const startOrdinal = endOrdinal - 6;
    const grouped = new Map();
    for (const record of normalized) {
      if (record.ordinal < startOrdinal || record.ordinal > endOrdinal) continue;
      const bucket = grouped.get(record.ordinal) ?? {
        dateKey: dateKeyFromOrdinal(record.ordinal),
        dayIndex: record.ordinal - startOrdinal,
        win: 0,
        loss: 0,
        draw: 0,
      };
      if (record.result === "win") bucket.win += 1;
      else if (record.result === "loss") bucket.loss += 1;
      else bucket.draw += 1;
      grouped.set(record.ordinal, bucket);
    }
    const buckets = [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, bucket]) => ({
        ...bucket,
        total: bucket.win + bucket.loss + bucket.draw,
      }));
    return {
      slotCount: 7,
      startDateKey: dateKeyFromOrdinal(startOrdinal),
      endDateKey: dateKeyFromOrdinal(endOrdinal),
      buckets,
    };
  }

  const api = {
    buildSevenDayResultChart,
    dateKeyFromOrdinal,
    dateOrdinal,
    localTodayKey,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.matchHistoryChartModel = api;
})(typeof window !== "undefined" ? window : globalThis);
