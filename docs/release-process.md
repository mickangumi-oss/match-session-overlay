# リリース手順

この手順は、Match Session OverlayのWindows向け正式リリースに使用します。公開対象を固定し、ソース、完成したインストーラー、更新マニフェストを別々に検証します。

## 1. リリース候補を固定する

- バージョン、README、リリースノート、依存関係を更新する
- `pnpm check`を完了する
- 公開予定の変更をレビューし、リリース候補をコミットする
- `git status --short`が空であることを確認する

## 2. Codex Securityでソースを検査する

最初に、認証情報を読み込まず対象と出力先だけを検証します。

```powershell
pnpm release:security:dry-run
```

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

Codex Securityを通過した後にリリース入力を変更した場合は、再スキャン後にインストーラーも作り直します。

## 4. 完成物を検査する

- リポジトリと`app.asar`に秘密情報、実在ユーザー情報、ローカル絶対パスが含まれないことを確認する
- 完成したインストーラーへMicrosoft Defender検査を実施する
- 公開アップロードの明示許可を得た場合のみ、同一ハッシュのインストーラーをVirusTotalへ送る
- インストーラーと更新マニフェストのファイル名、バージョン、SHA-256が一致することを確認する

Codex Securityはソースコードの検査です。Microsoft Defender、VirusTotal、秘密情報検査、SHA-256照合の代わりにはなりません。

## 5. 公開後に確認する

- タグが意図したコミットを指している
- GitHub Releaseのインストーラーと更新マニフェストが正しい
- ダウンロードしたファイルのSHA-256がローカル検査済みファイルと一致する
- READMEとリリースノートのリンク・バージョン・検査結果が一致する
