---
status: accepted
---

# フロントエンドを Vite + React + Tailwind v4 + shadcn/ui に固定

既存 kozo-share の投資済み慣習（React 19 + Tailwind v4 + shadcn/radix + motion + lucide-react + Geist）に準拠する。メタフレームワークは、jotter が単一画面のアプリ型 SPA（コンテンツサイトではない）ため Astro ではなく Vite を採用する。コンポーネント資産と設計言語を再利用でき、デプロイ先（Cloudflare Pages）とも相性が良い。フレームワークのロックインを伴う決定。
