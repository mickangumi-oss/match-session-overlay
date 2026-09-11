"use strict";

const DEFAULT_HISTORY_ACT_KEYS = Object.freeze([
  "replay_season_id",
  "replay_season",
  "season_id",
  "seasonId",
  "act_id",
  "actId",
]);

function normalizeExplicitHistoryActId(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function readHistoryActProvenance(value, keys = DEFAULT_HISTORY_ACT_KEYS) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const candidates = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const actId = normalizeExplicitHistoryActId(source[key]);
    if (actId != null) candidates.push({ key, actId });
  }
  const distinct = [...new Set(candidates.map((candidate) => candidate.actId))];
  if (distinct.length !== 1) {
    return { actId: null, actIdKnown: false, actIdSource: null };
  }
  return {
    actId: distinct[0],
    actIdKnown: true,
    actIdSource: candidates[0].key,
  };
}

function normalizeStoredHistoryAct(value) {
  const actId = normalizeExplicitHistoryActId(value?.actId);
  // Positive Act values written before provenance was introduced are safe to
  // retain. A legacy Act 0 is ambiguous and must be treated as unknown until
  // a fresh payload proves that it was an explicit historical Act 0.
  const legacyPositiveAct = value?.actIdKnown == null && actId != null && actId > 0;
  const actIdKnown = value?.actIdKnown === true || legacyPositiveAct;
  return actIdKnown && actId != null
    ? { actId, actIdKnown: true }
    : { actId: null, actIdKnown: false };
}

function mergeHistoryActProvenance(previous, incoming) {
  const next = normalizeStoredHistoryAct(incoming);
  if (next.actIdKnown) return next;
  const prior = normalizeStoredHistoryAct(previous);
  if (prior.actIdKnown) return prior;
  return { actId: null, actIdKnown: false };
}

function isKnownHistoryActRecord(record) {
  const actId = normalizeExplicitHistoryActId(record?.actId);
  if (actId == null || record?.actIdKnown === false) return false;
  return actId > 0 || record?.actIdKnown === true;
}

module.exports = {
  DEFAULT_HISTORY_ACT_KEYS,
  isKnownHistoryActRecord,
  mergeHistoryActProvenance,
  normalizeExplicitHistoryActId,
  normalizeStoredHistoryAct,
  readHistoryActProvenance,
};
