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

function potentialRatingValue(values, ratingType) {
  return ratingType === "LP" ? robustLpEstimate(values) : robustMrEstimate(values);
}

return {
  LP_STEP_LIMIT,
  MR_SMOOTHING_FACTOR,
  MR_STEP_LIMIT,
  medianValue,
  potentialRatingValue,
  robustLpEstimate,
  robustMrEstimate,
  robustRatingEstimate,
};
});
