import { apiFetch } from "@/lib/api";
import type { Monologue } from "../../shared/monologue";

/** GET /api/monologues のレスポンス。 */
export type MonologuesResponse = {
  month: string;
  monologues: Monologue[];
  fetchedAt: string;
  /** 単日取得失敗時のみ存在する。 */
  warnings?: string[];
  failedDates?: string[];
};

/** fetchMonologues の返却（一覧＋単日取得失敗の警告）。 */
export type MonologuesResult = {
  monologues: Monologue[];
  warnings?: string[];
  failedDates?: string[];
};

/**
 * クライアント側メモリキャッシュ（月キー。plans.ts パターン）。
 * 取得済みデータは invalidate まで再 fetch されない。
 */
const monologuesCache = new Map<string, Monologue[]>();

/** キャッシュされた対象月の Monologue 一覧を返す。未取得なら undefined。 */
export function getCachedMonologues(month: string): Monologue[] | undefined {
  return monologuesCache.get(month);
}

/** /api/monologues から対象月の Monologue 一覧を取得し、メモリキャッシュへ保存する。 */
export async function fetchMonologues(month: string): Promise<MonologuesResult> {
  const response = await apiFetch(`/api/monologues?month=${encodeURIComponent(month)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  const data = (await response.json()) as MonologuesResponse;
  monologuesCache.set(month, data.monologues);
  return { monologues: data.monologues, warnings: data.warnings, failedDates: data.failedDates };
}

/** キャッシュをすべて破棄する（作成成功後に再 fetch させる用途）。 */
export function invalidateMonologuesCache(): void {
  monologuesCache.clear();
}
