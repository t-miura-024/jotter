import { GitHubClient, toGitHubError } from "../_github/client";
import { INTERNAL_OWNER } from "../_github/target";
import type { Env } from "../_types";

/** GitHub API が返すリポジトリ情報のうち必要なフィールド。 */
type GitHubRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  archived: boolean;
  private: boolean;
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * GET /api/repos — INTERNAL_OWNER（t-miura-024）配下リポジトリ一覧を返す。
 *
 * 認証ユーザーの /user/repos を使い、private リポジトリも含めて取得する。
 * archived リポジトリは除外する。secret はサーバー側（env）に留め、ブラウザには出さない。
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }

  try {
    const client = new GitHubClient({ token: env.GITHUB_PAT });
    const response = await client.request(
      "/user/repos?per_page=100&sort=full_name&direction=asc&type=owner",
    );
    if (!response.ok) {
      throw await toGitHubError(response, "リポジトリ一覧の取得に失敗しました");
    }

    const repos = (await response.json()) as GitHubRepo[];
    return json({
      repos: repos
        .filter((repo) => !repo.archived && repo.owner.login === INTERNAL_OWNER)
        .map((repo) => ({
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
        })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `リポジトリ一覧の取得に失敗しました: ${message}` }, 502);
  }
};
