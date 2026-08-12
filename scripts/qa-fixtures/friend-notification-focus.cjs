"use strict";

const { app, BrowserWindow, screen } = require("electron");
const {
  applyFriendOnlineSnapshot,
  createFriendOnlineNotificationState,
} = require("../../src/friend-online-notifications");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(async () => {
  const focusProbe = new BrowserWindow({
    width: 640,
    height: 360,
    title: "GAME FOCUS PROBE",
    backgroundColor: "#08131f",
  });
  await focusProbe.loadURL("data:text/html,<body style='background:%2308131f;color:white;font:32px sans-serif;display:grid;place-items:center'>GAME FOCUS PROBE</body>");
  focusProbe.show();
  focusProbe.focus();
  await wait(500);

  let state = createFriendOnlineNotificationState();
  state = applyFriendOnlineSnapshot(state, {
    accountId: "synthetic-account",
    friends: [{ profileId: "synthetic-friend", name: "SAMPLE FRIEND", online: false }],
    complete: true,
    succeeded: true,
    snapshotVersion: 1,
  }).state;

  let probeBlurCount = 0;
  let notificationFocusCount = 0;
  focusProbe.on("blur", () => { probeBlurCount += 1; });

  const transition = applyFriendOnlineSnapshot(state, {
    accountId: "synthetic-account",
    friends: [{ profileId: "synthetic-friend", name: "SAMPLE FRIEND", online: true }],
    complete: true,
    succeeded: true,
    snapshotVersion: 2,
  });

  const notification = new BrowserWindow({
    width: 340,
    height: 72,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
  });
  notification.on("focus", () => { notificationFocusCount += 1; });
  notification.setSkipTaskbar(true);
  notification.setFocusable(false);
  notification.setAlwaysOnTop(true, "screen-saver");
  notification.setIgnoreMouseEvents(true);
  const workArea = screen.getPrimaryDisplay().workArea;
  notification.setBounds({
    x: workArea.x + workArea.width - 340 - 20,
    y: workArea.y + workArea.height - 72 - 20,
    width: 340,
    height: 72,
  });
  await notification.loadURL("data:text/html,<body style='margin:0;background:%230a1420eF;color:white;font:20px sans-serif;display:grid;place-items:center;border:1px solid %2343d8ff'>SAMPLE FRIEND ONLINE</body>");

  const focusedBefore = BrowserWindow.getFocusedWindow()?.getTitle() ?? "";
  notification.showInactive();
  notification.setFocusable(false);
  await wait(1200);
  const focusedAfter = BrowserWindow.getFocusedWindow()?.getTitle() ?? "";

  const result = {
    syntheticTransitionCount: transition.notificationPlayers.length,
    focusedBefore,
    focusedAfter,
    probeStillFocused: focusProbe.isFocused(),
    probeBlurCount,
    notificationFocusCount,
  };
  process.stdout.write(`FOCUS_QA_RESULT=${JSON.stringify(result)}\n`);
  notification.destroy();
  focusProbe.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
});
