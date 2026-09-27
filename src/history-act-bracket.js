"use strict";

const { isKnownHistoryActRecord } = require("./history-act-provenance");

async function bracketNewHistoryRows({ replays, previousReplayIds, previousVerification,
  verifyCurrentAct }) {
  const newIds = new Set(replays.filter((row) => row?.replayId &&
    !previousReplayIds.has(row.replayId)).map((row) => row.replayId));
  if (!newIds.size) return replays;
  let current = null;
  try { current = await verifyCurrentAct(); } catch { return replays; }
  const prior = previousVerification;
  const priorAt = Number(prior?.verifiedAt);
  const currentAt = Number(current?.verifiedAt);
  if (!Number.isInteger(prior?.actId) || prior.actId <= 0 ||
    current?.actId !== prior.actId || !Number.isFinite(priorAt) || priorAt <= 0 ||
    !Number.isFinite(currentAt) || currentAt < priorAt ||
    !prior.profileId || !prior.locale || !Number.isInteger(prior.generation) ||
    !Number.isInteger(prior.scopeToken) ||
    prior.profileId !== current.profileId || prior.locale !== current.locale ||
    prior.generation !== current.generation || prior.scopeToken !== current.scopeToken) return replays;
  return replays.map((row) => {
    const playedAt = Number(row?.playedAt ?? row?.uploadedAt);
    return newIds.has(row.replayId) && !isKnownHistoryActRecord(row) &&
      Number.isFinite(playedAt) && playedAt >= priorAt && playedAt <= currentAt
    ? { ...row, actId: current.actId, actIdKnown: true,
      actIdSource: "current-act-bracketed" } : row;
  });
}

module.exports = { bracketNewHistoryRows };
