"use strict";

const api = window.matchOverlay;
const localeApi = window.matchOverlayI18n;
const t = (key, fallback = key) =>
  localeApi?.t ? localeApi.t(key) : fallback;
function applyLocale(locale = "ja-jp") {
  localeApi?.applyTranslations?.(document, locale);
  if (elements.languageInput && locale) elements.languageInput.value = locale;
}
const FONT_STACKS = {
  street: 'Impact, "Arial Black", "Bahnschrift Condensed", sans-serif',
  condensed: '"Bahnschrift Condensed", "Arial Narrow", sans-serif',
  system: '"Segoe UI Variable", "Segoe UI", sans-serif',
  japanese: '"Yu Gothic UI", Meiryo, sans-serif',
  mono: '"Cascadia Mono", Consolas, monospace',
};
const FONT_STYLE_VALUES = new Set(["normal", "italic"]);

function fontStackFor(value) {
  if (FONT_STACKS[value]) return FONT_STACKS[value];
  const family = String(value ?? "")
    .replace(/["\\]/g, "")
    .trim();
  return family ? `"${family}", sans-serif` : FONT_STACKS.street;
}
let selectedPlayer = null;
let trackerState = null;
let displaySettings = { matchType: "ranked" };

const elements = Object.fromEntries(
  [
    "authStatus",
    "trackerStatus",
    "openLoginButton",
    "checkLoginButton",
    "playerPanel",
    "playerName",
    "playerCode",
    "startTrackingButton",
    "startTrackingLabel",
    "nextUpdateInfo",
    "stopTrackingButton",
    "recordWins",
    "recordLosses",
    "winRate",
    "currentCharacter",
    "currentRatingLabel",
    "currentRating",
    "ratingDeltaLabel",
    "ratingDelta",
    "ratingTrendLabel",
    "ratingTrendDescription",
    "ratingGraphLabel",
    "ratingAxisLabel",
    "managementChartPanel",
    "managementRatingChart",
    "managementChartEmpty",
    "managementChartState",
    "resetTrackingButton",
    "toggleStatsButton",
    "overlayLockButton",
    "windowOrientationControl",
    "optionsButton",
    "closeOptionsButton",
    "optionsPanel",
    "fontScaleInput",
    "fontScaleValue",
    "graphLabelScaleInput",
    "graphLabelScaleValue",
    "opacityInput",
    "opacityValue",
    "fontFamilyInput",
    "fontStyleInput",
    "textColorInput",
    "pollIntervalInput",
    "launchAtLoginInput",
    "gameDetectionInput",
    "chooseGameButton",
    "gameExecutableName",
    "overlayUrl",
    "copyOverlayButton",
    "clearDataButton",
    "checkUpdateButton",
    "installUpdateButton",
    "updateBadge",
    "updateMessage",
    "updateProgress",
    "updateProgressBar",
    "notice",
    "languageInput",
  ].map((id) => [id, document.getElementById(id)]),
);

function showNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
}

const FONT_PRESETS = [
  { value: "street", key: "fontStreet", fallback: "Street HUD" },
  { value: "condensed", key: "fontCondensed", fallback: "Condensed" },
  { value: "system", key: "fontSystem", fallback: "System" },
  { value: "japanese", key: "fontJapanese", fallback: "Japanese" },
  { value: "mono", key: "fontMono", fallback: "Monospace" },
];

async function populateInstalledFonts(selectedValue = "street") {
  if (!elements.fontFamilyInput) return;
  let installedFonts = [];
  try {
    const response = api.getInstalledFonts
      ? await unwrap(await api.getInstalledFonts())
      : [];
    installedFonts = Array.isArray(response)
      ? response.filter((value) => typeof value === "string")
      : [];
  } catch {
    installedFonts = [];
  }

  const options = [
    ...FONT_PRESETS.map((preset) => ({
      value: preset.value,
      label: t(preset.key, preset.fallback),
    })),
    ...installedFonts.map((family) => ({ value: family, label: family })),
  ];
  const seen = new Set();
  elements.fontFamilyInput.replaceChildren(
    ...options
      .filter((option) => {
        const key = option.value.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((option) => {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        return element;
      }),
  );
  const hasSelected = options.some((option) => option.value === selectedValue);
  elements.fontFamilyInput.value = hasSelected ? selectedValue : "street";
}

function setStatus(element, label, kind = "neutral") {
  element.textContent = label;
  element.className = `status ${kind}`;
}

function translateStatus(status) {
  return localeApi?.statusLabel ? localeApi.statusLabel(status) : status;
}

function fitPlayerName() {
  const element = elements.playerName;
  if (!element) return;
  const name = String(element.textContent ?? "").trim();
  element.title = name;
  element.setAttribute("aria-label", name);
  element.style.fontSize = "";
  if (!name) return;

  // SF6 player names are short in normal use, but a localized or full-width
  // name can exceed the compact account card. Shrink only as much as needed so
  // the full value remains readable instead of silently adding an ellipsis.
  requestAnimationFrame(() => {
    const baseSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
    const minimumSize = 9;
    let size = baseSize;
    while (size > minimumSize && element.scrollWidth > element.clientWidth + 1) {
      size = Math.max(minimumSize, size - 0.5);
      element.style.fontSize = `${size}px`;
    }
  });
}

function renderNextUpdate() {
  if (!trackerState?.active || !Number.isFinite(trackerState.nextPollAt)) {
    elements.nextUpdateInfo.textContent = trackerState?.stopReason
      ? t("autoStopped", "自動停止")
      : `${t("nextUpdate", "次回更新")} --:--`;
    return;
  }
  const remainingSeconds = Math.max(
    0,
    Math.ceil((trackerState.nextPollAt - Date.now()) / 1000),
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  elements.nextUpdateInfo.textContent = `${t("nextUpdate", "次回更新")} ${minutes}:${seconds}`;
}

function drawManagementChart(history) {
  const canvas = elements.managementRatingChart;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const values = history.filter(Number.isFinite);
  if (!values.length) return;
  const labelScale = Math.min(
    2,
    Math.max(0.75, Number(displaySettings.graphLabelScale ?? 1.3)),
  );
  const labelFontSize = 9 * labelScale;
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
  let minimum = Math.floor((dataMinimum - step * 0.5) / step) * step;
  let maximum = Math.ceil((dataMaximum + step * 0.5) / step) * step;
  if (minimum === maximum) maximum += step;

  const fontStyle = FONT_STYLE_VALUES.has(displaySettings.fontStyle)
    ? `${displaySettings.fontStyle} `
    : "";
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor(
    displaySettings.fontFamily,
  )}`;
  const labels = [];
  for (let tick = minimum; tick <= maximum + step * 0.01; tick += step) {
    labels.push(Math.round(tick).toLocaleString("ja-JP"));
  }
  const widestLabel = Math.max(
    0,
    ...labels.map((label) => context.measureText(label).width),
  );
  const left = Math.max(43, Math.ceil(widestLabel + 10));
  const right = 8;
  const top = Math.max(7, labelFontSize / 2 + 1);
  const bottom = Math.max(22, labelFontSize + 7);
  const yFor = (value) =>
    top + ((maximum - value) / (maximum - minimum)) * (height - top - bottom);
  const xFor = (index) =>
    left + (index / Math.max(1, values.length - 1)) * (width - left - right);

  const plotBottom = height - bottom;
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = `${displaySettings.textColor ?? "#f7f8ff"}99`;
  context.lineWidth = 1;
  for (let tick = minimum; tick <= maximum + step * 0.01; tick += step) {
    const y = yFor(tick);
    context.fillText(Math.round(tick).toLocaleString("ja-JP"), left - 7, y);
    context.strokeStyle = "rgba(255,255,255,.1)";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
  }
  values.forEach((value, index) => {
    const x = xFor(index);
    context.strokeStyle = "rgba(255,255,255,.05)";
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, height - bottom);
    context.stroke();
  });

  context.strokeStyle = "rgba(67, 216, 255, 0.9)";
  context.lineWidth = 1.15;
  context.beginPath();
  context.moveTo(left, plotBottom);
  context.lineTo(width - right, plotBottom);
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
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor(
    displaySettings.fontFamily,
  )}`;
  context.fillStyle = `${displaySettings.textColor ?? "#f7f8ff"}cc`;
  for (const index of xLabelIndices) {
    const x = xFor(index);
    const label = index === values.length - 1
      ? t("now", "NOW")
      : `-${values.length - 1 - index}`;
    const labelWidth = context.measureText(label).width;
    const labelX = Math.min(
      width - right - labelWidth / 2,
      Math.max(left + labelWidth / 2, x),
    );
    context.fillText(label, labelX, plotBottom + 5);
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
  const areaGradient = context.createLinearGradient(0, top, 0, plotBottom);
  areaGradient.addColorStop(0, "rgba(67,216,255,.34)");
  areaGradient.addColorStop(1, "rgba(67,216,255,.025)");
  context.fillStyle = areaGradient;
  context.fill(areaPath);

  context.strokeStyle = "#43d8ff";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowBlur = 9;
  context.shadowColor = "rgba(67,216,255,.82)";
  context.stroke(linePath);
  context.shadowBlur = 0;
  context.fillStyle = "#43d8ff";
  values.forEach((value, index) => {
    context.beginPath();
    context.arc(xFor(index), yFor(value), 2.4, 0, Math.PI * 2);
    context.fill();
  });
  const lastX = xFor(values.length - 1);
  const lastY = yFor(values[values.length - 1]);
  context.strokeStyle = "#bdf8ff";
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
  context.stroke();
}

function resolveRatingType(state = trackerState) {
  if (
    state?.currentRating != null &&
    (state.ratingType === "LP" || state.ratingType === "MR")
  ) {
    return state.ratingType;
  }
  if (selectedPlayer?.mr != null) return "MR";
  if (selectedPlayer?.lp != null) return "LP";
  return "MR";
}

function renderManagementChart(state) {
  // The graph option controls the compact stats window/overlay only. The
  // management screen is the dedicated graph workspace and always keeps it
  // visible for inspection.
  elements.managementChartPanel.classList.remove("hidden");

  const matchType = displaySettings.matchType ?? "ranked";
  const ratingType = resolveRatingType(state);
  const selected = state.stats?.[matchType] ?? {};
  const total = Number(selected.wins ?? 0) + Number(selected.losses ?? 0);
  const history = Array.isArray(selected.ratingHistory)
    ? selected.ratingHistory
    : [];
  const hasGraphData =
    matchType === "ranked" && total > 0 && history.length >= 2;
  elements.managementRatingChart.classList.toggle("hidden", !hasGraphData);
  elements.managementChartEmpty.classList.toggle("hidden", hasGraphData);
  elements.managementChartEmpty.textContent =
    matchType === "ranked"
      ? t("graphEmptyRanked", "ランクマッチを計測するとグラフが表示されます")
      : `${ratingType} ${t("graphEmptyOther", "グラフはランクマッチで表示されます")}`;
  elements.managementChartState.textContent = hasGraphData
    ? `${history.length} POINTS`
    : matchType === "ranked"
      ? t("dataWaiting", "データ待機中")
      : t("rankedOnly", "ランクのみ");
  if (hasGraphData) {
    requestAnimationFrame(() => drawManagementChart(history));
  }
}

function renderRatingLabels(state = trackerState) {
  const ratingType = resolveRatingType(state);
  elements.ratingDeltaLabel.textContent = `${ratingType} ${t("delta", "DELTA")}`;
  elements.ratingTrendLabel.textContent = `${ratingType} ${t("trend", "TREND")}`;
  elements.ratingTrendDescription.textContent = `${t("trendDescription", "アプリ起動後の変動")} `;
  elements.ratingGraphLabel.textContent = `${ratingType} ${t("graph", "GRAPH")}`;
  elements.ratingAxisLabel.textContent = `${ratingType} ${t("axisSize", "AXIS SIZE")}`;
  elements.managementRatingChart.setAttribute(
    "aria-label",
    `${t("trendDescription", "起動後の変動")} ${ratingType}`,
  );
  return ratingType;
}

function renderCurrentRating(state = trackerState) {
  const trackedRating = state?.currentRating;
  const rating =
    trackedRating ??
    selectedPlayer?.mr ??
    selectedPlayer?.lp ??
    null;
  const ratingType =
    trackedRating != null
      ? state.ratingType
      : selectedPlayer?.mr != null
        ? "MR"
        : selectedPlayer?.lp != null
          ? "LP"
          : "";
  elements.currentRatingLabel.textContent = `${t("currentRating", "CURRENT")} ${ratingType || "MR"}`;
  elements.currentRating.textContent = rating == null ? "---" : String(rating);
}

function renderCurrentCharacter(state = trackerState) {
  const siteCharacter = String(
    state?.player?.characterDisplayName ??
      selectedPlayer?.characterDisplayName ??
      "",
  ).trim();
  const toolCharacter = String(
    state?.player?.character ?? selectedPlayer?.character ?? "",
  ).trim();
  elements.currentCharacter.textContent = siteCharacter
    ? siteCharacter.toLocaleUpperCase("en-US")
    : toolCharacter
      ? localeApi?.characterName
        ? localeApi.characterName(toolCharacter)
        : toolCharacter.toLocaleUpperCase("en-US")
      : "—";
}

function applyAuthenticatedPlayer(player) {
  selectedPlayer = player;
  elements.playerName.textContent = player.name;
  elements.playerCode.textContent = player.userCode;
  elements.playerPanel.classList.remove("hidden");
  fitPlayerName();
  renderRatingLabels();
  renderCurrentRating();
  renderCurrentCharacter();
  setStatus(elements.authStatus, t("loggedIn", "ログイン済み"), "ok");
  elements.startTrackingButton.disabled = false;
}

async function unwrap(promise) {
  const result = await promise;
  if (!result?.ok) {
    throw new Error(result?.error || "処理に失敗しました");
  }
  return result.data;
}

function renderTracker(state) {
  trackerState = state;
  renderRatingLabels(state);
  renderCurrentRating(state);
  renderCurrentCharacter(state);
  const matchType = displaySettings.matchType ?? "ranked";
  const selected = state.stats?.[matchType] ?? {};
  const wins = Number(selected.wins ?? 0);
  const losses = Number(selected.losses ?? 0);
  const total = wins + losses;
  const delta =
    matchType === "ranked" ? Number(selected.ratingDelta ?? 0) : null;
  elements.recordWins.textContent = String(wins);
  elements.recordLosses.textContent = String(losses);
  elements.winRate.textContent = `${(total ? (wins / total) * 100 : 0).toFixed(1)}%`;
  elements.ratingDelta.textContent =
    delta == null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "" : "±"}${delta}`;
  renderManagementChart(state);
  elements.overlayUrl.textContent = state.overlayUrl;
  setStatus(
    elements.trackerStatus,
    translateStatus(state.status),
    state.active ? "ok" : "neutral",
  );
  elements.startTrackingButton.disabled = !selectedPlayer || state.active;
  elements.startTrackingLabel.textContent =
    state.stopReason === "idle" ? t("resumeMeasure", "計測を再開") : t("startMeasure", "計測を開始");
  elements.stopTrackingButton.disabled = !state.active;
  elements.resetTrackingButton.disabled = !state.active;
  renderNextUpdate();
}

function renderDisplaySettings(settings) {
  displaySettings = settings;
  const windowOrientation = settings.windowOrientation ?? "horizontal";
  applyLocale(settings.locale || "ja-jp");
  elements.fontScaleInput.value = String(Math.round(settings.fontScale * 100));
  elements.fontScaleValue.textContent = `${elements.fontScaleInput.value}%`;
  elements.graphLabelScaleInput.value = String(
    Math.round(settings.graphLabelScale * 100),
  );
  elements.graphLabelScaleValue.textContent =
    `${elements.graphLabelScaleInput.value}%`;
  elements.opacityInput.value = String(
    Math.round(settings.backgroundOpacity * 100),
  );
  elements.opacityValue.textContent = `${elements.opacityInput.value}%`;
  for (const button of document.querySelectorAll("[data-display-mode]")) {
    button.classList.toggle("active", button.dataset.displayMode === settings.mode);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.displayMode === settings.mode),
    );
  }
  for (const button of document.querySelectorAll("[data-window-orientation]")) {
    const active = button.dataset.windowOrientation === windowOrientation;
    button.classList.toggle("active", active);
    button.disabled = false;
    button.setAttribute("aria-pressed", String(active));
  }
  elements.windowOrientationControl?.setAttribute(
    "aria-disabled",
    "false",
  );
  for (const button of document.querySelectorAll("[data-match-type]")) {
    button.classList.toggle("active", button.dataset.matchType === settings.matchType);
  }
  for (const button of document.querySelectorAll("[data-graph-visible]")) {
    button.classList.toggle(
      "active",
      (button.dataset.graphVisible === "true") === settings.graphVisible,
    );
  }
  elements.fontFamilyInput.value = settings.fontFamily;
  if (elements.fontStyleInput) {
    elements.fontStyleInput.value = FONT_STYLE_VALUES.has(settings.fontStyle)
      ? settings.fontStyle
      : "normal";
  }
  document.documentElement.style.setProperty(
    "--stats-font-family",
    fontStackFor(settings.fontFamily),
  );
  document.documentElement.style.setProperty(
    "--stats-font-style",
    FONT_STYLE_VALUES.has(settings.fontStyle) ? settings.fontStyle : "normal",
  );
  elements.textColorInput.value = settings.textColor;
  elements.pollIntervalInput.value = String(settings.pollIntervalSeconds);
  elements.launchAtLoginInput.checked = settings.launchAtLogin;
  elements.gameDetectionInput.checked = settings.autoDetectGame;
  elements.gameExecutableName.textContent =
    settings.gameExecutableName || t("gameNotSelected", "ゲーム未選択");
  elements.overlayLockButton.disabled = settings.mode !== "overlay";
  elements.overlayLockButton.textContent = settings.overlayInteractionLocked
    ? t("overlayMove", "オーバーレイ移動")
    : t("overlayLock", "オーバーレイ固定");
  elements.toggleStatsButton.textContent = settings.statsWindowVisible
    ? t("hideStats", "戦績ウィンドウを閉じる")
    : t("showStats", "戦績ウィンドウを表示");
  if (trackerState) renderTracker(trackerState);
}

function renderUpdateMessage(state) {
  const key = state.messageKey;
  if (!key) return state.message ?? "";
  const fallback = state.message ?? "";
  return t(key, fallback)
    .replace("{version}", String(state.availableVersion ?? ""));
}

function renderUpdate(state) {
  elements.updateMessage.textContent = renderUpdateMessage(state);
  const downloading = state.status === "downloading";
  const required = state.required === true;
  const hasUpdate = downloading || state.status === "ready";
  const updateRow = elements.updateBadge.closest(".update-row");
  document.body.classList.toggle("update-required", required);
  elements.updateBadge.classList.toggle("hidden", !hasUpdate);
  updateRow.classList.toggle("has-update", hasUpdate);
  updateRow.classList.toggle("force-update", required);
  elements.updateProgress.classList.toggle("hidden", !downloading);
  elements.updateProgressBar.style.width = `${state.progress || 0}%`;
  elements.installUpdateButton.classList.toggle(
    "hidden",
    state.status !== "ready",
  );
  elements.installUpdateButton.textContent = required
    ? t("updateForce", "強制更新")
    : t("update", "更新");
  // 強制更新中でも、更新元を選び直した後に再確認できるようにする。
  // 更新が ready になった時だけ確認ボタンを更新ボタンへ置き換える。
  elements.checkUpdateButton.classList.toggle("hidden", hasUpdate);
  elements.checkUpdateButton.disabled =
    state.status === "checking" || state.status === "downloading";
}

elements.openLoginButton.addEventListener("click", async () => {
  showNotice("");
  try {
    await unwrap(api.openLogin());
    showNotice(t("loginOpened", "公式ログイン画面を開きました"));
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.checkLoginButton.addEventListener("click", async () => {
  elements.checkLoginButton.disabled = true;
  showNotice(t("fetchingPlayer", "ログイン中のプレイヤー情報を取得しています…"));
  try {
    const authentication = await unwrap(api.checkLogin());
    applyAuthenticatedPlayer(authentication.player);
    showNotice(t("playerConfigured", "ログイン中のプレイヤーを設定しました"), "success");
  } catch (error) {
    selectedPlayer = null;
    elements.playerPanel.classList.add("hidden");
    setStatus(elements.authStatus, t("loginRequired", "要ログイン"), "error");
    elements.startTrackingButton.disabled = true;
    showNotice(error.message, "error");
  } finally {
    elements.checkLoginButton.disabled = false;
  }
});

elements.startTrackingButton.addEventListener("click", async () => {
  if (!selectedPlayer) return;
  elements.startTrackingButton.disabled = true;
  showNotice(t("startingSession", "現在の戦績を基準としてセッションを開始しています…"));
  try {
    renderTracker(await unwrap(api.startTracking(selectedPlayer)));
    showNotice(t("monitoringStarted", "ランクマッチの監視を開始しました"), "success");
  } catch (error) {
    elements.startTrackingButton.disabled = false;
    showNotice(error.message, "error");
  }
});

elements.stopTrackingButton.addEventListener("click", async () => {
  renderTracker(await unwrap(api.stopTracking()));
  showNotice(t("sessionEnded", "配信セッションを終了しました"));
});

elements.resetTrackingButton.addEventListener("click", async () => {
  renderTracker(await unwrap(api.resetTracking()));
  showNotice(t("statsReset", "起動後の戦績を0から数え直します"), "success");
});

elements.toggleStatsButton.addEventListener("click", async () => {
  elements.toggleStatsButton.disabled = true;
  try {
    const settings = await unwrap(api.toggleStatsWindow());
    renderDisplaySettings(settings);
    showNotice(
      settings.statsWindowVisible
        ? t("statsShown", "戦績ウィンドウを表示しました")
        : t("statsHidden", "戦績ウィンドウを閉じました"),
      "success",
    );
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    elements.toggleStatsButton.disabled = false;
  }
});

elements.overlayLockButton.addEventListener("click", async () => {
  renderDisplaySettings(await unwrap(api.toggleOverlayInteraction()));
  showNotice(
    displaySettings.overlayInteractionLocked
      ? t("overlayLockedNotice", "オーバーレイを固定し、クリックをゲームへ透過します")
      : t("overlayUnlockedNotice", "オーバーレイをドラッグして配置を調整できます"),
    "success",
  );
});

function setOptionsOpen(open) {
  elements.managementChartPanel.classList.toggle("options-collapsed", open);
  elements.optionsPanel
    .closest(".display-panel")
    ?.classList.toggle("options-open", open);
  elements.optionsPanel.classList.toggle("hidden", !open);
  elements.optionsPanel.setAttribute("aria-hidden", String(!open));
  elements.optionsButton.setAttribute("aria-expanded", String(open));
  elements.optionsButton.classList.toggle("active", open);
}

elements.optionsButton.addEventListener("click", () => {
  setOptionsOpen(elements.optionsPanel.classList.contains("hidden"));
});

elements.closeOptionsButton.addEventListener("click", () => {
  setOptionsOpen(false);
});

for (const button of document.querySelectorAll("[data-display-mode]")) {
  button.addEventListener("click", async () => {
    renderDisplaySettings(
      await unwrap(api.updateDisplaySettings({ mode: button.dataset.displayMode })),
    );
  });
}

for (const button of document.querySelectorAll("[data-window-orientation]")) {
  button.addEventListener("click", async () => {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({
          windowOrientation: button.dataset.windowOrientation,
        }),
      ),
    );
  });
}

for (const button of document.querySelectorAll("[data-match-type]")) {
  button.addEventListener("click", async () => {
    renderDisplaySettings(
      await unwrap(api.updateDisplaySettings({ matchType: button.dataset.matchType })),
    );
  });
}

for (const button of document.querySelectorAll("[data-graph-visible]")) {
  button.addEventListener("click", async () => {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({
          graphVisible: button.dataset.graphVisible === "true",
        }),
      ),
    );
  });
}

elements.fontScaleInput.addEventListener("input", async () => {
  elements.fontScaleValue.textContent = `${elements.fontScaleInput.value}%`;
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        fontScale: Number(elements.fontScaleInput.value) / 100,
      }),
    ),
  );
});

elements.graphLabelScaleInput.addEventListener("input", async () => {
  elements.graphLabelScaleValue.textContent =
    `${elements.graphLabelScaleInput.value}%`;
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        graphLabelScale: Number(elements.graphLabelScaleInput.value) / 100,
      }),
    ),
  );
});

elements.opacityInput.addEventListener("input", async () => {
  elements.opacityValue.textContent = `${elements.opacityInput.value}%`;
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        backgroundOpacity: Number(elements.opacityInput.value) / 100,
      }),
    ),
  );
});

elements.fontFamilyInput.addEventListener("change", async () => {
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        fontFamily: elements.fontFamilyInput.value,
      }),
    ),
  );
});

elements.fontStyleInput?.addEventListener("change", async () => {
  const fontStyle = FONT_STYLE_VALUES.has(elements.fontStyleInput.value)
    ? elements.fontStyleInput.value
    : "normal";
  renderDisplaySettings(
    await unwrap(api.updateDisplaySettings({ fontStyle })),
  );
});

elements.textColorInput.addEventListener("input", async () => {
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        textColor: elements.textColorInput.value,
      }),
    ),
  );
});

elements.pollIntervalInput.addEventListener("change", async () => {
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        pollIntervalSeconds: Number(elements.pollIntervalInput.value),
      }),
    ),
  );
  showNotice(t("pollChanged", "戦績の取得間隔を変更しました"), "success");
});

elements.languageInput?.addEventListener("change", async () => {
  const locale = elements.languageInput.value;
  try {
    renderDisplaySettings(
      await unwrap(api.updateDisplaySettings({ locale })),
    );
    await populateInstalledFonts(displaySettings.fontFamily);
    // Re-read the player through the newly selected official locale while no
    // session is running. Active sessions refresh their player in the main
    // process so the next tracker state remains the single source of truth.
    if (selectedPlayer && !trackerState.active) {
      try {
        const authentication = await unwrap(api.checkLogin());
        if (authentication?.player) {
          applyAuthenticatedPlayer(authentication.player);
        }
      } catch {
        // Keep the existing player card if a locale-specific refresh fails.
      }
    }
    showNotice(t("languageChanged", "表示言語を変更しました"), "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.chooseGameButton.addEventListener("click", async () => {
  try {
    const previousExecutable = displaySettings.gameExecutableName;
    const nextSettings = await unwrap(api.chooseGameExecutable());
    renderDisplaySettings(nextSettings);
    if (nextSettings.gameExecutableName !== previousExecutable) {
      showNotice(t("gameConfigured", "ゲーム実行ファイルを設定しました"), "success");
    }
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.launchAtLoginInput.addEventListener("change", async () => {
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        launchAtLogin: elements.launchAtLoginInput.checked,
      }),
    ),
  );
  showNotice(
    elements.launchAtLoginInput.checked
      ? t("launchEnabled", "コンピューター起動時のアプリ実行を有効にしました")
      : t("launchDisabled", "コンピューター起動時のアプリ実行を無効にしました"),
    "success",
  );
});

elements.gameDetectionInput.addEventListener("change", async () => {
  if (
    elements.gameDetectionInput.checked &&
    !displaySettings.gameExecutableName
  ) {
    elements.gameDetectionInput.checked = false;
    showNotice(t("chooseGameFirst", "先にゲーム実行ファイルを選択してください"), "error");
    return;
  }
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        autoDetectGame: elements.gameDetectionInput.checked,
      }),
    ),
  );
  showNotice(
    elements.gameDetectionInput.checked
      ? t("gameDetectionEnabled", "ゲーム起動のバックグラウンド監視を有効にしました")
      : t("gameDetectionDisabled", "ゲーム起動の検知を無効にしました"),
    "success",
  );
});

window.addEventListener("resize", () => {
  if (trackerState) {
    renderManagementChart(trackerState);
  }
});

setInterval(renderNextUpdate, 1000);

elements.copyOverlayButton.addEventListener("click", async () => {
  await unwrap(api.copyText(elements.overlayUrl.textContent));
  showNotice(t("obsCopied", "OBS用URLをコピーしました"), "success");
});

elements.clearDataButton.addEventListener("click", async () => {
  try {
    const result = await unwrap(api.clearPrivateData());
    if (!result.cleared) return;
    selectedPlayer = null;
    elements.playerPanel.classList.add("hidden");
    setStatus(elements.authStatus, t("unverified", "未確認"));
    elements.startTrackingButton.disabled = true;
    renderTracker(await unwrap(api.getState()));
    showNotice(t("privateDataDeleted", "このPCのログイン情報を削除しました"), "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.checkUpdateButton.addEventListener("click", async () => {
  try {
    renderUpdate(await unwrap(api.checkForUpdates()));
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.installUpdateButton.addEventListener("click", async () => {
  try {
    await unwrap(api.installUpdate());
  } catch (error) {
    showNotice(error.message, "error");
  }
});

api.onState(renderTracker);
api.onUpdateState(renderUpdate);
api.onDisplaySettings(renderDisplaySettings);
api.onAuthenticatedPlayer((player) => {
  applyAuthenticatedPlayer(player);
  showNotice(t("autoPlayerConfigured", "ログイン中のプレイヤーを自動設定しました"), "success");
});

Promise.all([
  unwrap(api.getState()),
  unwrap(api.getUpdateState()),
  unwrap(api.getDisplaySettings()),
])
  .then(async ([state, updateState, settings]) => {
    renderDisplaySettings(settings);
    await populateInstalledFonts(settings.fontFamily);
    renderTracker(state);
    renderUpdate(updateState);
  })
  .catch((error) => showNotice(error.message, "error"));
