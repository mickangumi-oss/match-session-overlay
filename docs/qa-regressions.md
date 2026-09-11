# QA regression flow

## MSO-I18N-ALL-001: 全14locale・全画面の翻訳混在を防ぐ

- Scope: メイン、管理画面対戦履歴、相手プロフィール、比較、オプション、通知、オーバーレイ。
- Contract: 選択localeの固定文言・キャラクター名を表示し、日本語/英語の固定残存、既知IDの`#ID`、別localeスナップショット混在を0件にする。プレイヤー名・USER CODE・Replay IDは翻訳対象外。
- Required checks: `ja-jp,en,de,es-es,es-us,fr,it,ko-kr,zh-hans,zh-hant,pt-br,pl,ru,ar`を各DOM/画面で確認。切替、再起動、cache部分欠損、取得失敗を再現し、辞書再取得→merge→永続化を確認。wide/narrowのoverflow・重なりも確認。
- Evidence: locale×画面×状態の件数、画面画像、テスト終了コード、対象SHA。認証情報・ID・生ログは含めない。

## MSO-CORNER-TIME-001: 壁際時間は実値・0.0・欠損を区別する

- Scope: PLAY比較の「相手を追い詰めた時間」「相手に追い詰められた時間」。
- Contract: 公式field/type/unit確認済みの値のみ表示。正の母数があれば小数1桁秒、実測0は`0.0秒`、欠損・不正・母数不足は`—`/状態表示。自分/相手で同一定義・同一窓を使う。
- Required checks: schema-only診断（path/type/presenceのみ）後に正式fieldへ限定。正値、0.0、欠損、負数、非有限、片側欠損、再取得、再読込、永続化、stale/partial/error、wide/narrow。
- Evidence: sanitized schema report、unit/focused/full/UI終了コード、同一SHA画面画像。値・ID・URL・Cookieは保存しない。

## MSO-CONTROL-TYPE-001: 操作タイプ列とALL/C/M集計を一致させる

- Scope: MATCH LIST、管理画面対戦履歴、OPPONENT CHARACTER STATS。
- Contract: 公式fieldのModern=`M`、Classic=`C`、不明=`—`。統計は初期`ALL`、`C`/`M`切替、各総合勝率・試合数とキャラ別再集計。`ALL`は不明を含む。
- Required checks: schema-onlyでfield/type/raw enumを確認。M/C/unknown、欠損、再取得、locale切替、再起動、部分欠損、フィルター、wide/narrow、回帰を検証。推測enumは禁止。
- Evidence: sanitized field map、DOM画像、テスト終了コード、対象SHA。

## MSO-HISTORY-TARGET-001: 相手表示と本人追跡の状態を分離する

- Scope: 相手リンク、履歴表示対象、比較取得、主画面追跡、`Use my player`。
- Contract: 相手選択で履歴/比較だけを切替え、本人追跡を変更しない。`Use my player`で履歴・主画面とも本人へ復帰。再起動後も整合し、stale応答は破棄、重複取得は抑制する。
- Required checks: 相手選択→取得→復帰、再起動、locale切替、連打、stale response、error/partial/retry、主画面と履歴の同時表示を実機/自動で確認。
- Evidence: 状態遷移、request count/stale破棄、画面画像、テスト終了コード、対象SHA。個人情報・Cookie・生ログは含めない。

## MATCHUP-COMPARE-001: 履歴起点の比較は対象固定・欠損安全・状態復元を守る

- First observed: 2026-09-08
- Scope: 対戦履歴の行選択 → 相手プロフィール → `データ比較`、PLAY過去100戦平均、round_resultsラウンド傾向。
- Contract: `docs/match-data-comparison-spec.md`、`docs/qa-comparison-matrix.md`、`QA-MSO-COMPARE-20260908-001`。
- Required regression checks:
  1. 比較の開閉で選択行、相手プロフィール、フィルター、スクロール位置を復元し、閉じる操作で選択を解除する。
  2. 自分／相手を同じ期間、モード、ACT、キャラクター範囲、単位で比較し、相手切替後のstale responseを破棄する。
  3. 同一対象の再選択でin-flight/cacheを再利用し、重複取得を発生させない。
  4. `LOADING`、`READY`、`PARTIAL`、`INSUFFICIENT_SAMPLE`、`UNAVAILABLE`、`ERROR`を区別し、欠損・未知コード・取得不能を0埋めしない。
  5. 確認済み`round_results` field map（コード対応・対象側順序）を実装へ反映し、match-level勝敗変換とREADYゲートをQAで確認するまでラウンド傾向をREADY扱いにしない。旧履歴は推測補完せず、再取得できた範囲だけbackfillする。round code6=SA単一とPLAY SAゲージ4分割は別契約として扱う。
  6. 本人の獲得ラウンドを母数に割合と件数を分離し、0除算・勝敗以外の推測をしない。
  7. wide/narrowで横overflow、文字切れ、重なりを発生させず、既存履歴、プロフィール6項目、ACT、取得時点を保持する。
  8. 画面・DOM・ログ・QA証拠へSource URL、Locale、内部ID、Cookie、認証情報、生ログを出さない。
  9. 実装前後のHEAD/worktree/対象SHAと、ローカルパッケージversion・EXE/installer SHAを記録する。SHA drift時は旧結果を再利用しない。
  10. 比較画面はバトル傾向とラウンド傾向の2セクションに限定し、勝率・評価・プロフィールmeta・比較画面内の履歴再掲を置かない。相手プロフィールの独立CLOSEは選択行・profile・request stateを解除し、履歴パネルを維持する。
  11. 「過去100戦平均」の見出し、取得期間、母数表示が同じ契約（最大100戦か常に100戦か）に一致し、round傾向2セクション全体をwide/narrow画面で確認できる。
- Non-regression boundary: 勝率、キャラクターLP/MR、プレイポイント、試合数、エンジョイ等の別タブ値を比較へ混在させない。Site公開・外部文書掲載は対象外。
- Candidate finding: `test-results/matchup-data-comparison.png`（960×811）でMATCHUP WIN RATEカード（自分100.0%、相手0.0%、READY）の混入を確認。CMP-012違反としてcandidateを差戻し、勝率カード除去後のwide/narrow再証拠までCMP実行を停止する。
- Additional findings: 独立ソースレビューで比較パネルへ仕様外プロフィール／評価項目が残る経路と、相手プロフィールの独立CLOSE不足を確認。さらに`round_results`双方all-zero（`[0]`／`[0,0]`）が`draw`へ、PLAYの`sample_count=0`・denominator=0や負数／範囲外percentageが`ready`へ進むfail-openを合成再現した。これらは全て同じcandidateの追加差戻しとして管理し、旧PASS・旧package・旧SHAを再利用しない。
- Current gate: sanitized `round_results` field mapとコード対応（取得元、配列長2/3、primitive number、`0` marker、`1=V`〜`8=P`、観測0/1/2/5/6、round側SA単一）は確認済み。PLAY側は公式`gauge_rate_sa_lv1/lv2/lv3/ca`の4比率（0〜1→%）を別契約として扱う。現行SHAで導線を日本語`データ比較`へ統一し、公式payloadにないperiod/sample_count/scopeは数値を表示・READY判定へ使用せず未取得状態として扱うことを独立確認した。qa:local/qa:ui/focused/check/lint/diffはPASS。実payload、正式baseline/diff、packageは未確認または停止中のためFixed/HOLDとする。
- Evidence: baseline/actual/diff screenshots、状態別fixture、request回数とstale破棄結果、テスト件数・終了コード、exact hash、パッケージ起動結果。
- Rollback prevention: 変更前に本契約と`QA-MSO-COMPARE-20260908-001`、`QA-MSO-PLAY-20260908-001`、`QA-MSO-ROUND-RESULTS-20260908-001`を各タスクへ配布する。source/test/config/screenshot/packageのSHA driftは旧結果を破棄し、SA4・stale・重複・retryのruntime E2E完了までFixed/Closed・package生成を進めない。

### 巻き戻り再発防止の直近FAILと再確認（2026-09-08）

- 独立`pnpm qa:local`で28/30・終了コード1。`src/renderer/index.html:469`のfallback`MATCHUP ANALYSIS`が仕様の日本語`データ比較`と不一致だった。
- 公式payloadに存在しないperiod/sample_count/scopeを合成fixtureの値で補う実装は、実フィールド適合の証拠にならない。metadataを表示・READY判定へ依存させない。
- 実行中にsource/test SHAがずれた可能性があるため、再現率は「1回の独立full実行で2件失敗」と記録し、再凍結後に確定する。
- 運用: Plannerは着手前に本契約と既存COMPARE/PLAY/ROUNDチケットを配布、Engineer2は変更前SHAとテスト範囲を返却、Designerは同一viewport/DPRのbaseline・actual・diffと原因/寸法を返却、QAは同一SHAでfull再実行する。build/package/commit/publicationはQA同一SHA合格まで停止する。
- 再確認: 現行SHAでqa:local 30/30+screenshot17/17、qa:ui30/30、focused31/31、check130/130、lint/diff exit0。旧28/30は無効化し、チケットはFixedへ戻した。ただし正式baseline/diff、実payload、package確認まではClosedにしない。

## ROUND-RESULTS-001: opaque round_resultsを勝敗集計へ混入させない

- First observed: 2026-09-08
- Scope: `src/source-client.js` の `normalizeReplay` とround_results保存要約。
- Required regression checks:
  1. Planner/Sol決定により、勝利扱いはprimitive integer `1..8`だけとする。unknown bounded integer（例: `9`）は保存できても勝利ラウンドとして解釈しない。
  2. 文字列、真偽値、null、負数、範囲外整数、小数は保存要約から除外し、勝敗派生にも混入させない。
  3. 保存されたvalues/countsと勝敗派生へ渡す入力集合を一致させる。不明な場合は安全側の未確定状態にする。
  4. targetがplayer1/player2のいずれでもself/opponentの順序を保持し、欠損側を空配列へ偽装しない。
  5. 旧履歴にround_resultsがなくてもロードでき、再取得なしに推測補完しない。
- Boundary: self/opponent双方が`[0]`または`[0, 0]`のall-zero配列は`draw`へ推測せず`unknown`とする。片側に`1..8`があるケースは既存の勝敗契約に従う。
- Evidence: `QA-MSO-ROUND-RESULTS-20260908-001`、`<temp>\qa-round-results-stage1-20260908\probe.cjs`、最新4ファイルのexact SHA、focused/全体テスト終了コード。
- Current finding（直前候補、後続FAILで無効化）: 公式SA4分割を反映した候補でall-zero・unknown・不正値・target binding、SA4 ratio→%、stale破棄、partial→forceRefresh→READYを独立確認した。しかし後続`pnpm qa:local` 28/30・終了コード1によりfocused/full/UIのPASS記録は現候補へ再利用しない。request count直接assert、実payload実行、package再生成、baseline/diffも未確認または停止中であり、これらが揃うまでStage1・比較機能・package・ClosedをHOLDとする。
- Additional visual/spec gap: 最新actualは見出し「過去100戦平均」に対し母数50戦であり、最大100戦の不足数表示仕様が未確定。round傾向カード全体がviewport内に写っていないため、2セクション全体の画面証拠も未確認。Plannerの仕様確定と同寸法wide/narrow baseline・actual・diffまでPASSに含めない。

## MATCHUP-PLAY-001: PLAY比較は情報を減らさず、未確認値をREADYにしない

- First observed: 2026-09-08
- Scope: Buckler `PLAY > 実績` タブの「過去100戦平均のバトルの傾向」の自分／相手比較と、相手プロフィール詳細画面。
- Purpose: Draft discussion（未承認）。完了済み試合の振り返り用途は最終確認後に確定する。
- Required regression checks:
  1. 自分と相手で同一定義・同一最大100戦窓を使用し、実サンプル数と取得時刻を両者に保持する。
  2. Driveゲージ使用分布、SAゲージ使用分布（Lv1/Lv2/Lv3/CAの4比率）、Drive Reversal、Parry、Just Parry、Drive Impact、Stun、Throw、Corner pressureを、同じ単位・尺度・丸めで対にして表示する。round_resultsのcode6=SA単一とは別契約とする。
  3. 実フィールド未確認、欠損、部分取得、取得中、取得不能、エラーは`—`または状態表示とし、0埋めや推測値をREADYにしない。
  4. `LOADING`、`READY`、`PARTIAL`、`INSUFFICIENT_SAMPLE`、`UNAVAILABLE`、`ERROR`を確認する。
  5. 内部診断情報（Source URL、Locale、内部ユーザーID）だけを画面から除外し、既存プロフィール6項目、ACT、取得時点、既存履歴を削除・置換しない。
  6. wide/narrowのDPR 1で横overflowがなく、値・ラベル・状態の意味が保持されることを確認する。
  7. `sample_count`と該当metric denominatorはREADY時に正、percentageは0..100、count/average/secondsはfiniteかつ非負とする。実測値0は正の母数がある場合だけ有効値として扱う。
- Historical negative evidence (修正前): `<temp>\qa-round-results-stage1-20260908\probe-zero-play.cjs`で、zero sample/zero denominator、percentage `-1`、`101`がいずれも`ready`になった（exit 1）。この結果は現候補の合格根拠に再利用しない。
- Historical official finding (SA4修正前): read-only DOM／`__NEXT_DATA__`で`play.battle_stats.gauge_rate_sa_lv1/lv2/lv3/ca`を確認した。値はratio（例: 0.2985, 0.0895, 0.4477, 0.1641）で、表示は29.85%、8.95%、44.77%、16.41%、合計≈100%。旧candidateは`saLevelAvailable=false`と単一`saGaugeUsage.usage`を採用していたためFAIL。この旧SHA・package・画面は再利用しない。
- Non-regression boundary: 認証済みBuckler実payloadが未提供の場合、候補field pathの適合を推測せず、実フィールドReadyを未確認として別課題に残す。実データ、Cookie、内部ID、URLをQA成果物へ含めない。
- Visible contract: 公式画面の「過去100戦平均のバトルの傾向」で、分布は%、回数系は平均回／戦、Cornerは平均秒／戦として扱う。Drive Impactの自分使用／相手使用は別サブセクションにする。画面ラベルの確認は内部payload pathの承認を意味しない。
- Source boundary: 勝率、キャラクターLP/MR、プレイポイント、試合数、エンジョイ等の`PLAY > 実績`外の値は比較グラフへ入れない。直接履歴の試合事実・プロフィールカードは別レイヤーで検証する。
- Pair/copy boundary: Draft discussion（未承認）。self/opponentの詳細バインドと用途文言は最終確認後に受入条件へ追加する。
- Draft hold: 直近の比較レイアウト、field priority、振り返り要約、レーダー扱い、追加copy、自分対相手の詳細案は受入判定へ使用しない。
- Automation/evidence: `tests/opponent-play-metrics.test.js`、`test-local/e2e/ui.spec.cjs` のMATCHUP/LOADINGケース、`pnpm qa:ui`、`QA-MSO-PLAY-20260908-001`。合成画面証拠は `<temp>\qa-play-metrics-20260908\` に保存する。
- QA operation: `src/opponent-play-metrics.js`、`src/main.js`、`src/renderer/renderer.js`、`src/renderer/index.html`、`src/renderer/midnight-glass.css`、`src/renderer/i18n.js`、関連テストを変更した場合は、対象SHAを更新してこの契約を再実行する。
- Rollback prevention: PLAY契約変更時は、Engineer着手前に本回帰契約とPLAYチケットを配布し、SA4・runtime E2E・既存zero/range境界を同一candidateで実行する。source/test/config/screenshot/packageが変わったら旧結果を無効化する。

## PLAY-SA-GAUGE-001: SAゲージ4分割をround_resultsと混同しない

- First observed: 2026-09-08
- Scope: Buckler PLAY比較のSAゲージ割合（Lv1/Lv2/Lv3/CA）。`round_results` code6=SAの単一項目は対象外の別契約。
- Official evidence: read-only DOM／`__NEXT_DATA__`で`play.battle_stats.gauge_rate_sa_lv1`、`gauge_rate_sa_lv2`、`gauge_rate_sa_lv3`、`gauge_rate_ca`を確認。観測値は29.85%、8.95%、44.77%、16.41%（payloadは0.2985/0.0895/0.4477/0.1641、合計≈100%）。
- Required checks: 4 pathをself/opponentへ同一期間・sampleで適用しratio→percentage（×100）する。primitive/object双方、missing、負数、1超、NaN/Infinity、合計不正、valid zeroをfail-closedで確認する。
- Current status: Conditional PASS/HOLD。最新candidateで4行（Lv1/Lv2/Lv3/CA）、ratio→%、合計≈100%、missing/negative/>1/NaN/Infinity/valid zero、DOM/E2Eを確認した。round code6=SA単一との分離も維持。request count直接assert、実payload実行、package再生成、baseline/diffは未確認または停止中。
- Latest evidence: focused 31/31、runtime E2E 3/3（UI内該当ケース）、`pnpm qa:local`（unit14・resize・UI30・screenshot17/17）、`pnpm qa:ui` 30/30、`pnpm check` 130/130、lint/diff-check exit 0。SA4 probeは`[29.85,8.95,44.77,16.41]`、合計99.98%、invalidはpartial、valid zeroは0を保持。画面actualのwide/narrow/profileで4行と横overflowなしを目視確認。
- Completion evidence: Engineer2が承認contract、unitの4値・負例、DOM 4ラベル/値、wide/narrow画像、runtime E2E、focused/full/qa:local/qa:ui/lint/diff、新SHAを返却し、QAが同一SHAで再実行する。

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

## HISTORY-FETCH-001: paginated battle-log import bootstraps before bounded overlap

- First observed: 2026-08-26
- Symptom: importing the maximum 100 battle-log records appeared to load one page at a time and did not leave a visible completion state.
- Required regression checks:
  1. Fetch page 1 first, then start only the needed pages in batches of at most three; a short/empty first page or `totalPages` metadata must prevent unnecessary requests.
  2. Keep the shared queue single-filed for live, authentication, ranking, and social requests while history requests use the explicit history start gap and three-request cap.
  3. Return the merged pages in page order and preserve duplicate merging.
  4. Report completed pages (not the highest page number) monotonically even when responses finish out of order.
  5. Keep the history list at 10 rows per display page and redraw it only after the batch completes; per-page progress must use the lightweight progress event.
  6. Publish the terminal completion state immediately after the page batch, before optional profile refresh or disk flushing, so a slow post-processing step cannot leave the UI in `読み込み中`.
  7. Show a persistent completion or partial-failure state with fetched count and page count.
  8. Preserve cancellation, generation checks, 429 handling, and the existing 10-minute manual-import cooldown.
  9. Verify every supported locale (`ja-jp`, `en`, `de`, `es-es`, `es-us`, `fr`, `it`, `ko-kr`, `zh-hans`, `zh-hant`, `pt-br`, `pl`, `ru`, `ar`) uses its own profile and Next data URL for each requested page; a locale switch must not mix old responses into the current batch.
- Non-regression boundary: live polling remains one page per poll and must not multiply its request volume.
- Automation: `tests/history-page-fetch.test.js` covers page-1 bootstrap, total-page/short-page stopping, bounded overlap, and ordered results; `tests/service-request-scheduler.test.js` covers the default single-filed queue, the explicit concurrency cap, and the history start gap.

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

## PLAYER-STATUS-001: social list stays inside its panel and preserves surrounding controls

- First observed: 2026-09-03
- Symptom: a large PLAYER STATUS result set expanded the social panel to its content height and pushed the STEP 03 display controls below the viewport. A later layout change made the social list collapse at the 840px responsive boundary.
- Required regression checks:
  1. Push a synthetic `social:state` with more rows than the available list area; use no real account, cookie, or external service data.
  2. Confirm the list's excess content scrolls inside `#socialList` (`scrollHeight > clientHeight`) and does not expand `social-panel` or push the display/history panels out of the viewport.
  3. Confirm the one-page data contract remains 10 items per page; do not interpret it as a requirement to show 10 rows simultaneously or as a fixed visible-row count.
  4. Repeat at the standard management viewport and at the `max-width:840px` responsive boundary. Cockpit-level scrolling may be used there, but `#socialList` must retain a non-zero display area and its own overflow behavior.
  5. Confirm the PLAYER STATUS outer frame, recent-history five-row contract, and STEP 03 controls remain non-overlapping.
- Non-regression boundary: Friends/Following tab switching and live social updates must continue to work without reopening the management screen; external service requests remain out of scope for the synthetic layout check.
- Automation/evidence: `test-local/e2e/ui.spec.cjs:854-900` records the synthetic 10-row standard/responsive geometry contract and verifies internal scrolling. The ticket was closed after the four viewport cases and full local QA passed.
- QA operation: run this contract whenever `src/renderer/style.css`, `src/renderer/midnight-glass.css`, `src/renderer/index.html`, the management grid, or social-state rendering changes.
