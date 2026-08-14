"use strict";

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
  return {
    ...currentBounds,
    height: Math.min(
      nextPreset.maxHeight,
      Math.max(
        nextPreset.minHeight,
        currentBounds.height + nextPreset.height - previousPreset.height,
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
  resizeBoundsForGraphVisibility,
  statsWindowSizeConstraints,
};
