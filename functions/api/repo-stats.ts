import { GitHubClient } from "../_github/client";
import { listInternalRepos } from "../_github/repos";
import { fetchRepoStats } from "../_github/stats";
import { resolveStatsCache } from "../_lib/repo-stats-cache";
import type { Env } from "../_types";

/** repo stats のキャッシュ TTL（数分の範囲内。AI 判断範囲）。 */
const STATS_CACHE_MAX_AGE_SECONDS = 300;

const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** キャッシュキー: クエリ（bypass）を含めない canonical URL。 */
function cacheKey(url: URL): string {
  const key = new URL(url.origin);
  key.pathname = url.pathname;
  return key.toString();
}

/**
 * GET /api/repo-stats — 全内部 repo の Status 別件数を返す（ADR 0011）。
 *
 * - Project items を GraphQL で一度だけ全ページ取得し、repo ごとの open な kind/plan Issue と
 *   並列取得で突き合わせて 5 件数を集計する。repo の増減は repo 一覧から自動反映される。
 * - 結果は Cloudflare Cache API で数分間キャッシュする。通常表示（bypass なし）はキャッシュを
 *   利用し、手動リフレッシュ・起票成功時（?bypass=1）はキャッシュを読まずに GitHub から
 *   再取得してキャッシュを上書きする（表示の同期）。
 * - 取得失敗は endpoint 全体の 502 として返す（部分的な集計は返さない）。
 *   縮退表示（件数 – と再取得導線）はクライアント側の責務。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }

  const url = new URL(request.url);
  const bypass = url.searchParams.get("bypass") === "1";
  const cache = resolveStatsCache();
  const key = cacheKey(url);

  // 通常表示はキャッシュを利用する。bypass はキャッシュを読まない
  // （キーは共通で、取得後に上書きして次の通常表示を同期する）。
  if (!bypass && cache) {
    try {
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch {
      // キャッシュ障害時は直接取得へフォールバック（表示を優先する）。
    }
  }

  try {
    const client = new GitHubClient({ token: env.GITHUB_PAT });
    const repos = await listInternalRepos(client);
    const stats = await fetchRepoStats(client, repos, { projectId: env.PROJECT_ID });
    const response = json(
      { repos: stats, fetchedAt: new Date().toISOString() },
      200,
      { "Cache-Control": `public, max-age=${STATS_CACHE_MAX_AGE_SECONDS}` },
    );

    if (cache) {
      try {
        await cache.put(key, response.clone());
      } catch {
        // キャッシュ書き込み失敗は表示を優先して無視する。
      }
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `repo stats の取得に失敗しました: ${message}` }, 502);
  }
};
