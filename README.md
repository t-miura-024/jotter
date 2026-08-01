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

- ローカル: `.dev.vars.example` を `.dev.vars` にコピーして値を設定（`wrangler pages dev` が読み込みます）。
- 本番: `pnpm wrangler pages secret put GITHUB_PAT`（他も同様に `secret put`）。

## 起票ルール

- LLM 整形: Gemini が jot からタイトルを抽出し、本文を読みやすい Markdown へ清書します（[ADR 0007](docs/adr/0007-faithful-llm-formatting.md)。忠実な記録のみで、内容の改変・肉付けはしない）
- モデル: 優先モデル（GUI セレクタで選択）を試し、失敗時は自動的に別モデルへフォールバック（[ADR 0005](docs/adr/0005-gemini-speed-first-fallback.md)）。結果の `modelUsed` / `fallbackOccurred` を UI に表示します
- target ルーティング: `t-miura-024/*` 指定 → その repo に直接起票。外部 repo 指定または未指定 → note inbox（`t-miura-024/note`）に集約し、由来を示す `external/{owner}-{name}`（または `external/others`）label を付与
- label: `kind/plan` を冪等に確保（`gh label create --force` 相当）して付与
- Project 連携: 3 つの Project secret がすべて設定されている場合、起票後に ProjectV2 へ item 追加 + Status=draft を設定。best-effort で、失敗しても起票は成功として扱い `projectAdded: false` を UI に表示します

## デプロイ

```bash
pnpm build
pnpm pages:deploy   # または Cloudflare Pages の Git 連携
```

## Cloudflare Access のセットアップ（必須・手動）

このアプリは Cloudflare Access 経由でのみアクセス可能にします（コードでは設定できないため手動手順）。

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Access** → **Applications** → **Add an application**
2. Application type: **Self-hosted**
3. Application domain: Pages プロジェクトのドメイン（例: `jotter.pages.dev`）を指定。
   `/api/*` を含むドメイン全体に Access がかかります。
4. Identity provider の追加: **Google**
   （未設定の場合は Access → Settings → Authentication → Login methods で Google OAuth クライアントを先に登録）
5. Access policy を 1 件追加:
   - Action: **Allow**
   - Include rules → Selector: **Emails** → 本人の Gmail アドレスのみ指定
6. 保存すると、未認証アクセスは Google サインインへリダイレクトされ、許可した Gmail 以外からはアプリ（API 含む）に到達できなくなります。

詳細: [ADR 0001](docs/adr/0001-cloudflare-access-auth.md)

## Scripts

| コマンド            | 内容                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm dev`          | Vite dev server（/api は 8788 へプロキシ）            |
| `pnpm build`        | typecheck + 本番ビルド（`dist/`）                     |
| `pnpm typecheck`    | `tsc -b`（app / node / functions の 3 プロジェクト）  |
| `pnpm test`         | vitest（Pages Functions の単体テスト）                |
| `pnpm lint`         | oxlint                                                |
| `pnpm format`       | oxfmt                                                 |
| `pnpm pages:dev`    | ビルド + `wrangler pages dev`（ローカルフルスタック） |
| `pnpm pages:deploy` | `wrangler pages deploy dist`                          |
