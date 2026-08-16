"use strict";

(function initDisplayNumberFormat(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.matchDisplayNumberFormat = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function finiteNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function integer(value, fallback = "—") {
    const number = finiteNumber(value);
    return number == null ? fallback : String(Math.round(number));
  }

  function positiveInteger(value, fallback = "—") {
    const number = finiteNumber(value);
    return number != null && number > 0 ? String(Math.round(number)) : fallback;
  }

  function rating(value, ratingType, fallback = "—") {
    const formatted = positiveInteger(value, "");
    return formatted
      ? `${formatted} ${ratingType === "LP" ? "LP" : "MR"}`
      : fallback;
  }

  function rankDelta(value, fallback = "") {
    const number = finiteNumber(value);
    if (number == null) return fallback;
    const rounded = Math.trunc(number);
    const marker = rounded > 0 ? "↑" : rounded < 0 ? "↓" : "±";
    return `${marker}${Math.abs(rounded)}`;
  }

  function rankLine(rank, delta, fallback = "—") {
    const formattedRank = positiveInteger(rank, "");
    if (!formattedRank) return fallback;
    return `${formattedRank}${rankDelta(delta, "")}`;
  }

  return Object.freeze({ finiteNumber, integer, positiveInteger, rating, rankDelta, rankLine });
});
