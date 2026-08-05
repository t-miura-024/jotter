import { describe, expect, it, vi } from "vitest";

import { GitHubClient } from "./client";
import { aggregateRepoStats, fetchRepoStats } from "./stats";

const graphqlOk = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const restOk = (issues: unknown[]): Response =>
  new Response(JSON.stringify(issues), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("aggregateRepoStats", () => {
  const repos = [
    { owner: "t-miura-024", name: "note" },
    { owner: "t-miura-024", name: "tools" },
  ];

  it("Project 登録済み 4 Status と unregistered を repo ごとに集計する", () => {
    const issuesByRepo = new Map([
      ["t-miura-024/note", [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }, { number: 6 }]],
      ["t-miura-024/tools", [{ number: 10 }]],
    ]);
    const projectStatuses = [
      { number: 1, repoFullName: "t-miura-024/note", status: "draft" },
      { number: 2, repoFullName: "t-miura-024/note", status: "refined" },
      { number: 3, repoFullName: "t-miura-024/note", status: "In Progress" },
      { number: 4, repoFullName: "t-miura-024/note", status: "done" },
      // 5 は Project 未登録（unregistered になる）
      { number: 10, repoFullName: "t-miura-024/tools", status: "draft" },
    ];

    const result = aggregateRepoStats(repos, issuesByRepo, projectStatuses);

    expect(result[0]).toEqual({
      owner: "t-miura-024",
      name: "note",
      fullName: "t-miura-024/note",
      counts: { draft: 1, refined: 1, "in-progress": 1, done: 1, unregistered: 2 },
    });
    expect(result[1].counts).toEqual({
      draft: 1,
      refined: 0,
      "in-progress": 0,
      done: 0,
      unregistered: 0,
    });
  });

  it("0 件の repo は全 Status 0 で返す", () => {
    const result = aggregateRepoStats(
      [{ owner: "t-miura-024", name: "empty" }],
      new Map([["t-miura-024/empty", []]]),
      [],
    );
    expect(result[0].counts).toEqual({
      draft: 0,
      refined: 0,
      "in-progress": 0,
      done: 0,
      unregistered: 0,
    });
  });

  it("Project item の Status が null / 未知の値は unregistered に数える", () => {
    const issuesByRepo = new Map([
      ["t-miura-024/note", [{ number: 1 }, { number: 2 }, { number: 3 }]],
    ]);
    const projectStatuses = [
      { number: 1, repoFullName: "t-miura-024/note", status: null },
      { number: 2, repoFullName: "t-miura-024/note", status: "backlog" },
    ];
    const result = aggregateRepoStats(
      [{ owner: "t-miura-024", name: "note" }],
      issuesByRepo,
      projectStatuses,
    );
    expect(result[0].counts.unregistered).toBe(3);
  });

  it("Project に存在するだけの closed Issue は数えない（open Issue が母集合）", () => {
    const issuesByRepo = new Map([["t-miura-024/note", [{ number: 1 }]]]);
    const projectStatuses = [
      // closed の Issue 2 が Project に残っていても open 一覧に入っていなければ数えない。
      { number: 2, repoFullName: "t-miura-024/note", status: "done" },
    ];
    const result = aggregateRepoStats(
      [{ owner: "t-miura-024", name: "note" }],
      issuesByRepo,
      projectStatuses,
    );
    expect(result[0].counts).toEqual({
      draft: 0,
      refined: 0,
      "in-progress": 0,
      done: 0,
      unregistered: 1,
    });
  });

  it("他 repo の Project item は照合に混ざらない", () => {
    const issuesByRepo = new Map([["t-miura-024/tools", [{ number: 1 }]]]);
    const projectStatuses = [
      { number: 1, repoFullName: "t-miura-024/note", status: "done" },
    ];
    const result = aggregateRepoStats(
      [{ owner: "t-miura-024", name: "tools" }],
      issuesByRepo,
      projectStatuses,
    );
    expect(result[0].counts.unregistered).toBe(1);
  });

  it("repo フルネームは大文字小文字を吸収して照合する（Project item 側の表記ゆれ）", () => {
    const issuesByRepo = new Map([["t-miura-024/note", [{ number: 1 }]]]);
    const projectStatuses = [
      { number: 1, repoFullName: "T-MIURA-024/NOTE", status: "draft" },
    ];
    const result = aggregateRepoStats(
      [{ owner: "t-miura-024", name: "note" }],
      issuesByRepo,
      projectStatuses,
    );
    expect(result[0].counts.draft).toBe(1);
  });
});

describe("fetchRepoStats", () => {
  it("Project items は GraphQL で一度だけ全ページ取得し、repo ごとの REST を並列取得する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    // 1 回目: Project items 1 ページ目（hasNextPage: true）
    fetchMock.mockResolvedValueOnce(
      graphqlOk({
        node: {
          items: {
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            nodes: [
              {
                content: { number: 1, repository: { nameWithOwner: "t-miura-024/note" } },
                fieldValueByName: { name: "draft" },
              },
            ],
          },
        },
      }),
    );
    // 2 回目: Project items 2 ページ目（hasNextPage: false）
    fetchMock.mockResolvedValueOnce(
      graphqlOk({
        node: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                content: { number: 2, repository: { nameWithOwner: "t-miura-024/tools" } },
                fieldValueByName: { name: "done" },
              },
            ],
          },
        },
      }),
    );
    // 3・4 回目: 2 repo の open Issue 一覧（並列取得）
    fetchMock.mockResolvedValueOnce(restOk([{ number: 1 }]));
    fetchMock.mockResolvedValueOnce(restOk([{ number: 2 }]));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const result = await fetchRepoStats(
      client,
      [
        { owner: "t-miura-024", name: "note" },
        { owner: "t-miura-024", name: "tools" },
      ],
      { projectId: "PVT_project" },
    );

    expect(result[0].counts).toEqual({
      draft: 1,
      refined: 0,
      "in-progress": 0,
      done: 0,
      unregistered: 0,
    });
    expect(result[1].counts).toEqual({
      draft: 0,
      refined: 0,
      "in-progress": 0,
      done: 1,
      unregistered: 0,
    });

    // GraphQL 2 回（ページネーション）+ REST 2 回
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const graphqlCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.endsWith("/graphql"));
    expect(graphqlCalls).toHaveLength(2);
    const restCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/issues?"));
    expect(restCalls).toHaveLength(2);
    // 2 回目の GraphQL は 1 回目の endCursor を使う
    const secondGraphql = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondGraphql.variables.after).toBe("cursor1");
  });

  it("PROJECT_ID 未設定なら GraphQL を呼ばず REST だけ並列取得して全 unregistered にする", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      restOk([{ number: 1 }, { number: 2 }]),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const result = await fetchRepoStats(client, [
      { owner: "t-miura-024", name: "note" },
      { owner: "t-miura-024", name: "tools" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result[0].counts.unregistered).toBe(2);
    expect(result[1].counts.unregistered).toBe(2);
  });

  it("いずれかの取得が失敗したら throw する（部分集計を返さない）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(restOk([{ number: 1 }]));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 }),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(
      fetchRepoStats(client, [
        { owner: "t-miura-024", name: "note" },
        { owner: "t-miura-024", name: "tools" },
      ]),
    ).rejects.toThrow();
  });
});
