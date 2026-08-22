"use strict";

const remoteOverlay = !window.matchOverlay;
const remoteStateListeners = [];
const remoteDisplaySettingsListeners = [];

async function fetchRemoteOverlayState() {
  const response = await fetch("/state", { cache: "no-store" });
  if (!response.ok) throw new Error(`REMOTE_STATE_${response.status}`);
  const payload = await response.json();
  const settings = {
    ...(payload.displaySettings ?? {}),
    overlaySize: payload.overlaySize,
    // The browser source is always the compact overlay presentation. The
    // markup and CSS are still the same document used by the Electron window.
    mode: "overlay",
    overlayInteractionLocked: true,
  };
  return { payload, settings };
}

const api = window.matchOverlay || {
  onState(callback) {
    remoteStateListeners.push(callback);
    return () => {
      const index = remoteStateListeners.indexOf(callback);
      if (index >= 0) remoteStateListeners.splice(index, 1);
    };
  },
  onDisplaySettings(callback) {
    remoteDisplaySettingsListeners.push(callback);
    return () => {
      const index = remoteDisplaySettingsListeners.indexOf(callback);
      if (index >= 0) remoteDisplaySettingsListeners.splice(index, 1);
    };
  },
  async getState() {
    const { payload } = await fetchRemoteOverlayState();
    return { ok: true, data: payload };
  },
  async getDisplaySettings() {
    const { settings } = await fetchRemoteOverlayState();
    return { ok: true, data: settings };
  },
  hideStatsWindow() {},
  resetTracking() {},
  beginStatsWindowDrag() {},
  moveStatsWindowDrag() {},
  endStatsWindowDrag() {},
  updateDisplaySettings() {},
};
const localeApi = window.matchOverlayI18n;
const displayNumber = window.matchDisplayNumberFormat;
const t = (key, fallback = key) =>
  localeApi?.t ? localeApi.t(key) : fallback;
const FONT_STACKS = {
  street: 'Impact, "Arial Black", "Bahnschrift Condensed", sans-serif',
  condensed: '"Bahnschrift Condensed", "Arial Narrow", sans-serif',
  system: '"Segoe UI Variable", "Segoe UI", sans-serif',
  japanese: '"Yu Gothic UI", Meiryo, sans-serif',
  mono: '"Cascadia Mono", Consolas, monospace',
};
const FONT_STYLES = new Set(["normal", "italic"]);
const METRIC_ITEM_KEYS = [
  "record",
  "winRate",
  "currentRating",
  "ratingDelta",
  "potentialRating",
  "sessionPeak",
  "mrRank",
];

function fontStackFor(value) {
  if (FONT_STACKS[value]) return FONT_STACKS[value];
  const family = String(value ?? "")
    .replace(/["\\]/g, "")
    .trim();
  return family ? `"${family}", sans-serif` : FONT_STACKS.street;
}
const elements = {
  root: document.getElementById("statsWindow"),
  winRate: document.getElementById("winRate"),
  recordWins: document.getElementById("recordWins"),
  recordLosses: document.getElementById("recordLosses"),
  recordValues: document.querySelector(".record-values"),
  ratingTypeLabel: document.getElementById("ratingTypeLabel"),
  ratingDelta: document.getElementById("ratingDelta"),
  currentRatingLabel: document.getElementById("currentRatingLabel"),
  currentRating: document.getElementById("currentRating"),
  sessionPeakRating: document.getElementById("sessionPeakRating"),
  mrRank: document.getElementById("mrRank"),
  mrRankDelta: document.getElementById("mrRankDelta"),
  medianRatingLabel: document.getElementById("medianRatingLabel"),
  medianRating: document.getElementById("medianRating"),
  statsChartPanel: document.getElementById("statsChartPanel"),
  statsRatingChart: document.getElementById("statsRatingChart"),
  statsChartEmpty: document.getElementById("statsChartEmpty"),
  statsChartState: document.getElementById("statsChartState"),
  statsChartLabel: document.getElementById("statsChartLabel"),
  hideButton: document.getElementById("hideButton"),
  resetButton: document.getElementById("resetButton"),
  displayCards: [...document.querySelectorAll("[data-display-card]")],
};

let trackerState = null;
let displaySettings = null;
let dragPointerId = null;
let renderedBackgroundOpacity = null;
let backgroundOpacityAnimationFrame = null;

function animateBackgroundOpacity(value) {
  const target = Math.min(1, Math.max(0, Number(value) || 0));
  const start = Number.isFinite(renderedBackgroundOpacity)
    ? renderedBackgroundOpacity
    : target;
  if (backgroundOpacityAnimationFrame != null) {
    cancelAnimationFrame(backgroundOpacityAnimationFrame);
    backgroundOpacityAnimationFrame = null;
  }
  if (Math.abs(start - target) < 0.001) {
    renderedBackgroundOpacity = target;
    document.documentElement.style.setProperty("--panel-opacity", String(target));
    elements.root.classList.toggle("transparent", target === 0);
    return;
  }

  // Keep the fade short enough for slider feedback while still avoiding a
  // sudden disappearance when the user clicks directly to 0%.
  const duration = Math.min(320, Math.max(150, Math.abs(target - start) * 320));
  const startedAt = performance.now();
  elements.root.classList.remove("transparent");
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    const current = start + (target - start) * eased;
    renderedBackgroundOpacity = current;
    document.documentElement.style.setProperty("--panel-opacity", String(current));
    if (trackerState) renderStatsChart(trackerState);
    if (progress < 1) {
      backgroundOpacityAnimationFrame = requestAnimationFrame(tick);
      return;
    }
    backgroundOpacityAnimationFrame = null;
    renderedBackgroundOpacity = target;
    document.documentElement.style.setProperty("--panel-opacity", String(target));
    elements.root.classList.toggle("transparent", target === 0);
  };
  backgroundOpacityAnimationFrame = requestAnimationFrame(tick);
}

function unwrap(result) {
  if (!result?.ok) throw new Error(result?.error || "処理に失敗しました");
  return result.data;
}

function fitStatsValue(element, minimumSize = 8) {
  if (!element) return;
  element.style.fontSize = "";
  requestAnimationFrame(() => {
    if (!element.isConnected || element.clientWidth <= 0) return;
    const computedSize = Number.parseFloat(getComputedStyle(element).fontSize);
    const baseSize = Number.isFinite(computedSize) ? computedSize : 16;
    let size = baseSize;
    // Width is the reliable overflow signal for these metric cards.  A grid
    // item's scrollHeight includes its line box and made vertical cards shrink
    // even when the text was visually fitting.
    while (size > minimumSize && element.scrollWidth > element.clientWidth + 1) {
      size = Math.max(minimumSize, size - 0.5);
      element.style.fontSize = `${size}px`;
    }
  });
}

function fitVerticalRankLine() {
  const group = elements.mrRank?.closest(".rank-group");
  const delta = elements.mrRankDelta;
  if (!group || !delta || !elements.root.classList.contains("vertical") || delta.classList.contains("hidden")) return;
  requestAnimationFrame(() => {
    if (!group.isConnected || group.clientWidth <= 0) return;
    let rankSize = Number.parseFloat(getComputedStyle(elements.mrRank).fontSize);
    let deltaSize = Number.parseFloat(getComputedStyle(delta).fontSize);
    while (
      rankSize > 14 &&
      deltaSize > 11 &&
      elements.mrRank.scrollWidth + delta.scrollWidth + 1 > group.clientWidth
    ) {
      rankSize -= 0.5;
      deltaSize = Math.max(11, deltaSize - 0.35);
      elements.mrRank.style.fontSize = `${rankSize}px`;
      delta.style.fontSize = `${deltaSize}px`;
    }
  });
}

function fitStatsValues() {
  for (const element of [
    elements.recordValues,
    elements.winRate,
    elements.currentRating,
    elements.ratingDelta,
    elements.medianRating,
    elements.sessionPeakRating,
    elements.mrRank,
    elements.mrRankDelta,
  ]) {
    fitStatsValue(element);
  }
  fitVerticalRankLine();
}

function drawStatsChart(
  history,
  matchCount,
  ratingType = "MR",
  potentialRating = null,
  matchStart = 0,
) {
  const canvas = elements.statsRatingChart;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  // Horizontal stats use the compact 4:1 HUD ratio. Vertical stats use a
  // 16:9 plot: it fills the portrait overlay's wide chart area while keeping
  // the same proportions in the normal window and the OBS overlay.
  const isVertical = document.querySelector(".stats-window.vertical") !== null;
  // Use the same internal frame for both window and overlay presentations.
  // Only the outer container may letterbox; the graph itself never changes
  // proportion when the mode or window size changes.
  const chartAspectRatio = isVertical ? 16 / 9 : 4;
  const containerAspectRatio = rect.width / rect.height;
  const chartWidth =
    containerAspectRatio >= chartAspectRatio
      ? rect.height * chartAspectRatio
      : rect.width;
  const chartHeight =
    containerAspectRatio >= chartAspectRatio
      ? rect.height
      : rect.width / chartAspectRatio;
  const chartLeft = (rect.width - chartWidth) / 2;
  const chartTop = (rect.height - chartHeight) / 2;
  context.translate(chartLeft, chartTop);
  const values = history.filter(
    (value) => Number.isFinite(value) && (ratingType !== "LP" || value > 0),
  );
  if (!values.length) return;
  const potentialValue = potentialRating == null ? null : Number(potentialRating);
  const potential =
    Number.isFinite(potentialValue) && potentialValue > 0
      ? potentialValue
      : null;
  const labelScale = Math.min(
    2,
    Math.max(0.75, Number(displaySettings?.graphLabelScale ?? 1.3)),
  );
  const labelFontSize = 10 * labelScale;
  const axisValues = potential == null ? values : [...values, potential];
  const dataMinimum = Math.min(...axisValues);
  const dataMaximum = Math.max(...axisValues);
  // LP uses a fixed 1,000-point grid. When all recorded LP values are
  // positive, the lower bound follows the smallest value instead of adding a
  // misleading zero baseline. MR keeps the adaptive step.
  const isLp = ratingType === "LP";
  const axisFloor = isLp ? 0 : dataMinimum;
  const dataSpread = Math.max(10, dataMaximum - axisFloor);
  const roughStep = dataSpread / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  // LP is displayed in 1,000-point increments.  The graph keeps minor grid
  // lines at every 1,000 points, while labels are thinned only when the
  // available height would make them overlap.  This preserves the requested
  // scale without making high-LP ranges unreadable.
  const step = isLp
    ? 1000
    : (normalizedStep <= 1
      ? 1
      : normalizedStep <= 2
        ? 2
        : normalizedStep <= 5
          ? 5
          : 10) * magnitude;
  let minimum = isLp
    ? Math.max(0, Math.floor(Math.max(0, dataMinimum) / step) * step)
    : Math.floor((dataMinimum - step * 0.5) / step) * step;
  let maximum = isLp
    ? Math.max(
        minimum + step,
        Math.ceil(Math.max(0, dataMaximum) / step) * step,
      )
    : Math.ceil((dataMaximum + step * 0.5) / step) * step;
  if (minimum === maximum) maximum += step;
  const fontStyle = FONT_STYLES.has(displaySettings?.fontStyle)
    ? `${displaySettings.fontStyle} `
    : "";
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor("street")}`;
  const ticks = [];
  for (let tick = minimum; tick <= maximum + step * 0.01; tick += step) {
    ticks.push(tick);
  }
  const widestLabel = Math.max(
    0,
    ...ticks.map((tick) =>
      context.measureText(displayNumber.integer(tick)).width,
    ),
  );
  const left = Math.max(46, Math.ceil(widestLabel + 12));
  const right = 10;
  const top = Math.max(9, labelFontSize / 2 + 2);
  const bottom = Math.max(24, labelFontSize + 8);
  const yFor = (value) =>
    top + ((maximum - value) / (maximum - minimum)) * (chartHeight - top - bottom);
  const xFor = (index) =>
    left +
    (index / Math.max(1, values.length - 1)) * (chartWidth - left - right);
  const plotBottom = chartHeight - bottom;
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(174,184,218,.72)";
  context.lineWidth = 1;
  const firstLpLabelIndex = Math.max(0, ticks.length - 4);
  ticks.forEach((tick, tickIndex) => {
    const y = yFor(tick);
    context.strokeStyle = "rgba(255,255,255,.12)";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(chartWidth - right, y);
    context.stroke();
    if (
      !isLp || tickIndex >= firstLpLabelIndex
    ) {
      context.fillStyle = "rgba(174,184,218,.72)";
      context.fillText(displayNumber.integer(tick), left - 8, y);
    }
  });
  values.forEach((value, index) => {
    const x = xFor(index);
    context.strokeStyle = "rgba(255,255,255,.07)";
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, chartHeight - bottom);
    context.stroke();
  });

  context.strokeStyle = "rgba(126, 167, 255, 0.9)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(left, plotBottom);
  context.lineTo(chartWidth - right, plotBottom);
  context.stroke();
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, plotBottom);
  context.stroke();

  if (potential != null) {
    const potentialY = yFor(potential);
    context.save();
    context.strokeStyle = "#c783ff";
    context.lineWidth = 1.5;
    context.shadowBlur = 5;
    context.shadowColor = "rgba(199,131,255,.62)";
    context.beginPath();
    context.moveTo(left, potentialY);
    context.lineTo(chartWidth - right, potentialY);
    context.stroke();
    context.shadowBlur = 0;
    context.font = `${fontStyle}${Math.max(8, labelFontSize - 1)}px ${fontStackFor(
      "street",
    )}`;
    context.fillStyle = "#d6a4ff";
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(
      `${t("potential", "POTENTIAL")} ${ratingType} ${displayNumber.integer(potential)}`,
      chartWidth - right,
      Math.max(top + labelFontSize, potentialY - 3),
    );
    context.restore();
  }

  const xLabelIndices = [...new Set([
    0,
    Math.round((values.length - 1) * 0.33),
    Math.round((values.length - 1) * 0.66),
    values.length - 1,
  ])];
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor("street")}`;
  context.fillStyle = "rgba(202,211,245,.86)";
  const safeMatchCount = Math.max(0, Math.trunc(Number(matchCount) || 0));
  const safeMatchStart = Math.max(0, Math.trunc(Number(matchStart) || 0));
  const lastIndex = Math.max(1, values.length - 1);
  const shownLabels = new Set();
  for (const index of xLabelIndices) {
    const x = xFor(index);
    const label = String(
      safeMatchStart + Math.round((index / lastIndex) * safeMatchCount),
    );
    if (shownLabels.has(label)) continue;
    shownLabels.add(label);
    const labelWidth = context.measureText(label).width;
    const labelX = Math.min(
      chartWidth - right - labelWidth / 2,
      Math.max(left + labelWidth / 2, x),
    );
    context.fillText(label, labelX, plotBottom + 6);
  }

  const linePath = new Path2D();
  values.forEach((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    if (index === 0) linePath.moveTo(x, y);
    else linePath.lineTo(x, y);
  });
  const areaPath = new Path2D(linePath);
  areaPath.lineTo(xFor(values.length - 1), plotBottom);
  areaPath.lineTo(xFor(0), plotBottom);
  areaPath.closePath();
  const renderedOpacity = Number.isFinite(renderedBackgroundOpacity)
    ? renderedBackgroundOpacity
    : Number(displaySettings?.backgroundOpacity);
  if (renderedOpacity > 0.001) {
    const areaGradient = context.createLinearGradient(0, top, 0, plotBottom);
    areaGradient.addColorStop(0, "rgba(126,167,255,.34)");
    areaGradient.addColorStop(1, "rgba(126,167,255,.025)");
    context.fillStyle = areaGradient;
    context.fill(areaPath);
  }
  context.strokeStyle = "#7ea7ff";
  context.lineWidth = 2.6;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowBlur = 9;
  context.shadowColor = "rgba(126,167,255,.78)";
  context.stroke(linePath);
  context.shadowBlur = 0;
  context.fillStyle = "#7ea7ff";
  values.forEach((value, index) => {
    context.beginPath();
    context.arc(xFor(index), yFor(value), 2.8, 0, Math.PI * 2);
    context.fill();
  });
  const lastX = xFor(values.length - 1);
  const lastY = yFor(values[values.length - 1]);
  context.strokeStyle = "#c7d5ff";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
  context.stroke();
}

function renderStatsChart(state) {
  const graphVisible = displaySettings?.displayItems?.graph !== false;
  elements.statsChartPanel.classList.toggle("hidden", !graphVisible);
  if (!graphVisible) return;
  const matchType = displaySettings?.matchType ?? "ranked";
  const configuredLimit = [0, 20, 50, 100].includes(
    Number(displaySettings?.graphMatchCount),
  )
    ? Number(displaySettings.graphMatchCount)
    : 20;
  const selected = state.stats?.[matchType] ?? {};
  const supplied = state.graphData?.[matchType];
  const ratingType = supplied?.ratingType || (state.ratingType === "LP" ? "LP" : "MR");
  const rawHistory = Array.isArray(supplied?.values)
    ? supplied.values.filter(Number.isFinite)
    : Array.isArray(selected.ratingHistory)
      ? selected.ratingHistory.filter(Number.isFinite)
      : [];
  const initial = Number(selected.initialRating);
  const current = Number(selected.currentRating);
  const total = Number.isFinite(Number(supplied?.matchCount))
    ? Math.max(0, Math.trunc(Number(supplied.matchCount)))
    : Number.isFinite(Number(selected.matchCount))
      ? Math.max(0, Math.trunc(Number(selected.matchCount)))
      : Math.max(0, rawHistory.length - 1);
  const historyWithPlaceholders =
    rawHistory.length >= 2 || total <= 0
      ? rawHistory
      : selected.initialRating != null &&
          selected.currentRating != null &&
          Number.isFinite(initial) &&
          Number.isFinite(current)
        ? [initial, current]
        : rawHistory;
  // LP=0 is a placeholder while the profile/rank data is being resolved. It
  // must not become a plotted point or consume one of the graph's match slots.
  const history = ratingType === "LP"
    ? historyWithPlaceholders.filter((value) => value > 0)
    : historyWithPlaceholders;
  const historyMatchCapacity = Math.max(0, history.length - 1);
  const effectiveTotal = ratingType === "LP"
    ? Math.min(total, historyMatchCapacity)
    : Math.max(total, historyMatchCapacity);
  const graphMatchCount = configuredLimit === 0
    ? Math.min(effectiveTotal, historyMatchCapacity)
    : Math.min(configuredLimit, effectiveTotal, historyMatchCapacity);
  const graphMatchStart = Math.max(0, effectiveTotal - graphMatchCount);
  const start = graphMatchCount
    ? Math.max(0, history.length - graphMatchCount - 1)
    : 0;
  const displayHistory = graphMatchCount
    ? history.slice(start, start + graphMatchCount + 1)
    : history;
  const hasGraphData =
    matchType === "ranked" && graphMatchCount > 0 && displayHistory.length >= 2;
  elements.statsRatingChart.classList.toggle("hidden", !hasGraphData);
  elements.statsChartEmpty.classList.toggle("hidden", hasGraphData);
  elements.statsChartState.textContent = hasGraphData
    ? `${graphMatchCount} MATCHES`
    : matchType === "ranked"
      ? t("dataWaiting", "データ待機中")
      : t("rankedOnly", "ランクのみ");
  elements.statsChartLabel.textContent = `${ratingType} ${t("trend", "TREND")}`;
  elements.statsChartEmpty.textContent =
    matchType === "ranked"
      ? t("graphEmptyRanked", "ランクマッチを計測するとグラフが表示されます")
      : t("graphEmptyOther", "グラフはランクマッチで表示されます");
  if (hasGraphData) {
    requestAnimationFrame(() => {
      drawStatsChart(
        displayHistory,
        graphMatchCount,
        ratingType,
        displaySettings?.potentialLineVisible !== false &&
          state?.medianRatingType === ratingType && state?.medianRatingSampleCount >= 2
          ? state.medianRating
          : null,
        graphMatchStart,
      );
    });
  }
}

function redrawStatsChart() {
  if (trackerState) renderStatsChart(trackerState);
}

function renderTracker(state) {
  trackerState = state;
  elements.root.classList.toggle("suppressed", state?.overlaySuppressed === true);
  const matchType = displaySettings?.matchType ?? "ranked";
  const selected = state.stats?.[matchType] ?? {};
  const presentation = state?.presentation ?? {};
  const wins = Number(presentation.wins ?? selected.wins ?? 0);
  const losses = Number(presentation.losses ?? selected.losses ?? 0);
  const total = wins + losses;
  const isRanked = matchType === "ranked";
  const delta = isRanked
    ? Number(presentation.ratingDelta ?? selected.ratingDelta ?? 0)
    : null;

  elements.winRate.textContent = `${Number(
    presentation.winRate ?? (total ? (wins / total) * 100 : 0),
  ).toFixed(1)}%`;
  elements.recordWins.textContent = String(wins);
  elements.recordLosses.textContent = String(losses);
  const ratingType = presentation.ratingType === "LP" || state.ratingType === "LP" ? "LP" : "MR";
  const currentRating = Number(presentation.currentRating);
  elements.currentRatingLabel.textContent = `${t("currentRating", "CURRENT")} ${ratingType}`;
  elements.currentRating.textContent = Number.isFinite(currentRating)
    ? String(Math.round(currentRating))
    : "—";
  elements.ratingTypeLabel.textContent = `${ratingType} ${t("delta", "DELTA")}`;
  elements.ratingDelta.textContent =
    delta == null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "" : "±"}${delta}`;
  const peakRating = Number(presentation.sessionPeakRating);
  const peakType = presentation.sessionPeakRatingType === "LP" ? "LP" : "MR";
  elements.sessionPeakRating.textContent = Number.isFinite(peakRating) && peakRating > 0
    ? peakType === "MR"
      ? displayNumber.positiveInteger(peakRating)
      : displayNumber.rating(peakRating, peakType)
    : "—";
  const mrRank = Number(presentation.mrRank ?? state?.ranking?.rank);
  elements.mrRank.textContent = Number.isFinite(mrRank) && mrRank > 0
    ? displayNumber.positiveInteger(mrRank)
    : (presentation.mrRankLoading ?? state?.ranking?.status === "loading")
      ? "…"
      : "—";
  const rawRankDelta = presentation.mrRankDelta;
  const formattedRankDelta = displayNumber.rankDelta(rawRankDelta);
  elements.mrRankDelta.textContent = formattedRankDelta;
  elements.mrRankDelta.classList.toggle("hidden", !formattedRankDelta);
  elements.mrRankDelta.classList.toggle("rank-up", formattedRankDelta.startsWith("↑"));
  elements.mrRankDelta.classList.toggle("rank-down", formattedRankDelta.startsWith("↓"));
  renderMedianRating(state);
  fitStatsValues();
  renderStatsChart(state);
}

function renderMedianRating(state) {
  if (!elements.medianRating) return;
  const ratingType = state?.medianRatingType || (state?.ratingType === "LP" ? "LP" : "MR");
  const median = Number(state?.medianRating);
  const sampleCount = Math.max(0, Math.trunc(Number(state?.medianRatingSampleCount) || 0));
  const potentialLabel = t("potential", "POTENTIAL");
  const label = `${potentialLabel} ${ratingType}`;
  const formatted = Number.isFinite(median) ? String(Math.round(median)) : "—";
  if (elements.medianRatingLabel) elements.medianRatingLabel.textContent = label;
  elements.medianRating.textContent =
    Number.isFinite(median) && sampleCount >= 2
      ? formatted
      : "—";
}

function normalizedDisplayItems(settings = {}) {
  const source = settings.displayItems;
  const defaults = Object.fromEntries(
    [...METRIC_ITEM_KEYS, "graph"].map((key) => [key, true]),
  );
  if (!source || typeof source !== "object") {
    if (typeof settings.graphVisible === "boolean") {
      defaults.graph = settings.graphVisible;
    }
    return defaults;
  }
  for (const key of Object.keys(defaults)) {
    if (typeof source[key] === "boolean") defaults[key] = source[key];
  }
  return defaults;
}

function renderDisplayItemVisibility(settings) {
  const displayItems = normalizedDisplayItems(settings);
  settings.displayItems = displayItems;
  const visibleMetricCount = METRIC_ITEM_KEYS.filter(
    (key) => displayItems[key],
  ).length;
  for (const card of elements.displayCards) {
    const visible = displayItems[card.dataset.displayCard] !== false;
    card.classList.toggle("hidden", !visible);
  }
  elements.root.style.setProperty(
    "--visible-card-count",
    String(Math.max(1, visibleMetricCount)),
  );
  elements.root.classList.toggle("no-metrics", visibleMetricCount === 0);
  elements.root.classList.toggle("no-chart", displayItems.graph === false);
}

function renderSettings(settings, { skipTrackerRender = false } = {}) {
  displaySettings = settings;
  renderDisplayItemVisibility(settings);
  localeApi?.applyTranslations?.(document, settings.locale || "ja-jp");
  document.documentElement.style.setProperty(
    "--font-scale",
    "1",
  );
  document.documentElement.style.setProperty(
    "--stats-value-scale",
    String(settings.fontScale),
  );
  document.documentElement.style.setProperty(
    "--text",
    settings.textColor,
  );
  const selectedFontStack = fontStackFor(settings.fontFamily);
  document.documentElement.style.setProperty(
    "--stats-value-font-family",
    selectedFontStack,
  );
  document.documentElement.style.setProperty(
    "--stats-label-font-family",
    selectedFontStack,
  );
  document.documentElement.style.setProperty(
    "--stats-font-style",
    FONT_STYLES.has(settings.fontStyle) ? settings.fontStyle : "normal",
  );
  elements.root.classList.toggle("overlay", settings.mode === "overlay");
  elements.root.classList.toggle(
    "vertical",
    settings.windowOrientation === "vertical",
  );
  elements.root.classList.toggle(
    "horizontal",
    settings.windowOrientation !== "vertical",
  );
  elements.root.classList.toggle(
    "locked",
    settings.mode === "overlay" && settings.overlayInteractionLocked === true,
  );
  animateBackgroundOpacity(settings.backgroundOpacity);
  if (trackerState && !skipTrackerRender) {
    renderTracker(trackerState);
  } else if (!trackerState && !skipTrackerRender) {
    // Apply graph settings immediately even when the first tracker-state
    // message has not arrived yet; do not wait for the next poll.
    void api.getState()
      .then(unwrap)
      .then((state) => renderTracker(state))
      .catch(() => fitStatsValues());
  }
}

elements.hideButton.addEventListener("click", () => api.hideStatsWindow());
elements.resetButton.addEventListener("click", () => api.resetTracking());
elements.root.addEventListener("pointerdown", (event) => {
  const canMoveWindow = displaySettings?.mode === "window";
  const canMoveOverlay =
    displaySettings?.mode === "overlay" &&
    displaySettings?.overlayInteractionLocked !== true;
  if (
    event.button !== 0 ||
    (!canMoveWindow && !canMoveOverlay) ||
    event.target.closest("button")
  ) {
    return;
  }
  dragPointerId = event.pointerId;
  elements.root.setPointerCapture(event.pointerId);
  api.beginStatsWindowDrag(event.screenX, event.screenY);
  event.preventDefault();
});
elements.root.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) return;
  api.moveStatsWindowDrag(event.screenX, event.screenY);
});
function finishWindowDrag(event) {
  if (event.pointerId !== dragPointerId) return;
  if (elements.root.hasPointerCapture(event.pointerId)) {
    elements.root.releasePointerCapture(event.pointerId);
  }
  dragPointerId = null;
  api.endStatsWindowDrag();
}
elements.root.addEventListener("pointerup", finishWindowDrag);
elements.root.addEventListener("pointercancel", finishWindowDrag);
api.onState(renderTracker);
api.onDisplaySettings(renderSettings);

let statsResizeFrame = 0;
function scheduleStatsResizeRender() {
  if (statsResizeFrame) return;
  statsResizeFrame = requestAnimationFrame(() => {
    statsResizeFrame = 0;
    fitStatsValues();
    redrawStatsChart();
  });
}

if (typeof ResizeObserver === "function") {
  const statsResizeObserver = new ResizeObserver(scheduleStatsResizeRender);
  statsResizeObserver.observe(elements.root);
}
window.addEventListener("resize", scheduleStatsResizeRender);

if (remoteOverlay) {
  document.body.classList.add("remote-overlay");
  const dispatchRemoteOverlay = (payload) => {
    const settings = {
      ...(payload.displaySettings ?? {}),
      overlaySize: payload.overlaySize,
      mode: "overlay",
      overlayInteractionLocked: true,
    };
    const width = Number(settings.overlaySize?.width);
    const height = Number(settings.overlaySize?.height);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      document.body.style.width = `${width}px`;
      document.body.style.height = `${height}px`;
    }
    for (const callback of remoteDisplaySettingsListeners) {
      callback(settings, { skipTrackerRender: true });
    }
    for (const callback of remoteStateListeners) callback(payload);
  };
  const refreshRemoteOverlay = async () => {
    try {
      const { payload } = await fetchRemoteOverlayState();
      dispatchRemoteOverlay(payload);
    } catch {
      // Keep the last rendered frame while the local app is starting or
      // temporarily unavailable. The next low-frequency poll will retry.
    }
  };
  refreshRemoteOverlay();
  let overlayEvents = null;
  if (typeof EventSource === "function") {
    overlayEvents = new EventSource("/events");
    overlayEvents.addEventListener("state", (event) => {
      try {
        dispatchRemoteOverlay(JSON.parse(event.data));
      } catch {
        // The periodic state request remains the recovery path for an invalid
        // or interrupted event frame.
      }
    });
  }
  window.setInterval(() => {
    if (!overlayEvents || overlayEvents.readyState !== EventSource.OPEN) {
      refreshRemoteOverlay();
    }
  }, 2000);
}

if (!remoteOverlay) {
  Promise.all([api.getState(), api.getDisplaySettings()])
    .then(([stateResult, settingsResult]) => {
      trackerState = unwrap(stateResult);
      renderSettings(unwrap(settingsResult));
    })
    .catch(() => {});
}
