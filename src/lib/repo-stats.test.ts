import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchRepoStats,
  getCachedRepoStats,
  invalidateRepoStatsCache,
} from "./repo-stats";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const statsBody = {
  repos: [
    {
      owner: "t-miura-024",
      name: "note",
      fullName: "t-miura-024/note",
      counts: { draft: 1, refined: 0, "in-progress": 0, done: 0, unregistered: 2 },
    },
  ],
  fetchedAt: "2026-08-05T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateRepoStatsCache();
});

describe("fetchRepoStats", () => {
  it("通常取得はキャッシュを利用する（bypass なし）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(statsBody));
    vi.stubGlobal("fetch", fetchMock);

    const stats = await fetchRepoStats(false);

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/repo-stats");
    expect(stats).toEqual(statsBody);
    expect(getCachedRepoStats()).toEqual(statsBody);
  });

  it("force 時は ?bypass=1 でサーバーキャッシュを迂回して強制更新する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(statsBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchRepoStats(true);

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/repo-stats?bypass=1");
  });

  it("invalidateRepoStatsCache でメモリキャッシュを破棄する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(statsBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchRepoStats(false);
    expect(getCachedRepoStats()).not.toBeNull();

    invalidateRepoStatsCache();
    expect(getCachedRepoStats()).toBeNull();
  });

  it("エラーレスポンスはメッセージ付きエラーを投げ、キャッシュしない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "repo stats の取得に失敗しました: boom" }, 502),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRepoStats(false)).rejects.toThrow(
      "repo stats の取得に失敗しました: boom",
    );
    expect(getCachedRepoStats()).toBeNull();
  });
});
