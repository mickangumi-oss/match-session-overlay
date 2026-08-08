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
  buildHistoryRatingState,
  createEmptyMatchStats,
  findNewRankedReplays,
  normalizeFighter,
  normalizeProfilePlayer,
  normalizeReplay,
  profileCacheLookup,
  repairRatingBaseline,
  parseBuildId,
  resetRatingSeries,
  shareInFlightRequest,
  snapshotCurrentCharacter,
  syncCurrentPlayerRatingState,
} = require("./source-client");
const {
  MAX_CONSECUTIVE_FAILURES,
  POLL_JITTER_MAX_MS,
  SERVICE_REQUEST_MIN_GAP_MS,
  errorBackoffMs,
  shouldAutoStopForInactivity,
  successfulPollDelayMs,
} = require("./poll-policy");
const {
  applyDisplayItemUpdate,
  defaultDisplayItems,
  displayItemsEqual,
  sanitizeDisplayItems,
  visibleMetricCount,
} = require("./display-settings");
const { buildPresentationState } = require("./presentation-model");
const {
  DEFAULT_RANKING_HOME,
  buildCharacterSlugCatalog,
  buildRankingHomeCatalog,
  normalizeMasterRanking,
  rankingCharacterSlug,
  rankingCacheKey,
  rankingHomeLabel,
  rankingRequestQuery,
  sanitizeRankingHomeKey,
  shouldRefreshRanking,
} = require("./ranking-model");
const { normalizeSocialPage } = require("./social-model");
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
const GRAPH_ONLY_MINIMUM_SIZE = {
  horizontal: { width: 420, height: 220 },
  vertical: { width: 360, height: 220 },
};
const HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE = {
  width: 520,
  height: 240,
};
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
// A profile request is made only after a new ranked replay (or on initial
// selection). Keep a short cache so a retry or character switch cannot turn
// one polling cycle into a request burst.
const PROFILE_REFRESH_COOLDOWN_MS = 90 * 1000;
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
const overlayEventClients = new Set();
let statsWindowBounds = {
  window: { horizontal: null, vertical: null },
  overlay: null,
};

let trackerState = createEmptyTrackerState();
const matchHistoryStores = new Map();
const historyProfileLookupCache = new Map();
const profileRefreshCache = new Map();
const profileRefreshInFlight = new Map();
const profileCharacterNameCache = new Map();
let matchHistoryFetchInFlight = null;
let matchHistoryFetchProgress = null;
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
const rankingCache = new Map();
const rankingCatalogCache = new Map();
const rankingCharacterSlugCache = new Map();
const rankingInFlight = new Map();
let rankingState = {
  status: "idle",
  rank: null,
  rating: null,
  profileId: null,
  locale: null,
  characterId: null,
  homeKey: DEFAULT_RANKING_HOME,
  homeLabel: "All",
  updatedAt: null,
};
let socialRefreshTimer = null;
const socialRefreshInFlight = new Map();
let socialState = {
  friends: { status: "idle", page: 1, totalPages: 1, pageSize: 0, players: [] },
  following: { status: "idle", page: 1, totalPages: 1, pageSize: 0, players: [] },
  updatedAt: null,
};
let displaySettings = {
  mode: "window",
  windowOrientation: "horizontal",
  matchType: "ranked",
  fontScale: 1,
  graphLabelScale: 1.3,
  graphMatchCount: 20,
  backgroundOpacity: 0.94,
  displayItems: defaultDisplayItems(),
  potentialLineVisible: true,
  rankingHome: DEFAULT_RANKING_HOME,
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

function buildProfileRefreshHint(previousPlayer, characterId) {
  const hint = {
    ...previousPlayer,
    characterId: characterId ?? previousPlayer?.characterId,
  };
  const previousCharacterId = Number(previousPlayer?.characterId) || null;
  const nextCharacterId = Number(hint.characterId) || null;
  if (
    previousCharacterId != null &&
    nextCharacterId != null &&
    previousCharacterId !== nextCharacterId
  ) {
    // A failed profile request must not reuse the previous character's MR/LP.
    // Leave the rating empty so the caller can fall back to this character's
    // latest replay snapshot until the next profile refresh succeeds.
    hint.mr = null;
    hint.mrRank = null;
    hint.lp = null;
    hint.ratingSource = "search";
    hint.characterDisplayName = "";
    hint.characterDisplayNameCacheKey = "";
  }
  return hint;
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
  displaySettings.displayItems = sanitizeDisplayItems(savedSettings.displayItems, {
    legacyGraphVisible: savedSettings.graphVisible,
  });
  if (typeof savedSettings.potentialLineVisible === "boolean") {
    displaySettings.potentialLineVisible = savedSettings.potentialLineVisible;
  }
  displaySettings.rankingHome = sanitizeRankingHomeKey(savedSettings.rankingHome);
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
  const fetchProgress =
    matchHistoryFetchProgress?.profileId === normalizedProfileId
      ? matchHistoryFetchProgress
      : null;
  return {
    records: store.records,
    count: store.records.length,
    profileId: normalizedProfileId,
    player: historyViewPlayer ?? authenticatedPlayer ?? trackerState.player,
    viewingOther: Boolean(historyViewPlayer),
    authenticated: Boolean(normalizedProfileId),
    lastFetchedAt: store.lastFetchedAt || null,
    nextAllowedAt: nextAllowedAt || null,
    canFetch:
      Boolean(normalizedProfileId) &&
      !fetchProgress &&
      Date.now() >= nextAllowedAt,
    fetching: Boolean(fetchProgress),
    fetchPage: fetchProgress?.page ?? 0,
    fetchMaxPages: fetchProgress?.maxPages ?? MATCH_HISTORY_MAX_PAGES,
    fetchedCount: fetchProgress?.fetchedCount ?? 0,
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
      // Battle-log ratings are snapshots taken at match time. Do not copy
      // them into the player hint; the profile card is the only source for
      // the current MR/LP shown in the monitor.
      const playerHint = buildProfileRefreshHint(
        historyViewPlayer,
        newest?.characterId,
        newest?.ownCharacterName,
      );
      historyViewPlayer = await refreshProfilePlayer(playerHint, {
        force: true,
      });
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
  const summary = buildHistoryRatingState(records, historyViewPlayer);
  return {
    ...createEmptyTrackerState(),
    active: historyViewPollingActive,
    readOnly: true,
    viewingOther: true,
    player: historyViewPlayer,
    wins: summary.wins,
    losses: summary.losses,
    initialRating: summary.initialRating,
    currentRating: summary.currentRating,
    ratingType: summary.ratingType,
    characterId: historyViewPlayer.characterId ?? null,
    ratingDelta: summary.ratingDelta,
    lastMatch: summary.lastMatch,
    updatedAt: Date.now(),
    lastNewMatchAt: historyViewLastNewMatchAt,
    nextPollAt: historyViewNextPollAt,
    effectivePollIntervalSeconds: historyViewEffectivePollIntervalSeconds,
    consecutiveFailures: historyViewConsecutiveFailures,
    stopReason: historyViewStopReason,
    seenReplayIds: summary.characterRecords.map((record) => record.replayId).filter(Boolean),
    stats: summary.stats,
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
      .filter((value) => ratingType !== "LP" || value > 0)
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
      .filter((value) => ratingType !== "LP" || value > 0)
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
            (ratingType !== "LP" || Number(record.ownRating) > 0) &&
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
  const rawMatchCount = Number.isFinite(Number(selected.matchCount))
    ? Math.max(0, Math.trunc(Number(selected.matchCount)))
    : Math.max(0, values.length - 1);
  if (values.length < 2 && rawMatchCount > 0) {
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
  if (ratingType === "LP") values = values.filter((value) => value > 0);
  const matchCount = ratingType === "LP"
    ? Math.min(rawMatchCount, Math.max(0, values.length - 1))
    : rawMatchCount;
  return {
    ranked: {
      values,
      matchCount,
      ratingType,
      source: "session",
    },
  };
}

function currentRankingCatalog() {
  return (
    rankingCatalogCache.get(serviceLocale()) ?? {
      all: { value: DEFAULT_RANKING_HOME, label: "All" },
      regions: [],
      countries: [],
    }
  );
}

function publicRankingState(sourceState = trackerState) {
  const player = sourceState?.player ?? authenticatedPlayer;
  const playerProfileId = String(player?.profileId ?? player?.userCode ?? "");
  const authenticatedId = String(authenticatedProfileId ?? "");
  const samePlayer =
    playerProfileId === authenticatedId &&
    String(rankingState.profileId ?? "") === authenticatedId;
  const characterId = Number(sourceState?.characterId ?? player?.characterId) || null;
  const sameCharacter = Number(rankingState.characterId) === characterId;
  const sameLocale = rankingState.locale === serviceLocale();
  const sameHome = rankingState.homeKey === displaySettings.rankingHome;
  const exactRanking = samePlayer && sameCharacter && sameLocale && sameHome;
  // Ranking pages expose `my_ranking_info` only for the authenticated player.
  // For a different player selected in match history, use the exact current-
  // character overall rank returned by that player's freshly fetched official
  // profile. HOME-specific ranking cannot be inferred for another account.
  const profileRank = Number(player?.mrRank);
  const otherProfileRanking =
    Boolean(playerProfileId) &&
    playerProfileId !== authenticatedId &&
    Number(player?.mr) > 0 &&
    Number.isFinite(profileRank) &&
    profileRank > 0;
  const profileHome = currentRankingCatalog().all ?? {
    value: DEFAULT_RANKING_HOME,
    label: "All",
  };
  return {
    status: exactRanking ? rankingState.status : otherProfileRanking ? "ready" : "idle",
    rank: exactRanking ? rankingState.rank : otherProfileRanking ? profileRank : null,
    rating: exactRanking ? rankingState.rating : otherProfileRanking ? player.mr : null,
    characterId,
    homeKey: otherProfileRanking ? profileHome.value : displaySettings.rankingHome,
    homeLabel: otherProfileRanking
      ? profileHome.label
      : rankingHomeLabel(currentRankingCatalog(), displaySettings.rankingHome),
    updatedAt: exactRanking
      ? rankingState.updatedAt
      : otherProfileRanking
        ? player.profileUpdatedAt ?? null
        : null,
  };
}

function publicTrackerState() {
  const viewState = historyViewTrackerState();
  const sourceState = viewState ?? trackerState;
  repairRatingBaseline(sourceState);
  const {
    seenReplayIds: _privateIds,
    characterStates: _privateCharacterStates,
    ...publicState
  } = sourceState;
  const median = publicMedianRating(sourceState);
  const presentationPlayer = sourceState.player ?? historyViewPlayer ?? authenticatedPlayer;
  const ranking = publicRankingState(sourceState);
  return {
    ...publicState,
    ...median,
    presentation: buildPresentationState({
      sourceState,
      player: presentationPlayer,
      matchType: displaySettings.matchType,
      median,
      ranking,
    }),
    ranking,
    graphData: publicGraphData(sourceState),
    overlaySuppressed,
    selectedMatchType: displaySettings.matchType,
    displaySettings: publicDisplaySettings(),
  };
}

function publicOverlayState() {
  const viewState = historyViewTrackerState();
  const sourceState = viewState ?? trackerState;
  repairRatingBaseline(sourceState);
  const median = publicMedianRating(sourceState);
  const graphData = publicGraphData(sourceState);
  const liveOverlayBounds =
    displaySettings.mode === "overlay" &&
    statsWindow &&
    !statsWindow.isDestroyed()
      ? statsWindow.getBounds()
      : null;
  const savedOverlayBounds = statsWindowBounds.overlay;
  const overlayPreset = statsWindowPresetFor("overlay");
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
  const presentationPlayer = sourceState.player ?? historyViewPlayer ?? authenticatedPlayer;
  const ranking = publicRankingState(sourceState);
  const presentation = buildPresentationState({
    sourceState,
    player: presentationPlayer,
    matchType: displaySettings.matchType,
    median,
    ranking,
  });
  return {
    active: sourceState.active,
    currentRating: sourceState.currentRating,
    currentRatingType: sourceState.ratingType || authenticatedRatingType,
    ratingDelta: sourceState.ratingDelta,
    stats: sourceState.stats,
    overlaySuppressed,
    medianRating: median.medianRating,
    medianRatingType: median.medianRatingType,
    medianRatingSampleCount: median.medianRatingSampleCount,
    graphData,
    presentation,
    ranking,
    ratingType: sourceState.ratingType || authenticatedRatingType,
    selectedMatchType: displaySettings.matchType,
    overlaySize: {
      width: Math.min(
        overlayPreset.maxWidth ?? STATS_WINDOW_PRESETS.overlay.maxWidth,
        Math.max(
          overlayPreset.minWidth ?? 300,
          Number(overlaySize.width) || fallbackOverlaySize.width,
        ),
      ),
      height: Math.min(
        overlayPreset.maxHeight ?? STATS_WINDOW_PRESETS.overlay.maxHeight,
        Math.max(
          overlayPreset.minHeight ?? 68,
          Number(overlaySize.height) || fallbackOverlaySize.height,
        ),
      ),
    },
    displaySettings: {
      matchType: displaySettings.matchType,
      windowOrientation: displaySettings.windowOrientation,
      fontScale: displaySettings.fontScale,
      graphLabelScale: displaySettings.graphLabelScale,
      graphMatchCount: displaySettings.graphMatchCount,
      backgroundOpacity: displaySettings.backgroundOpacity,
      displayItems: displaySettings.displayItems,
      potentialLineVisible: displaySettings.potentialLineVisible,
      fontFamily: displaySettings.fontFamily,
      fontStyle: displaySettings.fontStyle,
      textColor: displaySettings.textColor,
      locale: displaySettings.locale,
    },
  };
}

function broadcastOverlayState() {
  if (!overlayEventClients.size) return;
  const message = `event: state\ndata: ${JSON.stringify(publicOverlayState())}\n\n`;
  for (const response of [...overlayEventClients]) {
    try {
      response.write(message);
    } catch {
      overlayEventClients.delete(response);
    }
  }
}

function sendTrackerState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tracker:state", publicTrackerState());
  }
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.webContents.send("tracker:state", publicTrackerState());
  }
  broadcastOverlayState();
}

function publicDisplaySettings({ statsWindowVisible } = {}) {
  const actualStatsWindowVisible =
    Boolean(statsWindow) &&
    !statsWindow.isDestroyed() &&
    statsWindow.isVisible();
  return {
    ...displaySettings,
    rankingHomeOptions: currentRankingCatalog(),
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

function statsWindowPresetFor(mode = displaySettings.mode) {
  const isOverlay = mode === "overlay";
  const isVertical = displaySettings.windowOrientation === "vertical";
  const metricCount = visibleMetricCount(displaySettings.displayItems);
  const graphVisible = displaySettings.displayItems.graph === true;
  const graphOnly = metricCount === 0 && graphVisible;
  const horizontalGraphWithMetrics = metricCount > 0 && graphVisible;
  const graphOnlyMinimum = GRAPH_ONLY_MINIMUM_SIZE[
    isVertical ? "vertical" : "horizontal"
  ];
  if (isVertical) {
    const cardHeight = isOverlay ? 76 : 86;
    const cardArea = metricCount
      ? metricCount * cardHeight + Math.max(0, metricCount - 1) * 8
      : 0;
    const graphArea = graphVisible ? (isOverlay ? 184 : 230) : 0;
    const contentGap = metricCount && graphVisible ? 8 : 0;
    const outerAllowance = metricCount || !graphVisible ? 20 : 8;
    const height = Math.min(
      1080,
      Math.max(
        graphOnly ? graphOnlyMinimum.height : 96,
        cardArea + graphArea + contentGap + outerAllowance,
      ),
    );
    return {
      width: 380,
      height,
      minWidth: graphOnly ? graphOnlyMinimum.width : 300,
      minHeight: graphOnly
        ? graphOnlyMinimum.height
        : Math.min(height, Math.max(82, cardArea + (graphVisible ? 130 : 0) + 12)),
      maxWidth: 600,
      maxHeight: 1100,
    };
  }

  const preferredCardWidth = isOverlay ? 118 : 142;
  const minimumCardWidth = isOverlay ? 76 : 88;
  const preferredMetricWidth = metricCount
    ? metricCount * preferredCardWidth + Math.max(0, metricCount - 1) * 6 + 20
    : 0;
  const minimumMetricWidth = metricCount
    ? metricCount * minimumCardWidth + Math.max(0, metricCount - 1) * 4 + 12
    : 0;
  const width = Math.min(1200, Math.max(graphVisible ? 520 : 320, preferredMetricWidth));
  const minWidth = Math.min(
    1000,
    Math.max(
      horizontalGraphWithMetrics
        ? HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE.width
        : graphVisible
          ? 380
          : 300,
      minimumMetricWidth,
    ),
  );
  const cardArea = metricCount ? (isOverlay ? 60 : 94) : 0;
  const graphArea = graphVisible ? (isOverlay ? 112 : 184) : 0;
  const outerAllowance = metricCount || !graphVisible ? 16 : 6;
  const height = Math.max(
    graphOnly ? graphOnlyMinimum.height : 68,
    cardArea + graphArea + (metricCount && graphVisible ? 6 : 0) + outerAllowance,
  );
  return {
    width,
    height,
    minWidth: graphOnly ? Math.max(minWidth, graphOnlyMinimum.width) : minWidth,
    minHeight: graphOnly
      ? graphOnlyMinimum.height
      : horizontalGraphWithMetrics
        ? HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE.height
        : Math.max(
            68,
            Math.min(
              height,
              (metricCount ? 52 : 0) + (graphVisible ? 90 : 0) + 12,
            ),
          ),
    maxWidth: 1200,
    maxHeight: isOverlay ? 520 : 700,
  };
}

function currentStatsWindowPreset() {
  return statsWindowPresetFor(displaySettings.mode);
}

function sendDisplaySettings() {
  for (const target of [mainWindow, statsWindow]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send("display:settings", publicDisplaySettings());
    }
  }
  broadcastOverlayState();
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
  const previousDisplayItems = { ...displaySettings.displayItems };
  const previousMatchType = displaySettings.matchType;
  const previousLocale = displaySettings.locale;
  const previousPollInterval = displaySettings.pollIntervalSeconds;
  const previousRankingHome = displaySettings.rankingHome;
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
  if (GRAPH_MATCH_COUNT_OPTIONS.has(Number(nextSettings.graphMatchCount))) {
    displaySettings.graphMatchCount = Number(nextSettings.graphMatchCount);
  }
  if (Number.isFinite(Number(nextSettings.backgroundOpacity))) {
    displaySettings.backgroundOpacity = Math.min(
      1,
      Math.max(0, Number(nextSettings.backgroundOpacity)),
    );
  }
  if (nextSettings.displayItems && typeof nextSettings.displayItems === "object") {
    displaySettings.displayItems = applyDisplayItemUpdate(
      displaySettings.displayItems,
      nextSettings.displayItems,
    );
  } else if (typeof nextSettings.graphVisible === "boolean") {
    // Accept the previous renderer payload during an in-place update, but keep
    // displayItems as the only persisted source of truth.
    displaySettings.displayItems = applyDisplayItemUpdate(displaySettings.displayItems, {
      graph: nextSettings.graphVisible,
    });
  }
  if (typeof nextSettings.potentialLineVisible === "boolean") {
    displaySettings.potentialLineVisible = nextSettings.potentialLineVisible;
  }
  if (Object.hasOwn(nextSettings, "rankingHome")) {
    displaySettings.rankingHome = sanitizeRankingHomeKey(nextSettings.rankingHome);
  }
  const displayItemsChanging = !displayItemsEqual(
    previousDisplayItems,
    displaySettings.displayItems,
  );
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
    rankingState = {
      ...rankingState,
      status: "idle",
      rank: null,
      rating: null,
      locale: displaySettings.locale,
      homeLabel: "—",
      updatedAt: null,
    };
    sendTrackerState();
    if (trackerState.player || historyViewPlayer || authenticatedPlayer) {
      void refreshTrackedPlayerForLocale().then(() =>
        refreshMasterRanking().catch(() => {}),
      );
    }
    if (mainWindow?.isVisible()) scheduleSocialRefresh({ immediate: true });
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
      displayItemsChanging,
    restoreSavedBounds:
      previousMode !== displaySettings.mode ||
      previousOrientation !== displaySettings.windowOrientation,
  });
  scheduleSettingsWrite();
  sendDisplaySettings();
  if (previousMatchType !== displaySettings.matchType) {
    // The shared presentation model includes match-type-specific W/L and
    // delta values. Push a fresh model with the settings event so the
    // management screen and Electron stats window do not render one frame
    // from the previous mode while OBS already has the new state.
    sendTrackerState();
  }
  if (
    trackerState.active &&
    previousPollInterval !== displaySettings.pollIntervalSeconds
  ) {
    schedulePolling();
  }
  if (
    previousPollInterval !== displaySettings.pollIntervalSeconds &&
    mainWindow?.isVisible()
  ) {
    scheduleSocialRefresh();
  }
  if (previousRankingHome !== displaySettings.rankingHome) {
    void refreshMasterRanking().catch(() => {});
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
    void ensureRankingMetadata().catch(() => {});
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
  mainWindow.on("show", () => scheduleSocialRefresh({ immediate: true }));
  mainWindow.on("hide", () => stopSocialRefresh());
  mainWindow.on("close", (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      // Closing the management window only hides it to the tray.  Do not
      // close an active overlay/window presentation as a side effect.
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    stopSocialRefresh();
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

function openLoginWindow(targetUrl = `${serviceHome()}/auth/loginep?redirect_url=/fighterslist/search`) {
  if (!isAllowedAuthUrl(targetUrl)) throw new Error("SERVICE_URL_NOT_ALLOWED");
  const refreshAuthenticationOnClose = targetUrl.includes("/auth/loginep");
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.loadURL(targetUrl);
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
    loginWindow.loadURL(targetUrl);
    loginWindow.on("closed", () => {
      loginWindow = null;
      releaseAppUiModal();
      if (!refreshAuthenticationOnClose) return;
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
  profileRefreshCache.clear();
  profileRefreshInFlight.clear();
  profileCharacterNameCache.clear();
  rankingCache.clear();
  rankingCatalogCache.clear();
  rankingCharacterSlugCache.clear();
  rankingInFlight.clear();
  stopSocialRefresh();
  socialRefreshInFlight.clear();
  rankingState = {
    status: "idle",
    rank: null,
    rating: null,
    profileId: null,
    locale: null,
    characterId: null,
    homeKey: displaySettings.rankingHome,
    homeLabel: "All",
    updatedAt: null,
  };
  socialState = {
    friends: { status: "idle", page: 1, totalPages: 1, pageSize: 0, players: [] },
    following: { status: "idle", page: 1, totalPages: 1, pageSize: 0, players: [] },
    updatedAt: null,
  };
  stopHistoryViewPolling();
  historyViewPlayer = null;
  matchHistoryFetchInFlight = null;
  matchHistoryFetchProgress = null;
  authenticatedProfileId = null;
  authenticatedPlayer = null;
  authenticatedRatingType = "MR";
  sendSocialState();
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
  buildIdLocale = null;
  sendTrackerState();
  sendDisplaySettings();
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

function openSocialProfile(profileId) {
  const normalized = normalizeHistoryProfileId(profileId);
  if (!normalized) throw new Error("INVALID_USER_CODE");
  openLoginWindow(`${serviceHome()}/profile/${encodeURIComponent(normalized)}`);
  return { opened: true };
}

async function ensureRankingMetadata() {
  const locale = serviceLocale();
  const cachedCatalog = rankingCatalogCache.get(locale);
  const cachedCharacters = rankingCharacterSlugCache.get(locale);
  if (cachedCatalog && cachedCharacters) {
    return { catalog: cachedCatalog, characters: cachedCharacters };
  }
  const metadataKey = `metadata:${locale}`;
  if (rankingInFlight.has(metadataKey)) return rankingInFlight.get(metadataKey);
  const request = (async () => {
    const data = await fetchServiceJson("ranking/master.json", {
      page: 1,
      season_type: 1,
    });
    const catalog = buildRankingHomeCatalog(data);
    const characters = buildCharacterSlugCatalog(data);
    rankingCatalogCache.set(locale, catalog);
    rankingCharacterSlugCache.set(locale, characters);
    sendDisplaySettings();
    return { catalog, characters };
  })().finally(() => rankingInFlight.delete(metadataKey));
  rankingInFlight.set(metadataKey, request);
  return request;
}

function setRankingUnavailable(player, characterId, status = "idle") {
  rankingState = {
    status,
    rank: null,
    rating: null,
    profileId: String(player?.profileId ?? player?.userCode ?? ""),
    locale: serviceLocale(),
    characterId: Number(characterId) || null,
    homeKey: displaySettings.rankingHome,
    homeLabel: rankingHomeLabel(currentRankingCatalog(), displaySettings.rankingHome),
    updatedAt: Date.now(),
  };
  sendTrackerState();
  return publicRankingState();
}

async function refreshMasterRanking({
  player = trackerState.player ?? authenticatedPlayer,
  characterId = trackerState.characterId ?? player?.characterId,
} = {}) {
  const profileId = String(player?.profileId ?? player?.userCode ?? "").trim();
  const expectedCharacterId = Number(characterId) || null;
  const isMaster = Number(player?.mr) > 0;
  if (!profileId || !expectedCharacterId || !isMaster) {
    return setRankingUnavailable(player, expectedCharacterId);
  }

  const locale = serviceLocale();
  const homeKey = sanitizeRankingHomeKey(displaySettings.rankingHome);
  const cacheKey = rankingCacheKey({
    locale,
    profileId,
    characterId: expectedCharacterId,
    homeKey,
    act: 1,
  });
  if (rankingInFlight.has(cacheKey)) return rankingInFlight.get(cacheKey);

  const previous = rankingCache.get(cacheKey) ?? null;
  rankingState = {
    status: "loading",
    rank: previous?.rank ?? null,
    rating: previous?.rating ?? null,
    profileId,
    locale,
    characterId: expectedCharacterId,
    homeKey,
    homeLabel: rankingHomeLabel(currentRankingCatalog(), homeKey),
    updatedAt: previous?.updatedAt ?? null,
  };
  sendTrackerState();

  const request = (async () => {
    try {
      const { catalog, characters } = await ensureRankingMetadata();
      if (locale !== serviceLocale()) return publicRankingState();
      const characterSlug = rankingCharacterSlug(
        player,
        expectedCharacterId,
        characters,
      );
      if (!characterSlug) throw new Error("RANKING_CHARACTER_NOT_FOUND");
      const data = await fetchServiceJson(
        "ranking/master.json",
        rankingRequestQuery({ characterSlug, homeKey }),
      );
      const normalized = normalizeMasterRanking(data, {
        profileId,
        characterId: expectedCharacterId,
      });
      if (String(authenticatedProfileId ?? "") !== profileId) {
        return publicRankingState();
      }
      const now = Date.now();
      const next = normalized
        ? { ...normalized, updatedAt: now }
        : { rank: null, rating: null, characterId: expectedCharacterId, updatedAt: now };
      rankingCache.set(cacheKey, next);
      if (
        locale === serviceLocale() &&
        homeKey === displaySettings.rankingHome &&
        String(authenticatedProfileId ?? "") === profileId
      ) {
        rankingState = {
          status: "ready",
          rank: next.rank,
          rating: next.rating,
          profileId,
          locale,
          characterId: expectedCharacterId,
          homeKey,
          homeLabel: rankingHomeLabel(catalog, homeKey),
          updatedAt: now,
        };
        sendTrackerState();
      }
      return publicRankingState();
    } catch {
      const fallback = rankingCache.get(cacheKey) ?? null;
      if (
        locale === serviceLocale() &&
        homeKey === displaySettings.rankingHome &&
        String(authenticatedProfileId ?? "") === profileId
      ) {
        rankingState = {
          status: "error",
          rank: fallback?.rank ?? null,
          rating: fallback?.rating ?? null,
          profileId,
          locale,
          characterId: expectedCharacterId,
          homeKey,
          homeLabel: rankingHomeLabel(currentRankingCatalog(), homeKey),
          updatedAt: fallback?.updatedAt ?? null,
        };
        sendTrackerState();
      }
      return publicRankingState();
    }
  })().finally(() => rankingInFlight.delete(cacheKey));
  rankingInFlight.set(cacheKey, request);
  return request;
}

function publicSocialState() {
  return {
    friends: { ...socialState.friends, players: [...socialState.friends.players] },
    following: { ...socialState.following, players: [...socialState.following.players] },
    updatedAt: socialState.updatedAt,
  };
}

function sendSocialState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("social:state", publicSocialState());
  }
}

async function refreshSocialKind(kind, page = socialState[kind]?.page ?? 1) {
  if (!["friends", "following"].includes(kind)) throw new Error("SOCIAL_KIND_INVALID");
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1));
  const profileIdAtRequest = String(authenticatedProfileId ?? "");
  const requestKey = `${kind}:${requestedPage}:${serviceLocale()}`;
  if (socialRefreshInFlight.has(requestKey)) return socialRefreshInFlight.get(requestKey);
  const previous = socialState[kind];
  socialState[kind] = { ...previous, status: "loading" };
  sendSocialState();
  const request = (async () => {
    try {
      const relativePath = kind === "following"
        ? "fighterslist/follow.json"
        : "fighterslist/friend.json";
      const data = await fetchServiceJson(relativePath, { page: requestedPage });
      if (String(authenticatedProfileId ?? "") !== profileIdAtRequest) {
        return publicSocialState();
      }
      const normalized = normalizeSocialPage(data, kind);
      socialState[kind] = { ...normalized, status: "ready" };
      socialState.updatedAt = Date.now();
    } catch (error) {
      socialState[kind] = { ...previous, status: "error" };
      throw error;
    } finally {
      sendSocialState();
    }
    return publicSocialState();
  })().finally(() => socialRefreshInFlight.delete(requestKey));
  socialRefreshInFlight.set(requestKey, request);
  return request;
}

async function refreshSocialLists() {
  const results = await Promise.allSettled([
    refreshSocialKind("friends", socialState.friends.page),
    refreshSocialKind("following", socialState.following.page),
  ]);
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].reason;
  }
  return publicSocialState();
}

function stopSocialRefresh() {
  clearTimeout(socialRefreshTimer);
  socialRefreshTimer = null;
}

function scheduleSocialRefresh({ immediate = false } = {}) {
  stopSocialRefresh();
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  const run = async () => {
    socialRefreshTimer = null;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (authenticatedProfileId) await refreshSocialLists().catch(() => {});
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      scheduleSocialRefresh();
    }
  };
  const delay = immediate ? 0 : displaySettings.pollIntervalSeconds * 1000;
  socialRefreshTimer = setTimeout(run, delay);
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
  player = await refreshProfilePlayer(player);
  return { authenticated: true, player, friendPage: normalizeSocialPage(data, "friends") };
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
    if (result.friendPage) {
      socialState.friends = { ...result.friendPage, status: "ready" };
      socialState.updatedAt = Date.now();
      sendSocialState();
    }
    if (!trackerState.active) {
      trackerState.ratingType = authenticatedRatingType;
      trackerState.updatedAt = Date.now();
      sendTrackerState();
    }
    await Promise.allSettled([
      refreshMasterRanking({ player, characterId: player?.characterId }),
      refreshSocialKind("following", socialState.following.page),
    ]);
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

async function refreshProfilePlayer(player, { force = false } = {}) {
  const profileId = normalizeHistoryProfileId(player?.profileId ?? player?.userCode);
  if (!profileId) return player;
  const characterId = Number(player?.characterId) || 0;
  const requestedLocale = serviceLocale();
  const cacheKey = `${requestedLocale}:${profileId}:${characterId}`;
  const now = Date.now();
  const cacheResult = profileCacheLookup(
    profileRefreshCache,
    cacheKey,
    now,
    PROFILE_REFRESH_COOLDOWN_MS,
    force,
  );
  if (cacheResult.hit) {
    return cacheResult.player ?? player;
  }

  // Share an in-flight request for the same locale/profile/character. This
  // covers simultaneous authentication, history-view, and polling refreshes;
  // force refreshes also join an already-running request instead of creating
  // a second request against the official service.
  return shareInFlightRequest(profileRefreshInFlight, cacheKey, async () => {
    const exactCachedName = profileCharacterNameCache.get(cacheKey)?.name ?? "";
    const sameCharacter = Number(player?.characterId) === characterId;
    const retainedName = exactCachedName ||
      (sameCharacter ? String(player?.characterDisplayName ?? "").trim() : "");
    const retainedNameKey = exactCachedName
      ? cacheKey
      : sameCharacter
        ? String(player?.characterDisplayNameCacheKey ?? "")
        : "";
    try {
      // The official profile page's locale-specific Next data is the source of
      // the live CURRENT MR/LP. A replay contains only the value at match
      // time, so it must never overwrite the current profile value.
      const data = await fetchServiceJson(
        `profile/${encodeURIComponent(profileId)}.json`,
      );
      if (requestedLocale !== serviceLocale()) return player;
      const refreshed = normalizeProfilePlayer(data, player);
      if (!refreshed) throw new Error("PROFILE_RATING_NOT_FOUND");
      const officialName = String(refreshed.characterDisplayName ?? "").trim();
      if (officialName) {
        profileCharacterNameCache.set(cacheKey, {
          fetchedAt: now,
          name: officialName,
        });
      }
      const nextPlayer = {
        ...refreshed,
        profileUpdatedAt: now,
        characterDisplayName: officialName || retainedName,
        characterDisplayNameCacheKey: officialName ? cacheKey : retainedNameKey,
      };
      profileRefreshCache.set(cacheKey, { fetchedAt: now, player: nextPlayer });
      return nextPlayer;
    } catch {
      // Never replace a known-good current value with a replay baseline when
      // the optional profile request fails. Cache the failure briefly to
      // preserve the site's request budget and retry on a later polling cycle.
      const fallbackPlayer = {
        ...player,
        characterDisplayName: retainedName,
        characterDisplayNameCacheKey: retainedNameKey,
      };
      profileRefreshCache.set(cacheKey, { fetchedAt: now, player: fallbackPlayer });
      return fallbackPlayer;
    }
  });
}

async function refreshTrackedPlayerForLocale() {
  if (!trackerState.player && !historyViewPlayer && !authenticatedPlayer) return;
  if (localeRefreshInFlight) return localeRefreshInFlight;

  const requestedLocale = serviceLocale();
  const trackerPlayerAtStart = trackerState.player;
  const historyPlayerAtStart = historyViewPlayer;
  const authenticatedPlayerAtStart = authenticatedPlayer;
  const samePlayerTuple = (current, previous) =>
    normalizeHistoryProfileId(current?.profileId ?? current?.userCode) ===
      normalizeHistoryProfileId(previous?.profileId ?? previous?.userCode) &&
    (Number(current?.characterId) || 0) === (Number(previous?.characterId) || 0);
  localeRefreshInFlight = (async () => {
    try {
      const [nextTrackerPlayer, nextHistoryPlayer, nextAuthenticatedPlayer] =
        await Promise.all([
          trackerPlayerAtStart
            ? refreshProfilePlayer(trackerPlayerAtStart, { force: true })
            : null,
          historyPlayerAtStart
            ? refreshProfilePlayer(historyPlayerAtStart, { force: true })
            : null,
          authenticatedPlayerAtStart
            ? refreshProfilePlayer(authenticatedPlayerAtStart, { force: true })
            : null,
        ]);
      if (requestedLocale !== serviceLocale()) return;
      if (
        nextTrackerPlayer &&
        samePlayerTuple(trackerState.player, trackerPlayerAtStart)
      ) {
        trackerState.player = nextTrackerPlayer;
        trackerState.updatedAt = Date.now();
      }
      if (
        nextHistoryPlayer &&
        samePlayerTuple(historyViewPlayer, historyPlayerAtStart)
      ) {
        historyViewPlayer = nextHistoryPlayer;
      }
      if (
        nextAuthenticatedPlayer &&
        samePlayerTuple(authenticatedPlayer, authenticatedPlayerAtStart)
      ) {
        authenticatedPlayer = nextAuthenticatedPlayer;
        authenticatedRatingType =
          authenticatedPlayer.mr != null ? "MR" : authenticatedPlayer.lp != null ? "LP" : "MR";
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("auth:player", authenticatedPlayer);
        }
      }
      sendHistoryState();
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

async function fetchMatchHistoryPages(profileId, onPage = null) {
  const replays = [];
  for (let page = 1; page <= MATCH_HISTORY_MAX_PAGES; page += 1) {
    const result = await fetchRankedReplaysPage(profileId, page);
    replays.push(...result.replays);
    if (typeof onPage === "function") {
      await onPage({ ...result, page, replays: [...result.replays] });
    }
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
    let fetchedCount = 0;
    let newReplayCount = 0;
    matchHistoryFetchProgress = {
      profileId: player.profileId,
      page: 0,
      maxPages: MATCH_HISTORY_MAX_PAGES,
      fetchedCount: 0,
    };
    sendHistoryState();
    await fetchMatchHistoryPages(player.profileId, async ({ page, replays }) => {
      fetchedCount += replays.length;
      for (const replay of replays) {
        if (replay.replayId && !previousReplayIds.has(replay.replayId)) {
          previousReplayIds.add(replay.replayId);
          newReplayCount += 1;
        }
      }
      matchHistoryFetchProgress = {
        profileId: player.profileId,
        page,
        maxPages: MATCH_HISTORY_MAX_PAGES,
        fetchedCount,
      };
      // Persist and notify after every page. This lets the renderer update
      // the summary, charts, and table while later pages remain queued.
      const changed = mergeMatchHistory(replays, player.profileId);
      if (!changed) sendHistoryState();
      sendTrackerState();
    });
    const fetchedStore = loadMatchHistoryStore(player.profileId);
    fetchedStore.lastFetchedAt = Date.now();
    persistMatchHistoryStore(player.profileId, fetchedStore);
    if (
      historyViewPlayer &&
      historyViewPlayer.profileId === player.profileId &&
      newReplayCount > 0
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
    matchHistoryFetchProgress = null;
    sendHistoryState();
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
    // Selecting a history target is an explicit lookup action. Refresh the
    // official profile once here even if a recent cached search result exists,
    // so CURRENT MR and the current character's overall MR rank are visible
    // before the 100-match history fetch starts.
    nextHistoryViewPlayer = await refreshProfilePlayer(nextHistoryViewPlayer, {
      force: true,
    });
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

async function startTrackingInternal(player) {
  player = await refreshProfilePlayer(player);
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
    trackerState = syncCurrentPlayerRatingState(
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
      player.ratingSource === "profile"
        ? player.mr ?? player.lp ?? newestRanked?.rating ?? null
        : newestRanked?.rating ?? player.mr ?? player.lp ?? null;
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

  await refreshMasterRanking({
    player: trackerState.player,
    characterId: trackerState.characterId,
  }).catch(() => {});

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
  const previousMr = trackerState.player?.mr ?? null;
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
  const newRankedReplays = findNewRankedReplays(replays, previousReplayIds);
  const hasNewRankedReplay = newRankedReplays.length > 0;
  trackerState = applyNewReplays(trackerState, replays);
  const characterChanged =
    previousCharacterId != null &&
    trackerState.characterId != null &&
    previousCharacterId !== trackerState.characterId;
  if (hasNewRankedReplay || characterChanged) {
    const newestReplay = [...newRankedReplays]
      .sort((a, b) => Number(b.uploadedAt) - Number(a.uploadedAt))[0];
    // Keep replay snapshots in the graph/history, but never use one as the
    // current rating when the official profile request is unavailable.
    const playerHint = buildProfileRefreshHint(
      trackerState.player,
      trackerState.characterId ?? newestReplay?.characterId,
      newestReplay?.ownCharacterName,
    );
    const refreshedPlayer = await refreshProfilePlayer(playerHint, {
      force: true,
    });
    if (sessionId !== trackingSessionId || !trackerState.active) {
      return publicTrackerState();
    }
    trackerState.player = refreshedPlayer;
    trackerState = syncCurrentPlayerRatingState(
      trackerState,
      refreshedPlayer,
      hasNewRankedReplay,
    );
  }
  if (shouldRefreshRanking({
    characterChanged,
    newRankedMatchCount: newRankedReplays.length,
    previousMr,
    currentMr: trackerState.player?.mr ?? null,
    isMaster: Number(trackerState.player?.mr) > 0,
  })) {
    await refreshMasterRanking({
      player: trackerState.player,
      characterId: trackerState.characterId,
    }).catch(() => {});
  } else if (Number(trackerState.player?.mr) <= 0) {
    setRankingUnavailable(trackerState.player, trackerState.characterId);
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
    DISPLAY_ITEM_REQUIRED: "表示項目は最低1つ選択してください",
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
    "social:state",
    resultHandler(async () => publicSocialState(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "social:refresh",
    resultHandler(({ kind }) =>
      kind ? refreshSocialKind(kind, socialState[kind]?.page) : refreshSocialLists(),
    ),
  );
  ipcMain.handle(
    "social:page",
    resultHandler(({ kind, page }) => refreshSocialKind(kind, page)),
  );
  ipcMain.handle(
    "social:open-profile",
    resultHandler(({ profileId }) => openSocialProfile(profileId)),
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
    if (requestPath === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      });
      overlayEventClients.add(response);
      response.write(`event: state\ndata: ${JSON.stringify(publicOverlayState())}\n\n`);
      request.on("close", () => overlayEventClients.delete(response));
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
  stopSocialRefresh();
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
