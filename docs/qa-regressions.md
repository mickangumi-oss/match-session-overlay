# QA regression flow

## LIVE-STATE-001: recent match history does not update during tracking

- First observed: 2026-08-23
- Symptom: new matches were stored during tracking, but the always-visible recent-history table stayed stale until the detailed history screen was opened or another full redraw occurred.
- Cause: `scheduleHistoryRender` returned while the detailed history panel was closed before redrawing the always-visible recent-history preview.
- Required regression checks:
  1. Keep the detailed history panel closed.
  2. Push a `history:state` containing a match newer than the current first row.
  3. Confirm the recent-history first row updates immediately and the detailed panel remains closed.
  4. Open the detailed history panel and confirm the same match appears in the detailed table and summaries.
  5. Push updated `social:state` data and confirm both Friends and Following lists update without reopening the screen.
- Non-regression boundary: friend online notifications use their own complete-snapshot path and must not be coupled to history-panel visibility.
- Automation:
  - `tests/live-state-rendering.test.js` protects the renderer event/early-return contract.
  - `test-local/e2e/ui.spec.cjs` exercises the hidden-panel history update, reopen transition, and live Friends/Following updates in an offscreen, non-focusable Electron window.
- QA operation: include these checks whenever history event handling, renderer scheduling, tracking refresh, social state delivery, or management-screen visibility logic changes.
