const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");

function functionBody(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("friend notification configures topmost once after inactive presentation", () => {
  const creation = functionBody(
    "function createFriendNotificationWindow()",
    "function configureFriendNotificationTopmost",
  );
  assert.doesNotMatch(creation, /setAlwaysOnTop\(/);
  assert.doesNotMatch(creation, /moveTop\(/);

  const presentation = functionBody(
    "function presentFriendNotification()",
    "function flushFriendNotificationBatch",
  );
  assert.match(presentation, /notificationWindow\.showInactive\(\)/);
  assert.match(presentation, /configureFriendNotificationTopmost\(notificationWindow\)/);
  assert.ok(
    presentation.indexOf("notificationWindow.showInactive()") <
      presentation.indexOf("configureFriendNotificationTopmost(notificationWindow)"),
  );
  assert.doesNotMatch(presentation, /raiseFriendNotificationWindow|moveTop\(/);
  const topmostHelper = functionBody(
    "function configureFriendNotificationTopmost(window)",
    "async function createFriendNotificationPreviewWindow",
  );
  assert.match(topmostHelper, /window\.setAlwaysOnTop\(true, "screen-saver"\)/);

  const queue = functionBody(
    "function queueFriendOnlineNotifications(players)",
    "function openSocialProfile",
  );
  assert.doesNotMatch(queue, /configureFriendNotificationTopmost|raiseFriendNotificationWindow|moveTop\(/);
});
