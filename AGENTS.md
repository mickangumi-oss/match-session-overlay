# Match Session Overlay task rules

このリポジトリに関する全タスク（調査、実装、テスト、ビルド、リリース、運用確認）は、開始時に `docs/codex-context.md` を読み、対象リポジトリを明示した code-review-graph の read-only preflight を実行する。

## Graph preflight

- `detect_changes_tool` または `get_review_context_tool` を最初のコード調査として使い、変更対象と依存関係の最小コンテキストだけを取得する。必要な場合のみ `query_graph_tool` / `semantic_search_nodes_tool` を追加する。
- グラフDBはリポジトリ外の `C:\Users\zuga\CodexWork\tools\code-review-graph\data` を使う。認証情報、秘密鍵、ブラウザデータ、個人情報、外部操作権限を入力しない。
- MCPが見えない場合は、同じタスクの検証済み code-review-graph CLI を使う。MCP/CLIが使えない場合は失敗理由を記録し、対象ファイルだけを直接確認する。グラフの推定削減量は参考値であり、作業を省略する根拠にしない。
- ソース、依存、設定を変更したらグラフの鮮度を無効にして更新し、必要なQAをやり直す。

## Build and release

- graph preflightは `pnpm check`、`pnpm qa:local`、security dry-run、installer build、manifest、署名、ハッシュ、Defender、VirusTotal、公開後確認より先に行う。
- `docs/release-process.md` の既存ゲート、明示承認、秘密情報保護、公開条件を必ず維持する。graph preflightだけでビルド成功、署名、公開可否を判断しない。
- アプリ本体と兄弟LPリポジトリの変更・QA・コミット・公開を混ぜない。

## Context and safety

- 長い過去会話やリポジトリ全文を読み込まず、graph結果と依頼に直接関係するファイルへ範囲を限定する。
- 実装は通常Luna、read-only独立レビューはQwen、通常の統合・最終判断はLunaが担当する。認証、公開、破壊的変更、高難度の設計判断はSolへ戻す。
- 完了報告には graph preflight の対象リポジトリ・結果、変更ファイル、テスト終了コード、未解決事項を記録する。
