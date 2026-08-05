import { apiFetch } from "@/lib/api";

/**
 * GET /api/repo-stats のクライアント（ADR 0011）。
 *
 * - 通常表示はサーバー側（Cloudflare Cache API）キャッシュを利用する。
 * - 手動リフレッシュ・起票成功時は ?bypass=1 で cache bypass し、
 *   サーバーキャッシュもクライアントメモリキャッシュも迂回して強制更新する。
 */

export type RepoStatsStatus = "draft" | "refined" | "in-progress" | "done" | "unregistered";

export type RepoStatsCounts = Record<RepoStatsStatus, number>;

export type RepoStatsEntry = {
  owner: string;
  name: string;
  fullName: string;
  counts: RepoStatsCounts;
};

export type RepoStatsResponse = {
  repos: RepoStatsEntry[];
  fetchedAt: string;
};

/** クライアント側メモリキャッシュ（リフレッシュ・起票成功まで再 fetch しない）。 */
let statsCache: RepoStatsResponse | null = null;

/** キャッシュされた repo stats を返す。未取得なら null。 */
export function getCachedRepoStats(): RepoStatsResponse | null {
  return statsCache;
}

/**
 * /api/repo-stats を取得し、メモリキャッシュへ保存する。
 * force が true のときは cache bypass（?bypass=1）でサーバーから強制再取得する。
 */
export async function fetchRepoStats(force: boolean): Promise<RepoStatsResponse> {
  const query = force ? "?bypass=1" : "";
  const response = await apiFetch(`/api/repo-stats${query}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  const data = (await response.json()) as RepoStatsResponse;
  statsCache = data;
  return data;
}

/** キャッシュを破棄する（リフレッシュ・起票成功後に再 fetch させる用途）。 */
export function invalidateRepoStatsCache(): void {
  statsCache = null;
}
