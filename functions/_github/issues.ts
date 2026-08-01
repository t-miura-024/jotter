import type { GitHubClient } from "./client";
import { toGitHubError } from "./client";
import type { RepoRef } from "./labels";

export type CreateIssueParams = {
  title: string;
  body: string;
  labels: string[];
};

/** 作成した Issue の表示用情報（draft.rs CreatedIssue 相当）。 */
export type CreatedIssue = {
  number: number;
  title: string;
  url: string;
};

/** Issue を作成し、番号・タイトル・URL を返す（draft.rs create_issue の移植）。 */
export async function createIssue(
  client: GitHubClient,
  repo: RepoRef,
  params: CreateIssueParams,
): Promise<CreatedIssue> {
  const response = await client.request(`/repos/${repo.owner}/${repo.name}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      labels: params.labels,
    }),
  });
  if (!response.ok) {
    throw await toGitHubError(response, "Issue の作成に失敗しました");
  }

  const data = (await response.json()) as {
    number: number;
    title: string;
    html_url: string;
  };
  return { number: data.number, title: data.title, url: data.html_url };
}
