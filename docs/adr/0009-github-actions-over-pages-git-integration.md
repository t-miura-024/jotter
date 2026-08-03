---
status: accepted
---

# Cloudflare Pages Git 連携ではなく GitHub Actions でデプロイする

Cloudflare Pages へのデプロイ自動化には Pages の Git 連携というゼロ設定の選択肢があるが、GitHub Actions + `cloudflare/wrangler-action` を採用する。デプロイ前に typecheck・lint・test のゲートを必ず通したいのが理由で、Git 連携のゼロ設定性と自動 preview デプロイは捨てる。

## Considered Options

- Cloudflare Pages Git 連携: ゼロ設定・preview デプロイ付きだが、デプロイ前に任意の検証ゲートを挟めない
- GitHub Actions + wrangler-action: secrets 管理が必要だが、デプロイ前の検証ゲートを自由に構成でき、今後の CI 拡張とも再利用できる
