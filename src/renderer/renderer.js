"use strict";

const api = window.matchOverlay;
const localeApi = window.matchOverlayI18n;
const displayNumber = window.matchDisplayNumberFormat;
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
let historyState = { records: [], canFetch: false, authenticated: false, cooldownSeconds: 0 };
let historyPanelOpen = false;
let pendingHistoryRenderState = null;
let historyRenderFrame = null;
let pendingHistoryPageReset = false;
let historyRatingPeriod = { mode: "all", weekOffset: 0, dateMode: "played" };
const HISTORY_PAGE_SIZE = 10;
const RECENT_HISTORY_PREVIEW_LIMIT = 5;
let historyPage = 0;
let historyOpponentSort = { key: "matches", direction: "desc" };
let selectedHistoryRecordKey = null;
let historyOpponentProfileRequestToken = 0;
let historyOpponentProfileState = {
  status: "idle",
  recordKey: null,
  record: null,
  context: null,
};
const historyOpponentInsightCache = new Map();
let managementChartRenderToken = 0;
let managementResizeFrame = 0;
let socialState = {
  friends: { status: "idle", page: 1, totalPages: 1, players: [] },
  following: { status: "idle", page: 1, totalPages: 1, players: [] },
};
let activeSocialKind = "friends";
let socialRefreshCooldownTimer = null;
let lastSocialActivityReportAt = 0;
let notificationSoundPreviewInFlight = false;
let friendNotificationSampleInFlight = false;

const elements = Object.fromEntries(
  [
    "authStatus",
    "openLoginButton",
    "checkLoginButton",
    "playerPanel",
    "playerName",
    "playerCode",
    "startTrackingButton",
    "startTrackingLabel",
    "nextUpdateInfo",
    "stopTrackingButton",
    "openHistoryButton",
    "recordWins",
    "recordLosses",
    "winRate",
    "monitorPlayerName",
    "currentCharacter",
    "sessionPeakRating",
    "currentMrRank",
    "currentMrRankHome",
    "currentRatingLabel",
    "currentRating",
    "medianRatingLabel",
    "medianRating",
    "medianRatingSample",
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
    "optionsUpdateBadge",
    "maintenanceSettingsCard",
    "fontScaleInput",
    "fontScaleValue",
    "graphLabelScaleInput",
    "graphLabelScaleValue",
    "graphMatchCountInput",
    "opacityInput",
    "opacityValue",
    "fontFamilyInput",
    "fontStyleInput",
    "textColorInput",
    "pollIntervalInput",
    "friendOnlineNotificationsEnabledInput",
    "friendOnlineNotificationTimingAlwaysInput",
    "friendOnlineNotificationTimingGameOnlyInput",
    "friendOnlineNotificationGameExeNote",
    "friendOnlineNotificationSoundInput",
    "previewFriendOnlineNotificationSoundButton",
    "friendOnlineNotificationDurationInput",
    "friendOnlineNotificationDurationValue",
    "previewFriendOnlineNotificationButton",
    "friendOnlineNotificationOpacityInput",
    "friendOnlineNotificationOpacityValue",
    "friendOnlineNotificationVolumeInput",
    "friendOnlineNotificationVolumeValue",
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
    "currentAppVersion",
    "updateMessage",
    "updateProgress",
    "updateProgressBar",
    "notice",
    "languageInput",
    "initialLanguageLayer",
    "initialLanguageInput",
    "confirmInitialLanguageButton",
    "socialFriendsTab",
    "socialFollowingTab",
    "socialRefreshButton",
    "socialMonitoringStatus",
    "socialList",
    "socialEmpty",
    "socialError",
    "socialPreviousButton",
    "socialNextButton",
    "socialPageInfo",
    "historyPanel",
    "closeHistoryButton",
    "historyTargetCode",
    "selectHistoryTargetButton",
    "clearHistoryTargetButton",
    "historyTargetStatus",
    "fetchHistoryButton",
    "historyFetchState",
    "historyFetchProgress",
    "historyFetchProgressBar",
    "historyAcquisitionTitle",
    "historyLastUpdate",
    "historyDateFrom",
    "historyDateTo",
    "historyMatchType",
    "historyCharacter",
    "historyWinsLosses",
    "historyWinRate",
    "historyMaxStreak",
    "historyMaxRating",
    "historyPotentialLabel",
    "historyPotentialRating",
    "historyPotentialSample",
    "historyOpponentProfile",
    "historyOpponentProfileState",
    "historyOpponentProfileGrid",
    "historyOpponentMatchCharacter",
    "historyOpponentMatchRating",
    "historyOpponentRecord",
    "historyOpponentPotentialMr",
    "historyOpponentPotentialLp",
    "historyOpponentOtherCharacter",
    "historyOpponentOtherRating",
    "historyOpponentProfileAct",
    "historyOpponentProfileRetrieved",
    "historyCount",
    "historyResultChart",
    "historyEmpty",
    "historyRatingPeriod",
    "historyRatingDateMode",
    "historyRatingWeekPrevious",
    "historyRatingWeekNext",
    "historyRatingWeekLabel",
    "historyMrChart",
    "historyMrEmpty",
    "historyLpChart",
    "historyLpEmpty",
    "historyTableBody",
    "historyOpponentStatsBody",
    "historyOpponentStatsEmpty",
    "historyOpponentMatchesHeader",
    "historyOpponentMatchesSort",
    "historyOpponentMatchesSortIndicator",
    "historyOpponentWinRateHeader",
    "historyOpponentWinRateSort",
    "historyOpponentWinRateSortIndicator",
    "historyPreviousButton",
    "historyNextButton",
    "historyPageInfo",
    "recentHistoryBody",
    "recentHistoryRatingHeader",
    "recentHistoryEmpty",
  ].map((id) => [id, document.getElementById(id)]),
);

function showNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
}

function dateKeyForHistory(record) {
  const dateKeyForRecord = window.matchHistoryChartModel?.dateKeyForHistoryRecord;
  if (typeof dateKeyForRecord === "function") return dateKeyForRecord(record);
  const timestamp = Number(record?.playedAt ?? record?.uploadedAt ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatHistoryDate(record) {
  const timestamp = Number(record?.playedAt ?? record?.uploadedAt ?? 0);
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = window.matchHistoryChartModel?.historyTimeZone || "Asia/Tokyo";
  return date.toLocaleString(undefined, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function historyModeLabel(value) {
  if (value === "ranked") return t("ranked", "Ranked");
  if (value === "battleHub") return t("battleHub", "Battle Hub");
  if (value === "casual") return t("casual", "Casual");
  return value || "—";
}

function historyCharacterLabel(record, own = true) {
  const value = own ? record?.ownCharacterName : record?.opponentCharacterName;
  if (value) return String(value).toLocaleUpperCase();
  const id = own ? record?.characterId : record?.opponentCharacterId;
  return id ? `#${id}` : "—";
}

function historySelectedCharacterId(player = historyState.player) {
  const selected = String(elements.historyCharacter?.value ?? "all");
  if (/^\d+$/.test(selected)) {
    const selectedId = Number(selected);
    if (selectedId > 0) return selectedId;
  }
  return Number(player?.characterId) > 0 ? Number(player.characterId) : null;
}

function historyDerivedRecordsForRating(
  records,
  ratingType,
  player = historyState.player,
  characterId = historySelectedCharacterId(player),
) {
  const input = Array.isArray(records) ? records : [];
  const sourceRecords = Array.isArray(historyState.records) && historyState.records.length
    ? historyState.records
    : input;
  const targetCharacterId = Number(characterId) > 0 ? Number(characterId) : null;
  const derive = window.MatchHistoryCurrentRating?.deriveHistoryRatingSeries;
  const derived = typeof derive === "function"
    ? derive(sourceRecords, player, ratingType, {
        characterId: targetCharacterId,
      })
    : { records: sourceRecords };
  const valuesByReplayId = new Map(
    (derived.records ?? []).map((record) => [
      String(record?.replayId ?? ""),
      {
        value: record?.derivedOwnRating,
        type: record?.derivedRatingType,
      },
    ]),
  );
  return input.map((record) => {
    const replayId = String(record?.replayId ?? "");
    return valuesByReplayId.has(replayId)
      ? {
          ...record,
          derivedOwnRating: valuesByReplayId.get(replayId).value,
          derivedRatingType: valuesByReplayId.get(replayId).type,
        }
      : { ...record };
  });
}

function historyRatingValue(record, ratingType) {
  const normalizedType = String(ratingType || "").toUpperCase();
  const derivedType = String(record?.derivedRatingType || "").toUpperCase();
  if (
    derivedType !== normalizedType &&
    String(record?.ownRatingType || "").toUpperCase() !== normalizedType
  ) {
    return null;
  }
  const primaryNumber = Number(record?.derivedOwnRating ?? record?.ownRating);
  return Number.isFinite(primaryNumber) && primaryNumber > 0 ? primaryNumber : null;
}

function formatHistoryRating(ratingType, value) {
  const formatted = displayNumber.integer(value, "");
  return formatted ? `${ratingType || ""} ${formatted}`.trim() : "—";
}

function historyRatingDelta(record, records, player, { useCurrentRating = false } = {}) {
  const ratingType = String(record?.ownRatingType || "").toUpperCase();
  const rating = Number(record?.ownRating);
  if (!Number.isFinite(rating) || !["MR", "LP"].includes(ratingType)) return null;
  const characterId = Number(record?.characterId) || null;
  const playerCharacterId = Number(player?.characterId) || null;
  if (useCurrentRating && (playerCharacterId == null || playerCharacterId === characterId)) {
    const currentRating = Number(ratingType === "MR" ? player?.mr : player?.lp);
    if (Number.isFinite(currentRating) && currentRating > 0) {
      return Math.round(currentRating - rating);
    }
  }
  const timestamp = Number(record?.playedAt ?? record?.uploadedAt) || 0;
  const nextRecord = records
    .filter((candidate) =>
      String(candidate?.ownRatingType || "").toUpperCase() === ratingType &&
      (Number(candidate?.characterId) || null) === characterId &&
      Number(candidate?.playedAt ?? candidate?.uploadedAt) > timestamp &&
      Number.isFinite(Number(candidate?.ownRating)))
    .sort((a, b) => Number(a?.playedAt ?? a?.uploadedAt) - Number(b?.playedAt ?? b?.uploadedAt))[0];
  const nextRating = Number(nextRecord?.ownRating);
  return Number.isFinite(nextRating) ? Math.round(nextRating - rating) : null;
}

function filteredHistoryRecords() {
  const from = elements.historyDateFrom?.value || "";
  const to = elements.historyDateTo?.value || "";
  const mode = elements.historyMatchType?.value || "all";
  const character = elements.historyCharacter?.value || "all";
  const filterRecords = window.matchHistoryOpponentCharacterStats?.filterHistoryRecords;
  const filtered = typeof filterRecords === "function"
    ? filterRecords(
        historyState.records,
        { from, to, mode, character },
        dateKeyForHistory,
      )
    : [];
  return filtered
    .sort((a, b) => Number(b.uploadedAt) - Number(a.uploadedAt));
}

function historyResultChartModelFor(records) {
  return window.matchHistoryChartModel?.buildSevenDayResultChart(
    records.map((record) => ({
      dateKey: dateKeyForHistory(record),
      result: record.result,
    })),
  ) ?? { slotCount: 0, buckets: [] };
}

function drawHistoryResultChart(records, chartModel = historyResultChartModelFor(records)) {
  const canvas = elements.historyResultChart;
  if (!canvas) return chartModel;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return chartModel;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const ordered = chartModel?.buckets ?? [];
  if (!ordered.length) return chartModel;
  const padding = { top: 12, right: 14, bottom: 32, left: 32 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);

  const maximum = Math.max(1, ...ordered.map((bucket) => bucket.total));
  const tickStep = maximum <= 5 ? 1 : Math.ceil(maximum / 5);
  const axisMaximum = Math.ceil(maximum / tickStep) * tickStep;
  context.strokeStyle = "rgba(120, 190, 220, .18)";
  context.lineWidth = 1;
  context.fillStyle = "rgba(247,248,255,.68)";
  context.font = `10px ${fontStackFor(displaySettings.fontFamily)}`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let tick = 0; tick <= axisMaximum; tick += tickStep) {
    const y = padding.top + plotHeight - (tick / axisMaximum) * plotHeight;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(tick), padding.left - 6, y);
  }

  const slotWidth = plotWidth / Math.max(1, chartModel.slotCount || ordered.length);
  const barWidth = Math.max(5, Math.min(42, slotWidth * 0.62));
  ordered.forEach((bucket) => {
    const x =
      padding.left +
      bucket.dayIndex * slotWidth +
      (slotWidth - barWidth) / 2;
    let cursor = padding.top + plotHeight;
    for (const [count, color] of [
      [bucket.loss, "#668fcf"],
      [bucket.win, "#d76b82"],
      [bucket.draw, "#9aa7b2"],
    ]) {
      if (!count) continue;
      const segmentHeight = (count / axisMaximum) * plotHeight;
      cursor -= segmentHeight;
      context.fillStyle = color;
      context.fillRect(x, cursor, barWidth, segmentHeight);
      context.save();
      context.font = `800 10px ${fontStackFor(displaySettings.fontFamily)}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 3;
      context.strokeStyle = "rgba(4,7,18,.88)";
      context.fillStyle = "#f7f8ff";
      const labelY = cursor + segmentHeight / 2;
      context.strokeText(String(count), x + barWidth / 2, labelY);
      context.fillText(String(count), x + barWidth / 2, labelY);
      context.restore();
    }
    const [, month, day] = bucket.dateKey.split("-");
    const label = `${month}/${day}`;
    context.fillStyle = "rgba(247,248,255,.72)";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(label, x + barWidth / 2, padding.top + plotHeight + 7);
  });
  return chartModel;
}

function normalizeHistoryRatingDateMode(value) {
  return value === "all" ? "all" : "played";
}

function historyRatingPeriodModelFor(records) {
  const model = window.matchHistoryChartModel;
  const datedRecords = records.map((record) => ({ dateKey: dateKeyForHistory(record) }));
  const period = model?.buildHistoryRatingPeriod?.(datedRecords, historyRatingPeriod) ?? {
    mode: historyRatingPeriod.mode,
    weekOffset: historyRatingPeriod.weekOffset,
    startDateKey: "",
    endDateKey: "",
  };
  return {
    ...period,
    dateMode: normalizeHistoryRatingDateMode(historyRatingPeriod.dateMode),
  };
}

function formatHistoryPeriodDate(dateKey) {
  const [, month, day] = String(dateKey || "").split("-");
  return month && day ? `${month}/${day}` : "—";
}

function formatHistoryWeekLabel(startDateKey, endDateKey) {
  const [startYear, startMonth, startDay] = String(startDateKey || "").split("-");
  const [endYear, endMonth, endDay] = String(endDateKey || "").split("-");
  if (!startYear || !endYear || !startMonth || !endMonth || !startDay || !endDay) return "—";
  const start = `${startYear}/${startMonth}/${startDay}`;
  const end = startYear === endYear ? `${endMonth}/${endDay}` : `${endYear}/${endMonth}/${endDay}`;
  return `${start} - ${end}`;
}

function renderHistoryRatingPeriodControls(period) {
  if (elements.historyRatingPeriod) elements.historyRatingPeriod.value = period.mode;
  if (elements.historyRatingDateMode) elements.historyRatingDateMode.value = period.dateMode;
  const isWeek = period.mode === "week";
  for (const element of [elements.historyRatingWeekPrevious, elements.historyRatingWeekNext, elements.historyRatingWeekLabel]) {
    element?.classList.toggle("hidden", !isWeek);
  }
  if (elements.historyRatingWeekLabel) {
    elements.historyRatingWeekLabel.textContent = isWeek
      ? formatHistoryWeekLabel(period.startDateKey, period.endDateKey)
      : "";
  }
  if (elements.historyRatingWeekPrevious) {
    elements.historyRatingWeekPrevious.title = t("historyPeriodPrevious", "Previous week");
    elements.historyRatingWeekPrevious.setAttribute("aria-label", t("historyPeriodPrevious", "Previous week"));
  }
  if (elements.historyRatingWeekNext) {
    elements.historyRatingWeekNext.disabled = !isWeek || period.weekOffset >= 0;
    elements.historyRatingWeekNext.title = t("historyPeriodNext", "Next week");
    elements.historyRatingWeekNext.setAttribute("aria-label", t("historyPeriodNext", "Next week"));
  }
}

function renderHistoryRatingCharts(records) {
  const period = historyRatingPeriodModelFor(records);
  renderHistoryRatingPeriodControls(period);
  drawHistoryRatingChart(records, "MR", elements.historyMrChart, elements.historyMrEmpty, period);
  drawHistoryRatingChart(records, "LP", elements.historyLpChart, elements.historyLpEmpty, period);
}

function drawHistoryRatingChart(historyRecords, ratingType, canvas, emptyElement, period = { mode: "all", dateMode: "played" }) {
  if (!canvas) return;
  const model = window.matchHistoryChartModel;
  const player = historyState.player;
  const records = historyDerivedRecordsForRating(
    historyRecords,
    ratingType,
    player,
    historySelectedCharacterId(player),
  );
  const dateMode = normalizeHistoryRatingDateMode(period.dateMode);
  const hasFinitePointValue = (point) =>
    point?.value != null && point.value !== "" && Number.isFinite(Number(point.value));
  const allPoints = model?.buildHistoryRatingSeries
    ? model.buildHistoryRatingSeries(records, {
        period,
        dateMode,
        valueForRecord: (record) => historyRatingValue(record, ratingType),
        dateKeyForRecord: dateKeyForHistory,
        timestampForRecord: (record) => record?.playedAt ?? record?.uploadedAt,
      })
    : [...records]
      .filter((record) => historyRatingValue(record, ratingType) != null)
      .sort((a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt))
      .map((record, position) => ({
        dateKey: dateKeyForHistory(record),
        position,
        value: historyRatingValue(record, ratingType),
      }));
  const hasData = allPoints.some(hasFinitePointValue);
  if (emptyElement) emptyElement.classList.toggle("hidden", hasData);

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!hasData) return;

  const values = allPoints
    .filter(hasFinitePointValue)
    .map((point) => Number(point.value));
  const potentialRating = values.length >= 2
    ? window.MatchPotentialRating?.potentialRatingValue(values.slice(-20), ratingType) ?? null
    : null;
  const axisValues = Number.isFinite(potentialRating)
    ? [...values, potentialRating]
    : values;
  const axis = window.matchHistoryChartModel.buildHistoryRatingAxis(axisValues, ratingType);
  const axisMin = axis.minimum;
  const axisMax = axis.maximum;
  const tickValues = axis.ticks;
  const color = "#7ea7ff";
  const potentialColor = "#c783ff";
  const formatValue = (value) => displayNumber.integer(value);

  context.font = `9px ${fontStackFor(displaySettings.fontFamily)}`;
  const labelWidth = Math.max(
    0,
    ...tickValues.map((value) => context.measureText(formatValue(value)).width),
  );
  const padding = {
    top: 10,
    right: 8,
    bottom: 24,
    left: Math.max(44, Math.ceil(labelWidth) + 10),
  };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const maxPoints = Math.max(4, Math.floor(plotWidth / 8));
  const points = period.mode === "week"
    ? allPoints
    : window.matchHistoryChartModel?.thinHistoryPoints
      ? window.matchHistoryChartModel.thinHistoryPoints(allPoints, maxPoints)
      : allPoints;
  const lastPosition = Number(allPoints.at(-1)?.position ?? allPoints.length - 1);
  const xFor = (point, index) => {
    const position = Number.isFinite(Number(point?.position)) ? Number(point.position) : index;
    return lastPosition <= 0
      ? padding.left + plotWidth / 2
      : padding.left + (position / lastPosition) * plotWidth;
  };
  const yFor = (value) => padding.top + plotHeight - ((value - axisMin) / (axisMax - axisMin)) * plotHeight;

  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(247,248,255,.62)";
  context.strokeStyle = "rgba(126, 145, 220, .2)";
  context.lineWidth = 1;
  tickValues.forEach((value, index) => {
    const y = padding.top + (plotHeight * index) / Math.max(1, tickValues.length - 1);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(formatValue(value), padding.left - 5, y);
  });

  if (Number.isFinite(potentialRating)) {
    const potentialY = yFor(potentialRating);
    context.strokeStyle = potentialColor;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(padding.left, potentialY);
    context.lineTo(width - padding.right, potentialY);
    context.stroke();
    context.fillStyle = potentialColor;
    context.font = `800 8px ${fontStackFor(displaySettings.fontFamily)}`;
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(`POTENTIAL ${ratingType} ${formatValue(potentialRating)}`, width - padding.right - 3, potentialY - 2);
  }

  const finiteRuns = [];
  let currentRun = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (hasFinitePointValue(point)) currentRun.push({ point, index });
    else if (currentRun.length) {
      finiteRuns.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length) finiteRuns.push(currentRun);

  const areaGradient = context.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
  areaGradient.addColorStop(0, "rgba(126,167,255,.34)");
  areaGradient.addColorStop(1, "rgba(126,167,255,.025)");
  for (const run of finiteRuns) {
    context.beginPath();
    run.forEach(({ point, index }, runIndex) => {
      const x = xFor(point, index);
      const y = yFor(Number(point.value));
      if (runIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    const last = run.at(-1);
    const first = run[0];
    context.lineTo(xFor(last.point, last.index), padding.top + plotHeight);
    context.lineTo(xFor(first.point, first.index), padding.top + plotHeight);
    context.closePath();
    context.fillStyle = areaGradient;
    context.fill();

    context.strokeStyle = color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    run.forEach(({ point, index }, runIndex) => {
      const x = xFor(point, index);
      const y = yFor(Number(point.value));
      if (runIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  const labelIndexes = new Set();
  const labelCount = Math.min(points.length, 7);
  for (let labelIndex = 0; labelIndex < labelCount; labelIndex += 1) {
    labelIndexes.add(Math.round((labelIndex * (points.length - 1)) / Math.max(1, labelCount - 1)));
  }
  points.forEach((point, index) => {
    if (!labelIndexes.has(index)) return;
    context.fillStyle = "rgba(247,248,255,.66)";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(formatHistoryPeriodDate(point.dateKey), xFor(point, index), padding.top + plotHeight + 6);
  });

  const lastFinite = [...points].reverse().find(hasFinitePointValue);
  if (!lastFinite) return;
  const lastIndex = points.lastIndexOf(lastFinite);
  const lastX = xFor(lastFinite, lastIndex);
  const lastY = yFor(Number(lastFinite.value));
  context.beginPath();
  context.arc(lastX, lastY, 4, 0, Math.PI * 2);
  context.fillStyle = "#07101f";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = color;
  context.stroke();
}

function renderHistoryCharacters(records) {
  const select = elements.historyCharacter;
  if (!select) return;
  const selected = select.value || "all";
  const characters = [...new Map(
    records
      .filter((record) => record.characterId != null)
      .map((record) => [String(record.characterId), historyCharacterLabel(record)]),
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const allLabel = t("allCharacters", "All characters");
  select.replaceChildren(new Option(allLabel, "all"));
  for (const [value, label] of characters) select.append(new Option(label, value));
  select.value = characters.some(([value]) => value === selected) ? selected : "all";
}

function appendHistoryCell(
  row,
  value,
  { opponentUserCode = null, replayId = null } = {},
) {
  const cell = document.createElement("td");
  const normalizedReplayId = String(replayId ?? "").trim();
  if (normalizedReplayId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-replay-id";
    button.dataset.historyReplayId = normalizedReplayId;
    button.textContent = normalizedReplayId;
    button.title = `${normalizedReplayId} · ${t("copyReplayId", "リプレイIDをコピー")}`;
    cell.append(button);
    row.append(cell);
    return;
  }
  if (opponentUserCode && /^\d{4,12}$/.test(String(opponentUserCode))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-opponent-link";
    button.dataset.historyOpponentCode = String(opponentUserCode);
    button.textContent = value;
    button.title = `${value} · ${t("historyViewOpponent", "View this player's history")}`;
    cell.append(button);
  } else {
    cell.textContent = value;
    cell.title = value;
  }
  row.append(cell);
}

function historyRecordKey(record) {
  const replayId = String(record?.replayId ?? "").trim();
  if (replayId) return `replay:${replayId}`;
  return [
    Number(record?.uploadedAt ?? 0) || 0,
    Number(record?.playedAt ?? 0) || 0,
    String(record?.opponentUserCode ?? ""),
    Number(record?.opponentCharacterId ?? 0) || 0,
  ].join(":");
}

function historyOpponentInsightKey(record) {
  const profileId = String(record?.opponentUserCode ?? "").trim();
  const characterId = Number(record?.opponentCharacterId) || 0;
  return profileId && characterId > 0 ? `${profileId}:${characterId}` : "";
}

function formatOpponentProfileRating(value, ratingType) {
  const normalizedType = String(ratingType ?? "").toUpperCase();
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || !["MR", "LP"].includes(normalizedType)) return "—";
  return `${normalizedType} ${displayNumber.integer(number, "")}`;
}

function formatOpponentProfileRetrievedAt(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "—";
  try {
    return new Intl.DateTimeFormat(displaySettings?.locale || undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function historyInsightFromRecord(record) {
  const snapshots = record?.opponentInsightSnapshots;
  if (!snapshots || typeof snapshots !== "object") return null;
  const first = Object.values(snapshots).find(
    (snapshot) =>
      (Number(snapshot?.wins) || 0) +
        (Number(snapshot?.losses) || 0) +
        (Number(snapshot?.draws) || 0) >
      0,
  ) ?? snapshots.MR ?? snapshots.LP ?? null;
  if (!first) return null;
  const rating = (type) => {
    const snapshot = snapshots[type];
    return {
      potential: snapshot?.status === "ready" && snapshot.complete === true
        ? snapshot.potential
        : null,
    };
  };
  return {
    matches: ["wins", "losses", "draws"].reduce(
      (sum, key) => sum + (Number(first[key]) || 0),
      0,
    ),
    wins: Number(first.wins) || 0,
    losses: Number(first.losses) || 0,
    draws: Number(first.draws) || 0,
    ratings: { MR: rating("MR"), LP: rating("LP") },
  };
}

function renderHistoryOpponentProfile(record = historyOpponentProfileState.record) {
  const card = elements.historyOpponentProfile;
  if (!card) return;
  const hasRecord = Boolean(record);
  card.classList.toggle("hidden", !hasRecord);
  if (!hasRecord) return;

  const context = historyOpponentProfileState.context ?? null;
  const status = historyOpponentProfileState.status;
  const stateText = status === "loading"
    ? t("historyOpponentProfileLoading", "Loading official profile reference…")
    : status === "error"
      ? t("historyOpponentProfileUnavailable", "Official profile reference unavailable")
      : status === "empty"
        ? t("historyOpponentProfileEmpty", "No official profile reference data")
        : "";
  if (elements.historyOpponentProfileState) {
    elements.historyOpponentProfileState.textContent = stateText;
    elements.historyOpponentProfileState.className = `history-opponent-profile-state ${status}`;
  }

  if (elements.historyOpponentMatchCharacter) {
    elements.historyOpponentMatchCharacter.textContent = historyCharacterLabel(record, false);
  }
  if (elements.historyOpponentMatchRating) {
    elements.historyOpponentMatchRating.textContent = formatHistoryRating(
      record.opponentRatingType,
      record.opponentRating,
    );
  }

  // A persisted replay-keyed snapshot is authoritative for this card. Never
  // fall back to a current profile value after a historical snapshot exists.
  const insight = historyInsightFromRecord(record) ?? context?.opponentInsight ?? null;
  const wins = Number(insight?.wins) || 0;
  const losses = Number(insight?.losses) || 0;
  const draws = Number(insight?.draws) || 0;
  const matches = Number(insight?.matches) || 0;
  if (elements.historyOpponentRecord) {
    elements.historyOpponentRecord.textContent = matches
      ? `${wins}W / ${losses}L / ${draws}D (${matches}match)`
      : "—";
  }

  const potentialMr = insight?.ratings?.MR?.potential;
  const potentialLp = insight?.ratings?.LP?.potential;
  if (elements.historyOpponentPotentialMr) {
    elements.historyOpponentPotentialMr.textContent = formatOpponentProfileRating(
      potentialMr,
      "MR",
    );
  }
  if (elements.historyOpponentPotentialLp) {
    elements.historyOpponentPotentialLp.textContent = formatOpponentProfileRating(
      potentialLp,
      "LP",
    );
  }

  const other = context?.otherCharacter ?? null;
  if (elements.historyOpponentOtherCharacter) {
    elements.historyOpponentOtherCharacter.textContent = other?.characterDisplayName || "—";
  }
  if (elements.historyOpponentOtherRating) {
    elements.historyOpponentOtherRating.textContent = other
      ? formatOpponentProfileRating(other.rating, other.ratingType)
      : "—";
  }
  if (elements.historyOpponentProfileAct) {
    const actLabel = context?.act?.id || context?.act?.label || "—";
    elements.historyOpponentProfileAct.textContent = `ACT ${actLabel}`;
  }
  if (elements.historyOpponentProfileRetrieved) {
    elements.historyOpponentProfileRetrieved.textContent = context?.retrievedAt
      ? `${t("historyOpponentRetrieved", "RETRIEVED")} ${formatOpponentProfileRetrievedAt(context.retrievedAt)}`
      : "—";
  }
  fitManagementScoreValues();
}

function selectHistoryRecord(record, { forceRefresh = false } = {}) {
  const nextRecord = record ?? null;
  const nextRecordKey = nextRecord ? historyRecordKey(nextRecord) : null;
  if (
    nextRecord &&
    nextRecordKey === selectedHistoryRecordKey &&
    historyOpponentProfileState.record &&
    ["loading", "ready"].includes(historyOpponentProfileState.status) &&
    !forceRefresh
  ) {
    renderHistoryOpponentProfile(nextRecord);
    return;
  }
  selectedHistoryRecordKey = nextRecordKey;
  const requestToken = ++historyOpponentProfileRequestToken;
  historyOpponentProfileState = {
    status: nextRecord ? "loading" : "idle",
    recordKey: selectedHistoryRecordKey,
    record: nextRecord,
    context: null,
  };
  renderHistoryOpponentProfile(nextRecord);
  if (!nextRecord) return;

  const profileId = String(nextRecord.opponentUserCode ?? "").trim();
  const characterId = Number(nextRecord.opponentCharacterId) || null;
  if (!api.getHistoryOpponentContext || !/^\d{4,12}$/.test(profileId) || characterId == null) {
    historyOpponentProfileState = {
      ...historyOpponentProfileState,
      status: "empty",
    };
    renderHistoryOpponentProfile(nextRecord);
    return;
  }

  void api.getHistoryOpponentContext({
    profileId,
    opponentUserCode: profileId,
    characterId,
    characterDisplayName: nextRecord.opponentCharacterName,
    historyOwnerProfileId: historyState?.profileId,
    replayId: nextRecord.replayId,
    selectedRecord: nextRecord,
    forceRefresh,
  }).then((result) => {
    if (requestToken !== historyOpponentProfileRequestToken || selectedHistoryRecordKey !== historyRecordKey(nextRecord)) return;
    if (!result?.ok) throw new Error(result?.error || "PROFILE_REFERENCE_FAILED");
    historyOpponentProfileState = {
      ...historyOpponentProfileState,
      status: result.data?.status || "empty",
      context: result.data ?? null,
    };
    const insightKey = historyOpponentInsightKey(nextRecord);
    if (insightKey && result.data) historyOpponentInsightCache.set(insightKey, result.data);
    renderHistoryOpponentProfile(nextRecord);
    renderHistoryState();
  }).catch(() => {
    if (requestToken !== historyOpponentProfileRequestToken || selectedHistoryRecordKey !== historyRecordKey(nextRecord)) return;
    historyOpponentProfileState = {
      ...historyOpponentProfileState,
      status: "error",
      context: null,
    };
    const insightKey = historyOpponentInsightKey(nextRecord);
    if (insightKey) historyOpponentInsightCache.delete(insightKey);
    renderHistoryOpponentProfile(nextRecord);
    renderHistoryState();
  });
}

function renderHistoryTable(records) {
  const body = elements.historyTableBody;
  if (!body) return;
  body.replaceChildren();
  for (const record of records) {
    const row = document.createElement("tr");
    const recordKey = historyRecordKey(record);
    row.dataset.historyRecordKey = recordKey;
    row.classList.toggle("history-row-selected", selectedHistoryRecordKey === recordKey);
    row.setAttribute("aria-selected", String(selectedHistoryRecordKey === recordKey));
    row.tabIndex = 0;
    const result = record.result === "win" ? "W" : record.result === "loss" ? "L" : record.result === "draw" ? "D" : "—";
    const cells = [
      formatHistoryDate(record),
      result,
      historyModeLabel(record.matchType),
      historyCharacterLabel(record),
      formatHistoryRating(record.ownRatingType, record.ownRating),
      record.opponentName || "—",
      historyCharacterLabel(record, false),
      formatHistoryRating(record.opponentRatingType, record.opponentRating),
      String(record.replayId ?? "").trim() || "—",
    ];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) cell.className = result === "W" ? "result-win" : result === "L" ? "result-loss" : "result-draw";
      if (index === 5) {
        appendHistoryCell(row, value, { opponentUserCode: record.opponentUserCode });
        row.lastElementChild.className = cell.className;
      } else if (index === 8) {
        appendHistoryCell(row, value, { replayId: record.replayId });
      } else {
        cell.textContent = value;
        cell.title = value;
        row.append(cell);
      }
    });
    body.append(row);
  }
}

async function copyHistoryReplayId(replayId) {
  const normalizedReplayId = String(replayId ?? "").trim();
  if (!normalizedReplayId) return;
  try {
    await unwrap(api.copyText(normalizedReplayId));
    showNotice(t("replayIdCopied", "リプレイIDをコピーしました"), "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function renderRecentHistoryPreview(records) {
  const body = elements.recentHistoryBody;
  if (!body) return;
  const recent = [...records]
    .sort((a, b) => Number(b.uploadedAt) - Number(a.uploadedAt))
    .slice(0, RECENT_HISTORY_PREVIEW_LIMIT);
  const playerRatingType = historyState.player?.mr != null
    ? "MR"
    : historyState.player?.lp != null
      ? "LP"
      : null;
  const latestHistoryRatingType = recent
    .map((record) => String(record?.ownRatingType || "").toUpperCase())
    .find((ratingType) => ["MR", "LP"].includes(ratingType));
  if (elements.recentHistoryRatingHeader) {
    elements.recentHistoryRatingHeader.textContent = playerRatingType || latestHistoryRatingType || "MR / LP";
  }
  body.replaceChildren();
  for (const [index, record] of recent.entries()) {
    const result = record.result === "win" ? "W" : record.result === "loss" ? "L" : record.result === "draw" ? "D" : "—";
    const ratingDelta = historyRatingDelta(record, records, historyState.player, {
      useCurrentRating: index === 0,
    });
    const row = document.createElement("tr");
    const values = [
      formatHistoryDate(record),
      result,
      historyModeLabel(record.matchType),
      historyCharacterLabel(record, false),
      record.opponentName || "—",
      ratingDelta == null ? "—" : `${ratingDelta >= 0 ? "+" : ""}${ratingDelta}`,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) {
        cell.className = result === "W" ? "result-win" : result === "L" ? "result-loss" : "result-draw";
      }
      if (index === 4) {
        appendHistoryCell(row, value, { opponentUserCode: record.opponentUserCode });
        return;
      }
      if (index === 5 && ratingDelta != null) {
        cell.classList.add(ratingDelta >= 0 ? "rating-positive" : "rating-negative");
      }
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  }
  elements.recentHistoryEmpty?.classList.toggle("hidden", recent.length > 0);
}

function selectHistoryMaximumRating(records) {
  const typedRatings = (type) => records
    .filter((record) => String(record.ownRatingType || "").toUpperCase() === type)
    .map((record) => Number(record.ownRating))
    .filter(Number.isFinite);
  // MR and LP use different numeric scales. Prefer the MR series whenever
  // the filtered period contains one; fall back to LP only when no MR match
  // is present, instead of comparing the two scales directly.
  const mrRatings = typedRatings("MR");
  if (mrRatings.length) return Math.max(...mrRatings);
  const lpRatings = typedRatings("LP");
  if (lpRatings.length) return Math.max(...lpRatings);
  return null;
}

function selectHistoryPotentialRating(records, player = historyState.player) {
  const characterId = historySelectedCharacterId(player);
  const ratingType = player?.mr != null
    ? "MR"
    : player?.lp != null
      ? "LP"
      : [...records]
          .filter((record) => record.matchType === "ranked")
          .sort((a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt))
          .at(-1)?.ownRatingType ?? "MR";
  const ordered = historyDerivedRecordsForRating(records, ratingType, player, characterId)
    .filter(
      (record) =>
        record.matchType === "ranked" &&
        historyRatingValue(record, ratingType) != null &&
        (characterId == null || Number(record.characterId) === characterId),
    )
    .sort((a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt));
  const values = ordered
    // Use the same display-only derived value as the history graph and the
    // management/overlay POTENTIAL calculation.  ownRating is the immutable
    // match-time snapshot and may not include the final official profile
    // rating applied to the terminal point.
    .map((record) => Number(historyRatingValue(record, ratingType)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-20);
  if (elements.historyPotentialLabel) {
    elements.historyPotentialLabel.textContent = `${t("potential", "POTENTIAL")} ${ratingType}`;
  }
  if (values.length < 2) {
    return { ratingType, value: null, sampleCount: values.length };
  }
  const value = window.MatchPotentialRating?.potentialRatingValue(values, ratingType) ?? null;
  return { ratingType, value, sampleCount: values.length };
}

function renderHistoryFetchStatus() {
  const nextAllowedAt = Number(historyState.nextAllowedAt) || 0;
  const cooldown = nextAllowedAt
    ? Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000))
    : Math.max(0, Number(historyState.cooldownSeconds) || 0);
  const fetchSummary = historyState.fetchSummary && typeof historyState.fetchSummary === "object"
    ? historyState.fetchSummary
    : null;
  const canFetch = Boolean(historyState.authenticated) &&
    !historyState.fetching &&
    (nextAllowedAt ? cooldown <= 0 : Boolean(historyState.canFetch));
  elements.fetchHistoryButton.disabled = !canFetch;
  elements.fetchHistoryButton.textContent = historyState.fetching
    ? t("historyFetching", "Loading…")
    : t("fetchHistory", "Import 100 matches");
  elements.historyFetchState.classList.toggle("loading", Boolean(historyState.fetching));
  elements.historyFetchState.classList.toggle(
    "complete",
    !historyState.fetching && fetchSummary?.status === "complete",
  );
  elements.historyFetchState.classList.toggle(
    "error",
    !historyState.fetching && fetchSummary?.status === "error",
  );
  if (elements.historyAcquisitionTitle) {
    elements.historyAcquisitionTitle.textContent = historyState.fetching
      ? "ACQUIRING MATCHES"
      : "MATCH HISTORY STATUS";
  }
  const completedPages = Math.max(
    0,
    Number(historyState.fetchCompletedPages ?? historyState.fetchPage) || 0,
  );
  const maxPages = Math.max(1, Number(historyState.fetchMaxPages) || 10);
  const pageProgress = historyState.fetching
    ? (Math.min(maxPages, completedPages) / maxPages) * 100
    : 0;
  const fetchProgress = historyState.fetching ? Math.min(100, pageProgress) : 0;
  elements.historyFetchProgress?.classList.toggle("active", Boolean(historyState.fetching));
  if (elements.historyFetchProgressBar) {
    elements.historyFetchProgressBar.style.width = `${fetchProgress}%`;
  }
  if (elements.historyLastUpdate) {
    const lastFetchedAt = Number(historyState.lastFetchedAt) || 0;
    if (!lastFetchedAt) {
      elements.historyLastUpdate.textContent = "LAST UPDATE: —";
    } else {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - lastFetchedAt) / 1000));
      const relative = elapsedSeconds < 60
        ? `${elapsedSeconds}s AGO`
        : elapsedSeconds < 3600
          ? `${Math.floor(elapsedSeconds / 60)}m AGO`
          : new Date(lastFetchedAt).toLocaleString(displaySettings?.locale || undefined);
      elements.historyLastUpdate.textContent = `LAST UPDATE: ${relative}`;
    }
  }
  elements.historyFetchState.textContent = historyState.fetching
    ? t("historyFetchProgress", "Loading: {completed}/{max} pages · {count} fetched")
      .replace("{completed}", String(completedPages))
      .replace("{max}", String(maxPages))
      .replace("{count}", String(historyState.fetchedCount || 0))
    : fetchSummary?.status === "complete"
      ? (Number(fetchSummary.fetchedCount) > 0
        ? t("historyFetchComplete", "Import complete: {count} matches ({pages} pages)")
          .replace("{count}", String(Number(fetchSummary.fetchedCount) || 0))
          .replace("{pages}", String(Number(fetchSummary.pages) || Number(fetchSummary.completedPages) || 0))
        : t("historyFetchCompleteEmpty", "Import complete: no matches"))
    : fetchSummary?.status === "error"
      ? t("historyFetchPartial", "Import stopped: {count} matches ({pages} pages)")
        .replace("{count}", String(Number(fetchSummary.fetchedCount) || 0))
        .replace("{pages}", String(Number(fetchSummary.pages) || Number(fetchSummary.completedPages) || 0))
    : historyState.viewingOther && historyState.polling
      ? t("historyAutoUpdating", "Automatic update: every {seconds}s").replace(
        "{seconds}",
        String(historyState.pollIntervalSeconds ?? "--"),
      )
      : historyState.viewingOther && historyState.pollStopReason
        ? t("historyAutoStopped", "Automatic update stopped after inactivity")
        : !historyState.authenticated
          ? t("historyFetchUnavailable", "Log in to import match history")
          : canFetch
            ? t("historyFetchReady", "Ready (one request per 10 minutes)")
            : t("historyFetchCooldown", "Available again in {seconds}s")
              .replace("{seconds}", String(cooldown));
}

function renderOpponentCharacterStats(records) {
  const body = elements.historyOpponentStatsBody;
  if (!body) return;
  const statsModel = window.matchHistoryOpponentCharacterStats;
  const buildStats = statsModel?.buildOpponentCharacterStats;
  const stats = typeof buildStats === "function" ? buildStats(records) : [];
  const sortedStats = typeof statsModel?.sortOpponentCharacterStats === "function"
    ? statsModel.sortOpponentCharacterStats(stats, historyOpponentSort)
    : stats;
  body.replaceChildren();
  for (const entry of sortedStats) {
    const row = document.createElement("tr");
    const character = document.createElement("td");
    character.textContent = entry.label
      ? String(entry.label).toLocaleUpperCase()
      : `#${entry.characterId}`;
    const matches = document.createElement("td");
    matches.textContent = String(entry.matches);
    const result = document.createElement("td");
    const wins = document.createElement("span");
    wins.className = "history-matchup-wins";
    wins.textContent = String(entry.wins);
    const separator = document.createTextNode(" - ");
    const losses = document.createElement("span");
    losses.className = "history-matchup-losses";
    losses.textContent = String(entry.losses);
    result.append(wins, separator, losses);
    const winRate = document.createElement("td");
    const percentage = Math.max(0, Math.min(100, Number(entry.winRate) || 0));
    winRate.className = `history-matchup-win-rate ${percentage >= 50 ? "win-rate-pass" : "win-rate-fail"}`;
    winRate.style.setProperty("--matchup-win-rate", `${percentage}%`);
    winRate.textContent = `${percentage.toFixed(1)}%`;
    row.append(character, matches, result, winRate);
    body.append(row);
  }
  elements.historyOpponentStatsEmpty?.classList.toggle("hidden", sortedStats.length > 0);
  const matchesActive = historyOpponentSort.key === "matches";
  const winRateActive = historyOpponentSort.key === "winRate";
  const sortIndicator = historyOpponentSort.direction === "asc" ? "▲" : "▼";
  if (elements.historyOpponentMatchesSortIndicator) {
    elements.historyOpponentMatchesSortIndicator.textContent =
      matchesActive ? sortIndicator : "";
  }
  if (elements.historyOpponentWinRateSortIndicator) {
    elements.historyOpponentWinRateSortIndicator.textContent =
      winRateActive ? sortIndicator : "";
  }
  elements.historyOpponentMatchesHeader?.setAttribute(
    "aria-sort",
    matchesActive ? (historyOpponentSort.direction === "asc" ? "ascending" : "descending") : "none",
  );
  elements.historyOpponentWinRateHeader?.setAttribute(
    "aria-sort",
    winRateActive ? (historyOpponentSort.direction === "asc" ? "ascending" : "descending") : "none",
  );
}

function renderHistoryState(nextState = historyState) {
  historyState = nextState || { records: [], canFetch: false, authenticated: false, cooldownSeconds: 0 };
  const allRecords = Array.isArray(historyState.records) ? historyState.records : [];
  if (elements.historyTargetCode && document.activeElement !== elements.historyTargetCode) {
    elements.historyTargetCode.value = historyState.player?.userCode ?? "";
  }
  if (elements.historyTargetStatus) {
    const player = historyState.player;
    elements.historyTargetStatus.textContent = !player
      ? t("historyFetchUnavailable", "Log in to select a player")
      : historyState.viewingOther
        ? `${t("historyViewing", "Viewing")}: ${player.name} (${player.userCode})`
        : t("historyViewingSelf", "Viewing your player");
  }
  if (elements.clearHistoryTargetButton) {
    elements.clearHistoryTargetButton.disabled = !historyState.viewingOther;
  }
  renderHistoryCharacters(allRecords);
  renderRecentHistoryPreview(allRecords);
  const records = filteredHistoryRecords();
  const wins = records.filter((record) => record.result === "win").length;
  const losses = records.filter((record) => record.result === "loss").length;
  const rate = wins + losses ? (wins / (wins + losses)) * 100 : 0;
  let maxStreak = 0;
  let streak = 0;
  [...records].sort((a, b) => Number(a.uploadedAt) - Number(b.uploadedAt)).forEach((record) => {
    streak = record.result === "win" ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  });
  elements.historyWinsLosses.textContent = `${wins} - ${losses}`;
  elements.historyWinRate.textContent = `${rate.toFixed(1)}%`;
  elements.historyMaxStreak.textContent = String(maxStreak);
  const maximumRating = selectHistoryMaximumRating(records);
  elements.historyMaxRating.textContent = maximumRating == null ? "—" : String(maximumRating);
  const potential = selectHistoryPotentialRating(records);
  elements.historyPotentialRating.textContent =
    potential.value == null
      ? "—"
      : Number.isInteger(potential.value)
        ? String(potential.value)
        : potential.value.toFixed(1);
  if (elements.historyPotentialSample) {
    elements.historyPotentialSample.textContent = potential.sampleCount
      ? `(${potential.sampleCount} ${t("matchUnit", "Match")})`
      : "";
  }
  const resultChart = historyResultChartModelFor(records);
  drawHistoryResultChart(records, resultChart);
  const displayedMatchCount = (resultChart?.buckets ?? [])
    .reduce((total, bucket) => total + bucket.total, 0);
  elements.historyCount.textContent = `${displayedMatchCount} ${t("matches", "MATCHES")}`;
  elements.historyEmpty.classList.toggle("hidden", records.length > 0);
  renderHistoryRatingCharts(records);
  renderOpponentCharacterStats(records);
  const totalPages = Math.ceil(records.length / HISTORY_PAGE_SIZE);
  historyPage = totalPages ? Math.min(historyPage, totalPages - 1) : 0;
  const pageRecords = records.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE,
  );
  const selectedRecord = selectedHistoryRecordKey
    ? records.find((record) => historyRecordKey(record) === selectedHistoryRecordKey) ?? null
    : null;
  if (selectedHistoryRecordKey && !selectedRecord) {
    selectedHistoryRecordKey = null;
    historyOpponentProfileRequestToken += 1;
    historyOpponentProfileState = {
      status: "idle",
      recordKey: null,
      record: null,
      context: null,
    };
    renderHistoryOpponentProfile(null);
  } else if (selectedRecord) {
    historyOpponentProfileState = {
      ...historyOpponentProfileState,
      record: selectedRecord,
    };
    renderHistoryOpponentProfile(selectedRecord);
  } else {
    renderHistoryOpponentProfile(null);
  }
  renderHistoryTable(pageRecords);
  if (elements.historyPageInfo) {
    elements.historyPageInfo.textContent = t("historyPage", "Page {current} / {total}")
      .replace("{current}", String(totalPages ? historyPage + 1 : 0))
      .replace("{total}", String(totalPages));
  }
  if (elements.historyPreviousButton) {
    elements.historyPreviousButton.disabled = historyPage <= 0;
  }
  if (elements.historyNextButton) {
    elements.historyNextButton.disabled = !totalPages || historyPage >= totalPages - 1;
  }
  renderHistoryFetchStatus();
  fitManagementScoreValues();
}

function scheduleHistoryRender(nextState = historyState, { resetPage = false } = {}) {
  const previousProfileId = historyState?.profileId ?? null;
  historyState = nextState || { records: [], canFetch: false, authenticated: false, cooldownSeconds: 0 };
  const nextProfileId = historyState?.profileId ?? null;
  if (previousProfileId !== nextProfileId) historyOpponentInsightCache.clear();
  pendingHistoryRenderState = historyState;
  pendingHistoryPageReset = pendingHistoryPageReset || resetPage ||
    previousProfileId !== nextProfileId;
  if (!historyPanelOpen) {
    const records = Array.isArray(historyState.records) ? historyState.records : [];
    renderRecentHistoryPreview(records);
    if (pendingHistoryPageReset) historyPage = 0;
    pendingHistoryPageReset = false;
    return;
  }
  if (historyRenderFrame != null) return;
  historyRenderFrame = requestAnimationFrame(() => {
    historyRenderFrame = null;
    if (pendingHistoryPageReset) historyPage = 0;
    pendingHistoryPageReset = false;
    const latest = pendingHistoryRenderState;
    pendingHistoryRenderState = null;
    renderHistoryState(latest);
  });
}

function setHistoryPanelOpen(open) {
  historyPanelOpen = Boolean(open);
  elements.historyPanel.classList.toggle("hidden", !historyPanelOpen);
  elements.historyPanel.setAttribute("aria-hidden", String(!historyPanelOpen));
  if (historyPanelOpen) renderHistoryState();
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

function fitScoreValue(element, minimumSize = 8) {
  if (!element) return;
  element.style.removeProperty("font-size");

  // Custom fonts and italics can be wider than the default condensed face.
  // Keep the card width fixed and reduce only the value when it overflows.
  requestAnimationFrame(() => {
    if (!element.isConnected || element.clientWidth <= 0) return;
    const baseSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
    let size = baseSize;
    while (size > minimumSize && element.scrollWidth > element.clientWidth + 1) {
      size = Math.max(minimumSize, size - 0.5);
      element.style.fontSize = `${size}px`;
    }
  });
}

function fitManagementScoreValues() {
  const recordValues = document.querySelector(
    ".telemetry-panel .record-values",
  );
  for (const element of [
    recordValues,
    elements.winRate,
    elements.currentRating,
    elements.ratingDelta,
    elements.medianRating,
    elements.currentCharacter,
    elements.sessionPeakRating,
    elements.currentMrRank,
    elements.historyWinsLosses,
    elements.historyWinRate,
    elements.historyMaxStreak,
    elements.historyMaxRating,
    elements.historyPotentialRating,
    elements.historyOpponentMatchRating,
    elements.historyOpponentRecord,
    elements.historyOpponentPotentialMr,
    elements.historyOpponentPotentialLp,
    elements.historyOpponentOtherRating,
  ]) {
    fitScoreValue(element);
  }
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

function drawManagementChart(
  history,
  matchCount,
  ratingType = "MR",
  potentialRating = null,
  matchStart = 0,
) {
  const canvas = elements.managementRatingChart;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  // Keep the graph's visual proportion stable when the management panel is
  // resized.  The canvas may grow with its container, but the plot itself is
  // drawn inside a centered 4:1 frame matching the horizontal dashboard and
  // uses only unavoidable letterboxing instead of stretching the line graph.
  const chartAspectRatio = 4;
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

  const width = chartWidth;
  const height = chartHeight;
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
    Math.max(0.75, Number(displaySettings.graphLabelScale ?? 1.3)),
  );
  const labelFontSize = 9 * labelScale;
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

  const fontStyle = FONT_STYLE_VALUES.has(displaySettings.fontStyle)
    ? `${displaySettings.fontStyle} `
    : "";
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor(
    displaySettings.fontFamily,
  )}`;
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
  context.fillStyle = "rgba(174,184,218,.72)";
  context.lineWidth = 1;
  const firstLpLabelIndex = Math.max(0, ticks.length - 4);
  ticks.forEach((tick, tickIndex) => {
    const y = yFor(tick);
    context.strokeStyle = "rgba(255,255,255,.1)";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    if (
      !isLp || tickIndex >= firstLpLabelIndex
    ) {
      context.fillStyle = "rgba(174,184,218,.72)";
      context.fillText(displayNumber.integer(tick), left - 7, y);
    }
  });
  values.forEach((value, index) => {
    const x = xFor(index);
    context.strokeStyle = "rgba(255,255,255,.05)";
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, height - bottom);
    context.stroke();
  });

  context.strokeStyle = "rgba(126, 167, 255, 0.9)";
  context.lineWidth = 1.15;
  context.beginPath();
  context.moveTo(left, plotBottom);
  context.lineTo(width - right, plotBottom);
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
    context.lineTo(width - right, potentialY);
    context.stroke();
    context.shadowBlur = 0;
    context.font = `${fontStyle}${Math.max(8, labelFontSize - 1)}px ${fontStackFor(
      displaySettings.fontFamily,
    )}`;
    context.fillStyle = "#d6a4ff";
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(
      `${t("potential", "POTENTIAL")} ${ratingType} ${displayNumber.integer(potential)}`,
      width - right,
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
  context.font = `${fontStyle}${labelFontSize}px ${fontStackFor(
    displaySettings.fontFamily,
  )}`;
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
  areaGradient.addColorStop(0, "rgba(126,167,255,.34)");
  areaGradient.addColorStop(1, "rgba(126,167,255,.025)");
  context.fillStyle = areaGradient;
  context.fill(areaPath);

  context.strokeStyle = "#7ea7ff";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowBlur = 9;
  context.shadowColor = "rgba(126,167,255,.78)";
  context.stroke(linePath);
  context.shadowBlur = 0;
  context.fillStyle = "#7ea7ff";
  values.forEach((value, index) => {
    context.beginPath();
    context.arc(xFor(index), yFor(value), 2.4, 0, Math.PI * 2);
    context.fill();
  });
  const lastX = xFor(values.length - 1);
  const lastY = yFor(values[values.length - 1]);
  context.strokeStyle = "#c7d5ff";
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
  context.stroke();
}

function graphSeriesForState(state, matchType = "ranked") {
  const configuredLimit = [0, 20, 50, 100].includes(
    Number(displaySettings.graphMatchCount),
  )
    ? Number(displaySettings.graphMatchCount)
    : 20;
  const supplied = state?.graphData?.[matchType];
  const ratingType = supplied?.ratingType || resolveRatingType(state);
  const selected = state?.stats?.[matchType] ?? {};
  const rawHistory = Array.isArray(supplied?.values)
    ? supplied.values.filter(Number.isFinite)
    : historyForDisplay(
        selected,
        Number.isFinite(Number(selected.matchCount))
          ? Math.max(0, Math.trunc(Number(selected.matchCount)))
          : Number(selected.wins ?? 0) + Number(selected.losses ?? 0),
      );
  const sourceHistory = ratingType === "LP"
    ? rawHistory.filter((value) => value > 0)
    : rawHistory;
  const rawMatchCount = Number.isFinite(Number(supplied?.matchCount))
    ? Math.max(0, Math.trunc(Number(supplied.matchCount)))
    : Number.isFinite(Number(selected.matchCount))
      ? Math.max(0, Math.trunc(Number(selected.matchCount)))
      : Math.max(0, sourceHistory.length - 1);
  const sourceMatchCount = ratingType === "LP"
    ? Math.min(rawMatchCount, Math.max(0, sourceHistory.length - 1))
    : rawMatchCount;
  const availableMatches = Math.min(
    sourceMatchCount,
    Math.max(0, sourceHistory.length - 1),
  );
  const matchCount = configuredLimit === 0
    ? availableMatches
    : Math.min(configuredLimit, availableMatches);
  if (!matchCount) {
    return {
      history: sourceHistory,
      matchCount: 0,
      matchStart: 0,
      ratingType,
    };
  }
  const start = Math.max(0, sourceHistory.length - matchCount - 1);
  return {
    history: sourceHistory.slice(start, start + matchCount + 1),
    matchCount,
    matchStart: Math.max(0, sourceMatchCount - matchCount),
    ratingType,
  };
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

function historyForDisplay(selected, total) {
  const history = Array.isArray(selected?.ratingHistory)
    ? selected.ratingHistory.filter(Number.isFinite)
    : [];
  if (history.length >= 2 || total <= 0) return history;
  const initial = Number(selected?.initialRating);
  const current = Number(selected?.currentRating);
  if (
    selected?.initialRating != null &&
    selected?.currentRating != null &&
    Number.isFinite(initial) &&
    Number.isFinite(current)
  ) {
    return [initial, current];
  }
  return history;
}

function renderManagementChart(state, { immediate = false } = {}) {
  // Output visibility settings belong only to the Electron stats window and
  // OBS overlay. The management monitor remains a complete reference even
  // when the output graph is disabled.
  elements.managementChartPanel.classList.remove("hidden");

  const matchType = displaySettings.matchType ?? "ranked";
  const series = graphSeriesForState(state, matchType);
  const ratingType = series.ratingType || resolveRatingType(state);
  const history = series.history;
  const graphMatchCount = series.matchCount;
  const hasGraphData =
    matchType === "ranked" && graphMatchCount > 0 && history.length >= 2;
  elements.managementRatingChart.classList.toggle("hidden", !hasGraphData);
  elements.managementChartEmpty.classList.toggle("hidden", hasGraphData);
  elements.managementChartEmpty.textContent =
    matchType === "ranked"
      ? t("graphEmptyRanked", "ランクマッチを計測するとグラフが表示されます")
      : `${ratingType} ${t("graphEmptyOther", "グラフはランクマッチで表示されます")}`;
  elements.managementChartState.textContent = hasGraphData
    ? `${graphMatchCount} MATCHES`
    : matchType === "ranked"
      ? t("dataWaiting", "データ待機中")
      : t("rankedOnly", "ランクのみ");
  if (hasGraphData) {
    const renderToken = ++managementChartRenderToken;
    const draw = () => {
      // A state/settings event can queue another frame before this one runs.
      // Ignore that stale frame so an older selection cannot overwrite the
      // graph after the user has already selected a new match count.
      if (renderToken !== managementChartRenderToken) return;
      drawManagementChart(
        history,
        graphMatchCount,
        ratingType,
        displaySettings?.potentialLineVisible !== false &&
          state?.medianRatingType === ratingType && state?.medianRatingSampleCount >= 2
          ? state.medianRating
          : null,
        series.matchStart,
      );
    };
    if (immediate) draw();
    else requestAnimationFrame(draw);
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
  const trackedRating = state?.presentation?.currentRating ?? state?.currentRating;
  const rating =
    trackedRating ??
    selectedPlayer?.mr ??
    selectedPlayer?.lp ??
    null;
  const ratingType =
    trackedRating != null
      ? state?.presentation?.ratingType ?? state.ratingType
      : selectedPlayer?.mr != null
        ? "MR"
        : selectedPlayer?.lp != null
          ? "LP"
          : "";
  elements.currentRatingLabel.textContent = `${t("currentRating", "CURRENT")} ${ratingType || "MR"}`;
  elements.currentRating.textContent = rating == null ? "---" : String(rating);
  renderMedianRating(state);
  fitManagementScoreValues();
}

function formatMedianNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : "—";
}

function renderMedianRating(state = trackerState) {
  if (!elements.medianRating) return;
  const ratingType = state?.medianRatingType || resolveRatingType(state);
  const median = Number(state?.medianRating);
  const sampleCount = Math.max(0, Math.trunc(Number(state?.medianRatingSampleCount) || 0));
  const potentialLabel = t("potential", "POTENTIAL");
  const label = `${potentialLabel} ${ratingType || "MR"}`;
  if (elements.medianRatingLabel) elements.medianRatingLabel.textContent = label;
  elements.medianRating.textContent =
    Number.isFinite(median) && sampleCount >= 2
      ? formatMedianNumber(median)
      : "—";
  if (elements.medianRatingSample) {
    elements.medianRatingSample.textContent = sampleCount
      ? `(${sampleCount} ${t("matchUnit", "Match")})`
      : "";
  }
}

function renderCurrentCharacter(state = trackerState) {
  const siteCharacter = String(
    state?.presentation?.currentCharacter ??
      state?.player?.characterDisplayName ??
      selectedPlayer?.characterDisplayName ??
      "",
  ).trim();
  elements.currentCharacter.textContent = siteCharacter || "—";
  fitScoreValue(elements.currentCharacter);
}

function formatRatingValue(value, ratingType) {
  return displayNumber.rating(value, ratingType);
}

function renderMonitorPlayer(state = trackerState) {
  if (!elements.monitorPlayerName) return;
  const playerName = String(
    state?.presentation?.playerName ?? state?.player?.name ?? selectedPlayer?.name ?? "",
  ).trim();
  elements.monitorPlayerName.textContent = playerName || "—";
  elements.monitorPlayerName.title = playerName;
  fitScoreValue(elements.monitorPlayerName);
}

function renderSessionPeak(state = trackerState) {
  if (!elements.sessionPeakRating) return;
  const presentation = state?.presentation ?? {};
  elements.sessionPeakRating.textContent = formatRatingValue(
    presentation.sessionPeakRating,
    presentation.sessionPeakRatingType ?? presentation.ratingType,
  );
  fitScoreValue(elements.sessionPeakRating);
}

function renderCurrentMrRank(state = trackerState) {
  if (!elements.currentMrRank) return;
  const ranking = state?.ranking ?? {};
  const rank = Number(ranking.rank);
  const rawDelta = state?.presentation?.mrRankDelta;
  elements.currentMrRank.textContent = Number.isFinite(rank) && rank > 0
    ? displayNumber.rankLine(rank, rawDelta)
    : ranking.status === "loading"
      ? "…"
      : "—";
  elements.currentMrRankHome.textContent = String(ranking.homeLabel ?? "").trim();
  fitScoreValue(elements.currentMrRank);
}

function formatSocialDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.DateTimeFormat(displaySettings.locale || "ja-jp", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderSocialState(state = socialState) {
  socialState = state ?? socialState;
  const tabState = socialState[activeSocialKind] ?? {
    status: "idle", page: 1, totalPages: 1, players: [],
  };
  const monitoring = socialState.monitoring ?? {};
  const suspended = monitoring.suspended === true;
  elements.socialMonitoringStatus?.classList.toggle("hidden", !suspended);
  if (elements.socialMonitoringStatus) {
    elements.socialMonitoringStatus.title = t(
      "socialMonitoringSuspendedNote",
      "アプリ操作またはゲーム起動時に再開します",
    );
  }
  for (const button of [elements.socialFriendsTab, elements.socialFollowingTab]) {
    const active = button?.dataset.socialKind === activeSocialKind;
    button?.classList.toggle("active", active);
    button?.setAttribute("aria-selected", String(active));
  }
  elements.socialList.replaceChildren();
  for (const player of (tabState.players ?? []).slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "social-player";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.dataset.profileId = String(player.profileId ?? "");

    const heading = document.createElement("span");
    heading.className = "social-player-heading";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "social-player-name";
    name.dataset.socialHistoryCode = String(player.profileId ?? "");
    name.textContent = String(player.name ?? "—");
    const status = document.createElement("span");
    status.className = `social-presence ${player.online ? "online" : "offline"}`;
    status.textContent = String(player.statusName || (player.online ? "ONLINE" : t("offline", "OFFLINE")));
    heading.append(name, status);

    const detail = document.createElement("span");
    detail.className = "social-player-detail";
    const rating = player.ratingType && player.rating != null
      ? `${player.ratingType} ${displayNumber.integer(player.rating)}`
      : "—";
    detail.textContent = [player.platform, player.characterName, player.rankName, rating]
      .filter(Boolean).join(" · ");

    const activity = document.createElement("span");
    activity.className = "social-player-activity";
    const hub = [player.battleHubRegion, player.battleHubServer].filter(Boolean).join(" ");
    activity.textContent = hub || `${t("lastPlayed", "Last played")} ${formatSocialDate(player.lastPlayedAt)}`;
    row.append(heading, detail, activity);
    elements.socialList.append(row);
  }
  const hasPlayers = (tabState.players ?? []).length > 0;
  elements.socialEmpty.classList.toggle("hidden", hasPlayers || tabState.status === "loading");
  elements.socialError.classList.toggle("hidden", tabState.status !== "error");
  clearTimeout(socialRefreshCooldownTimer);
  socialRefreshCooldownTimer = null;
  const refreshAvailableAt = Number(
    monitoring.refreshAvailableAt?.[activeSocialKind],
  ) || 0;
  const cooldownRemaining = Math.max(0, refreshAvailableAt - Date.now());
  elements.socialRefreshButton.disabled =
    tabState.status === "loading" || cooldownRemaining > 0;
  if (cooldownRemaining > 0) {
    socialRefreshCooldownTimer = setTimeout(
      () => renderSocialState(socialState),
      cooldownRemaining + 50,
    );
  }
  const page = Math.max(1, Number(tabState.page) || 1);
  const totalPages = Math.max(page, Number(tabState.totalPages) || 1);
  elements.socialPageInfo.textContent = `${page} / ${totalPages}`;
  elements.socialPreviousButton.disabled = tabState.status === "loading" || page <= 1;
  elements.socialNextButton.disabled = tabState.status === "loading" || page >= totalPages;
}

function applyAuthenticatedPlayer(player) {
  selectedPlayer = player;
  elements.playerName.textContent = player.name;
  elements.playerCode.textContent = player.userCode;
  elements.playerPanel.classList.remove("hidden");
  fitPlayerName();
  renderRatingLabels();
  renderCurrentRating();
  renderMonitorPlayer();
  renderCurrentCharacter();
  renderSessionPeak();
  renderCurrentMrRank();
  setStatus(elements.authStatus, t("loggedIn", "ログイン済み"), "ok");
  // Refreshing the official session also runs while a tracker session is
  // active. Keep the action disabled in that state so the active indicator
  // retains its recording color instead of reverting to the idle button skin.
  elements.startTrackingButton.disabled =
    Boolean(trackerState?.readOnly) || !selectedPlayer || Boolean(trackerState?.active);
  if (api.getHistoryState) {
    api.getHistoryState().then((result) => {
      if (result?.ok) {
        historyPage = 0;
        renderHistoryState(result.data);
      }
    }).catch(() => {});
  }
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
  renderMonitorPlayer(state);
  renderCurrentCharacter(state);
  renderSessionPeak(state);
  renderCurrentMrRank(state);
  const matchType = displaySettings.matchType ?? "ranked";
  const selected = state.stats?.[matchType] ?? {};
  const presentation = state?.presentation ?? {};
  const wins = Number(presentation.wins ?? selected.wins ?? 0);
  const losses = Number(presentation.losses ?? selected.losses ?? 0);
  const total = wins + losses;
  const delta =
    matchType === "ranked"
      ? Number(presentation.ratingDelta ?? selected.ratingDelta ?? 0)
      : null;
  elements.recordWins.textContent = String(wins);
  elements.recordLosses.textContent = String(losses);
  elements.winRate.textContent = `${Number(
    presentation.winRate ?? (total ? (wins / total) * 100 : 0),
  ).toFixed(1)}%`;
  elements.ratingDelta.textContent =
    delta == null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "" : "±"}${delta}`;
  fitManagementScoreValues();
  renderManagementChart(state);
  elements.overlayUrl.textContent = state.overlayUrl;
  elements.startTrackingButton.classList.toggle("tracking-active", Boolean(state.active));
  elements.startTrackingButton.setAttribute("aria-pressed", String(Boolean(state.active)));
  elements.startTrackingButton.disabled = Boolean(state.readOnly) || !selectedPlayer || state.active;
  elements.startTrackingLabel.textContent =
    state.active
      ? t("measuring", "計測中")
      : ["idle", "manual", "restart"].includes(state.stopReason)
        ? t("resumeMeasure", "計測を再開")
        : t("startMeasure", "計測を開始");
  elements.stopTrackingButton.disabled = Boolean(state.readOnly) || !state.active;
  elements.resetTrackingButton.disabled = Boolean(state.readOnly) || !state.startedAt;
  renderNextUpdate();
}

const DISPLAY_METRIC_KEYS = [
  "record",
  "winRate",
  "currentRating",
  "ratingDelta",
  "potentialRating",
  "sessionPeak",
  "mrRank",
];

function updateNotificationSoundPreviewControl() {
  if (!elements.previewFriendOnlineNotificationSoundButton) return;
  const soundDisabled =
    !elements.friendOnlineNotificationSoundInput ||
    elements.friendOnlineNotificationSoundInput.value === "none" ||
    Number(elements.friendOnlineNotificationVolumeInput?.value) === 0;
  elements.previewFriendOnlineNotificationSoundButton.disabled =
    notificationSoundPreviewInFlight || friendNotificationSampleInFlight || soundDisabled;
  elements.previewFriendOnlineNotificationSoundButton.textContent =
    notificationSoundPreviewInFlight
      ? t("previewSoundPlaying", "再生中…")
      : t("previewSound", "試聴");
}

function updateFriendNotificationSampleControl() {
  if (!elements.previewFriendOnlineNotificationButton) return;
  elements.previewFriendOnlineNotificationButton.disabled =
    friendNotificationSampleInFlight || notificationSoundPreviewInFlight;
  elements.previewFriendOnlineNotificationButton.textContent =
    friendNotificationSampleInFlight
      ? t("previewNotificationActive", "表示中…")
      : t("previewNotification", "サンプル通知を表示");
}

function updateFriendNotificationDurationOutput() {
  if (!elements.friendOnlineNotificationDurationValue) return;
  const seconds = Number(elements.friendOnlineNotificationDurationInput?.value) || 5;
  elements.friendOnlineNotificationDurationValue.textContent =
    t("notificationDurationSeconds", "{seconds}秒").replace("{seconds}", String(seconds));
}

function updateFriendNotificationOpacityOutput() {
  if (!elements.friendOnlineNotificationOpacityValue) return;
  const opacity = Number(elements.friendOnlineNotificationOpacityInput?.value) || 0;
  elements.friendOnlineNotificationOpacityValue.textContent = `${opacity}%`;
}

function updateFriendNotificationVolumeOutput() {
  if (!elements.friendOnlineNotificationVolumeValue) return;
  const volume = Number(elements.friendOnlineNotificationVolumeInput?.value) || 0;
  elements.friendOnlineNotificationVolumeValue.textContent = `${volume}%`;
}

function normalizedDisplayItems(settings = {}) {
  const result = Object.fromEntries(
    [...DISPLAY_METRIC_KEYS, "graph"].map((key) => [key, true]),
  );
  const source = settings.displayItems;
  if (source && typeof source === "object") {
    for (const key of Object.keys(result)) {
      if (typeof source[key] === "boolean") result[key] = source[key];
    }
  } else if (typeof settings.graphVisible === "boolean") {
    result.graph = settings.graphVisible;
  }
  return result;
}

function renderDisplayItemVisibility(settings) {
  const displayItems = normalizedDisplayItems(settings);
  settings.displayItems = displayItems;
  // These visibility switches belong only to the stats window and OBS
  // overlay. The management monitor remains a complete, stable reference and
  // always shows every metric regardless of the output selection.
  for (const input of document.querySelectorAll("[data-display-item]")) {
    input.checked = displayItems[input.dataset.displayItem] !== false;
  }
  return displayItems;
}

function renderDisplaySettings(settings) {
  const previousGraphMatchCount = Number(displaySettings.graphMatchCount);
  displaySettings = settings;
  const displayItems = renderDisplayItemVisibility(settings);
  const windowOrientation = settings.windowOrientation ?? "horizontal";
  applyLocale(settings.locale || "ja-jp");
  if (elements.initialLanguageLayer) {
    elements.initialLanguageLayer.classList.toggle(
      "hidden",
      settings.initialLanguageSelectionRequired !== true,
    );
  }
  if (elements.initialLanguageInput && settings.locale) {
    elements.initialLanguageInput.value = settings.locale;
  }
  elements.fontScaleInput.value = String(Math.round(settings.fontScale * 100));
  elements.fontScaleValue.textContent = `${elements.fontScaleInput.value}%`;
  elements.graphLabelScaleInput.value = String(
    Math.round(settings.graphLabelScale * 100),
  );
  elements.graphLabelScaleValue.textContent =
    `${elements.graphLabelScaleInput.value}%`;
  elements.graphMatchCountInput.value = String(
    [0, 20, 50, 100].includes(Number(settings.graphMatchCount))
      ? settings.graphMatchCount
      : 20,
  );
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
      (button.dataset.graphVisible === "true") === displayItems.graph,
    );
  }
  for (const button of document.querySelectorAll("[data-potential-line-visible]")) {
    button.classList.toggle(
      "active",
      (button.dataset.potentialLineVisible === "true") ===
        (settings.potentialLineVisible !== false),
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
  elements.friendOnlineNotificationsEnabledInput.checked =
    settings.friendOnlineNotificationsEnabled === true;
  const friendOnlineNotificationTiming =
    settings.friendOnlineNotificationTiming === "always" ? "always" : "game-only";
  elements.friendOnlineNotificationTimingAlwaysInput.checked =
    friendOnlineNotificationTiming === "always";
  elements.friendOnlineNotificationTimingGameOnlyInput.checked =
    friendOnlineNotificationTiming === "game-only";
  elements.friendOnlineNotificationGameExeNote?.classList.toggle(
    "warning",
    friendOnlineNotificationTiming === "game-only" && !settings.gameExecutableName,
  );
  const soundOptions = Array.isArray(settings.friendOnlineNotificationSoundOptions)
    ? settings.friendOnlineNotificationSoundOptions
    : [];
  const selectedSound = typeof settings.friendOnlineNotificationSound === "string"
    ? settings.friendOnlineNotificationSound
    : "none";
  elements.friendOnlineNotificationSoundInput.replaceChildren(
    ...[
      { id: "none", label: t("notificationSoundNone", "サウンドなし") },
      ...soundOptions,
    ].map((sound) => {
      const option = document.createElement("option");
      option.value = sound.id;
      option.textContent = sound.label;
      return option;
    }),
  );
  elements.friendOnlineNotificationSoundInput.value = selectedSound;
  if (!elements.friendOnlineNotificationSoundInput.value) {
    elements.friendOnlineNotificationSoundInput.value = "none";
  }
  elements.friendOnlineNotificationVolumeInput.value = String(
    Math.round(
      Math.min(1, Math.max(0, Number(settings.friendOnlineNotificationVolume) || 0)) * 100,
    ),
  );
  updateFriendNotificationVolumeOutput();
  updateNotificationSoundPreviewControl();
  elements.friendOnlineNotificationDurationInput.value = String(
    Math.min(15, Math.max(3, Number(settings.friendOnlineNotificationDurationSeconds) || 5)),
  );
  updateFriendNotificationDurationOutput();
  updateFriendNotificationSampleControl();
  elements.friendOnlineNotificationOpacityInput.value = String(
    Math.round(
      Math.min(
        1,
        Math.max(0, Number(settings.friendOnlineNotificationBackgroundOpacity) || 0),
      ) * 100,
    ),
  );
  updateFriendNotificationOpacityOutput();
  elements.launchAtLoginInput.checked = settings.launchAtLogin;
  elements.gameDetectionInput.checked = settings.autoDetectGame;
  elements.gameDetectionInput.disabled = !settings.launchAtLogin;
  elements.gameExecutableName.textContent =
    settings.gameExecutableName || t("gameNotSelected", "ゲーム未選択");
  elements.overlayLockButton.disabled = settings.mode !== "overlay";
  elements.overlayLockButton.textContent = settings.overlayInteractionLocked
    ? t("overlayMove", "オーバーレイ移動")
    : t("overlayLock", "オーバーレイ固定");
  elements.toggleStatsButton.textContent = settings.statsWindowVisible
    ? t("hideStats", "戦績ウィンドウを閉じる")
    : t("showStats", "戦績ウィンドウを表示");
  if (trackerState) {
    renderTracker(trackerState);
    // Settings notifications can arrive after a queued state-render frame.
    // Redraw synchronously when the graph-count setting changes so the
    // management canvas cannot remain on the previous selection until the
    // next tracker update.
    if (previousGraphMatchCount !== Number(settings.graphMatchCount)) {
      renderManagementChart(trackerState, { immediate: true });
    }
  } else {
    // A settings change can arrive before the initial tracker-state IPC
    // message. Fetch the current state so graph options take effect without
    // waiting for the next polling cycle.
    void unwrap(api.getState())
      .then((state) => renderTracker(state))
      .catch(() => {});
  }
}

function renderUpdateMessage(state) {
  const key = state.messageKey;
  if (!key) return state.message ?? "";
  const fallback = state.message ?? "";
  return t(key, fallback)
    .replace("{version}", String(state.availableVersion ?? ""));
}

let lastUpdateState = {};

function renderUpdate(state) {
  lastUpdateState = { ...lastUpdateState, ...state };
  state = lastUpdateState;
  const currentVersion = String(state.currentVersion ?? "").trim().replace(/^v/i, "");
  if (elements.currentAppVersion) {
    elements.currentAppVersion.textContent = currentVersion ? `v${currentVersion}` : "—";
  }
  elements.updateMessage.textContent = renderUpdateMessage(state);
  const downloading = state.status === "downloading";
  const required = state.required === true;
  const hasUpdate = downloading || state.status === "ready";
  const updateRow = elements.updateBadge.closest(".update-row");
  document.body.classList.toggle("update-required", required);
  elements.updateBadge.classList.toggle("hidden", !hasUpdate);
  elements.optionsUpdateBadge?.classList.toggle("hidden", !hasUpdate);
  elements.optionsButton?.classList.toggle("has-update", hasUpdate);
  updateRow.classList.toggle("has-update", hasUpdate);
  updateRow.classList.toggle("force-update", required);
  elements.maintenanceSettingsCard?.classList.toggle("force-update", required);
  elements.updateProgress.classList.toggle("hidden", !downloading);
  elements.updateProgressBar.style.width = `${state.progress || 0}%`;
  elements.installUpdateButton.classList.toggle(
    "hidden",
    state.status !== "ready",
  );
  elements.installUpdateButton.disabled = state.status !== "ready";
  elements.installUpdateButton.textContent = required
    ? t("updateForce", "強制更新")
    : t("update", "更新");
  // 強制更新中でも、更新元を選び直した後に再確認できるようにする。
  // 更新が ready になった時だけ確認ボタンを更新ボタンへ置き換える。
  elements.checkUpdateButton.classList.toggle("hidden", hasUpdate);
  elements.checkUpdateButton.disabled =
    state.status === "checking" || state.status === "downloading";
  elements.checkUpdateButton.textContent =
    state.status === "checking"
      ? t("checking", "確認中…")
      : t("check", "確認");
  updateRow.setAttribute(
    "aria-busy",
    String(state.status === "checking" || downloading),
  );
  if (required) {
    setOptionsOpen(true);
    requestAnimationFrame(() =>
      elements.maintenanceSettingsCard?.scrollIntoView({ block: "nearest" }),
    );
  }
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

elements.openHistoryButton?.addEventListener("click", () => setHistoryPanelOpen(true));
elements.closeHistoryButton?.addEventListener("click", () => setHistoryPanelOpen(false));
async function selectHistoryTarget(userCode, { autoFetch = false } = {}) {
  const normalizedCode = String(userCode ?? "").trim();
  setHistoryPanelOpen(true);
  selectHistoryRecord(null);
  elements.selectHistoryTargetButton.disabled = true;
  try {
    const result = await unwrap(api.selectHistoryProfile(normalizedCode));
    historyPage = 0;
    scheduleHistoryRender(result.history, { resetPage: true });
    let currentHistory = result.history;
    if (autoFetch && currentHistory?.viewingOther && currentHistory.canFetch) {
      currentHistory = await unwrap(api.fetchHistory());
      historyPage = 0;
      scheduleHistoryRender(currentHistory, { resetPage: true });
    }
    showNotice(
      currentHistory?.viewingOther
        ? autoFetch && currentHistory.count > 0
          ? t("historyFetched", "Match history imported locally")
          : t("historyTargetSelected", "Player selected. Import history when ready.")
        : t("historyViewingSelf", "Viewing your player"),
      "success",
    );
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    elements.selectHistoryTargetButton.disabled = false;
  }
}
elements.selectHistoryTargetButton?.addEventListener("click", () =>
  selectHistoryTarget(elements.historyTargetCode?.value?.trim() ?? ""),
);
for (const body of [elements.recentHistoryBody, elements.historyTableBody]) {
  body?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const replayButton = target?.closest("[data-history-replay-id]");
    if (replayButton) {
      void copyHistoryReplayId(replayButton.dataset.historyReplayId);
      return;
    }
    const button = target?.closest("[data-history-opponent-code]");
    if (!button) return;
    void selectHistoryTarget(button.dataset.historyOpponentCode, { autoFetch: true });
  });
}
elements.historyTableBody?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, a, input, select, textarea")) return;
  const row = target?.closest("tr[data-history-record-key]");
  if (!row) return;
  const record = (historyState.records ?? []).find(
    (candidate) => historyRecordKey(candidate) === row.dataset.historyRecordKey,
  );
  if (record) selectHistoryRecord(record);
});
elements.historyTableBody?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, a, input, select, textarea")) return;
  const row = target?.closest("tr[data-history-record-key]");
  if (!row) return;
  event.preventDefault();
  const record = (historyState.records ?? []).find(
    (candidate) => historyRecordKey(candidate) === row.dataset.historyRecordKey,
  );
  if (record) selectHistoryRecord(record);
});
elements.clearHistoryTargetButton?.addEventListener("click", async () => {
  elements.clearHistoryTargetButton.disabled = true;
  selectHistoryRecord(null);
  try {
    historyPage = 0;
    scheduleHistoryRender(await unwrap(api.clearHistoryProfile()), { resetPage: true });
    showNotice(t("historyViewingSelf", "Viewing your player"), "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});
for (const input of [
  elements.historyDateFrom,
  elements.historyDateTo,
  elements.historyMatchType,
  elements.historyCharacter,
]) {
  input?.addEventListener("change", () => {
    historyPage = 0;
    renderHistoryState();
  });
}
elements.historyRatingPeriod?.addEventListener("change", () => {
  const mode = elements.historyRatingPeriod.value;
  historyRatingPeriod = {
    mode: ["all", "week"].includes(mode) ? mode : "all",
    weekOffset: 0,
    dateMode: normalizeHistoryRatingDateMode(historyRatingPeriod.dateMode),
  };
  renderHistoryRatingCharts(filteredHistoryRecords());
});
elements.historyRatingDateMode?.addEventListener("change", () => {
  historyRatingPeriod = {
    ...historyRatingPeriod,
    dateMode: normalizeHistoryRatingDateMode(elements.historyRatingDateMode.value),
  };
  renderHistoryRatingCharts(filteredHistoryRecords());
});
elements.historyRatingWeekPrevious?.addEventListener("click", () => {
  if (historyRatingPeriod.mode !== "week") return;
  historyRatingPeriod = {
    ...historyRatingPeriod,
    weekOffset: historyRatingPeriod.weekOffset - 1,
  };
  renderHistoryRatingCharts(filteredHistoryRecords());
});
elements.historyRatingWeekNext?.addEventListener("click", () => {
  if (historyRatingPeriod.mode !== "week") return;
  historyRatingPeriod = {
    ...historyRatingPeriod,
    weekOffset: Math.min(0, historyRatingPeriod.weekOffset + 1),
  };
  renderHistoryRatingCharts(filteredHistoryRecords());
});
elements.historyPreviousButton?.addEventListener("click", () => {
  historyPage = Math.max(0, historyPage - 1);
  renderHistoryState();
});
elements.historyNextButton?.addEventListener("click", () => {
  historyPage += 1;
  renderHistoryState();
});
elements.historyOpponentMatchesSort?.addEventListener("click", () => {
  historyOpponentSort = historyOpponentSort.key === "matches"
    ? { key: "matches", direction: historyOpponentSort.direction === "desc" ? "asc" : "desc" }
    : { key: "matches", direction: "desc" };
  renderOpponentCharacterStats(filteredHistoryRecords());
});
elements.historyOpponentWinRateSort?.addEventListener("click", () => {
  historyOpponentSort = historyOpponentSort.key === "winRate"
    ? { key: "winRate", direction: historyOpponentSort.direction === "desc" ? "asc" : "desc" }
    : { key: "winRate", direction: "desc" };
  renderOpponentCharacterStats(filteredHistoryRecords());
});
elements.fetchHistoryButton?.addEventListener("click", async () => {
  elements.fetchHistoryButton.disabled = true;
  try {
    historyPage = 0;
    scheduleHistoryRender(await unwrap(api.fetchHistory()), { resetPage: true });
    showNotice(t("historyFetched", "Match history imported locally"), "success");
  } catch (error) {
    showNotice(error.message, "error");
    renderHistoryState();
  }
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

  if (!open && trackerState) {
    // The management chart is display:none while the options drawer is open.
    // A graph-count change made in that state cannot be painted because the
    // canvas has a 0x0 layout box. Redraw on the first frame after restoring
    // the panel so the selected range appears without waiting for the next
    // service poll.
    requestAnimationFrame(() => {
      if (!elements.managementChartPanel.classList.contains("options-collapsed")) {
        renderManagementChart(trackerState, { immediate: true });
      }
    });
  }
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
    try {
      renderDisplaySettings(
        await unwrap(
          api.updateDisplaySettings({
            displayItems: {
              graph: button.dataset.graphVisible === "true",
            },
          }),
        ),
      );
    } catch (error) {
      renderDisplaySettings(displaySettings);
      showNotice(error.message, "error");
    }
  });
}

for (const input of document.querySelectorAll("[data-display-item]")) {
  input.addEventListener("change", async () => {
    try {
      renderDisplaySettings(
        await unwrap(
          api.updateDisplaySettings({
            displayItems: { [input.dataset.displayItem]: input.checked },
          }),
        ),
      );
    } catch (error) {
      renderDisplaySettings(displaySettings);
      showNotice(error.message, "error");
    }
  });
}

for (const button of [elements.socialFriendsTab, elements.socialFollowingTab]) {
  button?.addEventListener("click", () => {
    activeSocialKind = button.dataset.socialKind;
    renderSocialState();
  });
}

elements.socialRefreshButton?.addEventListener("click", async () => {
  try {
    renderSocialState(await unwrap(api.refreshSocial(activeSocialKind)));
  } catch (error) {
    showNotice(error.message, "error");
  }
});

for (const eventName of ["pointerdown", "keydown"]) {
  window.addEventListener(eventName, () => {
    const now = Date.now();
    if (now - lastSocialActivityReportAt < 60_000) return;
    lastSocialActivityReportAt = now;
    void unwrap(api.reportSocialActivity?.())
      .then((state) => state && renderSocialState(state))
      .catch(() => {});
  }, { capture: true });
}

elements.socialPreviousButton?.addEventListener("click", async () => {
  const page = Number(socialState[activeSocialKind]?.page) || 1;
  if (page <= 1) return;
  try {
    renderSocialState(await unwrap(api.changeSocialPage(activeSocialKind, page - 1)));
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.socialNextButton?.addEventListener("click", async () => {
  const current = socialState[activeSocialKind] ?? {};
  const page = Number(current.page) || 1;
  if (page >= (Number(current.totalPages) || 1)) return;
  try {
    renderSocialState(await unwrap(api.changeSocialPage(activeSocialKind, page + 1)));
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.socialList?.addEventListener("click", async (event) => {
  const historyLink = event.target.closest("[data-social-history-code]");
  if (historyLink) {
    const userCode = historyLink.dataset.socialHistoryCode;
    if (elements.historyTargetCode) elements.historyTargetCode.value = userCode;
    void selectHistoryTarget(userCode, { autoFetch: true });
    return;
  }
  const row = event.target.closest("[data-profile-id]");
  if (!row) return;
  try {
    await unwrap(api.openSocialProfile(row.dataset.profileId));
  } catch (error) {
    showNotice(error.message, "error");
  }
});

elements.socialList?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("[data-social-history-code]")) return;
  const row = event.target.closest("[data-profile-id]");
  if (!row) return;
  event.preventDefault();
  void unwrap(api.openSocialProfile(row.dataset.profileId)).catch((error) =>
    showNotice(error.message, "error"),
  );
});

for (const button of document.querySelectorAll("[data-potential-line-visible]")) {
  button.addEventListener("click", async () => {
    try {
      renderDisplaySettings(
        await unwrap(
          api.updateDisplaySettings({
            potentialLineVisible:
              button.dataset.potentialLineVisible === "true",
          }),
        ),
      );
    } catch (error) {
      showNotice(error.message, "error");
    }
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

let graphMatchCountRequestSerial = 0;
let lastGraphMatchCountInput = { value: null, at: 0 };
async function updateGraphMatchCountFromInput() {
  const graphMatchCount = Number(elements.graphMatchCountInput.value);
  if (![0, 20, 50, 100].includes(graphMatchCount)) return;

  // `input` and `change` can both be emitted for a native select. Once the
  // local value is applied, the second event is ignored for a short window so
  // it cannot trigger a duplicate IPC write. A later event with the same
  // value is still accepted, which also repairs a stale canvas after an
  // overlapping settings notification.
  const now = Date.now();
  if (
    lastGraphMatchCountInput.value === graphMatchCount &&
    now - lastGraphMatchCountInput.at < 250
  ) {
    return;
  }
  lastGraphMatchCountInput = { value: graphMatchCount, at: now };

  // Apply the value synchronously to the management canvas using the state
  // already in memory. This intentionally does not request match data.
  const requestSerial = ++graphMatchCountRequestSerial;
  const settingChanged = Number(displaySettings.graphMatchCount) !== graphMatchCount;
  displaySettings = { ...displaySettings, graphMatchCount };
  if (trackerState) {
    // Always redraw, including when the main process already has the selected
    // value. The latter can happen when a prior overlapping event persisted
    // the setting before the renderer painted its graph.
    renderManagementChart(trackerState, { immediate: true });
  }

  if (!settingChanged) return;

  const update = unwrap(api.updateDisplaySettings({ graphMatchCount }))
    .then((settings) => {
      if (requestSerial !== graphMatchCountRequestSerial) return;
      renderDisplaySettings(settings);
      // The IPC response is authoritative, but redraw immediately once more
      // so the returned setting cannot wait for the next polling state event.
      if (trackerState) renderManagementChart(trackerState, { immediate: true });
    });
  await update;
}

elements.graphMatchCountInput.addEventListener("input", () => {
  void updateGraphMatchCountFromInput().catch((error) =>
    showNotice(error.message, "error"),
  );
});
elements.graphMatchCountInput.addEventListener("change", () => {
  void updateGraphMatchCountFromInput().catch((error) =>
    showNotice(error.message, "error"),
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

elements.friendOnlineNotificationsEnabledInput.addEventListener("change", async () => {
  try {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({
          friendOnlineNotificationsEnabled:
            elements.friendOnlineNotificationsEnabledInput.checked,
        }),
      ),
    );
  } catch (error) {
    renderDisplaySettings(displaySettings);
    showNotice(error.message, "error");
  }
});

for (const timingInput of [
  elements.friendOnlineNotificationTimingAlwaysInput,
  elements.friendOnlineNotificationTimingGameOnlyInput,
]) {
  timingInput.addEventListener("change", async () => {
    if (!timingInput.checked) return;
    try {
      renderDisplaySettings(
        await unwrap(
          api.updateDisplaySettings({
            friendOnlineNotificationTiming: timingInput.value,
          }),
        ),
      );
    } catch (error) {
      renderDisplaySettings(displaySettings);
      showNotice(error.message, "error");
    }
  });
}

elements.friendOnlineNotificationSoundInput.addEventListener("change", async () => {
  const soundId = elements.friendOnlineNotificationSoundInput.value;
  try {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({ friendOnlineNotificationSound: soundId }),
      ),
    );
  } catch (error) {
    renderDisplaySettings(displaySettings);
    showNotice(error.message, "error");
  }
});

elements.previewFriendOnlineNotificationSoundButton.addEventListener("click", async () => {
  const soundId = elements.friendOnlineNotificationSoundInput.value;
  if (soundId === "none" || notificationSoundPreviewInFlight) return;
  notificationSoundPreviewInFlight = true;
  updateNotificationSoundPreviewControl();
  updateFriendNotificationSampleControl();
  try {
    await unwrap(api.previewNotificationSound(soundId));
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    notificationSoundPreviewInFlight = false;
    updateNotificationSoundPreviewControl();
    updateFriendNotificationSampleControl();
  }
});

elements.friendOnlineNotificationDurationInput.addEventListener(
  "input",
  updateFriendNotificationDurationOutput,
);

elements.friendOnlineNotificationDurationInput.addEventListener("change", async () => {
  const durationSeconds = Number(elements.friendOnlineNotificationDurationInput.value);
  try {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({
          friendOnlineNotificationDurationSeconds: durationSeconds,
        }),
      ),
    );
  } catch (error) {
    renderDisplaySettings(displaySettings);
    showNotice(error.message, "error");
  }
});

elements.previewFriendOnlineNotificationButton.addEventListener("click", async () => {
  if (friendNotificationSampleInFlight || notificationSoundPreviewInFlight) return;
  friendNotificationSampleInFlight = true;
  updateFriendNotificationSampleControl();
  updateNotificationSoundPreviewControl();
  try {
    await unwrap(api.previewFriendNotification());
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    friendNotificationSampleInFlight = false;
    updateFriendNotificationSampleControl();
    updateNotificationSoundPreviewControl();
  }
});

elements.friendOnlineNotificationOpacityInput.addEventListener(
  "input",
  updateFriendNotificationOpacityOutput,
);

elements.friendOnlineNotificationOpacityInput.addEventListener("change", async () => {
  const backgroundOpacity = Number(elements.friendOnlineNotificationOpacityInput.value) / 100;
  try {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({
          friendOnlineNotificationBackgroundOpacity: backgroundOpacity,
        }),
      ),
    );
  } catch (error) {
    renderDisplaySettings(displaySettings);
    showNotice(error.message, "error");
  }
});

elements.friendOnlineNotificationVolumeInput.addEventListener("input", () => {
  updateFriendNotificationVolumeOutput();
  updateNotificationSoundPreviewControl();
});

elements.friendOnlineNotificationVolumeInput.addEventListener("change", async () => {
  const volume = Number(elements.friendOnlineNotificationVolumeInput.value) / 100;
  try {
    renderDisplaySettings(
      await unwrap(
        api.updateDisplaySettings({ friendOnlineNotificationVolume: volume }),
      ),
    );
  } catch (error) {
    renderDisplaySettings(displaySettings);
    showNotice(error.message, "error");
  }
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
    // Existing history rows contain normalized mode keys, but their labels are
    // rendered through the active locale. Repaint them immediately so a
    // locale switch cannot leave a mixture of the previous and current
    // language in the management screen.
    renderHistoryState(historyState);
  } catch (error) {
    showNotice(error.message, "error");
  }
});

if (elements.initialLanguageInput && localeApi?.LOCALES) {
  for (const [value, label] of Object.entries(localeApi.LOCALES)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    elements.initialLanguageInput.append(option);
  }
}

elements.initialLanguageInput?.addEventListener("change", () => {
  applyLocale(elements.initialLanguageInput.value);
});

elements.confirmInitialLanguageButton?.addEventListener("click", async () => {
  const locale = elements.initialLanguageInput.value;
  elements.confirmInitialLanguageButton.disabled = true;
  try {
    renderDisplaySettings(await unwrap(api.updateDisplaySettings({ locale })));
    await populateInstalledFonts(displaySettings.fontFamily);
  } catch (error) {
    elements.confirmInitialLanguageButton.disabled = false;
    applyLocale(displaySettings.locale || "ja-jp");
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
  if (!displaySettings.launchAtLogin) {
    elements.gameDetectionInput.checked = false;
    showNotice(
      t(
        "gameDetectionRequiresStartup",
        "ゲーム起動検知には、コンピューター起動時のアプリ実行をONにしてください",
      ),
      "error",
    );
    return;
  }
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

function scheduleManagementResizeRender() {
  if (managementResizeFrame) return;
  managementResizeFrame = requestAnimationFrame(() => {
    managementResizeFrame = 0;
    fitManagementScoreValues();
    if (trackerState) renderManagementChart(trackerState);
    if (historyPanelOpen) renderHistoryState();
  });
}

window.addEventListener("resize", scheduleManagementResizeRender);

setInterval(renderNextUpdate, 1000);
setInterval(() => {
  if (historyPanelOpen) renderHistoryFetchStatus();
}, 1000);

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
  renderUpdate({
    status: "checking",
    progress: 0,
    messageKey: "updateChecking",
    message: t("updateChecking", "GitHub Releasesの更新を確認しています…"),
  });
  try {
    renderUpdate(await unwrap(api.checkForUpdates()));
  } catch (error) {
    elements.checkUpdateButton.disabled = false;
    elements.checkUpdateButton.textContent = t("check", "確認");
    showNotice(error.message, "error");
  }
});

elements.installUpdateButton.addEventListener("click", async () => {
  elements.installUpdateButton.disabled = true;
  try {
    await unwrap(api.installUpdate());
  } catch (error) {
    elements.installUpdateButton.disabled = false;
    showNotice(error.message, "error");
  }
});

api.onState(renderTracker);
api.onHistoryProgress?.((progress) => {
  if (
    progress?.profileId &&
    historyState?.profileId &&
    progress.profileId !== historyState.profileId
  ) {
    return;
  }
  historyState = { ...historyState, ...progress };
  renderHistoryFetchStatus();
});
api.onHistoryState?.((state) => {
  scheduleHistoryRender(state);
});
api.onSocialState?.(renderSocialState);
api.onUpdateState(renderUpdate);
api.onDisplaySettings(renderDisplaySettings);
api.onAuthenticatedPlayer((player) => {
  if (!player) {
    selectedPlayer = null;
    elements.playerPanel.classList.add("hidden");
    setStatus(elements.authStatus, t("unverified", "未確認"));
    elements.startTrackingButton.disabled = true;
    return;
  }
  applyAuthenticatedPlayer(player);
  showNotice(t("autoPlayerConfigured", "ログイン中のプレイヤーを自動設定しました"), "success");
});

Promise.all([
  unwrap(api.getState()),
  unwrap(api.getHistoryState ? api.getHistoryState() : Promise.resolve({ records: [] })),
  unwrap(api.getUpdateState()),
  unwrap(api.getDisplaySettings()),
  unwrap(api.getSocialState ? api.getSocialState() : Promise.resolve(socialState)),
])
  .then(async ([state, savedHistory, updateState, settings, savedSocial]) => {
    renderDisplaySettings(settings);
    await populateInstalledFonts(settings.fontFamily);
    renderTracker(state);
    historyPage = 0;
    renderHistoryState(savedHistory);
    renderSocialState(savedSocial);
    renderUpdate(updateState);
  })
  .catch((error) => showNotice(error.message, "error"))
  .finally(() => api.notifyManagementReady?.());
