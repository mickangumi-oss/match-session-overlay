(function exposePotentialRating(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MatchPotentialRating = api;
})(typeof globalThis === "object" ? globalThis : this, function createPotentialRating() {
"use strict";

const MR_SMOOTHING_FACTOR = 0.6;
const MR_STEP_LIMIT = 20;
const LP_STEP_LIMIT = 100;
const INITIAL_SAMPLE_LIMIT = 5;
const POTENTIAL_MR_MATCH_LIMIT = 100;
const POTENTIAL_MR_MIN_SAMPLES = 2;
const POTENTIAL_MR_SEARCH_PADDING = 600;

function finiteValues(values) {
  return (Array.isArray(values) ? values : [])
    .filter(
      (value) =>
        typeof value === "number" ||
        (typeof value === "string" && value.trim() !== ""),
    )
    .map((value) => Number(value))
    .filter(Number.isFinite);
}

function medianValue(values) {
  const sorted = finiteValues(values).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(median);
}

function robustRatingEstimate(values, stepLimit) {
  const samples = finiteValues(values);
  if (samples.length < 2) return null;

  const initialCount = Math.min(INITIAL_SAMPLE_LIMIT, samples.length);
  let estimate = medianValue(samples.slice(0, initialCount));
  for (const rating of samples.slice(initialCount)) {
    const difference = Math.max(
      -stepLimit,
      Math.min(stepLimit, rating - estimate),
    );
    estimate += difference * MR_SMOOTHING_FACTOR;
  }
  return Math.round(estimate);
}

function robustMrEstimate(values) {
  return robustRatingEstimate(values, MR_STEP_LIMIT);
}

function robustLpEstimate(values) {
  return robustRatingEstimate(values, LP_STEP_LIMIT);
}

function expectedMrWinProbability(potentialMr, opponentMr) {
  const rating = Number(potentialMr);
  const opponent = Number(opponentMr);
  if (!Number.isFinite(rating) || !Number.isFinite(opponent)) return null;
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

function recordTimestamp(record) {
  const value = Number(record?.playedAt ?? record?.uploadedAt);
  return Number.isFinite(value) ? value : 0;
}

function potentialMrMatchWindow(
  records,
  { characterId = null, limit = POTENTIAL_MR_MATCH_LIMIT, actId = null } = {},
) {
  const requestedLimit = Number(limit);
  const matchLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(POTENTIAL_MR_MATCH_LIMIT, Math.floor(requestedLimit)))
    : POTENTIAL_MR_MATCH_LIMIT;
  const targetCharacterId = Number(characterId);
  const hasCharacterFilter = Number.isFinite(targetCharacterId) && targetCharacterId > 0;
  const hasActFilter = actId != null;
  const targetActId = Number(actId);
  const hasValidActFilter = Number.isInteger(targetActId) && targetActId >= 0;
  const window = (Array.isArray(records) ? records : [])
    .filter((record) => record?.matchType === "ranked")
    .filter((record) => !hasCharacterFilter || Number(record?.characterId) === targetCharacterId)
    .filter((record) => record?.result === "win" || record?.result === "loss")
    .filter((record) => {
      if (!hasActFilter) return true;
      if (!hasValidActFilter) return false;
      const recordActId = Number(record?.actId);
      const known = Number.isInteger(recordActId) && recordActId >= 0 &&
        (recordActId > 0 || record?.actIdKnown === true) && record?.actIdKnown !== false;
      return known && recordActId === targetActId;
    })
    .sort((left, right) => recordTimestamp(left) - recordTimestamp(right))
    .slice(-matchLimit);
  return window.filter((record) => {
    const opponentMr = Number(record?.opponentMr);
    return (
      (record?.result === "win" || record?.result === "loss") &&
      Number.isFinite(opponentMr) &&
      opponentMr > 0
    );
  });
}

function estimatePotentialMrFromMatches(records, options = {}) {
  const matches = potentialMrMatchWindow(records, options);
  const wins = matches.filter((record) => record.result === "win").length;
  const losses = matches.length - wins;
  const result = {
    value: null,
    sampleCount: matches.length,
    wins,
    losses,
    bound: null,
  };
  if (matches.length < POTENTIAL_MR_MIN_SAMPLES) return result;

  const opponentRatings = matches.map((record) => Number(record.opponentMr));
  const minimumOpponentMr = Math.min(...opponentRatings);
  const maximumOpponentMr = Math.max(...opponentRatings);
  const low = Math.max(0, minimumOpponentMr - POTENTIAL_MR_SEARCH_PADDING);
  const high = maximumOpponentMr + POTENTIAL_MR_SEARCH_PADDING;
  if (wins === matches.length) {
    return { ...result, value: Math.round(high), bound: "above" };
  }
  if (wins === 0) {
    return { ...result, value: Math.round(low), bound: "below" };
  }

  let lower = low;
  let upper = high;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const expectedWins = matches.reduce(
      (total, record) => total + expectedMrWinProbability(midpoint, record.opponentMr),
      0,
    );
    if (expectedWins > wins) upper = midpoint;
    else lower = midpoint;
  }
  return { ...result, value: Math.round((lower + upper) / 2) };
}

function potentialRatingValue(values, ratingType) {
  return ratingType === "LP" ? robustLpEstimate(values) : robustMrEstimate(values);
}

return {
  LP_STEP_LIMIT,
  MR_SMOOTHING_FACTOR,
  MR_STEP_LIMIT,
  POTENTIAL_MR_MATCH_LIMIT,
  POTENTIAL_MR_MIN_SAMPLES,
  estimatePotentialMrFromMatches,
  expectedMrWinProbability,
  medianValue,
  potentialMrMatchWindow,
  potentialRatingValue,
  robustLpEstimate,
  robustMrEstimate,
  robustRatingEstimate,
};
});
