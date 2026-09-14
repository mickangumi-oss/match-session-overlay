"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("matchOverlay", {
  openLogin: () => ipcRenderer.invoke("auth:open-login"),
  checkLogin: () => ipcRenderer.invoke("auth:check"),
  clearPrivateData: () => ipcRenderer.invoke("privacy:clear"),
  startTracking: (player) =>
    ipcRenderer.invoke("tracker:start", { player }),
  stopTracking: () => ipcRenderer.invoke("tracker:stop"),
  resetTracking: () => ipcRenderer.invoke("tracker:reset"),
  getState: () => ipcRenderer.invoke("tracker:state"),
  getHistoryState: () => ipcRenderer.invoke("history:state"),
  getHistoryOpponentCharacterStats: (profileId, locale, actId = null, selectedOwnCharacterId = null, requestToken = null, matchMode = "all", actSelectionSource = "latest", options = {}) =>
    ipcRenderer.invoke("history:opponent-character-stats", {
      profileId,
      locale,
      actId,
      selectedOwnCharacterId,
      requestToken,
      matchMode,
      actSelectionSource,
      forceRefresh: options?.forceRefresh === true,
    }),
  getHistoryCharacterNames: (profileId, locale, actId = null) =>
    ipcRenderer.invoke("history:character-names", { profileId, locale, actId }),
  fetchHistory: (options = {}) =>
    ipcRenderer.invoke("history:fetch", { actId: options?.actId ?? null }),
  selectHistoryProfile: (userCode) =>
    ipcRenderer.invoke("history:select-profile", { userCode }),
  clearHistoryProfile: () => ipcRenderer.invoke("history:clear-profile"),
  getHistoryOpponentContext: (payload) =>
    ipcRenderer.invoke("history:opponent-context", {
      profileId: payload?.profileId,
      opponentUserCode: payload?.opponentUserCode,
      characterId: payload?.characterId,
      characterDisplayName: payload?.characterDisplayName,
      historyOwnerProfileId: payload?.historyOwnerProfileId,
      replayId: payload?.replayId,
      selectedActSelector: payload?.selectedActSelector,
      selectedActId: payload?.selectedActId,
      actSelectionSource: payload?.actSelectionSource === "explicit" ? "explicit" : "latest",
      currentActId: payload?.currentActId,
      currentActStatus: payload?.currentActStatus,
      selectedRecord: payload?.selectedRecord,
      forceRefresh: payload?.forceRefresh === true,
    }),
  getSocialState: () => ipcRenderer.invoke("social:state"),
  refreshSocial: (kind) => ipcRenderer.invoke("social:refresh", { kind }),
  reportSocialActivity: () => ipcRenderer.invoke("social:activity"),
  changeSocialPage: (kind, page) =>
    ipcRenderer.invoke("social:page", { kind, page }),
  openSocialProfile: (profileId) =>
    ipcRenderer.invoke("social:open-profile", { profileId }),
  openStatsWindow: () => ipcRenderer.invoke("display:open"),
  hideStatsWindow: () => ipcRenderer.invoke("display:hide"),
  toggleStatsWindow: () => ipcRenderer.invoke("display:toggle"),
  getDisplaySettings: () => ipcRenderer.invoke("display:settings"),
  getInstalledFonts: () => ipcRenderer.invoke("system:fonts"),
  previewNotificationSound: (soundId) =>
    ipcRenderer.invoke("system:notification-sound-preview", { soundId }),
  previewFriendNotification: () =>
    ipcRenderer.invoke("friend-notification:preview"),
  updateDisplaySettings: (settings) =>
    ipcRenderer.invoke("display:update", settings),
  toggleOverlayInteraction: () =>
    ipcRenderer.invoke("display:toggle-interaction"),
  beginStatsWindowDrag: (screenX, screenY) =>
    ipcRenderer.send("display:drag-start", { screenX, screenY }),
  moveStatsWindowDrag: (screenX, screenY) =>
    ipcRenderer.send("display:drag-move", { screenX, screenY }),
  endStatsWindowDrag: () => ipcRenderer.send("display:drag-end"),
  chooseGameExecutable: () => ipcRenderer.invoke("automation:choose-game"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", { text }),
  notifyManagementReady: () => ipcRenderer.send("ui:management-ready"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("tracker:state", listener);
    return () => ipcRenderer.removeListener("tracker:state", listener);
  },
  onHistoryState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("history:state", listener);
    return () => ipcRenderer.removeListener("history:state", listener);
  },
  onHistoryProgress: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("history:progress", listener);
    return () => ipcRenderer.removeListener("history:progress", listener);
  },
  onHistoryOpponentCharacterStatsProgress: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("history:opponent-character-stats-progress", listener);
    return () => ipcRenderer.removeListener("history:opponent-character-stats-progress", listener);
  },
  onSocialState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("social:state", listener);
    return () => ipcRenderer.removeListener("social:state", listener);
  },
  onAuthenticatedPlayer: (callback) => {
    const listener = (_event, player) => callback(player);
    ipcRenderer.on("auth:player", listener);
    return () => ipcRenderer.removeListener("auth:player", listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  onDisplaySettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("display:settings", listener);
    return () => ipcRenderer.removeListener("display:settings", listener);
  },
});
