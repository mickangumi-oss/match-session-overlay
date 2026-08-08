"use strict";

const DISPLAY_ITEM_KEYS = [
  "record",
  "winRate",
  "currentRating",
  "ratingDelta",
  "potentialRating",
  "sessionPeak",
  "mrRank",
  "graph",
];

const METRIC_ITEM_KEYS = DISPLAY_ITEM_KEYS.filter((key) => key !== "graph");

function defaultDisplayItems() {
  return Object.fromEntries(DISPLAY_ITEM_KEYS.map((key) => [key, true]));
}

function hasVisibleDisplayItem(items) {
  return DISPLAY_ITEM_KEYS.some((key) => items?.[key] === true);
}

function sanitizeDisplayItems(value, { legacyGraphVisible } = {}) {
  const result = defaultDisplayItems();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of DISPLAY_ITEM_KEYS) {
      if (typeof value[key] === "boolean") result[key] = value[key];
    }
  } else if (typeof legacyGraphVisible === "boolean") {
    result.graph = legacyGraphVisible;
  }
  if (!hasVisibleDisplayItem(result)) result.record = true;
  return result;
}

function applyDisplayItemUpdate(current, update) {
  const result = sanitizeDisplayItems(current);
  if (update && typeof update === "object" && !Array.isArray(update)) {
    for (const key of DISPLAY_ITEM_KEYS) {
      if (typeof update[key] === "boolean") result[key] = update[key];
    }
  }
  if (!hasVisibleDisplayItem(result)) {
    const error = new Error("DISPLAY_ITEM_REQUIRED");
    error.code = "DISPLAY_ITEM_REQUIRED";
    throw error;
  }
  return result;
}

function displayItemsEqual(left, right) {
  return DISPLAY_ITEM_KEYS.every(
    (key) => Boolean(left?.[key]) === Boolean(right?.[key]),
  );
}

function visibleMetricCount(items) {
  return METRIC_ITEM_KEYS.filter((key) => items?.[key] === true).length;
}

module.exports = {
  DISPLAY_ITEM_KEYS,
  METRIC_ITEM_KEYS,
  applyDisplayItemUpdate,
  defaultDisplayItems,
  displayItemsEqual,
  hasVisibleDisplayItem,
  sanitizeDisplayItems,
  visibleMetricCount,
};
