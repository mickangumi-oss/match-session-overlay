# Getting started

[日本語](usage.md) | English

This guide covers the basic steps after installing Match Session Overlay.

## 1. Install the app

1. Open the [official GitHub Releases page](https://github.com/mickangumi-oss/match-session-overlay/releases/latest).
2. From the latest release's **Assets**, download `Match-Session-Overlay-x.x.x-Setup.exe`.
3. Run the installer and follow the on-screen steps.
4. Start Match Session Overlay.

If Windows shows a warning, check both the source and the filename. Do not run a redistributed installer from an unknown source.

## 2. Sign in to the official website

In **Player Connection**, select **Open Official Website** and sign in on the official website's sign-in page. Match Session Overlay does not read or store your ID or password.

Close the sign-in window after signing in. The connected player should then appear in the app. If it does not, select **Refresh**.

Your signed-in session is stored in the app-specific folder on your own PC:

```text
%LOCALAPPDATA%\MatchSessionOverlay\session-data\
```

## 3. Start tracking

1. Under **Display Layout**, choose Ranked, Battle Hub, or Casual.
2. Select **Start Tracking**.
3. The app shows the wins, losses, win rate, and MR/LP change recorded during the current session.

Records are kept separately by character. Master-rank characters show MR; other characters show LP.

After at least two ranked matches are available, the app may show `POTENTIAL MR` or `POTENTIAL LP`. This is the median of up to 20 recent ranked matches for the current player and character. It is a reference value created by the app, not an official rating or prediction.

## 4. Choose where to display it

### Regular window

Select **Show Stats Window**, then move and resize the window beside the game.

### In-game overlay

1. Choose **Overlay** under `WINDOW MODE`.
2. Use **Move Overlay** to position it.
3. Select **Lock Overlay** when the position is set.
4. While locked, mouse clicks pass through to the game.

### OBS browser source

With Match Session Overlay running, add a browser source in OBS and use:

```text
http://127.0.0.1:37123/overlay
```

Set the OBS browser source width and height to match the overlay size configured in the app. OBS is optional; the regular window and in-game overlay work without it.

## 5. Adjust the display

The settings screen includes:

- Displayed fields and match mode
- Regular window or overlay, horizontal or vertical layout
- Graph visibility, match count, axis size, and POTENTIAL reference line
- Background transparency, font, size, style, and colors
- Match retrieval interval and OBS browser-source URL
- Display language, Windows startup, and game-launch detection
- Friend online notification timing, sound, volume, duration, and background
- Local-data deletion and update checks

## 6. Friend online notifications

Notifications apply to FRIENDS, not FOLLOWING. A notification appears only when a friend changes from offline to online; friends who are already online during the first check are not announced.

The app normally checks FRIENDS every five minutes while notifications are enabled. It pauses checks during Windows lock or sleep and after six hours with no game, tracking, or app activity. Changes that happened while checks were paused are not announced later.

## 7. Finish a session or remove local data

- **Reset** starts the current session counts and rating change again from zero.
- **Stop** stops tracking.
- **Delete local data** removes the signed-in session, saved match history, current session record, and temporary files. Display settings remain.

## Troubleshooting

### The connected player does not appear

Confirm that you are signed in on the official website, then select **Refresh**. If the signed-in session has expired, open the official website from the app and sign in again.

### MR/LP shows `---`

The app may still be retrieving the starting value. Wait for the next update. If it remains blank, stop tracking and start again. Characters below Master rank use LP instead of MR.

### The overlay will not move

Switch to **Move Overlay** first. A locked overlay sends clicks through to the game.

### Check for updates

The app checks GitHub Releases when it starts. You can also use the manual **Check** action. When an update is found, the management screen shows an **Update** button.

## Privacy and local storage

The app does not store the ID or password entered on the official sign-in page. The signed-in session, settings, session record, and match history are stored in app-specific folders under `%LOCALAPPDATA%\MatchSessionOverlay\` on your own PC.

## License

Match Session Overlay is provided under the [PolyForm Strict License 1.0.0](../LICENSE). It permits noncommercial purposes and does not permit redistribution, modification, or derivative works. Read the full license before use, particularly if your intended use may be commercial.

Return to the [English README](../README.en.md) or open the [latest GitHub Release](https://github.com/mickangumi-oss/match-session-overlay/releases/latest).
