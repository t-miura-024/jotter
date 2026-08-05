import { GitHubClient, toGitHubError } from "./client";
import { INTERNAL_OWNER } from "./target";

/** 内部 repo（t-miura-024 配下）の一覧エントリ。 */
export type InternalRepo = {
  owner: string;
  name: string;
  fullName: string;
};

/** GitHub API が返すリポジトリ情報のうち必要なフィールド。 */
type GitHubRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  archived: boolean;
  private: boolean;
};

/**
 * 認証ユーザーの /user/repos から内部 repo（INTERNAL_OWNER 配下・archived 除外）を取得する。
 * private リポジトリも含めて返す。sort=full_name のためアルファベット順が保証される。
 * /api/repos（軽量な一覧）と /api/repo-stats（集計）で共有する。
 */
export async function listInternalRepos(client: GitHubClient): Promise<InternalRepo[]> {
  const response = await client.request(
    "/user/repos?per_page=100&sort=full_name&direction=asc&type=owner",
  );
  if (!response.ok) {
    throw await toGitHubError(response, "リポジトリ一覧の取得に失敗しました");
  }

  const repos = (await response.json()) as GitHubRepo[];
  return repos
    .filter((repo) => !repo.archived && repo.owner.login === INTERNAL_OWNER)
    .map((repo) => ({
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
    }));
}
