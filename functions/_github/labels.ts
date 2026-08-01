import type { GitHubClient } from "./client";
import { toGitHubError } from "./client";

/** GitHub リポジトリの参照（owner/name）。 */
export type RepoRef = {
  owner: string;
  name: string;
};

export type LabelSpec = {
  name: string;
  /** 先頭 # なしの 6 桁 hex カラー。 */
  color: string;
  description: string;
};

/**
 * すべての draft Issue に付与する `kind/plan` label。
 * mt-plan の draft.rs `ensure_labels` から移植した定義。
 */
export const KIND_PLAN_LABEL: LabelSpec = {
  name: "kind/plan",
  color: "0E8A16",
  description: "mt-plan で管理する計画 Issue",
};

/**
 * label を冪等に確保する（`gh label create --force` の移植）。
 *
 * 存在しなければ作成し、既に存在する（POST が 422 を返す）場合は
 * color/description を所定の値へ更新して収束させる。
 */
export async function ensureLabel(
  client: GitHubClient,
  repo: RepoRef,
  label: LabelSpec,
): Promise<void> {
  const path = `/repos/${repo.owner}/${repo.name}/labels`;
  const created = await client.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: label.name,
      color: label.color,
      description: label.description,
    }),
  });
  if (created.ok) return;

  // 422 = 同名 label が既に存在。更新して desired state に揃える（--force 相当）。
  if (created.status !== 422) {
    throw await toGitHubError(created, `label '${label.name}' の作成に失敗しました`);
  }

  const updated = await client.request(`${path}/${encodeURIComponent(label.name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color: label.color, description: label.description }),
  });
  if (!updated.ok) {
    throw await toGitHubError(updated, `label '${label.name}' の更新に失敗しました`);
  }
}
