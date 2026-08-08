"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("social display uses ten-item app pages and profile-scoped requests", () => {
  const main = read("src/main.js");
  const renderer = read("src/renderer/renderer.js");
  assert.match(main, /const SOCIAL_PAGE_SIZE = 10;/);
  assert.match(main, /paginateSocialPlayers\([\s\S]*?SOCIAL_PAGE_SIZE/);
  assert.match(main, /const requestKey = `\$\{profileIdAtRequest\}:\$\{kind\}:\$\{location\.sourcePage\}:\$\{serviceLocale\(\)\}`/);
  assert.match(main, /"social:page",[\s\S]*?changeSocialPage\(kind, page\)/);
  assert.match(main, /checkAuthenticationInternal[\s\S]*?fighterslist\/friend\.json", \{[\s\S]*?order_type: "last_play"/);
  assert.match(renderer, /\(tabState\.players \?\? \[\]\)\.slice\(0, 10\)/);
});

test("private-data clearing invalidates queued and active official requests", () => {
  const main = read("src/main.js");
  assert.match(main, /privateDataGeneration \+= 1;/);
  assert.match(main, /for \(const controller of serviceAbortControllers\) controller\.abort\(\);/);
  assert.match(main, /assertPrivateDataGeneration\(generation\);[\s\S]*?sourceSession\.fetch/);
  assert.match(main, /fetchMatchHistoryPages[\s\S]*?assertPrivateDataGeneration\(generation\);[\s\S]*?mergeMatchHistory/);
  assert.match(main, /if \(matchHistoryFetchInFlight === request\)/);
});

test("build metadata, updater checks, and startup timer share or cancel in-flight work", () => {
  const main = read("src/main.js");
  const updater = read("src/updater.js");
  assert.match(main, /buildIdInFlight\?\.locale === requestedLocale/);
  assert.match(main, /if \(buildIdInFlight === inFlight\) buildIdInFlight = null/);
  assert.match(updater, /if \(checkInFlight\) return checkInFlight/);
  assert.match(updater, /now < nextCheckAllowedAt/);
  assert.match(updater, /networkController\.abort\(\)/);
  assert.match(main, /startupUpdateTimer = setTimeout/);
  assert.match(main, /clearTimeout\(startupUpdateTimer\)/);
  assert.match(main, /updater\?\.cancel\?\.\(\)/);
});

test("idle history ticks update only fetch status and resize work is frame-coalesced", () => {
  const renderer = read("src/renderer/renderer.js");
  const stats = read("src/renderer/stats.js");
  assert.match(renderer, /setInterval\(\(\) => \{\s*if \(historyPanelOpen\) renderHistoryFetchStatus\(\);/);
  assert.match(renderer, /if \(managementResizeFrame\) return;[\s\S]*?requestAnimationFrame/);
  assert.match(stats, /if \(statsResizeFrame\) return;[\s\S]*?requestAnimationFrame/);
  assert.match(stats, /overlayEvents\.readyState !== EventSource\.OPEN/);
});

test("an available update marks the options button with an UPDATE badge", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const css = read("src/renderer/style.css");
  assert.match(html, /id="optionsUpdateBadge"[^>]*>UPDATE<\/span>/);
  assert.match(renderer, /optionsButton\?\.classList\.toggle\("has-update", hasUpdate\)/);
  assert.match(css, /\.option-button\.has-update/);
});
