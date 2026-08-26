"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildServiceDataUrl, buildServiceHomeUrl } = require("../src/service-url");

const SUPPORTED_LOCALES = [
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
];

test("profile and battle-log URLs preserve every supported locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(
      new URL(buildServiceHomeUrl("https://www.streetfighter.com", locale)).pathname,
      `/6/buckler/${locale}`,
    );
    for (let page = 1; page <= 10; page += 1) {
      const url = new URL(buildServiceDataUrl(
        "https://www.streetfighter.com",
        "build-test",
        locale,
        "profile/12345678/battlelog.json",
        { page },
      ));
      assert.equal(
        url.pathname,
        `/6/buckler/_next/data/build-test/${locale}/profile/12345678/battlelog.json`,
      );
      assert.equal(url.searchParams.get("page"), String(page));
    }
  }
});

test("history fetch wiring passes the captured locale into both route builders", () => {
  const main = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "main.js"),
    "utf8",
  );
  assert.match(main, /buildServiceHomeUrl\(SERVICE_ORIGIN, requestedLocale\)/);
  assert.match(main, /buildServiceDataUrl\(\s*SERVICE_ORIGIN,\s*currentBuildId,\s*requestedLocale/s);
  assert.match(main, /fetchMatchHistoryPages\([\s\S]*requestedLocale/s);
});

test("service URL builders reject path traversal segments", () => {
  assert.throws(
    () => buildServiceDataUrl(
      "https://www.streetfighter.com",
      "build-test",
      "ja-jp",
      "profile/../battlelog.json",
    ),
    /relativePath/,
  );
  assert.throws(
    () => buildServiceHomeUrl("https://www.streetfighter.com", "ja-jp/evil"),
    /locale/,
  );
});
