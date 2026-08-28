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

## HISTORY-DATE-001: result chart preserves the local calendar day at midnight

- First observed: 2026-08-26
- Symptom: UTC epoch timestamps around midnight could be grouped using the renderer process timezone instead of the product's Japan-time calendar, making the chart date disagree with the match list.
- Required regression checks:
  1. Classify a match at 2026-08-25 23:59:59 JST as `2026-08-25`.
  2. Classify a match at 2026-08-26 00:00:00 JST as `2026-08-26`.
  3. Aggregate several 08/26 matches into one bucket while keeping the 08/25 match in its own bucket.
  4. Verify UTC epoch seconds and epoch milliseconds produce the same date key.
  5. Verify the latest-seven-date selection, oldest-to-newest order, and empty-history state remain unchanged.
- Non-regression boundary: MR/LP series, match-list records, Friends, and Following must continue to use the original records and must not receive chart-only aggregation data.
- Automation:
  - `tests/history-result-chart-model.test.js` covers the JST boundary, UTC comparison, same-day aggregation, seven-date selection, and empty state.
  - `test-local/e2e/ui.spec.cjs` remains the offscreen UI check for the history screen and must not open a foreground QA window.

## HISTORY-RESULT-002: draw results remain visible in history rows

- First observed: 2026-08-26
- Symptom: the result chart counted a draw, but the detailed and recent-history rows rendered it as `—`.
- Required regression checks:
  1. Render a record with `result: "draw"` as `D` in the detailed history table.
  2. Render the same result as `D` in the always-visible recent-history preview.
  3. Keep the gray draw segment and expose its `DRAW`/`引き分け` legend without changing win/loss colors.
- Non-regression boundary: draw rows must not be added to win/loss totals or change MR/LP values.
- Automation: `test-local/e2e/display-typography.test.cjs` protects the two row mappings, localized legend labels, and draw color contract.

## HISTORY-RATING-003: final official MR/LP is included in POTENTIAL without rewriting history

- First observed: 2026-08-26
- Symptom: the last match's post-result MR/LP change was absent from POTENTIAL because battle-log values are match-time snapshots.
- Required regression checks:
  1. Replace only the derived terminal point with the current official profile value when the character, rating type, and profile source match.
  2. Keep `ownRating` and the persisted match-history JSON unchanged.
  3. Fall back to the match-time snapshot when the profile value is missing, non-profile, stale/unavailable, or for another character/rating type.
  4. Confirm MR and LP switching does not cross-contaminate values and that fewer than two samples remain non-estimable.
  5. Confirm the management/overlay potential, history card, and history graph use the same derived terminal value.
  6. Change the history character filter and confirm the selected character's MR/LP potential and graphs remain populated instead of showing an empty state.
- Non-regression boundary: win/loss charts, match rows, Friends, Following, and profile fetch cadence must remain unchanged.
- Automation: `tests/potential-current-rating.test.js` protects immutable snapshots, final-point replacement, fallback rules, MR/LP separation, renderer consumption, and the history-detail card using the derived terminal value.

## HISTORY-FETCH-001: paginated battle-log import starts the ten-page batch together

- First observed: 2026-08-26
- Symptom: importing the maximum 100 battle-log records appeared to load one page at a time and did not leave a visible completion state.
- Required regression checks:
  1. Start pages 1 through 10 together, with no page-1-first gate and no three-request cap.
  2. Keep the shared queue single-filed for live, authentication, ranking, and social requests while history requests use the explicit zero start gap and ten-request cap.
  3. Return the merged pages in page order and preserve duplicate merging.
  4. Report completed pages (not the highest page number) monotonically even when responses finish out of order.
  5. Keep the history list at 10 rows per display page and redraw it only after the batch completes; per-page progress must use the lightweight progress event.
  6. Publish the terminal completion state immediately after the page batch, before optional profile refresh or disk flushing, so a slow post-processing step cannot leave the UI in `読み込み中`.
  7. Show a persistent completion or partial-failure state with fetched count and page count.
  8. Preserve cancellation, generation checks, 429 handling, and the existing 10-minute manual-import cooldown.
  9. Verify every supported locale (`ja-jp`, `en`, `de`, `es-es`, `es-us`, `fr`, `it`, `ko-kr`, `zh-hans`, `zh-hant`, `pt-br`, `pl`, `ru`, `ar`) uses its own profile and Next data URL for all ten page requests; a locale switch must not mix old responses into the current batch.
- Non-regression boundary: live polling remains one page per poll and must not multiply its request volume.
- Automation: `tests/history-page-fetch.test.js` covers ten-page start-up, out-of-order completion, and short-page handling; `tests/service-request-scheduler.test.js` covers the default single-filed queue, the explicit concurrency cap, and the history zero-gap start.

## SERVICE-SCHEDULER-001: queued requests survive the minimum start gap

- First observed: 2026-08-26
- Symptom: the account card could remain unverified after login because a session refresh request disappeared while waiting for the official-service rate-limit gap.
- Cause: the scheduler removed the next pending entry before starting its delay timer, so the timer callback had no entry left to start.
- Required regression checks:
  1. Enqueue two authentication-priority requests with a positive minimum start gap.
  2. Confirm both promises resolve and both tasks run in order.
  3. Confirm the explicit history overlap limit still works while authentication and live traffic remain non-concurrent.
- Non-regression boundary: the fix must not reduce the configured service-request gap or alter cancellation, priority, generation, or 429 handling.
- Automation: `tests/service-request-scheduler.test.js` covers the delayed queue regression, the default single-filed queue, and the explicit concurrency cap.

## HISTORY-PROFILE-001: opponent reference card keeps Act and rating scope explicit

- First observed: 2026-08-26
- Risk: a profile payload can contain multiple characters, rating systems, or past Acts. Selecting a history row must not make a past-Act or LP value look like the current-Act MR.
- Required regression checks:
  1. Select a history row and show its match-time opponent character and MR/LP without changing the history target player.
  2. Parse a fixture containing current and past Act values and display only the explicit current Act.
  3. Keep the other-character name paired with its own peak/current value; never compare or convert MR and LP.
  4. Show `—` for an unknown Act, empty profile, authentication failure, or rate-limit failure while leaving the history table, graphs, POTENTIAL, Friends, and Following intact.
  5. Do not fetch opponent profiles when the history panel opens; repeated selection of the same locale/profile/Act must reuse the cache or in-flight request.
  6. Verify all supported locale routes use the main-process `fetchServiceJson` path and that no URL, Cookie, or authentication data reaches the renderer.
  7. Run the UI check offscreen and confirm the card remains readable in WINDOW/OVERLAY and horizontal/vertical layouts.
  8. Verify the normal profile payload's current `master_rating` is not used as a peak; when the official `highest/master_rating_info` response is available, accept only its `response.character_league_infos[].league_info.master_rating` values for the matching current Act.
  9. Keep `—` for a missing, mismatched-Act, target-character-only, or otherwise unusable peak response.
  10. Send the official endpoint's numeric `pageProps.sid` as `targetShortId`; a string ID can return an empty response even with a valid login session. Confirm the positive path shows the other character and peak MR.
- Non-regression boundary: selecting the opponent reference row must not invoke `selectHistoryProfile`, mutate persisted history records, or alter MR/LP graph data.
- Automation: `tests/opponent-profile-context.test.js` covers Act filtering, MR/LP separation, name/value pairing, and bounded parsing; hidden Electron UI QA covers row selection and the empty/error states.
