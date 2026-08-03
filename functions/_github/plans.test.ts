import { describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubError } from "./client";
import { listOpenPlanIssues, listPlans, normalizePlanStatus } from "./plans";

const REPO = { owner: "t-miura-024", name: "note" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const graphqlOk = (data: unknown): Response => jsonResponse({ data });

const graphqlErrors = (messages: string[]): Response =>
  jsonResponse({ errors: messages.map((message) => ({ message })) });

const restIssue = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  number: 1,
  title: "計画 A",
  html_url: "https://github.com/t-miura-024/note/issues/1",
  body: "本文",
  updated_at: "2026-08-03T00:00:00Z",
  ...overrides,
});

const projectItem = (
  number: number,
  repoFullName: string,
  status: string | null,
): Record<string, unknown> => ({
  content: { number, repository: { nameWithOwner: repoFullName } },
  fieldValueByName: status === null ? null : { name: status },
});

describe("listOpenPlanIssues", () => {
  it("kind/plan・state=open・per_page=100 で REST 取得する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([restIssue()]));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const issues = await listOpenPlanIssues(client, REPO);

    expect(issues).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.github.com/repos/t-miura-024/note/issues?labels=kind%2Fplan&state=open&per_page=100",
    );
  });

  it("PR（pull_request フィールド持ち）を除外する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([restIssue({ number: 1 }), restIssue({ number: 2, pull_request: { url: "x" } })]),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const issues = await listOpenPlanIssues(client, REPO);

    expect(issues.map((issue) => issue.number)).toEqual([1]);
  });

  it("REST 失敗時は GitHubError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Not Found" }, 404),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(listOpenPlanIssues(client, REPO)).rejects.toThrow(GitHubError);
    await expect(listOpenPlanIssues(client, REPO)).rejects.toThrow(
      "計画一覧の取得に失敗しました: Not Found",
    );
  });
});

describe("normalizePlanStatus", () => {
  it("既知の Status 値をそのままマップする", () => {
    expect(normalizePlanStatus("draft")).toBe("draft");
    expect(normalizePlanStatus("refined")).toBe("refined");
    expect(normalizePlanStatus("in-progress")).toBe("in-progress");
    expect(normalizePlanStatus("done")).toBe("done");
  });

  it("大文字小差・空白を吸収する", () => {
    expect(normalizePlanStatus("Draft")).toBe("draft");
    expect(normalizePlanStatus("In Progress")).toBe("in-progress");
    expect(normalizePlanStatus(" DONE ")).toBe("done");
  });

  it("未知の値・null・undefined は unregistered へ縮退する", () => {
    expect(normalizePlanStatus("todo")).toBe("unregistered");
    expect(normalizePlanStatus(null)).toBe("unregistered");
    expect(normalizePlanStatus(undefined)).toBe("unregistered");
    expect(normalizePlanStatus("")).toBe("unregistered");
  });
});

describe("listPlans", () => {
  it("REST 一覧と Project items を join し、Status を付与する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        restIssue({
          number: 1,
          title: "計画 A",
          body: "本文 A",
          html_url: "https://github.com/t-miura-024/note/issues/1",
        }),
        restIssue({
          number: 2,
          title: "計画 B",
          body: null,
          html_url: "https://github.com/t-miura-024/note/issues/2",
        }),
        restIssue({
          number: 3,
          title: "計画 C",
          html_url: "https://github.com/t-miura-024/note/issues/3",
        }),
      ]),
    );
    fetchMock.mockResolvedValueOnce(
      graphqlOk({
        node: {
          items: {
            nodes: [
              projectItem(1, "t-miura-024/note", "draft"),
              projectItem(2, "t-miura-024/note", "In Progress"),
              // 別 repo の同番号 item は join 対象外
              projectItem(3, "t-miura-024/tools", "done"),
              // content が Issue 以外の item は対象外
              { content: null, fieldValueByName: null },
            ],
          },
        },
      }),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const plans = await listPlans(client, REPO, { projectId: "PVT_project" });

    expect(plans).toEqual([
      {
        number: 1,
        title: "計画 A",
        url: "https://github.com/t-miura-024/note/issues/1",
        body: "本文 A",
        updatedAt: "2026-08-03T00:00:00Z",
        status: "draft",
      },
      {
        number: 2,
        title: "計画 B",
        url: "https://github.com/t-miura-024/note/issues/2",
        body: "",
        updatedAt: "2026-08-03T00:00:00Z",
        status: "in-progress",
      },
      {
        number: 3,
        title: "計画 C",
        url: "https://github.com/t-miura-024/note/issues/3",
        body: "本文",
        updatedAt: "2026-08-03T00:00:00Z",
        status: "unregistered",
      },
    ]);

    // 2 回目が GraphQL（Project items 取得）
    const graphqlCall = fetchMock.mock.calls[1];
    expect(String(graphqlCall[0])).toBe("https://api.github.com/graphql");
    const body = JSON.parse(String(graphqlCall[1]?.body));
    expect(body.variables).toEqual({ projectId: "PVT_project" });
    expect(body.query).toContain("fieldValueByName");
  });

  it("projectId 未設定なら GraphQL を呼ばずすべて unregistered", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([restIssue({ number: 1 })]));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const plans = await listPlans(client, REPO);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plans[0].status).toBe("unregistered");
  });

  it("GraphQL が失敗しても unregistered に縮退して一覧は返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([restIssue({ number: 1 })]));
    fetchMock.mockResolvedValueOnce(graphqlErrors(["Project not found"]));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const plans = await listPlans(client, REPO, { projectId: "PVT_bad" });

    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe("unregistered");
  });

  it("Project 登録済みでも Status 未設定（null）なら unregistered", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([restIssue({ number: 1 })]));
    fetchMock.mockResolvedValueOnce(
      graphqlOk({
        node: { items: { nodes: [projectItem(1, "t-miura-024/note", null)] } },
      }),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const plans = await listPlans(client, REPO, { projectId: "PVT_project" });

    expect(plans[0].status).toBe("unregistered");
  });

  it("REST 失敗時は GitHubError を投げる（一覧取得の失敗）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(listPlans(client, REPO, { projectId: "PVT_project" })).rejects.toThrow(
      GitHubError,
    );
  });
});
