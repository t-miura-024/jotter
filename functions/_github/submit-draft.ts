import type { GitHubClient } from "./client";
import type { CreatedIssue } from "./issues";
import { createIssue } from "./issues";
import type { LabelSpec, RepoRef } from "./labels";
import { KIND_PLAN_LABEL, ensureLabel } from "./labels";

export type SubmitDraftParams = {
  /** draft Issue を作成する target repo。 */
  repo: RepoRef;
  title: string;
  /** jot の本文（そのまま Issue body になる）。 */
  body: string;
  /** external label（外部 repo 指定 or 未指定の場合）。内部 repo の場合は省略。 */
  externalLabel?: LabelSpec;
};

export type SubmitDraftResult = CreatedIssue & {
  /** target repo のフルネーム（owner/name）。 */
  repo: string;
};

/**
 * 起票パイプライン（draft.rs submit_draft の移植）。
 *
 * label 冪等確保（kind/plan + external label）→ Issue 作成 の順に実行する。
 * M4 で Project 連携（add_to_project_and_set_status）がここに追加される。
 */
export async function submitDraft(
  client: GitHubClient,
  params: SubmitDraftParams,
): Promise<SubmitDraftResult> {
  await ensureLabel(client, params.repo, KIND_PLAN_LABEL);
  if (params.externalLabel) {
    await ensureLabel(client, params.repo, params.externalLabel);
  }

  const labels = [KIND_PLAN_LABEL.name];
  if (params.externalLabel) {
    labels.push(params.externalLabel.name);
  }

  const issue = await createIssue(client, params.repo, {
    title: params.title,
    body: params.body,
    labels,
  });
  return { ...issue, repo: `${params.repo.owner}/${params.repo.name}` };
}
