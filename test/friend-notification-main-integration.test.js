"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
const html = fs.readFileSync(
  path.join(root, "src", "renderer", "friend-notification.html"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(root, "src", "renderer", "friend-notification.css"),
  "utf8",
);
const renderer = fs.readFileSync(
  path.join(root, "src", "renderer", "friend-notification.js"),
  "utf8",
);
const snapshot = fs.readFileSync(
  path.join(root, "src", "friend-snapshot.js"),
  "utf8",
);

test("notification BrowserWindow is compact, click-through, and non-focusing", () => {
  assert.match(main, /width:\s*340,[\s\S]*?height:\s*72/);
  assert.match(main, /focusable:\s*false/);
  assert.match(main, /skipTaskbar:\s*true/);
  assert.match(main, /setIgnoreMouseEvents\(true\)/);
  assert.match(main, /setAlwaysOnTop\(true,\s*"screen-saver"\)/);
  assert.match(main, /function prewarmFriendNotificationWindow\(\)/);
  assert.match(main, /async function prewarmFriendNotificationPreviewWindow\(\)/);
  assert.match(main, /prewarmFriendNotificationWindow\(\);[\s\S]*?scheduleSocialRefresh/);
  assert.match(
    main,
    /configureGameDetection\(\);[\s\S]*?displaySettings\.friendOnlineNotificationsEnabled[\s\S]*?prewarmFriendNotificationWindow\(\)/,
  );
  assert.match(main, /setSkipTaskbar\(true\)[\s\S]*?setFocusable\(false\)[\s\S]*?hide\(\)/);
  assert.match(
    main,
    /configureGameDetection\(\);[\s\S]*?prewarmFriendNotificationPreviewWindow\(\)\.catch/,
  );
  assert.match(
    main,
    /friendNotificationPreviewLoadInFlight[\s\S]*?await friendNotificationPreviewLoadInFlight/,
  );
  assert.match(main, /showInactive\(\)/);
  assert.match(main, /positionFriendNotification\(latestView\.count > 1 \? 100 : 72\)/);
  assert.match(main, /const margin = 20/);
  assert.doesNotMatch(html + renderer, /<audio|Audio\(|\.play\(/i);
  assert.match(css, /pointer-events:\s*none/);
});

test("one shared toast aggregates profile IDs and keeps the configured deadline", () => {
  assert.match(main, /mergeFriendOnlineNotificationBatch\(previousBatch, players, now, \{/);
  assert.match(main, /createFriendOnlineNotificationBatch\(players, now, \{/);
  assert.match(main, /displayMs:\s*displaySettings\.friendOnlineNotificationDurationSeconds \* 1000/);
  assert.match(main, /friendNotificationBatch\.collectUntil - now/);
  assert.match(main, /friendNotificationBatch\.dismissAt - Date\.now\(\)/);
  assert.match(
    main,
    /replacedExpiredBatch[\s\S]*?clearTimeout\(friendNotificationHideTimer\)[\s\S]*?friendNotificationWindow\.hide\(\)/,
  );
  assert.match(
    main,
    /friendNotificationWindow\.isVisible\(\)[\s\S]*?positionFriendNotification\(view\.count > 1 \? 100 : 72\)/,
  );
  assert.match(renderer, /payload\.names[\s\S]*?slice\(0, 2\)/);
  assert.match(renderer, /count - visibleNames\.length/);
});

test("enabled FRIENDS monitoring reads every official page through the existing service queue", () => {
  assert.match(main, /refreshAllFriendsForNotifications/);
  assert.match(main, /fetchCompleteFriendSnapshot/);
  assert.match(snapshot, /for \(let page = 2; page <= expectedTotalPages; page \+= 1\)/);
  assert.match(main, /fetchServiceJson\("fighterslist\/friend\.json"/);
  assert.match(snapshot, /validPageNumber\(normalized\?\.totalPages\) !== expectedTotalPages/);
  assert.match(snapshot, /normalized\.players\.length === 0/);
  assert.match(snapshot, /byProfileId\.has\(profileId\)[\s\S]*?incompleteSnapshotError/);
  assert.match(main, /replaceSocialSourcePages\("friends", pages\)/);
  assert.doesNotMatch(main, /refreshAllFollowingForNotifications/);
});

test("tray monitoring continues only when enabled and consumes game-off transitions", () => {
  assert.match(
    main,
    /mainWindow && !mainWindow\.isDestroyed\(\) && mainWindow\.isVisible\(\)\) \|\|[\s\S]*?displaySettings\.friendOnlineNotificationsEnabled/,
  );
  assert.match(main, /isGameRunningForFriendNotification/);
  assert.match(
    main,
    /return isGameDetectionEnabled\(\) \? gameWasRunning : false/,
  );
  assert.match(main, /gameRunningOnly:[\s\S]*?friendOnlineNotificationTiming === "game-only"/);
  assert.match(main, /previousFriendNotificationsEnabled[\s\S]*?resetFriendNotificationBaseline\(\)/);
  assert.match(main, /resetFriendNotificationBaseline\(authenticatedProfileId\)/);
});

test("settings use safe persisted defaults", () => {
  assert.match(main, /friendOnlineNotificationsEnabled:\s*false/);
  assert.match(main, /friendOnlineNotificationTiming:\s*"game-only"/);
  assert.match(main, /friendOnlineNotificationSound:\s*NO_NOTIFICATION_SOUND/);
  assert.match(main, /friendOnlineNotificationDurationSeconds:\s*5/);
  assert.match(main, /friendOnlineNotificationBackgroundOpacity:\s*0\.94/);
  assert.match(main, /friendOnlineNotificationVolume:\s*1/);
  assert.match(main, /savedSettings\.friendOnlineNotificationsEnabled === true/);
  assert.match(
    main,
    /savedSettings\.friendOnlineNotificationTiming === "always" \? "always" : "game-only"/,
  );
  assert.match(main, /sanitizeWindowsNotificationSound\([\s\S]*?savedSettings\.friendOnlineNotificationSound/);
});

test("sample notification uses isolated synthetic data and current visual settings", () => {
  assert.match(main, /async function previewFriendOnlineNotification\(\)/);
  assert.match(main, /names:\s*\["SAMPLE FRIEND"\]/);
  assert.match(main, /friendNotificationPreviewWindow/);
  assert.match(
    main,
    /parent:\s*mainWindow && !mainWindow\.isDestroyed\(\)[\s\S]*?type:\s*"toolbar"/,
  );
  assert.match(
    main,
    /previewWindow\.setAlwaysOnTop\(true,\s*"floating"\)/,
  );
  assert.match(main, /durationMs = displaySettings\.friendOnlineNotificationDurationSeconds \* 1000/);
  assert.match(main, /backgroundOpacity:\s*displaySettings\.friendOnlineNotificationBackgroundOpacity/);
  assert.match(main, /"friend-notification:preview"/);
  assert.match(html, /id="friendToastBackground"/);
  assert.match(renderer, /background\.style\.opacity = String\(backgroundOpacity\)/);
  assert.match(css, /\.toast-background\s*\{[\s\S]*?opacity:\s*0\.94/);
  assert.doesNotMatch(css, /\.friend-toast\.leaving\s*\{[^}]*opacity:/);
  assert.match(css, /\.name\s*\{[\s\S]*?opacity:\s*1/);
});

test("selected Windows sound is volume-adjusted, played once, and can be previewed", () => {
  assert.match(main, /async function playFriendNotificationSound\(/);
  assert.match(main, /resolveWindowsNotificationSound\(soundId, windowsNotificationSounds\)/);
  assert.match(main, /notificationSoundPlaybackPath\(soundPath, volume\)/);
  assert.match(main, /scalePcmWavVolume\(source, volume\)/);
  assert.match(main, /notificationWindow\.showInactive\(\);[\s\S]*?void playFriendNotificationSound\(\)/);
  assert.match(main, /child\.once\("close", \(code\) => finish\(code === 0\)\)/);
  assert.match(main, /"system:notification-sound-preview"/);
  assert.match(main, /played:\s*await playFriendNotificationSound\(soundId\)/);
});
