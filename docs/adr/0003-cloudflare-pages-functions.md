---
status: accepted
---

# ホスティング/バックエンドを Cloudflare Pages + Pages Functions に固定

フロントの静的配信とバックエンド（GitHub 操作・LLM 呼び出し）を Cloudflare Pages + Pages Functions（`/functions`）で構成する。スタンドアロン Workers や他クラウドも検討したが、無料枠・Cloudflare Access との統合・デプロイの容易さで Pages が最適。secret をブラウザに出さないため、GitHub/Gemini 呼び出しは必ず Functions 経由にする。デプロイ先のロックインを伴う決定。
