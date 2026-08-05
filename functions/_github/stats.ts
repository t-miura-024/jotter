import type { GitHubClient } from "./client";
import type { RepoRef } from "./labels";
import { listOpenPlanIssues, normalizePlanStatus } from "./plans";
import { listProjectIssueStatuses, type ProjectIssueStatus } from "./project";

/**
 * repo sidebar 用の集計（ADR 0011）。
 *
 * Project items は GraphQL で一度だけ全ページ取得し、取得時点の全内部 repo の
 * open な kind/plan Issue を REST で並列取得して突き合わせる。
 * - open な kind/plan Issue を母集合とし、Project に存在するだけの closed Issue は数えない。
 * - Project item から Status が解決できるものは draft / refined / in-progress / done へ、
 *   解決できないもの（Project 未登録・Status 未設定・未知の値）は unregistered へ数える。
 */

/** repo stats の Status 5 グループ（PlanList の表示定義と同一順序）。 */
export const REPO_STAT_STATUSES = [
  "draft",
  "refined",
  "in-progress",
  "done",
  "unregistered",
] as const;

export type RepoStatStatus = (typeof REPO_STAT_STATUSES)[number];

/** repo ごとの Status 別件数。 */
export type RepoStatsCounts = Record<RepoStatStatus, number>;

/** repo stats の 1 エントリ。 */
export type RepoStatsEntry = {
  owner: string;
  name: string;
  fullName: string;
  counts: RepoStatsCounts;
};

export function emptyRepoStatsCounts(): RepoStatsCounts {
  return { draft: 0, refined: 0, "in-progress": 0, done: 0, unregistered: 0 };
}

/** 突き合わせに使う open な kind/plan Issue の最小表現。 */
type OpenIssueLike = {
  number: number;
};

/**
 * Project items と repo ごとの open Issue を突き合わせて Status 別件数を集計する。
 * 純粋関数のためテストで直接検証できる。
 */
export function aggregateRepoStats(
  repos: RepoRef[],
  issuesByRepo: ReadonlyMap<string, OpenIssueLike[]>,
  projectStatuses: ProjectIssueStatus[],
): RepoStatsEntry[] {
  // repo フルネーム + Issue 番号で照合する（Project には複数 repo の item が混在する）。
  const statusByIssue = new Map<string, string | null>();
  for (const item of projectStatuses) {
    statusByIssue.set(`${item.repoFullName.toLowerCase()}#${item.number}`, item.status);
  }

  return repos.map((repo) => {
    const fullName = `${repo.owner}/${repo.name}`;
    const issues = issuesByRepo.get(fullName.toLowerCase()) ?? [];
    const counts = emptyRepoStatsCounts();
    for (const issue of issues) {
      const raw = statusByIssue.get(`${fullName.toLowerCase()}#${issue.number}`);
      counts[normalizePlanStatus(raw)] += 1;
    }
    return { owner: repo.owner, name: repo.name, fullName, counts };
  });
}

export type FetchRepoStatsOptions = {
  /** ProjectV2 の node ID。未設定なら Status 解決をスキップ（すべて unregistered）。 */
  projectId?: string;
};

/**
 * 全内部 repo の Status 別件数を取得する。
 * いずれかの取得が失敗した場合は throw する（部分的な集計は返さない: 縮退契約は endpoint 全体）。
 */
export async function fetchRepoStats(
  client: GitHubClient,
  repos: RepoRef[],
  options: FetchRepoStatsOptions = {},
): Promise<RepoStatsEntry[]> {
  // Project items は GraphQL で一度だけ全ページ取得する（repo ごとに重複取得しない）。
  let projectStatuses: ProjectIssueStatus[] = [];
  if (options.projectId) {
    projectStatuses = await listProjectIssueStatuses(client, options.projectId);
  }

  // 取得時点の全内部 repo の open な kind/plan Issue を REST で並列取得する。
  const fetched = await Promise.all(
    repos.map(async (repo) => {
      const issues = await listOpenPlanIssues(client, repo);
      return [repo, issues] as const;
    }),
  );
  const issuesByRepo = new Map(
    fetched.map(([repo, issues]) => [`${repo.owner}/${repo.name}`.toLowerCase(), issues]),
  );

  return aggregateRepoStats(repos, issuesByRepo, projectStatuses);
}
