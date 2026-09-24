import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMonologues, getCachedMonologues, invalidateMonologuesCache } from "./monologues";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const monologuesBody = {
  month: "2026-09",
  monologues: [
    {
      title: "朝の思いつき",
      body: "- まず書く",
      date: "2026-09-23",
      time: "08:15",
      hasBodyDifference: false,
      sources: { note: true, google: true },
    },
  ],
  fetchedAt: "2026-09-23T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateMonologuesCache();
});

describe("fetchMonologues", () => {
  it("対象月を取得してメモリキャッシュへ保存する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(monologuesBody));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMonologues("2026-09");

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/monologues?month=2026-09");
    expect(result).toEqual({
      monologues: monologuesBody.monologues,
      warnings: undefined,
      failedDates: undefined,
    });
    expect(getCachedMonologues("2026-09")).toEqual(monologuesBody.monologues);
  });

  it("warnings/failedDates を含めて返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ...monologuesBody,
        warnings: ["2026-09-10 の取得に失敗しました"],
        failedDates: ["2026-09-10"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMonologues("2026-09");

    expect(result.monologues).toEqual(monologuesBody.monologues);
    expect(result.warnings).toEqual(["2026-09-10 の取得に失敗しました"]);
    expect(result.failedDates).toEqual(["2026-09-10"]);
  });

  it("キャッシュは月ごとに分ける", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(monologuesBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchMonologues("2026-09");
    expect(getCachedMonologues("2026-10")).toBeUndefined();

    invalidateMonologuesCache();
    expect(getCachedMonologues("2026-09")).toBeUndefined();
  });

  it("エラーレスポンスはメッセージ付きエラーを投げ、キャッシュしない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "month が不正です（YYYY-MM 形式で指定してください）" }, 400),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMonologues("foo")).rejects.toThrow(
      "month が不正です（YYYY-MM 形式で指定してください）",
    );
    expect(getCachedMonologues("foo")).toBeUndefined();
  });
});
