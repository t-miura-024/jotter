/**
 * Cloudflare Cache API の解決（ADR 0011）。
 *
 * 実行環境（workerd）では `caches.default` が使える。テスト環境には無いため、
 * グローバルを解決する関数として切り出し、テストでは vi.stubGlobal で差し替える。
 */
export type RepoStatsCache = {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
};

/** 実行環境の Cache API を返す。利用できない環境では undefined。 */
export function resolveStatsCache(): RepoStatsCache | undefined {
  const global = globalThis as { caches?: { default?: RepoStatsCache } };
  return global.caches?.default;
}
