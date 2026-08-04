import { apiFetch } from "@/lib/api";

/** GitHub Project「plans」の Status 別 5 グループ（/api/plans の status と対応）。 */
export type PlanStatus = "draft" | "refined" | "in-progress" | "done" | "unregistered";

/** 計画一覧の 1 件（open な kind/plan Issue + Project Status）。 */
export type PlanItem = {
  number: number;
  title: string;
  url: string;
  /** Issue 本文（Markdown）。詳細モーダルでプレビューする。 */
  body: string;
  updatedAt: string;
  status: PlanStatus;
};

/**
 * クライアント側メモリキャッシュ（ADR 0006: サーバは stateless、KV/CDN キャッシュは持たない）。
 * 取得済みデータはリフレッシュボタン押下または起票成功まで再 fetch されない。
 */
const plansCache = new Map<string, PlanItem[]>();

/** キャッシュされた計画一覧を返す。未取得なら undefined。 */
export function getCachedPlans(repo: string): PlanItem[] | undefined {
  return plansCache.get(repo);
}

/** /api/plans から計画一覧を取得し、メモリキャッシュへ保存する。 */
export async function fetchPlans(repo: string): Promise<PlanItem[]> {
  const response = await apiFetch(`/api/plans?repo=${encodeURIComponent(repo)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  const data = (await response.json()) as { plans: PlanItem[] };
  plansCache.set(repo, data.plans);
  return data.plans;
}

/** キャッシュをすべて破棄する（起票成功後に再 fetch させる用途）。 */
export function invalidatePlansCache(): void {
  plansCache.clear();
}
