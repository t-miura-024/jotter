import { GitHubClient } from "../_github/client";
import { listPlans } from "../_github/plans";
import { NOTE_INBOX, parseRepoRef } from "../_github/target";
import type { Env } from "../_types";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * GET /api/plans?repo=owner/name — open な kind/plan Issue 一覧を Project Status 付きで返す。
 *
 * - repo 未指定・不正形式は note inbox へ縮退（起票時の repo 未指定と整合）。
 * - 外部 repo を指定した場合はそのままその repo の一覧を返す
 *   （閲覧対象と起票先は別概念。起票先は /api/submit の determineTarget が決める）。
 * - Status 解決失敗時は unregistered へ縮退し、一覧取得自体は失敗させない。
 * - secret はサーバー側（env）に留め、ブラウザには出さない（ADR 0002）。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }

  const url = new URL(request.url);
  const repo = parseRepoRef(url.searchParams.get("repo") ?? "") ?? NOTE_INBOX;

  try {
    const client = new GitHubClient({ token: env.GITHUB_PAT });
    const plans = await listPlans(client, repo, { projectId: env.PROJECT_ID });
    return json({ repo: `${repo.owner}/${repo.name}`, plans });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `計画一覧の取得に失敗しました: ${message}` }, 502);
  }
};
