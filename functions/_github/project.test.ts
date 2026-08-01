import { describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubError } from "./client";
import { addIssueToProject } from "./project";

const CONFIG = {
  projectId: "PVT_project",
  statusFieldId: "PVTSSF_field",
  statusOptionId: "option_draft",
};
const ISSUE = { owner: "t-miura-024", name: "note", number: 7 };

const graphqlOk = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const graphqlErrors = (messages: string[]): Response =>
  new Response(JSON.stringify({ errors: messages.map((message) => ({ message })) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("addIssueToProject", () => {
  it("node ID 解決 → item 追加 → Status=draft 設定 を順に実行する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(graphqlOk({ repository: { issue: { id: "I_node" } } }));
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ addProjectV2ItemById: { item: { id: "PVTI_item" } } }),
    );
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_item" } } }),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await addIssueToProject(client, CONFIG, ISSUE);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // すべての呼び出しが GraphQL エンドポイントに向かう
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toBe("https://api.github.com/graphql");
      expect(call[1]?.method).toBe("POST");
    }

    // 1 回目: Issue の node ID 解決
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(first.query).toContain("repository(");
    expect(first.variables).toEqual({ owner: "t-miura-024", name: "note", number: 7 });

    // 2 回目: Project への item 追加（解決した node ID を contentId に使う）
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second.query).toContain("addProjectV2ItemById");
    expect(second.variables).toEqual({ projectId: "PVT_project", contentId: "I_node" });

    // 3 回目: Status フィールドを draft に設定（追加した item ID を使う）
    const third = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(third.query).toContain("updateProjectV2ItemFieldValue");
    expect(third.variables).toEqual({
      projectId: "PVT_project",
      itemId: "PVTI_item",
      fieldId: "PVTSSF_field",
      optionId: "option_draft",
    });
  });

  it("GraphQL の errors 配列をメッセージ付き GitHubError に変換する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      graphqlErrors(["Could not resolve to a Repository with the name 'x/y'."]),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(addIssueToProject(client, CONFIG, ISSUE)).rejects.toThrow(
      "Issue の node ID の解決に失敗しました: Could not resolve to a Repository with the name 'x/y'.",
    );
    // 最初の段階の失敗で中断する
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP レベルの失敗は GitHubError になる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(addIssueToProject(client, CONFIG, ISSUE)).rejects.toThrow(GitHubError);
    await expect(addIssueToProject(client, CONFIG, ISSUE)).rejects.toThrow(
      "Issue の node ID の解決に失敗しました: Bad credentials",
    );
  });

  it("item 追加が失敗したら Status を設定せずに投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(graphqlOk({ repository: { issue: { id: "I_node" } } }));
    fetchMock.mockResolvedValueOnce(graphqlErrors(["Project not found"]));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(addIssueToProject(client, CONFIG, ISSUE)).rejects.toThrow(
      "Project への追加に失敗しました: Project not found",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Status 設定が失敗したら投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(graphqlOk({ repository: { issue: { id: "I_node" } } }));
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ addProjectV2ItemById: { item: { id: "PVTI_item" } } }),
    );
    fetchMock.mockResolvedValueOnce(graphqlErrors(["Field not found"]));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(addIssueToProject(client, CONFIG, ISSUE)).rejects.toThrow(
      "Status の設定に失敗しました: Field not found",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("repository が null（errors なし）でも防御的に投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => graphqlOk({ repository: null }));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(addIssueToProject(client, CONFIG, ISSUE)).rejects.toThrow(GitHubError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
