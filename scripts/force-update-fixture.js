"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { createUpdater, validateManifest } = require("../src/updater");

const root = path.resolve(__dirname, "..");
const requestedOutput = process.argv.slice(2).find((argument) => argument !== "--");
const outputPath = path.resolve(requestedOutput || path.join(root, "force-update-qa.png"));
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "mso-force-update-fixture-"));
app.setPath("userData", temporaryUserData);
app.on("quit", () => {
  try { fs.rmSync(temporaryUserData, { recursive: true, force: true }); } catch { /* Electron may still hold a cache file briefly. */ }
});

const settings = {
  locale: "ja-jp", mode: "window", windowOrientation: "horizontal", matchType: "ranked",
  displayItems: { record: true, winRate: true, currentRating: true, ratingDelta: true,
    potentialRating: true, sessionPeak: true, mrRank: true, graph: true },
  fontScale: 1, graphLabelScale: 1.1, graphMatchCount: 20, backgroundOpacity: 0.96,
  potentialLineVisible: true, fontFamily: "street", fontStyle: "normal", textColor: "#f7f8ff",
  pollIntervalSeconds: 120, friendOnlineNotificationsEnabled: false,
  friendOnlineNotificationTiming: "game", friendOnlineNotificationSound: "none",
  friendOnlineNotificationSoundOptions: [], friendOnlineNotificationVolume: 1,
  friendOnlineNotificationDurationSeconds: 5, friendOnlineNotificationBackgroundOpacity: 0.94,
  launchAtLogin: false, autoDetectGame: false, gameExecutableName: "",
  overlayInteractionLocked: true, statsWindowVisible: false, rankingHome: "all",
  rankingHomeOptions: { all: { value: "all", label: "すべて" }, regions: [], countries: [] },
};
const tracker = {
  active: false, player: null, wins: 0, losses: 0, currentRating: null,
  ratingType: "MR", ratingDelta: 0,
  stats: { ranked: { wins: 0, losses: 0, ratingDelta: 0 }, battleHub: {}, casual: {} },
  graphData: { ranked: [], battleHub: [], casual: [] }, presentation: {},
  ranking: { status: "idle", rank: null }, status: "停止中",
  overlayUrl: "http://127.0.0.1:17891/overlay",
};
const history = { records: [], authenticated: false, canFetch: false, fetching: false,
  viewingOther: false, player: null };
const social = {
  friends: { status: "idle", page: 1, totalPages: 1, players: [] },
  following: { status: "idle", page: 1, totalPages: 1, players: [] },
};
const ok = (data) => ({ ok: true, data });

app.whenReady().then(async () => {
  const manifest = {
    ...validateManifest({
      version: "1.3.1",
      file: "Match-Session-Overlay-1.3.1-Setup.exe",
      sha256: "A".repeat(64),
      force: true,
      minimumVersion: "1.3.0",
    }),
    installerUrl:
      "https://github.com/mickangumi-oss/match-session-overlay/releases/download/v1.3.1/Match-Session-Overlay-1.3.1-Setup.exe",
    source: "github",
  };
  const updater = createUpdater({
    appAdapter: {
      getVersion: () => "1.3.0",
      getPath: () => temporaryUserData,
      isPackaged: false,
      quit: () => {},
    },
    fetchManifest: async () => manifest,
    onState: () => {},
  });
  const updateState = await updater.check();
  const handlers = {
    "tracker:state": tracker,
    "history:state": history,
    "social:state": social,
    "update:state": updateState,
    "display:settings": settings,
    "system:fonts": [],
  };
  for (const [channel, data] of Object.entries(handlers)) {
    ipcMain.handle(channel, async () => ok(data));
  }
  ipcMain.handle("update:check", async () => ok(updateState));
  ipcMain.handle("update:install", async () => ({ ok: false, error: "QAでは更新を開始しません" }));

  const window = new BrowserWindow({
    width: 1180, height: 900, show: false, backgroundColor: "#050b12",
    webPreferences: { preload: path.join(root, "src", "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  await window.loadFile(path.join(root, "src", "renderer", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  window.destroy();
  updater.cancel();
  app.quit();
});
