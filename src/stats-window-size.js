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

function mainWindowInitialHeight(workAreaHeight, {
  preferredHeight = 920,
  margin = 0,
} = {}) {
  const preferred = Number.isFinite(Number(preferredHeight))
    ? Math.max(1, Math.round(Number(preferredHeight)))
    : 920;
  const available = Number(workAreaHeight) - Number(margin);
  if (!Number.isFinite(available)) return preferred;
  return Math.max(1, Math.min(preferred, Math.floor(available)));
}

function clampBoundsToWorkArea(bounds, workArea, margin = 0) {
  if (!bounds || !workArea) return bounds;
  const width = Math.min(bounds.width, Math.max(1, workArea.width - margin * 2));
  const height = Math.min(bounds.height, Math.max(1, workArea.height - margin * 2));
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  const maxX = workArea.x + workArea.width - margin - width;
  const maxY = workArea.y + workArea.height - margin - height;
  return {
    ...bounds,
    x: Math.min(Math.max(Number.isFinite(bounds.x) ? bounds.x : minX, minX), maxX),
    y: Math.min(Math.max(Number.isFinite(bounds.y) ? bounds.y : minY, minY), maxY),
    width,
    height,
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

function resizeBoundsForDisplayItemCount(
  currentBounds,
  previousPreset,
  nextPreset,
  orientation,
  { itemCountDecreased = false } = {},
) {
  if (!currentBounds || !previousPreset || !nextPreset) return currentBounds;

  if (orientation === "vertical") {
    return {
      ...currentBounds,
      height: Math.min(
        nextPreset.maxHeight,
        Math.max(
          nextPreset.minHeight,
          itemCountDecreased
            ? nextPreset.height
            : Math.max(currentBounds.height, nextPreset.minHeight),
        ),
      ),
    };
  }

  return {
    ...currentBounds,
    width: Math.min(
      nextPreset.maxWidth,
      Math.max(
        nextPreset.minWidth,
        itemCountDecreased
          ? nextPreset.width
          : Math.max(currentBounds.width, nextPreset.minWidth),
      ),
    ),
  };
}

module.exports = {
  compactStatsWindowInitialSize,
  clampBoundsToWorkArea,
  expandBoundsToMinimumHeight,
  horizontalMetricMinimumWidth,
  mainWindowInitialHeight,
  resizeBoundsForDisplayItemCount,
  resizeBoundsForGraphVisibility,
  statsWindowSizeConstraints,
};
