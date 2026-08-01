"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  screen,
  session,
} = require("electron");
const {
  SERVICE_ORIGIN,
  applyNewReplays,
  createEmptyMatchStats,
  normalizeFighter,
  normalizeReplay,
  parseBuildId,
  resetRatingSeries,
  snapshotCurrentCharacter,
} = require("./source-client");
const {
  MAX_CONSECUTIVE_FAILURES,
  POLL_JITTER_MAX_MS,
  SERVICE_REQUEST_MIN_GAP_MS,
  errorBackoffMs,
  shouldAutoStopForInactivity,
  successfulPollDelayMs,
} = require("./poll-policy");
const { createUpdater } = require("./updater");

const APP_NAME = "MatchSessionOverlay";
const OVERLAY_HOST = "127.0.0.1";
const OVERLAY_PORT = 37123;
const LOGIN_PARTITION = "persist:source-login";
const STATS_WINDOW_PRESETS = {
  window: {
    horizontal: {
      width: 760,
      height: 180,
      minWidth: 560,
      minHeight: 150,
      maxWidth: 1200,
      maxHeight: 300,
    },
    vertical: {
      width: 380,
      height: 760,
      minWidth: 320,
      minHeight: 560,
      maxWidth: 560,
      maxHeight: 1100,
    },
    chart: { width: 520, height: 240, minWidth: 380, minHeight: 180 },
    summary: { width: 520, height: 102, minWidth: 320, minHeight: 82 },
    maxWidth: 1000,
    maxHeight: 420,
  },
  overlay: {
    chart: { width: 480, height: 120, minWidth: 320, minHeight: 92 },
    summary: { width: 480, height: 72, minWidth: 300, minHeight: 68 },
    maxWidth: 1000,
    maxHeight: 300,
  },
};
const WINDOW_ORIENTATIONS = new Set(["horizontal", "vertical"]);
const FONT_KEYS = new Set(["street", "condensed", "system", "japanese", "mono"]);
const FONT_FAMILY_PATTERN = /^[\p{L}\p{M}\p{N}\p{Zs}._&'()\-+#@]{1,100}$/u;
const POLL_INTERVAL_OPTIONS = new Set([120, 180, 300]);
const SERVICE_FETCH_TIMEOUT_MS = 30_000;
const MAX_SERVICE_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
// Keep this allow-list in the main process so a malformed settings file
// cannot inject an arbitrary locale into renderer state.
const LOCALE_KEYS = new Set([
  "ja-jp",
  "en",
  "de",
  "es-es",
  "es-us",
  "fr",
  "it",
  "ko-kr",
  "zh-hans",
  "zh-hant",
  "pt-br",
  "pl",
  "ru",
  "ar",
]);
const execFileAsync = promisify(execFile);
const backgroundMode = process.argv.includes("--background");

const FALLBACK_INSTALLED_FONTS = [
  "Impact",
  "Arial",
  "Segoe UI",
  "Bahnschrift",
  "Meiryo",
  "Yu Gothic UI",
  "Consolas",
];

function normalizeFontFamily(value) {
  if (FONT_KEYS.has(value)) return value;
  if (typeof value !== "string") return null;
  const family = value.trim();
  return FONT_FAMILY_PATTERN.test(family) ? family : null;
}

function decodeRegistryOutput(value) {
  if (!Buffer.isBuffer(value)) return String(value ?? "");
  try {
    return new TextDecoder("shift_jis").decode(value);
  } catch {
    return value.toString("utf8");
  }
}

function normalizeRegistryFontName(value) {
  return String(value ?? "")
    .replace(/\s+\((?:TrueType|OpenType|Type 1|TTC)\)$/i, "")
    .replace(/\s+(?:Bold Italic|Bold Oblique|Semibold|Semilight|Italic|Oblique|Bold|Light|Black|Regular|Narrow)$/i, "")
    .trim();
}

async function listInstalledFonts() {
  if (process.platform !== "win32") return FALLBACK_INSTALLED_FONTS;
  const registryKeys = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  ];
  const families = new Map();
  for (const registryKey of registryKeys) {
    try {
      const result = await execFileAsync(
        "reg.exe",
        ["query", registryKey, "/reg:64"],
        { windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: "buffer" },
      );
      const output = decodeRegistryOutput(result.stdout);
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s{4}(.+?)\s+REG_SZ\s+(.+)$/i);
        if (!match) continue;
        const family = normalizeRegistryFontName(match[1]);
        const safeFamily = normalizeFontFamily(family);
        if (safeFamily && !FONT_KEYS.has(safeFamily)) {
          families.set(safeFamily.toLocaleLowerCase(), safeFamily);
        }
      }
    } catch {
      // A locked-down Windows installation may deny registry reads. The
      // renderer still receives a small safe fallback list in that case.
    }
  }
  const result = [...families.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  return result.length ? result : FALLBACK_INSTALLED_FONTS;
}

app.setName("Match Session Overlay");

const localDataRoot =
  !app.isPackaged && process.env.MATCH_OVERLAY_DEV_DATA_ROOT
    ? path.resolve(process.env.MATCH_OVERLAY_DEV_DATA_ROOT)
    : path.join(
        process.env.LOCALAPPDATA || app.getPath("appData"),
        APP_NAME,
      );
const userDataPath = path.join(localDataRoot, "user-data");
const sessionDataPath = path.join(localDataRoot, "session-data");
const displaySettingsPath = path.join(userDataPath, "display-settings.json");
const updateSettingsPath = path.join(userDataPath, "update-settings.json");
const defaultUpdateSourcePath = path.join(localDataRoot, "updates");
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(sessionDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow;
let loginWindow;
let statsWindow;
let overlayServer;
let sourceSession;
let buildId;
let buildIdLocale;
let buildIdInFlight = null;
let pollTimer;
let pollInFlight = false;
let startTrackingInFlight = null;
let authenticationInFlight = null;
let localeRefreshInFlight = null;
let trackingSessionId = 0;
let serviceRequestQueue = Promise.resolve();
let lastServiceRequestAt = 0;
let displaySettingsWriteTimer;
let gameMonitorTimer;
let gameWasRunning = false;
let autoGameSessionActive = false;
let isQuitting = false;
let appUiModalDepth = 0;
let applyingStatsBounds = false;
let overlayEditMode = false;
let overlayEditPreference = false;
let hasPersistedDisplaySettings = fs.existsSync(displaySettingsPath);
let statsWindowDrag = null;
let updater;
let updateRequired = false;
let statsWindowBounds = {
  window: { horizontal: null, vertical: null },
  overlay: null,
};

let trackerState = createEmptyTrackerState();
let displaySettings = {
  mode: "window",
  windowOrientation: "horizontal",
  matchType: "ranked",
  fontScale: 1,
  graphLabelScale: 1.3,
  backgroundOpacity: 0.94,
  graphVisible: true,
  fontFamily: "street",
  fontStyle: "normal",
  textColor: "#f7f8ff",
  pollIntervalSeconds: 120,
  locale: "ja-jp",
  launchAtLogin: false,
  autoDetectGame: false,
  gameExecutableName: "",
};

function serviceLocale() {
  return LOCALE_KEYS.has(displaySettings.locale) ? displaySettings.locale : "ja-jp";
}

function serviceHome() {
  return `${SERVICE_ORIGIN}/6/buckler/${serviceLocale()}`;
}

try {
  const savedSettings = JSON.parse(
    fs.readFileSync(displaySettingsPath, "utf8"),
  );
  if (["window", "overlay"].includes(savedSettings.mode)) {
    displaySettings.mode = savedSettings.mode;
  }
  if (WINDOW_ORIENTATIONS.has(savedSettings.windowOrientation)) {
    displaySettings.windowOrientation = savedSettings.windowOrientation;
  }
  if (["ranked", "battleHub", "casual"].includes(savedSettings.matchType)) {
    displaySettings.matchType = savedSettings.matchType;
  }
  if (Number.isFinite(Number(savedSettings.fontScale))) {
    displaySettings.fontScale = Math.min(
      2,
      Math.max(0.75, Number(savedSettings.fontScale)),
    );
  }
  if (Number.isFinite(Number(savedSettings.graphLabelScale))) {
    displaySettings.graphLabelScale = Math.min(
      2,
      Math.max(0.75, Number(savedSettings.graphLabelScale)),
    );
  }
  if (Number.isFinite(Number(savedSettings.backgroundOpacity))) {
    displaySettings.backgroundOpacity = Math.min(
      1,
      Math.max(0, Number(savedSettings.backgroundOpacity)),
    );
  }
  if (typeof savedSettings.graphVisible === "boolean") {
    displaySettings.graphVisible = savedSettings.graphVisible;
  }
  const savedFontFamily = normalizeFontFamily(savedSettings.fontFamily);
  if (savedFontFamily) displaySettings.fontFamily = savedFontFamily;
  if (["normal", "italic"].includes(savedSettings.fontStyle)) {
    displaySettings.fontStyle = savedSettings.fontStyle;
  }
  if (/^#[0-9a-f]{6}$/i.test(savedSettings.textColor)) {
    displaySettings.textColor = savedSettings.textColor.toLowerCase();
  }
  if (POLL_INTERVAL_OPTIONS.has(Number(savedSettings.pollIntervalSeconds))) {
    displaySettings.pollIntervalSeconds = Number(savedSettings.pollIntervalSeconds);
  }
  if (LOCALE_KEYS.has(savedSettings.locale)) {
    displaySettings.locale = savedSettings.locale;
  }
  const legacyAutoLaunch = savedSettings.autoLaunchWithGame === true;
  displaySettings.launchAtLogin =
    typeof savedSettings.launchAtLogin === "boolean"
      ? savedSettings.launchAtLogin
      : legacyAutoLaunch;
  displaySettings.autoDetectGame =
    typeof savedSettings.autoDetectGame === "boolean"
      ? savedSettings.autoDetectGame
      : legacyAutoLaunch;
  if (isSafeExecutableName(savedSettings.gameExecutableName)) {
    displaySettings.gameExecutableName = savedSettings.gameExecutableName;
  }
  if (savedSettings.windowBounds && typeof savedSettings.windowBounds === "object") {
    const savedWindowBounds = savedSettings.windowBounds.window;
    const nestedWindowBounds =
      savedWindowBounds &&
      typeof savedWindowBounds === "object" &&
      ("horizontal" in savedWindowBounds || "vertical" in savedWindowBounds)
        ? savedWindowBounds
        : { horizontal: savedWindowBounds, vertical: null };
    statsWindowBounds = {
      window: {
        horizontal: sanitizeSavedBounds(nestedWindowBounds.horizontal),
        vertical: sanitizeSavedBounds(nestedWindowBounds.vertical),
      },
      overlay: sanitizeSavedBounds(savedSettings.windowBounds.overlay),
    };
  }
} catch {
  // 初回起動、または設定ファイル破損時は安全な既定値を使う。
}
overlayEditPreference = !hasPersistedDisplaySettings;

function createEmptyTrackerState() {
  return {
    active: false,
    player: null,
    wins: 0,
    losses: 0,
    streak: 0,
    initialRating: null,
    currentRating: null,
    ratingType: "MR",
    characterId: null,
    characterStates: {},
    ratingDelta: 0,
    lastMatch: null,
    startedAt: null,
    updatedAt: null,
    lastNewMatchAt: null,
    nextPollAt: null,
    effectivePollIntervalSeconds: null,
    consecutiveFailures: 0,
    stopReason: null,
    seenReplayIds: [],
    stats: createEmptyMatchStats(),
    status: "停止中",
    overlayUrl: `http://${OVERLAY_HOST}:${OVERLAY_PORT}/overlay`,
  };
}

function publicTrackerState() {
  const {
    seenReplayIds: _privateIds,
    characterStates: _privateCharacterStates,
    ...publicState
  } = trackerState;
  return {
    ...publicState,
    selectedMatchType: displaySettings.matchType,
    displaySettings: publicDisplaySettings(),
  };
}

function publicOverlayState() {
  const liveOverlayBounds =
    displaySettings.mode === "overlay" &&
    statsWindow &&
    !statsWindow.isDestroyed()
      ? statsWindow.getBounds()
      : null;
  const savedOverlayBounds = statsWindowBounds.overlay;
  const fallbackOverlaySize = {
    width: STATS_WINDOW_PRESETS.overlay.chart.minWidth,
    height: STATS_WINDOW_PRESETS.overlay.chart.minHeight,
  };
  const overlaySize =
    liveOverlayBounds ?? savedOverlayBounds ?? fallbackOverlaySize;
  return {
    active: trackerState.active,
    stats: trackerState.stats,
    ratingType: trackerState.ratingType,
    selectedMatchType: displaySettings.matchType,
    overlaySize: {
      width: Math.min(
        1000,
        Math.max(300, Number(overlaySize.width) || fallbackOverlaySize.width),
      ),
      height: Math.min(
        300,
        Math.max(68, Number(overlaySize.height) || fallbackOverlaySize.height),
      ),
    },
    displaySettings: {
      matchType: displaySettings.matchType,
      fontScale: displaySettings.fontScale,
      graphLabelScale: displaySettings.graphLabelScale,
      backgroundOpacity: displaySettings.backgroundOpacity,
      graphVisible: displaySettings.graphVisible,
      fontFamily: displaySettings.fontFamily,
      fontStyle: displaySettings.fontStyle,
      textColor: displaySettings.textColor,
      locale: displaySettings.locale,
    },
  };
}

function sendTrackerState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tracker:state", publicTrackerState());
  }
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.webContents.send("tracker:state", publicTrackerState());
  }
}

function publicDisplaySettings({ statsWindowVisible } = {}) {
  const actualStatsWindowVisible =
    Boolean(statsWindow) &&
    !statsWindow.isDestroyed() &&
    statsWindow.isVisible();
  return {
    ...displaySettings,
    overlayInteractionLocked: !overlayEditMode,
    statsWindowVisible: statsWindowVisible ?? actualStatsWindowVisible,
  };
}

function isSafeExecutableName(value) {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[^\\/:*?"<>|]+\.exe$/i.test(value)
  );
}

function sanitizeSavedBounds(value) {
  if (!value || typeof value !== "object") return null;
  const bounds = {
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
  };
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
}

function savedSettingsPayload() {
  return {
    ...displaySettings,
    windowBounds: statsWindowBounds,
  };
}

function scheduleSettingsWrite() {
  clearTimeout(displaySettingsWriteTimer);
  displaySettingsWriteTimer = setTimeout(() => {
    fs.promises
      .writeFile(
        displaySettingsPath,
        JSON.stringify(savedSettingsPayload(), null, 2),
        "utf8",
      )
      .catch(() => {});
  }, 150);
}

function isBoundsVisible(bounds) {
  if (!bounds || !app.isReady()) return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
        Math.max(bounds.x, workArea.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
        Math.max(bounds.y, workArea.y),
    );
    return overlapWidth >= 80 && overlapHeight >= 40;
  });
}

function isUsableStatsBounds(bounds, preset) {
  return (
    isBoundsVisible(bounds) &&
    bounds.width >= preset.minWidth &&
    bounds.height >= preset.minHeight &&
    bounds.width <= preset.maxWidth &&
    bounds.height <= preset.maxHeight
  );
}

function rememberStatsWindowBounds(mode = displaySettings.mode) {
  if (
    applyingStatsBounds ||
    !statsWindow ||
    statsWindow.isDestroyed() ||
    !["window", "overlay"].includes(mode)
  ) {
    return;
  }
  if (mode === "window") {
    statsWindowBounds.window[displaySettings.windowOrientation] =
      statsWindow.getBounds();
  } else {
    statsWindowBounds[mode] = statsWindow.getBounds();
  }
  scheduleSettingsWrite();
}

function savedStatsWindowBounds(mode = displaySettings.mode) {
  return mode === "window"
    ? statsWindowBounds.window[displaySettings.windowOrientation]
    : statsWindowBounds[mode];
}

function currentStatsWindowPreset() {
  const modePreset = STATS_WINDOW_PRESETS[displaySettings.mode];
  const sizePreset =
    displaySettings.mode === "window"
      ? modePreset[displaySettings.windowOrientation] ?? modePreset.horizontal
      : modePreset.summary;
  return {
    ...sizePreset,
    maxWidth: sizePreset.maxWidth ?? modePreset.maxWidth,
    maxHeight: sizePreset.maxHeight ?? modePreset.maxHeight,
  };
}

function sendDisplaySettings() {
  for (const target of [mainWindow, statsWindow]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send("display:settings", publicDisplaySettings());
    }
  }
}

function syncStatsAlwaysOnTop() {
  if (!statsWindow || statsWindow.isDestroyed()) return;
  const keepAboveGame =
    displaySettings.mode === "overlay" && appUiModalDepth === 0;
  const wasVisible = statsWindow.isVisible();
  if (wasVisible) statsWindow.hide();
  if (keepAboveGame) {
    statsWindow.setAlwaysOnTop(true, "screen-saver");
  } else {
    statsWindow.setAlwaysOnTop(false);
  }
  if (wasVisible) statsWindow.showInactive();
}

function syncStatsInteractionMode({ updateFocusable = true } = {}) {
  if (!statsWindow || statsWindow.isDestroyed()) return;
  const isOverlay = displaySettings.mode === "overlay";
  const clickThrough = isOverlay && !overlayEditMode;
  statsWindow.setMovable(!clickThrough);
  if (updateFocusable) statsWindow.setFocusable(!isOverlay);
  if (clickThrough) {
    statsWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    statsWindow.setIgnoreMouseEvents(false);
  }
}

function syncMainWindowGameFocusMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const preserveGameFocus = gameWasRunning && appUiModalDepth === 0;
  // 管理画面はゲーム起動中も移動・操作できる必要がある。ゲームへの
  // フォーカス復帰は表示時の showInactive とオーバーレイ側で制御する。
  mainWindow.setFocusable(true);
  mainWindow.setMovable(true);
  if (preserveGameFocus && mainWindow.isVisible()) {
    mainWindow.blur();
    mainWindow.showInactive();
  }
}

function beginAppUiModal() {
  appUiModalDepth += 1;
  syncStatsAlwaysOnTop();
  syncMainWindowGameFocusMode();
}

function endAppUiModal() {
  appUiModalDepth = Math.max(0, appUiModalDepth - 1);
  syncStatsAlwaysOnTop();
  syncMainWindowGameFocusMode();
}

function applyDisplayMode({
  resizeToPreset = false,
  restoreSavedBounds = false,
} = {}) {
  if (!statsWindow || statsWindow.isDestroyed()) return;
  const isOverlay = displaySettings.mode === "overlay";
  const wasVisible = statsWindow.isVisible();
  const shouldUpdateShellStyles = !wasVisible || resizeToPreset;
  if (!shouldUpdateShellStyles) return;
  // モード切替中に表示されたままタスクバー関連のスタイルを変更すると、
  // Windowsのシェルがタスクバーを再描画して一時表示することがある。
  // 表示中のウィンドウだけを一度隠し、設定後に非アクティブで戻す。
  if (wasVisible) {
    statsWindow.hide();
  }
  const preset = currentStatsWindowPreset();
  statsWindow.setMinimumSize(preset.minWidth, preset.minHeight);
  statsWindow.setMaximumSize(preset.maxWidth, preset.maxHeight);
  if (resizeToPreset) {
    const savedBounds = restoreSavedBounds
      ? savedStatsWindowBounds()
      : null;
    const currentBounds = statsWindow.getBounds();
    const nextBounds = isUsableStatsBounds(savedBounds, preset)
      ? savedBounds
      : {
          x: currentBounds.x,
          y: currentBounds.y,
          width: preset.width,
          height: preset.height,
        };
    applyingStatsBounds = true;
    statsWindow.setBounds(nextBounds, true);
    applyingStatsBounds = false;
  }
  syncStatsAlwaysOnTop();
  statsWindow.setSkipTaskbar(isOverlay);
  syncStatsInteractionMode();
  statsWindow.setVisibleOnAllWorkspaces(isOverlay, {
    visibleOnFullScreen: isOverlay,
  });
  if (wasVisible) {
    statsWindow.showInactive();
  }
}

function updateDisplaySettings(
  nextSettings = {},
  { forceOverlayLocked = false } = {},
) {
  ensureUpdateAllowed();
  const previousMode = displaySettings.mode;
  const previousOrientation = displaySettings.windowOrientation;
  const previousLocale = displaySettings.locale;
  const previousPollInterval = displaySettings.pollIntervalSeconds;
  const previousLaunchAtLogin = displaySettings.launchAtLogin;
  const previousAutoDetectGame = displaySettings.autoDetectGame;
  const previousGameExecutable = displaySettings.gameExecutableName;
  const orientationChanging =
    WINDOW_ORIENTATIONS.has(nextSettings.windowOrientation) &&
    nextSettings.windowOrientation !== previousOrientation;
  if (orientationChanging && previousMode === "window") {
    // Preserve the current layout before switching the active orientation so
    // returning to it restores the exact size and position the user left.
    rememberStatsWindowBounds("window");
  }
  if (
    ["window", "overlay"].includes(nextSettings.mode) &&
    nextSettings.mode !== displaySettings.mode
  ) {
    rememberStatsWindowBounds(previousMode);
    displaySettings.mode = nextSettings.mode;
    overlayEditMode =
      displaySettings.mode === "overlay" &&
      overlayEditPreference &&
      !forceOverlayLocked;
    statsWindowDrag = null;
  }
  if (WINDOW_ORIENTATIONS.has(nextSettings.windowOrientation)) {
    displaySettings.windowOrientation = nextSettings.windowOrientation;
  }
  if (["ranked", "battleHub", "casual"].includes(nextSettings.matchType)) {
    displaySettings.matchType = nextSettings.matchType;
  }
  if (Number.isFinite(Number(nextSettings.fontScale))) {
    displaySettings.fontScale = Math.min(
      2,
      Math.max(0.75, Number(nextSettings.fontScale)),
    );
  }
  if (Number.isFinite(Number(nextSettings.graphLabelScale))) {
    displaySettings.graphLabelScale = Math.min(
      2,
      Math.max(0.75, Number(nextSettings.graphLabelScale)),
    );
  }
  if (Number.isFinite(Number(nextSettings.backgroundOpacity))) {
    displaySettings.backgroundOpacity = Math.min(
      1,
      Math.max(0, Number(nextSettings.backgroundOpacity)),
    );
  }
  if (typeof nextSettings.graphVisible === "boolean") {
    displaySettings.graphVisible = nextSettings.graphVisible;
  }
  const nextFontFamily = normalizeFontFamily(nextSettings.fontFamily);
  if (nextFontFamily) displaySettings.fontFamily = nextFontFamily;
  if (["normal", "italic"].includes(nextSettings.fontStyle)) {
    displaySettings.fontStyle = nextSettings.fontStyle;
  }
  if (/^#[0-9a-f]{6}$/i.test(nextSettings.textColor)) {
    displaySettings.textColor = nextSettings.textColor.toLowerCase();
  }
  if (POLL_INTERVAL_OPTIONS.has(Number(nextSettings.pollIntervalSeconds))) {
    displaySettings.pollIntervalSeconds = Number(nextSettings.pollIntervalSeconds);
  }
  if (LOCALE_KEYS.has(nextSettings.locale)) {
    displaySettings.locale = nextSettings.locale;
  }
  if (previousLocale !== displaySettings.locale) {
    // The Next.js build id and data route are locale-scoped. Do not reuse a
    // build id fetched from the previous language after a locale switch.
    buildId = null;
    buildIdLocale = null;
    buildIdInFlight = null;
    if (trackerState.active && trackerState.player?.userCode) {
      void refreshTrackedPlayerForLocale();
    }
  }
  if (typeof nextSettings.launchAtLogin === "boolean") {
    displaySettings.launchAtLogin = nextSettings.launchAtLogin;
  }
  if (typeof nextSettings.autoDetectGame === "boolean") {
    displaySettings.autoDetectGame = nextSettings.autoDetectGame;
  }
  if (isSafeExecutableName(nextSettings.gameExecutableName)) {
    displaySettings.gameExecutableName = nextSettings.gameExecutableName;
  }
  applyDisplayMode({
    resizeToPreset:
      previousMode !== displaySettings.mode ||
      previousOrientation !== displaySettings.windowOrientation,
    restoreSavedBounds:
      previousMode !== displaySettings.mode ||
      previousOrientation !== displaySettings.windowOrientation,
  });
  scheduleSettingsWrite();
  sendDisplaySettings();
  if (
    trackerState.active &&
    previousPollInterval !== displaySettings.pollIntervalSeconds
  ) {
    schedulePolling();
  }
  if (previousLaunchAtLogin !== displaySettings.launchAtLogin) {
    configureLaunchAtLogin();
  }
  if (
    previousAutoDetectGame !== displaySettings.autoDetectGame ||
    previousGameExecutable !== displaySettings.gameExecutableName
  ) {
    configureLaunchAtLogin();
    configureGameDetection();
  }
  return publicDisplaySettings();
}

function toggleOverlayInteraction() {
  if (displaySettings.mode !== "overlay") {
    overlayEditMode = false;
    sendDisplaySettings();
    return publicDisplaySettings();
  }
  overlayEditMode = !overlayEditMode;
  overlayEditPreference = overlayEditMode;
  statsWindowDrag = null;
  // 移動／固定の切り替えでは、タスクバーや最前面状態を再設定しない。
  // Windowsではそれらの再設定がシェルの再描画を誘発することがあるため、
  // ここではマウス透過と移動可否だけを変更する。
  syncStatsInteractionMode({ updateFocusable: false });
  if (statsWindow && !statsWindow.isDestroyed()) statsWindow.blur();
  sendDisplaySettings();
  return publicDisplaySettings();
}

function isValidScreenPoint(payload) {
  return (
    payload &&
    Number.isFinite(Number(payload.screenX)) &&
    Number.isFinite(Number(payload.screenY)) &&
    Math.abs(Number(payload.screenX)) < 100_000 &&
    Math.abs(Number(payload.screenY)) < 100_000
  );
}

function canDragStatsWindow(event) {
  const canMoveWindow = displaySettings.mode === "window";
  const canMoveOverlay =
    displaySettings.mode === "overlay" && overlayEditMode;
  return (
    !updateRequired &&
    (canMoveWindow || canMoveOverlay) &&
    statsWindow &&
    !statsWindow.isDestroyed() &&
    event.sender === statsWindow.webContents
  );
}

function beginStatsWindowDrag(event, payload) {
  if (!canDragStatsWindow(event) || !isValidScreenPoint(payload)) return;
  const [windowX, windowY] = statsWindow.getPosition();
  statsWindowDrag = {
    pointerX: Number(payload.screenX),
    pointerY: Number(payload.screenY),
    windowX,
    windowY,
  };
}

function moveStatsWindowDrag(event, payload) {
  if (
    !statsWindowDrag ||
    !canDragStatsWindow(event) ||
    !isValidScreenPoint(payload)
  ) {
    return;
  }
  statsWindow.setPosition(
    Math.round(
      statsWindowDrag.windowX +
        Number(payload.screenX) -
        statsWindowDrag.pointerX,
    ),
    Math.round(
      statsWindowDrag.windowY +
        Number(payload.screenY) -
        statsWindowDrag.pointerY,
    ),
    false,
  );
}

function endStatsWindowDrag(event) {
  if (!canDragStatsWindow(event)) return;
  statsWindowDrag = null;
  rememberStatsWindowBounds();
}

async function isConfiguredGameRunning() {
  const executableName = displaySettings.gameExecutableName;
  if (!isSafeExecutableName(executableName)) return false;
  const tasklistPath = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "tasklist.exe",
  );
  const { stdout } = await execFileAsync(
    tasklistPath,
    ["/FI", `IMAGENAME eq ${executableName}`, "/FO", "CSV", "/NH"],
    { windowsHide: true, encoding: "utf8" },
  );
  return stdout.toLowerCase().includes(`"${executableName.toLowerCase()}"`);
}

async function checkConfiguredGame() {
  if (updateRequired) return;
  let running;
  try {
    running = await isConfiguredGameRunning();
  } catch {
    return;
  }
  if (running === gameWasRunning) return;
  gameWasRunning = running;
  syncMainWindowGameFocusMode();

  if (running) {
    overlayEditMode = false;
    updateDisplaySettings(
      { mode: "overlay" },
      { forceOverlayLocked: true },
    );
    if (trackerState.active) {
      openStatsWindow();
      return;
    }
    try {
      const { player } = await checkAuthentication();
      await startTracking(player);
      autoGameSessionActive = true;
    } catch (error) {
      trackerState.status = friendlyError(error);
      trackerState.updatedAt = Date.now();
      sendTrackerState();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.showInactive();
      }
    }
    return;
  }

  if (autoGameSessionActive) {
    autoGameSessionActive = false;
    stopTracking();
    if (statsWindow && !statsWindow.isDestroyed()) {
      statsWindowDrag = null;
      statsWindow.hide();
      sendDisplaySettings();
    }
  }
}

function configureLaunchAtLogin() {
  if (app.isPackaged) {
    const backgroundGameWatcher =
      displaySettings.autoDetectGame &&
      isSafeExecutableName(displaySettings.gameExecutableName);
    app.setLoginItemSettings({
      openAtLogin: displaySettings.launchAtLogin || backgroundGameWatcher,
      args: displaySettings.launchAtLogin ? [] : ["--background"],
    });
  }
}

function configureGameDetection() {
  clearInterval(gameMonitorTimer);
  gameMonitorTimer = null;
  gameWasRunning = false;
  syncMainWindowGameFocusMode();
  if (
    !displaySettings.autoDetectGame ||
    !isSafeExecutableName(displaySettings.gameExecutableName)
  ) {
    return;
  }
  checkConfiguredGame();
  gameMonitorTimer = setInterval(checkConfiguredGame, 10_000);
}

async function chooseGameExecutable() {
  beginAppUiModal();
  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, {
      title: "ゲームの実行ファイルを選択",
      properties: ["openFile"],
      filters: [{ name: "実行ファイル", extensions: ["exe"] }],
    });
  } finally {
    endAppUiModal();
  }
  if (result.canceled || !result.filePaths[0]) {
    return publicDisplaySettings();
  }
  const executableName = path.basename(result.filePaths[0]);
  if (!isSafeExecutableName(executableName)) {
    throw new Error("INVALID_GAME_EXECUTABLE");
  }
  return updateDisplaySettings({ gameExecutableName: executableName });
}

async function chooseUpdateDirectory() {
  beginAppUiModal();
  let result;
  try {
    result = await dialog.showOpenDialog(mainWindow, {
      title: "更新ファイルのフォルダを選択",
      defaultPath: updater.getSourceDirectory(),
      properties: ["openDirectory"],
    });
  } finally {
    endAppUiModal();
  }
  if (result.canceled || !result.filePaths[0]) {
    return updater.getState();
  }
  return updater.setSourceDirectory(result.filePaths[0]);
}

function isAllowedAuthUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return [
      "streetfighter.com",
      "capcom.com",
      "capcom.co.jp",
      "capcomid.com",
      "capcom-id.com",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function configureRemoteSession(ses) {
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function loadRendererFile(targetWindow, filePath) {
  // Use an explicit file URL so packaged Windows builds resolve files inside
  // app.asar consistently, including paths containing spaces.
  return targetWindow.loadURL(pathToFileURL(filePath).toString());
}

function createMainWindow() {
  const workAreaHeight = screen.getPrimaryDisplay().workAreaSize.height;
  const initialHeight = Math.min(800, Math.max(720, workAreaHeight - 40));
  const minimumHeight = Math.min(760, initialHeight);
  mainWindow = new BrowserWindow({
    width: 1040,
    height: initialHeight,
    minWidth: 920,
    minHeight: minimumHeight,
    show: false,
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadRendererFile(mainWindow, path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    checkAuthentication()
      .then(({ player }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("auth:player", player);
        }
      })
      .catch(() => {});
  });
  mainWindow.once("ready-to-show", () => {
    if (!backgroundMode) mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!isQuitting) app.quit();
  });
}

function openStatsWindow() {
  ensureUpdateAllowed();
  if (statsWindow && !statsWindow.isDestroyed()) {
    if (displaySettings.mode === "overlay") {
      statsWindow.showInactive();
    } else {
      statsWindow.show();
      statsWindow.focus();
    }
    sendDisplaySettings();
    return publicDisplaySettings();
  }

  const preset = currentStatsWindowPreset();
  const savedBounds = savedStatsWindowBounds();
  const initialBounds = isUsableStatsBounds(savedBounds, preset)
    ? savedBounds
    : { width: preset.width, height: preset.height };
  statsWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: preset.minWidth,
    minHeight: preset.minHeight,
    maxWidth: preset.maxWidth,
    maxHeight: preset.maxHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  statsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadRendererFile(statsWindow, path.join(__dirname, "renderer", "stats.html"));
  statsWindow.once("ready-to-show", () => {
    applyDisplayMode();
    sendTrackerState();
    if (displaySettings.mode === "overlay") {
      statsWindow.showInactive();
    } else {
      statsWindow.show();
    }
    sendDisplaySettings();
  });
  statsWindow.on("move", () => rememberStatsWindowBounds());
  statsWindow.on("resize", () => rememberStatsWindowBounds());
  statsWindow.on("closed", () => {
    rememberStatsWindowBounds();
    statsWindowDrag = null;
    statsWindow = null;
    sendDisplaySettings();
  });
  // BrowserWindowの表示はready-to-show後だが、操作結果は先に表示状態へ反映する。
  return publicDisplaySettings({ statsWindowVisible: true });
}

function toggleStatsWindow() {
  if (
    statsWindow &&
    !statsWindow.isDestroyed() &&
    statsWindow.isVisible()
  ) {
    statsWindowDrag = null;
    statsWindow.hide();
    sendDisplaySettings();
    return publicDisplaySettings();
  }
  return openStatsWindow();
}

function openLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  beginAppUiModal();
  let modalReleased = false;
  const releaseAppUiModal = () => {
    if (modalReleased) return;
    modalReleased = true;
    endAppUiModal();
  };
  try {
    loginWindow = new BrowserWindow({
      width: 920,
      height: 760,
      parent: mainWindow,
      modal: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        partition: LOGIN_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    loginWindow.setMenuBarVisibility(false);
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedAuthUrl(url)) {
        loginWindow.loadURL(url);
      }
      return { action: "deny" };
    });
    loginWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedAuthUrl(url)) {
        event.preventDefault();
      }
    });
    loginWindow.loadURL(
      `${serviceHome()}/auth/loginep?redirect_url=/fighterslist/search`,
    );
    loginWindow.on("closed", () => {
      loginWindow = null;
      releaseAppUiModal();
      checkAuthentication()
        .then(({ player }) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("auth:player", player);
          }
        })
        .catch(() => {});
    });
  } catch (error) {
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
    loginWindow = null;
    releaseAppUiModal();
    throw error;
  }
}

async function clearPrivateDataWithConfirmation() {
  beginAppUiModal();
  let response;
  try {
    ({ response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "ローカルデータを消去",
      message:
        "公式サイトのログインセッション、Cookie、キャッシュをこのPCから削除します。",
      detail: "この操作は元に戻せません。",
      buttons: ["消去", "キャンセル"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }));
  } finally {
    endAppUiModal();
  }
  if (response !== 0) return { cleared: false };

  stopTracking();
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  await sourceSession.clearData();
  await sourceSession.clearAuthCache();
  buildId = null;
  return { cleared: true };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fetchServiceWithRateLimit(url, options) {
  const request = serviceRequestQueue
    .catch(() => {})
    .then(async () => {
      const remainingDelay = Math.max(
        0,
        lastServiceRequestAt + SERVICE_REQUEST_MIN_GAP_MS - Date.now(),
      );
      if (remainingDelay > 0) await wait(remainingDelay);
      lastServiceRequestAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        SERVICE_FETCH_TIMEOUT_MS,
      );
      try {
        return await sourceSession.fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  serviceRequestQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

async function loadBuildId(force = false) {
  const requestedLocale = serviceLocale();
  if (buildId && buildIdLocale === requestedLocale && !force) return buildId;
  if (buildIdInFlight) return buildIdInFlight;
  buildIdInFlight = (async () => {
    const response = await fetchServiceWithRateLimit(
      `${SERVICE_ORIGIN}/6/buckler/${requestedLocale}`,
      {
        credentials: "include",
        redirect: "follow",
        headers: { Accept: "text/html" },
      },
    );
    if (!response.ok) {
      throw new Error(`SERVICE_HTTP_${response.status}`);
    }
    const nextBuildId = parseBuildId(await response.text());
    if (serviceLocale() === requestedLocale) {
      buildId = nextBuildId;
      buildIdLocale = requestedLocale;
    }
    return nextBuildId;
  })();
  try {
    return await buildIdInFlight;
  } finally {
    buildIdInFlight = null;
  }
}

async function fetchServiceJson(relativePath, query = {}, retry = true) {
  const currentBuildId = await loadBuildId();
  const url = new URL(
    `/6/buckler/_next/data/${currentBuildId}/${serviceLocale()}/${relativePath}`,
    SERVICE_ORIGIN,
  );
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchServiceWithRateLimit(url.toString(), {
    credentials: "include",
    redirect: "follow",
    headers: { Accept: "application/json" },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = Number(retryAfter);
    const retryAfterDate = Number.isNaN(retryAfterSeconds)
      ? Date.parse(retryAfter)
      : NaN;
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds * 1000)
      : Number.isFinite(retryAfterDate)
        ? Math.max(0, retryAfterDate - Date.now())
        : 0;
    const error = new Error("SERVICE_RATE_LIMITED");
    error.retryAfterMs = Math.min(MAX_SERVICE_RETRY_DELAY_MS, retryAfterMs);
    throw error;
  }

  if (response.status === 404 && retry) {
    if (buildId === currentBuildId) {
      await loadBuildId(true);
    }
    return fetchServiceJson(relativePath, query, false);
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.url.includes("/auth/loginep")
  ) {
    throw new Error("SERVICE_AUTH_REQUIRED");
  }
  if (!response.ok) {
    throw new Error(`SERVICE_HTTP_${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    throw new Error("SERVICE_AUTH_REQUIRED");
  }
  return response.json();
}

async function checkAuthenticationInternal() {
  const data = await fetchServiceJson("fighterslist/friend.json");
  if (!data?.pageProps) {
    throw new Error("SERVICE_AUTH_REQUIRED");
  }
  const loginUser = data.pageProps.common?.loginUser;
  const userCode = String(loginUser?.shortId ?? "");
  if (loginUser?.flg !== true || !/^\d{4,12}$/.test(userCode)) {
    throw new Error("SERVICE_SELF_NOT_FOUND");
  }
  let player;
  try {
    player = await searchPlayer(userCode);
  } catch (error) {
    if (error.message === "PLAYER_NOT_FOUND") {
      throw new Error("SERVICE_SELF_NOT_FOUND");
    }
    throw error;
  }
  return { authenticated: true, player };
}

async function checkAuthentication() {
  ensureUpdateAllowed();
  if (authenticationInFlight) return authenticationInFlight;
  authenticationInFlight = checkAuthenticationInternal();
  try {
    return await authenticationInFlight;
  } finally {
    authenticationInFlight = null;
  }
}

async function searchPlayer(userCode) {
  const normalizedCode = String(userCode ?? "").replace(/\s/g, "");
  if (!/^\d{4,12}$/.test(normalizedCode)) {
    throw new Error("INVALID_USER_CODE");
  }

  const data = await fetchServiceJson("fighterslist/search/result.json", {
    short_id: normalizedCode,
    page: 1,
    order_type: "last_play",
    order_order: 0,
  });
  const fighters = (data?.pageProps?.fighter_banner_list ?? [])
    .map(normalizeFighter)
    .filter(Boolean);
  const exact =
    fighters.find((fighter) => fighter.userCode === normalizedCode) ?? null;
  if (!exact) {
    throw new Error("PLAYER_NOT_FOUND");
  }
  return exact;
}

async function refreshTrackedPlayerForLocale() {
  if (!trackerState.active || !trackerState.player?.userCode) return;
  if (localeRefreshInFlight) return localeRefreshInFlight;

  const sessionId = trackingSessionId;
  const userCode = trackerState.player.userCode;
  localeRefreshInFlight = (async () => {
    try {
      const refreshedPlayer = await searchPlayer(userCode);
      if (
        sessionId !== trackingSessionId ||
        !trackerState.active ||
        trackerState.player?.userCode !== userCode
      ) {
        return;
      }
      trackerState.player = refreshedPlayer;
      trackerState.updatedAt = Date.now();
      sendTrackerState();
    } catch {
      // A locale switch must not interrupt an active session if the optional
      // refresh fails. The next scheduled poll will retry through the normal
      // rate-limited path.
    }
  })().finally(() => {
    localeRefreshInFlight = null;
  });
  return localeRefreshInFlight;
}

async function fetchRankedReplays(profileId) {
  const data = await fetchServiceJson(
    `profile/${encodeURIComponent(profileId)}/battlelog.json`,
    { page: 1 },
  );
  return (data?.pageProps?.replay_list ?? [])
    .map((replay) => normalizeReplay(replay, profileId))
    .filter(Boolean);
}

function syncCurrentPlayerRating(state, player, hasNewRankedReplay = false) {
  const currentRating = player?.mr ?? player?.lp ?? null;
  if (currentRating == null) return state;
  if (
    hasNewRankedReplay &&
    state.characterId != null &&
    player.characterId != null &&
    state.characterId !== player.characterId
  ) {
    return state;
  }

  const ratingType = player.mr != null ? "MR" : "LP";
  const previousCharacterId = state.characterId ?? state.player?.characterId;
  const characterChanged =
    previousCharacterId != null &&
    player.characterId != null &&
    previousCharacterId !== player.characterId;
  resetRatingSeries(state, ratingType, characterChanged);
  const ranked = state.stats.ranked;
  state.player = player;
  state.characterId = player.characterId ?? state.characterId;
  state.currentRating = currentRating;
  state.ratingType = ratingType;
  ranked.currentRating = currentRating;
  if (ranked.initialRating == null) {
    ranked.initialRating = currentRating;
  }
  state.initialRating = ranked.initialRating;

  const history = ranked.ratingHistory;
  const lastHistoryIndex = history.length - 1;
  if (lastHistoryIndex < 0) {
    history.push(currentRating);
  } else if (history[lastHistoryIndex] !== currentRating) {
    if (hasNewRankedReplay) {
      history[lastHistoryIndex] = currentRating;
    } else {
      history.push(currentRating);
    }
  }

  ranked.ratingDelta = currentRating - ranked.initialRating;
  state.ratingDelta = ranked.ratingDelta;
  return state;
}

async function startTrackingInternal(player) {
  const resumable =
    !trackerState.active &&
    trackerState.stopReason === "idle" &&
    trackerState.player?.profileId === player.profileId;
  const sessionId = ++trackingSessionId;
  stopPolling();
  const replays = await fetchRankedReplays(player.profileId);
  if (sessionId !== trackingSessionId) return publicTrackerState();
  const now = Date.now();

  if (resumable) {
    const previousReplayIds = new Set(trackerState.seenReplayIds);
    const previousCharacterId = trackerState.characterId;
    const hasNewRankedReplay = replays.some(
      (replay) =>
        replay.matchType === "ranked" &&
        replay.replayId &&
        !previousReplayIds.has(replay.replayId),
    );
    trackerState = applyNewReplays(trackerState, replays);
    const characterChanged =
      previousCharacterId != null &&
      trackerState.characterId != null &&
      previousCharacterId !== trackerState.characterId;
    trackerState = syncCurrentPlayerRating(
      trackerState,
      player,
      hasNewRankedReplay || characterChanged,
    );
    trackerState.active = true;
    trackerState.player = player;
    trackerState.lastNewMatchAt = now;
    trackerState.updatedAt = now;
    trackerState.consecutiveFailures = 0;
    trackerState.stopReason = null;
    trackerState.status = "監視中";
  } else {
    const newestRanked = [...replays]
      .filter((replay) => replay.matchType === "ranked")
      .sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
    const initialRating =
      player.mr ?? player.lp ?? newestRanked?.rating ?? null;
    const stats = createEmptyMatchStats();
    stats.ranked.initialRating = initialRating;
    stats.ranked.currentRating = initialRating;
    stats.ranked.ratingHistory =
      initialRating == null ? [] : [initialRating];

    trackerState = {
      ...createEmptyTrackerState(),
      active: true,
      player,
      startedAt: now,
      updatedAt: now,
      lastNewMatchAt: now,
      seenReplayIds: replays.map((replay) => replay.replayId).filter(Boolean),
      initialRating,
      currentRating: initialRating,
      characterId: player.characterId ?? newestRanked?.characterId ?? null,
      ratingType:
        player.mr != null
          ? "MR"
          : player.lp != null
            ? "LP"
            : newestRanked?.ratingType ?? "MR",
      stats,
      status: "監視中",
    };
  }
  snapshotCurrentCharacter(trackerState);
  sendTrackerState();
  openStatsWindow();

  schedulePolling();
  return publicTrackerState();
}

async function startTracking(player) {
  ensureUpdateAllowed();
  if (trackerState.active) return publicTrackerState();
  if (startTrackingInFlight) return startTrackingInFlight;
  startTrackingInFlight = startTrackingInternal(player);
  try {
    return await startTrackingInFlight;
  } finally {
    startTrackingInFlight = null;
  }
}

function schedulePolling(delayMs = null) {
  stopPolling();
  if (!trackerState.active) return;
  const nextDelay =
    delayMs ??
    successfulPollDelayMs({
      configuredIntervalSeconds: displaySettings.pollIntervalSeconds,
      lastNewMatchAt: trackerState.lastNewMatchAt,
      jitterMs: Math.floor(Math.random() * (POLL_JITTER_MAX_MS + 1)),
    });
  trackerState.nextPollAt = Date.now() + nextDelay;
  trackerState.effectivePollIntervalSeconds = Math.ceil(nextDelay / 1000);
  sendTrackerState();
  const sessionId = trackingSessionId;
  pollTimer = setTimeout(() => runScheduledPoll(sessionId), nextDelay);
}

async function runScheduledPoll(sessionId) {
  pollTimer = null;
  trackerState.nextPollAt = null;
  if (
    pollInFlight ||
    !trackerState.active ||
    sessionId !== trackingSessionId
  ) {
    return;
  }
  pollInFlight = true;
  try {
    await refreshTracking(sessionId);
    if (!trackerState.active || sessionId !== trackingSessionId) return;
    trackerState.consecutiveFailures = 0;
    if (shouldAutoStopForInactivity(trackerState.lastNewMatchAt)) {
      autoStopTracking(
        "idle",
        "新しい対戦が60分間なかったため自動停止しました",
      );
      return;
    }
    schedulePolling();
  } catch (error) {
    if (!trackerState.active || sessionId !== trackingSessionId) return;
    trackerState.updatedAt = Date.now();
    trackerState.consecutiveFailures += 1;
    if (error instanceof Error && error.message === "SERVICE_AUTH_REQUIRED") {
      autoStopTracking(
        "authentication",
        "ログインの有効期限が切れたため自動停止しました",
      );
      return;
    }
    if (error instanceof Error && error.message === "SERVICE_RATE_LIMITED") {
      const retryAfterMs = Number(error.retryAfterMs);
      const retryDelay = Math.max(
        errorBackoffMs(trackerState.consecutiveFailures),
        Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
      );
      trackerState.status = `サーバー混雑のため${Math.ceil(retryDelay / 60000)}分後に再試行します`;
      schedulePolling(retryDelay);
      return;
    }
    if (trackerState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      autoStopTracking(
        "network",
        "通信エラーが続いたため自動停止しました",
      );
      return;
    }
    const retryDelay = errorBackoffMs(trackerState.consecutiveFailures);
    trackerState.status = `通信エラーのため${Math.ceil(retryDelay / 60000)}分後に再試行します`;
    schedulePolling(retryDelay);
  } finally {
    pollInFlight = false;
  }
}

async function refreshTracking(sessionId = trackingSessionId) {
  if (!trackerState.active || !trackerState.player) {
    return publicTrackerState();
  }
  const previousReplayIds = new Set(trackerState.seenReplayIds);
  const previousCharacterId = trackerState.characterId;
  const replays = await fetchRankedReplays(trackerState.player.profileId);
  if (sessionId !== trackingSessionId || !trackerState.active) {
    return publicTrackerState();
  }
  const hasNewReplay = replays.some(
    (replay) =>
      replay.replayId &&
      replay.matchType &&
      !previousReplayIds.has(replay.replayId),
  );
  const hasNewRankedReplay = replays.some(
    (replay) =>
      replay.matchType === "ranked" &&
      replay.replayId &&
      !previousReplayIds.has(replay.replayId),
  );
  trackerState = applyNewReplays(trackerState, replays);
  const characterChanged =
    previousCharacterId != null &&
    trackerState.characterId != null &&
    previousCharacterId !== trackerState.characterId;
  if (hasNewRankedReplay || characterChanged) {
    const refreshedPlayer = await searchPlayer(
      trackerState.player.userCode,
    ).catch(() => null);
    if (sessionId !== trackingSessionId || !trackerState.active) {
      return publicTrackerState();
    }
    if (refreshedPlayer) {
      trackerState = syncCurrentPlayerRating(
        trackerState,
        refreshedPlayer,
        hasNewRankedReplay || characterChanged,
      );
    }
  }
  const now = Date.now();
  if (hasNewReplay) trackerState.lastNewMatchAt = now;
  trackerState.updatedAt = now;
  trackerState.status = "監視中";
  sendTrackerState();
  return publicTrackerState();
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  trackerState.nextPollAt = null;
  trackerState.effectivePollIntervalSeconds = null;
}

function autoStopTracking(reason, status) {
  stopPolling();
  trackingSessionId += 1;
  trackerState.active = false;
  trackerState.stopReason = reason;
  trackerState.status = status;
  trackerState.updatedAt = Date.now();
  sendTrackerState();
  return publicTrackerState();
}

function stopTracking() {
  stopPolling();
  trackingSessionId += 1;
  trackerState = createEmptyTrackerState();
  sendTrackerState();
  return publicTrackerState();
}

function resetTrackingStats() {
  if (!trackerState.active) {
    return publicTrackerState();
  }
  const stats = createEmptyMatchStats();
  stats.ranked.initialRating = trackerState.currentRating;
  stats.ranked.currentRating = trackerState.currentRating;
  stats.ranked.ratingHistory =
    trackerState.currentRating == null ? [] : [trackerState.currentRating];
  const resetAt = Date.now();
  trackerState = {
    ...trackerState,
    wins: 0,
    losses: 0,
    streak: 0,
    initialRating: trackerState.currentRating,
    ratingDelta: 0,
    lastMatch: null,
    startedAt: resetAt,
    updatedAt: resetAt,
    lastNewMatchAt: resetAt,
    consecutiveFailures: 0,
    stats,
    characterStates: {},
  };
  snapshotCurrentCharacter(trackerState);
  if (!pollInFlight) schedulePolling();
  sendTrackerState();
  return publicTrackerState();
}

function friendlyError(error) {
  const code = error instanceof Error ? error.message : String(error);
  const messages = {
    INVALID_USER_CODE: "ユーザーコードは数字で入力してください",
    PLAYER_NOT_FOUND: "該当するプレイヤーが見つかりませんでした",
    SERVICE_AUTH_REQUIRED: "対象サイトへのログインが必要です",
    SERVICE_RATE_LIMITED: "対象サイトが混雑しているため、しばらく待ってから再試行します",
    SERVICE_BUILD_ID_NOT_FOUND:
      "対象サイトのページ構成を確認できませんでした",
    SERVICE_SELF_NOT_FOUND:
      "ログイン中のプレイヤー情報を自動取得できませんでした",
    INVALID_GAME_EXECUTABLE: "有効なゲーム実行ファイルを選択してください",
    UPDATE_REQUIRED: "セキュリティ更新が必要なため、更新後に利用できます",
  };
  if (messages[code]) return messages[code];
  if (code.startsWith("SERVICE_HTTP_")) {
    return "対象サイトとの通信に失敗しました";
  }
  return "処理に失敗しました";
}

function ensureUpdateAllowed() {
  if (updateRequired) throw new Error("UPDATE_REQUIRED");
}

function resultHandler(handler, { allowDuringUpdate = false } = {}) {
  return async (_event, payload) => {
    try {
      if (!allowDuringUpdate) ensureUpdateAllowed();
      return { ok: true, data: await handler(payload ?? {}) };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  };
}

function registerIpcHandlers() {
  ipcMain.handle("auth:open-login", resultHandler(async () => openLoginWindow()));
  ipcMain.handle("auth:check", resultHandler(checkAuthentication));
  ipcMain.handle(
    "tracker:start",
    resultHandler(({ player }) => startTracking(player)),
  );
  ipcMain.handle("tracker:stop", resultHandler(stopTracking));
  ipcMain.handle("tracker:reset", resultHandler(resetTrackingStats));
  ipcMain.handle(
    "tracker:state",
    resultHandler(async () => publicTrackerState(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "display:open",
    resultHandler(async () => openStatsWindow()),
  );
  ipcMain.handle(
    "display:hide",
    resultHandler(async () => {
      statsWindowDrag = null;
      if (statsWindow && !statsWindow.isDestroyed()) {
        statsWindow.hide();
        sendDisplaySettings();
      }
      return publicDisplaySettings();
    }),
  );
  ipcMain.handle(
    "display:toggle",
    resultHandler(async () => toggleStatsWindow()),
  );
  ipcMain.handle(
    "display:settings",
    resultHandler(async () => publicDisplaySettings(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "system:fonts",
    resultHandler(listInstalledFonts, { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "display:update",
    resultHandler(async (nextSettings) => updateDisplaySettings(nextSettings)),
  );
  ipcMain.handle(
    "display:toggle-interaction",
    resultHandler(async () => toggleOverlayInteraction()),
  );
  ipcMain.on("display:drag-start", beginStatsWindowDrag);
  ipcMain.on("display:drag-move", moveStatsWindowDrag);
  ipcMain.on("display:drag-end", endStatsWindowDrag);
  ipcMain.handle(
    "automation:choose-game",
    resultHandler(chooseGameExecutable),
  );
  ipcMain.handle(
    "privacy:clear",
    resultHandler(clearPrivateDataWithConfirmation),
  );
  ipcMain.handle(
    "update:check",
    resultHandler(async () => updater.check(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "update:state",
    resultHandler(async () => updater.getState(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "update:install",
    resultHandler(async () => updater.install(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "update:choose-directory",
    resultHandler(chooseUpdateDirectory, { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "clipboard:write",
    resultHandler(async ({ text }) => {
      clipboard.writeText(String(text ?? ""));
      return { copied: true };
    }),
  );
}

function overlayHtml() {
  const statsDocument = fs.readFileSync(
    path.join(__dirname, "renderer", "stats.html"),
    "utf8",
  );
  // The Electron page is intentionally locked down from network access. The
  // local OBS page needs only its own /state endpoint, so the server-side
  // copy grants that single same-origin connection without changing the
  // packaged renderer policy.
  return statsDocument.replace(
    "connect-src 'none'",
    "connect-src 'self'",
  );
}

function startOverlayServer() {
  overlayServer = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    const requestPath = String(request.url ?? "").split("?", 1)[0];
    const rendererAssets = {
      "/stats.css": ["stats.css", "text/css; charset=utf-8"],
      "/stats.js": ["stats.js", "text/javascript; charset=utf-8"],
      "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
    };
    if (requestPath === "/state") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(publicOverlayState()));
      return;
    }
    if (rendererAssets[requestPath]) {
      const [fileName, contentType] = rendererAssets[requestPath];
      try {
        const content = fs.readFileSync(
          path.join(__dirname, "renderer", fileName),
          "utf8",
        );
        response.writeHead(200, { "Content-Type": contentType });
        response.end(content);
      } catch {
        response.writeHead(404);
        response.end("Not found");
      }
      return;
    }
    if (requestPath === "/" || requestPath === "/overlay") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
      });
      response.end(overlayHtml());
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  overlayServer.on("error", () => {
    overlayServer = null;
    trackerState.overlayUrl = "";
    sendTrackerState();
  });
  overlayServer.listen(OVERLAY_PORT, OVERLAY_HOST);
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  sourceSession = session.fromPartition(LOGIN_PARTITION);
  configureRemoteSession(sourceSession);
  updater = createUpdater({
    configPath: updateSettingsPath,
    defaultSourceDirectory: defaultUpdateSourcePath,
    onState: (state) => {
      const requiredNow = state.required === true;
      const becameRequired = requiredNow && !updateRequired;
      updateRequired = requiredNow;
      if (becameRequired) {
        stopTracking();
        statsWindowDrag = null;
        if (loginWindow && !loginWindow.isDestroyed()) {
          loginWindow.close();
        }
        if (statsWindow && !statsWindow.isDestroyed()) {
          statsWindow.hide();
          sendDisplaySettings();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update:state", state);
      }
    },
  });
  registerIpcHandlers();
  startOverlayServer();
  createMainWindow();
  configureLaunchAtLogin();
  configureGameDetection();

  if (app.isPackaged) {
    setTimeout(() => updater.check().catch(() => {}), 750);
  }
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (gameWasRunning && appUiModalDepth === 0) {
    mainWindow.showInactive();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopPolling();
  clearInterval(gameMonitorTimer);
  clearTimeout(displaySettingsWriteTimer);
  try {
    fs.writeFileSync(
      displaySettingsPath,
      JSON.stringify(savedSettingsPayload(), null, 2),
      "utf8",
    );
  } catch {
    // 終了時の設定保存に失敗しても、アプリ終了は妨げない。
  }
  if (overlayServer) overlayServer.close();
});
