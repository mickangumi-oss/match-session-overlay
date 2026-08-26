# Codex context: Match Session Overlay

Updated: 2026-08-27

この文書は、長いCodex会話を引き継がずに作業を再開するための短い正本である。新しいタスクは、過去タスク全文ではなく、この文書と変更対象ファイルだけを読む。

## Current state

- App repository: this repository root
- Current release: `v1.9.0`
- Current release tag commit: `7af431ead72153f5dab39b395cb563b100d9c68c`
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
- QA must never occupy the user's screen or steal keyboard focus. Run Electron capture and UI checks hidden/offscreen; do not show QA windows in the foreground.
- Use synthetic data only. Confirm that at least one item remains visible and that graph-off and reduced-item layouts compact correctly.
- Keep the live-state regressions in `docs/qa-regressions.md` in the affected-area test flow; in particular, verify recent-history updates while details are closed and pushed Friends/Following updates without reopening the screen.

## Required checks

Normal development baseline:

1. Record `git rev-parse HEAD` and `git status --short` before editing.
2. Run the narrow regression tests for the changed area.
3. Run `pnpm check` and `pnpm qa:local` before declaring an app-wide UI change complete.
4. Review the final diff and preserve unrelated worktree changes.
5. If QA is followed by another source change, invalidate the result and rerun the affected QA.

Release work must follow `docs/release-process.md`. Keep Codex Security, source checks, installer build, signed update manifest, secret scan, Defender, mandatory VirusTotal public upload, SHA-256 comparison, and post-release download verification as separate gates. The pre-push hook may rebuild the installer, so hash and scan the final post-hook binary.

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
4. Before delegating to local Qwen, conservatively estimate the complete input: system instructions, task, selected files, and reserved output. Use `qwen-luna` below 8,000 tokens for small mechanical work, choose `qwen-luna` or `qwen-terra` from 8,000–24,000 by task type, use `qwen-terra` for 24,000–48,000, and split without generation above 48,000 or the model's safe budget. Check the current chat model name, modified time, availability, and context limit immediately before delegation; do not guess a stale model or use an embedding-only model. Pass only bounded `include_paths`; `qwen-luna` edits require explicit `output_paths`, and `qwen-terra` is read-only.
5. For normal low-risk implementation, OpenAI Luna implements, validates Qwen's read-only review, runs tests, and integrates the change. Sol handles only high-difficulty requirement/design decisions, final review, external publication, destructive changes, or other high-risk actions. Store only a short result (conclusion, `file:line`, diff, tests/exit code, unresolved items, or split plan) in the conversation; keep long logs in files.
6. Store durable decisions here or in the relevant repository documentation instead of relying on conversation history.

## Match専用のコンテキスト節約契約

- このタスクは長い過去会話を正本にしない。開始時は本ファイル、依頼に直接関係するソース・テスト、必要なGit状態だけを読む。過去スレッド全文、既存の推論、無関係な変更履歴、巨大な生成物を再読しない。
- `renderer.js`などの大きなファイルは全体をQwenへ渡さない。`rg`等で対象関数・状態遷移・回帰テストを絞り、必要なら固有run IDの一時フォルダへ非機密の最小スニペットだけを作る。一時物は検証後に削除する。
- Qwen委任前に同じタスクのterminalから `C:\Users\zuga\AppData\Local\OpenWebUI\venv\Scripts\python.exe C:\Users\zuga\.codex\local-agents\qwen_delegate_cli.py status` を実行し、現行モデル名、更新日時、利用可能状態、コンテキスト上限を確認する。`qwen_local` MCPが見える場合も同じ確認を行う。
- 通常のMatch実装は OpenAI Luna が編集・テスト・統合し、Qwenはread-onlyレビューを担当する。Qwen-lunaの編集は明示した機械的変更だけ、`output_paths`を必須とする。Qwen-terraは常にread-onlyとし、Solは高難度の要件・設計・公開・破壊的変更だけを担当する。
- Qwenへの入力はシステム指示、タスク、選択ファイル、出力予約、安全余白の総量を見積もる。8,000未満はqwen-luna、8,000〜24,000は作業種別で選択、24,000〜48,000はqwen-terra、48,000超または安全予算超は生成せず分割案だけを受け取る。結果は800トークン以内に抑え、長いログはファイルへ保存する。
- Qwenの結果だけで設計・統合・公開を確定しない。Lunaが実ファイル、diff、テスト終了コードを確認して採否を決める。Qwenが利用不能、同じ原因で2回失敗、または再検証コスト過大ならLunaが直接確認し、必要時だけTerraへ切り替える。

Do not load or summarize the archived Match Session Overlay task unless this document and the repository are insufficient to answer a specific question.
