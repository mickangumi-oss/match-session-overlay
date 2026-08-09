"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("friend notification options are FRIENDS-only and include Windows sound controls", () => {
  const html = read("src/renderer/index.html");

  assert.match(html, /id="friendNotificationSettingsCard"/);
  assert.match(html, /id="friendOnlineNotificationsEnabledInput" type="checkbox"/);
  assert.match(html, /id="friendOnlineNotificationTimingAlwaysInput"[^>]*value="always"/);
  assert.match(html, /id="friendOnlineNotificationTimingGameOnlyInput"[^>]*value="game-only"/);
  assert.match(html, /data-i18n="friendOnlineNotificationsNote"/);
  assert.match(html, /id="friendOnlineNotificationSoundInput"/);
  assert.match(html, /id="previewFriendOnlineNotificationSoundButton"/);
  assert.match(html, /id="friendOnlineNotificationDurationInput"[^>]*min="3"[^>]*max="15"/);
  assert.match(html, /id="previewFriendOnlineNotificationButton"/);
  assert.match(html, /id="friendOnlineNotificationOpacityInput"[^>]*min="0"[^>]*max="100"/);
  assert.match(html, /id="friendOnlineNotificationVolumeInput"[^>]*min="0"[^>]*max="100"/);
  assert.doesNotMatch(html, /followingNotification/i);
});

test("friend notification settings render safe defaults and persist immediately", () => {
  const renderer = read("src/renderer/renderer.js");

  assert.match(renderer, /settings\.friendOnlineNotificationsEnabled === true/);
  assert.match(
    renderer,
    /settings\.friendOnlineNotificationTiming === "always" \? "always" : "game-only"/,
  );
  assert.match(
    renderer,
    /friendOnlineNotificationsEnabled:\s*elements\.friendOnlineNotificationsEnabledInput\.checked/,
  );
  assert.match(
    renderer,
    /friendOnlineNotificationTiming:\s*timingInput\.value/,
  );
  assert.match(
    renderer,
    /friendOnlineNotificationSound:\s*soundId/,
  );
  assert.match(renderer, /api\.previewNotificationSound\(soundId\)/);
  assert.match(
    renderer,
    /notificationSoundPreviewInFlight \|\| friendNotificationSampleInFlight \|\| soundDisabled/,
  );
  assert.match(renderer, /if \(soundId === "none" \|\| notificationSoundPreviewInFlight\) return/);
  assert.match(
    renderer,
    /notificationSoundPreviewInFlight = true;[\s\S]*?finally[\s\S]*?notificationSoundPreviewInFlight = false/,
  );
  assert.match(renderer, /api\.updateDisplaySettings\(/);
  assert.match(renderer, /friendOnlineNotificationDurationSeconds:\s*durationSeconds/);
  assert.match(renderer, /api\.previewFriendNotification\(\)/);
  assert.match(renderer, /friendOnlineNotificationBackgroundOpacity:\s*backgroundOpacity/);
  assert.match(renderer, /friendOnlineNotificationVolume:\s*volume/);
});

test("Japanese and English provide complete notification option labels", () => {
  const i18n = read("src/renderer/i18n.js");

  for (const key of [
    "categoryNotifications",
    "friendOnlineNotifications",
    "friendOnlineNotificationsHeading",
    "friendOnlineNotificationsNote",
    "friendOnlineNotificationTiming",
    "friendOnlineNotificationTimingAlways",
    "friendOnlineNotificationTimingGameOnly",
    "friendOnlineNotificationSound",
    "friendOnlineNotificationSoundNote",
    "notificationSoundNone",
    "previewSound",
    "previewSoundPlaying",
    "friendOnlineNotificationDuration",
    "notificationDurationSeconds",
    "previewNotification",
    "previewNotificationActive",
    "friendOnlineNotificationOpacity",
    "friendOnlineNotificationVolume",
  ]) {
    assert.match(i18n, new RegExp(`${key}:`));
  }
});
