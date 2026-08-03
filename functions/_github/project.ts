import type { GitHubClient } from "./client";
import { GitHubError, toGitHubError } from "./client";
import type { RepoRef } from "./labels";

/**
 * GitHub ProjectV2 連携の設定（node ID 群）。
 * すべて Cloudflare secret / .dev.vars で管理し、ブラウザには一切出さない（ADR 0002）。
 */
export type ProjectConfig = {
  /** ProjectV2 の node ID（PVT_...）。 */
  projectId: string;
  /** Status フィールドの node ID（PVTSSF_...）。 */
  statusFieldId: string;
  /** Status フィールドの `draft` オプションの node ID。 */
  statusOptionId: string;
};

/** Project に追加する Issue の参照（REST の番号指定）。 */
export type ProjectIssueRef = RepoRef & {
  number: number;
};

/** GraphQL レスポンスの envelope。フィールドエラーは HTTP 200 + errors 配列で届く。 */
type GraphQLEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

/**
 * GraphQL エンドポイントへ POST し、envelope を展開する。
 * 認証ヘッダは GitHubClient.request（REST と同じ Classic PAT）を再利用する（ADR 0002）。
 * 同ファイル内の addIssueToProject / listProjectIssueStatuses 専用（API 面を最小化）。
 */
async function graphql<T>(
  client: GitHubClient,
  query: string,
  variables: Record<string, string | number>,
  action: string,
): Promise<T> {
  const response = await client.request("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw await toGitHubError(response, action);
  }

  const envelope = (await response.json()) as GraphQLEnvelope<T>;
  if (envelope.errors && envelope.errors.length > 0) {
    const detail = envelope.errors
      .map((entry) => entry.message)
      .filter((message): message is string => Boolean(message))
      .join(", ");
    throw new GitHubError(`${action}: ${detail || "unknown GraphQL error"}`, response.status);
  }
  if (!envelope.data) {
    throw new GitHubError(`${action}: レスポンスに data がありません`, response.status);
  }
  return envelope.data;
}

/** Issue の node ID を解決する（addProjectV2ItemById の contentId に必要）。 */
const ISSUE_NODE_ID_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id
      }
    }
  }
`;

/** Issue を ProjectV2 に追加する（gh project item-add 相当）。 */
const ADD_ITEM_MUTATION = `
  mutation ($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item {
        id
      }
    }
  }
`;

/** ProjectV2 item の単一選択フィールドを設定する（gh project item-edit --single-select-option-id 相当）。 */
const SET_STATUS_MUTATION = `
  mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

/**
 * Issue を Project に追加し、Status=`draft` を設定する
 * （draft.rs add_to_project_and_set_status の移植）。
 *
 * Rust 版は gh CLI（project item-add / item-edit）を経由するが、
 * ここでは同等の GraphQL mutation を直接叩く。
 * 失敗時は GitHubError を投げる。失敗を許容するかどうかは呼び出し側
 * （submit エンドポイント）が best-effort で決める。
 */
export async function addIssueToProject(
  client: GitHubClient,
  config: ProjectConfig,
  issue: ProjectIssueRef,
): Promise<void> {
  const resolved = await graphql<{
    repository: { issue: { id: string } | null } | null;
  }>(
    client,
    ISSUE_NODE_ID_QUERY,
    {
      owner: issue.owner,
      name: issue.name,
      number: issue.number,
    },
    "Issue の node ID の解決に失敗しました",
  );
  const issueNodeId = resolved.repository?.issue?.id;
  if (!issueNodeId) {
    throw new GitHubError(
      "Issue の node ID の解決に失敗しました: repository または Issue が見つかりません",
      200,
    );
  }

  const added = await graphql<{ addProjectV2ItemById: { item: { id: string } } | null }>(
    client,
    ADD_ITEM_MUTATION,
    { projectId: config.projectId, contentId: issueNodeId },
    "Project への追加に失敗しました",
  );
  const itemId = added.addProjectV2ItemById?.item.id;
  if (!itemId) {
    throw new GitHubError("Project への追加に失敗しました: item が返されませんでした", 200);
  }

  await graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
    client,
    SET_STATUS_MUTATION,
    {
      projectId: config.projectId,
      itemId,
      fieldId: config.statusFieldId,
      optionId: config.statusOptionId,
    },
    "Status の設定に失敗しました",
  );
}

/** Project item のうち Issue であるものの参照と Status フィールド値（計画一覧の join 用）。 */
export type ProjectIssueStatus = {
  /** Issue 番号。 */
  number: number;
  /** Issue が属する repo のフルネーム（owner/name）。 */
  repoFullName: string;
  /** Status フィールドの単一選択値の名前（未設定なら null）。 */
  status: string | null;
};

/**
 * Project の items を列挙し、Issue 内容と Status フィールド値を取り出す。
 * Status はフィールド名 "Status" で引く（Project「plans」の固定フィールド）。
 * ページネーションは実装しない（先頭 100 件、個人ツール規模）。
 * 失敗時は GitHubError を投げる。失敗を許容するかどうかは呼び出し側が決める。
 */
const PROJECT_ITEMS_QUERY = `
  query ($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            content {
              ... on Issue {
                number
                repository {
                  nameWithOwner
                }
              }
            }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
`;

export async function listProjectIssueStatuses(
  client: GitHubClient,
  projectId: string,
): Promise<ProjectIssueStatus[]> {
  const data = await graphql<{
    node: {
      items?: {
        nodes: Array<{
          content: { number: number; repository: { nameWithOwner: string } } | null;
          fieldValueByName: { name: string } | null;
        }>;
      };
    } | null;
  }>(client, PROJECT_ITEMS_QUERY, { projectId }, "Project items の取得に失敗しました");

  const nodes = data.node?.items?.nodes ?? [];
  return nodes.flatMap((node) => {
    // content が Issue 以外（PR 等）の item は対象外。
    if (!node.content) return [];
    return [
      {
        number: node.content.number,
        repoFullName: node.content.repository.nameWithOwner,
        status: node.fieldValueByName?.name ?? null,
      },
    ];
  });
}
