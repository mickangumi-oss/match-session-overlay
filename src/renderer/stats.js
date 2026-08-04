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
  medianRatingLabel: document.getElementById("medianRatingLabel"),
  medianRating: document.getElementById("medianRating"),
  medianRatingSample: document.getElementById("medianRatingSample"),
  statsChartPanel: document.getElementById("statsChartPanel"),
  statsRatingChart: document.getElementById("statsRatingChart"),
  statsChartEmpty: document.getElementById("statsChartEmpty"),
  statsChartState: document.getElementById("statsChartState"),
  statsChartLabel: document.getElementById("statsChartLabel"),
  hideButton: document.getElementById("hideButton"),
  resetButton: document.getElementById("resetButton"),
  matchTabs: [...document.querySelectorAll("[data-match-type]")],
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

function fitStatsValue(element) {
  if (!element) return;
  element.style.fontSize = "";
  requestAnimationFrame(() => {
    if (!element.isConnected || element.clientWidth <= 0) return;
    const computedSize = Number.parseFloat(getComputedStyle(element).fontSize);
    const baseSize = Number.isFinite(computedSize) ? computedSize : 16;
    const minimumSize = 18;
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

function fitStatsValues() {
  for (const element of [
    elements.recordValues,
    elements.winRate,
    elements.ratingDelta,
    elements.medianRating,
  ]) {
    fitStatsValue(element);
  }
}

function drawStatsChart(history, matchCount, ratingType = "MR") {
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
  const values = history.filter(Number.isFinite);
  if (!values.length) return;
  const labelScale = Math.min(
    2,
    Math.max(0.75, Number(displaySettings?.graphLabelScale ?? 1.3)),
  );
  const labelFontSize = 10 * labelScale;
  const dataMinimum = Math.min(...values);
  const dataMaximum = Math.max(...values);
  const dataSpread = Math.max(10, dataMaximum - dataMinimum);
  const roughStep = dataSpread / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const step =
    (normalizedStep <= 1
      ? 1
      : normalizedStep <= 2
        ? 2
        : normalizedStep <= 5
          ? 5
          : 10) * magnitude;
  let minimum = ratingType === "LP"
    ? 0
    : Math.floor((dataMinimum - step * 0.5) / step) * step;
  let maximum = Math.ceil((dataMaximum + step * 0.5) / step) * step;
  if (minimum === maximum) maximum += step;
  const fontStyle = FONT_STYLES.has(displaySettings?.fontStyle)
    ? `${displaySettings.fontStyle} `
    : "";
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor("street")}`;
  const labels = [];
  for (let tick = minimum; tick <= maximum + step * 0.01; tick += step) {
    labels.push(Math.round(tick).toLocaleString("ja-JP"));
  }
  const widestLabel = Math.max(
    0,
    ...labels.map((label) => context.measureText(label).width),
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
  context.fillStyle = `${displaySettings?.textColor ?? "#f7f8ff"}99`;
  context.lineWidth = 1;
  for (let tick = minimum; tick <= maximum + step * 0.01; tick += step) {
    const y = yFor(tick);
    context.fillText(Math.round(tick).toLocaleString("ja-JP"), left - 8, y);
    context.strokeStyle = "rgba(255,255,255,.12)";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(chartWidth - right, y);
    context.stroke();
  }
  values.forEach((value, index) => {
    const x = xFor(index);
    context.strokeStyle = "rgba(255,255,255,.07)";
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, chartHeight - bottom);
    context.stroke();
  });

  context.strokeStyle = "rgba(67, 216, 255, 0.9)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(left, plotBottom);
  context.lineTo(chartWidth - right, plotBottom);
  context.stroke();
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, plotBottom);
  context.stroke();

  const xLabelIndices = [...new Set([
    0,
    Math.round((values.length - 1) * 0.33),
    Math.round((values.length - 1) * 0.66),
    values.length - 1,
  ])];
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor("street")}`;
  context.fillStyle = `${displaySettings?.textColor ?? "#f7f8ff"}cc`;
  const safeMatchCount = Math.max(0, Math.trunc(Number(matchCount) || 0));
  const lastIndex = Math.max(1, values.length - 1);
  const shownLabels = new Set();
  for (const index of xLabelIndices) {
    const x = xFor(index);
    const label = String(Math.round((index / lastIndex) * safeMatchCount));
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
    areaGradient.addColorStop(0, "rgba(67,216,255,.32)");
    areaGradient.addColorStop(1, "rgba(67,216,255,.025)");
    context.fillStyle = areaGradient;
    context.fill(areaPath);
  }
  context.strokeStyle = "#43d8ff";
  context.lineWidth = 2.6;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowBlur = 9;
  context.shadowColor = "rgba(67,216,255,.82)";
  context.stroke(linePath);
  context.shadowBlur = 0;
  context.fillStyle = "#43d8ff";
  values.forEach((value, index) => {
    context.beginPath();
    context.arc(xFor(index), yFor(value), 2.8, 0, Math.PI * 2);
    context.fill();
  });
  const lastX = xFor(values.length - 1);
  const lastY = yFor(values[values.length - 1]);
  context.strokeStyle = "#bdf8ff";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
  context.stroke();
}

function renderStatsChart(state) {
  const isVertical =
    displaySettings?.windowOrientation === "vertical" &&
    displaySettings?.graphVisible !== false;
  elements.statsChartPanel.classList.toggle("hidden", !isVertical);
  if (!isVertical) return;
  const matchType = displaySettings?.matchType ?? "ranked";
  const selected = state.stats?.[matchType] ?? {};
  const total = Number.isFinite(Number(selected.matchCount))
    ? Math.max(0, Math.trunc(Number(selected.matchCount)))
    : Number(selected.wins ?? 0) + Number(selected.losses ?? 0);
  const rawHistory = Array.isArray(selected.ratingHistory)
    ? selected.ratingHistory.filter(Number.isFinite)
    : [];
  const initial = Number(selected.initialRating);
  const current = Number(selected.currentRating);
  const history =
    rawHistory.length >= 2 || total <= 0
      ? rawHistory
      : selected.initialRating != null &&
          selected.currentRating != null &&
          Number.isFinite(initial) &&
          Number.isFinite(current)
        ? [initial, current]
        : rawHistory;
  // matchCount is maintained per character and per mode by the main process;
  // never substitute the all-character session total here.
  const graphMatchCount = total;
  const hasGraphData =
    matchType === "ranked" && graphMatchCount > 0 && history.length >= 2;
  elements.statsRatingChart.classList.toggle("hidden", !hasGraphData);
  elements.statsChartEmpty.classList.toggle("hidden", hasGraphData);
  elements.statsChartState.textContent = hasGraphData
    ? `${graphMatchCount} MATCHES`
    : matchType === "ranked"
      ? t("dataWaiting", "データ待機中")
      : t("rankedOnly", "ランクのみ");
  const ratingType = state.ratingType === "LP" ? "LP" : "MR";
  elements.statsChartLabel.textContent = `${ratingType} ${t("trend", "TREND")}`;
  elements.statsChartEmpty.textContent =
    matchType === "ranked"
      ? t("graphEmptyRanked", "ランクマッチを計測するとグラフが表示されます")
      : t("graphEmptyOther", "グラフはランクマッチで表示されます");
  if (hasGraphData) {
    requestAnimationFrame(() => {
      drawStatsChart(history, graphMatchCount, ratingType);
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
  const wins = Number(selected.wins ?? 0);
  const losses = Number(selected.losses ?? 0);
  const total = wins + losses;
  const isRanked = matchType === "ranked";
  const delta = isRanked ? Number(selected.ratingDelta ?? 0) : null;

  elements.winRate.textContent = `${(total ? (wins / total) * 100 : 0).toFixed(1)}%`;
  elements.recordWins.textContent = String(wins);
  elements.recordLosses.textContent = String(losses);
  const ratingType = state.ratingType === "LP" ? "LP" : "MR";
  elements.ratingTypeLabel.textContent = `${ratingType} ${t("delta", "DELTA")}`;
  elements.ratingDelta.textContent =
    delta == null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "" : "±"}${delta}`;
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
  if (elements.medianRatingSample) {
    elements.medianRatingSample.textContent = sampleCount
      ? `(${sampleCount} ${t("matchUnit", "Match")})`
      : "";
  }
}

function renderSettings(settings) {
  displaySettings = settings;
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
    settings.mode === "window" && settings.windowOrientation !== "vertical",
  );
  elements.root.classList.toggle(
    "no-chart",
    settings.windowOrientation !== "vertical" || settings.graphVisible === false,
  );
  elements.root.classList.toggle(
    "locked",
    settings.overlayInteractionLocked === true,
  );
  animateBackgroundOpacity(settings.backgroundOpacity);
  for (const tab of elements.matchTabs) {
    tab.classList.toggle("active", tab.dataset.matchType === settings.matchType);
  }
  if (trackerState) renderTracker(trackerState);
  else fitStatsValues();
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
for (const tab of elements.matchTabs) {
  tab.addEventListener("click", () =>
    api.updateDisplaySettings({ matchType: tab.dataset.matchType }),
  );
}
api.onState(renderTracker);
api.onDisplaySettings(renderSettings);

if (typeof ResizeObserver === "function") {
  const statsResizeObserver = new ResizeObserver(() => {
    fitStatsValues();
    redrawStatsChart();
  });
  statsResizeObserver.observe(elements.root);
}
window.addEventListener("resize", () => {
  fitStatsValues();
  redrawStatsChart();
});

if (remoteOverlay) {
  document.body.classList.add("remote-overlay");
  const refreshRemoteOverlay = async () => {
    try {
      const { payload, settings } = await fetchRemoteOverlayState();
      const width = Number(settings.overlaySize?.width);
      const height = Number(settings.overlaySize?.height);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        document.body.style.width = `${width}px`;
        document.body.style.height = `${height}px`;
      }
      for (const callback of remoteStateListeners) callback(payload);
      for (const callback of remoteDisplaySettingsListeners) callback(settings);
    } catch {
      // Keep the last rendered frame while the local app is starting or
      // temporarily unavailable. The next low-frequency poll will retry.
    }
  };
  refreshRemoteOverlay();
  window.setInterval(refreshRemoteOverlay, 2000);
}

Promise.all([api.getState(), api.getDisplaySettings()])
  .then(([stateResult, settingsResult]) => {
    renderSettings(unwrap(settingsResult));
    renderTracker(unwrap(stateResult));
  })
  .catch(() => {});
