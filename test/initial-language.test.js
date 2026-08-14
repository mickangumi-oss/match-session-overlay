"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestedInitialLocale } = require("../src/initial-language");

const root = path.resolve(__dirname, "..");

test("Japanese Windows defaults to Japanese and every other locale defaults to English", () => {
  assert.equal(suggestedInitialLocale("ja-JP"), "ja-jp");
  assert.equal(suggestedInitialLocale("ja"), "ja-jp");
  assert.equal(suggestedInitialLocale("en-US"), "en");
  assert.equal(suggestedInitialLocale("de-DE"), "en");
  assert.equal(suggestedInitialLocale(""), "en");
});

test("first launch has a blocking bilingual language chooser and Options stays available", () => {
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "src/main.js"), "utf8");

  assert.match(html, /id="initialLanguageLayer"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Language \/ 表示言語/);
  assert.match(html, /id="languageInput"/);
  assert.match(renderer, /initialLanguageSelectionRequired/);
  assert.match(renderer, /api\.updateDisplaySettings\(\{ locale \}\)/);
  assert.match(main, /initialLanguageSelectionRequired = false/);
  assert.match(main, /suggestedInitialLocale\(app\.getLocale\(\)\)/);
  assert.match(
    main,
    /webContents\.once\("did-finish-load", \(\) => \{\s*if \(initialLanguageSelectionRequired\) return;/,
  );
  assert.match(
    main,
    /wasInitialLanguageSelectionRequired && !initialLanguageSelectionRequired[\s\S]*?checkAuthentication\(\)/,
  );
});

test("the Japanese Options label uses the language-neutral name", () => {
  const i18n = fs.readFileSync(path.join(root, "src/renderer/i18n.js"), "utf8");
  assert.match(i18n, /const JA = \{[\s\S]*?languageHeading: "Language"/);
});
