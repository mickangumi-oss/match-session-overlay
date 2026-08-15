# Match Session Overlay

[日本語](README.md) | English

Match Session Overlay is an unofficial Windows app that retrieves Street Fighter 6 match data and displays your session wins and losses, win rate, MR/LP, rating change, current character, character ranking, and match history. You can use it as a regular window, an in-game overlay, or an OBS browser source.

> [!IMPORTANT]
> This is an unofficial tool. Changes to the official website may temporarily prevent match data from being retrieved.

## Requirements

- Windows 10 or later (64-bit)
- An internet connection for signing in to the official website and retrieving match data
- OBS Studio only if you want to display the overlay on stream (optional)

## Download

[Get the latest version from GitHub Releases](https://github.com/mickangumi-oss/match-session-overlay/releases/latest)

Open the latest release and download the installer named `Match-Session-Overlay-x.x.x-Setup.exe` from **Assets**. Do not use installers from an unverified source.

For step-by-step instructions, see the [English usage guide](docs/usage.en.md).

## What's new in v1.5.0

- You can now choose Japanese or English when you launch the app for the first time after installation.
- The language setting in Options is now labeled **Language**.
- Window and overlay behavior has been improved.
- The minimum font size has been lowered from 75% to 30%, so numbers can be displayed at a smaller size.
- Display and data retrieval performance has been improved.
- Session and match-history storage has been revised.
- The app now avoids fetching the same player's profile repeatedly when you reselect them within a short period.
- An English README and an English usage guide are now available.

See the [v1.5.0 release notes](https://github.com/mickangumi-oss/match-session-overlay/releases/tag/v1.5.0) for the installer checksum and security scan results.

## What it can show

- Ranked, Battle Hub, and Casual session records
- Wins, losses, win rate, current MR/LP, and the change since tracking began
- `CHARACTER RANK` for the current character
- `POTENTIAL MR` or `POTENTIAL LP`, calculated as a reference value from up to 20 recent ranked matches for the same player and character
- Match history filtered by date, mode, and character
- MR/LP trends and records by opponent character
- FRIENDS and FOLLOWING lists, with an optional notification when a friend comes online
- Japanese, English, and 12 other display languages

`POTENTIAL MR/LP` is not an official rating and does not predict a future rating. It is a median calculated by Match Session Overlay when at least two valid recent ranked-match values are available.

## Display options

- A regular horizontal or vertical window
- An in-game overlay with adjustable position and click-through locking
- An OBS browser source at `http://127.0.0.1:37123/overlay`

Display fields, orientation, background transparency, font, size, style, and colors can be configured in the app.

## Getting started

1. Download the latest installer from the official GitHub Releases page.
2. Install and start the app.
3. In **Player Connection**, open the official website and sign in there.
4. Choose a match mode and select **Start Tracking**.
5. Open a stats window, configure the in-game overlay, or add the OBS browser source.

See the [English usage guide](docs/usage.en.md) for details and troubleshooting.

## Sign-in and saved data

The app does not store the ID or password entered on the official sign-in page. Your signed-in session, display settings, session record, and match history are stored in Match Session Overlay's app-specific folders on your own PC.

- Settings and records: `%LOCALAPPDATA%\MatchSessionOverlay\user-data\`
- Signed-in session and temporary files: `%LOCALAPPDATA%\MatchSessionOverlay\session-data\`

The app retrieves match data directly from the official Street Fighter 6 website. Update checks connect directly to GitHub Releases. OBS integration uses a local connection on the same PC.

## Updates

The app checks GitHub Releases when it starts. When a newer version is available, an **Update** button appears in the management screen. Downloading and installing an update remains your choice.

## License

This software is provided under the [PolyForm Strict License 1.0.0](LICENSE). The license permits noncommercial purposes and does not permit distributing the software or making changes or new works based on it. Read the full `LICENSE` file for the exact terms, especially if your intended use may be commercial.

## Links

- [English usage guide](docs/usage.en.md)
- [Latest GitHub Release](https://github.com/mickangumi-oss/match-session-overlay/releases/latest)
- [Japanese README](README.md)
