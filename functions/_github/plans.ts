import type { GitHubClient } from "./client";
import { toGitHubError } from "./client";
import type { RepoRef } from "./labels";
import type { ProjectIssueStatus } from "./project";
import { listProjectIssueStatuses } from "./project";

/**
 * GitHub Project「plans」の Status フィールドに対応する 5 グループ。
 * Status を解決できない Issue は unregistered（未登録）へ縮退する。
 */
export const PLAN_STATUSES = ["draft", "refined", "in-progress", "done", "unregistered"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** 計画一覧の 1 件（open な kind/plan Issue + Project Status）。 */
export type PlanIssue = {
  number: number;
  title: string;
  url: string;
  /** Issue 本文（Markdown）。詳細モーダルのプレビューに使う。 */
  body: string;
  updatedAt: string;
  status: PlanStatus;
};

/** GitHub REST /repos/{owner}/{repo}/issues が返す Issue のうち必要なフィールド。 */
type RestIssue = {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  updated_at: string;
  /** PR が混入する場合にのみ存在する（issues エンドポイントの仕様）。 */
  pull_request?: unknown;
};

/**
 * open な kind/plan Issue を REST で一覧取得する。
 * issues エンドポイントには PR が混入するため除外する。
 * ページネーションは実装しない（per_page=100 の先頭ページのみ、個人ツール規模）。
 */
export async function listOpenPlanIssues(client: GitHubClient, repo: RepoRef): Promise<RestIssue[]> {
  const path =
    `/repos/${repo.owner}/${repo.name}/issues` +
    `?labels=${encodeURIComponent("kind/plan")}&state=open&per_page=100`;
  const response = await client.request(path);
  if (!response.ok) {
    throw await toGitHubError(response, "計画一覧の取得に失敗しました");
  }

  const issues = (await response.json()) as RestIssue[];
  return issues.filter((issue) => issue.pull_request === undefined);
}

/**
 * Project の Status 値を 5 グループのいずれかへ正規化する。
 * 大文字小差・空白を吸収し（"In Progress" → in-progress）、
 * 未知の値・null は unregistered へ縮退する。
 */
export function normalizePlanStatus(raw: string | null | undefined): PlanStatus {
  const normalized = raw?.trim().toLowerCase().replace(/\s+/g, "-");
  switch (normalized) {
    case "draft":
      return "draft";
    case "refined":
      return "refined";
    case "in-progress":
      return "in-progress";
    case "done":
      return "done";
    default:
      return "unregistered";
  }
}

export type ListPlansOptions = {
  /** ProjectV2 の node ID。未設定なら Status 解決をスキップ（すべて unregistered）。 */
  projectId?: string;
};

/**
 * ある repo の open な kind/plan Issue を一覧取得し、
 * Project items の GraphQL を join して Status を付与する。
 *
 * Status を解決できない場合（projectId 未設定・GraphQL 失敗・Project 未登録）は
 * unregistered グループへ縮退し、一覧取得自体は失敗させない
 * （起票時の best-effort Project 連携と整合）。
 */
export async function listPlans(
  client: GitHubClient,
  repo: RepoRef,
  options: ListPlansOptions = {},
): Promise<PlanIssue[]> {
  const issues = await listOpenPlanIssues(client, repo);

  let projectStatuses: ProjectIssueStatus[] = [];
  if (options.projectId) {
    try {
      projectStatuses = await listProjectIssueStatuses(client, options.projectId);
    } catch (error) {
      console.warn("Project Status の解決に失敗しました。未登録として扱います。", error);
    }
  }

  // Project には複数 repo の item が混在するため、repo フルネーム + Issue 番号で照合する。
  const repoFullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const statusByNumber = new Map<number, string | null>();
  for (const item of projectStatuses) {
    if (item.repoFullName.toLowerCase() === repoFullName) {
      statusByNumber.set(item.number, item.status);
    }
  }

  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    body: issue.body ?? "",
    updatedAt: issue.updated_at,
    status: statusByNumber.has(issue.number)
      ? normalizePlanStatus(statusByNumber.get(issue.number))
      : "unregistered",
  }));
}
