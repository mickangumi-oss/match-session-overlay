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
  openStatsWindow: () => ipcRenderer.invoke("display:open"),
  hideStatsWindow: () => ipcRenderer.invoke("display:hide"),
  toggleStatsWindow: () => ipcRenderer.invoke("display:toggle"),
  getDisplaySettings: () => ipcRenderer.invoke("display:settings"),
  getInstalledFonts: () => ipcRenderer.invoke("system:fonts"),
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
  chooseUpdateDirectory: () => ipcRenderer.invoke("update:choose-directory"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", { text }),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("tracker:state", listener);
    return () => ipcRenderer.removeListener("tracker:state", listener);
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
