import { describe, expect, it, vi } from "vitest";

import { addOneDay, insertMonologueEvent, listMonologueEvents } from "./calendar";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("addOneDay", () => {
  it("通常日を加算する", () => {
    expect(addOneDay("2026-09-23")).toBe("2026-09-24");
  });

  it("月末・年末を跨ぐ", () => {
    expect(addOneDay("2026-01-31")).toBe("2026-02-01");
    expect(addOneDay("2026-12-31")).toBe("2027-01-01");
  });

  it("うるう日に対応する", () => {
    expect(addOneDay("2024-02-28")).toBe("2024-02-29");
    expect(addOneDay("2026-02-28")).toBe("2026-03-01");
  });
});

describe("listMonologueEvents", () => {
  it("対象月の範囲で問い合わせ終日予定だけ新しい順で返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          { start: { date: "2026-09-02" }, summary: "古い", description: "- a" },
          { start: { date: "2026-09-23" }, summary: "新しい", description: "- b" },
          // 終日以外・日付なしは無視する
          { start: { dateTime: "2026-09-10T10:00:00+09:00" }, summary: "時刻付き" },
          { summary: "開始なし" },
        ],
      }),
    );
    const entries = await listMonologueEvents("token", "calendar-id", "2026-09", {
      fetch: fetchMock,
    });
    expect(entries).toEqual([
      { date: "2026-09-23", title: "新しい", body: "- b" },
      { date: "2026-09-02", title: "古い", body: "- a" },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/calendar-id/events",
    );
    expect(parsed.searchParams.get("timeMin")).toBe("2026-09-01T00:00:00+09:00");
    expect(parsed.searchParams.get("timeMax")).toBe("2026-10-01T00:00:00+09:00");
    const headers = init?.headers;
    expect(headers instanceof Headers ? headers.get("Authorization") : undefined).toBe(
      "Bearer token",
    );
  });

  it("12 月の timeMax は翌年 1 月になる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [] }));
    await listMonologueEvents("token", "calendar-id", "2026-12", { fetch: fetchMock });
    const parsed = new URL(String(fetchMock.mock.calls[0][0]));
    expect(parsed.searchParams.get("timeMax")).toBe("2027-01-01T00:00:00+09:00");
  });

  it("nextPageToken を辿って全件取得する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("pageToken") === "token-2") {
        return jsonResponse({
          items: [{ start: { date: "2026-09-02" }, summary: "古い", description: "- a" }],
        });
      }
      return jsonResponse({
        items: [{ start: { date: "2026-09-23" }, summary: "新しい", description: "- b" }],
        nextPageToken: "token-2",
      });
    });
    const entries = await listMonologueEvents("token", "calendar-id", "2026-09", {
      fetch: fetchMock,
    });
    expect(entries).toEqual([
      { date: "2026-09-23", title: "新しい", body: "- b" },
      { date: "2026-09-02", title: "古い", body: "- a" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(secondUrl.searchParams.get("pageToken")).toBe("token-2");
  });

  it("month 不正は投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(listMonologueEvents("token", "calendar-id", "2026-13")).rejects.toThrow(
      "month が不正です",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("失敗時は投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("denied", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(
      listMonologueEvents("token", "calendar-id", "2026-09", { fetch: fetchMock }),
    ).rejects.toThrow("取得に失敗しました: 401");
  });

  it("暦に存在しない日付の予定は無視する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          { start: { date: "2026-02-30" }, summary: "存在しない日", description: "- x" },
          { start: { date: "2026-09-23" }, summary: "実在", description: "- b" },
        ],
      }),
    );
    const entries = await listMonologueEvents("token", "calendar-id", "2026-09", {
      fetch: fetchMock,
    });
    expect(entries).toEqual([{ date: "2026-09-23", title: "実在", body: "- b" }]);
  });
});

describe("insertMonologueEvent", () => {
  it("終日予定（start＝当日・end＝翌日・timeZoneなし）で作成する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "event-1" }));
    const result = await insertMonologueEvent(
      "token",
      "calendar-id",
      { date: "2026-09-23", title: "朝の思いつき", body: "- まず書く" },
      { fetch: fetchMock },
    );
    expect(result).toEqual({ id: "event-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.googleapis.com/calendar/v3/calendars/calendar-id/events");
    expect(JSON.parse(String(init?.body))).toEqual({
      summary: "朝の思いつき",
      description: "- まず書く",
      start: { date: "2026-09-23" },
      end: { date: "2026-09-24" },
    });
  });

  it("date 不正は投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      insertMonologueEvent(
        "token",
        "calendar-id",
        { date: "2026-9-3", title: "t", body: "b" },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("date が不正です");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("暦に存在しない日付（02-30 等）はロールオーバーせず投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    for (const date of ["2026-02-30", "2026-04-31", "2025-02-29", "2026-13-01", "2026-00-10"]) {
      await expect(
        insertMonologueEvent(
          "token",
          "calendar-id",
          { date, title: "t", body: "b" },
          { fetch: fetchMock },
        ),
      ).rejects.toThrow("date が不正です");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("うるう年の 02-29 は受け付ける", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "event-1" }));
    const result = await insertMonologueEvent(
      "token",
      "calendar-id",
      { date: "2024-02-29", title: "t", body: "b" },
      { fetch: fetchMock },
    );
    expect(result).toEqual({ id: "event-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("失敗時は投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("denied", { status: 403, statusText: "Forbidden" }),
    );
    await expect(
      insertMonologueEvent(
        "token",
        "calendar-id",
        { date: "2026-09-23", title: "t", body: "b" },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("作成に失敗しました: 403");
  });
});
