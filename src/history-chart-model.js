(function exposeHistoryChartModel(globalScope) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isFiniteSeriesValue(value) {
    return value != null && value !== "" && Number.isFinite(Number(value));
  }

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

  function niceStepAtLeast(value, minimum = 1) {
    const target = Math.max(Number(minimum) || 1, Number(value) || 1);
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const fraction = target / magnitude;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return Math.max(minimum, niceFraction * magnitude);
  }

  function buildHistoryRatingAxis(values, ratingType, { maxIntervals = 3 } = {}) {
    const normalized = (Array.isArray(values) ? values : [])
      .map(Number)
      .filter(Number.isFinite);
    if (!normalized.length) return null;
    const rawMin = Math.min(...normalized);
    const rawMax = Math.max(...normalized);
    const range = Math.max(1, rawMax - rawMin);
    if (String(ratingType).toUpperCase() !== "LP") {
      const minimum = Math.max(0, rawMin - Math.ceil(range * 0.12));
      const maximum = rawMax + Math.ceil(range * 0.12) || minimum + 1;
      return {
        minimum,
        maximum,
        ticks: [maximum, minimum + (maximum - minimum) / 2, minimum],
      };
    }

    const intervalLimit = Math.max(1, Math.trunc(Number(maxIntervals) || 3));
    const step = niceStepAtLeast(range / intervalLimit, 1000);
    const minimum = Math.max(0, Math.floor(rawMin / step) * step);
    const maximum = Math.max(minimum + step, Math.ceil(rawMax / step) * step);
    const intervalCount = Math.max(1, Math.round((maximum - minimum) / step));
    return {
      minimum,
      maximum,
      step,
      ticks: Array.from(
        { length: intervalCount + 1 },
        (_, index) => maximum - index * step,
      ),
    };
  }

  function buildSevenDayResultChart(
    records,
    _options = {},
  ) {
    const normalized = (Array.isArray(records) ? records : [])
      .map((record) => ({
        dateKey: String(record?.dateKey ?? ""),
        ordinal: dateOrdinal(record?.dateKey),
        result: String(record?.result ?? ""),
      }))
      .filter((record) => record.ordinal != null);
    const grouped = new Map();
    for (const record of normalized) {
      const bucket = grouped.get(record.ordinal) ?? {
        dateKey: dateKeyFromOrdinal(record.ordinal),
        win: 0,
        loss: 0,
        draw: 0,
      };
      if (record.result === "win") bucket.win += 1;
      else if (record.result === "loss") bucket.loss += 1;
      else bucket.draw += 1;
      grouped.set(record.ordinal, bucket);
    }
    const selectedOrdinals = [...grouped.keys()]
      .sort((left, right) => right - left)
      .slice(0, 7)
      .sort((left, right) => left - right);
    const buckets = selectedOrdinals.map((ordinal, dayIndex) => {
      const bucket = grouped.get(ordinal);
      return {
        ...bucket,
        dayIndex,
        total: bucket.win + bucket.loss + bucket.draw,
      };
    });
    return {
      slotCount: buckets.length,
      startDateKey: buckets[0]?.dateKey || "",
      endDateKey: buckets.at(-1)?.dateKey || "",
      buckets,
    };
  }

  function historyDateEntry(record, dateKeyForRecord = (value) => value?.dateKey) {
    const dateKey = String(dateKeyForRecord(record) ?? "");
    const ordinal = dateOrdinal(dateKey);
    return ordinal == null ? null : { record, dateKey, ordinal };
  }

  function buildHistoryRatingPeriod(
    records,
    { mode = "all", weekOffset = 0, todayKey = localTodayKey() } = {},
  ) {
    const normalizedMode = ["all", "week", "recent"].includes(mode) ? mode : "all";
    const entries = (Array.isArray(records) ? records : [])
      .map((record) => historyDateEntry(record))
      .filter(Boolean);
    const ordinals = entries.map((entry) => entry.ordinal);
    if (normalizedMode === "all") {
      const first = ordinals.length ? Math.min(...ordinals) : null;
      const last = ordinals.length ? Math.max(...ordinals) : null;
      return {
        mode: normalizedMode,
        weekOffset: 0,
        startDateKey: first == null ? "" : dateKeyFromOrdinal(first),
        endDateKey: last == null ? "" : dateKeyFromOrdinal(last),
      };
    }

    const referenceOrdinal = dateOrdinal(todayKey) ?? (ordinals.length ? Math.max(...ordinals) : null);
    if (referenceOrdinal == null) {
      return { mode: normalizedMode, weekOffset: 0, startDateKey: "", endDateKey: "" };
    }
    if (normalizedMode === "recent") {
      return {
        mode: normalizedMode,
        weekOffset: 0,
        startDateKey: dateKeyFromOrdinal(referenceOrdinal - 6),
        endDateKey: dateKeyFromOrdinal(referenceOrdinal),
      };
    }

    const safeWeekOffset = Math.trunc(Number(weekOffset) || 0);
    const dayOfWeek = new Date(referenceOrdinal * DAY_MS).getUTCDay();
    const currentWeekStart = referenceOrdinal - ((dayOfWeek + 6) % 7);
    const startOrdinal = currentWeekStart + safeWeekOffset * 7;
    return {
      mode: normalizedMode,
      weekOffset: safeWeekOffset,
      startDateKey: dateKeyFromOrdinal(startOrdinal),
      endDateKey: dateKeyFromOrdinal(startOrdinal + 6),
    };
  }

  function filterHistoryRatingRecords(
    records,
    period,
    dateKeyForRecord = (value) => value?.dateKey,
  ) {
    const entries = (Array.isArray(records) ? records : [])
      .map((record) => historyDateEntry(record, dateKeyForRecord))
      .filter(Boolean);
    if (!period?.startDateKey || !period?.endDateKey) return [];
    const startOrdinal = dateOrdinal(period.startDateKey);
    const endOrdinal = dateOrdinal(period.endDateKey);
    if (startOrdinal == null || endOrdinal == null) return [];
    return entries
      .filter((entry) => entry.ordinal >= startOrdinal && entry.ordinal <= endOrdinal)
      .map((entry) => entry.record);
  }

  function historyTimestamp(record, timestampForRecord) {
    const raw = timestampForRecord
      ? timestampForRecord(record)
      : record?.playedAt ?? record?.uploadedAt;
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp)) return 0;
    return Math.abs(timestamp) < 10_000_000_000 ? timestamp * 1000 : timestamp;
  }

  function buildHistoryRatingSeries(
    records,
    {
      period,
      dateMode = "played",
      valueForRecord = (record) => record?.value,
      dateKeyForRecord = (record) => record?.dateKey,
      timestampForRecord,
    } = {},
  ) {
    const normalizedPeriod = period?.startDateKey && period?.endDateKey
      ? period
      : buildHistoryRatingPeriod(records, period ?? {});
    const startOrdinal = dateOrdinal(normalizedPeriod.startDateKey);
    const endOrdinal = dateOrdinal(normalizedPeriod.endDateKey);
    if (startOrdinal == null || endOrdinal == null || endOrdinal < startOrdinal) return [];

    const entries = (Array.isArray(records) ? records : [])
      .map((record, index) => {
        const entry = historyDateEntry(record, dateKeyForRecord);
        if (!entry) return null;
        const rawValue = valueForRecord(record);
        const value = rawValue == null || rawValue === "" ? null : Number(rawValue);
        return {
          ...entry,
          index,
          timestamp: historyTimestamp(record, timestampForRecord),
          value: Number.isFinite(value) ? value : null,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);

    const dailyValues = new Map();
    for (const entry of entries) {
      if (!Number.isFinite(entry.value)) continue;
      const previous = dailyValues.get(entry.ordinal);
      if (!previous || entry.timestamp >= previous.timestamp) {
        dailyValues.set(entry.ordinal, {
          dateKey: entry.dateKey,
          ordinal: entry.ordinal,
          timestamp: entry.timestamp,
          value: entry.value,
        });
      }
    }

    if (dateMode !== "all") {
      return [...dailyValues.values()]
        .filter((entry) => entry.ordinal >= startOrdinal && entry.ordinal <= endOrdinal)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((entry, position) => ({
          dateKey: entry.dateKey,
          ordinal: entry.ordinal,
          position,
          value: entry.value,
        }));
    }

    let carriedValue = null;
    for (const entry of [...dailyValues.values()].sort((left, right) => left.ordinal - right.ordinal)) {
      if (entry.ordinal < startOrdinal) carriedValue = entry.value;
    }
    const points = [];
    for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
      const entry = dailyValues.get(ordinal);
      if (entry) carriedValue = entry.value;
      points.push({
        dateKey: dateKeyFromOrdinal(ordinal),
        ordinal,
        position: ordinal - startOrdinal,
        value: Number.isFinite(carriedValue) ? carriedValue : null,
      });
    }
    return points;
  }

  function thinHistoryPoints(points, maxPoints) {
    const source = Array.isArray(points) ? points : [];
    const limit = Math.max(2, Math.trunc(Number(maxPoints) || 2));
    if (source.length <= limit) return source.slice();
    const keep = new Set([0, source.length - 1]);
    const firstFinite = source.findIndex((point) => isFiniteSeriesValue(point?.value));
    const lastFinite = source.findLastIndex((point) => isFiniteSeriesValue(point?.value));
    if (firstFinite >= 0) keep.add(firstFinite);
    if (lastFinite >= 0) keep.add(lastFinite);
    const scored = source.slice(1, -1).map((point, index) => {
      const sourceIndex = index + 1;
      const previous = source[sourceIndex - 1]?.value;
      const current = point?.value;
      const next = source[sourceIndex + 1]?.value;
      const previousDelta = isFiniteSeriesValue(previous) && isFiniteSeriesValue(current)
        ? Math.abs(current - previous)
        : 0;
      const nextDelta = isFiniteSeriesValue(current) && isFiniteSeriesValue(next)
        ? Math.abs(next - current)
        : 0;
      return {
        sourceIndex,
        score: previousDelta + nextDelta,
      };
    }).sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex);
    for (const item of scored) {
      if (keep.size >= limit) break;
      keep.add(item.sourceIndex);
    }
    return [...keep].sort((left, right) => left - right).map((index) => source[index]);
  }

  const api = {
    buildHistoryRatingAxis,
    buildHistoryRatingPeriod,
    buildHistoryRatingSeries,
    buildSevenDayResultChart,
    dateKeyFromOrdinal,
    dateOrdinal,
    filterHistoryRatingRecords,
    localTodayKey,
    thinHistoryPoints,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.matchHistoryChartModel = api;
})(typeof window !== "undefined" ? window : globalThis);
