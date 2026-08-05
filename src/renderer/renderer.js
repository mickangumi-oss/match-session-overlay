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
let historyState = { records: [], canFetch: false, authenticated: false, cooldownSeconds: 0 };
let historyPanelOpen = false;
const HISTORY_PAGE_SIZE = 10;
const RECENT_HISTORY_PREVIEW_LIMIT = 5;
let historyPage = 0;

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
    "openHistoryButton",
    "recordWins",
    "recordLosses",
    "winRate",
    "currentCharacter",
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
    "historyPanel",
    "closeHistoryButton",
    "historyTargetCode",
    "selectHistoryTargetButton",
    "clearHistoryTargetButton",
    "historyTargetStatus",
    "fetchHistoryButton",
    "historyFetchState",
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
    "historyCount",
    "historyResultChart",
    "historyEmpty",
    "historyMrChart",
    "historyMrEmpty",
    "historyLpChart",
    "historyLpEmpty",
    "historyTableBody",
    "historyPreviousButton",
    "historyNextButton",
    "historyPageInfo",
    "recentHistoryBody",
    "recentHistoryCount",
    "recentHistoryEmpty",
  ].map((id) => [id, document.getElementById(id)]),
);

function showNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
}

function dateKeyForHistory(record) {
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
  return date.toLocaleString(undefined, {
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

function filteredHistoryRecords() {
  const from = elements.historyDateFrom?.value || "";
  const to = elements.historyDateTo?.value || "";
  const mode = elements.historyMatchType?.value || "all";
  const character = elements.historyCharacter?.value || "all";
  return (Array.isArray(historyState.records) ? historyState.records : [])
    .filter((record) => {
      const date = dateKeyForHistory(record);
      return (!from || date >= from) && (!to || date <= to);
    })
    .filter((record) => mode === "all" || record.matchType === mode)
    .filter((record) => {
      if (character === "all") return true;
      return String(record.characterId ?? "") === character;
    })
    .sort((a, b) => Number(b.uploadedAt) - Number(a.uploadedAt));
}

function drawHistoryResultChart(records) {
  const canvas = elements.historyResultChart;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!records.length) return;
  // Aggregate results by calendar day so each bar represents one date.
  // Losses are drawn at the bottom and wins above them, making the daily
  // result composition readable without requiring one bar per match.
  const grouped = new Map();
  for (const record of records) {
    const date = dateKeyForHistory(record);
    if (!date) continue;
    const bucket = grouped.get(date) || { win: 0, loss: 0, draw: 0 };
    if (record.result === "win") bucket.win += 1;
    else if (record.result === "loss") bucket.loss += 1;
    else bucket.draw += 1;
    grouped.set(date, bucket);
  }
  const ordered = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, ...values }));
  if (!ordered.length) return;
  const padding = { top: 12, right: 14, bottom: 32, left: 32 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);

  const maximum = Math.max(1, ...ordered.map((bucket) => bucket.win + bucket.loss + bucket.draw));
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

  const slotWidth = plotWidth / ordered.length;
  const barGap = Math.max(3, Math.min(14, slotWidth / 5));
  const barWidth = Math.max(5, slotWidth - barGap);
  ordered.forEach((bucket, index) => {
    const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
    let cursor = padding.top + plotHeight;
    for (const [count, color] of [
      [bucket.loss, "#2d78df"],
      [bucket.win, "#f32755"],
      [bucket.draw, "#9aa7b2"],
    ]) {
      if (!count) continue;
      const segmentHeight = (count / axisMaximum) * plotHeight;
      cursor -= segmentHeight;
      context.fillStyle = color;
      context.fillRect(x, cursor, barWidth, segmentHeight);
    }
    if (ordered.length <= 12 || index % Math.ceil(ordered.length / 12) === 0) {
      const parsedDate = new Date(`${bucket.date}T00:00:00`);
      const label = `${String(parsedDate.getMonth() + 1).padStart(2, "0")}/${String(parsedDate.getDate()).padStart(2, "0")}`;
      context.fillStyle = "rgba(247,248,255,.72)";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(label, x + barWidth / 2, padding.top + plotHeight + 7);
    }
  });
}

function drawHistoryRatingChart(records, ratingType, canvas, emptyElement) {
  if (!canvas) return;
  const orderedRecords = [...records]
    .filter((record) => String(record.ownRatingType || "").toUpperCase() === ratingType)
    .filter((record) => Number.isFinite(Number(record.ownRating)))
    .sort((a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt));
  const points = orderedRecords.map((record, index) => ({
    match: index + 1,
    value: Number(record.ownRating),
  }));
  if (emptyElement) emptyElement.classList.toggle("hidden", points.length > 0);

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!points.length) return;

  const padding = { top: 10, right: 8, bottom: 24, left: 44 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = Math.max(1, rawMax - rawMin);
  const axisMin = Math.max(0, rawMin - Math.ceil(range * 0.12));
  const axisMax = rawMax + Math.ceil(range * 0.12) || axisMin + 1;
  const color = ratingType === "MR" ? "#ff2e69" : "#43d8ff";
  const formatValue = (value) => Math.round(value).toLocaleString();

  context.font = `9px ${fontStackFor(displaySettings.fontFamily)}`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(247,248,255,.62)";
  context.strokeStyle = "rgba(120, 190, 220, .16)";
  context.lineWidth = 1;
  for (let step = 0; step <= 2; step += 1) {
    const value = axisMin + ((axisMax - axisMin) * (2 - step)) / 2;
    const y = padding.top + (plotHeight * step) / 2;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(formatValue(value), padding.left - 5, y);
  }

  const xFor = (index) => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value) => padding.top + plotHeight - ((value - axisMin) / (axisMax - axisMin)) * plotHeight;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    context.beginPath();
    context.arc(x, y, 2.5, 0, Math.PI * 2);
    context.fill();
    if (points.length <= 10 || index % Math.ceil(points.length / 10) === 0) {
      const label = `#${point.match}`;
      context.fillStyle = "rgba(247,248,255,.66)";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(label, x, padding.top + plotHeight + 6);
      context.fillStyle = color;
    }
  });
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

function appendHistoryCell(row, value, { opponentUserCode = null } = {}) {
  const cell = document.createElement("td");
  if (opponentUserCode && /^\d{4,12}$/.test(String(opponentUserCode))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-opponent-link";
    button.dataset.historyOpponentCode = String(opponentUserCode);
    button.textContent = value;
    button.title = t("historyViewOpponent", "View this player's history");
    cell.append(button);
  } else {
    cell.textContent = value;
  }
  row.append(cell);
}

function renderHistoryTable(records) {
  const body = elements.historyTableBody;
  if (!body) return;
  body.replaceChildren();
  for (const record of records) {
    const row = document.createElement("tr");
    const result = record.result === "win" ? "W" : record.result === "loss" ? "L" : "—";
    const cells = [
      formatHistoryDate(record),
      result,
      historyModeLabel(record.matchType),
      record.ownName || "—",
      historyCharacterLabel(record),
      record.opponentName || "—",
      record.ownRating == null ? "—" : `${record.ownRatingType || ""} ${record.ownRating}`,
    ];
    // Keep the player's rating next to their character for quick scanning.
    cells.splice(5, 0, cells.splice(6, 1)[0]);
    cells.splice(
      7,
      0,
      historyCharacterLabel(record, false),
      record.opponentRating == null ? "—" : `${record.opponentRatingType || ""} ${record.opponentRating}`,
    );
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) cell.className = result === "W" ? "result-win" : result === "L" ? "result-loss" : "result-draw";
      if (index === 6) {
        appendHistoryCell(row, value, { opponentUserCode: record.opponentUserCode });
        row.lastElementChild.className = cell.className;
      } else {
        cell.textContent = value;
        row.append(cell);
      }
    });
    body.append(row);
  }
}

function renderRecentHistoryPreview(records) {
  const body = elements.recentHistoryBody;
  if (!body) return;
  const recent = [...records]
    .sort((a, b) => Number(b.uploadedAt) - Number(a.uploadedAt))
    .slice(0, RECENT_HISTORY_PREVIEW_LIMIT);
  body.replaceChildren();
  for (const record of recent) {
    const result = record.result === "win" ? "W" : record.result === "loss" ? "L" : "—";
    const row = document.createElement("tr");
    const values = [
      formatHistoryDate(record),
      result,
      historyModeLabel(record.matchType),
      record.opponentName || "—",
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) {
        cell.className = result === "W" ? "result-win" : result === "L" ? "result-loss" : "result-draw";
      }
      if (index === 3) {
        appendHistoryCell(row, value, { opponentUserCode: record.opponentUserCode });
        row.lastElementChild.className = cell.className;
      } else {
        cell.textContent = value;
        row.append(cell);
      }
    });
    body.append(row);
  }
  if (elements.recentHistoryCount) elements.recentHistoryCount.textContent = String(recent.length);
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
  const ordered = [...records]
    .filter((record) => ["MR", "LP"].includes(record.ownRatingType))
    .sort((a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt));
  const ratingType =
    ordered.at(-1)?.ownRatingType ??
    (player?.mr != null ? "MR" : player?.lp != null ? "LP" : "MR");
  const values = ordered
    .filter((record) => record.ownRatingType === ratingType)
    .map((record) => Number(record.ownRating))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (elements.historyPotentialLabel) {
    elements.historyPotentialLabel.textContent = `${t("potential", "POTENTIAL")} ${ratingType}`;
  }
  if (values.length < 2) {
    return { ratingType, value: null, sampleCount: values.length };
  }
  const middle = Math.floor(values.length / 2);
  const value = values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
  return { ratingType, value: Math.round(value), sampleCount: values.length };
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
  elements.historyCount.textContent = `${records.length} ${t("matches", "MATCHES")}`;
  elements.historyEmpty.classList.toggle("hidden", records.length > 0);
  drawHistoryResultChart(records);
  drawHistoryRatingChart(records, "MR", elements.historyMrChart, elements.historyMrEmpty);
  drawHistoryRatingChart(records, "LP", elements.historyLpChart, elements.historyLpEmpty);
  const totalPages = Math.ceil(records.length / HISTORY_PAGE_SIZE);
  historyPage = totalPages ? Math.min(historyPage, totalPages - 1) : 0;
  const pageRecords = records.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE,
  );
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
  const cooldown = Number(historyState.cooldownSeconds || 0);
  elements.fetchHistoryButton.disabled = !historyState.canFetch;
  elements.historyFetchState.textContent = historyState.viewingOther && historyState.polling
    ? t("historyAutoUpdating", "Automatic update: every {seconds}s").replace(
      "{seconds}",
      String(historyState.pollIntervalSeconds ?? "--"),
    )
    : historyState.viewingOther && historyState.pollStopReason
      ? t("historyAutoStopped", "Automatic update stopped after inactivity")
      : !historyState.authenticated
        ? t("historyFetchUnavailable", "Log in to import match history")
        : historyState.canFetch
          ? t("historyFetchReady", "Ready (one request per 10 minutes)")
          : t("historyFetchCooldown", "Available again in {seconds}s").replace("{seconds}", String(cooldown));
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

function translateStatus(status) {
  if (status === "historyViewing") return t("historyViewing", "Viewing");
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

function fitScoreValue(element) {
  if (!element) return;
  element.style.fontSize = "";

  // Custom fonts and italics can be wider than the default condensed face.
  // Keep the card width fixed and reduce only the value when it overflows.
  requestAnimationFrame(() => {
    const baseSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
    const minimumSize = 18;
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
  const values = history.filter(Number.isFinite);
  if (!values.length) return;
  const potential = Number.isFinite(Number(potentialRating))
    ? Number(potentialRating)
    : null;
  const labelScale = Math.min(
    2,
    Math.max(0.75, Number(displaySettings.graphLabelScale ?? 1.3)),
  );
  const labelFontSize = 9 * labelScale;
  const axisValues = potential == null ? values : [...values, potential];
  const dataMinimum = Math.min(...axisValues);
  const dataMaximum = Math.max(...axisValues);
  // LP charts always start at zero.  Calculate the tick size from that full
  // axis range; using only the narrow observed LP range would produce tiny
  // steps (for example 500) and then draw dozens of labels between 0 and
  // 20,000+, causing the labels to overlap on the graph.
  const axisFloor = ratingType === "LP" ? 0 : dataMinimum;
  const dataSpread = Math.max(10, dataMaximum - axisFloor);
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

  if (potential != null) {
    const potentialY = yFor(potential);
    context.save();
    context.strokeStyle = "#ff2e69";
    context.lineWidth = 1.5;
    context.shadowBlur = 5;
    context.shadowColor = "rgba(255,46,105,.65)";
    context.beginPath();
    context.moveTo(left, potentialY);
    context.lineTo(width - right, potentialY);
    context.stroke();
    context.shadowBlur = 0;
    context.font = `${fontStyle}${Math.max(8, labelFontSize - 1)}px ${fontStackFor(
      displaySettings.fontFamily,
    )}`;
    context.fillStyle = "#ff6f97";
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(
      `${t("potential", "POTENTIAL")} ${ratingType} ${Math.round(potential).toLocaleString()}`,
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
  context.fillStyle = `${displaySettings.textColor ?? "#f7f8ff"}cc`;
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

function graphSeriesForState(state, matchType = "ranked") {
  const configuredLimit = [0, 20, 50, 100].includes(
    Number(displaySettings.graphMatchCount),
  )
    ? Number(displaySettings.graphMatchCount)
    : 20;
  const supplied = state?.graphData?.[matchType];
  const selected = state?.stats?.[matchType] ?? {};
  const sourceHistory = Array.isArray(supplied?.values)
    ? supplied.values.filter(Number.isFinite)
    : historyForDisplay(
        selected,
        Number.isFinite(Number(selected.matchCount))
          ? Math.max(0, Math.trunc(Number(selected.matchCount)))
          : Number(selected.wins ?? 0) + Number(selected.losses ?? 0),
      );
  const sourceMatchCount = Number.isFinite(Number(supplied?.matchCount))
    ? Math.max(0, Math.trunc(Number(supplied.matchCount)))
    : Number.isFinite(Number(selected.matchCount))
      ? Math.max(0, Math.trunc(Number(selected.matchCount)))
      : Math.max(0, sourceHistory.length - 1);
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
      ratingType: supplied?.ratingType || resolveRatingType(state),
    };
  }
  const start = Math.max(0, sourceHistory.length - matchCount - 1);
  return {
    history: sourceHistory.slice(start, start + matchCount + 1),
    matchCount,
    matchStart: Math.max(0, sourceMatchCount - matchCount),
    ratingType: supplied?.ratingType || resolveRatingType(state),
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

function renderManagementChart(state) {
  // The graph option controls the compact stats window/overlay only. The
  // management screen is the dedicated graph workspace and always keeps it
  // visible for inspection.
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
    requestAnimationFrame(() =>
      drawManagementChart(
        history,
        graphMatchCount,
        ratingType,
        state?.medianRatingType === ratingType && state?.medianRatingSampleCount >= 2
          ? state.medianRating
          : null,
        series.matchStart,
      ),
    );
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
  fitManagementScoreValues();
  renderManagementChart(state);
  elements.overlayUrl.textContent = state.overlayUrl;
  setStatus(
    elements.trackerStatus,
    translateStatus(state.status),
    state.active ? "ok" : "neutral",
  );
  elements.startTrackingButton.disabled = Boolean(state.readOnly) || !selectedPlayer || state.active;
  elements.startTrackingLabel.textContent =
    state.stopReason === "idle" ? t("resumeMeasure", "計測を再開") : t("startMeasure", "計測を開始");
  elements.stopTrackingButton.disabled = Boolean(state.readOnly) || !state.active;
  elements.resetTrackingButton.disabled = Boolean(state.readOnly) || !state.active;
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

elements.openHistoryButton?.addEventListener("click", () => setHistoryPanelOpen(true));
elements.closeHistoryButton?.addEventListener("click", () => setHistoryPanelOpen(false));
async function selectHistoryTarget(userCode, { autoFetch = false } = {}) {
  const normalizedCode = String(userCode ?? "").trim();
  setHistoryPanelOpen(true);
  elements.selectHistoryTargetButton.disabled = true;
  try {
    const result = await unwrap(api.selectHistoryProfile(normalizedCode));
    historyPage = 0;
    renderHistoryState(result.history);
    let currentHistory = result.history;
    if (autoFetch && currentHistory?.viewingOther && currentHistory.canFetch) {
      currentHistory = await unwrap(api.fetchHistory());
      historyPage = 0;
      renderHistoryState(currentHistory);
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
    const button = target?.closest("[data-history-opponent-code]");
    if (!button) return;
    void selectHistoryTarget(button.dataset.historyOpponentCode, { autoFetch: true });
  });
}
elements.clearHistoryTargetButton?.addEventListener("click", async () => {
  elements.clearHistoryTargetButton.disabled = true;
  try {
    historyPage = 0;
    renderHistoryState(await unwrap(api.clearHistoryProfile()));
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
elements.historyPreviousButton?.addEventListener("click", () => {
  historyPage = Math.max(0, historyPage - 1);
  renderHistoryState();
});
elements.historyNextButton?.addEventListener("click", () => {
  historyPage += 1;
  renderHistoryState();
});
elements.fetchHistoryButton?.addEventListener("click", async () => {
  elements.fetchHistoryButton.disabled = true;
  try {
    historyPage = 0;
    renderHistoryState(await unwrap(api.fetchHistory()));
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

elements.graphMatchCountInput.addEventListener("change", async () => {
  renderDisplaySettings(
    await unwrap(
      api.updateDisplaySettings({
        graphMatchCount: Number(elements.graphMatchCountInput.value),
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

window.addEventListener("resize", () => {
  fitManagementScoreValues();
  if (trackerState) {
    renderManagementChart(trackerState);
  }
  if (historyPanelOpen) renderHistoryState();
});

setInterval(renderNextUpdate, 1000);
setInterval(() => {
  if (historyPanelOpen) renderHistoryState();
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
api.onHistoryState?.((state) => {
  historyPage = 0;
  renderHistoryState(state);
});
api.onUpdateState(renderUpdate);
api.onDisplaySettings(renderDisplaySettings);
api.onAuthenticatedPlayer((player) => {
  applyAuthenticatedPlayer(player);
  showNotice(t("autoPlayerConfigured", "ログイン中のプレイヤーを自動設定しました"), "success");
});

Promise.all([
  unwrap(api.getState()),
  unwrap(api.getHistoryState ? api.getHistoryState() : Promise.resolve({ records: [] })),
  unwrap(api.getUpdateState()),
  unwrap(api.getDisplaySettings()),
])
  .then(async ([state, savedHistory, updateState, settings]) => {
    renderDisplaySettings(settings);
    await populateInstalledFonts(settings.fontFamily);
    renderTracker(state);
    historyPage = 0;
    renderHistoryState(savedHistory);
    renderUpdate(updateState);
  })
  .catch((error) => showNotice(error.message, "error"));
