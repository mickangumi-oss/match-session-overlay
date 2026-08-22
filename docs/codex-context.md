# Codex context: Match Session Overlay

Updated: 2026-08-22

この文書は、長いCodex会話を引き継がずに作業を再開するための短い正本である。新しいタスクは、過去タスク全文ではなく、この文書と変更対象ファイルだけを読む。

## Current state

- App repository: this repository root
- Current release: `v1.7.0`
- Current verified HEAD when this context was created: `248f682a3d69b558a7932bbcbf956497576354ed`
- Product truth: `README.md`, `README.en.md`, `docs/usage.md`
- Release truth: `package.json`, `docs/release-process.md`, the matching file under `docs/release-notes/`
- Landing-page repository: sibling repository `../match-session-overlay-site`
- Production landing page: `https://match-session-overlay.mickangumi.chatgpt.site/`
- Download links should use the evergreen GitHub URL: `https://github.com/mickangumi-oss/match-session-overlay/releases/latest`

Do not assume the recorded HEAD, release, deployment, analytics counts, hashes, or scan results remain current. Verify them when the task depends on them.

## Product boundaries

- Windows 10+ 64-bit Electron application for local match-session statistics and an optional OBS overlay.
- Login ID/password are not stored. Login state and application data are stored locally; do not claim that no login-related information is stored.
- Never put real user codes, cookies, credentials, or real player history into fixtures, screenshots, documentation, or releases.
- Do not bypass Street Fighter 6/Buckler access controls. Preserve the existing local/privacy-first behavior.
- Update checking may notify the user, but downloading or installing an update requires explicit user action.

## UI and QA invariants

- Display-item selection is shared across WINDOW/OVERLAY and horizontal/vertical layouts; layout differs, selected content does not.
- The selected font color applies to every card text element.
- Numeric displays do not use grouping commas.
- Vertical rank change uses the compact form `1234↓123`.
- Preserve number aspect ratio and automatic shrink-to-fit.
- For any skin, typography, spacing, or resize change, automated tests alone are insufficient. Capture fresh Electron output and visually compare all four modes: WINDOW horizontal/vertical and OVERLAY horizontal/vertical.
- Use synthetic data only. Confirm that at least one item remains visible and that graph-off and reduced-item layouts compact correctly.

## Required checks

Normal development baseline:

1. Record `git rev-parse HEAD` and `git status --short` before editing.
2. Run the narrow regression tests for the changed area.
3. Run `pnpm check` and `pnpm qa:local` before declaring an app-wide UI change complete.
4. Review the final diff and preserve unrelated worktree changes.
5. If QA is followed by another source change, invalidate the result and rerun the affected QA.

Release work must follow `docs/release-process.md`. Keep Codex Security, source checks, installer build, signed update manifest, secret scan, Defender, optional explicitly approved VirusTotal upload, SHA-256 comparison, and post-release download verification as separate gates. The pre-push hook may rebuild the installer, so hash and scan the final post-hook binary.

## Current backlog

Treat these as candidates, not as already implemented requirements. Reconfirm scope before editing.

- Check for updates periodically while the app is running (candidate interval: six hours) and show the existing `UPDATE` badge; keep caching, concurrency prevention, and backoff. Do not auto-download or auto-install.
- Continue visual PDCA if a new Electron capture differs from the approved MIDNIGHT GLASS appearance in any of the four layout/mode combinations.
- Keep app and landing-page changes separate. The LP has its own repository, QA, deployment, and analytics evidence gates.

## Landing-page boundary

- Product claims must come from the app README and usage documentation.
- Keep Japanese root and English `/en`, canonical URLs, hreflang, sitemap, and language navigation aligned.
- Do not change copy or deploy based on small or inaccessible analytics data. Preserve the established low-sample report-only gate.
- Existing untracked LP design assets belong to the user unless proven otherwise; do not delete or stage them incidentally.

## Token-efficient task startup

At the start of a new Match Session Overlay task:

1. Read this file.
2. Read only the source/tests directly relevant to the request.
3. Verify live Git/release/deployment facts only when needed.
4. Delegate bounded searches, repetitive checks, and read-only review to local Qwen when that reduces total tokens; Sol keeps requirements, final design decisions, edits integration, release actions, and final review.
5. Store durable decisions here or in the relevant repository documentation instead of relying on conversation history.

Do not load or summarize the archived Match Session Overlay task unless this document and the repository are insufficient to answer a specific question.
