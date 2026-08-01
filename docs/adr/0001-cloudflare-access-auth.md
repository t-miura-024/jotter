---
status: accepted
---

# 認証を Cloudflare Access に委譲しアプリに認証コードを持たせない

個人単一ユーザーの Cloudflare 固定運用のため、認証は Cloudflare Access（Zero Trust, Google IdP, 本人 Gmail のみ許可）でインフラ層に委譲し、アプリ側に認証コードを一切置かない。アプリ内 GIS による自前認証も検討したが、Pages Functions を薄く保て、無料枠で運用できる Access が圧倒的に薄い。多ユーザー化が必要になった時点で再検討する。
