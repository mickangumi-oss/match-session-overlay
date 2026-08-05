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
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
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
const devOverlayPort = Number(process.env.MATCH_OVERLAY_DEV_PORT);
const OVERLAY_PORT =
  !app.isPackaged && Number.isInteger(devOverlayPort) && devOverlayPort >= 1024 && devOverlayPort <= 65535
    ? devOverlayPort
    : 37123;
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
      height: 820,
      minWidth: 320,
      minHeight: 700,
      maxWidth: 560,
      maxHeight: 1100,
    },
    verticalNoChart: {
      width: 380,
      height: 460,
      minWidth: 320,
      minHeight: 470,
      maxWidth: 560,
      maxHeight: 760,
    },
    chart: { width: 520, height: 240, minWidth: 380, minHeight: 180 },
    summary: { width: 520, height: 102, minWidth: 320, minHeight: 82 },
    maxWidth: 1000,
    maxHeight: 420,
  },
  overlay: {
    chart: { width: 480, height: 120, minWidth: 320, minHeight: 92 },
    summary: { width: 480, height: 72, minWidth: 300, minHeight: 68 },
    vertical: {
      width: 380,
      height: 820,
      minWidth: 320,
      minHeight: 700,
      maxWidth: 560,
      maxHeight: 1100,
    },
    verticalNoChart: {
      width: 380,
      height: 460,
      minWidth: 320,
      minHeight: 470,
      maxWidth: 560,
      maxHeight: 760,
    },
    maxWidth: 1000,
    maxHeight: 300,
  },
};
const WINDOW_ORIENTATIONS = new Set(["horizontal", "vertical"]);
const FONT_KEYS = new Set(["street", "condensed", "system", "japanese", "mono"]);
const FONT_FAMILY_PATTERN = /^[\p{L}\p{M}\p{N}\p{Zs}._&'()\-+#@]{1,100}$/u;
const POLL_INTERVAL_OPTIONS = new Set([120, 180, 300]);
const GRAPH_MATCH_COUNT_OPTIONS = new Set([0, 20, 50, 100]);
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
const matchHistoryDirectory = path.join(userDataPath, "match-history");
const matchHistoryPath = path.join(userDataPath, "match-history.json");
const MATCH_HISTORY_LIMIT = 5000;
// The battle log is paginated at ten entries per page. A manual import walks
// at most ten pages (100 entries) through the existing request queue; live
// polling intentionally remains a single-page request.
const MATCH_HISTORY_PAGE_SIZE = 10;
const MATCH_HISTORY_MAX_PAGES = 10;
const MEDIAN_RATING_SAMPLE_LIMIT = 20;
// Keep manual imports deliberately infrequent so the feature cannot be used
// to poll the service repeatedly.
const MATCH_HISTORY_FETCH_COOLDOWN_MS = 10 * 60 * 1000;
// Selecting another profile also performs a search request. Reuse a recent
// lookup so repeated clicks or switching back and forth cannot create a
// request burst against the official service.
const HISTORY_PROFILE_LOOKUP_COOLDOWN_MS = 10 * 60 * 1000;
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(sessionDataPath, { recursive: true });
fs.mkdirSync(matchHistoryDirectory, { recursive: true });
app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow;
let loginWindow;
let statsWindow;
let tray;
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
let overlaySuppressed = false;
let isQuitting = false;
let appUiModalDepth = 0;
let applyingStatsBounds = false;
let overlayEditMode = false;
let overlayEditPreference = false;
let hasPersistedDisplaySettings = fs.existsSync(displaySettingsPath);
let statsWindowDrag = null;
let updater;
let updateRequired = false;
let authenticatedRatingType = "MR";
let authenticatedProfileId = null;
let authenticatedPlayer = null;
let statsWindowBounds = {
  window: { horizontal: null, vertical: null },
  overlay: null,
};

let trackerState = createEmptyTrackerState();
const matchHistoryStores = new Map();
const historyProfileLookupCache = new Map();
let matchHistoryFetchInFlight = null;
let historyViewPlayer = null;
let historyViewPollTimer = null;
let historyViewPollInFlight = false;
let historyViewSessionId = 0;
let historyViewPollingActive = false;
let historyViewLastNewMatchAt = null;
let historyViewNextPollAt = null;
let historyViewEffectivePollIntervalSeconds = null;
let historyViewConsecutiveFailures = 0;
let historyViewStopReason = null;
let displaySettings = {
  mode: "window",
  windowOrientation: "horizontal",
  matchType: "ranked",
  fontScale: 1,
  graphLabelScale: 1.3,
  graphMatchCount: 20,
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
  if (GRAPH_MATCH_COUNT_OPTIONS.has(Number(savedSettings.graphMatchCount))) {
    displaySettings.graphMatchCount = Number(savedSettings.graphMatchCount);
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
migrateLegacyMatchHistory();
if (!displaySettings.launchAtLogin) {
  displaySettings.autoDetectGame = false;
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
    ratingType: authenticatedRatingType,
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

function normalizeStoredHistoryRecord(value) {
  if (!value || typeof value !== "object") return null;
  const replayId = String(value.replayId ?? "").trim();
  if (!replayId) return null;
  const profileId = normalizeHistoryProfileId(
    value.profileId ?? value.ownUserCode,
  );
  const uploadedAt = Number(value.uploadedAt ?? 0);
  if (!profileId || !Number.isFinite(uploadedAt) || uploadedAt <= 0) return null;
  const matchType = ["ranked", "battleHub", "casual"].includes(value.matchType)
    ? value.matchType
    : null;
  if (!matchType) return null;
  const finiteOrNull = (candidate) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  return {
    replayId,
    profileId,
    uploadedAt,
    playedAt: finiteOrNull(value.playedAt) ?? uploadedAt,
    matchType,
    battleTypeName: String(value.battleTypeName ?? "").slice(0, 80),
    result: ["win", "loss", "draw"].includes(value.result)
      ? value.result
      : "draw",
    ownName: String(value.ownName ?? "").slice(0, 80),
    ownCharacterName: String(value.ownCharacterName ?? "").slice(0, 80),
    characterId: finiteOrNull(value.characterId),
    ownRating: finiteOrNull(value.ownRating ?? value.rating),
    ownRatingType: ["MR", "LP"].includes(value.ownRatingType ?? value.ratingType)
      ? value.ownRatingType ?? value.ratingType
      : null,
    opponentName: String(value.opponentName ?? "").slice(0, 80),
    opponentUserCode: normalizeHistoryProfileId(value.opponentUserCode),
    opponentCharacterName: String(value.opponentCharacterName ?? "").slice(0, 80),
    opponentCharacterId: finiteOrNull(value.opponentCharacterId),
    opponentRating: finiteOrNull(value.opponentRating),
    opponentRatingType: ["MR", "LP"].includes(value.opponentRatingType)
      ? value.opponentRatingType
      : null,
  };
}

function normalizeHistoryProfileId(value) {
  const normalized = String(value ?? "").replace(/\s/g, "");
  return /^\d{4,12}$/.test(normalized) ? normalized : null;
}

function historyStorePath(profileId) {
  const normalized = normalizeHistoryProfileId(profileId);
  return normalized
    ? path.join(matchHistoryDirectory, `${normalized}.json`)
    : null;
}

function emptyMatchHistoryStore() {
  return { version: 1, lastFetchedAt: 0, records: [] };
}

function normalizeMatchHistoryStore(value) {
  const records = Array.isArray(value) ? value : value?.records;
  const deduplicated = new Map(
    (Array.isArray(records) ? records : [])
      .map(normalizeStoredHistoryRecord)
      .filter(Boolean)
      .map((record) => [record.replayId, record]),
  );
  return {
    version: 1,
    lastFetchedAt: Number(value?.lastFetchedAt ?? 0) || 0,
    records: [...deduplicated.values()]
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .slice(0, MATCH_HISTORY_LIMIT),
  };
}

function loadMatchHistoryStore(profileId) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId) return emptyMatchHistoryStore();
  if (matchHistoryStores.has(normalizedProfileId)) {
    return matchHistoryStores.get(normalizedProfileId);
  }
  const filePath = historyStorePath(normalizedProfileId);
  let store = emptyMatchHistoryStore();
  try {
    store = normalizeMatchHistoryStore(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
  } catch {
    store = emptyMatchHistoryStore();
  }
  matchHistoryStores.set(normalizedProfileId, store);
  return store;
}

function persistMatchHistoryStore(profileId, store = loadMatchHistoryStore(profileId)) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const filePath = historyStorePath(normalizedProfileId);
  if (!normalizedProfileId || !filePath || !store) return false;
  try {
    fs.writeFileSync(
      filePath,
      JSON.stringify(store, null, 2),
      "utf8",
    );
    return true;
  } catch {
    // Local history is an enhancement; a full disk must not stop tracking.
    return false;
  }
}

function migrateLegacyMatchHistory() {
  if (!fs.existsSync(matchHistoryPath)) return;
  try {
    const legacy = normalizeMatchHistoryStore(
      JSON.parse(fs.readFileSync(matchHistoryPath, "utf8")),
    );
    const grouped = new Map();
    for (const record of legacy.records) {
      const profileId = normalizeHistoryProfileId(record.profileId);
      if (!profileId) continue;
      const store = grouped.get(profileId) ?? emptyMatchHistoryStore();
      store.records.push(record);
      grouped.set(profileId, store);
    }
    let migrated = true;
    for (const [profileId, records] of grouped) {
      const store = loadMatchHistoryStore(profileId);
      const merged = normalizeMatchHistoryStore({
        ...store,
        lastFetchedAt: Math.max(store.lastFetchedAt, legacy.lastFetchedAt),
        records: [...store.records, ...records.records],
      });
      matchHistoryStores.set(profileId, merged);
      migrated = persistMatchHistoryStore(profileId, merged) && migrated;
    }
    if (migrated) fs.rmSync(matchHistoryPath, { force: true });
  } catch {
    // Leave the legacy file in place if migration cannot be completed.
  }
}

function activeHistoryProfileId() {
  return normalizeHistoryProfileId(
    historyViewPlayer?.profileId ??
      trackerState.player?.profileId ??
      authenticatedProfileId,
  );
}

function mergeMatchHistory(replays, profileId) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId || !Array.isArray(replays)) return false;
  const store = loadMatchHistoryStore(normalizedProfileId);
  const existing = new Map(
    store.records.map((record) => [record.replayId, record]),
  );
  let changed = false;
  for (const replay of replays) {
    const normalized = normalizeStoredHistoryRecord({
      ...replay,
      profileId: normalizedProfileId,
    });
    if (!normalized) continue;
    const previous = existing.get(normalized.replayId);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(normalized)) {
      existing.set(normalized.replayId, normalized);
      changed = true;
    }
  }
  if (!changed) return false;
  store.records = [...existing.values()]
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .slice(0, MATCH_HISTORY_LIMIT);
  persistMatchHistoryStore(normalizedProfileId, store);
  sendHistoryState();
  return true;
}

function publicHistoryState(
  profileId = activeHistoryProfileId(),
) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const store = normalizedProfileId
    ? loadMatchHistoryStore(normalizedProfileId)
    : emptyMatchHistoryStore();
  const nextAllowedAt = store.lastFetchedAt
    ? store.lastFetchedAt + MATCH_HISTORY_FETCH_COOLDOWN_MS
    : 0;
  return {
    records: store.records,
    count: store.records.length,
    profileId: normalizedProfileId,
    player: historyViewPlayer ?? authenticatedPlayer ?? trackerState.player,
    viewingOther: Boolean(historyViewPlayer),
    authenticated: Boolean(normalizedProfileId),
    lastFetchedAt: store.lastFetchedAt || null,
    nextAllowedAt: nextAllowedAt || null,
    canFetch: Boolean(normalizedProfileId) && Date.now() >= nextAllowedAt,
    cooldownSeconds: Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000)),
    polling: Boolean(historyViewPlayer && historyViewPollingActive),
    pollNextAt: historyViewPlayer ? historyViewNextPollAt : null,
    pollIntervalSeconds: historyViewPlayer
      ? historyViewEffectivePollIntervalSeconds
      : null,
    pollStopReason: historyViewPlayer ? historyViewStopReason : null,
  };
}

function sendHistoryState() {
  const state = publicHistoryState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("history:state", state);
  }
}

function stopHistoryViewPolling(reason = null) {
  if (historyViewPollTimer) {
    clearTimeout(historyViewPollTimer);
    historyViewPollTimer = null;
  }
  historyViewSessionId += 1;
  historyViewPollingActive = false;
  historyViewNextPollAt = null;
  historyViewEffectivePollIntervalSeconds = null;
  historyViewConsecutiveFailures = 0;
  historyViewStopReason = reason;
}

function startHistoryViewPolling({ resetActivity = true } = {}) {
  if (!historyViewPlayer) return;
  if (historyViewPollTimer) clearTimeout(historyViewPollTimer);
  historyViewSessionId += 1;
  historyViewPollingActive = true;
  historyViewStopReason = null;
  historyViewConsecutiveFailures = 0;
  if (resetActivity || historyViewLastNewMatchAt == null) {
    historyViewLastNewMatchAt = Date.now();
  }
  scheduleHistoryViewPolling();
}

function scheduleHistoryViewPolling(delayMs = null) {
  if (!historyViewPlayer || !historyViewPollingActive || updateRequired) return;
  if (historyViewPollTimer) clearTimeout(historyViewPollTimer);
  const nextDelay =
    delayMs ??
    successfulPollDelayMs({
      configuredIntervalSeconds: displaySettings.pollIntervalSeconds,
      lastNewMatchAt: historyViewLastNewMatchAt,
      jitterMs: Math.floor(Math.random() * (POLL_JITTER_MAX_MS + 1)),
    });
  historyViewNextPollAt = Date.now() + nextDelay;
  historyViewEffectivePollIntervalSeconds = Math.ceil(nextDelay / 1000);
  const sessionId = historyViewSessionId;
  historyViewPollTimer = setTimeout(
    () => runHistoryViewPoll(sessionId),
    nextDelay,
  );
  sendTrackerState();
  sendHistoryState();
}

async function runHistoryViewPoll(sessionId) {
  historyViewPollTimer = null;
  historyViewNextPollAt = null;
  if (
    historyViewPollInFlight ||
    !historyViewPollingActive ||
    !historyViewPlayer ||
    sessionId !== historyViewSessionId
  ) {
    return;
  }
  historyViewPollInFlight = true;
  const profileId = historyViewPlayer.profileId;
  try {
    const store = loadMatchHistoryStore(profileId);
    const previousReplayIds = new Set(store.records.map((record) => record.replayId));
    const replays = await fetchRankedReplays(profileId);
    if (
      !historyViewPollingActive ||
      !historyViewPlayer ||
      historyViewPlayer.profileId !== profileId ||
      sessionId !== historyViewSessionId
    ) {
      return;
    }
    const newReplays = replays.filter(
      (replay) => replay.replayId && !previousReplayIds.has(replay.replayId),
    );
    mergeMatchHistory(replays, profileId);
    const fetchedStore = loadMatchHistoryStore(profileId);
    fetchedStore.lastFetchedAt = Date.now();
    persistMatchHistoryStore(profileId, fetchedStore);
    if (newReplays.length) {
      historyViewLastNewMatchAt = Date.now();
      const newest = [...newReplays].sort(
        (a, b) => Number(b.uploadedAt) - Number(a.uploadedAt),
      )[0];
      if (newest?.characterId != null) {
        historyViewPlayer = {
          ...historyViewPlayer,
          characterId: newest.characterId,
          characterDisplayName:
            newest.ownCharacterName || historyViewPlayer.characterDisplayName,
          mr: newest.ownRatingType === "MR" ? newest.ownRating : historyViewPlayer.mr,
          lp: newest.ownRatingType === "LP" ? newest.ownRating : historyViewPlayer.lp,
        };
      }
    }
    historyViewConsecutiveFailures = 0;
    if (shouldAutoStopForInactivity(historyViewLastNewMatchAt)) {
      stopHistoryViewPolling("idle");
    } else {
      scheduleHistoryViewPolling();
    }
    sendHistoryState();
    sendTrackerState();
  } catch (error) {
    if (
      !historyViewPollingActive ||
      !historyViewPlayer ||
      historyViewPlayer.profileId !== profileId ||
      sessionId !== historyViewSessionId
    ) {
      return;
    }
    historyViewConsecutiveFailures += 1;
    if (error instanceof Error && error.message === "SERVICE_AUTH_REQUIRED") {
      stopHistoryViewPolling("authentication");
    } else if (historyViewConsecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stopHistoryViewPolling("network");
    } else {
      const retryAfterMs = Number(error.retryAfterMs);
      const retryDelay = Math.max(
        errorBackoffMs(historyViewConsecutiveFailures),
        Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
      );
      scheduleHistoryViewPolling(retryDelay);
    }
    sendHistoryState();
    sendTrackerState();
  } finally {
    historyViewPollInFlight = false;
  }
}

function historyViewTrackerState() {
  if (!historyViewPlayer) return null;
  const records = loadMatchHistoryStore(historyViewPlayer.profileId).records;
  const stats = createEmptyMatchStats();
  const ordered = [...records].sort(
    (a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt),
  );
  const currentCharacterId = Number(historyViewPlayer.characterId) || null;
  const characterRecords = currentCharacterId == null
    ? ordered
    : ordered.filter((record) => Number(record.characterId) === currentCharacterId);
  const ratingRecords = characterRecords.filter(
    (record) =>
      record.matchType === "ranked" &&
      Number.isFinite(Number(record.ownRating)) &&
      ["MR", "LP"].includes(record.ownRatingType),
  );
  const fallbackRating = historyViewPlayer.mr ?? historyViewPlayer.lp ?? null;
  const ratingType =
    ratingRecords.at(-1)?.ownRatingType ??
    (historyViewPlayer.mr != null ? "MR" : historyViewPlayer.lp != null ? "LP" : "MR");
  for (const record of characterRecords) {
    const matchType = record.matchType;
    if (!stats[matchType]) continue;
    stats[matchType].matchCount += 1;
    if (record.result === "win") stats[matchType].wins += 1;
    if (record.result === "loss") stats[matchType].losses += 1;
    if (
      matchType === "ranked" &&
      record.ownRatingType === ratingType &&
      Number.isFinite(Number(record.ownRating))
    ) {
      const rating = Number(record.ownRating);
      stats.ranked.ratingHistory.push(rating);
      stats.ranked.currentRating = rating;
      stats.ranked.currentRatingType = record.ownRatingType;
    }
  }
  const firstRating = Number.isFinite(Number(ratingRecords[0]?.ownRating))
    ? Number(ratingRecords[0].ownRating)
    : fallbackRating;
  const currentRating = Number.isFinite(Number(ratingRecords.at(-1)?.ownRating))
    ? Number(ratingRecords.at(-1).ownRating)
    : fallbackRating;
  stats.ranked.initialRating = firstRating;
  stats.ranked.currentRating = currentRating;
  stats.ranked.ratingDelta =
    firstRating != null && currentRating != null && ratingType === (ratingRecords[0]?.ownRatingType ?? ratingType)
      ? currentRating - firstRating
      : 0;
  if (!stats.ranked.ratingHistory.length && firstRating != null) {
    stats.ranked.ratingHistory = [firstRating];
  }
  const wins = stats.ranked.wins;
  const losses = stats.ranked.losses;
  return {
    ...createEmptyTrackerState(),
    active: historyViewPollingActive,
    readOnly: true,
    viewingOther: true,
    player: historyViewPlayer,
    wins,
    losses,
    initialRating: firstRating,
    currentRating,
    ratingType,
    characterId: historyViewPlayer.characterId ?? null,
    ratingDelta: stats.ranked.ratingDelta,
    lastMatch: characterRecords.at(-1) ?? null,
    updatedAt: Date.now(),
    lastNewMatchAt: historyViewLastNewMatchAt,
    nextPollAt: historyViewNextPollAt,
    effectivePollIntervalSeconds: historyViewEffectivePollIntervalSeconds,
    consecutiveFailures: historyViewConsecutiveFailures,
    stopReason: historyViewStopReason,
    seenReplayIds: characterRecords.map((record) => record.replayId).filter(Boolean),
    stats,
    status: "historyViewing",
  };
}

function medianValue(values) {
  const sorted = values
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  // MR/LP are displayed as whole points. When an even-sized sample produces
  // a fractional median, use ordinary half-up rounding instead of decimals.
  return Math.round(median);
}

function publicMedianRating(sourceState) {
  const hasStateRating =
    sourceState?.currentRating != null || sourceState?.active || sourceState?.readOnly;
  const ratingType = hasStateRating
    ? sourceState?.ratingType === "LP"
      ? "LP"
      : "MR"
    : authenticatedPlayer?.mr != null
      ? "MR"
      : authenticatedPlayer?.lp != null
        ? "LP"
        : authenticatedRatingType;
  const profileId = normalizeHistoryProfileId(
    sourceState?.player?.profileId ?? authenticatedProfileId,
  );
  const characterId = Number(
    sourceState?.characterId ?? sourceState?.player?.characterId ?? authenticatedPlayer?.characterId,
  ) || null;
  let values = [];
  if (profileId) {
    const records = loadMatchHistoryStore(profileId).records
      .filter(
        (record) =>
          record.matchType === "ranked" &&
          record.ownRatingType === ratingType &&
          (characterId == null || Number(record.characterId) === characterId),
      )
      .sort(
        (a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt),
      );
    values = records
      .map((record) => Number(record.ownRating))
      .filter(Number.isFinite)
      .slice(-MEDIAN_RATING_SAMPLE_LIMIT);
  }
  if (values.length < 2) {
    const history = Array.isArray(sourceState?.stats?.ranked?.ratingHistory)
      ? sourceState.stats.ranked.ratingHistory
      : [];
    const fallback = sourceState?.readOnly ? history : history.slice(1);
    values = fallback
      .map((value) => Number(value))
      .filter(Number.isFinite)
      .slice(-MEDIAN_RATING_SAMPLE_LIMIT);
  }
  return {
    medianRating: medianValue(values),
    medianRatingType: ratingType,
    medianRatingSampleCount: values.length,
  };
}

function publicGraphData(sourceState) {
  const profileId = normalizeHistoryProfileId(
    sourceState?.player?.profileId ?? authenticatedProfileId,
  );
  const characterId = Number(
    sourceState?.characterId ?? sourceState?.player?.characterId,
  ) || null;
  const ratingType = sourceState?.ratingType === "LP" ? "LP" : "MR";
  const localRecords = profileId
    ? loadMatchHistoryStore(profileId).records
        .filter(
          (record) =>
            record.matchType === "ranked" &&
            record.ownRatingType === ratingType &&
            Number.isFinite(Number(record.ownRating)) &&
            (characterId == null || Number(record.characterId) === characterId),
        )
        .sort(
          (a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt),
        )
    : [];
  if (localRecords.length) {
    const values = localRecords.map((record) => Number(record.ownRating));
    // Keep the same visual convention as the live session graph: the first
    // point is the baseline and each following point represents one match.
    return {
      ranked: {
        values: [values[0], ...values],
        matchCount: values.length,
        ratingType,
        source: "local",
      },
    };
  }

  const selected = sourceState?.stats?.ranked ?? {};
  let values = Array.isArray(selected.ratingHistory)
    ? selected.ratingHistory.filter(Number.isFinite)
    : [];
  const matchCount = Number.isFinite(Number(selected.matchCount))
    ? Math.max(0, Math.trunc(Number(selected.matchCount)))
    : Math.max(0, values.length - 1);
  if (values.length < 2 && matchCount > 0) {
    const initial = Number(selected.initialRating);
    const current = Number(selected.currentRating);
    if (
      selected.initialRating != null &&
      selected.currentRating != null &&
      Number.isFinite(initial) &&
      Number.isFinite(current)
    ) {
      values = [initial, current];
    }
  }
  return {
    ranked: {
      values,
      matchCount,
      ratingType,
      source: "session",
    },
  };
}

function publicTrackerState() {
  const viewState = historyViewTrackerState();
  const sourceState = viewState ?? trackerState;
  const {
    seenReplayIds: _privateIds,
    characterStates: _privateCharacterStates,
    ...publicState
  } = sourceState;
  return {
    ...publicState,
    ...publicMedianRating(sourceState),
    graphData: publicGraphData(sourceState),
    overlaySuppressed,
    selectedMatchType: displaySettings.matchType,
    displaySettings: publicDisplaySettings(),
  };
}

function publicOverlayState() {
  const viewState = historyViewTrackerState();
  const sourceState = viewState ?? trackerState;
  const median = publicMedianRating(sourceState);
  const graphData = publicGraphData(sourceState);
  const liveOverlayBounds =
    displaySettings.mode === "overlay" &&
    statsWindow &&
    !statsWindow.isDestroyed()
      ? statsWindow.getBounds()
      : null;
  const savedOverlayBounds = statsWindowBounds.overlay;
  const overlayPreset =
    displaySettings.windowOrientation === "vertical"
      ? displaySettings.graphVisible === false
        ? STATS_WINDOW_PRESETS.overlay.verticalNoChart
        : STATS_WINDOW_PRESETS.overlay.vertical
      : STATS_WINDOW_PRESETS.overlay.chart;
  const fallbackOverlaySize = {
    width: overlayPreset.minWidth,
    height: overlayPreset.minHeight,
  };
  const savedOverlaySizeUsable =
    savedOverlayBounds &&
    Number.isFinite(Number(savedOverlayBounds.width)) &&
    Number.isFinite(Number(savedOverlayBounds.height)) &&
    Number(savedOverlayBounds.width) >= overlayPreset.minWidth &&
    Number(savedOverlayBounds.width) <=
      (overlayPreset.maxWidth ?? STATS_WINDOW_PRESETS.overlay.maxWidth) &&
    Number(savedOverlayBounds.height) >= overlayPreset.minHeight &&
    Number(savedOverlayBounds.height) <=
      (overlayPreset.maxHeight ?? STATS_WINDOW_PRESETS.overlay.maxHeight);
  const overlaySize =
    liveOverlayBounds ??
    (savedOverlaySizeUsable ? savedOverlayBounds : null) ??
    fallbackOverlaySize;
  return {
    active: sourceState.active,
    stats: sourceState.stats,
    overlaySuppressed,
    medianRating: median.medianRating,
    medianRatingType: median.medianRatingType,
    medianRatingSampleCount: median.medianRatingSampleCount,
    graphData,
    ratingType: sourceState.ratingType || authenticatedRatingType,
    selectedMatchType: displaySettings.matchType,
    overlaySize: {
      width: Math.min(
        overlayPreset.maxWidth ?? STATS_WINDOW_PRESETS.overlay.maxWidth,
        Math.max(300, Number(overlaySize.width) || fallbackOverlaySize.width),
      ),
      height: Math.min(
        overlayPreset.maxHeight ?? STATS_WINDOW_PRESETS.overlay.maxHeight,
        Math.max(68, Number(overlaySize.height) || fallbackOverlaySize.height),
      ),
    },
    displaySettings: {
      matchType: displaySettings.matchType,
      windowOrientation: displaySettings.windowOrientation,
      fontScale: displaySettings.fontScale,
      graphLabelScale: displaySettings.graphLabelScale,
      graphMatchCount: displaySettings.graphMatchCount,
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
  const isVertical = displaySettings.windowOrientation === "vertical";
  const sizePreset = isVertical
    ? displaySettings.graphVisible === false
      ? modePreset.verticalNoChart ?? modePreset.vertical ?? modePreset.summary
      : modePreset.vertical ?? modePreset.summary
    : displaySettings.mode === "window"
      ? modePreset.horizontal
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
  const previousGraphVisible = displaySettings.graphVisible;
  const previousLocale = displaySettings.locale;
  const previousPollInterval = displaySettings.pollIntervalSeconds;
  const previousLaunchAtLogin = displaySettings.launchAtLogin;
  const previousAutoDetectGame = displaySettings.autoDetectGame;
  const previousGameExecutable = displaySettings.gameExecutableName;
  const orientationChanging =
    WINDOW_ORIENTATIONS.has(nextSettings.windowOrientation) &&
    nextSettings.windowOrientation !== previousOrientation;
  const graphVisibilityChanging =
    typeof nextSettings.graphVisible === "boolean" &&
    nextSettings.graphVisible !== previousGraphVisible;
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
  if (GRAPH_MATCH_COUNT_OPTIONS.has(Number(nextSettings.graphMatchCount))) {
    displaySettings.graphMatchCount = Number(nextSettings.graphMatchCount);
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
    refreshTrayMenu();
  }
  if (typeof nextSettings.launchAtLogin === "boolean") {
    displaySettings.launchAtLogin = nextSettings.launchAtLogin;
  }
  if (typeof nextSettings.autoDetectGame === "boolean") {
    displaySettings.autoDetectGame = nextSettings.autoDetectGame;
  }
  // Game detection is intentionally tied to the Windows-startup option. The
  // watcher needs the app to be resident before the game launches; allowing
  // it while startup is disabled would make the setting appear to work even
  // though a fully closed app cannot observe a new process.
  if (!displaySettings.launchAtLogin) {
    displaySettings.autoDetectGame = false;
  }
  if (isSafeExecutableName(nextSettings.gameExecutableName)) {
    displaySettings.gameExecutableName = nextSettings.gameExecutableName;
  }
  applyDisplayMode({
    resizeToPreset:
      previousMode !== displaySettings.mode ||
      previousOrientation !== displaySettings.windowOrientation ||
      graphVisibilityChanging,
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
    previousLaunchAtLogin !== displaySettings.launchAtLogin ||
    previousAutoDetectGame !== displaySettings.autoDetectGame ||
    previousGameExecutable !== displaySettings.gameExecutableName
  ) {
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

function isGameDetectionEnabled() {
  return (
    !updateRequired &&
    displaySettings.launchAtLogin &&
    displaySettings.autoDetectGame &&
    isSafeExecutableName(displaySettings.gameExecutableName)
  );
}

async function checkConfiguredGame() {
  if (!isGameDetectionEnabled()) {
    stopAutoGameSession();
    return;
  }
  let running;
  try {
    running = await isConfiguredGameRunning();
  } catch {
    return;
  }
  // Settings can change while tasklist.exe is running. Do not start or keep
  // an automatic session after the user disables the required startup option.
  if (!isGameDetectionEnabled()) {
    stopAutoGameSession();
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
      if (!isGameDetectionEnabled()) return;
      await startTracking(player);
      autoGameSessionActive = true;
      if (!isGameDetectionEnabled()) stopAutoGameSession();
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
    stopAutoGameSession();
  }
}

function configureLaunchAtLogin() {
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: displaySettings.launchAtLogin,
      args: displaySettings.launchAtLogin ? ["--background"] : [],
    });
  }
}

function configureGameDetection() {
  clearInterval(gameMonitorTimer);
  gameMonitorTimer = null;
  gameWasRunning = false;
  syncMainWindowGameFocusMode();
  if (!isGameDetectionEnabled()) {
    stopAutoGameSession();
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

function trayText(key) {
  const japanese = serviceLocale() === "ja-jp";
  const labels = {
    show: japanese ? "管理画面を表示" : "Show management window",
    stats: japanese ? "戦績ウィンドウを表示／非表示" : "Show / hide stats window",
    exit: japanese ? "終了" : "Exit",
  };
  return labels[key] ?? key;
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: trayText("show"),
      click: () => showMainWindowFromTray(),
    },
    {
      label: trayText("stats"),
      click: () => {
        try {
          toggleStatsWindow();
        } catch {
          showMainWindowFromTray();
        }
      },
    },
    { type: "separator" },
    {
      label: trayText("exit"),
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function showMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, "renderer", "assets", "header-graffiti-m.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Match Session Overlay");
  tray.on("double-click", () => showMainWindowFromTray());
  refreshTrayMenu();
}

function createMainWindow() {
  const workAreaHeight = screen.getPrimaryDisplay().workAreaSize.height;
  // Keep the five-row recent-match preview visible on first launch.  Respect
  // shorter work areas, while using the extra vertical space available on
  // ordinary desktop displays instead of clipping the bottom of the panel.
  const initialHeight = Math.max(720, Math.min(900, workAreaHeight - 40));
  const minimumHeight = Math.min(860, initialHeight);
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
  mainWindow.on("close", (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      // Closing the management window only hides it to the tray.  Do not
      // close an active overlay/window presentation as a side effect.
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openStatsWindow() {
  ensureUpdateAllowed();
  overlaySuppressed = false;
  if (statsWindow && !statsWindow.isDestroyed()) {
    if (displaySettings.mode === "overlay") {
      statsWindow.showInactive();
    } else {
      statsWindow.show();
      statsWindow.focus();
    }
    sendTrackerState();
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

function suppressStatsPresentation() {
  overlaySuppressed = true;
  statsWindowDrag = null;
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.close();
  }
  sendTrackerState();
  sendDisplaySettings();
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
  matchHistoryStores.clear();
  historyProfileLookupCache.clear();
  stopHistoryViewPolling();
  historyViewPlayer = null;
  matchHistoryFetchInFlight = null;
  authenticatedProfileId = null;
  authenticatedPlayer = null;
  try {
    fs.rmSync(matchHistoryDirectory, { recursive: true, force: true });
    fs.mkdirSync(matchHistoryDirectory, { recursive: true });
    fs.rmSync(matchHistoryPath, { force: true });
  } catch {
    // Continue clearing the authenticated browser session even if the local
    // history file is temporarily locked by another process.
  }
  sendHistoryState();
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
    const result = await authenticationInFlight;
    const player = result?.player;
    authenticatedPlayer = player ?? null;
    authenticatedProfileId = player?.profileId ?? player?.userCode ?? null;
    authenticatedRatingType =
      player?.mr != null ? "MR" : player?.lp != null ? "LP" : "MR";
    if (!trackerState.active) {
      trackerState.ratingType = authenticatedRatingType;
      trackerState.updatedAt = Date.now();
      sendTrackerState();
    }
    return result;
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

async function fetchRankedReplaysPage(profileId, page = 1) {
  const data = await fetchServiceJson(
    `profile/${encodeURIComponent(profileId)}/battlelog.json`,
    { page },
  );
  const rawReplays = Array.isArray(data?.pageProps?.replay_list)
    ? data.pageProps.replay_list
    : [];
  return {
    rawCount: rawReplays.length,
    replays: rawReplays
    .map((replay) => normalizeReplay(replay, profileId))
    .filter(Boolean),
  };
}

async function fetchRankedReplays(profileId) {
  return (await fetchRankedReplaysPage(profileId, 1)).replays;
}

async function fetchMatchHistoryPages(profileId) {
  const replays = [];
  for (let page = 1; page <= MATCH_HISTORY_MAX_PAGES; page += 1) {
    const result = await fetchRankedReplaysPage(profileId, page);
    replays.push(...result.replays);
    if (result.rawCount < MATCH_HISTORY_PAGE_SIZE) break;
  }
  return replays;
}

async function fetchLocalMatchHistory() {
  ensureUpdateAllowed();
  if (matchHistoryFetchInFlight) return matchHistoryFetchInFlight;
  const now = Date.now();
  const profileId = activeHistoryProfileId();
  const store = loadMatchHistoryStore(profileId);
  const retryAfterMs = store.lastFetchedAt
    ? store.lastFetchedAt + MATCH_HISTORY_FETCH_COOLDOWN_MS - now
    : 0;
  if (retryAfterMs > 0) {
    const error = new Error("HISTORY_COOLDOWN");
    error.retryAfterMs = retryAfterMs;
    throw error;
  }

  matchHistoryFetchInFlight = (async () => {
    const player =
      historyViewPlayer ?? trackerState.player ?? (await checkAuthentication()).player;
    if (!player?.profileId) throw new Error("SERVICE_SELF_NOT_FOUND");
    // Manual imports walk the paginated battle log. Live tracking continues to
    // use one page per poll, so enabling history does not multiply polling
    // traffic.
    const existing = loadMatchHistoryStore(player.profileId);
    const previousReplayIds = new Set(
      existing.records.map((record) => record.replayId),
    );
    const replays = await fetchMatchHistoryPages(player.profileId);
    const newReplays = replays.filter(
      (replay) => replay.replayId && !previousReplayIds.has(replay.replayId),
    );
    mergeMatchHistory(replays, player.profileId);
    const fetchedStore = loadMatchHistoryStore(player.profileId);
    fetchedStore.lastFetchedAt = Date.now();
    persistMatchHistoryStore(player.profileId, fetchedStore);
    if (
      historyViewPlayer &&
      historyViewPlayer.profileId === player.profileId &&
      newReplays.length
    ) {
      historyViewLastNewMatchAt = Date.now();
    }
    if (historyViewPlayer && historyViewPlayer.profileId === player.profileId) {
      startHistoryViewPolling({ resetActivity: false });
    }
    sendHistoryState();
    sendTrackerState();
    return publicHistoryState(player.profileId);
  })();
  try {
    return await matchHistoryFetchInFlight;
  } finally {
    matchHistoryFetchInFlight = null;
  }
}

async function selectHistoryProfile(userCode) {
  ensureUpdateAllowed();
  const normalizedCode = normalizeHistoryProfileId(userCode);
  if (!normalizedCode) throw new Error("INVALID_USER_CODE");
  const ownPlayer =
    authenticatedPlayer ?? trackerState.player ?? (await checkAuthentication()).player;
  if (!ownPlayer?.profileId) throw new Error("SERVICE_SELF_NOT_FOUND");
  let nextHistoryViewPlayer = null;
  if (normalizedCode === normalizeHistoryProfileId(ownPlayer.profileId)) {
    nextHistoryViewPlayer = null;
  } else {
    const locale = serviceLocale();
    const cacheKey = `${locale}:${normalizedCode}`;
    const cached = historyProfileLookupCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_PROFILE_LOOKUP_COOLDOWN_MS) {
      nextHistoryViewPlayer = cached.player;
    } else {
      const player = await searchPlayer(normalizedCode);
      historyProfileLookupCache.set(cacheKey, {
        fetchedAt: Date.now(),
        player,
      });
      nextHistoryViewPlayer = player;
    }
  }
  stopHistoryViewPolling();
  historyViewPlayer = nextHistoryViewPlayer;
  if (historyViewPlayer) startHistoryViewPolling();
  sendHistoryState();
  sendTrackerState();
  return {
    player: historyViewPlayer ?? ownPlayer,
    history: publicHistoryState(),
  };
}

async function clearHistoryProfileSelection() {
  ensureUpdateAllowed();
  stopHistoryViewPolling();
  historyViewPlayer = null;
  sendHistoryState();
  sendTrackerState();
  return publicHistoryState();
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
  const existingInitialRating = Number(ranked.initialRating);
  const hasPlaceholderLpBaseline =
    ratingType === "LP" &&
    Number.isFinite(existingInitialRating) &&
    existingInitialRating <= 0 &&
    currentRating > 0 &&
    ranked.ratingHistory.every((value) => Number(value) <= 0);
  state.player = player;
  state.characterId = player.characterId ?? state.characterId;
  state.currentRating = currentRating;
  state.ratingType = ratingType;
  ranked.currentRating = currentRating;
  if (ranked.initialRating == null || hasPlaceholderLpBaseline) {
    ranked.initialRating = currentRating;
  }
  state.initialRating = ranked.initialRating;

  const history = ranked.ratingHistory;
  const lastHistoryIndex = history.length - 1;
  if (lastHistoryIndex < 0) {
    history.push(currentRating);
  } else if (hasNewRankedReplay && history.length < 2) {
    // Keep a flat two-point series when a ranked replay has no per-replay
    // rating value (or when the rating did not change).
    history.push(currentRating);
  } else if (history[lastHistoryIndex] !== currentRating) {
    // A battle-log entry may not include its rating. Keep the previous point
    // and append the profile's current value so the graph still records the
    // change. When the log already supplied the same value, the branch above
    // avoids adding a duplicate point.
    history.push(currentRating);
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
  // Keep the existing session counter semantics while also enriching the
  // local history when the tracker already made this request.
  mergeMatchHistory(replays, player.profileId);
  const now = Date.now();

  if (resumable) {
    const previousReplayIds = new Set(trackerState.seenReplayIds);
    const hasNewRankedReplay = replays.some(
      (replay) =>
        replay.matchType === "ranked" &&
        replay.replayId &&
        !previousReplayIds.has(replay.replayId),
    );
    trackerState = applyNewReplays(trackerState, replays);
    trackerState = syncCurrentPlayerRating(
      trackerState,
      player,
      hasNewRankedReplay,
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
  mergeMatchHistory(replays, trackerState.player.profileId);
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
        hasNewRankedReplay,
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

function stopAutoGameSession() {
  if (!autoGameSessionActive) return;
  autoGameSessionActive = false;
  stopTracking();
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindowDrag = null;
    statsWindow.hide();
    sendDisplaySettings();
  }
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
    HISTORY_COOLDOWN: "対戦履歴は一定時間ごとに一度だけ取得できます。しばらく待ってから再試行してください。",
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
    "history:state",
    resultHandler(
      async () => publicHistoryState(),
      { allowDuringUpdate: true },
    ),
  );
  ipcMain.handle(
    "history:fetch",
    resultHandler(() => fetchLocalMatchHistory()),
  );
  ipcMain.handle(
    "history:select-profile",
    resultHandler(({ userCode }) => selectHistoryProfile(userCode)),
  );
  ipcMain.handle(
    "history:clear-profile",
    resultHandler(() => clearHistoryProfileSelection()),
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
      "/assets/stats-frame-horizontal.png": [
        path.join("assets", "stats-frame-horizontal.png"),
        "image/png",
      ],
      "/assets/stats-frame-vertical.png": [
        path.join("assets", "stats-frame-vertical.png"),
        "image/png",
      ],
      "/assets/header-graffiti-m.png": [
        path.join("assets", "header-graffiti-m.png"),
        "image/png",
      ],
    };
    if (requestPath === "/state") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(publicOverlayState()));
      return;
    }
    if (rendererAssets[requestPath]) {
      const [fileName, contentType] = rendererAssets[requestPath];
      try {
        const content = fs.readFileSync(path.join(__dirname, "renderer", fileName));
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
    onState: (state) => {
      const requiredNow = state.required === true;
      const becameRequired = requiredNow && !updateRequired;
      updateRequired = requiredNow;
      if (becameRequired) {
        stopTracking();
        stopHistoryViewPolling("update");
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
  createTray();
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
  if (!tray) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopPolling();
  stopHistoryViewPolling();
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
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
