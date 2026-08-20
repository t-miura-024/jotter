---
status: accepted
---

# 全ローディングをスケルトンで統一する

plan list と repo sidebar のローディング表現が箇所ごとにバラバラ（plan list はスピナー+テキスト、repo stats は「…」/「–」、MobileRepoButton はスピナー）で、視覚的一貫性とレイアウトシフトに欠けていた。plan list / repo sidebar(stats含む) / MobileRepoButton / Drawer の全ローディングを、実レイアウト準拠のスケルトン（`animate-pulse` + `prefers-reduced-motion` で停止）で統一する。基盤は `src/components/ui/skeleton.tsx` に最小の `Skeleton` コンポーネントを自前実装し、追加依存なしで完結させる。jot 提出中の `SubmitOverlay`（紙飛行機アニメーション）はローディングとは別概念として対象外とする。loading 中は純粋にスケルトンのみを表示し、error は従来のエラーパネル、空は「なし」、キャッシュヒット時はスケルトンをスキップして即 `ready` を表示する。

## Considered Options

- スピナー継続: 実装コストは0だが、レイアウトシフトと一貫性の課題が残るため却下
- shimmer アニメーション: 高級感はあるが追加 keyframes が必要で reduced-motion 対応も複雑なため却下、pulse を採用
- `shadcn add skeleton` での正式導入: 公式追従の利点はあるが CLI 運用が増えるため却下、自前実装で shadcn 互換 API を維持
- 汎用矩形スケルトン（グループ構造を潰す）: 実装は容易だが plan list の5分類というドメイン構造が loading 中だけ消えるため却下、5グループ×各2行の同型スケルトンを採用
