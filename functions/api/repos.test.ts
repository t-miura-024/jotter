import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import { onRequestGet } from "./repos";

type ReposContext = Parameters<typeof onRequestGet>[0];

const ENV: Env = { GITHUB_PAT: "test-token", GEMINI_API_KEY: "test-gemini-key" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function context(env: Partial<Env> = {}): ReposContext {
  return {
    request: new Request("https://jotter.example/api/repos"),
    env,
  } as unknown as ReposContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/repos", () => {
  it("GITHUB_PAT 未設定なら 500 を返す", async () => {
    const response = await onRequestGet(context({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GITHUB_PAT が設定されていません",
    });
  });

  it("t-miura-024 配下リポジトリ一覧を返す（archived 除外・private 含む）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([
        {
          name: "tools",
          full_name: "t-miura-024/tools",
          owner: { login: "t-miura-024" },
          archived: false,
          private: false,
        },
        {
          name: "note",
          full_name: "t-miura-024/note",
          owner: { login: "t-miura-024" },
          archived: false,
          private: true,
        },
        {
          name: "old-project",
          full_name: "t-miura-024/old-project",
          owner: { login: "t-miura-024" },
          archived: true,
          private: false,
        },
        {
          name: "other-repo",
          full_name: "someone/other-repo",
          owner: { login: "someone" },
          archived: false,
          private: false,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context(ENV));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repos: [
        { owner: "t-miura-024", name: "tools", fullName: "t-miura-024/tools" },
        { owner: "t-miura-024", name: "note", fullName: "t-miura-024/note" },
      ],
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/user/repos");
  });

  it("GitHub API が失敗したら 502 を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context(ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("リポジトリ一覧の取得に失敗しました");
  });
});
