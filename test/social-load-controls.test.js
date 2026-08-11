"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("main process pauses forgotten FRIENDS polling and exposes resume activity", () => {
  const main = read("src/main.js");
  assert.match(main, /powerMonitor\.on\("lock-screen", \(\) => suspendSocialRefresh\("system"\)\)/);
  assert.match(main, /powerMonitor\.on\("suspend", \(\) => suspendSocialRefresh\("system"\)\)/);
  assert.match(main, /powerMonitor\.on\("unlock-screen", \(\) => recordSocialActivity\(\)\)/);
  assert.match(main, /shouldSuspendSocialRefresh\(\{[\s\S]*?trackingActive: trackerState\.active,[\s\S]*?gameRunning: gameWasRunning/);
  assert.match(main, /resetFriendNotificationBaseline\(\);[\s\S]*?scheduleSocialRefresh\(\{ immediate: true \}\)/);
  assert.match(main, /socialMonitoringGeneration \+= 1;[\s\S]*?socialServiceAbortControllers[\s\S]*?controller\.abort\(\)/);
  assert.match(main, /scope === "social" && socialSuspended/);
  assert.match(main, /loadBuildId\(false, requestScope\)/);
  assert.match(main, /fetchServiceWithRateLimit\([\s\S]*?\{ scope: requestScope \}/);
  assert.match(main, /"social:activity"[\s\S]{0,120}recordSocialActivity\(\)/);
  assert.match(main, /socialPaused: japanese \? "FRIENDS取得休止中"/);
});

test("manual Social refresh shares the common scheduler and cooldown", () => {
  const main = read("src/main.js");
  const preload = read("src/preload.js");
  assert.match(main, /socialManualRefreshAvailableAt\[kind\] = now \+ SOCIAL_MANUAL_COOLDOWN_MS/);
  assert.match(main, /async function manualRefreshSocial\(kind\)[\s\S]*?stopSocialRefresh\(\)[\s\S]*?refreshSocialKind\(kind,[\s\S]*?scheduleSocialRefresh\(\)/);
  assert.match(main, /"social:refresh"[\s\S]{0,120}manualRefreshSocial\(kind\)/);
  assert.match(preload, /reportSocialActivity: \(\) => ipcRenderer\.invoke\("social:activity"\)/);
});

test("management UI reports suspended monitoring and honors server cooldown", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const i18n = read("src/renderer/i18n.js");
  assert.match(html, /id="socialMonitoringStatus"/);
  assert.match(renderer, /monitoring\.suspended === true/);
  assert.match(renderer, /monitoring\.refreshAvailableAt\?\.\[activeSocialKind\]/);
  assert.match(renderer, /cooldownRemaining > 0/);
  assert.match(i18n, /socialMonitoringSuspended: "FRIENDS取得休止中"/);
  assert.match(i18n, /socialMonitoringSuspended: "FRIENDS updates paused"/);
});
