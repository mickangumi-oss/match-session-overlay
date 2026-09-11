"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadLocaleApi() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "i18n.js"),
    "utf8",
  );
  const context = { window: {}, console };
  vm.runInNewContext(source, context, { filename: "i18n.js" });
  return context.window.matchOverlayI18n;
}

test("runtime character labels are isolated by locale and never fall back to #ID", () => {
  const api = loadLocaleApi();
  api.registerCharacterNamesByLocale({
    "ko-kr": { 77: "루크" },
    en: { 77: "LUKE" },
  });
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "ko-kr");
  assert.equal(api.characterName("", 77), "루크");
  assert.equal(api.characterName("", 78), "—");
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "en");
  assert.equal(api.characterName("", 77), "LUKE");
  assert.equal(api.characterName("", 78), "—");
  assert.equal(api.characterName("Алекс", 78), "—");
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "ar");
  assert.equal(api.characterName("أليكس", 78), "—");
});

test("conflicting labels for one locale and ID stay unavailable until a consistent batch arrives", () => {
  const api = loadLocaleApi();
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "en");
  api.registerCharacterNamesByLocale({ en: { 77: ["LUKE", "RASHID"] } });
  assert.equal(api.characterName("LUKE", 77), "—");
  assert.equal(api.hasCharacterNameConflict("en", 77), true);
  api.registerCharacterNamesByLocale({ en: { 77: "LUKE" } });
  assert.equal(api.characterName("", 77), "LUKE");
  assert.equal(api.hasCharacterNameConflict("en", 77), false);
  api.resetCharacterNamesByLocale();
  assert.equal(api.characterName("", 77), "—");
});

test("payload-driven Chinese labels resolve every displayed ID without cross-locale leakage", () => {
  const api = loadLocaleApi();
  const ids = Array.from({ length: 33 }, (_, index) => index + 1);
  api.registerCharacterNamesByLocale({
    "zh-hans": Object.fromEntries(ids.map((id) => [id, `角色-${id}`])),
  });
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "zh-hans");
  for (const id of ids) assert.equal(api.characterName("", id), `角色-${id}`);
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "en");
  for (const id of ids) assert.notEqual(api.characterName("", id), `角色-${id}`);
});

test("all supported locales resolve payload labels independently and fail closed on gaps", () => {
  const api = loadLocaleApi();
  const locales = [
    "ja-jp", "en", "de", "es-es", "es-us", "fr", "it", "ko-kr",
    "zh-hans", "zh-hant", "pt-br", "pl", "ru", "ar",
  ];
  const labelsByLocale = Object.fromEntries(
    locales.map((locale) => [locale, {
      1: `${locale}-one`,
      2: `${locale}-two`,
    }]),
  );
  api.registerCharacterNamesByLocale(labelsByLocale, { replaceBatch: true });
  for (const locale of locales) {
    api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, locale);
    assert.equal(api.characterName("", 1), `${locale}-one`);
    assert.equal(api.characterName("", 2), `${locale}-two`);
    assert.equal(api.characterName("", 999), "—");
  }
  api.applyTranslations({ documentElement: {}, querySelectorAll: () => [] }, "zh-hans");
  assert.equal(api.characterName("en-one", 1), "zh-hans-one");
});
