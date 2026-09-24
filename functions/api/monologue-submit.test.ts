import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import {
  getJstDateTime,
  hasDuplicateMonologueEntry,
  onRequestPost,
  parseMonologueRetry,
} from "./monologue/submit";

type MonologueSubmitContext = Parameters<typeof onRequestPost>[0];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const geminiOk = (title: string, body: string): Response =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ title, body }) }] } }],
  });

const geminiFailAll = (): Response[] => [
  jsonResponse({ error: { message: "Internal Server Error" } }, 500),
  jsonResponse({ error: { message: "Internal Server Error" } }, 500),
  jsonResponse({ error: { message: "Internal Server Error" } }, 500),
];

const notFound = (): Response => new Response("Not Found", { status: 404 });

const putOk = (sha = "new-sha"): Response => jsonResponse({ content: { sha } }, 200);

const tokenOk = (): Response => jsonResponse({ access_token: "ya29.test" });

const calendarOk = (id = "event-1"): Response => jsonResponse({ id });

/** テスト用 RSA 鍵の秘密鍵 PEM を生成する（auth.test.ts と同じ方式）。 */
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

let privatePem = "";

let ENV: Env;

function context(body: string, env: Partial<Env> = {}): MonologueSubmitContext {
  return {
    request: new Request("https://jotter.example/api/monologue/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    env,
  } as unknown as MonologueSubmitContext;
}

type SseEvent = { event: string; data: Record<string, unknown> };

async function parseSseEvents(response: Response): Promise<SseEvent[]> {
  const text = await response.text();
  const events: SseEvent[] = [];
  for (const block of text.split("\n\n").filter(Boolean)) {
    const eventMatch = block.match(/^event: (.+)$/m);
    const dataMatch = block.match(/^data: (.+)$/m);
    if (eventMatch && dataMatch) {
      events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
    }
  }
  return events;
}

/** 成功系の fetch 既定列: gemini → note重複チェックGET(404) → template GET(404) → note PUT → token → calendar一覧(空) → calendar作成。重複チェック取得済みを append へ渡すため note GET は1回のみ。 */
function mockSuccess(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(geminiOk("朝の思いつき", "- まず書く"));
  fetchMock.mockResolvedValueOnce(notFound());
  fetchMock.mockResolvedValueOnce(notFound());
  fetchMock.mockResolvedValueOnce(putOk());
  fetchMock.mockResolvedValueOnce(tokenOk());
  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
  fetchMock.mockResolvedValueOnce(calendarOk());
}

/** note ファイル取得（200）のモック応答を作る。 */
const contentsOk = (content: string, sha: string): Response => {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return jsonResponse({ sha, content: btoa(binary), encoding: "base64" });
};

beforeAll(async () => {
  privatePem = await generatePrivatePem();
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getJstDateTime", () => {
  it("Asia/Tokyo の日付と時刻を返す", () => {
    // 2026-01-01T00:00:00Z = JST 09:00
    expect(getJstDateTime(new Date("2026-01-01T00:00:00Z"))).toEqual({
      date: "2026-01-01",
      time: "09:00",
    });
  });

  it("JST の日跨ぎを反映する", () => {
    // 2026-01-01T15:00:00Z = JST 2026-01-02 00:00
    expect(getJstDateTime(new Date("2026-01-01T15:00:00Z"))).toEqual({
      date: "2026-01-02",
      time: "00:00",
    });
  });
});

describe("POST /api/monologue/submit — 基本バリデーション", () => {
  it("リクエストが不正なら 400 を返す", async () => {
    const response = await onRequestPost(context("not json", {}));
    expect(response.status).toBe(400);
  });

  it("jot が空白のみなら 400 を返す", async () => {
    const response = await onRequestPost(context('{"jot":"   "}', ENV));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "jot が空です" });
  });

  it("jot フィールドが欠けていれば 400 を返す", async () => {
    const response = await onRequestPost(context('{"foo":1}', ENV));
    expect(response.status).toBe(400);
  });

  it("GITHUB_PAT 未設定なら 500 を返す", async () => {
    const { GITHUB_PAT: _removed, ...env } = ENV;
    const response = await onRequestPost(context('{"jot":"hello"}', env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GITHUB_PAT が設定されていません",
    });
  });

  it("GEMINI_API_KEY 未設定なら 500 を返す", async () => {
    const { GEMINI_API_KEY: _removed, ...env } = ENV;
    const response = await onRequestPost(context('{"jot":"hello"}', env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GEMINI_API_KEY が設定されていません",
    });
  });

  it("GOOGLE_SERVICE_ACCOUNT_JSON 未設定なら 500 を返す", async () => {
    const { GOOGLE_SERVICE_ACCOUNT_JSON: _removed, ...env } = ENV;
    const response = await onRequestPost(context('{"jot":"hello"}', env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません",
    });
  });

  it("MONOLOGUE_CALENDAR_ID 未設定なら 500 を返す", async () => {
    const { MONOLOGUE_CALENDAR_ID: _removed, ...env } = ENV;
    const response = await onRequestPost(context('{"jot":"hello"}', env));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: MONOLOGUE_CALENDAR_ID が設定されていません",
    });
  });
});

describe("POST /api/monologue/submit — SSE 両出力", () => {
  it("成功時は formatting → writing-note → creating-event → done を返し両方 ok になる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockSuccess(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書きの本文"}', ENV));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual([
      "formatting",
      "writing-note",
      "creating-event",
      "done",
    ]);

    const done = events[3].data;
    expect(done.title).toBe("朝の思いつき");
    expect(done.body).toBe("- まず書く");
    expect(done.date).toBe(getJstDateTime().date);
    expect(done.time).toMatch(/^\d{2}:\d{2}$/);
    expect(done.noteOk).toBe(true);
    expect(done.gcOk).toBe(true);
    expect(done).not.toHaveProperty("eventId");
    expect(done.modelUsed).toBe("gemini-flash-latest");
    expect(done.fallbacks).toEqual([]);
    expect(done.noteError).toBeUndefined();
    expect(done.gcError).toBeUndefined();
  });

  it("note PUT の内容は thino 形式（- HH:MM＋### タイトル＋箇条書き）になる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockSuccess(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));
    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;

    const putCall = fetchMock.mock.calls[3];
    expect(String(putCall[0])).toContain("/repos/t-miura-024/note/contents/");
    const putBody = JSON.parse(String(putCall[1]?.body)) as { content: string };
    const binary = atob(putBody.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const markdown = new TextDecoder().decode(bytes);
    expect(markdown).toContain(`- ${done.time}`);
    expect(markdown).toContain("    ### 朝の思いつき");
    expect(markdown).toContain("    - まず書く");
  });

  it("GC insert は終日予定（start.date＝当日）で summary/description を送る", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockSuccess(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));
    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;

    const calendarCall = fetchMock.mock.calls[6];
    expect(String(calendarCall[0])).toContain("/calendars/monologue%40example.com/events");
    expect((calendarCall[1] as RequestInit | undefined)?.method).toBe("POST");
    const calendarBody = JSON.parse(String(calendarCall[1]?.body)) as {
      summary: string;
      description: string;
      start: { date: string };
    };
    expect(calendarBody.summary).toBe("朝の思いつき");
    expect(calendarBody.description).toBe("- まず書く");
    expect(calendarBody.start.date).toBe(done.date);
  });

  it("preferredModel をリクエストで指定できる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockSuccess(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestPost(context('{"jot":"走り書き","preferredModel":"gemini-pro-latest"}', ENV));

    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-pro-latest");
  });

  it("note 失敗時は done＋noteOk:false で GC は継続する（失敗側のみリトライ可能）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "- 本文"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Internal Server Error" }, 500));
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    fetchMock.mockResolvedValueOnce(calendarOk());
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual([
      "formatting",
      "writing-note",
      "creating-event",
      "done",
    ]);
    const done = events[3].data;
    expect(done.noteOk).toBe(false);
    expect(done.gcOk).toBe(true);
    expect(String(done.noteError)).toContain("note の取得に失敗しました");
    expect(done.gcError).toBeUndefined();
  });

  it("GC 失敗時は done＋gcOk:false で note は成功扱いのまま残る", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "- 本文"));
    fetchMock.mockResolvedValueOnce(notFound());
    fetchMock.mockResolvedValueOnce(notFound());
    fetchMock.mockResolvedValueOnce(putOk());
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual([
      "formatting",
      "writing-note",
      "creating-event",
      "done",
    ]);
    const done = events[3].data;
    expect(done.noteOk).toBe(true);
    expect(done.gcOk).toBe(false);
    expect(String(done.gcError)).toContain("Google Calendar の作成に失敗しました");
    expect(done.noteError).toBeUndefined();
  });

  it("LLM 整形が失敗したら SSE error イベントを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    for (const response of geminiFailAll()) fetchMock.mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"hello"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "error"]);
    expect(String(events[1].data.error)).toContain("LLM 整形に失敗しました");
  });

  it("LLM 応答の body に見出し行が混ざれば SSE error を返し追記・予定作成しない", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "# 見出し\n- 本文"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "error"]);
    expect(String(events[1].data.error)).toContain("LLM 整形");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("LLM 応答の title が121文字なら SSE error を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("あ".repeat(121), "- 本文"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "error"]);
    expect(String(events[1].data.error)).toContain("120文字");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("LLM 応答の body が4000文字超過なら SSE error を返し追記・予定作成しない", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", `- ${"あ".repeat(3999)}`));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "error"]);
    expect(String(events[1].data.error)).toContain("4000文字");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("hasDuplicateMonologueEntry", () => {
  const markdown = ["# 💬 Monologue", "- 10:00", "    ### タイトル", "    - 本文", ""].join("\n");

  it("同一 title/body/date/time は重複と判定する", () => {
    expect(
      hasDuplicateMonologueEntry(markdown, "2026-09-23", {
        time: "10:00",
        title: "タイトル",
        body: "- 本文",
      }),
    ).toBe(true);
  });

  it("時刻が違えば matchTime=true では重複にしない", () => {
    expect(
      hasDuplicateMonologueEntry(
        markdown,
        "2026-09-23",
        { time: "10:01", title: "タイトル", body: "- 本文" },
        true,
      ),
    ).toBe(false);
  });

  it("時刻が違っても matchTime=false では重複と判定する（jot 再送抑止用）", () => {
    expect(
      hasDuplicateMonologueEntry(
        markdown,
        "2026-09-23",
        { time: "10:01", title: "タイトル", body: "- 本文" },
        false,
      ),
    ).toBe(true);
  });

  it("タイトル・本文の体裁揺れ（空白・空行）を吸収する", () => {
    expect(
      hasDuplicateMonologueEntry(
        markdown,
        "2026-09-23",
        { time: "10:00", title: "　タイトル　", body: "\n- 本文\n" },
        false,
      ),
    ).toBe(true);
  });

  it("異なるタイトルは重複にしない", () => {
    expect(
      hasDuplicateMonologueEntry(markdown, "2026-09-23", {
        time: "10:00",
        title: "別のタイトル",
        body: "- 本文",
      }),
    ).toBe(false);
  });
});

describe("parseMonologueRetry", () => {
  it("retryOnly が不正ならエラーを返す", () => {
    expect(parseMonologueRetry({ retryOnly: "both" })).toEqual({
      ok: false,
      error: "retryOnly は 'note' または 'gc' を指定してください",
    });
  });

  it("date が不正ならエラーを返す", () => {
    const result = parseMonologueRetry({
      retryOnly: "note",
      title: "t",
      body: "- b",
      date: "2026/09/23",
      time: "10:00",
    });
    expect(result.ok).toBe(false);
  });

  it("暦上実在しない date（02-30 等）はエラーを返す", () => {
    const result = parseMonologueRetry(
      {
        retryOnly: "note",
        title: "t",
        body: "- b",
        date: "2026-02-30",
        time: "10:00",
      },
      new Date("2026-02-30T00:00:00+09:00"),
    );
    expect(result).toEqual({
      ok: false,
      error: "date が不正です（YYYY-MM-DD 形式で指定してください）",
    });
  });

  it("受付窓（当日含む過去7日）より古い date はエラーを返す", () => {
    const result = parseMonologueRetry(
      {
        retryOnly: "note",
        title: "t",
        body: "- b",
        date: "2026-09-15",
        time: "10:00",
      },
      new Date("2026-09-23T00:00:00+09:00"),
    );
    expect(result).toEqual({
      ok: false,
      error: "date は過去7日以内〜当日（JST）のみ指定できます",
    });
  });

  it("未来の date はエラーを返す", () => {
    const result = parseMonologueRetry(
      {
        retryOnly: "note",
        title: "t",
        body: "- b",
        date: "2026-09-24",
        time: "10:00",
      },
      new Date("2026-09-23T00:00:00+09:00"),
    );
    expect(result).toEqual({
      ok: false,
      error: "date は過去7日以内〜当日（JST）のみ指定できます",
    });
  });

  it("前日・7日前の date は受け付ける（日跨ぎ回復用）", () => {
    const now = new Date("2026-09-23T00:00:00+09:00");
    for (const date of ["2026-09-23", "2026-09-22", "2026-09-16"]) {
      const result = parseMonologueRetry(
        { retryOnly: "note", title: "t", body: "- b", date, time: "10:00" },
        now,
      );
      expect(result).toEqual({
        ok: true,
        retry: { retryOnly: "note", date, time: "10:00", title: "t", body: "- b" },
      });
    }
  });

  it("time が不正ならエラーを返す", () => {
    const result = parseMonologueRetry({
      retryOnly: "gc",
      title: "t",
      body: "- b",
      date: getJstDateTime().date,
      time: "25:00",
    });
    expect(result.ok).toBe(false);
  });

  it("正常時は正規化済みの対象を返す", () => {
    const today = getJstDateTime().date;
    expect(
      parseMonologueRetry({
        retryOnly: "note",
        title: "タイトル",
        body: "- 本文\n",
        date: today,
        time: "10:00",
      }),
    ).toEqual({
      ok: true,
      retry: {
        retryOnly: "note",
        date: today,
        time: "10:00",
        title: "タイトル",
        body: "- 本文",
      },
    });
  });
});

describe("POST /api/monologue/submit — 失敗側専用リトライ", () => {
  const retryDate = (): string => getJstDateTime().date;
  const retryNoteBody = (): string =>
    JSON.stringify({
      retryOnly: "note",
      title: "タイトル",
      body: "- 本文",
      date: retryDate(),
      time: "10:00",
    });
  const retryGcBody = (): string =>
    JSON.stringify({
      retryOnly: "gc",
      title: "タイトル",
      body: "- 本文",
      date: retryDate(),
      time: "10:00",
    });

  it("retryOnly が不正なら 400 を返す", async () => {
    const response = await onRequestPost(context('{"retryOnly":"both"}', ENV));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "retryOnly は 'note' または 'gc' を指定してください",
    });
  });

  it("リトライ対象の日付・時刻が不正なら 400 を返す", async () => {
    const badDate = await onRequestPost(
      context(
        JSON.stringify({ retryOnly: "note", title: "t", body: "- b", date: "x", time: "10:00" }),
        ENV,
      ),
    );
    expect(badDate.status).toBe(400);
    const badTime = await onRequestPost(
      context(
        JSON.stringify({ retryOnly: "gc", title: "t", body: "- b", date: retryDate(), time: "x" }),
        ENV,
      ),
    );
    expect(badTime.status).toBe(400);
  });

  it("暦上実在しない日付のリトライは 400 を返す", async () => {
    const response = await onRequestPost(
      context(
        JSON.stringify({
          retryOnly: "note",
          title: "t",
          body: "- b",
          date: "2026-02-30",
          time: "10:00",
        }),
        ENV,
      ),
    );
    expect(response.status).toBe(400);
  });

  it("受付窓より古い日付のリトライは 400 を返す", async () => {
    const response = await onRequestPost(
      context(
        JSON.stringify({
          retryOnly: "note",
          title: "t",
          body: "- b",
          date: "2000-01-01",
          time: "10:00",
        }),
        ENV,
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "date は過去7日以内〜当日（JST）のみ指定できます",
    });
  });

  it("note リトライは GC を再実行せず writing-note → done を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(notFound());
    fetchMock.mockResolvedValueOnce(notFound());
    fetchMock.mockResolvedValueOnce(putOk());
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryNoteBody(), ENV));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["writing-note", "done"]);
    const done = events[1].data;
    expect(done.noteOk).toBe(true);
    expect(done.gcOk).toBe(false);
    expect(done.gcSkipped).toBe(true);
    expect(done.gcError).toBe("未実行（失敗側のみ再送のため）");
    expect(done.title).toBe("タイトル");
    expect(done.date).toBe(retryDate());
    expect(done.time).toBe("10:00");
    expect(done.modelUsed).toBe("retry");
    // GC（Google API）へは一切触れない＝成功側の重複が起きない
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("googleapis"))).toHaveLength(
      0,
    );
    // 重複チェックGET＋テンプレートGET＋PUT の3回（append 側の再 GET なし）
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("note リトライの再送（同一 title/body/date/time）は PUT せず成功扱いにする", async () => {
    const existing = ["# 💬 Monologue", "- 10:00", "    ### タイトル", "    - 本文", ""].join("\n");
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(contentsOk(existing, "sha-1"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryNoteBody(), ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["writing-note", "done"]);
    expect(events[1].data.noteOk).toBe(true);
    expect(events[1].data.gcOk).toBe(false);
    expect(events[1].data.gcSkipped).toBe(true);
    // 重複チェックの GET のみで追記 PUT はしない
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("note リトライ失敗時は done＋noteOk:false で GC は未実行明示のまま残る", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Internal Server Error" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryNoteBody(), ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["writing-note", "done"]);
    const done = events[1].data;
    expect(done.noteOk).toBe(false);
    expect(done.gcOk).toBe(false);
    expect(done.gcSkipped).toBe(true);
    expect(String(done.noteError)).toContain("note の取得に失敗しました");
  });

  it("gc リトライは note を再実行せず creating-event → done を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    fetchMock.mockResolvedValueOnce(calendarOk("event-9"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryGcBody(), ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["creating-event", "done"]);
    const done = events[1].data;
    expect(done.noteOk).toBe(false);
    expect(done.noteSkipped).toBe(true);
    expect(done.noteError).toBe("未実行（失敗側のみ再送のため）");
    expect(done.gcOk).toBe(true);
    expect(done).not.toHaveProperty("eventId");
    // note（GitHub API）へは一切触れない＝成功側の重複が起きない
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("api.github.com")),
    ).toHaveLength(0);
  });

  it("gc リトライの再送（同日＋正規化タイトル一致）は予定を再作成しない", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ start: { date: retryDate() }, summary: "　タイトル　", description: "- 本文" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryGcBody(), ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["creating-event", "done"]);
    expect(events[1].data.gcOk).toBe(true);
    expect(events[1].data.noteOk).toBe(false);
    expect(events[1].data.noteSkipped).toBe(true);
    expect(events[1].data).not.toHaveProperty("eventId");
    // token 取得＋一覧のみで予定作成 POST はしない
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/calendars/") && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("通常経路の jot 再送（同内容・時刻違い）は note へ二重追記しない", async () => {
    const existing = ["# 💬 Monologue", "- 08:00", "    ### タイトル", "    - 本文", ""].join("\n");
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "- 本文"));
    fetchMock.mockResolvedValueOnce(contentsOk(existing, "sha-1"));
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    fetchMock.mockResolvedValueOnce(calendarOk());
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual([
      "formatting",
      "writing-note",
      "creating-event",
      "done",
    ]);
    const done = events[3].data;
    expect(done.noteOk).toBe(true);
    expect(done.gcOk).toBe(true);
    // note 追記 PUT は呼ばれない
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT"),
    ).toHaveLength(0);
  });

  it("gc リトライで同タイトルでも本文が違えば再作成する（body を含めて冪等判定）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ start: { date: retryDate() }, summary: "タイトル", description: "- 別の本文" }],
      }),
    );
    fetchMock.mockResolvedValueOnce(calendarOk("event-10"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryGcBody(), ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["creating-event", "done"]);
    expect(events[1].data.gcOk).toBe(true);
    expect(events[1].data.noteOk).toBe(false);
    expect(events[1].data).not.toHaveProperty("eventId");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/calendars/") && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("gc リトライで本文の体裁揺れ（空白・空行）は重複と判定し再作成しない", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ start: { date: retryDate() }, summary: "タイトル", description: "  - 本文\n\n" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(retryGcBody(), ENV));

    const events = await parseSseEvents(response);
    expect(events[1].data.gcOk).toBe(true);
    expect(events[1].data.noteOk).toBe(false);
    expect(events[1].data).not.toHaveProperty("eventId");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/calendars/") && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(0);
  });

  it("通常経路の jot 再送（同内容）は GC へ二重作成しない", async () => {
    const today = getJstDateTime().date;
    const noteMarkdown = ["# 💬 Monologue", "- 08:00", "    ### タイトル", "    - 本文", ""].join(
      "\n",
    );
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "- 本文"));
    fetchMock.mockResolvedValueOnce(contentsOk(noteMarkdown, "sha-1"));
    fetchMock.mockResolvedValueOnce(tokenOk());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ start: { date: today }, summary: "タイトル", description: "- 本文" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual([
      "formatting",
      "writing-note",
      "creating-event",
      "done",
    ]);
    const done = events[3].data;
    expect(done.noteOk).toBe(true);
    expect(done.gcOk).toBe(true);
    expect(done).not.toHaveProperty("eventId");
    // GC 予定作成 POST は増えない（一覧 GET のみ）
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/calendars/") && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(0);
  });
});

describe("POST /api/monologue/submit — preferredModel 検証とサイズ上限", () => {
  it("preferredModel が不正なら 400 を返す", async () => {
    const response = await onRequestPost(
      context('{"jot":"走り書き","preferredModel":"gemini-unknown"}', ENV),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "preferredModel が不正です" });
  });

  it("preferredModel が文字列でなければ 400 を返す", async () => {
    const response = await onRequestPost(context('{"jot":"走り書き","preferredModel":123}', ENV));
    expect(response.status).toBe(400);
  });

  it("preferredModel 未指定は 400 にならない（既定チェーンを使う）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockSuccess(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));
    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toContain("done");
  });

  it("jot が4000文字超過なら 400 を返す", async () => {
    const response = await onRequestPost(context(JSON.stringify({ jot: "あ".repeat(4001) }), ENV));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "jot が4000文字を超えています" });
  });

  it("jot が4000文字ちょうどなら受け付ける", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockSuccess(fetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context(JSON.stringify({ jot: "あ".repeat(4000) }), ENV));
    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toContain("done");
  });

  it("parseMonologueRetry は body が4000文字超過ならエラーを返す", () => {
    const result = parseMonologueRetry({
      retryOnly: "note",
      title: "タイトル",
      body: `- ${"あ".repeat(3999)}`,
      date: getJstDateTime().date,
      time: "10:00",
    });
    expect(result.ok).toBe(false);
  });

  it("parseMonologueRetry は body が4000文字ちょうどなら通す", () => {
    const result = parseMonologueRetry({
      retryOnly: "note",
      title: "タイトル",
      body: `- ${"あ".repeat(3998)}`,
      date: getJstDateTime().date,
      time: "10:00",
    });
    expect(result.ok).toBe(true);
  });

  it("parseMonologueRetry は title が121文字ならエラーを返す", () => {
    const result = parseMonologueRetry({
      retryOnly: "note",
      title: "あ".repeat(121),
      body: "- 本文",
      date: getJstDateTime().date,
      time: "10:00",
    });
    expect(result.ok).toBe(false);
  });

  it("リトライ経路で body が4000文字超過なら 400 を返す", async () => {
    const response = await onRequestPost(
      context(
        JSON.stringify({
          retryOnly: "note",
          title: "タイトル",
          body: `- ${"あ".repeat(3999)}`,
          date: getJstDateTime().date,
          time: "10:00",
        }),
        ENV,
      ),
    );
    expect(response.status).toBe(400);
  });
});
