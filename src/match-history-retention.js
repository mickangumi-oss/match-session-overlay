"use strict";

const OWN_MATCH_HISTORY_LIMIT = 5000;
const OTHER_MATCH_HISTORY_LIMIT = 100;

function normalizedProfileId(value) {
  const normalized = String(value ?? "").replace(/\s/g, "");
  return /^\d{4,12}$/.test(normalized) ? normalized : null;
}

function matchHistoryRetentionLimit({ profileId, ownProfileId, viewedProfileId } = {}) {
  const targetId = normalizedProfileId(profileId);
  const ownId = normalizedProfileId(ownProfileId);
  const viewedId = normalizedProfileId(viewedProfileId);
  if (targetId && ownId && targetId === ownId) return OWN_MATCH_HISTORY_LIMIT;
  if (targetId && viewedId && targetId === viewedId) return OTHER_MATCH_HISTORY_LIMIT;
  // Do not destructively trim a store before the authenticated player is known.
  return OWN_MATCH_HISTORY_LIMIT;
}

function retainNewestMatchHistory(records, limit) {
  const safeLimit = Number.isInteger(limit) && limit > 0
    ? limit
    : OWN_MATCH_HISTORY_LIMIT;
  return [...(Array.isArray(records) ? records : [])]
    .sort((a, b) => Number(b?.uploadedAt ?? 0) - Number(a?.uploadedAt ?? 0))
    .slice(0, safeLimit);
}

module.exports = {
  OTHER_MATCH_HISTORY_LIMIT,
  OWN_MATCH_HISTORY_LIMIT,
  matchHistoryRetentionLimit,
  retainNewestMatchHistory,
};
