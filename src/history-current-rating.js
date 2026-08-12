"use strict";

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function applyCurrentProfileRatings(records, player, { replayIds = [] } = {}) {
  if (!Array.isArray(records)) return false;
  const characterId = positiveNumber(player?.characterId);
  const currentMr = positiveNumber(player?.mr);
  const currentLp = positiveNumber(player?.lp);
  if (!characterId || (!currentMr && !currentLp)) return false;

  const replayIdSet = new Set(
    (Array.isArray(replayIds) ? replayIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const candidate = records
    .filter((record) => record?.matchType === "ranked")
    .filter((record) => Number(record?.characterId) === characterId)
    .filter((record) => !replayIdSet.size || replayIdSet.has(record?.replayId))
    .sort(
      (left, right) =>
        Number(right?.playedAt ?? right?.uploadedAt) -
        Number(left?.playedAt ?? left?.uploadedAt),
    )[0];
  if (!candidate) return false;

  let changed = false;
  if (currentMr && Number(candidate.ownMr) !== currentMr) {
    candidate.ownMr = currentMr;
    changed = true;
  }
  if (currentLp && Number(candidate.ownLp) !== currentLp) {
    candidate.ownLp = currentLp;
    changed = true;
  }
  return changed;
}

module.exports = { applyCurrentProfileRatings };
