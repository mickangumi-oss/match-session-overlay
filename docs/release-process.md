# リリース手順

この手順は、Match Session OverlayのWindows向け正式リリースに使用します。公開対象を固定し、ソース、完成したインストーラー、更新マニフェストを別々に検証します。

## 0. code-review-graphのリリース前preflight

- リリース作業を始める前に、このリポジトリを明示してcode-review-graphのread-only `detect_changes_tool` または `get_review_context_tool` を実行し、変更対象と依存関係の最小コンテキストを取得する。
- MCPが見えない場合は、同じタスクの検証済みCLIで代替する。グラフDBはリポジトリ外の `%USERPROFILE%\CodexWork\tools\code-review-graph\data` 配下に置き、認証情報、秘密鍵、ブラウザデータ、個人情報、外部操作権限を渡さない。
- graph preflightは以降のcheck、QA、Codex Security、build、署名、ハッシュ、Defender、VirusTotal、公開後確認の入口を整理するためのものであり、これらのゲートや明示承認を省略・代替しない。ソース、依存、設定を変更したらグラフを更新し、影響するQAをやり直す。

## 1. リリース候補を固定する

- バージョン、README、リリースノート、依存関係を更新する
- `pnpm check`を完了する
- 公開予定の変更をレビューし、リリース候補をコミットする
- `git status --short`が空であることを確認する

## QAの適用範囲

- QAは、今回の変更が影響する機能、画面、データ経路に限定して実施してよい
- 変更と無関係なテスト、検証、画面キャプチャは省略できる
- 変更対象の正常系、異常系、回帰確認は省略しない
- `pnpm check`、リリース成果物の整合性確認、署名・ハッシュ検証などのリリースゲートは、変更範囲にかかわらず実施する
- 省略したテストと、その理由をリリース記録および完了報告に明記する
- QA完了後にソース、依存関係、設定、リリースノートを変更した場合は、影響するQAを無効として再実行する

## リリースノートの記載範囲

- 前回リリースと今回のリリース候補を比較し、ユーザーが利用できる追加機能・表示変更・仕様変更を記載する
- 前回リリース以前から存在していた、今回解消したユーザー影響のある不具合は、再発防止のため記載する
- 今回の開発中に発生して同じリリース内で解消した不具合、内部リファクタリング、テスト専用の修正、リリース作業上の調整は記載しない
- 不具合を記載する場合は、ユーザーが確認できる症状と改善結果だけを簡潔に示し、内部実装の詳細は含めない
- 記載対象の判断に迷う場合は、前回リリース時点で存在していたか、ユーザー影響があるかを基準に分類する

## 2. Codex Securityでソースを検査する

最初に、認証情報を読み込まず対象と出力先だけを検証します。

```powershell
pnpm release:security:dry-run
```

通常の開発中は、変更の早期確認として軽量なpreflightを使えます。正式リリース結果とは別の外部ディレクトリへ保存し、標準スキャンとGit diff・complete coverage・Medium以上での停止は維持しますが、モデルを`gpt-5.6-terra`、推論を`high`に固定してコストを抑えます。

```powershell
pnpm release:security:preflight:dry-run
pnpm release:security:preflight
```

preflightの結果は`..\_tools\codex-security\results\match-session-overlay\v<version>-preflight`に保存され、正式結果を上書きしません。必要な場合だけ、明示的な上限を設定できます。上限到達はスキャン失敗として停止します。

```powershell
$env:CODEX_SECURITY_PREFLIGHT_MAX_COST = "4.5" # 任意。組織の予算に合わせて設定
pnpm release:security:preflight
```

preflightは開発中の確認専用です。Terra/Lunaの結果だけで公開可否を決めず、リリース候補の最終判定には必ず次の厳格な`release:security`を実行します。これは正式ゲートの検出品質と再現性を、日常確認のコスト最適化から分離するためです。

続いて、固定済みコミットを読み取り専用の標準スキャンにかけます。

```powershell
pnpm release:security
```

このコマンドは、開発用フォルダにまとめたCodex Security CLIを使用します。

- 対象: このGitリポジトリ全体
- 認証: 既存のChatGPTサインイン（自動ログインやAPIキー保存は行わない）
- 結果: `..\_tools\codex-security\results\match-session-overlay\v<version>`
- 判定: Medium以上の検出、スキャンエラー、不完全なcoverageで停止
- 再実行: 同じバージョンの前回結果はCLIのアーカイブ機能で退避

`report.md`、`findings.json`、`coverage.json`を確認します。Lowの指摘も公開前に内容を確認します。誤検知の判断や修正は別作業として行い、ソースまたは依存関係を変更した場合は、リリース候補を再度固定してCodex Securityをやり直します。

認証に失敗した場合は、スキャンを省略したりAPIキーをリポジトリへ追加したりせず、公開を停止します。CLIの認証用フォルダに関するACLエラーが出た場合も、`icacls`などで手動回避せず確認を求めます。

## 3. 最終インストーラーを一度だけ作る

```powershell
pnpm build
pnpm release:manifest
```

更新マニフェストは、リポジトリ外の次の秘密鍵でEd25519署名します。

```text
%USERPROFILE%\.match-session-overlay-secrets\update-signing-ed25519-private.pem
```

- 秘密鍵はGit、リリース資産、インストーラーへ含めない
- 秘密鍵のACLは現在のWindowsユーザーだけに限定する
- 秘密鍵を紛失すると、既存アプリ向けの更新マニフェストを署名できなくなるため、安全な別媒体へバックアップする
- 別の場所を使う場合だけ`MATCH_SESSION_OVERLAY_UPDATE_SIGNING_KEY_PATH`で絶対パスを指定する
- `pnpm release:manifest`は、署名後にアプリ内の公開鍵でも検証し、一致しない鍵では失敗する

Codex Securityを通過した後にリリース入力を変更した場合は、再スキャン後にインストーラーも作り直します。

## 4. 完成物を検査する

- リポジトリと`app.asar`に秘密情報、実在ユーザー情報、ローカル絶対パスが含まれないことを確認する
- 完成したインストーラーへMicrosoft Defender検査を実施する
- 継続承認済みの必須工程として、完成したインストーラー**だけ**をVirusTotalへ公開アップロードする（ソース、`app.asar`、更新マニフェスト、認証情報、秘密鍵、ユーザーデータは送らない）
- VirusTotalの完全解析が終わるまで待ち、VirusTotal上のSHA-256、検出数／総エンジン数、解析完了日時、公開レポートURLを記録する
- VirusTotal上のSHA-256がローカルの最終インストーラーと一致することを確認する
- アップロード失敗、ハッシュ不一致、解析未完了、または検出が1件以上の場合は公開を停止し、成功結果をリリースノートへ記載しない
- インストーラーと更新マニフェストのファイル名、バージョン、SHA-256が一致することを確認する

Codex Securityはソースコードの検査です。Microsoft Defender、VirusTotal、秘密情報検査、SHA-256照合の代わりにはなりません。

## 5. 公開後に確認する

- タグが意図したコミットを指している
- GitHub Releaseのインストーラーと更新マニフェストが正しい
- ダウンロードしたファイルのSHA-256がローカル検査済みファイルと一致する
- READMEとリリースノートのリンク・バージョン・検査結果が一致する
