"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("friendNotification", {
  onPayload(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("friend-notification:payload", listener);
    return () => ipcRenderer.removeListener("friend-notification:payload", listener);
  },
});
