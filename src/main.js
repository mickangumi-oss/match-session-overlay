"use strict";

const fs = require("node:fs");
const { createHash } = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
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
  normalizeStoredRoundResults,
  profileCacheLookup,
  repairRatingBaseline,
  parseBuildId,
  parseNextData,
  shareInFlightRequest,
  snapshotCurrentCharacter,
  syncCurrentPlayerRatingState,
} = require("./source-client");
const {
  isKnownHistoryActRecord,
  mergeHistoryActProvenance,
  normalizeStoredHistoryAct,
  readHistoryActProvenance,
} = require("./history-act-provenance");
const { buildServiceDataUrl, buildServiceHomeUrl } = require("./service-url");
const {
  MAX_CONSECUTIVE_FAILURES,
  POLL_JITTER_MAX_MS,
  SERVICE_REQUEST_MIN_GAP_MS,
  errorBackoffMs,
  retryAfterMilliseconds,
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
const {
  compactStatsWindowInitialSize,
  clampBoundsToWorkArea,
  horizontalMetricMinimumWidth,
  mainWindowInitialHeight,
  resizeBoundsForDisplayItemCount,
  resizeBoundsForGraphVisibility,
  statsWindowSizeConstraints,
} = require("./stats-window-size");
const { suggestedInitialLocale } = require("./initial-language");
const { buildPresentationState } = require("./presentation-model");
const {
  currentProfileRating,
  deriveHistoryRatingSeries,
} = require("./history-current-rating");
const {
  estimatePotentialMrFromMatches,
  POTENTIAL_MR_MATCH_LIMIT,
  potentialRatingValue,
} = require("./potential-rating");
const {
  buildTrackerSessionPayload,
  hasRetainedTrackerSession,
  restoreTrackerSession,
} = require("./tracker-session-state");
const { createRankingRetryController } = require("./ranking-retry-controller");
const {
  createSessionAchievementState,
  updateSessionAchievements,
} = require("./session-achievements");
const {
  explicitOtherPlayerRankingAllowed,
  normalizeLeagueRanking,
  normalizeMasterRanking,
  rankingCharacterSlug,
  rankingCacheKey,
  rankingRequestQuery,
  rankingRetryScopeMatches,
  resolveRankingFetchResult,
  shouldRefreshRanking,
} = require("./ranking-model");
const {
  normalizeSocialPage,
  paginateSocialPlayers,
  socialSourcePagePlan,
} = require("./social-model");
const {
  applyFriendOnlineSnapshot,
  createFriendOnlineNotificationBatch,
  createFriendOnlineNotificationState,
  friendOnlineNotificationView,
  getFriendNotificationAccountEpoch,
  mergeFriendOnlineNotificationBatch,
  resetFriendOnlineNotificationAccount,
} = require("./friend-online-notifications");
const { fetchCompleteFriendSnapshot } = require("./friend-snapshot");
const {
  SOCIAL_IDLE_SUSPEND_MS,
  SOCIAL_MANUAL_COOLDOWN_MS,
  SOCIAL_REFRESH_JITTER_MAX_MS,
  manualSocialRefreshAllowed,
  shouldSuspendSocialRefresh,
  socialRefreshDelayMs,
} = require("./social-refresh-policy");
const {
  NO_NOTIFICATION_SOUND,
  listWindowsNotificationSounds,
  resolveWindowsNotificationSound,
  scalePcmWavVolume,
  sanitizeWindowsNotificationSound,
} = require("./windows-notification-sounds");
const { createUpdater } = require("./updater");
const { createDebouncedAtomicWriter } = require("./debounced-atomic-writer");
const { ServiceRequestScheduler } = require("./service-request-scheduler");
const { fetchHistoryPagesConcurrently } = require("./history-page-fetch");
const { scheduleHistoryBackfill } = require("./history-backfill-scheduler");
const { filterHistoryBackfillReplays } = require("./history-backfill-filter");
const {
  normalizeOpponentProfileContext,
  setBoundedCacheEntry,
} = require("./opponent-profile-context");
const {
  buildHistoricalOpponentSnapshots,
  mergeSnapshotObject,
  potentialMrHistoryCandidates,
  snapshotObject,
} = require("./opponent-insight");
const {
  PLAY_APPROVED_FIELD_CONTRACT,
  comparePlayProfiles,
} = require("./opponent-play-metrics");
const {
  opponentProfileFailureReason,
  playComparisonReason,
} = require("./opponent-profile-retrieval-status");
  const {
    ALLOWED_MODES: OFFICIAL_CHARACTER_STATS_MODES,
    aggregateOfficialCharacterWinRates,
    buildOfficialCharacterNameMap,
    buildOfficialCharacterStatsCacheKey,
    buildOfficialCharacterStatsRequestKey,
    isRetryableOfficialCharacterStatsReason,
    summarizeOfficialOpponentCharacterStatsRows,
    validateOfficialOpponentCharacterWinRates,
    validateOfficialCharacterWinRates,
  } = require("./official-opponent-character-stats");
const {
  ROUND_TREND_MATCH_TYPES,
  buildRoundTrend,
  buildRoundTrendFailure,
} = require("./round-results-summary");
const {
  normalizedRecordActIds,
  verifyScopedHistoryPage,
  stampScopedHistoryRecords,
  buildScopedRoundTrendContext,
} = require("./round-trend-scope");
const {
  acquireScopedOfficialHistories,
} = require("./opponent-history-cache");
const {
  ALLOWED_MATCH_MODES,
  classifyHttpResponse,
  classifyPayloadShape,
  createProductionReceipt,
  finalizeProductionReceipt,
  recordProductionReceipt,
} = require("./production-receipt");
const {
  buildHistoryActDiagnostic,
  buildOfficialActOptions,
  isCurrentHistoryActScope,
  normalizeHistoryActId,
  normalizePositiveActId,
  normalizeVerifiedHistoryCurrentAct,
  resolveHistoryActSelection,
} = require("./history-act-scope");
const {
  buildOfficialActRegistry,
  isFreshOfficialActRegistry,
} = require("./official-act-registry");
const {
  assertUpdateAllowed,
  resolveUpdateRequirement,
} = require("./update-policy");
const {
  OWN_MATCH_HISTORY_LIMIT,
  matchHistoryRetentionLimit,
  retainNewestMatchHistory,
} = require("./match-history-retention");

const APP_NAME = "MatchSessionOverlay";
const OFFICIAL_MODE_LABELS = Object.freeze({ 2: "ranked", 3: "casual", 5: "battleHub" });
const OFFICIAL_MATCH_MODE_IDS = Object.freeze({ ranked: 2, casual: 3, battleHub: 5 });
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
  window: { width: 520, height: 245 },
  overlay: { width: 520, height: 245 },
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
const windowsNotificationSounds = listWindowsNotificationSounds();

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
const trackerSessionPath = path.join(userDataPath, "tracker-session.json");
const matchHistoryDirectory = path.join(userDataPath, "match-history");
const matchHistoryPath = path.join(userDataPath, "match-history.json");
const qaDiskHistoryHarness = readQaDiskHistoryHarnessConfig();
const MATCH_HISTORY_LIMIT = OWN_MATCH_HISTORY_LIMIT;
// The battle log is paginated at ten entries per page. A manual import starts
// History imports use bounded batches (100 entries maximum); live polling
// intentionally remains a single-page request.
const MATCH_HISTORY_PAGE_SIZE = 10;
const MATCH_HISTORY_MAX_PAGES = 10;
const OPPONENT_STATS_SAFE_MAX_PAGES = 100;
// Keep official-service load bounded and configurable. Non-history traffic
// keeps the normal single-filed, rate-limited behavior.
const MATCH_HISTORY_FETCH_CONCURRENCY = 3;
const MATCH_HISTORY_START_GAP_MS = 250;
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
// Opponent profile references are fetched for acquisition-time history
// snapshots and when a history row is opened. Keep a separate cache from the
// selected-player profile cache so neither path changes the history target or
// tracker state.
const OPPONENT_PROFILE_CONTEXT_COOLDOWN_MS = 5 * 60 * 1000;
// The profile-reference IPC accepts renderer-selected tuples. Bound both the
// waiting work and retained results so distinct untrusted keys cannot grow
// scheduler backlog or process memory without limit.
const OPPONENT_PROFILE_CONTEXT_MAX_IN_FLIGHT = 16;
const OPPONENT_PROFILE_CONTEXT_MAX_CACHE_ENTRIES = 128;
const OPPONENT_OFFICIAL_HISTORY_MAX_CACHE_ENTRIES = 64;
const OFFICIAL_CHARACTER_STATS_COOLDOWN_MS = 5 * 60 * 1000;
// The official PLAY page obtains character peak MR from this API rather than
// from profile/<id>.json. Its response is joined to the profile payload only
// after the current Act has been identified.
const OPPONENT_PEAK_PROFILE_API_PATH =
  "/6/buckler/api/profile/play/act/highest/master_rating_info";
const OFFICIAL_CHARACTER_STATS_API_PATH =
  "/6/buckler/api/profile/play/act/characterwinrate";
const OFFICIAL_CHARACTER_STATS_RIVAL_API_PATH =
  "/6/buckler/api/profile/play/act/characterwinratebyrivalcharacter";

fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(sessionDataPath, { recursive: true });
fs.mkdirSync(matchHistoryDirectory, { recursive: true });
const persistedDataWriter = createDebouncedAtomicWriter({ delayMs: 350 });
app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow;
let splashWindow;
let splashOpenedAt = 0;
let splashCloseTimer;
const SPLASH_MINIMUM_VISIBLE_MS = 5000;
let mainWindowReadyToShow = false;
let managementUiReady = false;
let loginWindow;
let statsWindow;
let friendNotificationWindow;
let friendNotificationTopmostConfigured = false;
let friendNotificationPreviewWindow;
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
const serviceRequestScheduler = new ServiceRequestScheduler({
  minStartGapMs: SERVICE_REQUEST_MIN_GAP_MS,
  maxPriorityBurst: 3,
  maxConcurrent: MATCH_HISTORY_FETCH_CONCURRENCY,
});
let serviceRetryBlockedUntil = 0;
let privateDataGeneration = 0;
let verifiedHistoryCurrentAct = {
  profileId: null,
  locale: null,
  generation: null,
  scopeToken: 0,
  status: "unavailable",
  actId: null,
  source: null,
  reason: "ACT_SCOPE_MISSING",
};
let officialActRegistryState = {
  status: "unavailable",
  currentActId: null,
  acts: [],
  source: null,
  retrievedAt: null,
  proof: null,
  reason: "ACT_REGISTRY_MISSING",
};
let verifiedHistoryCurrentActScope = 0;
let privateDataClearing = false;
let persistenceReadyForQuit = false;
const serviceAbortControllers = new Set();
const socialServiceAbortControllers = new Set();
let displaySettingsWriteTimer;
let gameMonitorTimer;
let startupUpdateTimer;
let gameWasRunning = false;
let autoGameSessionActive = false;
let overlaySuppressed = false;
let isQuitting = false;
let appUiModalDepth = 0;
let applyingStatsBounds = false;
let overlayEditMode = false;
let overlayEditPreference = false;
let hasPersistedDisplaySettings = fs.existsSync(displaySettingsPath);
let initialLanguageSelectionRequired = true;
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

const restoredTrackerSession = loadPersistedTrackerSession();
let trackerState = restoredTrackerSession.trackerState;
let sessionAchievementState = restoredTrackerSession.achievementState;
let historySessionAchievementState = createSessionAchievementState();
const matchHistoryStores = new Map();
const matchHistoryRevisions = new Map();
const historyDerivedCache = new Map();
const historySummaryCache = new Map();
const historyProfileLookupCache = new Map();
const profileRefreshCache = new Map();
const profileRefreshInFlight = new Map();
const profileCharacterNameCache = new Map();
const opponentProfileContextCache = new Map();
const opponentProfileContextInFlight = new Map();
const opponentOfficialHistoryCache = new Map();
const opponentOfficialHistoryInFlight = new Map();
const officialCharacterStatsCache = new Map();
const officialCharacterStatsInFlight = new Map();
const officialCharacterNamesCache = new Map();
const officialCharacterNamesInFlight = new Map();
const historyLabelBackfillInFlight = new Map();
const historyLabelBackfillCompleted = new Set();
let matchHistoryFetchInFlight = null;
let matchHistoryFetchProfileId = null;
let matchHistoryFetchLocale = null;
let matchHistoryFetchScopeToken = 0;
let matchHistoryFetchScopeAtStart = null;
let matchHistoryFetchActId = null;
let matchHistoryFetchProgress = null;
let matchHistoryFetchSummary = null;
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
const rankingInFlight = new Map();
const rankingRetryController = createRankingRetryController();
let rankingState = {
  status: "idle",
  rank: null,
  rating: null,
  profileId: null,
  locale: null,
  characterId: null,
  ratingType: "MR",
  homeKey: "all",
  homeLabel: "All",
  updatedAt: null,
};
let socialRefreshTimer = null;
let socialIdleSuspendTimer = null;
let socialLastActivityAt = Date.now();
let socialSuspended = false;
let socialSuspendReason = null;
let socialMonitoringGeneration = 0;
let socialRefreshConsecutiveFailures = 0;
const socialManualRefreshAvailableAt = { friends: 0, following: 0 };
const socialRefreshInFlight = new Map();
let friendNotificationState = createFriendOnlineNotificationState();
let friendNotificationSnapshotVersion = 0;
let friendNotificationBatch = null;
let friendNotificationAggregationTimer = null;
let friendNotificationLeaveTimer = null;
let friendNotificationHideTimer = null;
let friendNotificationPreviewInFlight = null;
let friendNotificationPreviewLoadInFlight = null;
const notificationSoundPlaybackCache = new Map();
const SOCIAL_PAGE_SIZE = 10;
const socialSourcePages = {
  friends: new Map(),
  following: new Map(),
};
const socialSourceMeta = {
  friends: { pageSize: SOCIAL_PAGE_SIZE, totalPages: 1 },
  following: { pageSize: SOCIAL_PAGE_SIZE, totalPages: 1 },
};

function emptySocialState() {
  return {
    friends: { status: "idle", page: 1, totalPages: 1, pageSize: 0, players: [] },
    following: { status: "idle", page: 1, totalPages: 1, pageSize: 0, players: [] },
    updatedAt: null,
  };
}

function resetSocialSourcePages() {
  for (const kind of ["friends", "following"]) {
    socialSourcePages[kind].clear();
    socialSourceMeta[kind] = { pageSize: SOCIAL_PAGE_SIZE, totalPages: 1 };
  }
}

let socialState = emptySocialState();

function initializeQaDiskHistoryHarness() {
  if (!qaDiskHistoryHarness) return false;
  const { profileId, actId } = qaDiskHistoryHarness;
  historyViewPlayer = {
    profileId,
    userCode: profileId,
    name: "QA disk history profile",
    characterId: 22,
    mr: 1788,
    lp: null,
    ratingSource: "qa-fixture",
  };
  historyViewPollingActive = false;
  historyViewStopReason = "qa-disk-history";
  verifiedHistoryCurrentAct = {
    profileId,
    locale: serviceLocale(),
    generation: privateDataGeneration,
    scopeToken: verifiedHistoryCurrentActScope,
    status: "ready",
    actId,
    source: "official_profile_play",
    reason: null,
  };
  return true;
}
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
  fontFamily: "street",
  fontStyle: "normal",
  textColor: "#f7f8ff",
  pollIntervalSeconds: 120,
  locale: "ja-jp",
  launchAtLogin: false,
  autoDetectGame: false,
  gameExecutableName: "",
  friendOnlineNotificationsEnabled: false,
  friendOnlineNotificationTiming: "game-only",
  friendOnlineNotificationSound: NO_NOTIFICATION_SOUND,
  friendOnlineNotificationDurationSeconds: 5,
  friendOnlineNotificationBackgroundOpacity: 0.94,
  friendOnlineNotificationVolume: 1,
};

function serviceLocale() {
  return LOCALE_KEYS.has(displaySettings.locale) ? displaySettings.locale : "ja-jp";
}

function invalidateVerifiedHistoryCurrentAct() {
  verifiedHistoryCurrentActScope += 1;
  verifiedHistoryCurrentAct = {
    profileId: null,
    locale: null,
    generation: null,
    scopeToken: verifiedHistoryCurrentActScope,
    status: "unavailable",
    actId: null,
    source: null,
    reason: "ACT_SCOPE_MISSING",
  };
  officialActRegistryState = {
    status: "unavailable",
    currentActId: null,
    acts: [],
    source: null,
    retrievedAt: null,
    proof: null,
    reason: "ACT_REGISTRY_MISSING",
  };
}

function isCurrentHistoryActRequest({ profileId, locale, generation, scopeToken } = {}) {
  return normalizeHistoryProfileId(profileId) === activeHistoryProfileId() &&
    locale === serviceLocale() &&
    generation === privateDataGeneration &&
    scopeToken === verifiedHistoryCurrentActScope;
}

function currentVerifiedHistoryActState(profileId) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const sameScope = isCurrentHistoryActScope({
    state: verifiedHistoryCurrentAct,
    profileId: normalizedProfileId,
    locale: serviceLocale(),
    generation: privateDataGeneration,
    scopeToken: verifiedHistoryCurrentActScope,
    activeScopeToken: verifiedHistoryCurrentActScope,
  });
  return {
    currentActId: sameScope ? verifiedHistoryCurrentAct.actId : null,
    currentActSource: sameScope ? verifiedHistoryCurrentAct.source : null,
    currentActVerified: Boolean(sameScope && verifiedHistoryCurrentAct.actId != null),
    currentActStatus: sameScope ? verifiedHistoryCurrentAct.status : "unavailable",
    currentActReason: sameScope ? verifiedHistoryCurrentAct.reason : "ACT_SCOPE_MISSING",
  };
}

function publishVerifiedHistoryCurrentAct({
  profileId,
  locale,
  generation,
  requestedActId = null,
  scopeToken,
  result,
} = {}) {
  if (
    requestedActId != null ||
    scopeToken !== verifiedHistoryCurrentActScope ||
    generation !== privateDataGeneration ||
    locale !== serviceLocale()
  ) return;
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const normalized = normalizeVerifiedHistoryCurrentAct(result);
  if (result?.actRegistry?.status === "ready") {
    officialActRegistryState = result.actRegistry;
  }
  verifiedHistoryCurrentAct = {
    profileId: normalizedProfileId,
    locale,
    generation,
    scopeToken,
    status: normalized.status,
    actId: normalized.actId,
    source: normalized.source,
    reason: normalized.reason,
  };
  if (mainWindow && !mainWindow.isDestroyed()) sendHistoryState();
}

function serviceHome() {
  return buildServiceHomeUrl(SERVICE_ORIGIN, serviceLocale());
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
      Math.max(0.3, Number(savedSettings.fontScale)),
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
    initialLanguageSelectionRequired = false;
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
  displaySettings.friendOnlineNotificationsEnabled =
    savedSettings.friendOnlineNotificationsEnabled === true;
  displaySettings.friendOnlineNotificationTiming =
    savedSettings.friendOnlineNotificationTiming === "always" ? "always" : "game-only";
  displaySettings.friendOnlineNotificationSound = sanitizeWindowsNotificationSound(
    savedSettings.friendOnlineNotificationSound,
    windowsNotificationSounds,
  );
  if (Number.isInteger(Number(savedSettings.friendOnlineNotificationDurationSeconds))) {
    displaySettings.friendOnlineNotificationDurationSeconds = Math.min(
      15,
      Math.max(3, Number(savedSettings.friendOnlineNotificationDurationSeconds)),
    );
  }
  if (Number.isFinite(Number(savedSettings.friendOnlineNotificationBackgroundOpacity))) {
    displaySettings.friendOnlineNotificationBackgroundOpacity = Math.min(
      1,
      Math.max(0, Number(savedSettings.friendOnlineNotificationBackgroundOpacity)),
    );
  }
  if (Number.isFinite(Number(savedSettings.friendOnlineNotificationVolume))) {
    displaySettings.friendOnlineNotificationVolume = Math.min(
      1,
      Math.max(0, Number(savedSettings.friendOnlineNotificationVolume)),
    );
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
  const ownRating = finiteOrNull(value.ownRating ?? value.rating);
  const ownRatingType = ["MR", "LP"].includes(value.ownRatingType ?? value.ratingType)
    ? value.ownRatingType ?? value.ratingType
    : null;
  const normalizedOpponentInsightSnapshots = snapshotObject(
    value.opponentInsightSnapshots,
  );
  const normalizedRoundResults = normalizeStoredRoundResults(value.roundResults);
  const normalizedCharacterNamesByLocale = normalizeCharacterNamesByLocale(
    value.characterNamesByLocale,
  );
  const actProvenance = normalizeStoredHistoryAct(value);
  return {
    replayId,
    profileId,
    uploadedAt,
    playedAt: finiteOrNull(value.playedAt) ?? uploadedAt,
    matchType,
    ...actProvenance,
    battleTypeName: String(value.battleTypeName ?? "").slice(0, 80),
    result: ["win", "loss", "draw", "unknown"].includes(value.result)
      ? value.result
      : value.result == null
        ? "draw"
        : "unknown",
    ownName: String(value.ownName ?? "").slice(0, 80),
    ownCharacterName: String(value.ownCharacterName ?? "").slice(0, 80),
    characterId: finiteOrNull(value.characterId),
    ownRating,
    ownRatingType,
    // MASTER battle logs can contain both values. Keep both match-time
    // snapshots, but derive any official-current replacement in memory rather
    // than writing it back into this persisted record.
    ownMr: finiteOrNull(
      value.ownMr ?? value.mr ?? (ownRatingType === "MR" ? ownRating : null),
    ),
    ownLp: finiteOrNull(
      value.ownLp ?? value.lp ?? (ownRatingType === "LP" ? ownRating : null),
    ),
    opponentName: String(value.opponentName ?? "").slice(0, 80),
    opponentUserCode: normalizeHistoryProfileId(value.opponentUserCode),
    opponentCharacterName: String(value.opponentCharacterName ?? "").slice(0, 80),
    opponentCharacterId: finiteOrNull(value.opponentCharacterId),
    opponentRating: finiteOrNull(value.opponentRating),
    opponentRatingType: ["MR", "LP"].includes(value.opponentRatingType)
      ? value.opponentRatingType
      : null,
    opponentMr: finiteOrNull(
      value.opponentMr ??
        (value.opponentRatingType === "MR" ? value.opponentRating : null),
    ),
    opponentLp: finiteOrNull(
      value.opponentLp ??
        (value.opponentRatingType === "LP" ? value.opponentRating : null),
    ),
    opponentBattleInputType: ["C", "M"].includes(value.opponentBattleInputType)
      ? value.opponentBattleInputType
      : null,
    ...(normalizedCharacterNamesByLocale
      ? { characterNamesByLocale: normalizedCharacterNamesByLocale }
      : {}),
    ...(normalizedRoundResults ? { roundResults: normalizedRoundResults } : {}),
    ...(normalizedOpponentInsightSnapshots
      ? { opponentInsightSnapshots: normalizedOpponentInsightSnapshots }
      : {}),
  };
}

function normalizeCharacterNamesByLocale(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  for (const [locale, labels] of Object.entries(value)) {
    if (!LOCALE_KEYS.has(String(locale)) || !labels || typeof labels !== "object") {
      continue;
    }
    const own = String(labels.own ?? "").trim().slice(0, 80);
    const opponent = String(labels.opponent ?? "").trim().slice(0, 80);
    if (own || opponent) {
      normalized[String(locale)] = {
        ...(own ? { own } : {}),
        ...(opponent ? { opponent } : {}),
      };
    }
  }
  return Object.keys(normalized).length ? normalized : null;
}

function mergeCharacterNamesByLocale(previous, incoming) {
  const left = normalizeCharacterNamesByLocale(previous) ?? {};
  const right = normalizeCharacterNamesByLocale(incoming) ?? {};
  const merged = { ...left };
  for (const [locale, labels] of Object.entries(right)) {
    merged[locale] = { ...(merged[locale] ?? {}), ...labels };
  }
  return normalizeCharacterNamesByLocale(merged);
}

function normalizeHistoryProfileId(value) {
  const normalized = String(value ?? "").replace(/\s/g, "");
  return /^\d{4,12}$/.test(normalized) ? normalized : null;
}

// The disk-history integration harness is deliberately unreachable from a
// normal or packaged launch. It requires the local-QA marker, an unpackaged
// process, an isolated dev data root, and a marker file created by the
// test runner. The history file itself is then loaded by the same store path
// used by production; no fixture is bundled into the application.
function readQaDiskHistoryHarnessConfig() {
  if (
    app.isPackaged ||
    process.env.MATCH_OVERLAY_QA_LOCAL !== "1" ||
    process.env.MATCH_OVERLAY_QA_DISK_HISTORY !== "1" ||
    process.env.MATCH_OVERLAY_QA_DISK_HISTORY_GUARD !== "local-v1"
  ) return null;
  const devRootValue = String(process.env.MATCH_OVERLAY_DEV_DATA_ROOT ?? "").trim();
  const profileId = normalizeHistoryProfileId(
    process.env.MATCH_OVERLAY_QA_DISK_HISTORY_PROFILE,
  );
  const actId = Number(process.env.MATCH_OVERLAY_QA_DISK_HISTORY_ACT);
  if (
    !devRootValue ||
    !path.isAbsolute(devRootValue) ||
    !profileId ||
    !Number.isInteger(actId) ||
    actId <= 0
  ) return null;
  const devRoot = path.resolve(devRootValue);
  const markerPath = path.join(devRoot, ".mso-qa-disk-history-v1");
  const historyPath = path.join(
    devRoot,
    "user-data",
    "match-history",
    `${profileId}.json`,
  );
  try {
    const marker = fs.readFileSync(markerPath, "utf8").trim();
    const historyStat = fs.lstatSync(historyPath);
    if (
      marker !== "mso-qa-disk-history-v1" ||
      !historyStat.isFile() ||
      historyStat.isSymbolicLink() ||
      historyStat.size <= 0 ||
      historyStat.size > 32 * 1024 * 1024
    ) return null;
    const resolvedRoot = fs.realpathSync(devRoot).toLocaleLowerCase();
    const resolvedFile = fs.realpathSync(historyPath).toLocaleLowerCase();
    const expectedPrefix = `${resolvedRoot}${path.sep}user-data${path.sep}match-history${path.sep}`
      .toLocaleLowerCase();
    if (!resolvedFile.startsWith(expectedPrefix)) return null;
  } catch {
    return null;
  }
  return Object.freeze({ profileId, actId, devRoot });
}

function historyRetentionLimit(profileId) {
  return matchHistoryRetentionLimit({
    profileId: normalizeHistoryProfileId(profileId),
    ownProfileId: normalizeHistoryProfileId(
      authenticatedProfileId ??
        authenticatedPlayer?.profileId ??
        trackerState.player?.profileId,
    ),
    viewedProfileId: normalizeHistoryProfileId(historyViewPlayer?.profileId),
  });
}

function trimMatchHistoryStore(profileId, store) {
  if (!store || !Array.isArray(store.records)) return false;
  const retained = retainNewestMatchHistory(
    store.records,
    historyRetentionLimit(profileId),
  );
  const changed = retained.length !== store.records.length;
  store.records = retained;
  return changed;
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

function historyRevision(profileId) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  return normalizedProfileId ? matchHistoryRevisions.get(normalizedProfileId) ?? 0 : 0;
}

function bumpHistoryRevision(profileId) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId) return;
  matchHistoryRevisions.set(normalizedProfileId, historyRevision(normalizedProfileId) + 1);
  historyDerivedCache.delete(normalizedProfileId);
  historySummaryCache.delete(normalizedProfileId);
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
  trimMatchHistoryStore(normalizedProfileId, store);
  persistedDataWriter
    .schedule(filePath, JSON.stringify(store, null, 2))
    .catch(() => {});
  return true;
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
    if (migrated) {
      persistedDataWriter
        .flushAll()
        .then(() => fs.promises.rm(matchHistoryPath, { force: true }))
        .catch(() => {
          // Keep the legacy file when an atomic target write cannot complete.
        });
    }
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

function historyFetchScopeIsCurrent(profileId, scopeToken) {
  return (
    scopeToken === matchHistoryFetchScopeToken &&
    activeHistoryProfileId() === normalizeHistoryProfileId(profileId)
  );
}

function assertHistoryFetchScope(profileId, scopeToken) {
  if (!historyFetchScopeIsCurrent(profileId, scopeToken)) {
    throw new Error("HISTORY_TARGET_CHANGED");
  }
}

function historyProfileCoversLatestRecord(player, records) {
  const latest = (Array.isArray(records) ? records : [])
    .filter(
      (record) =>
        record?.matchType === "ranked" &&
        Number(record?.characterId) === Number(player?.characterId) &&
        ["MR", "LP"].includes(String(record?.ownRatingType || "").toUpperCase()) &&
        Number.isFinite(Number(record?.ownRating)),
    )
    .sort(
      (left, right) =>
        Number(left?.playedAt ?? left?.uploadedAt) -
        Number(right?.playedAt ?? right?.uploadedAt),
    )
    .at(-1);
  if (!latest) return true;
  return (
    currentProfileRating(
      player,
      String(latest.ownRatingType).toUpperCase(),
      latest.characterId,
      latest.playedAt ?? latest.uploadedAt,
    ) != null
  );
}

function historyProfilePlayer(profileId, preferredPlayer = null) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId) return null;
  return [
    preferredPlayer,
    historyViewPlayer,
    trackerState.player,
    authenticatedPlayer,
  ].find(
    (candidate) =>
      normalizeHistoryProfileId(candidate?.profileId ?? candidate?.userCode) ===
      normalizedProfileId,
  ) ?? null;
}

function mergeMatchHistory(
  replays,
  profileId,
  { persist = true, notify = true } = {},
) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId || !Array.isArray(replays)) return false;
  const store = loadMatchHistoryStore(normalizedProfileId);
  const existing = new Map(
    store.records.map((record) => [record.replayId, record]),
  );
  const normalizedIncoming = replays
    .map((replay) => {
      const replayId = String(replay?.replayId ?? "").trim();
      const previous = replayId ? existing.get(replayId) : null;
      const actProvenance = mergeHistoryActProvenance(previous, replay);
      return normalizeStoredHistoryRecord({
        ...previous,
        ...replay,
        ...actProvenance,
        characterNamesByLocale: mergeCharacterNamesByLocale(
          previous?.characterNamesByLocale,
          replay?.characterNamesByLocale,
        ),
        // Prefer a fresh battle-log value, while retaining profile-enriched
        // parallel ratings when an older API response omits one of them.
        ownMr: replay?.ownMr ?? replay?.mr ?? previous?.ownMr,
        ownLp: replay?.ownLp ?? replay?.lp ?? previous?.ownLp,
        profileId: normalizedProfileId,
      });
    })
    .filter(Boolean);
  let changed = false;
  for (const replay of normalizedIncoming) {
    const replayId = replay.replayId;
    const previous = existing.get(replayId) ?? null;
    const actProvenance = mergeHistoryActProvenance(previous, replay);
    const merged = {
      ...previous,
      ...replay,
      ...actProvenance,
      characterNamesByLocale: mergeCharacterNamesByLocale(
        previous?.characterNamesByLocale,
        replay?.characterNamesByLocale,
      ),
      profileId: normalizedProfileId,
    };
    const normalized = normalizeStoredHistoryRecord(merged);
    if (normalized && JSON.stringify(previous) !== JSON.stringify(normalized)) {
      existing.set(normalized.replayId, normalized);
      changed = true;
    }
  }
  const retained = retainNewestMatchHistory(
    [...existing.values()],
    historyRetentionLimit(normalizedProfileId),
  );
  const retentionChanged = retained.length !== existing.size;
  if (!changed && !retentionChanged) return false;
  store.records = retained;
  bumpHistoryRevision(normalizedProfileId);
  if (persist) persistMatchHistoryStore(normalizedProfileId, store);
  if (notify) sendHistoryState();
  return true;
}

// Derived opponent history is attached to the exact local replay record. It
// is intentionally not part of the normal battle-log merge payload, so a
// later import cannot replace a completed historical snapshot with current or
// incomplete profile data.
function persistOpponentInsightSnapshots(
  historyOwnerProfileId,
  replayId,
  snapshots,
  { notify = true } = {},
) {
  const profileId = normalizeHistoryProfileId(historyOwnerProfileId);
  const normalizedReplayId = String(replayId ?? "").trim();
  const incoming = snapshotObject(snapshots);
  if (!profileId || !normalizedReplayId || !incoming) return false;
  const store = loadMatchHistoryStore(profileId);
  const index = store.records.findIndex(
    (record) => record.replayId === normalizedReplayId,
  );
  if (index < 0) return false;
  const previous = snapshotObject(store.records[index].opponentInsightSnapshots) ?? {};
  const merged = mergeSnapshotObject(previous, incoming) ?? {};
  const changed = JSON.stringify(previous) !== JSON.stringify(merged);
  if (!changed) return false;
  store.records[index] = normalizeStoredHistoryRecord({
    ...store.records[index],
    opponentInsightSnapshots: merged,
  });
  if (!store.records[index]) return false;
  bumpHistoryRevision(profileId);
  persistMatchHistoryStore(profileId, store);
  if (notify) sendHistoryState();
  return true;
}

function loadPersistedTrackerSession() {
  const emptyTrackerState = createEmptyTrackerState();
  const emptyAchievementState = createSessionAchievementState();
  try {
    const payload = JSON.parse(fs.readFileSync(trackerSessionPath, "utf8"));
    return restoreTrackerSession(payload, emptyTrackerState, emptyAchievementState);
  } catch {
    return {
      trackerState: emptyTrackerState,
      achievementState: emptyAchievementState,
      restored: false,
    };
  }
}

function persistTrackerSession() {
  const payload = buildTrackerSessionPayload(trackerState, sessionAchievementState);
  if (privateDataClearing) return;
  const operation = payload
    ? persistedDataWriter.schedule(
        trackerSessionPath,
        `${JSON.stringify(payload, null, 2)}\n`,
      )
    : persistedDataWriter.remove(trackerSessionPath);
  operation.catch(() => {
    // A session save failure must not interrupt match monitoring.
  });
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
  const fetchSummary =
    matchHistoryFetchSummary?.profileId === normalizedProfileId
      ? matchHistoryFetchSummary
      : null;
  const persistedActIds = [...new Set(
    store.records
      .map((record) => Number(record?.actId))
      .filter((value) => Number.isInteger(value) && value >= 0),
  )].sort((left, right) => right - left);
  const verifiedCurrentAct = currentVerifiedHistoryActState(normalizedProfileId);
  const officialActOptions = isFreshOfficialActRegistry(officialActRegistryState)
    ? buildOfficialActOptions(verifiedCurrentAct.currentActId, officialActRegistryState)
    : [];
  const authenticated = Boolean(authenticatedProfileId);
  const actsById = new Map(
    [...officialActOptions, ...persistedActIds.map((id) => ({ id, label: `ACT ${id}` }))]
      .map((act) => [act.id, act]),
  );
  return {
    records: store.records,
    count: store.records.length,
    profileId: normalizedProfileId,
    // These are the official selector options, not assignments of Acts to
    // stored records. A record remains unscoped until its replay payload
    // contains explicit Act evidence.
    acts: [...actsById.values()].sort((left, right) => right.id - left.id),
    actRegistry: isFreshOfficialActRegistry(officialActRegistryState)
      ? officialActRegistryState
      : null,
    ...verifiedCurrentAct,
    characterNamesVerifiedLocales: [...historyLabelBackfillCompleted]
      .filter((key) => key.startsWith(`${normalizedProfileId}:`))
      .map((key) => key.slice(normalizedProfileId.length + 1)),
    player: historyViewPlayer ?? authenticatedPlayer ?? trackerState.player,
    viewingOther: Boolean(historyViewPlayer),
    // A restored tracker player is useful for painting the last known screen,
    // but it is not proof that the current browser session is authenticated.
    // Publishing it as authenticated lets the renderer start an import before
    // the auth check completes and can consume the one automatic attempt.
    authenticated,
    lastFetchedAt: store.lastFetchedAt || null,
    nextAllowedAt: nextAllowedAt || null,
    canFetch:
      authenticated &&
      Boolean(normalizedProfileId) &&
      !fetchProgress &&
      Date.now() >= nextAllowedAt,
    fetching: Boolean(fetchProgress),
    fetchPage: fetchProgress?.completedPages ?? fetchProgress?.page ?? 0,
    fetchCompletedPages: fetchProgress?.completedPages ?? 0,
    fetchMaxPages: fetchProgress?.maxPages ?? MATCH_HISTORY_MAX_PAGES,
    fetchedCount: fetchProgress?.fetchedCount ?? 0,
    fetchSummary,
    cooldownSeconds: Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000)),
    polling: Boolean(historyViewPlayer && historyViewPollingActive),
    pollNextAt: historyViewPlayer ? historyViewNextPollAt : null,
    pollIntervalSeconds: historyViewPlayer
      ? historyViewEffectivePollIntervalSeconds
      : null,
    pollStopReason: historyViewPlayer ? historyViewStopReason : null,
  };
}

function qaDiskHistoryCharacterNames({ profileId, locale, actId } = {}) {
  if (
    !qaDiskHistoryHarness ||
    normalizeHistoryProfileId(profileId) !== qaDiskHistoryHarness.profileId ||
    String(locale ?? "") !== serviceLocale() ||
    (actId != null && Number(actId) !== qaDiskHistoryHarness.actId)
  ) return null;
  const labels = {};
  const records = publicHistoryState(qaDiskHistoryHarness.profileId).records;
  for (const record of records) {
    const ownId = Number(record?.characterId);
    const opponentId = Number(record?.opponentCharacterId);
    const ownLabel = String(record?.ownCharacterName ?? "").trim();
    const opponentLabel = String(record?.opponentCharacterName ?? "").trim();
    if (Number.isInteger(ownId) && ownId > 0 && ownLabel && !labels[ownId]) {
      labels[ownId] = ownLabel;
    }
    if (
      Number.isInteger(opponentId) &&
      opponentId > 0 &&
      opponentLabel &&
      !labels[opponentId]
    ) labels[opponentId] = opponentLabel;
  }
  return {
    status: "ready",
    source: "qa-disk-history",
    profileId: qaDiskHistoryHarness.profileId,
    locale: serviceLocale(),
    act: qaDiskHistoryHarness.actId,
    retrievedAt: Date.now(),
    retryable: false,
    labels,
  };
}

function sendHistoryState() {
  const state = publicHistoryState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("history:state", state);
  }
}

// Import progress is intentionally a lightweight event. The renderer updates
// only the acquisition status/progress bar for these messages; the history
// list, summaries, and charts are redrawn from a full history:state message
// when the batch reaches a terminal state.
function sendHistoryFetchProgress() {
  const state = publicHistoryState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("history:progress", {
      profileId: state.profileId,
      fetching: state.fetching,
      fetchPage: state.fetchPage,
      fetchCompletedPages: state.fetchCompletedPages,
      fetchMaxPages: state.fetchMaxPages,
      fetchedCount: state.fetchedCount,
      fetchSummary: state.fetchSummary,
      authenticated: state.authenticated,
      canFetch: state.canFetch,
      lastFetchedAt: state.lastFetchedAt,
      nextAllowedAt: state.nextAllowedAt,
      cooldownSeconds: state.cooldownSeconds,
    });
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

function scheduleHistoryViewPolling(delayMs = null, { publish = true } = {}) {
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
  if (publish) sendHistoryState();
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
  let publishHistoryState = true;
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
    let refreshedPlayer = null;
    if (newReplays.length) {
      publishHistoryState = false;
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
      refreshedPlayer = await refreshProfilePlayer(playerHint, {
        force: true,
        priority: "live",
      });
      if (!historyProfileCoversLatestRecord(refreshedPlayer, [...store.records, ...replays])) {
        throw new Error("PROFILE_REFRESH_NOT_CONFIRMED");
      }
    }
    // Do not persist or notify about newly discovered rows until the official
    // profile snapshot has been refreshed and verified for the latest row.
    mergeMatchHistory(replays, profileId, { notify: false });
    const fetchedStore = loadMatchHistoryStore(profileId);
    fetchedStore.lastFetchedAt = Date.now();
    persistMatchHistoryStore(profileId, fetchedStore);
    if (refreshedPlayer) {
      historyViewPlayer = refreshedPlayer;
      historyViewLastNewMatchAt = Date.now();
      publishHistoryState = true;
    }
    historyViewConsecutiveFailures = 0;
    if (shouldAutoStopForInactivity(historyViewLastNewMatchAt)) {
      stopHistoryViewPolling("idle");
    } else {
      scheduleHistoryViewPolling();
    }
    if (publishHistoryState) sendHistoryState();
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
      invalidateAuthenticationState();
      stopHistoryViewPolling("authentication");
    } else if (historyViewConsecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stopHistoryViewPolling("network");
    } else {
      const retryAfterMs = Number(error.retryAfterMs);
      const retryDelay = Math.max(
        errorBackoffMs(historyViewConsecutiveFailures),
        Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
      );
      scheduleHistoryViewPolling(retryDelay, { publish: publishHistoryState });
    }
    if (publishHistoryState) sendHistoryState();
    sendTrackerState();
  } finally {
    historyViewPollInFlight = false;
  }
}

function historyViewTrackerState() {
  if (!historyViewPlayer) return null;
  const profileId = normalizeHistoryProfileId(historyViewPlayer.profileId);
  const records = loadMatchHistoryStore(profileId).records;
  const summaryKey = [
    historyRevision(profileId),
    Number(historyViewPlayer.characterId) || 0,
    Number(historyViewPlayer.mr) || 0,
    Number(historyViewPlayer.lp) || 0,
    String(historyViewPlayer.ratingSource ?? ""),
  ].join(":");
  const cachedSummary = historySummaryCache.get(profileId);
  const summary = cachedSummary?.key === summaryKey
    ? cachedSummary.value
    : buildHistoryRatingState(records, historyViewPlayer);
  if (cachedSummary?.key !== summaryKey) {
    historySummaryCache.set(profileId, { key: summaryKey, value: summary });
  }
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
  const series = profileId
    ? rankedHistorySeries(profileId, characterId, ratingType, sourceState?.player)
    : { records: [], rawRecords: [], values: [] };
  if (ratingType === "MR") {
    const estimate = estimatePotentialMrFromMatches(series.rawRecords ?? series.records, {
      characterId,
    });
    return {
      medianRating: estimate.value,
      medianRatingType: ratingType,
      medianRatingSampleCount: estimate.sampleCount,
    };
  }
  let values = series.values.slice(-MEDIAN_RATING_SAMPLE_LIMIT);
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
    // Preserve the public field names for renderer/OBS compatibility. LP keeps
    // its existing robust smoothing; MR is derived from opponent/result pairs.
    medianRating: potentialRatingValue(values, ratingType),
    medianRatingType: ratingType,
    medianRatingSampleCount: values.length,
  };
}

function rankedHistorySeries(profileId, characterId, ratingType, preferredPlayer = null) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId) return { records: [], rawRecords: [], values: [] };
  const normalizedCharacterId = Number(characterId) || null;
  const normalizedRatingType = ratingType === "LP" ? "LP" : "MR";
  const player = historyProfilePlayer(normalizedProfileId, preferredPlayer);
  const cacheKey = [
    historyRevision(normalizedProfileId),
    normalizedCharacterId ?? "all",
    normalizedRatingType,
    String(player?.ratingSource ?? ""),
    Number(player?.profileUpdatedAt) || 0,
    Number(player?.characterId) || 0,
    Number(normalizedRatingType === "LP" ? player?.lp : player?.mr) || 0,
  ].join(":");
  const cached = historyDerivedCache.get(normalizedProfileId);
  if (cached?.key === cacheKey) return cached.value;
  const rawRecords = loadMatchHistoryStore(normalizedProfileId).records
    .filter(
      (record) =>
        record.matchType === "ranked" &&
        (normalizedCharacterId == null || Number(record.characterId) === normalizedCharacterId),
    )
    .sort(
      (a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt),
    );
  const derived = deriveHistoryRatingSeries(
    rawRecords,
    player,
    normalizedRatingType,
    { characterId: normalizedCharacterId },
  );
  const value = {
    records: derived.records,
    rawRecords,
    values: derived.values,
  };
  historyDerivedCache.set(normalizedProfileId, { key: cacheKey, value });
  return value;
}

function publicGraphData(sourceState) {
  const profileId = normalizeHistoryProfileId(
    sourceState?.player?.profileId ?? authenticatedProfileId,
  );
  const characterId = Number(
    sourceState?.characterId ?? sourceState?.player?.characterId,
  ) || null;
  const ratingType = sourceState?.ratingType === "LP" ? "LP" : "MR";
  const localSeries = profileId
    ? rankedHistorySeries(profileId, characterId, ratingType, sourceState?.player)
    : { records: [], values: [] };
  const localRecords = localSeries.records;
  if (localRecords.length) {
    const values = localSeries.values;
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

function publicRankingState(sourceState = trackerState) {
  const player = sourceState?.player ?? authenticatedPlayer;
  const playerProfileId = String(player?.profileId ?? player?.userCode ?? "");
  const authenticatedId = String(authenticatedProfileId ?? "");
  const samePlayer =
    Boolean(authenticatedId) &&
    playerProfileId === authenticatedId &&
    String(rankingState.profileId ?? "") === authenticatedId;
  const characterId = Number(sourceState?.characterId ?? player?.characterId) || null;
  const ratingType = Number(player?.mr) > 0 ? "MR" : "LP";
  const sameCharacter = Number(rankingState.characterId) === characterId;
  const sameLocale = rankingState.locale === serviceLocale();
  const sameRatingType = rankingState.ratingType === ratingType;
  const exactRanking = samePlayer && sameCharacter && sameLocale && sameRatingType;
  // Ranking pages expose `my_ranking_info` only for the authenticated player.
  // For a different player selected in match history, use the exact current-
  // character overall rank returned by that player's freshly fetched official
  // profile. Ranking pages expose the signed-in player's entry only, so a
  // different history player can use only the exact profile-provided MR rank.
  const profileRank = Number(player?.mrRank);
  const otherProfileRanking =
    explicitOtherPlayerRankingAllowed({
      playerProfileId,
      authenticatedProfileId: authenticatedId,
      historyProfileId: historyViewPlayer?.profileId ?? historyViewPlayer?.userCode,
    }) &&
    Number(player?.mr) > 0 &&
    Number.isFinite(profileRank) &&
    profileRank > 0;
  return {
    status: exactRanking ? rankingState.status : otherProfileRanking ? "ready" : "idle",
    rank: exactRanking ? rankingState.rank : otherProfileRanking ? profileRank : null,
    rating: exactRanking ? rankingState.rating : otherProfileRanking ? player.mr : null,
    characterId,
    ratingType: exactRanking ? rankingState.ratingType : "MR",
    homeKey: "all",
    homeLabel: displaySettings.locale === "ja-jp" ? "すべて" : "All",
    updatedAt: exactRanking
      ? rankingState.updatedAt
      : otherProfileRanking
        ? player.profileUpdatedAt ?? null
        : null,
  };
}

function buildCurrentPresentation({
  sourceState,
  player,
  median,
  ranking,
  historyView = false,
}) {
  const basePresentation = buildPresentationState({
    sourceState,
    player,
    matchType: displaySettings.matchType,
    median,
    ranking,
  });
  const previousAchievements = historyView
    ? historySessionAchievementState
    : sessionAchievementState;
  const result = updateSessionAchievements(previousAchievements, {
    profileId: player?.profileId ?? player?.userCode,
    characterId: basePresentation.characterId,
    ratingType: basePresentation.ratingType,
    currentRating: basePresentation.currentRating,
    baselineRating:
      sourceState.stats?.ranked?.initialRating ?? sourceState.initialRating,
    currentRank: basePresentation.mrRank,
    rankingReady: ranking.status === "ready",
  });
  if (historyView) {
    historySessionAchievementState = result.state;
  } else {
    sessionAchievementState = result.state;
  }
  return buildPresentationState({
    sourceState,
    player,
    matchType: displaySettings.matchType,
    median,
    ranking,
    achievements: result,
  });
}

function publicTrackerState() {
  const viewState = historyViewTrackerState();
  const sourceState = viewState ?? trackerState;
  repairRatingBaseline(sourceState);
  const publicState = { ...sourceState };
  delete publicState.seenReplayIds;
  delete publicState.characterStates;
  const median = publicMedianRating(sourceState);
  const presentationPlayer = sourceState.player ?? historyViewPlayer ?? authenticatedPlayer;
  const ranking = publicRankingState(sourceState);
  return {
    ...publicState,
    ...median,
    presentation: buildCurrentPresentation({
      sourceState,
      player: presentationPlayer,
      median,
      ranking,
      historyView: Boolean(viewState),
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
  const presentation = buildCurrentPresentation({
    sourceState,
    player: presentationPlayer,
    median,
    ranking,
    historyView: Boolean(viewState),
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

function sendTrackerState({ persist = true } = {}) {
  const state = publicTrackerState();
  if (persist) persistTrackerSession();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tracker:state", state);
  }
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.webContents.send("tracker:state", state);
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
    friendOnlineNotificationSoundOptions: windowsNotificationSounds,
    initialLanguageSelectionRequired,
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
  const horizontalGraphWithMetricsMinimum =
    HORIZONTAL_GRAPH_WITH_METRICS_MINIMUM_SIZE[isOverlay ? "overlay" : "window"];
  if (isVertical) {
    // Graph-free vertical output uses the renderer's real 68px card tracks.
    // Keeping the older mode-specific preferred heights left decorative space
    // below the final card after the graph was hidden.
    const cardHeight = graphVisible ? (isOverlay ? 76 : 86) : 68;
    const cardArea = metricCount
      ? metricCount * cardHeight + Math.max(0, metricCount - 1) * 8
      : 0;
    const graphArea = graphVisible ? (isOverlay ? 184 : 230) : 0;
    const minimumCardArea = metricCount
      ? metricCount * 68 + Math.max(0, metricCount - 1) * 8
      : 0;
    const fixedGraphArea = graphVisible ? 210 : 0;
    const fixedLayoutMinimumHeight = metricCount && graphVisible
      ? minimumCardArea + fixedGraphArea + 7 + 18
      : 0;
    const contentGap = metricCount && graphVisible ? 8 : 0;
    const outerAllowance = graphVisible ? (metricCount ? 20 : 8) : 18;
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
        : Math.min(
            height,
            Math.max(
              82,
              cardArea + (graphVisible ? 130 : 0) + 12,
              fixedLayoutMinimumHeight,
            ),
          ),
      maxWidth: 600,
      maxHeight: 1100,
    };
  }

  const preferredCardWidth = isOverlay ? 118 : 142;
  // Wide fonts still need to show 10,000,000 LP and six-digit ranks in full.
  // Values shrink proportionally, but the window stops before clipping them.
  const preferredMetricWidth = metricCount
    ? metricCount * preferredCardWidth + Math.max(0, metricCount - 1) * 6 + 20
    : 0;
  const minimumMetricWidth = horizontalMetricMinimumWidth(metricCount);
  const width = Math.min(1200, Math.max(graphVisible ? 520 : 320, preferredMetricWidth));
  const minWidth = Math.min(
    1000,
    Math.max(
      horizontalGraphWithMetrics
        ? horizontalGraphWithMetricsMinimum.width
        : graphVisible
          ? 380
          : 300,
      minimumMetricWidth,
    ),
  );
  // Window and overlay share the same renderer. Use its fixed 60px compact
  // card row and 160px chart track in both native modes so toggling the chart
  // never changes the card height.
  const cardArea = metricCount ? 60 : 0;
  const graphArea = graphVisible ? 160 : 0;
  const outerAllowance = metricCount || !graphVisible ? 18 : 6;
  const height = Math.max(
    graphOnly ? graphOnlyMinimum.height : 68,
    cardArea + graphArea + (metricCount && graphVisible ? 7 : 0) + outerAllowance,
  );
  return {
    width,
    height,
    minWidth: graphOnly ? Math.max(minWidth, graphOnlyMinimum.width) : minWidth,
    minHeight: graphOnly
        ? graphOnlyMinimum.height
        : horizontalGraphWithMetrics
        ? horizontalGraphWithMetricsMinimum.height
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
  const preset = statsWindowPresetFor(displaySettings.mode);
  return {
    ...preset,
    ...compactStatsWindowInitialSize(preset),
  };
}

function applyStatsWindowSizeConstraints({ preserveCurrentSize = false } = {}) {
  if (!statsWindow || statsWindow.isDestroyed()) return;
  const preset = currentStatsWindowPreset();
  const currentBounds = preserveCurrentSize ? statsWindow.getBounds() : null;
  const constraints = statsWindowSizeConstraints(preset, currentBounds);
  statsWindow.setMinimumSize(constraints.minWidth, constraints.minHeight);
  statsWindow.setMaximumSize(constraints.maxWidth, constraints.maxHeight);
}

function resizeStatsWindowForGraphVisibility(previousPreset) {
  if (!statsWindow || statsWindow.isDestroyed()) return;
  const nextPreset = statsWindowPresetFor(displaySettings.mode);
  const nextBounds = resizeBoundsForGraphVisibility(
    statsWindow.getBounds(),
    previousPreset,
    nextPreset,
  );
  const constraints = statsWindowSizeConstraints(nextPreset, nextBounds);
  statsWindow.setMinimumSize(constraints.minWidth, constraints.minHeight);
  statsWindow.setMaximumSize(constraints.maxWidth, constraints.maxHeight);
  applyingStatsBounds = true;
  statsWindow.setBounds(nextBounds, true);
  applyingStatsBounds = false;
  rememberStatsWindowBounds();
}

function sendDisplaySettings() {
  const settings = publicDisplaySettings();
  for (const target of [mainWindow, statsWindow]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send("display:settings", settings);
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
  applyStatsWindowSizeConstraints();
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
  const wasInitialLanguageSelectionRequired = initialLanguageSelectionRequired;
  const previousMode = displaySettings.mode;
  const previousOrientation = displaySettings.windowOrientation;
  const previousDisplayItems = { ...displaySettings.displayItems };
  const previousMetricCount = visibleMetricCount(previousDisplayItems);
  const previousStatsPreset = statsWindowPresetFor(previousMode);
  const previousMatchType = displaySettings.matchType;
  const previousLocale = displaySettings.locale;
  const previousPollInterval = displaySettings.pollIntervalSeconds;
  const previousLaunchAtLogin = displaySettings.launchAtLogin;
  const previousAutoDetectGame = displaySettings.autoDetectGame;
  const previousGameExecutable = displaySettings.gameExecutableName;
  const previousFriendNotificationsEnabled =
    displaySettings.friendOnlineNotificationsEnabled;
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
      Math.max(0.3, Number(nextSettings.fontScale)),
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
  const displayItemsChanging = !displayItemsEqual(
    previousDisplayItems,
    displaySettings.displayItems,
  );
  const nextMetricCount = visibleMetricCount(displaySettings.displayItems);
  const graphVisibilityChanging =
    previousDisplayItems.graph !== displaySettings.displayItems.graph;
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
    initialLanguageSelectionRequired = false;
  }
  if (previousLocale !== displaySettings.locale) {
    invalidateVerifiedHistoryCurrentAct();
    matchHistoryFetchSummary = null;
    // The Next.js build id and data route are locale-scoped. Do not reuse a
    // build id fetched from the previous language after a locale switch.
    buildId = null;
    buildIdLocale = null;
    buildIdInFlight = null;
    clearAllRankingRetryTimers();
    rankingState = {
      ...rankingState,
      status: "idle",
      rank: null,
      rating: null,
      locale: displaySettings.locale,
      ratingType: Number((trackerState.player ?? authenticatedPlayer)?.mr) > 0 ? "MR" : "LP",
      homeLabel: "—",
      updatedAt: null,
    };
    sendTrackerState();
    if (trackerState.player || historyViewPlayer || authenticatedPlayer) {
      void refreshTrackedPlayerForLocale().then(() =>
        refreshCurrentRanking().catch(() => {}),
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
  if (typeof nextSettings.friendOnlineNotificationsEnabled === "boolean") {
    displaySettings.friendOnlineNotificationsEnabled =
      nextSettings.friendOnlineNotificationsEnabled;
  }
  if (["always", "game-only"].includes(nextSettings.friendOnlineNotificationTiming)) {
    displaySettings.friendOnlineNotificationTiming =
      nextSettings.friendOnlineNotificationTiming;
  }
  if (Object.hasOwn(nextSettings, "friendOnlineNotificationSound")) {
    displaySettings.friendOnlineNotificationSound = sanitizeWindowsNotificationSound(
      nextSettings.friendOnlineNotificationSound,
      windowsNotificationSounds,
    );
  }
  if (Number.isInteger(Number(nextSettings.friendOnlineNotificationDurationSeconds))) {
    displaySettings.friendOnlineNotificationDurationSeconds = Math.min(
      15,
      Math.max(3, Number(nextSettings.friendOnlineNotificationDurationSeconds)),
    );
  }
  if (Number.isFinite(Number(nextSettings.friendOnlineNotificationBackgroundOpacity))) {
    displaySettings.friendOnlineNotificationBackgroundOpacity = Math.min(
      1,
      Math.max(0, Number(nextSettings.friendOnlineNotificationBackgroundOpacity)),
    );
  }
  if (Number.isFinite(Number(nextSettings.friendOnlineNotificationVolume))) {
    displaySettings.friendOnlineNotificationVolume = Math.min(
      1,
      Math.max(0, Number(nextSettings.friendOnlineNotificationVolume)),
    );
  }
  const layoutModeChanging =
    previousMode !== displaySettings.mode ||
    previousOrientation !== displaySettings.windowOrientation;
  applyDisplayMode({
    resizeToPreset: layoutModeChanging,
    restoreSavedBounds: layoutModeChanging,
  });
  if (!layoutModeChanging && graphVisibilityChanging) {
    // Preserve the selected width and position, but remove or add the graph's
    // real content height so vertical layouts never retain an empty panel.
    resizeStatsWindowForGraphVisibility(previousStatsPreset);
  } else if (!layoutModeChanging && displayItemsChanging) {
    // Removing cards compacts the layout's primary axis (height when vertical,
    // width when horizontal). Adding cards expands only when the current size
    // can no longer contain the newly selected items. Position and the other
    // axis remain exactly where the user left them.
    const currentBounds = statsWindow.getBounds();
    const nextPreset = statsWindowPresetFor(displaySettings.mode);
    const resizedBounds = resizeBoundsForDisplayItemCount(
      currentBounds,
      previousStatsPreset,
      nextPreset,
      displaySettings.windowOrientation,
      { itemCountDecreased: nextMetricCount < previousMetricCount },
    );
    const constraints = statsWindowSizeConstraints(nextPreset, resizedBounds);
    statsWindow.setMinimumSize(constraints.minWidth, constraints.minHeight);
    statsWindow.setMaximumSize(constraints.maxWidth, constraints.maxHeight);
    if (
      resizedBounds.width !== currentBounds.width ||
      resizedBounds.height !== currentBounds.height
    ) {
      applyingStatsBounds = true;
      statsWindow.setBounds(resizedBounds, true);
      applyingStatsBounds = false;
    }
    rememberStatsWindowBounds();
  }
  scheduleSettingsWrite();
  sendDisplaySettings();
  if (wasInitialLanguageSelectionRequired && !initialLanguageSelectionRequired) {
    checkAuthentication()
      .then(({ player }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("auth:player", player);
        }
      })
      .catch(() => {});
    if (mainWindow?.isVisible()) scheduleSocialRefresh({ immediate: true });
  }
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
  if (
    previousFriendNotificationsEnabled !==
    displaySettings.friendOnlineNotificationsEnabled
  ) {
    resetFriendNotificationBaseline();
    if (displaySettings.friendOnlineNotificationsEnabled) {
      prewarmFriendNotificationWindow();
      scheduleSocialRefresh({ immediate: true });
    } else {
      dismissFriendNotification({ destroy: false });
      if (!mainWindow?.isVisible()) stopSocialRefresh();
    }
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
    recordSocialActivity();
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
  scheduleSocialIdleSuspend();
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
    socialPaused: japanese ? "FRIENDS取得休止中" : "FRIENDS updates paused",
    exit: japanese ? "終了" : "Exit",
  };
  return labels[key] ?? key;
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(socialSuspended
      ? [{ label: trayText("socialPaused"), enabled: false }, { type: "separator" }]
      : []),
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
  const iconPath = path.join(__dirname, "renderer", "assets", "tray-icon.ico");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip("Match Session Overlay");
  tray.on("double-click", () => showMainWindowFromTray());
  refreshTrayMenu();
}

function resetFriendNotificationBaseline(accountId = authenticatedProfileId) {
  const normalizedAccountId = String(accountId ?? "").trim();
  friendNotificationSnapshotVersion += 1;
  friendNotificationState = normalizedAccountId
    ? resetFriendOnlineNotificationAccount(
        friendNotificationState,
        normalizedAccountId,
      )
    : createFriendOnlineNotificationState();
  dismissFriendNotification({ destroy: false });
}

function friendNotificationDisplay() {
  return screen.getPrimaryDisplay();
}

function positionFriendNotification(height) {
  if (!friendNotificationWindow || friendNotificationWindow.isDestroyed()) return;
  const display = friendNotificationDisplay();
  const workArea = display.workArea;
  const width = 340;
  const margin = 20;
  friendNotificationWindow.setBounds({
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin,
    width,
    height,
  });
}

function positionFriendNotificationPreview(height) {
  if (!friendNotificationPreviewWindow || friendNotificationPreviewWindow.isDestroyed()) return;
  const display = friendNotificationDisplay();
  const workArea = display.workArea;
  const width = 340;
  const margin = 20;
  friendNotificationPreviewWindow.setBounds({
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin,
    width,
    height,
  });
}

async function notificationSoundPlaybackPath(soundPath, volume) {
  if (volume >= 1) return soundPath;
  const volumePercent = Math.round(volume * 100);
  const cacheKey = `${soundPath}\0${volumePercent}`;
  if (!notificationSoundPlaybackCache.has(cacheKey)) {
    notificationSoundPlaybackCache.set(cacheKey, (async () => {
      const cacheDirectory = path.join(sessionDataPath, "notification-sound-cache");
      const outputPath = path.join(
        cacheDirectory,
        `${volumePercent}-${path.basename(soundPath)}`,
      );
      const source = await fs.promises.readFile(soundPath);
      const adjusted = scalePcmWavVolume(source, volume);
      await fs.promises.mkdir(cacheDirectory, { recursive: true });
      await fs.promises.writeFile(outputPath, adjusted);
      return outputPath;
    })().catch((error) => {
      notificationSoundPlaybackCache.delete(cacheKey);
      throw error;
    }));
  }
  return notificationSoundPlaybackCache.get(cacheKey);
}

async function playFriendNotificationSound(soundId = displaySettings.friendOnlineNotificationSound) {
  const soundPath = resolveWindowsNotificationSound(soundId, windowsNotificationSounds);
  const volume = Math.min(1, Math.max(0, Number(displaySettings.friendOnlineNotificationVolume) || 0));
  if (!soundPath || process.platform !== "win32" || volume <= 0) return false;
  let playbackPath;
  try {
    playbackPath = await notificationSoundPlaybackPath(soundPath, volume);
  } catch {
    return false;
  }
  const powershellPath = path.join(
    process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const command = [
    "$soundPath = [Environment]::GetEnvironmentVariable('MSO_NOTIFICATION_SOUND')",
    "$player = [System.Media.SoundPlayer]::new($soundPath)",
    "$player.PlaySync()",
  ].join("; ");
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (played) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(played);
    };
    const timeout = setTimeout(() => {
      child?.kill();
      finish(false);
    }, 15_000);
    try {
      child = spawn(
        powershellPath,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command],
        {
          windowsHide: true,
          stdio: "ignore",
          env: { ...process.env, MSO_NOTIFICATION_SOUND: playbackPath },
        },
      );
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}

function createFriendNotificationWindow() {
  if (friendNotificationWindow && !friendNotificationWindow.isDestroyed()) {
    return friendNotificationWindow;
  }
  friendNotificationWindow = new BrowserWindow({
    width: 340,
    height: 72,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "friend-notification-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  friendNotificationWindow.removeMenu();
  friendNotificationWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  friendNotificationWindow.setSkipTaskbar(true);
  friendNotificationWindow.setFocusable(false);
  friendNotificationWindow.setIgnoreMouseEvents(true);
  friendNotificationWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  loadRendererFile(
    friendNotificationWindow,
    path.join(__dirname, "renderer", "friend-notification.html"),
  );
  friendNotificationWindow.on("closed", () => {
    friendNotificationWindow = null;
    friendNotificationTopmostConfigured = false;
  });
  return friendNotificationWindow;
}

function configureFriendNotificationTopmost(window) {
  if (
    friendNotificationTopmostConfigured ||
    !window ||
    window.isDestroyed()
  ) {
    return;
  }
  window.setAlwaysOnTop(true, "screen-saver");
  friendNotificationTopmostConfigured = true;
}

function prewarmFriendNotificationWindow() {
  if (!displaySettings.friendOnlineNotificationsEnabled) return null;
  const notificationWindow = createFriendNotificationWindow();
  // Creating the native window while the app is already in the foreground
  // prevents Windows from surfacing the taskbar when the first game-time
  // notification appears. It remains hidden, non-focusable, and excluded
  // from the taskbar until showInactive() is used for a real transition.
  notificationWindow.setSkipTaskbar(true);
  notificationWindow.setFocusable(false);
  notificationWindow.hide();
  return notificationWindow;
}

async function createFriendNotificationPreviewWindow() {
  if (friendNotificationPreviewWindow && !friendNotificationPreviewWindow.isDestroyed()) {
    if (friendNotificationPreviewLoadInFlight) {
      await friendNotificationPreviewLoadInFlight;
    }
    return friendNotificationPreviewWindow;
  }
  const previewWindow = new BrowserWindow({
    width: 340,
    height: 72,
    // The sample is launched only from the visible management window. Making
    // it an owned toolbar window keeps Windows from treating its first show as
    // a new top-level app surface and raising the taskbar.
    parent:
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : undefined,
    type: "toolbar",
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "friend-notification-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  friendNotificationPreviewWindow = previewWindow;
  previewWindow.removeMenu();
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  previewWindow.setSkipTaskbar(true);
  previewWindow.setFocusable(false);
  previewWindow.setAlwaysOnTop(true, "floating");
  previewWindow.setIgnoreMouseEvents(true);
  previewWindow.on("closed", () => {
    if (friendNotificationPreviewWindow === previewWindow) {
      friendNotificationPreviewWindow = null;
    }
  });
  friendNotificationPreviewLoadInFlight = loadRendererFile(
    previewWindow,
    path.join(__dirname, "renderer", "friend-notification.html"),
  );
  try {
    await friendNotificationPreviewLoadInFlight;
  } finally {
    friendNotificationPreviewLoadInFlight = null;
  }
  return previewWindow;
}

async function prewarmFriendNotificationPreviewWindow() {
  const previewWindow = await createFriendNotificationPreviewWindow();
  if (previewWindow.isDestroyed()) return null;
  previewWindow.setSkipTaskbar(true);
  previewWindow.setFocusable(false);
  previewWindow.hide();
  return previewWindow;
}

function dismissFriendNotificationPreview({ destroy = false } = {}) {
  if (!friendNotificationPreviewWindow || friendNotificationPreviewWindow.isDestroyed()) return;
  if (destroy) friendNotificationPreviewWindow.destroy();
  else friendNotificationPreviewWindow.hide();
}

async function previewFriendOnlineNotification() {
  if (friendNotificationPreviewInFlight) return friendNotificationPreviewInFlight;
  friendNotificationPreviewInFlight = (async () => {
    const previewWindow = await createFriendNotificationPreviewWindow();
    if (previewWindow.isDestroyed()) return { shown: false };
    const payload = {
      count: 1,
      names: ["SAMPLE FRIEND"],
      remainingCount: 0,
      titleKey: "friendOnline",
      locale: serviceLocale(),
      backgroundOpacity: displaySettings.friendOnlineNotificationBackgroundOpacity,
    };
    const durationMs = displaySettings.friendOnlineNotificationDurationSeconds * 1000;
    positionFriendNotificationPreview(72);
    previewWindow.webContents.send("friend-notification:payload", {
      ...payload,
      phase: "visible",
    });
    previewWindow.showInactive();
    previewWindow.setFocusable(false);
    const soundCompletion = playFriendNotificationSound();
    await wait(Math.max(0, durationMs - 180));
    if (!previewWindow.isDestroyed()) {
      previewWindow.webContents.send("friend-notification:payload", {
        ...payload,
        phase: "leaving",
      });
    }
    await wait(180);
    if (!previewWindow.isDestroyed()) previewWindow.hide();
    await soundCompletion;
    return { shown: true };
  })().finally(() => {
    friendNotificationPreviewInFlight = null;
  });
  return friendNotificationPreviewInFlight;
}

function sendFriendNotificationPayload(phase = "visible") {
  if (
    !friendNotificationBatch ||
    !friendNotificationWindow ||
    friendNotificationWindow.isDestroyed() ||
    friendNotificationWindow.webContents.isLoading()
  ) {
    return;
  }
  const view = friendOnlineNotificationView(friendNotificationBatch);
  if (view.count < 1) return;
  friendNotificationWindow.webContents.send("friend-notification:payload", {
    ...view,
    locale: serviceLocale(),
    backgroundOpacity: displaySettings.friendOnlineNotificationBackgroundOpacity,
    phase,
  });
}

function presentFriendNotification() {
  if (!friendNotificationBatch || !displaySettings.friendOnlineNotificationsEnabled) return;
  const notificationWindow = createFriendNotificationWindow();
  const view = friendOnlineNotificationView(friendNotificationBatch);
  if (view.count < 1) return;
  const show = () => {
    if (
      !friendNotificationBatch ||
      !displaySettings.friendOnlineNotificationsEnabled ||
      notificationWindow.isDestroyed()
    ) {
      return;
    }
    const latestView = friendOnlineNotificationView(friendNotificationBatch);
    positionFriendNotification(latestView.count > 1 ? 100 : 72);
    sendFriendNotificationPayload("visible");
    notificationWindow.showInactive();
    configureFriendNotificationTopmost(notificationWindow);
    void playFriendNotificationSound();
  };
  if (notificationWindow.webContents.isLoading()) {
    notificationWindow.webContents.once("did-finish-load", show);
  } else {
    show();
  }

  clearTimeout(friendNotificationLeaveTimer);
  clearTimeout(friendNotificationHideTimer);
  const remaining = Math.max(0, friendNotificationBatch.dismissAt - Date.now());
  friendNotificationLeaveTimer = setTimeout(() => {
    sendFriendNotificationPayload("leaving");
  }, Math.max(0, remaining - 180));
  friendNotificationHideTimer = setTimeout(() => {
    if (friendNotificationWindow && !friendNotificationWindow.isDestroyed()) {
      friendNotificationWindow.hide();
    }
    friendNotificationBatch = null;
    friendNotificationLeaveTimer = null;
    friendNotificationHideTimer = null;
  }, remaining);
}

function flushFriendNotificationBatch() {
  clearTimeout(friendNotificationAggregationTimer);
  friendNotificationAggregationTimer = null;
  presentFriendNotification();
}

function queueFriendOnlineNotifications(players) {
  if (!displaySettings.friendOnlineNotificationsEnabled) return;
  const now = Date.now();
  const previousBatch = friendNotificationBatch;
  friendNotificationBatch = previousBatch
    ? mergeFriendOnlineNotificationBatch(previousBatch, players, now, {
        displayMs: displaySettings.friendOnlineNotificationDurationSeconds * 1000,
      })
    : createFriendOnlineNotificationBatch(players, now, {
        displayMs: displaySettings.friendOnlineNotificationDurationSeconds * 1000,
      });
  if (!friendNotificationBatch) return;
  const replacedExpiredBatch =
    previousBatch && friendNotificationBatch.openedAt !== previousBatch.openedAt;
  if (replacedExpiredBatch) {
    // The old hide callback may be queued on the same event-loop boundary.
    // Cancel it before it can erase the newly-created batch, then give the new
    // transition its own aggregation and five-second display lifetime.
    clearTimeout(friendNotificationLeaveTimer);
    clearTimeout(friendNotificationHideTimer);
    friendNotificationLeaveTimer = null;
    friendNotificationHideTimer = null;
    if (friendNotificationWindow && !friendNotificationWindow.isDestroyed()) {
      friendNotificationWindow.hide();
    }
  }

  if (
    friendNotificationWindow &&
    !friendNotificationWindow.isDestroyed() &&
    friendNotificationWindow.isVisible()
  ) {
    const view = friendOnlineNotificationView(friendNotificationBatch);
    positionFriendNotification(view.count > 1 ? 100 : 72);
    sendFriendNotificationPayload("visible");
    return;
  }
  if (!friendNotificationAggregationTimer) {
    const delay = Math.max(0, friendNotificationBatch.collectUntil - now);
    friendNotificationAggregationTimer = setTimeout(
      flushFriendNotificationBatch,
      delay,
    );
  }
}

function dismissFriendNotification({ destroy = false } = {}) {
  clearTimeout(friendNotificationAggregationTimer);
  clearTimeout(friendNotificationLeaveTimer);
  clearTimeout(friendNotificationHideTimer);
  friendNotificationAggregationTimer = null;
  friendNotificationLeaveTimer = null;
  friendNotificationHideTimer = null;
  friendNotificationBatch = null;
  if (!friendNotificationWindow || friendNotificationWindow.isDestroyed()) return;
  if (destroy) friendNotificationWindow.destroy();
  else friendNotificationWindow.hide();
}

function createMainWindow() {
  mainWindowReadyToShow = false;
  managementUiReady = false;
  const workAreaHeight = screen.getPrimaryDisplay().workAreaSize.height;
  // Keep the five-row recent-match preview visible on first launch when the
  // work area allows it, while keeping the outer window inside that area.
  const initialHeight = mainWindowInitialHeight(workAreaHeight);
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
    if (qaDiskHistoryHarness) {
      sendHistoryState();
      return;
    }
    if (initialLanguageSelectionRequired) return;
    checkAuthentication()
      .then(({ player }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("auth:player", player);
        }
      })
      .catch(() => {});
  });
  mainWindow.once("ready-to-show", () => {
    mainWindowReadyToShow = true;
    finishStartupPresentation();
  });
  mainWindow.on("show", () => {
    recordSocialActivity({ schedule: false });
    if (initialLanguageSelectionRequired) return;
    scheduleSocialRefresh({ immediate: true });
  });
  mainWindow.on("hide", () => {
    if (displaySettings.friendOnlineNotificationsEnabled) {
      scheduleSocialRefresh();
    } else {
      stopSocialRefresh();
    }
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
    if (!displaySettings.friendOnlineNotificationsEnabled) stopSocialRefresh();
    mainWindow = null;
  });
}

function finishStartupPresentation() {
  if (backgroundMode || !mainWindowReadyToShow || !managementUiReady) return;
  const remainingSplashTime = Math.max(
    0,
    SPLASH_MINIMUM_VISIBLE_MS - (Date.now() - splashOpenedAt),
  );
  clearTimeout(splashCloseTimer);
  splashCloseTimer = setTimeout(() => {
    splashCloseTimer = null;
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    splashWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }, remainingSplashTime);
}

function createSplashWindow() {
  if (backgroundMode || splashWindow) return;
  splashOpenedAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 780,
    height: 440,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    center: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  splashWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadRendererFile(splashWindow, path.join(__dirname, "renderer", "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => {
    splashWindow = null;
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
  const workArea = screen.getPrimaryDisplay().workArea;
  const initialBounds = isUsableStatsBounds(savedBounds, preset)
    ? savedBounds
    : clampBoundsToWorkArea(
        {
          x: workArea.x + Math.round((workArea.width - preset.width) / 2),
          y: workArea.y + Math.round((workArea.height - preset.height) / 2),
          width: preset.width,
          height: preset.height,
        },
        workArea,
        8,
      );
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
      title: "ローカルデータを削除",
      message:
        "公式サイトのログイン状態、保存した対戦履歴・セッション戦績、Cookie、キャッシュをこのPCから削除します。",
      detail: "この操作は元に戻せません。",
      buttons: ["削除", "キャンセル"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }));
  } finally {
    endAppUiModal();
  }
  if (response !== 0) return { cleared: false };

  privateDataClearing = true;
  const clearedGeneration = privateDataGeneration;
  privateDataGeneration += 1;
  serviceRequestScheduler.cancel({
    generation: clearedGeneration,
    reason: "Private data was cleared.",
  });
  for (const controller of serviceAbortControllers) controller.abort();
  serviceAbortControllers.clear();
  stopTracking({ discard: true });
  stopHistoryViewPolling();
  stopSocialRefresh();
  matchHistoryFetchInFlight = null;
  matchHistoryFetchActId = null;
  matchHistoryFetchProgress = null;
  matchHistoryFetchSummary = null;
  authenticationInFlight = null;
  localeRefreshInFlight = null;
  buildIdInFlight = null;
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  try {
    await sourceSession.clearData();
    await sourceSession.clearAuthCache();
  } catch (error) {
    privateDataClearing = false;
    throw error;
  }
  await persistedDataWriter.cancelAll();
  matchHistoryStores.clear();
  matchHistoryRevisions.clear();
  historyDerivedCache.clear();
  historySummaryCache.clear();
  historyProfileLookupCache.clear();
  profileRefreshCache.clear();
  profileRefreshInFlight.clear();
  profileCharacterNameCache.clear();
  opponentProfileContextCache.clear();
  opponentProfileContextInFlight.clear();
  opponentOfficialHistoryCache.clear();
  opponentOfficialHistoryInFlight.clear();
  officialCharacterStatsCache.clear();
  officialCharacterStatsInFlight.clear();
  officialCharacterNamesCache.clear();
  officialCharacterNamesInFlight.clear();
  rankingCache.clear();
  rankingInFlight.clear();
  clearAllRankingRetryTimers();
  sessionAchievementState = createSessionAchievementState();
  historySessionAchievementState = createSessionAchievementState();
  socialRefreshInFlight.clear();
  resetFriendNotificationBaseline(authenticatedProfileId);
  resetSocialSourcePages();
  rankingState = {
    status: "idle",
    rank: null,
    rating: null,
    profileId: null,
    locale: null,
    characterId: null,
    ratingType: "MR",
    homeKey: "all",
    homeLabel: "All",
    updatedAt: null,
  };
  socialState = emptySocialState();
  historyViewPlayer = null;
  authenticatedProfileId = null;
  authenticatedPlayer = null;
  authenticatedRatingType = "MR";
  invalidateVerifiedHistoryCurrentAct();
  sendSocialState();
  try {
    fs.rmSync(matchHistoryDirectory, { recursive: true, force: true });
    fs.mkdirSync(matchHistoryDirectory, { recursive: true });
    fs.rmSync(matchHistoryPath, { force: true });
    fs.rmSync(trackerSessionPath, { force: true });
  } catch {
    // Continue clearing the authenticated browser session even if the local
    // history file is temporarily locked by another process.
  }
  sendHistoryState();
  buildId = null;
  buildIdLocale = null;
  privateDataClearing = false;
  sendTrackerState();
  sendDisplaySettings();
  return { cleared: true };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertPrivateDataGeneration(generation) {
  if (privateDataClearing || generation !== privateDataGeneration) {
    throw new Error("PRIVATE_DATA_CLEARED");
  }
}

function serviceRateLimitError(retryAfterHeader = null) {
  const retryAfterMs = retryAfterHeader == null
    ? Math.max(0, serviceRetryBlockedUntil - Date.now())
    : retryAfterMilliseconds(
        retryAfterHeader,
        Date.now(),
        MAX_SERVICE_RETRY_DELAY_MS,
      );
  if (retryAfterMs > 0) {
    serviceRetryBlockedUntil = Math.max(
      serviceRetryBlockedUntil,
      Date.now() + retryAfterMs,
    );
  }
  const error = new Error("SERVICE_RATE_LIMITED");
  error.retryAfterMs = Math.max(0, serviceRetryBlockedUntil - Date.now());
  return error;
}

function fetchServiceWithRateLimit(
  url,
  options,
  { scope = null, priority = "interactive" } = {},
) {
  const generation = privateDataGeneration;
  return serviceRequestScheduler.enqueue(
    async () => {
      assertUpdateAllowed(updateRequired);
      if (scope === "social" && socialSuspended) {
        throw new Error("SOCIAL_REFRESH_SUSPENDED");
      }
      assertPrivateDataGeneration(generation);
      if (Date.now() < serviceRetryBlockedUntil) {
        throw serviceRateLimitError();
      }
      const controller = new AbortController();
      serviceAbortControllers.add(controller);
      if (scope === "social") socialServiceAbortControllers.add(controller);
      const timeout = setTimeout(
        () => controller.abort(),
        SERVICE_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await sourceSession.fetch(url, {
          ...options,
          signal: controller.signal,
        });
        assertUpdateAllowed(updateRequired);
        assertPrivateDataGeneration(generation);
        return response;
      } finally {
        clearTimeout(timeout);
        serviceAbortControllers.delete(controller);
        socialServiceAbortControllers.delete(controller);
      }
    },
    {
      priority,
      scope,
      generation,
      allowConcurrent: scope === "history",
      startGapMs: scope === "history" ? MATCH_HISTORY_START_GAP_MS : undefined,
    },
  );
}

async function loadBuildId(
  force = false,
  requestScope = null,
  requestPriority = "interactive",
  localeOverride = null,
) {
  const generation = privateDataGeneration;
  const requestedLocale = LOCALE_KEYS.has(String(localeOverride))
    ? String(localeOverride)
    : serviceLocale();
  if (buildId && buildIdLocale === requestedLocale && !force) return buildId;
  if (buildIdInFlight?.locale === requestedLocale) return buildIdInFlight.promise;
  const request = (async () => {
    const response = await fetchServiceWithRateLimit(
      buildServiceHomeUrl(SERVICE_ORIGIN, requestedLocale),
      {
        credentials: "include",
        redirect: "follow",
        headers: { Accept: "text/html" },
      },
      { scope: requestScope, priority: requestPriority },
    );
    if (!response.ok) {
      if (response.status === 429) {
        throw serviceRateLimitError(response.headers.get("retry-after"));
      }
      throw new Error(`SERVICE_HTTP_${response.status}`);
    }
    const html = await response.text();
    assertPrivateDataGeneration(generation);
    const nextBuildId = parseBuildId(html);
    if (serviceLocale() === requestedLocale) {
      buildId = nextBuildId;
      buildIdLocale = requestedLocale;
    }
    return nextBuildId;
  })();
  const inFlight = { locale: requestedLocale, promise: request };
  buildIdInFlight = inFlight;
  try {
    return await request;
  } finally {
    if (buildIdInFlight === inFlight) buildIdInFlight = null;
  }
}

async function fetchServiceJson(
  relativePath,
  query = {},
  retry = true,
  requestScope = null,
  requestPriority = "interactive",
  localeOverride = null,
  productionReceipt = null,
  productionStage = "service-json",
) {
  const requestedLocale = LOCALE_KEYS.has(String(localeOverride))
    ? String(localeOverride)
    : serviceLocale();
  const currentBuildId = await loadBuildId(
    false,
    requestScope,
    requestPriority,
    requestedLocale,
  );
  if (requestScope === "social" && socialSuspended) {
    throw new Error("SOCIAL_REFRESH_SUSPENDED");
  }
  const url = buildServiceDataUrl(
    SERVICE_ORIGIN,
    currentBuildId,
    requestedLocale,
    relativePath,
    query,
  );

  const response = await fetchServiceWithRateLimit(
    url,
    {
      credentials: "include",
      redirect: "follow",
      headers: { Accept: "application/json" },
    },
    { scope: requestScope, priority: requestPriority },
  );
  recordProductionReceipt(productionReceipt, `${productionStage}.response`, {
    ...classifyHttpResponse(response, { expectedContentType: "json" }),
  });

  if (response.status === 429) {
    throw serviceRateLimitError(response.headers.get("retry-after"));
  }

  if (response.status === 404 && retry) {
    if (buildId === currentBuildId) {
      await loadBuildId(true, requestScope, requestPriority, requestedLocale);
    }
    return fetchServiceJson(
      relativePath,
      query,
      false,
      requestScope,
      requestPriority,
      requestedLocale,
      productionReceipt,
      productionStage,
    );
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
  try {
    const payload = await response.json();
    recordProductionReceipt(productionReceipt, `${productionStage}.json`, {
      status: "ok",
      responseShape: classifyPayloadShape(payload),
    });
    return payload;
  } catch (error) {
    recordProductionReceipt(productionReceipt, `${productionStage}.json`, {
      status: "unavailable",
      reason: "JSON_PARSE_FAILED",
    });
    throw error;
  }
}

function openSocialProfile(profileId) {
  const normalized = normalizeHistoryProfileId(profileId);
  if (!normalized) throw new Error("INVALID_USER_CODE");
  openLoginWindow(`${serviceHome()}/profile/${encodeURIComponent(normalized)}`);
  return { opened: true };
}

function clearRankingRetryTimer(cacheKey) {
  rankingRetryController.clear(cacheKey);
}

function clearAllRankingRetryTimers() {
  rankingRetryController.clearAll();
}

function scheduleRankingPropagationRetry({
  cacheKey,
  retryDelayMs,
  retryAttempt,
  player,
  characterId,
  profileId,
  locale,
  ratingType,
}) {
  rankingRetryController.schedule(cacheKey, retryDelayMs, () => {
    const currentPlayer = trackerState.player ?? authenticatedPlayer;
    const currentProfileId = String(
      currentPlayer?.profileId ?? currentPlayer?.userCode ?? "",
    ).trim();
    if (!rankingRetryScopeMatches(
      { profileId, characterId, locale, ratingType },
      {
        authenticatedProfileId,
        playerProfileId: currentProfileId,
        characterId: currentPlayer?.characterId,
        locale: serviceLocale(),
        ratingType: Number(currentPlayer?.mr) > 0 ? "MR" : "LP",
      },
    )) {
      return;
    }
    void refreshCurrentRanking({
      player,
      characterId,
      retryAttempt: retryAttempt + 1,
      retryGeneration: rankingRetryController.generation(),
    }).catch(() => {});
  });
}

function setRankingUnavailable(player, characterId, status = "idle") {
  const ratingType = Number(player?.mr) > 0 ? "MR" : "LP";
  rankingState = {
    status,
    rank: null,
    rating: null,
    profileId: String(player?.profileId ?? player?.userCode ?? ""),
    locale: serviceLocale(),
    characterId: Number(characterId) || null,
    ratingType,
    homeKey: "all",
    homeLabel: displaySettings.locale === "ja-jp" ? "すべて" : "All",
    updatedAt: Date.now(),
  };
  sendTrackerState();
  return publicRankingState();
}

async function refreshCurrentRanking({
  player = trackerState.player ?? authenticatedPlayer,
  characterId = trackerState.characterId ?? player?.characterId,
  retryAttempt = 0,
  retryGeneration = rankingRetryController.generation(),
} = {}) {
  const profileId = String(player?.profileId ?? player?.userCode ?? "").trim();
  const expectedCharacterId = Number(characterId) || null;
  const ratingType = Number(player?.mr) > 0
    ? "MR"
    : Number(player?.lp) > 0
      ? "LP"
      : null;
  if (!profileId || !expectedCharacterId || !ratingType) {
    return setRankingUnavailable(player, expectedCharacterId);
  }

  const locale = serviceLocale();
  const characterSlug = rankingCharacterSlug(player, expectedCharacterId);
  if (!characterSlug) return setRankingUnavailable(player, expectedCharacterId, "error");
  const cacheKey = rankingCacheKey({
    locale,
    profileId,
    characterId: expectedCharacterId,
    characterSlug,
    ratingType,
    act: 1,
  });
  if (retryAttempt === 0) clearRankingRetryTimer(cacheKey);
  if (rankingInFlight.has(cacheKey)) return rankingInFlight.get(cacheKey);

  const previous = rankingCache.get(cacheKey) ?? null;
  rankingState = {
    status: "loading",
    rank: previous?.rank ?? null,
    rating: previous?.rating ?? null,
    profileId,
    locale,
    characterId: expectedCharacterId,
    ratingType,
    homeKey: "all",
    homeLabel: locale === "ja-jp" ? "すべて" : "All",
    updatedAt: previous?.updatedAt ?? null,
  };
  sendTrackerState();

  const request = (async () => {
    try {
      if (locale !== serviceLocale()) return publicRankingState();
      const endpoint = ratingType === "LP"
        ? "ranking/league.json"
        : "ranking/master.json";
      const data = await fetchServiceJson(
        endpoint,
        rankingRequestQuery({ characterSlug }),
        true,
        null,
        "ranking",
      );
      const normalized = (ratingType === "LP"
        ? normalizeLeagueRanking
        : normalizeMasterRanking)(data, {
        profileId,
        characterSlug,
      });
      if (!rankingRetryController.isCurrent(retryGeneration)) {
        return publicRankingState();
      }
      if (String(authenticatedProfileId ?? "") !== profileId) {
        return publicRankingState();
      }
      const now = Date.now();
      const outcome = resolveRankingFetchResult({
        normalized,
        previous,
        retryAttempt,
        now,
      });
      if (outcome.cacheValue) rankingCache.set(cacheKey, outcome.cacheValue);
      if (outcome.retryDelayMs != null) {
        scheduleRankingPropagationRetry({
          cacheKey,
          retryDelayMs: outcome.retryDelayMs,
          retryAttempt,
          player,
          characterId: expectedCharacterId,
          profileId,
          locale,
          ratingType,
        });
      } else {
        clearRankingRetryTimer(cacheKey);
      }
      const visible = outcome.cacheValue;
      if (
        locale === serviceLocale() &&
        (Number((trackerState.player ?? authenticatedPlayer)?.mr) > 0 ? "MR" : "LP") === ratingType &&
        String(authenticatedProfileId ?? "") === profileId
      ) {
        rankingState = {
          status: outcome.status,
          rank: visible?.rank ?? null,
          rating: visible?.rating ?? null,
          profileId,
          locale,
          characterId: expectedCharacterId,
          ratingType,
          homeKey: "all",
          homeLabel: locale === "ja-jp" ? "すべて" : "All",
          updatedAt: now,
        };
        sendTrackerState();
      }
      return publicRankingState();
    } catch {
      if (!rankingRetryController.isCurrent(retryGeneration)) {
        return publicRankingState();
      }
      const fallback = rankingCache.get(cacheKey) ?? null;
      if (
        locale === serviceLocale() &&
        (Number((trackerState.player ?? authenticatedPlayer)?.mr) > 0 ? "MR" : "LP") === ratingType &&
        String(authenticatedProfileId ?? "") === profileId
      ) {
        rankingState = {
          status: "error",
          rank: fallback?.rank ?? null,
          rating: fallback?.rating ?? null,
          profileId,
          locale,
          characterId: expectedCharacterId,
          ratingType,
          homeKey: "all",
          homeLabel: locale === "ja-jp" ? "すべて" : "All",
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
    monitoring: {
      suspended: socialSuspended,
      reason: socialSuspendReason,
      lastActivityAt: socialLastActivityAt,
      refreshAvailableAt: { ...socialManualRefreshAvailableAt },
    },
  };
}

function sendSocialState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("social:state", publicSocialState());
  }
}

function invalidateAuthenticationState() {
  invalidateVerifiedHistoryCurrentAct();
  clearAllRankingRetryTimers();
  resetFriendNotificationBaseline(authenticatedProfileId);
  authenticatedProfileId = null;
  authenticatedPlayer = null;
  authenticatedRatingType = "MR";
  stopSocialRefresh();
  socialRefreshInFlight.clear();
  resetSocialSourcePages();
  socialState = emptySocialState();
  sendSocialState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:player", null);
  }
}

function cacheSocialSourcePage(kind, normalized) {
  const sourcePage = Math.max(1, Math.trunc(Number(normalized?.page) || 1));
  const players = Array.isArray(normalized?.players) ? normalized.players : [];
  // A fresh official page can move players across page boundaries as their
  // activity changes. Keep only that fresh source page so another app page is
  // fetched again instead of showing a stale duplicate.
  socialSourcePages[kind].clear();
  socialSourcePages[kind].set(sourcePage, { ...normalized, players: [...players] });
  const meta = socialSourceMeta[kind];
  meta.pageSize = Math.max(SOCIAL_PAGE_SIZE, meta.pageSize, players.length);
  meta.totalPages = Math.max(sourcePage, Number(normalized?.totalPages) || sourcePage);
}

function replaceSocialSourcePages(kind, pages) {
  const normalizedPages = Array.isArray(pages) ? pages : [];
  const next = new Map();
  let pageSize = SOCIAL_PAGE_SIZE;
  let totalPages = 1;
  for (const normalized of normalizedPages) {
    const sourcePage = Math.max(1, Math.trunc(Number(normalized?.page) || 1));
    const players = Array.isArray(normalized?.players) ? normalized.players : [];
    next.set(sourcePage, { ...normalized, players: [...players] });
    pageSize = Math.max(pageSize, players.length);
    totalPages = Math.max(totalPages, Number(normalized?.totalPages) || sourcePage);
  }
  socialSourcePages[kind].clear();
  for (const [page, normalized] of next) {
    socialSourcePages[kind].set(page, normalized);
  }
  socialSourceMeta[kind] = { pageSize, totalPages };
}

function socialPageLocation(kind, appPage) {
  const meta = socialSourceMeta[kind];
  return socialSourcePagePlan({
    appPage,
    sourcePageSize: meta.pageSize,
    sourceTotalPages: meta.totalPages,
    displayPageSize: SOCIAL_PAGE_SIZE,
  });
}

function buildSocialAppPage(kind, appPage, status = "ready") {
  const meta = socialSourceMeta[kind];
  const lastSourcePage = socialSourcePages[kind].get(meta.totalPages);
  const location = socialSourcePagePlan({
    appPage,
    sourcePageSize: meta.pageSize,
    sourceTotalPages: meta.totalPages,
    lastSourceCount: lastSourcePage?.players.length ?? null,
    displayPageSize: SOCIAL_PAGE_SIZE,
  });
  const source = socialSourcePages[kind].get(location.sourcePage);
  const sourceChunkPage = Math.floor(location.sourceOffset / SOCIAL_PAGE_SIZE) + 1;
  const localPage = paginateSocialPlayers(
    source?.players ?? [],
    sourceChunkPage,
    SOCIAL_PAGE_SIZE,
  );
  const players = localPage.players;
  return {
    kind,
    status,
    page: location.appPage,
    totalPages: location.totalPages,
    pageSize: players.length,
    players,
  };
}

async function refreshSocialKind(kind, page = socialState[kind]?.page ?? 1) {
  if (!["friends", "following"].includes(kind)) throw new Error("SOCIAL_KIND_INVALID");
  if (kind === "friends" && displaySettings.friendOnlineNotificationsEnabled) {
    return refreshAllFriendsForNotifications(page);
  }
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1));
  const location = socialPageLocation(kind, requestedPage);
  const profileIdAtRequest = String(authenticatedProfileId ?? "");
  const monitoringGeneration = socialMonitoringGeneration;
  const generation = privateDataGeneration;
  const requestKey = `${profileIdAtRequest}:${kind}:${location.sourcePage}:${serviceLocale()}`;
  if (socialRefreshInFlight.has(requestKey)) return socialRefreshInFlight.get(requestKey);
  const previous = socialState[kind];
  socialState[kind] = { ...previous, status: "loading" };
  sendSocialState();
  const request = (async () => {
    try {
      const relativePath = kind === "following"
        ? "fighterslist/follow.json"
        : "fighterslist/friend.json";
      const data = await fetchServiceJson(relativePath, {
        page: location.sourcePage,
        order_type: "last_play",
        order_order: 0,
      }, true, "social", "social");
      if (monitoringGeneration !== socialMonitoringGeneration) {
        throw new Error("SOCIAL_REFRESH_SUSPENDED");
      }
      assertPrivateDataGeneration(generation);
      if (String(authenticatedProfileId ?? "") !== profileIdAtRequest) {
        return publicSocialState();
      }
      const normalized = normalizeSocialPage(data, kind, location.sourcePage);
      cacheSocialSourcePage(kind, normalized);
      socialState[kind] = buildSocialAppPage(kind, requestedPage);
      socialState.updatedAt = Date.now();
    } catch (error) {
      if (
        generation === privateDataGeneration &&
        monitoringGeneration === socialMonitoringGeneration &&
        String(authenticatedProfileId ?? "") === profileIdAtRequest
      ) {
        socialState[kind] = error?.message === "SOCIAL_REFRESH_SUSPENDED"
          ? previous
          : { ...previous, status: "error" };
      }
      throw error;
    } finally {
      sendSocialState();
    }
    return publicSocialState();
  })().finally(() => {
    if (socialRefreshInFlight.get(requestKey) === request) {
      socialRefreshInFlight.delete(requestKey);
    }
  });
  socialRefreshInFlight.set(requestKey, request);
  return request;
}

async function isGameRunningForFriendNotification() {
  if (displaySettings.friendOnlineNotificationTiming === "always") return true;
  try {
    return await isConfiguredGameRunning();
  } catch {
    // A transient tasklist failure must not consume an otherwise valid
    // transition as "game stopped". Reuse the existing detector's last
    // confirmed state when that detector is active.
    return isGameDetectionEnabled() ? gameWasRunning : false;
  }
}

async function refreshAllFriendsForNotifications(
  page = socialState.friends.page,
  { seedPage = null } = {},
) {
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1));
  const profileIdAtRequest = String(authenticatedProfileId ?? "");
  if (!profileIdAtRequest) throw new Error("SERVICE_AUTH_REQUIRED");
  const generation = privateDataGeneration;
  const monitoringGeneration = socialMonitoringGeneration;
  const accountEpoch = getFriendNotificationAccountEpoch(
    friendNotificationState,
    profileIdAtRequest,
  );
  const snapshotVersion = ++friendNotificationSnapshotVersion;
  const requestKey = `${profileIdAtRequest}:friends:all:${serviceLocale()}`;
  if (socialRefreshInFlight.has(requestKey)) return socialRefreshInFlight.get(requestKey);
  const previous = socialState.friends;
  socialState.friends = { ...previous, status: "loading" };
  sendSocialState();

  const request = (async () => {
    try {
      const snapshot = await fetchCompleteFriendSnapshot({
        seedPage,
        fetchPage: async (sourcePage) => {
          if (monitoringGeneration !== socialMonitoringGeneration) {
            throw new Error("SOCIAL_REFRESH_SUSPENDED");
          }
          const data = await fetchServiceJson("fighterslist/friend.json", {
            page: sourcePage,
            order_type: "last_play",
            order_order: 0,
          }, true, "social", "social");
          if (monitoringGeneration !== socialMonitoringGeneration) {
            throw new Error("SOCIAL_REFRESH_SUSPENDED");
          }
          assertPrivateDataGeneration(generation);
          if (String(authenticatedProfileId ?? "") !== profileIdAtRequest) {
            throw new Error("PRIVATE_DATA_CLEARED");
          }
          return data;
        },
        normalizePage: (data, sourcePage) =>
          normalizeSocialPage(data, "friends", sourcePage),
      });
      const { pages, friends } = snapshot;
      const gameRunning = await isGameRunningForFriendNotification();
      if (monitoringGeneration !== socialMonitoringGeneration) {
        throw new Error("SOCIAL_REFRESH_SUSPENDED");
      }
      assertPrivateDataGeneration(generation);
      if (String(authenticatedProfileId ?? "") !== profileIdAtRequest) {
        return publicSocialState();
      }
      const transition = applyFriendOnlineSnapshot(friendNotificationState, {
        accountId: profileIdAtRequest,
        accountEpoch,
        snapshotVersion,
        friends,
        complete: true,
        succeeded: true,
        notificationsEnabled: displaySettings.friendOnlineNotificationsEnabled,
        gameRunning,
        gameRunningOnly:
          displaySettings.friendOnlineNotificationTiming === "game-only",
      });
      friendNotificationState = transition.state;
      if (transition.notificationPlayers.length) {
        queueFriendOnlineNotifications(transition.notificationPlayers);
      }
      replaceSocialSourcePages("friends", pages);
      socialState.friends = buildSocialAppPage("friends", requestedPage);
      socialState.updatedAt = Date.now();
    } catch (error) {
      if (
        generation === privateDataGeneration &&
        monitoringGeneration === socialMonitoringGeneration &&
        String(authenticatedProfileId ?? "") === profileIdAtRequest
      ) {
        socialState.friends = error?.message === "SOCIAL_REFRESH_SUSPENDED"
          ? previous
          : { ...previous, status: "error" };
      }
      throw error;
    } finally {
      sendSocialState();
    }
    return publicSocialState();
  })().finally(() => {
    if (socialRefreshInFlight.get(requestKey) === request) {
      socialRefreshInFlight.delete(requestKey);
    }
  });
  socialRefreshInFlight.set(requestKey, request);
  return request;
}

async function changeSocialPage(kind, page) {
  if (!["friends", "following"].includes(kind)) throw new Error("SOCIAL_KIND_INVALID");
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1));
  const location = socialPageLocation(kind, requestedPage);
  if (!socialSourcePages[kind].has(location.sourcePage)) {
    return refreshSocialKind(kind, requestedPage);
  }
  socialState[kind] = buildSocialAppPage(kind, requestedPage);
  sendSocialState();
  return publicSocialState();
}

async function refreshSocialLists() {
  const tasks = [refreshSocialKind("friends", socialState.friends.page)];
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    tasks.push(refreshSocialKind("following", socialState.following.page));
  }
  const results = await Promise.allSettled(tasks);
  if (results[0]?.status === "rejected") {
    throw results[0].reason;
  }
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].reason;
  }
  return publicSocialState();
}

function stopSocialRefresh() {
  clearTimeout(socialRefreshTimer);
  socialRefreshTimer = null;
}

function stopSocialIdleSuspendTimer() {
  clearTimeout(socialIdleSuspendTimer);
  socialIdleSuspendTimer = null;
}

function socialRefreshShouldRun() {
  return (
    !updateRequired &&
    (
      (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) ||
      displaySettings.friendOnlineNotificationsEnabled
    )
  );
}

function suspendSocialRefresh(reason = "idle") {
  stopSocialRefresh();
  stopSocialIdleSuspendTimer();
  if (socialSuspended && socialSuspendReason === reason) return;
  socialSuspended = true;
  socialSuspendReason = reason;
  socialMonitoringGeneration += 1;
  serviceRequestScheduler.cancelScope("social", {
    reason: "Social refresh was suspended.",
  });
  for (const controller of socialServiceAbortControllers) controller.abort();
  socialServiceAbortControllers.clear();
  socialRefreshInFlight.clear();
  resetFriendNotificationBaseline();
  refreshTrayMenu();
  sendSocialState();
}

function scheduleSocialIdleSuspend() {
  stopSocialIdleSuspendTimer();
  if (socialSuspended || trackerState.active || gameWasRunning) return;
  const remaining = Math.max(
    0,
    socialLastActivityAt + SOCIAL_IDLE_SUSPEND_MS - Date.now(),
  );
  socialIdleSuspendTimer = setTimeout(() => {
    socialIdleSuspendTimer = null;
    if (shouldSuspendSocialRefresh({
      lastActivityAt: socialLastActivityAt,
      trackingActive: trackerState.active,
      gameRunning: gameWasRunning,
    })) {
      suspendSocialRefresh("idle");
    } else {
      scheduleSocialIdleSuspend();
    }
  }, remaining);
}

function recordSocialActivity({ schedule = true } = {}) {
  const wasSuspended = socialSuspended;
  socialLastActivityAt = Date.now();
  socialSuspended = false;
  socialSuspendReason = null;
  if (wasSuspended) resetFriendNotificationBaseline();
  refreshTrayMenu();
  scheduleSocialIdleSuspend();
  sendSocialState();
  if (schedule && wasSuspended) scheduleSocialRefresh({ immediate: true });
  return publicSocialState();
}

async function manualRefreshSocial(kind) {
  if (!['friends', 'following'].includes(kind)) throw new Error("SOCIAL_KIND_INVALID");
  const now = Date.now();
  recordSocialActivity({ schedule: false });
  if (!manualSocialRefreshAllowed(socialManualRefreshAvailableAt[kind], now)) {
    return publicSocialState();
  }
  socialManualRefreshAvailableAt[kind] = now + SOCIAL_MANUAL_COOLDOWN_MS;
  stopSocialRefresh();
  sendSocialState();
  try {
    const result = await refreshSocialKind(kind, socialState[kind]?.page);
    socialRefreshConsecutiveFailures = 0;
    return result;
  } catch (error) {
    socialRefreshConsecutiveFailures += 1;
    throw error;
  } finally {
    scheduleSocialRefresh();
  }
}

function scheduleSocialRefresh({ immediate = false } = {}) {
  stopSocialRefresh();
  scheduleSocialIdleSuspend();
  if (!socialRefreshShouldRun() || socialSuspended) return;
  const run = async () => {
    socialRefreshTimer = null;
    if (!socialRefreshShouldRun() || socialSuspended) return;
    if (shouldSuspendSocialRefresh({
      lastActivityAt: socialLastActivityAt,
      trackingActive: trackerState.active,
      gameRunning: gameWasRunning,
    })) {
      suspendSocialRefresh("idle");
      return;
    }
    if (authenticatedProfileId) {
      try {
        await refreshSocialLists();
        socialRefreshConsecutiveFailures = 0;
      } catch {
        socialRefreshConsecutiveFailures += 1;
      }
    }
    if (socialRefreshShouldRun() && !socialSuspended) {
      scheduleSocialRefresh();
    }
  };
  const delay = socialRefreshDelayMs({
    immediate,
    lastSuccessfulAt: socialState.updatedAt,
    consecutiveFailures: socialRefreshConsecutiveFailures,
    jitterMs: Math.floor(Math.random() * (SOCIAL_REFRESH_JITTER_MAX_MS + 1)),
  });
  socialRefreshTimer = setTimeout(run, delay);
}

async function checkAuthenticationInternal(generation) {
  const data = await fetchServiceJson("fighterslist/friend.json", {
    page: 1,
    order_type: "last_play",
    order_order: 0,
  }, true, null, "auth");
  assertPrivateDataGeneration(generation);
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
    player = await searchPlayer(userCode, { priority: "auth" });
    assertPrivateDataGeneration(generation);
  } catch (error) {
    if (error.message === "PLAYER_NOT_FOUND") {
      throw new Error("SERVICE_SELF_NOT_FOUND");
    }
    throw error;
  }
  player = await refreshProfilePlayer(player, { priority: "auth" });
  assertPrivateDataGeneration(generation);
  return { authenticated: true, player, friendPage: normalizeSocialPage(data, "friends") };
}

async function checkAuthentication() {
  ensureUpdateAllowed();
  if (authenticationInFlight) return authenticationInFlight;
  const generation = privateDataGeneration;
  const request = checkAuthenticationInternal(generation);
  authenticationInFlight = request;
  try {
    const result = await request;
    assertPrivateDataGeneration(generation);
    const player = result?.player;
    const nextProfileId = player?.profileId ?? player?.userCode ?? null;
    if (String(authenticatedProfileId ?? "") !== String(nextProfileId ?? "")) {
      resetFriendNotificationBaseline(authenticatedProfileId);
      resetSocialSourcePages();
      socialState = emptySocialState();
    }
    authenticatedPlayer = player ?? null;
    authenticatedProfileId = nextProfileId;
    authenticatedRatingType =
      player?.mr != null ? "MR" : player?.lp != null ? "LP" : "MR";
    if (result.friendPage) {
      cacheSocialSourcePage("friends", result.friendPage);
      socialState.friends = buildSocialAppPage("friends", 1);
      socialState.updatedAt = Date.now();
      sendSocialState();
    }
    if (!trackerState.active) {
      trackerState.ratingType = authenticatedRatingType;
      trackerState.status = "停止中";
      trackerState.updatedAt = Date.now();
      sendTrackerState();
    }
    // Resolve the latest Act as part of the authenticated-profile readiness
    // transition. The renderer may have restored a profile before this check
    // completes, so the Act proof must not depend on the history panel being
    // open or on a later manual refresh.
    sendHistoryState();
    const postAuthenticationTasks = [
      refreshCurrentRanking({ player, characterId: player?.characterId }),
      fetchOfficialCharacterNameRegistry({
        profileId: player?.profileId ?? player?.userCode,
        requestedLocale: serviceLocale(),
        generation,
      }),
    ];
    if (displaySettings.friendOnlineNotificationsEnabled) {
      postAuthenticationTasks.push(
        refreshAllFriendsForNotifications(1, { seedPage: result.friendPage }),
      );
    }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      postAuthenticationTasks.push(refreshSocialKind("following", 1));
    }
    await Promise.allSettled(postAuthenticationTasks);
    if (displaySettings.friendOnlineNotificationsEnabled) {
      scheduleSocialRefresh();
    }
    return result;
  } catch (error) {
    if (["SERVICE_AUTH_REQUIRED", "SERVICE_SELF_NOT_FOUND"].includes(error?.message)) {
      invalidateAuthenticationState();
    }
    throw error;
  } finally {
    if (authenticationInFlight === request) authenticationInFlight = null;
  }
}

async function searchPlayer(userCode, { priority = "interactive" } = {}) {
  const normalizedCode = String(userCode ?? "").replace(/\s/g, "");
  if (!/^\d{4,12}$/.test(normalizedCode)) {
    throw new Error("INVALID_USER_CODE");
  }

  const data = await fetchServiceJson("fighterslist/search/result.json", {
    short_id: normalizedCode,
    page: 1,
    order_type: "last_play",
    order_order: 0,
  }, true, null, priority);
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

async function refreshProfilePlayer(
  player,
  { force = false, priority = "interactive" } = {},
) {
  const generation = privateDataGeneration;
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
        {},
        true,
        null,
        priority,
      );
      assertPrivateDataGeneration(generation);
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
    } catch (error) {
      if (error?.message === "PRIVATE_DATA_CLEARED") throw error;
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

function emptyOpponentOfficialInsight() {
  const emptyRating = () => ({
    values: [],
    potential: null,
    currentValue: null,
    currentApplied: false,
  });
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ratings: { MR: emptyRating(), LP: emptyRating() },
  };
}

function sanitizeHistoryActSelector(value) {
  const raw = String(value ?? "latest").trim();
  if (raw === "latest") return raw;
  return /^\d+$/.test(raw) && Number(raw) >= 0 ? raw : "invalid";
}

function historyScopeDiagnostics({
  currentActState = {},
  selectorRaw = "latest",
  resolvedActId = null,
  ipcActId = null,
  requestActId = null,
  ownerHistory = null,
  opponentHistory = null,
  finalScopeReason = null,
  productionReceipt = null,
} = {}) {
  const summarize = (history) => {
    const pages = history && typeof history.pages === "object" ? history.pages : {};
    const pageValues = Object.values(pages);
    return {
      complete: history?.complete === true,
      totalPages: Number.isInteger(Number(history?.totalPages)) && Number(history.totalPages) > 0
        ? Number(history.totalPages)
        : null,
      fetchedPages: pageValues.length,
      replayListPages: pageValues.filter((page) => page?.hasReplayList === true).length,
      recordCount: Array.isArray(history?.records) ? history.records.length : 0,
      reason: history?.complete === true ? null : "HISTORY_SCOPE_INCOMPLETE",
    };
  };
  return {
    currentAct: buildHistoryActDiagnostic(currentActState),
    selector: {
      raw: sanitizeHistoryActSelector(selectorRaw),
      resolvedAct: normalizeHistoryActId(resolvedActId),
    },
    ipcAct: normalizeHistoryActId(ipcActId),
    requestAct: normalizeHistoryActId(requestActId),
    owner: summarize(ownerHistory),
    opponent: summarize(opponentHistory),
    finalScopeReason: finalScopeReason ?? null,
    productionReceipt,
  };
}

function emptyOpponentProfileContext({
  profileId = null,
  characterId = null,
  characterDisplayName = "",
  actId = null,
  actLabel = null,
  status = "empty",
  retrievedAt = null,
  reason = null,
  roundTrend = null,
  playComparison = null,
  diagnostics = null,
} = {}) {
  return {
    status,
    ...(reason ? { reason } : {}),
    profileId: profileId == null ? null : String(profileId),
    retrievedAt: Number.isFinite(Number(retrievedAt)) ? Number(retrievedAt) : null,
    act: Number.isInteger(Number(actId)) && Number(actId) >= 0
      ? { id: String(Number(actId)), label: String(actLabel ?? `ACT ${Number(actId)}`) }
      : null,
    targetCharacter: {
      characterId: Number(characterId) > 0 ? Number(characterId) : null,
      characterDisplayName: String(characterDisplayName ?? "").slice(0, 80),
      peakRating: null,
      currentRating: null,
    },
    otherCharacter: null,
    opponentInsight: emptyOpponentOfficialInsight(),
    roundTrend: roundTrend ?? buildRoundTrendFailure({}, {
      status: status === "error" ? "error" : status === "empty" ? "unavailable" : "partial",
      reason: reason ?? (status === "error"
        ? "RETRIEVAL_FAILED"
        : status === "empty"
          ? "PROFILE_REFERENCE_EMPTY"
          : "ACT_SCOPE_MISSING"),
      }),
    // Keep the PLAY comparison state explicit even when the profile card
    // itself is empty/error.  This prevents the renderer from falling back to
    // a visual fixture for a real unavailable request.
    playComparison: playComparison && typeof playComparison === "object"
      ? playComparison
      : comparePlayProfiles(null, null, {
          selfError: status === "error",
          opponentError: status === "error",
          verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT,
        }),
    diagnostics,
  };
}

function opponentInsightFromSnapshots(snapshots) {
  const normalized = snapshotObject(snapshots) ?? {};
  const first = Object.values(normalized).find(
    (snapshot) => snapshot.wins + snapshot.losses + snapshot.draws > 0,
  ) ?? normalized.MR ?? normalized.LP ?? null;
  const insight = {
    matches: first ? first.wins + first.losses + first.draws : 0,
    wins: first?.wins ?? 0,
    losses: first?.losses ?? 0,
    draws: first?.draws ?? 0,
    ratings: {},
  };
  for (const type of ["MR", "LP"]) {
    const snapshot = normalized[type];
    insight.ratings[type] = {
      values: [],
      potential: snapshot?.status === "ready" && snapshot.complete === true
        ? snapshot.potential
        : null,
      currentValue: snapshot?.matchTimeRating ?? null,
      currentApplied: false,
    };
  }
  return insight;
}

function opponentOfficialHistoryCacheKey(profileId, requestedLocale, actId = null) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const normalizedActId = Number.isInteger(Number(actId)) && Number(actId) >= 0
    ? Number(actId)
    : "latest";
  return normalizedProfileId && requestedLocale
    ? `${requestedLocale}:${normalizedProfileId}:${normalizedActId}`
    : "";
}

function historyScopeDigest(value) {
  return createHash("sha256")
    .update(String(value ?? ""), "utf8")
    .digest("hex")
    .slice(0, 16);
}

async function fetchOpponentPeakProfile({
  profileId,
  actId,
  generation,
  requestedLocale,
} = {}) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const targetSeasonId = Number(actId);
  if (
    !normalizedProfileId ||
    !Number.isInteger(targetSeasonId) ||
    targetSeasonId < 0 ||
    !requestedLocale
  ) {
    return null;
  }
  const requestHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: SERVICE_ORIGIN,
    Referer: `${buildServiceHomeUrl(SERVICE_ORIGIN, requestedLocale)}/profile/${encodeURIComponent(normalizedProfileId)}/play`,
  };
  const requestEndpoint = async (endpointPath, body, optionOverrides = {}) =>
    fetchServiceWithRateLimit(
      new URL(endpointPath, SERVICE_ORIGIN).toString(),
      {
        method: "POST",
        credentials: "include",
        redirect: "follow",
        headers: requestHeaders,
        body: JSON.stringify(body),
        ...optionOverrides,
      },
      { scope: "history", priority: "interactive" },
    );
  const requestBody = {
    // The official PLAY page passes the numeric `sid` from its profile
    // payload. Keep the same wire type; the endpoint returns an empty object
    // for the string form even when the login session is valid.
    targetShortId: Number(normalizedProfileId),
    targetSeasonId,
    locale: requestedLocale,
    // The official PLAY page sends peak:false for the highest/master_rating_info
    // view; the endpoint itself defines the returned master_rating as peak.
    peak: false,
  };
  const response = await requestEndpoint(OPPONENT_PEAK_PROFILE_API_PATH, requestBody);
  assertPrivateDataGeneration(generation);
  if (response.status === 429) {
    throw serviceRateLimitError(response.headers.get("retry-after"));
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.url.includes("/auth/loginep")
  ) {
    throw new Error("SERVICE_AUTH_REQUIRED");
  }
  if (!response.ok) throw new Error(`SERVICE_HTTP_${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) throw new Error("SERVICE_AUTH_REQUIRED");
  const value = await response.json();
  return value;
}

async function fetchAuthenticatedPlayProfile({
  profileId,
  generation,
  requestedLocale,
  productionReceipt = null,
  productionRole = "play",
} = {}) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  if (!normalizedProfileId || !requestedLocale) return null;
  recordProductionReceipt(productionReceipt, `${productionRole}.request-start`, {
    status: "started",
    profileIdPresent: Boolean(normalizedProfileId),
  });
  const home = buildServiceHomeUrl(SERVICE_ORIGIN, requestedLocale);
  const url = new URL(
    `profile/${encodeURIComponent(normalizedProfileId)}/play`,
    `${home.replace(/\/$/, "")}/`,
  ).toString();
  const response = await fetchServiceWithRateLimit(
    url,
    {
      credentials: "include",
      redirect: "follow",
      headers: { Accept: "text/html" },
    },
    { scope: "history", priority: "interactive" },
  );
  recordProductionReceipt(productionReceipt, `${productionRole}.response`, {
    ...classifyHttpResponse(response, { expectedContentType: "html" }),
  });
  assertPrivateDataGeneration(generation);
  if (response.status === 429) {
    throw serviceRateLimitError(response.headers.get("retry-after"));
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.url.includes("/auth/loginep")
  ) {
    throw new Error("SERVICE_AUTH_REQUIRED");
  }
  if (!response.ok) throw new Error(`SERVICE_HTTP_${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("html")) throw new Error("SERVICE_AUTH_REQUIRED");
  const html = await response.text();
  assertPrivateDataGeneration(generation);
  let payload;
  try {
    payload = parseNextData(html);
  } catch (error) {
    recordProductionReceipt(productionReceipt, `${productionRole}.next-data`, {
      status: "unavailable",
      reason: "NEXT_DATA_PARSE_FAILED",
    });
    throw error;
  }
  const play = payload?.props?.pageProps?.play;
  recordProductionReceipt(productionReceipt, `${productionRole}.payload`, {
    status: play && typeof play === "object" && !Array.isArray(play) ? "ok" : "unavailable",
    responseShape: play && typeof play === "object" && !Array.isArray(play)
      ? classifyPayloadShape(play) === "empty-object" ? "empty-play" : "play"
      : "missing",
    requiredPayload: play && typeof play === "object" && !Array.isArray(play) ? "play" : "missing",
  });
  return {
    payload,
    retrievedAt: Date.now(),
  };
}

async function fetchPlayComparison({
  selfProfileId,
  opponentProfileId,
  generation,
  requestedLocale,
} = {}) {
  const productionReceipt = createProductionReceipt({
    operation: "play-comparison",
    locale: requestedLocale,
    profileId: selfProfileId,
  });
  const [selfResult, opponentResult] = await Promise.allSettled([
    fetchAuthenticatedPlayProfile({
      profileId: selfProfileId,
      generation,
      requestedLocale,
      productionReceipt,
      productionRole: "play.self",
    }),
    fetchAuthenticatedPlayProfile({
      profileId: opponentProfileId,
      generation,
      requestedLocale,
      productionReceipt,
      productionRole: "play.opponent",
    }),
  ]);
  const comparison = comparePlayProfiles(
    selfResult.status === "fulfilled" ? selfResult.value?.payload : null,
    opponentResult.status === "fulfilled" ? opponentResult.value?.payload : null,
    {
      selfError: selfResult.status === "rejected",
      opponentError: opponentResult.status === "rejected",
      verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT,
    },
  );
  const { reason, failureReasons } = playComparisonReason(
    comparison,
    selfResult,
    opponentResult,
  );
  const receiptStatus = comparison.status === "ready"
    ? "ready"
    : comparison.status === "unavailable" || comparison.status === "error"
      ? "unavailable"
      : "partial";
  finalizeProductionReceipt(productionReceipt, {
    status: receiptStatus,
    reason: comparison.status === "ready" ? "PLAY_SCOPE_VERIFIED" : "PLAY_SCOPE_INCOMPLETE",
  });
  return {
    ...comparison,
    reason,
    failureReasons,
    diagnostics: { productionReceipt },
    retrievedAt: {
      self: selfResult.status === "fulfilled" ? selfResult.value?.retrievedAt ?? null : null,
      opponent: opponentResult.status === "fulfilled" ? opponentResult.value?.retrievedAt ?? null : null,
    },
  };
}

function officialCharacterStatsFailureReason(error) {
  const code = error instanceof Error ? error.message : String(error ?? "");
  if (code === "SERVICE_AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (code === "SERVICE_RATE_LIMITED") return "RATE_LIMITED";
  if (code === "PRIVATE_DATA_CLEARED") return "PRIVATE_DATA_CLEARED";
  if (code === "HISTORY_LOCALE_CHANGED") return "LOCALE_CHANGED";
  if (code.startsWith("SERVICE_HTTP_")) return code;
  return "REQUEST_FAILED";
}

function officialCharacterStatsRequestHeaders(requestedLocale, profileId) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: SERVICE_ORIGIN,
    Referer: `${buildServiceHomeUrl(SERVICE_ORIGIN, requestedLocale)}/profile/${encodeURIComponent(profileId)}/play`,
  };
}

async function fetchOfficialCharacterNameRegistry({
  profileId,
  requestedLocale,
  generation,
  actId = null,
  productionReceipt = null,
} = {}) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const locale = String(requestedLocale ?? "").trim();
  const requestedActId = typeof actId === "number" && Number.isInteger(actId) && actId >= 0
    ? actId
    : null;
  const currentActScopeToken = verifiedHistoryCurrentActScope;
  const publishCurrentAct = (result) => {
    publishVerifiedHistoryCurrentAct({
      profileId: normalizedProfileId,
      locale,
      generation,
      requestedActId,
      scopeToken: currentActScopeToken,
      result,
    });
    return result;
  };
  const baseCacheKey = buildOfficialCharacterStatsRequestKey(normalizedProfileId, locale);
  const cacheKey = baseCacheKey
    ? `${baseCacheKey}:${requestedActId ?? "latest"}`
    : "";
  if (!cacheKey || !LOCALE_KEYS.has(locale)) {
    return {
      status: "unavailable",
      reason: "REQUEST_SCOPE_INVALID",
      retryable: false,
      profileId: normalizedProfileId || null,
      locale,
      labels: {},
    };
  }
  const cached = officialCharacterNamesCache.get(cacheKey);
  if (
    cached?.status === "ready" &&
    Date.now() - Number(cached.retrievedAt) < OFFICIAL_CHARACTER_STATS_COOLDOWN_MS
  ) {
    assertPrivateDataGeneration(generation);
    return publishCurrentAct(cached);
  }
  const result = await shareInFlightRequest(officialCharacterNamesInFlight, cacheKey, async () => {
    const retrievedAt = Date.now();
    try {
      const initial = await fetchAuthenticatedPlayProfile({
        profileId: normalizedProfileId,
        generation,
        requestedLocale: locale,
        productionReceipt,
        productionRole: "stats.names",
      });
      assertPrivateDataGeneration(generation);
      if (locale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
      const initialPlay = initial?.payload?.props?.pageProps?.play;
      const currentAct = typeof initialPlay?.current_season_id === "number" &&
        Number.isInteger(initialPlay.current_season_id) &&
        initialPlay.current_season_id > 0
        ? initialPlay.current_season_id
        : null;
      const actRegistry = buildOfficialActRegistry(initialPlay, {
        retrievedAt,
      });
      if (
        actRegistry.status === "ready" &&
        isCurrentHistoryActRequest({
          profileId: normalizedProfileId,
          locale,
          generation,
          scopeToken: currentActScopeToken,
        })
      ) {
        officialActRegistryState = actRegistry;
      } else if (requestedActId == null && isCurrentHistoryActRequest({
        profileId: normalizedProfileId,
        locale,
        generation,
        scopeToken: currentActScopeToken,
      })) {
        officialActRegistryState = {
          status: "unavailable",
          currentActId: null,
          acts: [],
          source: null,
          retrievedAt,
          proof: null,
          reason: actRegistry.reason,
        };
      }
      recordProductionReceipt(productionReceipt, "stats.names.current-act", {
        status: currentAct != null ? "ok" : "unavailable",
        requestedAct: requestedActId,
        responseAct: currentAct,
        requiredPayload: currentAct != null ? "current_season_id" : "missing",
      });
      // The PLAY document is served for the account's current Act even when
      // the stats controls request a historical Act. Character labels are a
      // locale registry, not the selected Act's statistics, so do not reject
      // an explicit historical Act here. The mode API response remains the
      // authority for requested/response Act equality below.
      recordProductionReceipt(productionReceipt, "stats.names.scope", {
        status: "ok",
        requestedAct: requestedActId,
        responseAct: currentAct,
        requiredPayload: "locale-character-registry",
      });
      const validated = validateOfficialCharacterWinRates(initialPlay, {
        locale,
        act: currentAct,
        mode: 1,
      });
      if (!validated.ok) {
        return {
          status: "unavailable",
          source: "official_profile_play_character_names",
          reason: validated.reason,
          retryable: false,
          profileId: normalizedProfileId,
          locale,
          act: currentAct,
          retrievedAt,
          labels: {},
          diagnostics: validated.diagnostics,
        };
      }
      const labels = buildOfficialCharacterNameMap(validated.rows);
      if (!labels) {
        return {
          status: "unavailable",
          source: "official_profile_play_character_names",
          reason: "CHARACTER_NAME_MAP_INVALID",
          retryable: false,
          profileId: normalizedProfileId,
          locale,
          act: currentAct,
          retrievedAt,
          labels: {},
        };
      }
      const result = {
        status: "ready",
        source: "official_profile_play_character_names",
        profileId: normalizedProfileId,
        locale,
        act: currentAct,
        generation,
        retrievedAt,
        labels,
        selfRows: validated.rows,
        rowCount: Object.keys(labels).length,
        actRegistry: actRegistry.status === "ready" ? actRegistry : null,
        retryable: false,
      };
      recordProductionReceipt(productionReceipt, "stats.names.normalized", {
        status: "ok",
        responseAct: currentAct,
        rowCount: validated.rows.length,
        requiredFieldCount: Object.keys(labels).length,
      });
      Object.defineProperty(result, "_play", {
        value: initialPlay,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      officialCharacterNamesCache.set(cacheKey, result);
      return result;
    } catch (error) {
      const reason = officialCharacterStatsFailureReason(error);
      return {
        status: "unavailable",
        source: "official_profile_play_character_names",
        reason,
        retryable: isRetryableOfficialCharacterStatsReason(reason),
        profileId: normalizedProfileId,
        locale,
        act: null,
        retrievedAt,
        labels: {},
      };
    }
  });
  return publishCurrentAct(result);
}

async function fetchOfficialCharacterStatsMode({
  profileId,
  requestedLocale,
  act,
  mode,
  generation,
  expectedCharacterIds,
  selectedOwnCharacterId = "all",
  productionReceipt = null,
} = {}) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const targetSeasonId = Number(act);
  const targetModeId = Number(mode);
  const diagnostics = {
    mode: targetModeId,
    httpStatus: null,
    rowCount: 0,
    positiveIds: 0,
    uniqueIds: 0,
    requiredKeyCount: 0,
    selectedOwnCharacterId: String(selectedOwnCharacterId ?? "all") === "all"
      ? "all"
      : Number(selectedOwnCharacterId),
    act,
    generation,
  };
  if (
    !normalizedProfileId ||
    !LOCALE_KEYS.has(String(requestedLocale)) ||
    !Number.isInteger(targetSeasonId) ||
    targetSeasonId < 0 ||
    !OFFICIAL_CHARACTER_STATS_MODES.includes(targetModeId)
  ) {
    recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.scope`, {
      status: "unavailable",
      mode: targetModeId,
      modeName: OFFICIAL_MODE_LABELS[targetModeId],
      requestedAct: targetSeasonId,
      reason: "REQUEST_SCOPE_INVALID",
    });
    return {
      mode: targetModeId,
      modeName: OFFICIAL_MODE_LABELS[targetModeId],
      valid: false,
      reason: "REQUEST_SCOPE_INVALID",
      retryable: false,
      diagnostics,
    };
  }

  try {
    recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.request-start`, {
      status: "started",
      mode: targetModeId,
      modeName: OFFICIAL_MODE_LABELS[targetModeId],
      requestedAct: targetSeasonId,
      profileIdPresent: Boolean(normalizedProfileId),
    });
    const response = await fetchServiceWithRateLimit(
      new URL(OFFICIAL_CHARACTER_STATS_API_PATH, SERVICE_ORIGIN).toString(),
      {
        method: "POST",
        credentials: "include",
        redirect: "follow",
        headers: officialCharacterStatsRequestHeaders(requestedLocale, normalizedProfileId),
        body: JSON.stringify({
          targetShortId: Number(normalizedProfileId),
          targetSeasonId,
          targetModeId,
          lang: requestedLocale,
        }),
      },
      { scope: "history", priority: "interactive" },
    );
    assertPrivateDataGeneration(generation);
    diagnostics.httpStatus = response.status;
    recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.response`, {
      ...classifyHttpResponse(response, { expectedContentType: "json" }),
      mode: targetModeId,
      modeName: OFFICIAL_MODE_LABELS[targetModeId],
      requestedAct: targetSeasonId,
    });
    if (response.status === 429) {
      throw serviceRateLimitError(response.headers.get("retry-after"));
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.url.includes("/auth/loginep")
    ) {
      throw new Error("SERVICE_AUTH_REQUIRED");
    }
    if (!response.ok) throw new Error(`SERVICE_HTTP_${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) throw new Error("SERVICE_AUTH_REQUIRED");
    let payload;
    try {
      payload = await response.json();
      const responsePayload = payload && typeof payload === "object" &&
        payload.response && typeof payload.response === "object" &&
        !Array.isArray(payload.response)
        ? payload.response
        : payload;
      recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.json`, {
        status: "ok",
        mode: targetModeId,
        responseShape: classifyPayloadShape(payload),
        selfFieldState: Array.isArray(responsePayload?.character_win_rates)
          ? (responsePayload.character_win_rates.length ? "array" : "empty-array")
          : Object.prototype.hasOwnProperty.call(responsePayload ?? {}, "character_win_rates") ? "other" : "missing",
        rivalFieldState: Array.isArray(responsePayload?.character_win_rates_by_rival_character)
          ? (responsePayload.character_win_rates_by_rival_character.length ? "array" : "empty-array")
          : Object.prototype.hasOwnProperty.call(responsePayload ?? {}, "character_win_rates_by_rival_character") ? "other" : "missing",
        scopeFieldState: ["target_season_id", "targetSeasonId", "season_id", "seasonId", "act_id", "actId", "target_mode_id", "targetModeId", "mode_id", "modeId"]
          .filter((key) => Object.prototype.hasOwnProperty.call(responsePayload ?? {}, key)).join(",") || "missing",
        outerRowCount: Array.isArray(responsePayload?.character_win_rates_by_rival_character)
          ? responsePayload.character_win_rates_by_rival_character.length : 0,
        nestedRowCount: Array.isArray(responsePayload?.character_win_rates_by_rival_character)
          ? responsePayload.character_win_rates_by_rival_character.reduce((count, row) => count + (Array.isArray(row?.rival_character_win_rates) ? row.rival_character_win_rates.length : 0), 0) : 0,
      });
    } catch (error) {
      recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.json`, {
        status: "unavailable",
        mode: targetModeId,
        reason: "JSON_PARSE_FAILED",
      });
      throw error;
    }
    assertPrivateDataGeneration(generation);
    if (requestedLocale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
    const validated = validateOfficialCharacterWinRates(payload, {
      expectedCharacterIds,
      locale: requestedLocale,
      act: targetSeasonId,
      mode: targetModeId,
      modeName: OFFICIAL_MODE_LABELS[targetModeId],
    });
    Object.assign(diagnostics, validated.diagnostics);
    recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.self-normalized`, {
      status: validated.ok ? "ok" : "unavailable",
      mode: targetModeId,
      requestedAct: targetSeasonId,
      responseAct: validated.diagnostics?.observedAct,
      rowCount: validated.ok ? validated.rows.length : 0,
      requiredPayload: validated.ok ? "self-rows" : "missing-or-invalid",
      reason: validated.ok ? undefined : validated.reason,
    });
    if (!validated.ok) {
      return {
        mode: targetModeId,
        valid: false,
        reason: validated.reason,
        retryable: false,
        diagnostics,
      };
    }
    diagnostics.selfRowCount = validated.rows.length;
    const rivalResponse = await fetchServiceWithRateLimit(
      new URL(OFFICIAL_CHARACTER_STATS_RIVAL_API_PATH, SERVICE_ORIGIN).toString(),
      {
        method: "POST",
        credentials: "include",
        redirect: "follow",
        headers: officialCharacterStatsRequestHeaders(requestedLocale, normalizedProfileId),
        body: JSON.stringify({
          targetShortId: Number(normalizedProfileId),
          targetSeasonId,
          targetModeId,
          lang: requestedLocale,
        }),
      },
      { scope: "history", priority: "interactive" },
    );
    assertPrivateDataGeneration(generation);
    recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.rival-response`, {
      ...classifyHttpResponse(rivalResponse, { expectedContentType: "json" }),
      mode: targetModeId,
      modeName: OFFICIAL_MODE_LABELS[targetModeId],
      requestedAct: targetSeasonId,
    });
    if (rivalResponse.status === 429) {
      throw serviceRateLimitError(rivalResponse.headers.get("retry-after"));
    }
    if (
      rivalResponse.status === 401 ||
      rivalResponse.status === 403 ||
      rivalResponse.url.includes("/auth/loginep")
    ) {
      throw new Error("SERVICE_AUTH_REQUIRED");
    }
    if (!rivalResponse.ok) throw new Error(`SERVICE_HTTP_${rivalResponse.status}`);
    const rivalContentType = rivalResponse.headers.get("content-type") || "";
    if (!rivalContentType.includes("json")) throw new Error("SERVICE_AUTH_REQUIRED");
    let rivalPayload;
    try {
      rivalPayload = await rivalResponse.json();
      const rivalResponsePayload = rivalPayload && typeof rivalPayload === "object" &&
        rivalPayload.response && typeof rivalPayload.response === "object" &&
        !Array.isArray(rivalPayload.response)
        ? rivalPayload.response
        : rivalPayload;
      recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.rival-json`, {
        status: "ok",
        mode: targetModeId,
        responseShape: classifyPayloadShape(rivalPayload),
        rivalFieldState: Array.isArray(rivalResponsePayload?.character_win_rates_by_rival_character)
          ? (rivalResponsePayload.character_win_rates_by_rival_character.length ? "array" : "empty-array")
          : Object.prototype.hasOwnProperty.call(rivalResponsePayload ?? {}, "character_win_rates_by_rival_character") ? "other" : "missing",
        outerRowCount: Array.isArray(rivalResponsePayload?.character_win_rates_by_rival_character)
          ? rivalResponsePayload.character_win_rates_by_rival_character.length : 0,
        nestedRowCount: Array.isArray(rivalResponsePayload?.character_win_rates_by_rival_character)
          ? rivalResponsePayload.character_win_rates_by_rival_character.reduce((count, row) => count + (Array.isArray(row?.rival_character_win_rates) ? row.rival_character_win_rates.length : 0), 0) : 0,
      });
    } catch (error) {
      recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.rival-json`, {
        status: "unavailable",
        mode: targetModeId,
        reason: "JSON_PARSE_FAILED",
      });
      throw error;
    }
    const opponentValidated = validateOfficialOpponentCharacterWinRates(rivalPayload, {
      expectedCharacterIds,
      expectedSelfRows: validated.rows,
      selectedOwnCharacterId,
      locale: requestedLocale,
      act: targetSeasonId,
      mode: targetModeId,
      generation,
      scopeKind: "post",
    });
    diagnostics.opponent = opponentValidated.diagnostics;
    recordProductionReceipt(productionReceipt, `stats.mode.${targetModeId}.opponent-normalized`, {
      status: opponentValidated.ok ? "ok" : "unavailable",
      mode: targetModeId,
      requestedAct: targetSeasonId,
      responseAct: opponentValidated.diagnostics?.observedAct,
      rowCount: opponentValidated.ok ? opponentValidated.rows.length : 0,
      allRowPresent: opponentValidated.ok && opponentValidated.rows.some((row) => String(row?.id) === "253" || String(row?.label).toUpperCase() === "ALL"),
      requiredPayload: opponentValidated.ok ? "opponent-rows" : "missing-or-invalid",
      reason: opponentValidated.ok ? undefined : opponentValidated.reason,
    });
    if (!opponentValidated.ok) {
      return {
        mode: targetModeId,
        valid: false,
        reason: opponentValidated.reason,
        retryable: false,
        diagnostics,
      };
    }
    return {
      mode: targetModeId,
      valid: true,
      rows: opponentValidated.rows,
      diagnostics,
    };
  } catch (error) {
    return {
      mode: targetModeId,
      valid: false,
      reason: officialCharacterStatsFailureReason(error),
      retryable: isRetryableOfficialCharacterStatsReason(officialCharacterStatsFailureReason(error)),
      diagnostics,
    };
  }
}

async function fetchOfficialOpponentCharacterStats({
  profileId,
  actId = null,
  selectedOwnCharacterId = null,
  matchMode = "all",
  actSelectionSource = "latest",
  forceRefresh = false,
} = {}) {
  ensureUpdateAllowed();
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const requestedLocale = serviceLocale();
  const explicitActId = actSelectionSource === "explicit" && Number.isInteger(Number(actId)) && Number(actId) >= 0
    ? Number(actId)
    : null;
  const verifiedCurrentAct = currentVerifiedHistoryActState(normalizedProfileId);
  const requestedActId = explicitActId ?? (
    verifiedCurrentAct.currentActVerified === true
      ? verifiedCurrentAct.currentActId
      : null
  );
  const selectedOwnNumber = Number(selectedOwnCharacterId);
  const ownScope = selectedOwnCharacterId != null &&
    String(selectedOwnCharacterId) !== "all" &&
    Number.isInteger(selectedOwnNumber) && selectedOwnNumber > 0
    ? String(selectedOwnNumber)
    : null;
  const normalizedMatchMode = matchMode === "all" || Object.hasOwn(OFFICIAL_MATCH_MODE_IDS, matchMode)
    ? matchMode
    : "all";
  const allCharactersScope = normalizedMatchMode === "all" && ownScope == null;
  const productionReceipt = createProductionReceipt({
    operation: "official-opponent-character-stats",
    locale: requestedLocale,
    requestedAct: requestedActId,
    requestedModes: ALLOWED_MATCH_MODES,
    profileId: normalizedProfileId,
  });
  let networkAttempted = false;
  const actSource = explicitActId == null ? "latest" : "explicit";
  recordProductionReceipt(productionReceipt, "stats.scope", {
    status: requestedActId != null ? "ok" : "unavailable",
    requestedAct: requestedActId,
    requiredPayload: requestedActId != null ? "act" : "verified-current-act-missing",
    actSource,
    resolvedAct: requestedActId,
    networkAttempted: false,
    ownCharacterId: ownScope == null ? null : Number(ownScope),
    selectionSource: allCharactersScope ? "all-characters" : ownScope == null ? "missing" : "selected",
  });
  if (ownScope == null && !allCharactersScope) {
    finalizeProductionReceipt(productionReceipt, { status: "unavailable", reason: "OWN_CHARACTER_SCOPE_MISSING" });
    return {
      status: "unavailable",
      source: "official_profile_play",
      profileId: normalizedProfileId,
      locale: requestedLocale,
      act: requestedActId,
      selectedOwnCharacterId: null,
      rows: [],
      reason: "OWN_CHARACTER_SCOPE_MISSING",
      retryable: false,
      diagnostics: { productionReceipt },
    };
  }
  const baseRequestKey = buildOfficialCharacterStatsRequestKey(normalizedProfileId, requestedLocale);
  const requestKey = baseRequestKey
    ? `${baseRequestKey}:${requestedActId ?? "latest"}:${normalizedMatchMode}:${ownScope}`
    : "";
  if (!requestKey) {
    finalizeProductionReceipt(productionReceipt, { status: "unavailable", reason: "PROFILE_OR_LOCALE_INVALID" });
    return { status: "unavailable", reason: "PROFILE_OR_LOCALE_INVALID", rows: [], diagnostics: { productionReceipt } };
  }
  // A forced refresh must never consume an already-running normal snapshot.
  // Keep forced calls on their own key, but let them wait for the normal
  // flight so the scope still has at most one sequential refresh.
  const forceRequestKey = `${requestKey}:force`;
  const flightKey = forceRefresh === true ? forceRequestKey : requestKey;
  const result = await shareInFlightRequest(officialCharacterStatsInFlight, flightKey, async () => {
    if (forceRefresh === true) {
      const normalFlight = officialCharacterStatsInFlight.get(requestKey);
      if (normalFlight) await normalFlight.catch(() => {});
    }
    const generation = privateDataGeneration;
    const retrievedAt = Date.now();
    try {
      const nameRegistry = await fetchOfficialCharacterNameRegistry({
        profileId: normalizedProfileId,
        requestedLocale,
        generation,
        // The current PLAY snapshot supplies the localized roster and, when
        // the requested Act is current, the two-axis opponent statistics.
        // Older Acts are queried through the explicit mode endpoint below.
        actId: null,
        productionReceipt,
      });
      assertPrivateDataGeneration(generation);
      if (requestedLocale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
      if (nameRegistry.status !== "ready") {
        return {
          status: nameRegistry.retryable ? "partial" : "unavailable",
          source: "official_profile_play",
          retryable: nameRegistry.retryable === true,
          profileId: normalizedProfileId,
          locale: requestedLocale,
          act: nameRegistry.act ?? null,
          retrievedAt,
          rows: [],
          reason: nameRegistry.reason,
          diagnostics: nameRegistry.diagnostics ?? null,
        };
      }
      const act = requestedActId ?? Number(nameRegistry.act);
      if (!Number.isInteger(act) || act < 0) {
        return { status: "unavailable", source: "official_profile_play", retryable: false, profileId: normalizedProfileId, locale: requestedLocale, act: null, retrievedAt, rows: [], reason: "ACT_UNAVAILABLE" };
      }
      // Opponent-character stats are sourced from the app's three explicit
      // mode POSTs even for the current Act. The PLAY page's aggregate mode
      // includes the official mode=1 "all" scope and must not be reused for
      // the app's ALL calculation.
      const useCurrentPlay = false;
      const scopeKey = useCurrentPlay ? "play-all" : "act-modes";
      // Keep every dimension of the resolved stats scope independent. In
      // particular, ALL must never reuse a ranked/casual/Battle Hub result.
      const cacheKey = [
        buildOfficialCharacterStatsCacheKey(normalizedProfileId, requestedLocale, act),
        ownScope == null ? "all" : String(ownScope),
        scopeKey,
        normalizedMatchMode,
      ].join(":");
      const cached = forceRefresh === true
        ? null
        : officialCharacterStatsCache.get(cacheKey);
      const qaReceiptProbe = Boolean(process.env.MATCH_OVERLAY_QA_RECEIPT_DIR);
      const currentHistoryRevision = historyRevision(normalizedProfileId);
      if (forceRefresh === true) officialCharacterStatsCache.delete(cacheKey);
      const cacheFresh = cached?.status === "ready" &&
        cached.generation === generation &&
        cached.historyRevision === currentHistoryRevision &&
        Date.now() - Number(cached.retrievedAt) < OFFICIAL_CHARACTER_STATS_COOLDOWN_MS;
      if (!qaReceiptProbe && cacheFresh) {
        assertPrivateDataGeneration(generation);
        recordProductionReceipt(productionReceipt, "stats.cache", { status: "ok", reason: "CACHE_HIT", cacheHitScope: `${act}:${normalizedMatchMode}` });
        return cached;
      }
      const request = (async () => {
        networkAttempted = true;
        const expectedCharacterIds = new Set(Object.keys(nameRegistry.labels).map(Number));
        if (useCurrentPlay) {
          const validated = validateOfficialOpponentCharacterWinRates(nameRegistry._play, {
            expectedCharacterIds,
            expectedSelfRows: nameRegistry.selfRows,
            selectedOwnCharacterId: ownScope,
            locale: requestedLocale,
            act,
            generation,
            scopeKind: "play",
          });
          recordProductionReceipt(productionReceipt, "stats.play.normalized", {
            status: validated.ok ? "ok" : "unavailable",
            requestedAct: act,
            responseAct: validated.diagnostics?.observedAct,
            rowCount: validated.ok ? validated.rows.length : 0,
            allRowPresent: validated.ok && validated.rows.some((row) => String(row?.id) === "253" || String(row?.label).toUpperCase() === "ALL"),
            requiredPayload: validated.ok ? "opponent-rows" : "missing-or-invalid",
            reason: validated.ok ? undefined : validated.reason,
          });
          if (!validated.ok) {
            return {
              status: "partial",
              source: "official_profile_play",
              retryable: false,
              profileId: normalizedProfileId,
              locale: requestedLocale,
              act,
              retrievedAt,
              rows: [],
              diagnostics: validated.diagnostics,
              reason: validated.reason,
            };
          }
          const result = {
            status: "ready",
            source: "official_profile_play",
            retryable: false,
            profileId: normalizedProfileId,
            locale: requestedLocale,
            act,
            retrievedAt,
            selectedOwnCharacterId: ownScope,
            rows: validated.rows,
            diagnostics: validated.diagnostics,
            generation,
            historyRevision: currentHistoryRevision,
          };
          if (!qaReceiptProbe) officialCharacterStatsCache.set(cacheKey, result);
          return result;
        }

        const requestedModes = normalizedMatchMode === "all"
          ? OFFICIAL_CHARACTER_STATS_MODES
          : [OFFICIAL_MATCH_MODE_IDS[normalizedMatchMode]];
        const modeResults = await Promise.all(
          requestedModes.map((mode) => fetchOfficialCharacterStatsMode({
            profileId: normalizedProfileId,
            requestedLocale,
            act,
            mode,
            generation,
            expectedCharacterIds,
            selectedOwnCharacterId: ownScope,
            productionReceipt,
          })),
        );
        assertPrivateDataGeneration(generation);
        if (normalizedMatchMode !== "all") {
          const single = modeResults[0];
          if (!single?.valid || !Array.isArray(single.rows)) {
            return {
              status: "partial",
              source: "official_profile_play",
              profileId: normalizedProfileId,
              locale: requestedLocale,
              act,
              retrievedAt,
              selectedOwnCharacterId: ownScope,
              mode: normalizedMatchMode,
              modes: [{ mode: single?.mode ?? requestedModes[0], status: "invalid", reason: single?.reason ?? "MODE_RESULT_INVALID" }],
              rows: [],
              reason: single?.reason ?? "MODE_RESULT_INVALID",
              retryable: single?.retryable === true,
            };
          }
          const result = {
            status: "ready",
            source: "official_profile_play",
            profileId: normalizedProfileId,
            locale: requestedLocale,
            act,
            retrievedAt,
            selectedOwnCharacterId: ownScope,
            mode: normalizedMatchMode,
            modes: [{ mode: single.mode, status: "valid", diagnostics: single.diagnostics ?? null }],
            rows: single.rows,
            retryable: false,
            generation,
            historyRevision: currentHistoryRevision,
          };
          if (!qaReceiptProbe) officialCharacterStatsCache.set(cacheKey, result);
          return result;
        }
        const aggregate = aggregateOfficialCharacterWinRates(modeResults, {
          profileId: normalizedProfileId,
          locale: requestedLocale,
          act,
          retrievedAt,
          generation,
        });
        const firstInvalidMode = aggregate.modes?.find((mode) => mode.status !== "valid");
        if (aggregate.status !== "ready") {
          return {
            ...aggregate,
            source: "official_profile_play",
            profileId: normalizedProfileId,
            locale: requestedLocale,
            act,
            retrievedAt,
            selectedOwnCharacterId: ownScope,
            reason: firstInvalidMode?.reason ?? "MODE_RESULT_INVALID",
            retryable: aggregate.retryable === true,
            rows: [],
          };
        }
        const result = {
          ...aggregate,
          source: "official_profile_play",
          retryable: false,
          profileId: normalizedProfileId,
          locale: requestedLocale,
          act,
          retrievedAt,
          selectedOwnCharacterId: ownScope,
          diagnostics: { modeResults: modeResults.map((entry) => entry.diagnostics ?? null) },
          generation,
          historyRevision: currentHistoryRevision,
        };
        if (!qaReceiptProbe) officialCharacterStatsCache.set(cacheKey, result);
        return result;
      })();
      return request;
    } catch (error) {
      const reason = officialCharacterStatsFailureReason(error);
      return { status: error?.message === "PRIVATE_DATA_CLEARED" ? "unavailable" : "partial", source: "official_profile_play", retryable: isRetryableOfficialCharacterStatsReason(reason), profileId: normalizedProfileId, locale: requestedLocale, act: null, retrievedAt, rows: [], reason };
    }
  });
  const finalStatus = result?.status === "ready"
    ? "ready"
    : result?.status === "partial"
      ? "partial"
      : "unavailable";
  const finalReason = result?.reason ?? (finalStatus === "ready" ? "STATS_SCOPE_VERIFIED" : "STATS_SCOPE_INCOMPLETE");
  const receiptTotals = summarizeOfficialOpponentCharacterStatsRows(result?.rows);
  recordProductionReceipt(productionReceipt, "stats.final", {
    status: finalStatus,
    reason: finalReason,
    requestedAct: requestedActId,
    resolvedAct: result?.act,
    actSource,
    networkAttempted,
    ownCharacterId: Number(result?.selectedOwnCharacterId) || null,
    selectionSource: result?.selectedOwnCharacterId
      ? "selected"
      : allCharactersScope ? "all-characters" : "missing",
    outerMatchCount: (() => {
      const aggregate = Array.isArray(result?.rows)
        ? result.rows.find((row) => String(row?.id) === "253" || String(row?.characterId) === "253" || String(row?.label).toUpperCase() === "ALL")
        : null;
      return Number(aggregate?.matches) || 0;
    })(),
    rowCount: Array.isArray(result?.rows) ? result.rows.length : 0,
    allRowPresent: Array.isArray(result?.rows) && result.rows.some((row) => String(row?.id) === "253" || String(row?.label).toUpperCase() === "ALL"),
    selectedMode: normalizedMatchMode,
    sourceModes: normalizedMatchMode === "all" ? "ranked,casual,battleHub" : normalizedMatchMode,
    allBattleCount: receiptTotals.matches,
    allWinCount: receiptTotals.wins,
    allWinRate: receiptTotals.winRate,
    allTotalSource: receiptTotals.source,
    displayRowCount: Array.isArray(result?.rows) ? result.rows.length : 0,
    trueZero: finalStatus === "ready" && Array.isArray(result?.rows) && result.rows.length > 0 &&
      result.rows.every((row) => (Number(row?.matches) || 0) === 0 && (Number(row?.wins) || 0) === 0),
    partialMissingModes: Array.isArray(result?.modes)
      ? result.modes.filter((mode) => mode.status !== "valid").map((mode) => mode.mode).join(",")
      : "",
  });
  finalizeProductionReceipt(productionReceipt, { status: finalStatus, reason: finalReason });
  return {
    ...result,
    diagnostics: {
      ...(result?.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {}),
      productionReceipt,
    },
  };
}

async function fetchOpponentOfficialHistory({
  profileId,
  generation,
  requestedLocale,
  selectedRecord = null,
  actId = null,
  actIndependent = false,
  beforeTimestamp = null,
  requestScopeProof = null,
  productionReceipt = null,
  productionRole = "history",
} = {}) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const cacheKey = opponentOfficialHistoryCacheKey(
    normalizedProfileId,
    requestedLocale,
    actId,
  );
  if (!cacheKey) return { data: null, records: [], retrievedAt: null };
  const requestedAct = normalizeHistoryActId(actId);
  if (requestedAct == null && actIndependent !== true) throw new Error("ACT_SCOPE_MISSING");
  recordProductionReceipt(productionReceipt, `${productionRole}.request-start`, {
    status: "started",
    requestedAct,
    profileIdPresent: Boolean(normalizedProfileId),
  });
  const now = Date.now();
  const cached = opponentOfficialHistoryCache.get(cacheKey);
  const history = cached?.history ?? {
    data: null,
    records: [],
    pages: {},
    rawCounts: {},
    totalPages: null,
    retrievedAt: null,
    complete: false,
    requestedActId: requestedAct,
  };
  const retrievedAt = history.retrievedAt ?? now;
  const save = () => setBoundedCacheEntry(
    opponentOfficialHistoryCache,
    cacheKey,
    { fetchedAt: now, history },
    OPPONENT_OFFICIAL_HISTORY_MAX_CACHE_ENTRIES,
  );
  if (!history.data) {
    const profileData = await shareInFlightRequest(
      opponentOfficialHistoryInFlight,
      `${cacheKey}:profile`,
      () => fetchServiceJson(
        `profile/${encodeURIComponent(normalizedProfileId)}.json`,
        {},
        true,
        "history",
        "interactive",
        requestedLocale,
        productionReceipt,
        `${productionRole}.profile`,
      ),
    );
    assertPrivateDataGeneration(generation);
    if (requestedLocale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
    history.data = profileData;
    history.retrievedAt = retrievedAt;
    recordProductionReceipt(productionReceipt, `${productionRole}.profile.normalize`, {
      status: profileData && typeof profileData === "object" && !Array.isArray(profileData) ? "ok" : "unavailable",
      requiredPayload: profileData && typeof profileData === "object" && !Array.isArray(profileData) ? "profile-data" : "missing",
    });
  }
  const selectedReplayId = String(selectedRecord?.replayId ?? "").trim();
  let expectedTotalPages = Number.isInteger(Number(history.totalPages)) && Number(history.totalPages) > 0
    ? Number(history.totalPages)
    : null;
  const validateHistoryPage = (pageResult, page) => {
    const validation = verifyScopedHistoryPage({
      pageResult,
      page,
      expectedTotalPages,
      requestedActId: requestedAct,
      actIndependent,
      requestScopeVerified: requestScopeProof === "verified-current-act",
    });
    if (!validation.ok) throw new Error(validation.reason);
    expectedTotalPages = validation.totalPages;
    return validation;
  };
  const safeMaxPages = OPPONENT_STATS_SAFE_MAX_PAGES;
  const cutoff = Number(beforeTimestamp);
  const hasCutoff = Number.isFinite(cutoff) && cutoff > 0;
  const opponentPotentialMrCharacterId = productionRole === "history.opponent"
    ? Number(selectedRecord?.opponentCharacterId)
    : null;
  const targetReached = () => {
    if (!hasCutoff) return false;
    const roundTargetReached = buildRoundTrend(history.records, {
      beforeTimestamp: cutoff,
      matchTypes: ROUND_TREND_MATCH_TYPES,
      limit: 20,
    }).matchCount >= 20;
    if (!roundTargetReached) return false;
    if (productionRole !== "history.opponent" || !Number.isFinite(opponentPotentialMrCharacterId)) {
      return true;
    }
    return potentialMrHistoryCandidates(history.records, {
      characterId: opponentPotentialMrCharacterId,
      beforeTimestamp: cutoff,
      actId,
    }).length >= POTENTIAL_MR_MATCH_LIMIT;
  };
  let reachedTarget = targetReached();
  for (let page = 1; page <= safeMaxPages; page += 1) {
    if (history.pages[page]) {
      validateHistoryPage(history.pages[page], page);
    } else {
      const pageResult = await shareInFlightRequest(
        opponentOfficialHistoryInFlight,
        `${cacheKey}:page:${page}`,
        () => fetchRankedReplaysPage(
          normalizedProfileId,
          page,
          "history",
          "history",
          requestedLocale,
          actIndependent === true ? null : actId,
          productionReceipt,
          `${productionRole}.battlelog.page.${page}`,
        ),
      );
      assertPrivateDataGeneration(generation);
      if (requestedLocale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
      validateHistoryPage(pageResult, page);
      history.pages[page] = {
        rawCount: Number(pageResult?.rawCount) || 0,
        normalizedCount: Number(pageResult?.normalizedCount) || 0,
        hasReplayList: pageResult?.hasReplayList === true,
        totalPages: expectedTotalPages,
        responsePage: pageResult?.responsePage ?? null,
        requestedActId: pageResult?.requestedActId ?? requestedAct,
        responseActId: pageResult?.responseActId ?? null,
        recordActId: pageResult?.recordActId ?? null,
        recordActIds: Array.isArray(pageResult?.recordActIds) ? pageResult.recordActIds : [],
        actScopeVerified: pageResult?.actScopeVerified === true,
        requestScopeProof: requestScopeProof === "verified-current-act" ? requestScopeProof : null,
        actIndependent: actIndependent === true,
        actScopeReason: pageResult?.actScopeReason ?? null,
        records: Array.isArray(pageResult?.replays) ? pageResult.replays : [],
      };
      recordProductionReceipt(productionReceipt, `${productionRole}.battlelog.page`, {
        status: actIndependent === true || pageResult?.actScopeVerified === true ? "ok" : "unavailable",
        page,
        totalPages: expectedTotalPages,
        rawCount: pageResult?.rawCount,
        normalizedCount: pageResult?.normalizedCount,
        requestedAct: requestedAct,
        responseAct: pageResult?.responseActId,
        actScopeVerified: pageResult?.actScopeVerified === true,
        requiredPayload: pageResult?.hasReplayList === true ? "replay_list" : "missing",
        reason: actIndependent === true ? undefined : pageResult?.actScopeReason,
      });
      const byReplayId = new Map(history.records.map((record) => [record.replayId, record]));
      for (const record of history.pages[page].records) {
        if (!record?.replayId) continue;
        const previous = byReplayId.get(record.replayId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
          throw new Error("HISTORY_REPLAY_DUPLICATE_CONFLICT");
        }
        byReplayId.set(record.replayId, record);
      }
      history.records = [...byReplayId.values()];
      history.rawCounts[page] = history.pages[page].rawCount;
      history.totalPages = expectedTotalPages;
      save();
    }
    reachedTarget = targetReached();
    if (reachedTarget) break;
    if (expectedTotalPages != null && page >= expectedTotalPages) break;
  }
  history.totalPages = expectedTotalPages;
  const allPagesFetched = expectedTotalPages != null &&
    Object.keys(history.pages).length >= expectedTotalPages;
  if (!allPagesFetched && !reachedTarget) throw new Error("HISTORY_PAGE_SET_INCOMPLETE");
  if (actIndependent !== true && (!selectedReplayId || !history.records.some((record) =>
    record.replayId === selectedReplayId && Number(record.actId) === requestedAct,
  ))) {
    throw new Error("HISTORY_SELECTED_REPLAY_SCOPE_MISSING");
  }
  history.requestedActId = requestedAct;
  history.actScopeVerified = actIndependent === true ? false : true;
  history.roundScopeIndependent = actIndependent === true;
  history.complete = allPagesFetched || reachedTarget;
  history.stopReason = reachedTarget ? "target20" : allPagesFetched ? "total_pages" : null;
  save();
  const selected = actIndependent === true
    ? null
    : history.records.find((record) => record.replayId === selectedReplayId && Number(record?.actId) === requestedAct) ?? null;
  const selfRounds = selected?.roundResults?.self?.values;
  const opponentRounds = selected?.roundResults?.opponent?.values;
  recordProductionReceipt(productionReceipt, `${productionRole}.round-target`, {
    status: actIndependent === true || selected ? "ok" : "unavailable",
    targetMatches: selected ? 1 : 0,
    targetRounds: selected ? Math.max(Array.isArray(selfRounds) ? selfRounds.length : 0, Array.isArray(opponentRounds) ? opponentRounds.length : 0) : 0,
    requiredPayload: actIndependent === true ? "cutoff-round-trend" : selected ? "selected-replay-round-results" : "missing",
    reason: actIndependent === true || selected ? undefined : "HISTORY_SELECTED_REPLAY_SCOPE_MISSING",
  });
  return history;
}

async function backfillHistoryCharacterLabelsForLocale(
  profileId,
  locale,
  generation,
  scopeToken = null,
) {
  const normalizedProfileId = normalizeHistoryProfileId(profileId);
  const requestedLocale = LOCALE_KEYS.has(String(locale)) ? String(locale) : null;
  if (!normalizedProfileId || !requestedLocale) return false;
  if (scopeToken != null && scopeToken !== matchHistoryFetchScopeToken) return false;
  const cacheKey = `${normalizedProfileId}:${requestedLocale}`;
  if (
    matchHistoryFetchInFlight &&
    matchHistoryFetchProfileId === normalizedProfileId &&
    matchHistoryFetchLocale === requestedLocale
  ) {
    await matchHistoryFetchInFlight.catch(() => {});
    return false;
  }
  const store = loadMatchHistoryStore(normalizedProfileId);
  const initialStoredRecords = store.records.map((record) => ({
    replayId: record?.replayId,
  }));
  if (historyLabelBackfillCompleted.has(cacheKey)) return false;
  const hasCharacterIds = store.records.some((record) => {
    const ownId = Number(record?.characterId);
    const opponentId = Number(record?.opponentCharacterId);
    return (
      (Number.isFinite(ownId) && ownId > 0) ||
      (Number.isFinite(opponentId) && opponentId > 0)
    );
  });
  if (!hasCharacterIds) {
    historyLabelBackfillCompleted.add(cacheKey);
    return false;
  }
  // Existing locale labels may have come from an older artifact or a
  // different locale field. Remove them before the authoritative refetch so
  // a failed request cannot leave a stale English/Japanese value marked valid.
  let cleared = false;
  for (const record of store.records) {
    if (record?.characterNamesByLocale?.[requestedLocale]) {
      const next = { ...record.characterNamesByLocale };
      delete next[requestedLocale];
      record.characterNamesByLocale = next;
      if (!Object.keys(next).length) delete record.characterNamesByLocale;
      cleared = true;
    }
  }
  if (cleared) persistMatchHistoryStore(normalizedProfileId, store);
  const existing = historyLabelBackfillInFlight.get(cacheKey);
  if (existing) return existing;
  const request = (async () => {
    const replays = await fetchMatchHistoryPages(
      normalizedProfileId,
      null,
      requestedLocale,
      `history:${normalizedProfileId}:${requestedLocale}:${generation}:${scopeToken ?? matchHistoryFetchScopeToken}`,
    );
    assertPrivateDataGeneration(generation);
    if (requestedLocale !== serviceLocale()) {
      throw new Error("HISTORY_LOCALE_CHANGED");
    }
    if (scopeToken != null && scopeToken !== matchHistoryFetchScopeToken) {
      return false;
    }
    // Backfill is optional enrichment only. New rows must enter through the
    // verified import path, so a concurrent backfill may update labels only
    // for replay ids already present before this request started.
    const labelReplays = filterHistoryBackfillReplays(initialStoredRecords, replays);
    if (!labelReplays.length) return false;
    const changed = mergeMatchHistory(labelReplays, normalizedProfileId, {
      persist: true,
      notify: false,
    });
    historyLabelBackfillCompleted.add(cacheKey);
    return changed;
  })().finally(() => {
    if (historyLabelBackfillInFlight.get(cacheKey) === request) {
      historyLabelBackfillInFlight.delete(cacheKey);
    }
  });
  historyLabelBackfillInFlight.set(cacheKey, request);
  return request;
}

async function fetchHistoryOpponentContext({
  profileId: _profileId,
  opponentUserCode: _opponentUserCode,
  characterId: _characterId,
  characterDisplayName: _characterDisplayName,
  historyOwnerProfileId,
  replayId,
  selectedRecord = null,
  selectedActId: requestedActId = null,
  selectedActSelector = null,
  currentActId: rendererCurrentActId = null,
  actSelectionSource = "latest",
  forceRefresh = false,
} = {}) {
  ensureUpdateAllowed();
  const ipcSelectedActId = normalizeHistoryActId(requestedActId);
  const ipcSelectedActSelector = sanitizeHistoryActSelector(selectedActSelector);
  const ipcCurrentActId = normalizeHistoryActId(rendererCurrentActId);
  const ipcSelectedRecordActId = isKnownHistoryActRecord(selectedRecord)
    ? normalizeHistoryActId(selectedRecord?.actId)
    : null;
  // The renderer includes the verified current Act as a convenience for the
  // latest view. It is not an explicit historical selection, however. Treat
  // every numeric selectedActId as untrusted in that mode and resolve latest
  // from the current official PLAY scope below. Otherwise a stale record Act
  // can be compared against the convenience value and fail as
  // ACT_SCOPE_MISMATCH before the official scope is resolved.
  if (actSelectionSource !== "explicit") {
    requestedActId = null;
  }
  const productionReceipt = createProductionReceipt({
    operation: "opponent-context",
    locale: serviceLocale(),
    requestedAct: requestedActId,
    profileId: _profileId,
  });
  const qaReceiptProbe = Boolean(process.env.MATCH_OVERLAY_QA_RECEIPT_DIR);
  const actSource = actSelectionSource === "explicit" ? "explicit" : "latest";
  recordProductionReceipt(productionReceipt, "context.scope", {
    status: normalizeHistoryActId(requestedActId) != null ? "ok" : "unavailable",
    requestedAct: normalizeHistoryActId(requestedActId),
    requiredPayload: normalizeHistoryActId(requestedActId) != null ? "selected-act" : "missing",
    actSource,
    resolvedAct: requestedActId,
    networkAttempted: false,
  });
  recordProductionReceipt(productionReceipt, "context.ipc-scope", {
    ipcSelectedAct: ipcSelectedActId,
    ipcSelectedActSelector,
    ipcCurrentAct: ipcCurrentActId,
    ipcActSelectionSource: actSelectionSource,
    ipcSelectedRecordAct: ipcSelectedRecordActId,
    ipcSelectedRecordActPresent: selectedRecord?.actId != null,
  });
  recordProductionReceipt(productionReceipt, "context.opponent-scope", {
    status: "ok",
    profileScopeDigest: historyScopeDigest(_opponentUserCode ?? selectedRecord?.opponentUserCode),
    cacheScopeDigest: historyScopeDigest(`${serviceLocale()}:${_opponentUserCode ?? selectedRecord?.opponentUserCode}:${replayId ?? selectedRecord?.replayId}`),
    scopeSource: "selected-history-row",
  });
  const activeOwnerProfileId = activeHistoryProfileId();
  const requestedOwnerProfileId = normalizeHistoryProfileId(
    historyOwnerProfileId,
  );
  if (
    requestedOwnerProfileId &&
    activeOwnerProfileId &&
    requestedOwnerProfileId !== activeOwnerProfileId
  ) {
    return emptyOpponentProfileContext({ status: "empty", reason: "HISTORY_OWNER_SCOPE_MISMATCH" });
  }
  const ownerProfileId = activeOwnerProfileId ?? requestedOwnerProfileId;
  let currentActState = currentVerifiedHistoryActState(ownerProfileId);
  const selectorRaw = sanitizeHistoryActSelector(selectedActSelector);
  let normalizedRequestedActId = normalizeHistoryActId(requestedActId);
  if (
    String(selectedActSelector ?? "latest").trim() === "latest" &&
    currentActState.currentActVerified !== true
  ) {
    const actProbe = await fetchOfficialCharacterNameRegistry({
      profileId: ownerProfileId,
      requestedLocale: serviceLocale(),
      generation: privateDataGeneration,
      actId: null,
      productionReceipt,
    });
    // A current/latest probe must never turn the official selector's Act 0
    // historical option into a current Act. Act 0 remains valid only when
    // the user explicitly selected it.
    const probedAct = normalizePositiveActId(actProbe?.act);
    if (actProbe?.status === "ready" && probedAct != null) {
      currentActState = {
        ...currentActState,
        currentActId: probedAct,
        currentActVerified: probedAct > 0,
        currentActStatus: "ready",
        currentActSource: "official_profile_play",
        currentActReason: null,
      };
      normalizedRequestedActId = probedAct;
      requestedActId = probedAct;
    }
  }
  const selectorResolution = resolveHistoryActSelection({
    selector: selectedActSelector,
    currentActId: currentActState.currentActId,
    currentActVerified: currentActState.currentActVerified,
  });
  if (
    selectorResolution.ok === true &&
    selectorResolution.selector === "latest" &&
    normalizedRequestedActId == null
  ) {
    // The renderer's latest request may omit the numeric convenience value
    // while the main process resolves the current official Act. Carry that
    // verified result into the scoped history acquisition before comparing
    // the selected replay or constructing the cache key.
    requestedActId = selectorResolution.actId;
    normalizedRequestedActId = selectorResolution.actId;
  }
  const requestedReplayId = String(replayId ?? selectedRecord?.replayId ?? "").trim();
  const ownerStore = ownerProfileId ? loadMatchHistoryStore(ownerProfileId) : null;
  const resolvedRecord = ownerStore?.records?.find(
    (record) => record.replayId === requestedReplayId,
  ) ?? null;
  if (!resolvedRecord) {
    finalizeProductionReceipt(productionReceipt, { status: "unavailable", reason: "HISTORY_SELECTED_REPLAY_SCOPE_MISSING" });
    return emptyOpponentProfileContext({
      profileId: ownerProfileId,
      actId: requestedActId,
      status: "empty",
      reason: "HISTORY_SELECTED_REPLAY_MISSING",
      diagnostics: historyScopeDiagnostics({
        currentActState,
        selectorRaw,
        resolvedActId: requestedActId,
        ipcActId: requestedActId,
        finalScopeReason: "HISTORY_SELECTED_REPLAY_SCOPE_MISSING",
        productionReceipt,
      }),
    });
  }
  // Act selector mismatches belong to Act-scoped stats diagnostics only.
  // They must not suppress the Act-independent PLAY comparison or round
  // trend for the opponent selected in this history row.
  const normalizedProfileId = normalizeHistoryProfileId(
    resolvedRecord.opponentUserCode,
  );
  const normalizedCharacterId = Number(resolvedRecord.opponentCharacterId) > 0
    ? Number(resolvedRecord.opponentCharacterId)
    : null;
  const resolvedCharacterDisplayName = resolvedRecord.opponentCharacterName;
  if (!normalizedProfileId || normalizedCharacterId == null) {
    finalizeProductionReceipt(productionReceipt, { status: "unavailable", reason: "PROFILE_REFERENCE_EMPTY" });
    return emptyOpponentProfileContext({
      profileId: normalizedProfileId,
      characterId: normalizedCharacterId,
      characterDisplayName: resolvedCharacterDisplayName,
      actId: requestedActId,
      // Keep the diagnostic reason separate, but expose the canonical
      // renderer-facing reason so the user sees a cause-specific message.
      reason: "OPPONENT_PROFILE_DATA_EMPTY",
      diagnostics: historyScopeDiagnostics({
        currentActState,
        selectorRaw,
        resolvedActId: requestedActId,
        ipcActId: requestedActId,
        finalScopeReason: "PROFILE_REFERENCE_EMPTY",
        productionReceipt,
      }),
    });
  }

  const recordForActScope = actSelectionSource === "explicit"
    ? resolvedRecord
    : { ...resolvedRecord, actId: null };
  const initialTrendContext = buildScopedRoundTrendContext({
    // Local history rows may carry a legacy/stale Act marker. For latest, the
    // verified selector is authoritative; only an explicit historical choice
    // is allowed to validate against the stored record Act.
    selectedRecord: recordForActScope,
    selectedActId: null,
    actIndependent: true,
  });
  // Act scope is required only for the optional round-trend acquisition.
  // Profile/PLAY comparison is based on the profile's historical data and
  // must remain available when round scope is missing or mismatched.
  const selectedActId = normalizeHistoryActId(requestedActId);
  const scopedSelectedRecord = initialTrendContext.ok
    ? initialTrendContext.selectedRecord
    : { ...resolvedRecord, actId: selectedActId };
  const initialRoundTrend = initialTrendContext.ok
    ? null
    : initialTrendContext.roundTrend;
  const trendScope = {
    beforeTimestamp: Number(scopedSelectedRecord?.playedAt ?? scopedSelectedRecord?.uploadedAt) || null,
    limit: 20,
    matchTypes: ROUND_TREND_MATCH_TYPES,
    actId: null,
  };
  const generation = privateDataGeneration;
  const requestedLocale = serviceLocale();
  const selectedCutoff = Number(resolvedRecord?.playedAt ?? resolvedRecord?.uploadedAt);
  const cacheKey = `${requestedLocale}:${ownerProfileId}:${selectedActId ?? "unknown"}:${Number.isFinite(selectedCutoff) && selectedCutoff > 0 ? selectedCutoff : "unknown"}:${requestedReplayId}:${normalizedProfileId}:${normalizedCharacterId}`;
  if (forceRefresh === true) {
    // A new local match can also make the rendered profile context stale. The
    // renderer only sends this flag after detecting a genuinely new replay
    // for the displayed opponent, so one refresh can bypass the normal
    // five-minute profile cache without turning the card into a live poll.
    opponentProfileContextCache.delete(cacheKey);
  }
  const now = Date.now();
  const cached = opponentProfileContextCache.get(cacheKey);
  if (
    !qaReceiptProbe &&
    cached &&
    Number.isFinite(Number(cached.fetchedAt)) &&
    now - Number(cached.fetchedAt) < OPPONENT_PROFILE_CONTEXT_COOLDOWN_MS
  ) {
    return cached.context;
  }

  // shareInFlightRequest de-duplicates identical tuples, but a renderer can
  // still submit distinct tuples. Refuse new work once the bounded admission
  // window is full; the existing UI renders this as a card-local error.
  if (
    !opponentProfileContextInFlight.has(cacheKey) &&
    opponentProfileContextInFlight.size >= OPPONENT_PROFILE_CONTEXT_MAX_IN_FLIGHT
  ) {
    return emptyOpponentProfileContext({
      profileId: normalizedProfileId,
      characterId: normalizedCharacterId,
      characterDisplayName: resolvedCharacterDisplayName,
      status: "error",
    });
  }

  return shareInFlightRequest(
    opponentProfileContextInFlight,
    cacheKey,
    async () => {
      const retrievedAt = Date.now();
      let playComparison = null;
      try {
        const storedSnapshots = snapshotObject(
          resolvedRecord.opponentInsightSnapshots,
        );
        // PLAY comparison is an independent companion source. Start it
        // before profile/history enrichment so a missing opponent profile
        // card does not suppress a comparison that can still be built.
        try {
          playComparison = await fetchPlayComparison({
            selfProfileId: ownerProfileId,
            opponentProfileId: normalizedProfileId,
            generation,
            requestedLocale,
          });
        } catch {
          playComparison = comparePlayProfiles(null, null, {
            verifiedFieldContract: PLAY_APPROVED_FIELD_CONTRACT,
          });
        }
        // A persisted snapshot is authoritative even when it records a
        // definitive insufficiency. Transient network/auth failures are not
        // persisted, so only rows without any snapshot need battle-log I/O.
        const hasPersistedSnapshot = Object.keys(storedSnapshots ?? {}).length > 0;
        // Round trend is always acquired from an explicitly Act-scoped
        // battle-log set. A persisted insight snapshot is not a substitute:
        // it does not prove the selected match's historical Act.
        let officialHistory = null;
        let ownerHistory = null;
        let historyAcquireError = null;
        if (initialTrendContext.ok) {
          try {
            ({ officialHistory, ownerHistory } = await acquireScopedOfficialHistories({
              cache: opponentOfficialHistoryCache,
              ownerProfileId,
              opponentProfileId: normalizedProfileId,
              requestedLocale,
              selectedActId: null,
              requiredReplayId: requestedReplayId,
              selectedRecord: scopedSelectedRecord,
              beforeTimestamp: trendScope.beforeTimestamp,
              actIndependent: true,
              requestScopeProof: actSelectionSource === "latest" &&
                currentActState.currentActVerified === true &&
              currentActState.currentActId === selectedActId
                ? "verified-current-act"
                : null,
              forceRefresh,
              cacheKeyForProfile: opponentOfficialHistoryCacheKey,
              acquireOfficialHistory: (params) => fetchOpponentOfficialHistory(params),
              generation,
              assertGeneration: assertPrivateDataGeneration,
              productionReceipt,
            }));
          } catch (error) {
            historyAcquireError = error;
            recordProductionReceipt(productionReceipt, "context.round-acquire", {
              status: "unavailable",
              requestedAct: selectedActId,
              reason: error?.message === "ACT_SCOPE_MISSING"
                ? "ACT_SCOPE_MISSING"
                : error?.message === "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH"
                  ? "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH"
                  : "HISTORY_SCOPE_INCOMPLETE",
            });
          }
        } else {
          historyAcquireError = new Error(initialTrendContext.reason ?? "ROUND_SCOPE_UNAVAILABLE");
        }
        const data = officialHistory?.data ?? await fetchServiceJson(
          `profile/${encodeURIComponent(normalizedProfileId)}.json`,
          {},
          true,
          "history",
          "interactive",
          requestedLocale,
        );
        const opponentRecords = officialHistory?.records ?? [];
        const ownerRecords = ownerHistory?.records ?? [];
        if (!data) throw new Error("PROFILE_REFERENCE_EMPTY");
        assertPrivateDataGeneration(generation);
        if (requestedLocale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
        const baseContext = normalizeOpponentProfileContext(data, {
          profileId: normalizedProfileId,
          characterId: normalizedCharacterId,
          characterDisplayName: resolvedCharacterDisplayName,
          retrievedAt,
        });
        const scopedAct = selectedActId == null
          ? null
          : {
              id: String(selectedActId),
              label: `ACT ${selectedActId}`,
            };
        let peakProfileData = null;
        if (selectedActId != null) {
          try {
            peakProfileData = await fetchOpponentPeakProfile({
              profileId: normalizedProfileId,
              actId: selectedActId,
              generation,
              requestedLocale,
            });
          } catch {
            // Peak MR is an optional companion request. Keep the already
            // normalized profile context (and its strict dash fallback) when
            // the official peak endpoint is unavailable.
          }
        }
        assertPrivateDataGeneration(generation);
        if (requestedLocale !== serviceLocale()) throw new Error("HISTORY_LOCALE_CHANGED");
        const context = peakProfileData
          ? normalizeOpponentProfileContext(data, {
              profileId: normalizedProfileId,
              characterId: normalizedCharacterId,
              characterDisplayName: resolvedCharacterDisplayName,
              retrievedAt,
              peakProfileData,
              peakActId: selectedActId,
            })
          : baseContext;
        let snapshots = storedSnapshots;
        if (!hasPersistedSnapshot && officialHistory?.complete === true) {
          snapshots = buildHistoricalOpponentSnapshots({
            records: opponentRecords,
            selectedRecord: scopedSelectedRecord,
            historyOwnerProfileId: ownerProfileId,
            opponentUserCode: normalizedProfileId,
            characterId: normalizedCharacterId,
            actId: selectedActId,
            estimatePotentialMrFromMatches,
            potentialRatingValue,
            historyComplete: Boolean(officialHistory?.complete),
            capturedAt: retrievedAt,
          });
          persistOpponentInsightSnapshots(
            ownerProfileId,
            resolvedRecord.replayId,
            snapshots,
          );
        }
        const opponentInsight = opponentInsightFromSnapshots(snapshots);
        const ownerHistoryChanged = ownerHistory?.complete === true
          ? mergeMatchHistory(ownerRecords, ownerProfileId, { notify: false })
          : false;
        const trendContext = initialTrendContext.ok && !historyAcquireError
          ? buildScopedRoundTrendContext({
              selectedRecord: scopedSelectedRecord,
              selectedActId: null,
              actIndependent: true,
              ownerRecords,
              opponentRecords,
              ownerComplete: ownerHistory?.complete === true,
              opponentComplete: officialHistory?.complete === true,
            })
          : null;
        const roundTrend = trendContext?.ok
          ? trendContext.roundTrend
          : buildRoundTrendFailure(
              initialRoundTrend?.scope ?? trendScope,
              {
                status: "unavailable",
                reason: historyAcquireError?.message === "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH"
                  ? "ACT_SCOPE_MISSING"
                  : historyAcquireError?.message ?? "ACT_SCOPE_MISSING",
              },
            );
        const roundStatus = roundTrend?.status === "ready"
          ? "ready"
          : roundTrend?.status === "insufficient_sample"
            ? "insufficient_sample"
            : roundTrend?.status === "unavailable" || roundTrend?.status === "error"
              ? "unavailable"
              : "partial";
        recordProductionReceipt(productionReceipt, "context.round-summary", {
          status: roundStatus,
          targetMatches: Number(roundTrend?.matchedMatches) || 0,
          targetRounds: (Number(roundTrend?.self?.wonRounds) || 0) + (Number(roundTrend?.opponent?.wonRounds) || 0),
          candidateCount: Number(roundTrend?.candidateCount) || 0,
          selectedMatches: Number(roundTrend?.matchCount) || 0,
          cutoffExcluded: Number(roundTrend?.futureExcludedCount) || 0,
          futureExcluded: Number(roundTrend?.futureExcludedCount) || 0,
          roomExcluded: Number(roundTrend?.roomExcludedCount) || 0,
          duplicateExact: Number(roundTrend?.duplicateExactCount) || 0,
          duplicateConflict: Number(roundTrend?.duplicateConflictCount) || 0,
          roundMissing: Number(roundTrend?.missingRoundMatches) || 0,
          parseMissing: Number(roundTrend?.parseMissingCount) || 0,
          limitExcluded: Number(roundTrend?.limitExcludedCount) || 0,
          selfCandidateCount: Number(roundTrend?.diagnostics?.self?.candidateCount) || 0,
          selfSelectedMatches: Number(roundTrend?.diagnostics?.self?.selectedMatches) || 0,
          selfCutoffExcluded: Number(roundTrend?.diagnostics?.self?.futureExcludedCount) || 0,
          selfRoomExcluded: Number(roundTrend?.diagnostics?.self?.roomExcludedCount) || 0,
          selfDuplicateExact: Number(roundTrend?.diagnostics?.self?.duplicateExactCount) || 0,
          selfDuplicateConflict: Number(roundTrend?.diagnostics?.self?.duplicateConflictCount) || 0,
          selfRoundMissing: Number(roundTrend?.diagnostics?.self?.missingRoundMatches) || 0,
          selfParseMissing: Number(roundTrend?.diagnostics?.self?.parseMissingCount) || 0,
          selfLimitExcluded: Number(roundTrend?.diagnostics?.self?.limitExcludedCount) || 0,
          opponentCandidateCount: Number(roundTrend?.diagnostics?.opponent?.candidateCount) || 0,
          opponentSelectedMatches: Number(roundTrend?.diagnostics?.opponent?.selectedMatches) || 0,
          opponentCutoffExcluded: Number(roundTrend?.diagnostics?.opponent?.futureExcludedCount) || 0,
          opponentRoomExcluded: Number(roundTrend?.diagnostics?.opponent?.roomExcludedCount) || 0,
          opponentDuplicateExact: Number(roundTrend?.diagnostics?.opponent?.duplicateExactCount) || 0,
          opponentDuplicateConflict: Number(roundTrend?.diagnostics?.opponent?.duplicateConflictCount) || 0,
          opponentRoundMissing: Number(roundTrend?.diagnostics?.opponent?.missingRoundMatches) || 0,
          opponentParseMissing: Number(roundTrend?.diagnostics?.opponent?.parseMissingCount) || 0,
          opponentLimitExcluded: Number(roundTrend?.diagnostics?.opponent?.limitExcludedCount) || 0,
          cutoffTimestamp: Number(roundTrend?.scope?.cutoff) || 0,
          selfStopReason: ownerHistory?.stopReason ?? null,
          opponentStopReason: officialHistory?.stopReason ?? null,
          selfCandidateMinTimestamp: Number(roundTrend?.diagnostics?.self?.candidateTimestampMin) || 0,
          selfCandidateMaxTimestamp: Number(roundTrend?.diagnostics?.self?.candidateTimestampMax) || 0,
          selfBeforeCutoff: Number(roundTrend?.diagnostics?.self?.beforeCutoffCount) || 0,
          selfAfterCutoff: Number(roundTrend?.diagnostics?.self?.futureExcludedCount) || 0,
          opponentCandidateMinTimestamp: Number(roundTrend?.diagnostics?.opponent?.candidateTimestampMin) || 0,
          opponentCandidateMaxTimestamp: Number(roundTrend?.diagnostics?.opponent?.candidateTimestampMax) || 0,
          opponentBeforeCutoff: Number(roundTrend?.diagnostics?.opponent?.beforeCutoffCount) || 0,
          opponentAfterCutoff: Number(roundTrend?.diagnostics?.opponent?.futureExcludedCount) || 0,
          requiredPayload: roundStatus === "ready"
            ? "owner-opponent-round-trend"
            : roundStatus === "insufficient_sample"
              ? "owner-opponent-round-trend-insufficient-sample"
              : "round-trend-incomplete",
          reason: roundStatus === "ready" ? undefined : roundTrend?.reason,
        });
        finalizeProductionReceipt(productionReceipt, {
          status: roundStatus,
          reason: roundStatus === "ready"
            ? "OWNER_OPPONENT_ROUNDS_VERIFIED"
            : roundStatus === "insufficient_sample"
              ? "OWNER_OR_OPPONENT_ROUNDS_INSUFFICIENT_SAMPLE"
              : "OWNER_OPPONENT_ROUNDS_INCOMPLETE",
        });
        const enrichedContext = {
          ...context,
          // The profile PLAY payload is a current-profile companion and may
          // expose a different or legacy Act marker. The selected history
          // scope was verified above and is authoritative for this card.
          act: scopedAct,
          locale: requestedLocale,
          characterNamesByLocale: {
            [requestedLocale]: {
              ...(Number(context?.targetCharacter?.characterId) > 0 && String(context?.targetCharacter?.characterDisplayName ?? "").trim()
                ? { [Number(context.targetCharacter.characterId)]: String(context.targetCharacter.characterDisplayName).trim() }
                : {}),
              ...(Number(context?.otherCharacter?.characterId) > 0 && String(context?.otherCharacter?.characterDisplayName ?? "").trim()
                ? { [Number(context.otherCharacter.characterId)]: String(context.otherCharacter.characterDisplayName).trim() }
                : {}),
            },
          },
          opponentInsight,
          playComparison,
          roundTrend,
          diagnostics: historyScopeDiagnostics({
            currentActState,
            selectorRaw,
            resolvedActId: requestedActId,
            ipcActId: requestedActId,
            requestActId: selectedActId,
            ownerHistory,
            opponentHistory: officialHistory,
            finalScopeReason: roundStatus === "ready" ? null : roundTrend?.reason,
            productionReceipt,
          }),
        };
        setBoundedCacheEntry(
          opponentProfileContextCache,
          cacheKey,
          { fetchedAt: retrievedAt, context: enrichedContext },
          OPPONENT_PROFILE_CONTEXT_MAX_CACHE_ENTRIES,
        );
        if (ownerHistoryChanged) sendHistoryState();
        return enrichedContext;
      } catch (error) {
        if (error?.message === "PRIVATE_DATA_CLEARED") throw error;
        // A profile-reference failure must never replace the already-rendered
        // match history. The renderer receives a card-local error state.
        const failureReason = opponentProfileFailureReason(error);
        const failureStatus = failureReason === "PRIVATE_DATA_CLEARED"
          ? "error"
          : [
              "ACT_SCOPE_MISSING",
              "HISTORY_SCOPE_INCOMPLETE",
              "HISTORY_DUPLICATE_CONFLICT",
              "HISTORY_SELECTED_REPLAY_MISSING",
            ].includes(failureReason)
            ? "partial"
            : "error";
        const context = emptyOpponentProfileContext({
          profileId: normalizedProfileId,
          characterId: normalizedCharacterId,
          characterDisplayName: resolvedCharacterDisplayName,
          actId: selectedActId,
          status: failureStatus,
          reason: failureReason,
          roundTrend: buildRoundTrendFailure(trendScope, {
            status: failureStatus,
            reason: failureReason,
          }),
          playComparison,
          diagnostics: historyScopeDiagnostics({
            currentActState,
            selectorRaw,
            resolvedActId: requestedActId,
            ipcActId: requestedActId,
            requestActId: selectedActId,
            ownerHistory: opponentOfficialHistoryCache.get(
              opponentOfficialHistoryCacheKey(ownerProfileId, requestedLocale, selectedActId),
            )?.history ?? null,
            opponentHistory: opponentOfficialHistoryCache.get(
              opponentOfficialHistoryCacheKey(normalizedProfileId, requestedLocale, selectedActId),
            )?.history ?? null,
            finalScopeReason: failureReason,
            productionReceipt,
          }),
        });
        finalizeProductionReceipt(productionReceipt, {
          status: failureStatus === "error" ? "unavailable" : "partial",
          reason: failureReason,
        });
        // Network/auth failures are transient. Do not persist/cache this
        // card-local error as a historical insufficiency; the next row click
        // must be allowed to retry acquisition.
        return context;
      }
    },
  );
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
  const request = (async () => {
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
      const backfillProfileIds = new Set(
        [nextTrackerPlayer, nextHistoryPlayer, nextAuthenticatedPlayer]
          .map((player) => normalizeHistoryProfileId(player?.profileId))
          .filter(Boolean),
      );
      for (const profileId of backfillProfileIds) {
        try {
          await backfillHistoryCharacterLabelsForLocale(
            profileId,
            requestedLocale,
            privateDataGeneration,
          );
        } catch {
          // Locale refresh remains successful when optional label backfill is
          // unavailable; existing records stay intact and render an
          // unavailable marker until the selected-locale backfill completes.
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
    if (localeRefreshInFlight === request) localeRefreshInFlight = null;
  });
  localeRefreshInFlight = request;
  return request;
}

async function fetchRankedReplaysPage(
  profileId,
  page = 1,
  priority = "live",
  requestScope = null,
  localeOverride = null,
  requestedActId = null,
  productionReceipt = null,
  productionStage = "history.battlelog",
) {
  const requestedLocale = LOCALE_KEYS.has(String(localeOverride))
    ? String(localeOverride)
    : serviceLocale();
  const data = await fetchServiceJson(
    `profile/${encodeURIComponent(profileId)}/battlelog.json`,
    {
      page,
      ...(Number.isInteger(Number(requestedActId)) && Number(requestedActId) >= 0
        ? { season_id: Number(requestedActId) }
        : {}),
    },
    true,
    requestScope,
    priority,
    requestedLocale,
    productionReceipt,
    productionStage,
  );
  const rawReplays = Array.isArray(data?.pageProps?.replay_list)
    ? data.pageProps.replay_list
    : [];
  const hasReplayList = Array.isArray(data?.pageProps?.replay_list);
  const pageProps = data?.pageProps ?? {};
  const totalPages = Number(pageProps.total_page);
  const responsePageValue = pageProps.page ?? pageProps.current_page;
  const responsePage = Number(responsePageValue);
  const responseActId = readHistoryActProvenance(pageProps, [
    "season_id",
    "seasonId",
    "act_id",
    "actId",
  ]).actId;
  const requestedAct = normalizeHistoryActId(requestedActId);
  const normalizedReplays = rawReplays
    .map((replay) => normalizeReplay(replay, profileId, requestedLocale))
    .filter(Boolean);
  const recordActIds = normalizedRecordActIds(normalizedReplays);
  const actScopeVerified = requestedAct != null &&
    (responseActId === requestedAct || recordActIds.length === 1 && recordActIds[0] === requestedAct) &&
    (responseActId == null || responseActId === requestedAct) &&
    recordActIds.every((value) => value === requestedAct);
  const stamped = actScopeVerified
    ? stampScopedHistoryRecords(normalizedReplays, requestedAct).records
    : normalizedReplays;
  return {
    rawCount: rawReplays.length,
    normalizedCount: normalizedReplays.length,
    hasReplayList,
    totalPages: Number.isInteger(totalPages) && totalPages > 0 ? totalPages : null,
    responsePage: Number.isInteger(responsePage) && responsePage > 0 ? responsePage : null,
    requestedActId: requestedAct,
    responseActId,
    recordActId: recordActIds.length === 1 ? recordActIds[0] : null,
    recordActIds,
    actScopeVerified,
    actScopeReason: requestedAct == null
      ? "ACT_SCOPE_MISSING"
      : actScopeVerified
        ? null
        : "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH",
    replays: stamped,
  };
}

async function fetchRankedReplays(profileId) {
  return (await fetchRankedReplaysPage(profileId, 1)).replays;
}

async function fetchMatchHistoryPages(
  profileId,
  onPage = null,
  localeOverride = null,
  shareKey = null,
  requestedActId = null,
) {
  return fetchHistoryPagesConcurrently(
    (page) => fetchRankedReplaysPage(
      profileId,
      page,
      "history",
      "history",
      localeOverride,
      requestedActId,
    ),
    {
      maxPages: MATCH_HISTORY_MAX_PAGES,
      pageSize: MATCH_HISTORY_PAGE_SIZE,
      concurrency: MATCH_HISTORY_FETCH_CONCURRENCY,
      onPage,
      shareKey,
    },
  );
}

async function fetchLocalMatchHistory({ requestedActId = null } = {}) {
  ensureUpdateAllowed();
  const normalizedRequestedActId = normalizeHistoryActId(requestedActId);
  const requestedProfileId = activeHistoryProfileId();
  if (matchHistoryFetchInFlight) {
    if (
      matchHistoryFetchProfileId === requestedProfileId &&
      matchHistoryFetchScopeAtStart === matchHistoryFetchScopeToken &&
      matchHistoryFetchActId === normalizedRequestedActId
    ) return matchHistoryFetchInFlight;
    const previousRequest = matchHistoryFetchInFlight;
    await previousRequest.catch(() => {});
    return fetchLocalMatchHistory({ requestedActId: normalizedRequestedActId });
  }
  const generation = privateDataGeneration;
  const requestedLocale = serviceLocale();
  const now = Date.now();
  const profileId = requestedProfileId;
  const fetchScopeToken = matchHistoryFetchScopeToken;
  const store = loadMatchHistoryStore(profileId);
  const retryAfterMs = store.lastFetchedAt
    ? store.lastFetchedAt + MATCH_HISTORY_FETCH_COOLDOWN_MS - now
    : 0;
  if (retryAfterMs > 0) {
    const error = new Error("HISTORY_COOLDOWN");
    error.retryAfterMs = retryAfterMs;
    throw error;
  }

  let publishHistoryState = true;
  const request = (async () => {
    let fetchedCount = 0;
    let completedPages = 0;
    let pagesWithData = 0;
    let newReplayCount = 0;
    let summaryProfileId = profileId;
    let fetchTerminalStateSent = false;
    let completedReplays = [];
    let importMerged = false;
    try {
      let player = historyViewPlayer ?? authenticatedPlayer ?? (await checkAuthentication()).player;
      assertPrivateDataGeneration(generation);
      if (!player?.profileId) throw new Error("SERVICE_SELF_NOT_FOUND");
      assertHistoryFetchScope(player.profileId, fetchScopeToken);
      summaryProfileId = player.profileId;
      // Manual imports use the bounded history page pool. Live tracking
      // continues to use one page per poll, so enabling history does not
      // multiply polling traffic.
      const existing = loadMatchHistoryStore(player.profileId);
      const previousReplayIds = new Set(
        existing.records.map((record) => record.replayId),
      );
      matchHistoryFetchSummary = null;
      matchHistoryFetchProgress = {
        profileId: player.profileId,
        page: 0,
        completedPages: 0,
        maxPages: MATCH_HISTORY_MAX_PAGES,
        fetchedCount: 0,
      };
      sendHistoryState();
      const orderedReplays = await fetchMatchHistoryPages(
        player.profileId,
        async ({ rawCount, completedPages: completedPageCount, replays }) => {
          assertPrivateDataGeneration(generation);
          assertHistoryFetchScope(player.profileId, fetchScopeToken);
          if (serviceLocale() !== requestedLocale) {
            throw new Error("HISTORY_LOCALE_CHANGED");
          }
          fetchedCount += replays.length;
          completedPages = Math.max(completedPages, Number(completedPageCount) || 0);
          if (Number(rawCount) > 0) pagesWithData += 1;
          for (const replay of replays) {
            if (replay.replayId && !previousReplayIds.has(replay.replayId)) {
              previousReplayIds.add(replay.replayId);
              newReplayCount += 1;
            }
          }
          matchHistoryFetchProgress = {
            profileId: player.profileId,
            // Requests complete out of order; expose the number of completed
            // pages rather than the highest page number.
            page: completedPages,
            completedPages,
            maxPages: MATCH_HISTORY_MAX_PAGES,
            fetchedCount,
          };
          // Keep pages in memory until every request has settled so the final
          // import is independent of completion order; partial results are
          // merged only in the error path.
          completedReplays.push(...replays);
          sendHistoryFetchProgress();
        },
        requestedLocale,
        `history:${normalizeHistoryProfileId(player.profileId)}:${requestedLocale}:${generation}:${fetchScopeToken}:${normalizedRequestedActId ?? "latest"}`,
        normalizedRequestedActId,
      );
      const importReplays = Array.isArray(orderedReplays) && orderedReplays.length
        ? orderedReplays
        : completedReplays;
      assertPrivateDataGeneration(generation);
      assertHistoryFetchScope(player.profileId, fetchScopeToken);
      if (serviceLocale() !== requestedLocale) {
        throw new Error("HISTORY_LOCALE_CHANGED");
      }
      if (newReplayCount > 0) {
        publishHistoryState = false;
        const nextPlayer = await refreshProfilePlayer(player, {
          force: true,
          priority: "live",
        });
        assertPrivateDataGeneration(generation);
        assertHistoryFetchScope(player.profileId, fetchScopeToken);
        if (!historyProfileCoversLatestRecord(nextPlayer, [...existing.records, ...importReplays])) {
          throw new Error("PROFILE_REFRESH_NOT_CONFIRMED");
        }
        player = nextPlayer;
      }
      // Treat the profile refresh as part of committing a new-history batch.
      // Until it succeeds, neither the rows nor a complete status are public.
      assertHistoryFetchScope(player.profileId, fetchScopeToken);
      mergeMatchHistory(importReplays, player.profileId, { persist: false, notify: false });
      importMerged = true;
      assertPrivateDataGeneration(generation);
      if (serviceLocale() !== requestedLocale) {
        throw new Error("HISTORY_LOCALE_CHANGED");
      }
      const fetchedStore = loadMatchHistoryStore(player.profileId);
      fetchedStore.lastFetchedAt = Date.now();
      persistMatchHistoryStore(player.profileId, fetchedStore);
      if (newReplayCount > 0) {
        if (historyViewPlayer?.profileId === player.profileId) historyViewPlayer = player;
        if (authenticatedPlayer?.profileId === player.profileId) authenticatedPlayer = player;
        if (trackerState.player?.profileId === player.profileId) trackerState.player = player;
      }
      matchHistoryFetchSummary = {
        profileId: player.profileId,
        status: "complete",
        completedPages,
        pages: pagesWithData,
        maxPages: MATCH_HISTORY_MAX_PAGES,
        fetchedCount,
        completedAt: Date.now(),
      };
      matchHistoryFetchProgress = null;
      fetchTerminalStateSent = true;
      if (newReplayCount > 0) publishHistoryState = true;
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
      sendTrackerState();
      await Promise.allSettled([
        persistedDataWriter.flush(historyStorePath(player.profileId)),
        persistedDataWriter.flush(trackerSessionPath),
      ]);
      return publicHistoryState(player.profileId);
    } catch (error) {
      // Keep any pages that completed before the failure available after a
      // restart as well as in the current in-memory view. Private-data
      // clearing is the one boundary where no partial write is allowed.
      if (
        !privateDataClearing &&
        historyFetchScopeIsCurrent(summaryProfileId, fetchScopeToken) &&
        completedPages > 0 &&
        error?.message !== "PRIVATE_DATA_CLEARED" &&
        summaryProfileId
      ) {
        if (!importMerged && newReplayCount === 0 && completedReplays.length) {
          mergeMatchHistory(completedReplays, summaryProfileId, {
            persist: false,
            notify: false,
          });
          importMerged = true;
        }
        persistMatchHistoryStore(summaryProfileId);
        await persistedDataWriter
          .flush(historyStorePath(summaryProfileId))
          .catch(() => {});
      }
      if (
        !fetchTerminalStateSent &&
        !["PRIVATE_DATA_CLEARED", "HISTORY_LOCALE_CHANGED", "HISTORY_TARGET_CHANGED"].includes(error?.message) &&
        summaryProfileId
      ) {
        matchHistoryFetchSummary = {
          profileId: summaryProfileId,
          status: "error",
          completedPages,
          pages: pagesWithData,
          maxPages: MATCH_HISTORY_MAX_PAGES,
          fetchedCount,
          completedAt: Date.now(),
        };
        if (newReplayCount > 0) publishHistoryState = true;
      }
      throw error;
    }
  })();
  matchHistoryFetchInFlight = request;
  matchHistoryFetchProfileId = profileId;
  matchHistoryFetchLocale = requestedLocale;
  matchHistoryFetchScopeAtStart = fetchScopeToken;
  matchHistoryFetchActId = normalizedRequestedActId;
  try {
    return await request;
  } finally {
    if (matchHistoryFetchInFlight === request) {
      matchHistoryFetchInFlight = null;
      matchHistoryFetchProfileId = null;
      matchHistoryFetchLocale = null;
      matchHistoryFetchScopeAtStart = null;
      matchHistoryFetchActId = null;
      matchHistoryFetchProgress = null;
      // A superseded fetch may finish after the selected target has already
      // changed. Its finally block must not publish the new target's empty
      // store over a committed result or clear the progress of the replacement
      // request. The replacement request publishes its own terminal state.
      if (publishHistoryState && historyFetchScopeIsCurrent(profileId, fetchScopeToken)) {
        sendHistoryState();
      }
    }
  }
}

async function selectHistoryProfile(userCode) {
  ensureUpdateAllowed();
  const generation = privateDataGeneration;
  invalidateVerifiedHistoryCurrentAct();
  const normalizedCode = normalizeHistoryProfileId(userCode);
  if (!normalizedCode) throw new Error("INVALID_USER_CODE");
  matchHistoryFetchScopeToken += 1;
  const selectionScopeToken = matchHistoryFetchScopeToken;
  matchHistoryFetchProgress = null;
  matchHistoryFetchSummary = null;
  const ownPlayer =
    authenticatedPlayer ?? trackerState.player ?? (await checkAuthentication()).player;
  assertPrivateDataGeneration(generation);
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
      assertPrivateDataGeneration(generation);
      historyProfileLookupCache.set(cacheKey, {
        fetchedAt: Date.now(),
        player,
      });
      nextHistoryViewPlayer = player;
    }
    // Reuse the locale/profile/character-scoped 90-second profile cache when
    // the same target is selected repeatedly. New ranked matches, character
    // changes, and locale changes still use their force-refresh paths.
    nextHistoryViewPlayer = await refreshProfilePlayer(nextHistoryViewPlayer);
    assertPrivateDataGeneration(generation);
  }
  assertPrivateDataGeneration(generation);
  stopHistoryViewPolling();
  matchHistoryFetchSummary = null;
  historyViewPlayer = nextHistoryViewPlayer;
  const selectedProfileId = normalizeHistoryProfileId(
    historyViewPlayer?.profileId ?? ownPlayer.profileId,
  );
  let localeBackfillProfileId = null;
  let localeBackfillLocale = null;
  if (selectedProfileId) {
    const selectedStore = loadMatchHistoryStore(selectedProfileId);
    if (trimMatchHistoryStore(selectedProfileId, selectedStore)) {
      bumpHistoryRevision(selectedProfileId);
      persistMatchHistoryStore(selectedProfileId, selectedStore);
    }
    // Locale label backfill can require the full bounded history page pool.
    // Do not make the target-selection response wait for that optional
    // enrichment; publish the local history first and refresh it when the
    // same target/locale is still active.
    localeBackfillProfileId = selectedProfileId;
    localeBackfillLocale = serviceLocale();
    if (historyViewPlayer) startHistoryViewPolling();
  }
  sendHistoryState();
  if (localeBackfillProfileId && localeBackfillLocale) {
    void scheduleHistoryBackfill({
      backfill: () => backfillHistoryCharacterLabelsForLocale(
        localeBackfillProfileId,
        localeBackfillLocale,
        generation,
        selectionScopeToken,
      ),
      isCurrent: () => (
        generation === privateDataGeneration &&
        activeHistoryProfileId() === localeBackfillProfileId &&
        serviceLocale() === localeBackfillLocale &&
        matchHistoryFetchScopeToken === selectionScopeToken
      ),
      publish: sendHistoryState,
    });
  }
  sendTrackerState();
  return {
    player: historyViewPlayer ?? ownPlayer,
    history: publicHistoryState(),
  };
}

async function clearHistoryProfileSelection() {
  ensureUpdateAllowed();
  invalidateVerifiedHistoryCurrentAct();
  matchHistoryFetchScopeToken += 1;
  matchHistoryFetchProgress = null;
  matchHistoryFetchSummary = null;
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
    ["idle", "manual", "restart"].includes(trackerState.stopReason) &&
    trackerState.player?.profileId === player.profileId &&
    hasRetainedTrackerSession(trackerState);
  const sessionId = ++trackingSessionId;
  stopPolling();
  const replays = await fetchRankedReplays(player.profileId);
  if (sessionId !== trackingSessionId) return publicTrackerState();
  const latestReplayTimestamp = replays
    .filter(
      (replay) =>
        replay.matchType === "ranked" &&
        Number(replay.characterId) === Number(player.characterId),
    )
    .map((replay) => Number(replay.playedAt ?? replay.uploadedAt) || 0)
    .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);
  if (
    latestReplayTimestamp > 0 &&
    Number(player.profileUpdatedAt) < latestReplayTimestamp
  ) {
    player = await refreshProfilePlayer(player, { force: true, priority: "live" });
    if (sessionId !== trackingSessionId) return publicTrackerState();
  }
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
    sessionAchievementState = createSessionAchievementState();
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

  await refreshCurrentRanking({
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
    const state = await startTrackingInFlight;
    recordSocialActivity();
    return state;
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
        "60分間対戦がなかったため、自動停止しました",
      );
      return;
    }
    schedulePolling();
  } catch (error) {
    if (!trackerState.active || sessionId !== trackingSessionId) return;
    trackerState.updatedAt = Date.now();
    trackerState.consecutiveFailures += 1;
    if (error instanceof Error && error.message === "SERVICE_AUTH_REQUIRED") {
      invalidateAuthenticationState();
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
        "通信エラーが続いたため、自動停止しました",
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
      priority: "live",
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
    currentRating: trackerState.player?.mr ?? trackerState.player?.lp ?? null,
  })) {
    await refreshCurrentRanking({
      player: trackerState.player,
      characterId: trackerState.characterId,
    }).catch(() => {});
  } else if (
    Number(trackerState.player?.mr) <= 0 &&
    Number(trackerState.player?.lp) <= 0
  ) {
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
  clearAllRankingRetryTimers();
  trackingSessionId += 1;
  trackerState.active = false;
  trackerState.stopReason = reason;
  trackerState.status = status;
  trackerState.updatedAt = Date.now();
  sendTrackerState();
  scheduleSocialIdleSuspend();
  return publicTrackerState();
}

function stopTracking({ discard = false } = {}) {
  stopPolling();
  clearAllRankingRetryTimers();
  trackingSessionId += 1;
  if (discard || !hasRetainedTrackerSession(trackerState)) {
    trackerState = createEmptyTrackerState();
    sessionAchievementState = createSessionAchievementState();
  } else {
    trackerState.active = false;
    trackerState.stopReason = "manual";
    trackerState.status = "停止中";
    trackerState.updatedAt = Date.now();
  }
  sendTrackerState();
  scheduleSocialIdleSuspend();
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
  if (!hasRetainedTrackerSession(trackerState)) {
    return publicTrackerState();
  }
  const stats = createEmptyMatchStats();
  stats.ranked.initialRating = trackerState.currentRating;
  stats.ranked.currentRating = trackerState.currentRating;
  stats.ranked.ratingHistory =
    trackerState.currentRating == null ? [] : [trackerState.currentRating];
  const resetAt = Date.now();
  sessionAchievementState = createSessionAchievementState();
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
    stopReason: trackerState.active ? null : "reset",
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
    UPDATE_REQUIRED: "更新が必要なため、更新後に利用できます",
  };
  if (messages[code]) return messages[code];
  if (code.startsWith("SERVICE_HTTP_")) {
    return "対象サイトとの通信に失敗しました";
  }
  return "処理に失敗しました";
}

function ensureUpdateAllowed() {
  assertUpdateAllowed(updateRequired);
}

function resultHandler(handler, { allowDuringUpdate = false } = {}) {
  return async (_event, payload) => {
    try {
      assertUpdateAllowed(updateRequired, allowDuringUpdate);
      return { ok: true, data: await handler(payload ?? {}) };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  };
}

function registerIpcHandlers() {
  ipcMain.on("ui:management-ready", (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (event.sender !== mainWindow.webContents) return;
    managementUiReady = true;
    finishStartupPresentation();
  });
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
    "history:opponent-character-stats",
    resultHandler((payload = {}) => {
      if (qaDiskHistoryHarness) {
        return {
          status: "unavailable",
          source: "qa-disk-history",
          profileId: qaDiskHistoryHarness.profileId,
          locale: serviceLocale(),
          act: qaDiskHistoryHarness.actId,
          rows: [],
          reason: "QA_DISK_HISTORY_STATS_NOT_LOADED",
          retryable: false,
          selectedOwnCharacterId: payload.selectedOwnCharacterId ?? null,
        };
      }
      return fetchOfficialOpponentCharacterStats(payload);
    }),
  );
  ipcMain.handle(
    "history:character-names",
    resultHandler((payload = {}) => {
      const qaResult = qaDiskHistoryCharacterNames(payload);
      if (qaResult) return qaResult;
      return fetchOfficialCharacterNameRegistry({
        profileId: payload.profileId,
        requestedLocale: payload.locale,
        actId: payload.actId,
        generation: privateDataGeneration,
      });
    }),
  );
  ipcMain.handle(
    "history:fetch",
    resultHandler((payload = {}) => fetchLocalMatchHistory({ requestedActId: payload?.actId })),
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
    "history:opponent-context",
    resultHandler((payload) => fetchHistoryOpponentContext(payload)),
  );
  ipcMain.handle(
    "social:state",
    resultHandler(async () => publicSocialState(), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "social:refresh",
    resultHandler(({ kind }) => manualRefreshSocial(kind)),
  );
  ipcMain.handle(
    "social:activity",
    resultHandler(() => recordSocialActivity()),
  );
  ipcMain.handle(
    "social:page",
    resultHandler(({ kind, page }) => changeSocialPage(kind, page)),
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
    "system:notification-sound-preview",
    resultHandler(
      async ({ soundId }) => ({ played: await playFriendNotificationSound(soundId) }),
      { allowDuringUpdate: true },
    ),
  );
  ipcMain.handle(
    "friend-notification:preview",
    resultHandler(async () => previewFriendOnlineNotification(), { allowDuringUpdate: true }),
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
    resultHandler(async () => ({
      ...await updater.check(),
      required: updateRequired,
    }), { allowDuringUpdate: true }),
  );
  ipcMain.handle(
    "update:state",
    resultHandler(async () => ({
      ...updater.getState(),
      required: updateRequired,
    }), { allowDuringUpdate: true }),
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
      "/stats-midnight-glass.css": ["stats-midnight-glass.css", "text/css; charset=utf-8"],
      "/stats.js": ["stats.js", "text/javascript; charset=utf-8"],
      "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
      "/display-number-format.js": ["../display-number-format.js", "text/javascript; charset=utf-8"],
      "/assets/stats-frame-horizontal.png": [
        path.join("assets", "stats-frame-horizontal.png"),
        "image/png",
      ],
      "/assets/stats-frame-vertical.png": [
        path.join("assets", "stats-frame-vertical.png"),
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

if (process.env.MATCH_OVERLAY_TEST_MODE !== "1") {
void app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  if (initialLanguageSelectionRequired) {
    displaySettings.locale = suggestedInitialLocale(app.getLocale());
  }
  sourceSession = session.fromPartition(LOGIN_PARTITION);
  configureRemoteSession(sourceSession);
  updater = createUpdater({
    onState: (state) => {
      const { required: requiredNow, becameRequired } =
        resolveUpdateRequirement(updateRequired, state);
      updateRequired = requiredNow;
      if (becameRequired) {
        stopTracking();
        stopHistoryViewPolling("update");
        stopSocialRefresh();
        serviceRequestScheduler.cancel({ reason: "Update is required." });
        for (const controller of serviceAbortControllers) controller.abort();
        serviceAbortControllers.clear();
        dismissFriendNotification({ destroy: false });
        dismissFriendNotificationPreview({ destroy: false });
        clearInterval(gameMonitorTimer);
        gameMonitorTimer = null;
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
        mainWindow.webContents.send("update:state", {
          ...state,
          required: updateRequired,
        });
      }
    },
  });
  powerMonitor.on("lock-screen", () => suspendSocialRefresh("system"));
  powerMonitor.on("suspend", () => suspendSocialRefresh("system"));
  powerMonitor.on("unlock-screen", () => recordSocialActivity());
  powerMonitor.on("resume", () => recordSocialActivity());
  registerIpcHandlers();
  startOverlayServer();
  createTray();
  createSplashWindow();
  initializeQaDiskHistoryHarness();
  createMainWindow();
  configureLaunchAtLogin();
  configureGameDetection();
  void prewarmFriendNotificationPreviewWindow().catch(() => {});
  if (displaySettings.friendOnlineNotificationsEnabled) {
    prewarmFriendNotificationWindow();
  }

  if (app.isPackaged) {
    startupUpdateTimer = setTimeout(() => {
      startupUpdateTimer = null;
      updater.check().catch(() => {});
    }, 750);
  }
}).catch(() => {
  if (qaDiskHistoryHarness) {
    process.stderr.write("QA_DISK_HISTORY_STARTUP_FAILED\n");
  }
  app.quit();
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

app.on("before-quit", (event) => {
  isQuitting = true;
  updater?.cancel?.();
  clearTimeout(startupUpdateTimer);
  startupUpdateTimer = null;
  clearTimeout(splashCloseTimer);
  splashCloseTimer = null;
  stopPolling();
  persistTrackerSession();
  stopHistoryViewPolling();
  stopSocialRefresh();
  stopSocialIdleSuspendTimer();
  clearAllRankingRetryTimers();
  dismissFriendNotification({ destroy: true });
  dismissFriendNotificationPreview({ destroy: true });
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
  if (overlayServer) {
    overlayServer.close();
    overlayServer = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (!persistenceReadyForQuit) {
    event.preventDefault();
    return persistedDataWriter
      .flushAll()
      .catch(() => {
        // A final save failure must not trap the user in the application.
      })
      .finally(() => {
        persistenceReadyForQuit = true;
        app.quit();
      });
  }
});
}

// Available only to the external local QA harness. Normal and packaged
// launches never enter this branch or expose these test hooks.
if (process.env.MATCH_OVERLAY_TEST_MODE === "1") {
  module.exports = {
    __testFetchOfficialCharacterNameRegistry: fetchOfficialCharacterNameRegistry,
    __testInvalidateVerifiedHistoryCurrentAct: invalidateVerifiedHistoryCurrentAct,
    __testPublicHistoryState: publicHistoryState,
    __testConfigureOpponentContext({
      ownerProfileId,
      currentActId = 13,
      records = [],
      fetch = null,
    } = {}) {
      const profileId = normalizeHistoryProfileId(ownerProfileId);
      historyViewPlayer = { profileId, userCode: profileId, characterId: 1 };
      authenticatedProfileId = profileId;
      matchHistoryStores.set(profileId, normalizeMatchHistoryStore({ records }));
      verifiedHistoryCurrentAct = {
        profileId,
        locale: serviceLocale(),
        generation: privateDataGeneration,
        scopeToken: verifiedHistoryCurrentActScope,
        status: "ready",
        actId: currentActId,
        source: "qa-test",
        reason: null,
      };
      sourceSession = fetch ? { fetch } : null;
      return { profileId, currentActId };
    },
    fetchHistoryOpponentContext,
  };
}
