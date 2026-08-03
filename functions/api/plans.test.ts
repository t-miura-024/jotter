import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import { onRequestGet } from "./plans";

type PlansContext = Parameters<typeof onRequestGet>[0];

const ENV: Env = { GITHUB_PAT: "test-token", GEMINI_API_KEY: "test-gemini-key" };

const PROJECT_ENV: Env = { ...ENV, PROJECT_ID: "PVT_project" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const graphqlOk = (data: unknown): Response => jsonResponse({ data });

const restIssue = (number: number, title: string): Record<string, unknown> => ({
  number,
  title,
  html_url: `https://github.com/t-miura-024/note/issues/${number}`,
  body: "本文",
  updated_at: "2026-08-03T00:00:00Z",
});

function context(query: string, env: Partial<Env> = {}): PlansContext {
  return {
    request: new Request(`https://jotter.example/api/plans${query}`),
    env,
  } as unknown as PlansContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/plans", () => {
  it("GITHUB_PAT 未設定なら 500 を返す", async () => {
    const response = await onRequestGet(context("", {}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GITHUB_PAT が設定されていません",
    });
  });

  it("repo の open な kind/plan Issue を Project Status 付きで返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([restIssue(1, "計画 A"), restIssue(2, "計画 B")]));
    fetchMock.mockResolvedValueOnce(
      graphqlOk({
        node: {
          items: {
            nodes: [
              {
                content: { number: 1, repository: { nameWithOwner: "t-miura-024/note" } },
                fieldValueByName: { name: "refined" },
              },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?repo=t-miura-024/note", PROJECT_ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      repo: string;
      plans: Array<{ number: number; status: string }>;
    };
    expect(body.repo).toBe("t-miura-024/note");
    expect(body.plans.map((plan) => ({ number: plan.number, status: plan.status }))).toEqual([
      { number: 1, status: "refined" },
      { number: 2, status: "unregistered" },
    ]);

    // 1 回目が REST の Issue 一覧取得
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/repos/t-miura-024/note/issues?labels=kind%2Fplan&state=open&per_page=100",
    );
  });

  it("PROJECT_ID 未設定なら GraphQL を呼ばずすべて unregistered で返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([restIssue(1, "計画 A")]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?repo=t-miura-024/note", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { plans: Array<{ status: string }> };
    expect(body.plans[0].status).toBe("unregistered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repo 未指定なら note inbox の一覧を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { repo: string; plans: unknown[] };
    expect(body.repo).toBe("t-miura-024/note");
    expect(body.plans).toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/repos/t-miura-024/note/issues");
  });

  it("不正形式の repo は note inbox へ縮退する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?repo=justname", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { repo: string };
    expect(body.repo).toBe("t-miura-024/note");
  });

  it("外部 repo 指定時はその repo の一覧を返す（起票先へリダイレクトしない）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?repo=other-org/some-repo", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { repo: string };
    expect(body.repo).toBe("other-org/some-repo");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/repos/other-org/some-repo/issues");
  });

  it("GraphQL が失敗しても 200 + unregistered で返す（一覧取得は失敗させない）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([restIssue(1, "計画 A")]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: "Project not found" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?repo=t-miura-024/note", PROJECT_ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { plans: Array<{ status: string }> };
    expect(body.plans[0].status).toBe("unregistered");
  });

  it("REST 失敗時は 502 を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?repo=t-miura-024/note", ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("計画一覧の取得に失敗しました");
  });
});
