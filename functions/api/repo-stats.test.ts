import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import { onRequestGet } from "./repo-stats";

type RepoStatsContext = Parameters<typeof onRequestGet>[0];

const ENV: Env = { GITHUB_PAT: "test-token", GEMINI_API_KEY: "test-gemini-key" };
const PROJECT_ENV: Env = { ...ENV, PROJECT_ID: "PVT_project" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const graphqlOk = (data: unknown): Response => jsonResponse({ data });

/** Cache API のフェイク実装（テスト用に vi.stubGlobal で差し替える）。 */
function createFakeCache(): {
  cache: {
    match: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
  entries: Map<string, Response>;
} {
  const entries = new Map<string, Response>();
  return {
    cache: {
      match: vi.fn(async (url: string) => entries.get(url)),
      put: vi.fn(async (url: string, response: Response) => {
        entries.set(url, response.clone());
      }),
    },
    entries,
  };
}

/** GitHub 側の正常応答モック（repo 一覧 + Project items + repo ごとの open Issue）。 */
function mockGithub(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      {
        name: "note",
        full_name: "t-miura-024/note",
        owner: { login: "t-miura-024" },
        archived: false,
        private: true,
      },
      {
        name: "tools",
        full_name: "t-miura-024/tools",
        owner: { login: "t-miura-024" },
        archived: false,
        private: false,
      },
    ]),
  );
  fetchMock.mockResolvedValueOnce(
    graphqlOk({
      node: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              content: { number: 3, repository: { nameWithOwner: "t-miura-024/note" } },
              fieldValueByName: { name: "refined" },
            },
          ],
        },
      },
    }),
  );
  fetchMock.mockResolvedValueOnce(jsonResponse([{ number: 3 }, { number: 4 }]));
  fetchMock.mockResolvedValueOnce(jsonResponse([{ number: 10 }]));
}

function context(query: string, env: Partial<Env> = {}): RepoStatsContext {
  return {
    request: new Request(`https://jotter.example/api/repo-stats${query}`),
    env,
  } as unknown as RepoStatsContext;
}

beforeEach(() => {
  vi.stubGlobal("caches", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/repo-stats", () => {
  it("GITHUB_PAT 未設定なら 500 を返す", async () => {
    const response = await onRequestGet(context("", {}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GITHUB_PAT が設定されていません",
    });
  });

  it("全内部 repo の 5 件数を返す（GraphQL 1 回 + repo ごと REST 並列）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockGithub(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("", PROJECT_ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      repos: Array<{ fullName: string; counts: Record<string, number> }>;
      fetchedAt: string;
    };
    expect(body.repos).toEqual([
      {
        owner: "t-miura-024",
        name: "note",
        fullName: "t-miura-024/note",
        counts: { draft: 0, refined: 1, "in-progress": 0, done: 0, unregistered: 1 },
      },
      {
        owner: "t-miura-024",
        name: "tools",
        fullName: "t-miura-024/tools",
        counts: { draft: 0, refined: 0, "in-progress": 0, done: 0, unregistered: 1 },
      },
    ]);
    expect(typeof body.fetchedAt).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("PROJECT_ID 未設定なら GraphQL を呼ばずすべて unregistered で返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          name: "note",
          full_name: "t-miura-024/note",
          owner: { login: "t-miura-024" },
          archived: false,
          private: true,
        },
      ]),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse([{ number: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { repos: Array<{ counts: Record<string, number> }> };
    expect(body.repos[0].counts.unregistered).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("キャッシュ hit 時は GitHub を呼ばずキャッシュを返す", async () => {
    const { cache, entries } = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn<typeof fetch>();
    mockGithub(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    // 1 回目: GitHub から取得してキャッシュへ書き込む
    const first = await onRequestGet(context("", PROJECT_ENV));
    expect(first.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(1);

    // 2 回目: キャッシュ hit で GitHub を呼ばない
    fetchMock.mockClear();
    const second = await onRequestGet(context("", PROJECT_ENV));
    expect(second.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await second.json()).toEqual(await first.json());
  });

  it("bypass=1 はキャッシュを読まず GitHub から再取得してキャッシュを上書きする", async () => {
    const { cache, entries } = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn<typeof fetch>();
    mockGithub(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    // 通常取得でキャッシュを作る
    await onRequestGet(context("", PROJECT_ENV));

    // bypass: キャッシュ match は呼ばれず、GitHub 再取得 + put で上書き
    cache.match.mockClear();
    cache.put.mockClear();
    fetchMock.mockClear();
    mockGithub(fetchMock);
    const bypass = await onRequestGet(context("?bypass=1", PROJECT_ENV));
    expect(bypass.status).toBe(200);
    expect(cache.match).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(1);

    // 上書き後のキャッシュが次の通常取得で使われる
    fetchMock.mockClear();
    const next = await onRequestGet(context("", PROJECT_ENV));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await next.json()).toEqual(await bypass.json());
  });

  it("GitHub 取得が失敗したら endpoint 全体で 502 を返す（部分集計を返さない）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("", PROJECT_ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("repo stats の取得に失敗しました");
  });

  it("失敗時はキャッシュがあっても 502 を返し、古いキャッシュに退避しない", async () => {
    const { cache } = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn<typeof fetch>();
    mockGithub(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    await onRequestGet(context("", PROJECT_ENV));

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "boom" }, 500),
    );
    const response = await onRequestGet(context("?bypass=1", PROJECT_ENV));
    expect(response.status).toBe(502);
  });
});
