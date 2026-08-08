"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("maintenance is the first options card with update before local data", () => {
  const html = read("src/renderer/index.html");
  const gridStart = html.indexOf('<div class="options-category-grid">');
  const maintenance = html.indexOf('id="maintenanceSettingsCard"', gridStart);
  const nextCard = html.indexOf('data-i18n="categoryDisplayContent"', gridStart);
  const maintenanceEnd = html.indexOf("</section>", maintenance);
  const card = html.slice(maintenance, maintenanceEnd);

  assert.ok(gridStart >= 0 && maintenance > gridStart);
  assert.ok(maintenance < nextCard, "maintenance must be the first category card");
  assert.ok(card.indexOf('data-i18n="appUpdate"') < card.indexOf('data-i18n="localData"'));
  assert.ok(card.indexOf('id="installUpdateButton"') < card.indexOf('id="clearDataButton"'));
});

test("maintenance actions share a readable stable footprint", () => {
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/style.css");

  for (const id of ["checkUpdateButton", "installUpdateButton", "clearDataButton"]) {
    assert.match(
      html,
      new RegExp(`class="[^"]*maintenance-action-button[^"]*" id="${id}"`),
    );
  }
  assert.match(css, /\.maintenance-action-button\s*\{[\s\S]*?min-width:\s*78px;[\s\S]*?min-height:\s*34px;/);
  assert.match(css, /\.maintenance-action-button\.accent\s*\{[\s\S]*?box-shadow:/);
  assert.match(css, /\.options-category-card\.force-update \.maintenance-action-button\.accent/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.maintenance-action-button[\s\S]*?min-width:\s*68px;/);
  assert.match(css, /\.options-category-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
});

test("update states switch labels, prevent duplicate actions, and retain badges", () => {
  const renderer = read("src/renderer/renderer.js");
  const i18n = read("src/renderer/i18n.js");

  assert.match(renderer, /state\.status === "checking"[\s\S]*?t\("checking", "確認中…"\)/);
  assert.match(renderer, /checkUpdateButton\.disabled\s*=\s*state\.status === "checking" \|\| state\.status === "downloading"/);
  assert.match(renderer, /installUpdateButton\.disabled = state\.status !== "ready"/);
  assert.match(renderer, /checkUpdateButton\.addEventListener\("click", async \(\) => \{[\s\S]*?renderUpdate\(\{[\s\S]*?status: "checking"/);
  assert.match(renderer, /optionsUpdateBadge\?\.classList\.toggle\("hidden", !hasUpdate\)/);
  assert.match(renderer, /maintenanceSettingsCard\?\.classList\.toggle\("force-update", required\)/);
  assert.match(i18n, /checking: "Checking…"/);
  assert.match(i18n, /checking: "確認中…"/);
});

test("local data deletion keeps the existing confirmation-backed IPC path", () => {
  const renderer = read("src/renderer/renderer.js");
  assert.match(renderer, /clearDataButton\.addEventListener\("click", async \(\) => \{[\s\S]*?api\.clearPrivateData\(\)/);
});

test("background and font-size sliders share the same design-card row", () => {
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/style.css");
  assert.match(html, /class="options-category-card design-options-card"/);
  assert.match(
    css,
    /\.design-options-card\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    css,
    /\.design-options-card > h4\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/,
  );
});
