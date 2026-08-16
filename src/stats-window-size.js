"use strict";

function horizontalMetricMinimumWidth(metricCount, {
  cardWidth = 104,
  gap = 4,
  padding = 12,
  maximumWidth = 520,
} = {}) {
  const count = Math.max(0, Math.trunc(Number(metricCount) || 0));
  if (count === 0) return 0;
  return Math.min(
    maximumWidth,
    count * cardWidth + Math.max(0, count - 1) * gap + padding,
  );
}

function statsWindowSizeConstraints(preset, currentBounds = null) {
  const constraints = {
    minWidth: preset.minWidth,
    minHeight: preset.minHeight,
    maxWidth: preset.maxWidth,
    maxHeight: preset.maxHeight,
  };

  if (!currentBounds) return constraints;

  return {
    minWidth: Math.min(constraints.minWidth, currentBounds.width),
    minHeight: Math.min(constraints.minHeight, currentBounds.height),
    maxWidth: Math.max(constraints.maxWidth, currentBounds.width),
    maxHeight: Math.max(constraints.maxHeight, currentBounds.height),
  };
}

function compactStatsWindowInitialSize(preset, scale = 0.9) {
  return {
    width: Math.max(preset.minWidth, Math.round(preset.width * scale)),
    height: Math.max(preset.minHeight, Math.round(preset.height * scale)),
  };
}

function resizeBoundsForGraphVisibility(currentBounds, previousPreset, nextPreset) {
  const graphWasRemoved = nextPreset.height < previousPreset.height;
  return {
    ...currentBounds,
    height: Math.min(
      nextPreset.maxHeight,
      Math.max(
        nextPreset.minHeight,
        graphWasRemoved
          ? nextPreset.height
          : currentBounds.height + nextPreset.height - previousPreset.height,
      ),
    ),
  };
}

function expandBoundsToMinimumHeight(currentBounds, preset) {
  if (!currentBounds || !preset) return currentBounds;
  return {
    ...currentBounds,
    height: Math.min(
      preset.maxHeight,
      Math.max(currentBounds.height, preset.minHeight),
    ),
  };
}

module.exports = {
  compactStatsWindowInitialSize,
  expandBoundsToMinimumHeight,
  horizontalMetricMinimumWidth,
  resizeBoundsForGraphVisibility,
  statsWindowSizeConstraints,
};
