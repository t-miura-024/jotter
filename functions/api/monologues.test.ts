import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import { utf8ToBase64 } from "../_github/monologue-note";
import {
  MONOLOGUE_DAILY_FETCH_CONCURRENCY,
  datesInMonth,
  mergeMonologues,
  monologueMonthCacheKey,
  onRequestGet,
  purgeMonologueMonthCache,
} from "./monologues";

type MonologuesContext = Parameters<typeof onRequestGet>[0];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const notFound = (): Response => new Response("Not Found", { status: 404 });

const noteFile = (content: string): Response =>
  jsonResponse({ sha: "sha-1", content: utf8ToBase64(content), encoding: "base64" });

const tokenOk = (): Response => jsonResponse({ access_token: "ya29.test" });

/** テスト用 RSA 鍵の秘密鍵 PEM を生成する（monologue-submit.test.ts と同じ方式）。 */
async function generatePrivatePem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  let binary = "";
  for (let i = 0; i < der.length; i++) binary += String.fromCharCode(der[i]);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`;
}

let ENV: Env;

function context(query: string, env: Partial<Env> = {}): MonologuesContext {
  return {
    request: new Request(`https://jotter.example/api/monologues${query}`),
    env,
  } as unknown as MonologuesContext;
}

const NOTE_23 = `# 💬 Monologue
- 08:15
    ### 朝の思いつき
    - まず書く
- 21:00
    ### 夜のメモ
    - ふりかえり
`;

type BackendOptions = {
  noteFiles?: Record<string, string>;
  calendarItems?: unknown[];
  noteError?: { status: number; message: string };
  calendarError?: { status: number; statusText: string };
};

/** URL ルーティングで note / token / calendar に振り分ける fetch モック。 */
function mockBackend(fetchMock: ReturnType<typeof vi.fn>, options: BackendOptions = {}) {
  const { noteFiles = {}, calendarItems = [], noteError, calendarError } = options;
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("api.github.com")) {
      if (noteError) {
        return jsonResponse({ message: noteError.message }, noteError.status);
      }
      const match = url.match(/(\d{4}-\d{2}-\d{2})\.md/);
      const content = match ? noteFiles[match[1]] : undefined;
      if (content === undefined) return notFound();
      return noteFile(content);
    }
    if (url.includes("oauth2.googleapis.com")) return tokenOk();
    if (url.includes("www.googleapis.com")) {
      if (calendarError) {
        return new Response("denied", {
          status: calendarError.status,
          statusText: calendarError.statusText,
        });
      }
      return jsonResponse({ items: calendarItems });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** Cache API のフェイク実装（repo-stats.test.ts と同じ方式）。delete 付き。 */
function createFakeCache(): {
  cache: {
    match: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
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
      delete: vi.fn(async (url: string) => entries.delete(url)),
    },
    entries,
  };
}

beforeAll(async () => {
  const privatePem = await generatePrivatePem();
  ENV = {
    GITHUB_PAT: "test-token",
    GEMINI_API_KEY: "test-gemini-key",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "monologue@example.iam.gserviceaccount.com",
      private_key: privatePem,
    }),
    MONOLOGUE_CALENDAR_ID: "monologue@example.com",
  };
});

beforeEach(() => {
  vi.stubGlobal("caches", undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("datesInMonth", () => {
  it("月内の全日付を昇順で返す", () => {
    const dates = datesInMonth("2026-09");
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-09-01");
    expect(dates[29]).toBe("2026-09-30");
  });

  it("うるう年 2 月は 29 日まで返す", () => {
    expect(datesInMonth("2024-02")).toHaveLength(29);
    expect(datesInMonth("2026-02")).toHaveLength(28);
  });
});

describe("mergeMonologues", () => {
  it("日付＋正規化タイトル＋正規化本文の一致で突合し、片方のみも許容する", () => {
    const merged = mergeMonologues(
      [
        {
          title: "朝の思いつき",
          body: "- まず書く",
          date: "2026-09-23",
          time: "08:15",
          sources: { note: true, google: false },
        },
        {
          title: "noteのみ",
          body: "- 本文",
          date: "2026-09-10",
          time: "09:00",
          sources: { note: true, google: false },
        },
      ],
      [
        // 空白違いは正規化一致で突合する（タイトル前後空白・本文の空行揺れを吸収）
        { date: "2026-09-23", title: "  朝の思いつき  ", body: "  - まず書く\n" },
        { date: "2026-09-11", title: "GCのみ", body: "- カレンダーから" },
      ],
    );
    expect(merged).toEqual([
      {
        title: "朝の思いつき",
        body: "- まず書く",
        gcBody: "  - まず書く\n",
        date: "2026-09-23",
        time: "08:15",
        sources: { note: true, google: true },
      },
      {
        title: "GCのみ",
        body: "- カレンダーから",
        gcBody: "- カレンダーから",
        date: "2026-09-11",
        time: null,
        sources: { note: false, google: true },
      },
      {
        title: "noteのみ",
        body: "- 本文",
        date: "2026-09-10",
        time: "09:00",
        sources: { note: true, google: false },
      },
    ]);
  });

  it("同日同名でも本文が違えば突合しない（body を含めた冪等判定と統一）", () => {
    const merged = mergeMonologues(
      [
        {
          title: "同じ",
          body: "- note本文",
          date: "2026-09-23",
          time: "08:15",
          sources: { note: true, google: false },
        },
      ],
      [{ date: "2026-09-23", title: "同じ", body: "- gc本文" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.filter((entry) => entry.sources.google)).toHaveLength(1);
    expect(merged.filter((entry) => entry.sources.note)).toHaveLength(1);
    const googleOnly = merged.find((entry) => !entry.sources.note)!;
    expect(googleOnly).toMatchObject({
      body: "- gc本文",
      date: "2026-09-23",
      time: null,
      sources: { note: false, google: true },
    });
  });

  it("同日同名同本文の重複は潰さず1:1消費する（note複数＋GC単数）", () => {
    const merged = mergeMonologues(
      [
        {
          title: "同じ",
          body: "- 1件目",
          date: "2026-09-23",
          time: "08:15",
          sources: { note: true, google: false },
        },
        {
          title: "同じ",
          body: "- 2件目",
          date: "2026-09-23",
          time: "09:00",
          sources: { note: true, google: false },
        },
      ],
      [{ date: "2026-09-23", title: "同じ", body: "- 1件目" }],
    );
    expect(merged).toHaveLength(2);
    const matched = merged.filter((entry) => entry.sources.google);
    const unmatched = merged.filter((entry) => !entry.sources.google);
    expect(matched).toHaveLength(1);
    expect(matched[0].gcBody).toBe("- 1件目");
    // note 本文は優先され、GC 本文は gcBody に残る
    expect(matched[0].body).toMatch(/^- \d件目$/);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].sources).toEqual({ note: true, google: false });
    expect(unmatched[0].gcBody).toBeUndefined();
  });

  it("同日同名同本文の重複は潰さず1:1消費する（note単数＋GC複数）", () => {
    const merged = mergeMonologues(
      [
        {
          title: "同じ",
          body: "- note本文",
          date: "2026-09-23",
          time: "08:15",
          sources: { note: true, google: false },
        },
      ],
      [
        { date: "2026-09-23", title: "同じ", body: "- note本文" },
        { date: "2026-09-23", title: "同じ", body: "- gc2" },
      ],
    );
    expect(merged).toHaveLength(2);
    const matched = merged.filter((entry) => entry.sources.note);
    const googleOnly = merged.filter((entry) => !entry.sources.note);
    expect(matched).toHaveLength(1);
    expect(matched[0].sources).toEqual({ note: true, google: true });
    expect(matched[0].body).toBe("- note本文");
    expect(matched[0].gcBody).toBe("- note本文");
    expect(googleOnly).toHaveLength(1);
    expect(googleOnly[0]).toMatchObject({
      body: "- gc2",
      gcBody: "- gc2",
      date: "2026-09-23",
      time: null,
      sources: { note: false, google: true },
    });
  });

  it("GCのみは時刻なし（null）で同日最下位にソートする", () => {
    const merged = mergeMonologues(
      [
        {
          title: "note",
          body: "- 本文",
          date: "2026-09-23",
          time: "08:15",
          sources: { note: true, google: false },
        },
      ],
      [{ date: "2026-09-23", title: "GCのみ", body: "- gc" }],
    );
    expect(merged.map((entry) => entry.title)).toEqual(["note", "GCのみ"]);
    expect(merged[1].time).toBeNull();
  });
});

describe("GET /api/monologues — バリデーション", () => {
  it("month 未指定・不正形式は 400 を返す", async () => {
    for (const query of ["", "?month=", "?month=2026-13", "?month=2026-9", "?month=foo"]) {
      const response = await onRequestGet(context(query, ENV));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "month が不正です（YYYY-MM 形式で指定してください）",
      });
    }
  });

  it("GITHUB_PAT 未設定なら 500 を返す", async () => {
    const { GITHUB_PAT: _removed, ...env } = ENV;
    const response = await onRequestGet(context("?month=2026-09", env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GITHUB_PAT が設定されていません",
    });
  });

  it("GOOGLE_SERVICE_ACCOUNT_JSON 未設定なら 500 を返す", async () => {
    const { GOOGLE_SERVICE_ACCOUNT_JSON: _removed, ...env } = ENV;
    const response = await onRequestGet(context("?month=2026-09", env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません",
    });
  });

  it("MONOLOGUE_CALENDAR_ID 未設定なら 500 を返す", async () => {
    const { MONOLOGUE_CALENDAR_ID: _removed, ...env } = ENV;
    const response = await onRequestGet(context("?month=2026-09", env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: MONOLOGUE_CALENDAR_ID が設定されていません",
    });
  });
});

describe("GET /api/monologues — 一覧マージ", () => {
  it("note＋GC をマージして新しい順で返し、片方のみも含める", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, {
      noteFiles: { "2026-09-23": NOTE_23 },
      calendarItems: [
        // 本文まで一致するものだけ突合する（body 違いは別物として両方残す）
        { start: { date: "2026-09-23" }, summary: "朝の思いつき", description: "- まず書く" },
        { start: { date: "2026-09-10" }, summary: "GCのみ", description: "- カレンダーから" },
        // 終日以外・日付なしは無視する
        { start: { dateTime: "2026-09-10T10:00:00+09:00" }, summary: "時刻付き" },
        { summary: "開始なし" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      month: string;
      monologues: Array<{
        title: string;
        body: string;
        gcBody?: string;
        date: string;
        time: string | null;
        sources: { note: boolean; google: boolean };
      }>;
      fetchedAt: string;
    };
    expect(body.month).toBe("2026-09");
    expect(typeof body.fetchedAt).toBe("string");
    expect(body.monologues).toEqual([
      {
        title: "夜のメモ",
        body: "- ふりかえり",
        date: "2026-09-23",
        time: "21:00",
        sources: { note: true, google: false },
      },
      {
        title: "朝の思いつき",
        body: "- まず書く",
        gcBody: "- まず書く",
        date: "2026-09-23",
        time: "08:15",
        sources: { note: true, google: true },
      },
      {
        title: "GCのみ",
        body: "- カレンダーから",
        gcBody: "- カレンダーから",
        date: "2026-09-10",
        time: null,
        sources: { note: false, google: true },
      },
    ]);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("note が 1 件もない月は GC のみ・空も 200 で返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, { calendarItems: [] });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { monologues: unknown[] };
    expect(body.monologues).toEqual([]);
  });

  it("note 取得失敗時は 502 を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, { noteError: { status: 500, message: "Server Error" } });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Monologue一覧の取得に失敗しました");
  });

  it("GC 取得失敗時は 502 を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, { calendarError: { status: 401, statusText: "Unauthorized" } });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Monologue一覧の取得に失敗しました");
  });
});

describe("GET /api/monologues — キャッシュ", () => {
  it("2 回目はキャッシュ hit で外部を呼ばない", async () => {
    const { cache, entries } = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, {
      noteFiles: { "2026-09-23": NOTE_23 },
      calendarItems: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await onRequestGet(context("?month=2026-09", ENV));
    expect(first.status).toBe(200);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(1);

    fetchMock.mockClear();
    const second = await onRequestGet(context("?month=2026-09", ENV));
    expect(second.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await second.json()).toEqual(await first.json());
  });

  it("月ごとにキーを分ける（別月は再取得する）", async () => {
    const { cache } = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, { calendarItems: [] });
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(context("?month=2026-09", ENV));
    fetchMock.mockClear();
    const other = await onRequestGet(context("?month=2026-10", ENV));
    expect(other.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(cache.put).toHaveBeenCalledTimes(2);
  });
});

describe("purgeMonologueMonthCache — submit 成功時の同一月破棄", () => {
  it("同一 month のキャッシュを破棄し、別月は残す", async () => {
    const { cache, entries } = createFakeCache();
    vi.stubGlobal("caches", { default: cache });
    const origin = "https://jotter.example";
    entries.set(
      monologueMonthCacheKey(origin, "2026-09"),
      new Response(JSON.stringify({ month: "2026-09" })),
    );
    entries.set(
      monologueMonthCacheKey(origin, "2026-10"),
      new Response(JSON.stringify({ month: "2026-10" })),
    );

    await purgeMonologueMonthCache("2026-09", origin);

    expect(cache.delete).toHaveBeenCalledWith(monologueMonthCacheKey(origin, "2026-09"));
    expect(entries.has(monologueMonthCacheKey(origin, "2026-09"))).toBe(false);
    expect(entries.has(monologueMonthCacheKey(origin, "2026-10"))).toBe(true);
  });

  it("キャッシュなし環境では何もせず throw しない", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(
      purgeMonologueMonthCache("2026-09", "https://jotter.example"),
    ).resolves.toBeUndefined();
  });
});

describe("GET /api/monologues — 日次取得の並列制限", () => {
  it("日次ノート取得の同時並列数は5以下に抑えつつ全日分を取得する", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return notFound();
      }
      if (url.includes("oauth2.googleapis.com")) return tokenOk();
      if (url.includes("www.googleapis.com")) return jsonResponse({ items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(200);
    expect(maxInFlight).toBeLessThanOrEqual(MONOLOGUE_DAILY_FETCH_CONCURRENCY);
    // 2026-09 は30日。全日分を取得している（逐次化で欠落がない）。
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("api.github.com")),
    ).toHaveLength(30);
  });
});

describe("GET /api/monologues — 日次取得の部分失敗耐性", () => {
  it("単日失敗はスキップし warnings/failedDates 付きで 200 を返す", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        const match = url.match(/(\d{4}-\d{2}-\d{2})\.md/);
        const date = match?.[1];
        if (date === "2026-09-05") {
          return jsonResponse({ message: "Server Error" }, 500);
        }
        if (date === "2026-09-23") return noteFile(NOTE_23);
        return notFound();
      }
      if (url.includes("oauth2.googleapis.com")) return tokenOk();
      if (url.includes("www.googleapis.com")) return jsonResponse({ items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      monologues: Array<{ title: string }>;
      warnings?: string[];
      failedDates?: string[];
    };
    // 失敗日以外は取得できている
    expect(body.monologues.map((entry) => entry.title).sort()).toEqual([
      "夜のメモ",
      "朝の思いつき",
    ]);
    expect(body.failedDates).toEqual(["2026-09-05"]);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings?.[0]).toContain("2026-09-05");
  });

  it("単日失敗なしでは warnings/failedDates を返さない", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, {
      noteFiles: { "2026-09-23": NOTE_23 },
      calendarItems: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      warnings?: string[];
      failedDates?: string[];
    };
    expect(body).not.toHaveProperty("warnings");
    expect(body).not.toHaveProperty("failedDates");
  });

  it("全日失敗時は 502 を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockBackend(fetchMock, { noteError: { status: 500, message: "Server Error" } });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestGet(context("?month=2026-09", ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Monologue一覧の取得に失敗しました");
  });
});
