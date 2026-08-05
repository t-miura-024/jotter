# jotter

ブラウザから走り書き（jot）を送信し、GitHub に draft 計画 Issue を自動起票する個人ツール。`mt plan draft` CLI の GUI 版。

## Stack

- Frontend: Vite + React 19 + Tailwind CSS v4 + shadcn/ui（+ motion / lucide-react / Geist）
- Backend: Cloudflare Pages Functions（GitHub REST API 連携。secret はすべてサーバー側で保持）
- 認証: Cloudflare Access（Google IdP）— アプリに認証コードは一切なし（[ADR 0001](docs/adr/0001-cloudflare-access-auth.md)）
- 状態: ステートレス。履歴は起票先 GitHub に自然に残る（[ADR 0006](docs/adr/0006-stateless-mvp.md)）

## 要件

- Node.js >= 22.12
- pnpm

## ローカル開発

```bash
pnpm install
```

### フロントエンド + Functions 一括（推奨）

```bash
pnpm pages:dev   # vite build のあと wrangler pages dev（http://localhost:8788）
```

### フロントエンド単独（HMR 優先）

```bash
pnpm pages:dev   # 別ターミナルで API 側を起動しておく
pnpm dev         # http://localhost:5173（/api/* は localhost:8788 へプロキシ）
```

## Secrets / 環境変数

| 名前                | 必須 | 説明                                                                                                                               |
| ------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_PAT`        | ✅   | GitHub Classic PAT（scope: `repo` + `project`、[ADR 0002](docs/adr/0002-github-classic-pat.md)）。ブラウザには一切公開されません。 |
| `GEMINI_API_KEY`    | ✅   | Gemini API key（LLM 整形用、[ADR 0005](docs/adr/0005-gemini-speed-first-fallback.md)）。未設定時は起票リクエストが 500 になります。 |
| `PROJECT_ID`        | 任意 | GitHub ProjectV2 の node ID（`PVT_...`）。3 つすべて揃えると Project 連携が有効化されます。                                        |
| `STATUS_FIELD_ID`   | 任意 | ProjectV2 の Status フィールド ID（`PVTSSF_...`）。                                                                                |
| `STATUS_OPTION_ID`  | 任意 | Status=draft の option ID。                                                                                                        |
| `CLOUDFLARE_API_TOKEN` | CI  | Cloudflare API トークン（Pages: Edit 権限）。GitHub Actions による自動デプロイ専用で、アプリのランタイムでは使いません。           |
| `CLOUDFLARE_ACCOUNT_ID` | CI | Cloudflare Account ID。同上。                                                                                                      |

- ローカル: `.dev.vars.example` を `.dev.vars` にコピーして値を設定（`wrangler pages dev` が読み込みます）。
- 本番: `pnpm wrangler pages secret put GITHUB_PAT`（他も同様に `secret put`）。
- CI 用（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）: GitHub の Settings → Secrets and variables → Actions に repo secret として登録します（コードでは設定不可）。

## 起票ルール

- LLM 整形: Gemini が jot からタイトルを抽出し、本文を読みやすい Markdown へ清書します（[ADR 0007](docs/adr/0007-faithful-llm-formatting.md)。忠実な記録のみで、内容の改変・肉付けはしない）
- モデル: 優先モデル（GUI セレクタで選択）を試し、失敗時は自動的に別モデルへフォールバック（[ADR 0005](docs/adr/0005-gemini-speed-first-fallback.md)）。結果の `modelUsed` / `fallbackOccurred` を UI に表示します
- target ルーティング: 選択中の内部 repo（`t-miura-024/*`）へ直接起票。note inbox 選択時（既定）は note inbox（`t-miura-024/note`）へ起票し、外部 repo 入力があるときだけ由来を示す `external/{owner}-{name}` label を付与（`external/others` は新規付与しない）。外部 repo 入力は note inbox 選択時の JotDialog に限定され、外部 repo の plan list 閲覧はしない
- label: `kind/plan` を冪等に確保（`gh label create --force` 相当）して付与
- Project 連携: 3 つの Project secret がすべて設定されている場合、起票後に ProjectV2 へ item 追加 + Status=draft を設定。best-effort で、失敗しても起票は成功として扱い `projectAdded: false` を UI に表示します

## デプロイ

`main` ブランチへの push で GitHub Actions が自動実行されます（[ADR 0009](docs/adr/0009-github-actions-over-pages-git-integration.md)）。build（typecheck 内包）→ lint → test のすべて合格後に Cloudflare Pages へデプロイされ、いずれかが失敗した場合はデプロイされません。デプロイ中の新たな push は古い run をキャンセルして優先されます。

前提: GitHub の repo secrets に `CLOUDFLARE_API_TOKEN`（Pages: Edit 権限の API トークン）と `CLOUDFLARE_ACCOUNT_ID` が登録済みであること（上記 Secrets / 環境変数節の CI 用項目参照）。

### 非常時の手動デプロイ

CI が使えない場合のみ、ローカルから手動デプロイします:

```bash
pnpm build
pnpm pages:deploy
```

## PWA

vite-plugin-pwa（generateSW）で PWA 対応済み。

- インストール: スマホの「ホーム画面に追加」/ デスクトップ Chrome のインストールからインストールでき、standalone で起動します
- オフライン: 静的アセット（app shell）は precache され、オフラインでも UI が開きます。起票はネットワーク必須のため、オフライン中に起票すると専用メッセージ + リトライボタンを表示し、jot 本文は保持されます。オフラインキューイングは設計上不導入です（[ADR 0006](docs/adr/0006-stateless-mvp.md)）
- 更新: 新バージョンのデプロイを検知するとトーストで知らせ、ユーザー操作でリロードして適用します（`registerType: prompt`。サイレント自動更新はしません）
- キャッシュ範囲: 静的アセットのみ。`/api/*` のレスポンスと Cloudflare Access のログインリダイレクトは Service Worker に一切キャッシュされません
- 開発: `pnpm dev` では Service Worker を登録しません。PWA 挙動の確認は `pnpm pages:dev` で行ってください
- アイコン: `public/favicon.svg` から `pnpm icons:generate`（scripts/generate-icons.mjs）で再生成できます

## Cloudflare Access のセットアップ（必須・手動）

このアプリは Cloudflare Access 経由でのみアクセス可能にします（コードでは設定できないため手動手順）。

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **Zero Trust** → **Access controls** → **Applications** → **Create new application**
2. **Self-hosted and private** → **Add public hostname**
3. Application domain: Pages プロジェクトのドメイン（例: `jotter.pages.dev`）を指定し、
   **Path** に `/api/*` を設定して保護範囲を API のみに絞る。
   app shell と `sw.js` は保護外の公開とし、PWA の更新が Access に阻害されないようにする。
   セッション切れは app 側が Access のリダイレクトを `opaqueredirect` として検知し、
   `/api/auth/return` 経由の再ログインへ誘導する。
4. Identity provider の追加: **Google**
   （未設定の場合は Zero Trust → **Integrations** → **Identity providers** → **Add new identity provider** → Google で OAuth クライアントを先に登録）
5. Access policy を 1 件追加:
   - Action: **Allow**
   - Include rules → Selector: **Emails** → 本人の Gmail アドレスのみ指定
6. 保存すると、未認証アクセスは Google サインインへリダイレクトされ、許可した Gmail 以外からはアプリ（API 含む）に到達できなくなります。

詳細: [ADR 0001](docs/adr/0001-cloudflare-access-auth.md)

## Scripts

| コマンド              | 内容                                                  |
| --------------------- | ----------------------------------------------------- |
| `pnpm dev`            | Vite dev server（/api は 8788 へプロキシ）            |
| `pnpm build`          | typecheck + 本番ビルド（`dist/`）                     |
| `pnpm typecheck`      | `tsc -b`（app / node / functions の 3 プロジェクト）  |
| `pnpm test`           | vitest（Pages Functions の単体テスト）                |
| `pnpm lint`           | oxlint                                                |
| `pnpm format`         | oxfmt                                                 |
| `pnpm pages:dev`      | ビルド + `wrangler pages dev`（ローカルフルスタック） |
| `pnpm pages:deploy`   | `wrangler pages deploy dist`                          |
| `pnpm icons:generate` | `public/favicon.svg` から PWA アイコン PNG を再生成   |
