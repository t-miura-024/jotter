import { GitHubClient } from "../_github/client";
import { listInternalRepos } from "../_github/repos";
import type { Env } from "../_types";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * GET /api/repos — 内部 repo（INTERNAL_OWNER 配下）の軽量な一覧取得。
 *
 * 集計（Status 別件数）は含めず、repo navigation の責務だけを担う（ADR 0011）。
 * 件数は GET /api/repo-stats が独立して提供し、stats 障害で navigation を失わせない。
 * secret はサーバー側（env）に留め、ブラウザには出さない。
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }

  try {
    const client = new GitHubClient({ token: env.GITHUB_PAT });
    const repos = await listInternalRepos(client);
    return json({ repos });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `リポジトリ一覧の取得に失敗しました: ${message}` }, 502);
  }
};
