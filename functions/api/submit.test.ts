import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import { onRequestPost } from "./submit";

type SubmitContext = Parameters<typeof onRequestPost>[0];

const ENV: Env = { GITHUB_PAT: "test-token", GEMINI_API_KEY: "test-gemini-key" };

const PROJECT_ENV: Env = {
  ...ENV,
  PROJECT_ID: "PVT_project",
  STATUS_FIELD_ID: "PVTSSF_field",
  STATUS_OPTION_ID: "option_draft",
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const geminiOk = (title: string, body: string): Response =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ title, body }) }] } }],
  });

const graphqlOk = (data: unknown): Response => jsonResponse({ data });

function context(body: string, env: Partial<Env> = {}): SubmitContext {
  return {
    request: new Request("https://jotter.example/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    env,
  } as unknown as SubmitContext;
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

function mockHappyPath(overrides: { number?: number; title?: string } = {}) {
  const number = overrides.number ?? 7;
  const title = overrides.title ?? "LLM タイトル";
  const fetchMock = vi.fn<typeof fetch>();
  fetchMock.mockResolvedValueOnce(geminiOk(title, "LLM 本文"));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
  fetchMock.mockResolvedValueOnce(
    jsonResponse(
      { number, title, html_url: `https://github.com/t-miura-024/note/issues/${number}` },
      201,
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/submit", () => {
  it("GITHUB_PAT 未設定なら 500 を返す", async () => {
    const response = await onRequestPost(context('{"jot":"hello"}', { GEMINI_API_KEY: "key" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GITHUB_PAT が設定されていません",
    });
  });

  it("GEMINI_API_KEY 未設定なら 500 を返す", async () => {
    const response = await onRequestPost(context('{"jot":"hello"}', { GITHUB_PAT: "token" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "サーバー設定エラー: GEMINI_API_KEY が設定されていません",
    });
  });

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

  it("不正な JSON ボディなら 400 を返す", async () => {
    const response = await onRequestPost(context("not json", ENV));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "リクエストボディが不正な JSON です",
    });
  });

  it("成功時は SSE で formatting → creating → done を返す", async () => {
    mockHappyPath();

    const response = await onRequestPost(context('{"jot":"走り書きの本文"}', ENV));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "creating", "done"]);

    const done = events[2].data;
    expect(done).toEqual({
      number: 7,
      title: "LLM タイトル",
      url: "https://github.com/t-miura-024/note/issues/7",
      repo: "t-miura-024/note",
      body: "LLM 本文",
      modelUsed: "gemini-flash-latest",
      fallbackOccurred: false,
      projectAdded: false,
    });
  });

  it("fallback 発生時は done に fallbackOccurred: true と最終モデルを含む", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Resource exhausted" } }, 429),
    );
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { number: 8, title: "タイトル", html_url: "https://github.com/t-miura-024/note/issues/8" },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.modelUsed).toBe("gemini-flash-lite-latest");
    expect(done.fallbackOccurred).toBe(true);
  });

  it("preferredModel をリクエストで指定できる", async () => {
    const fetchMock = mockHappyPath({ number: 9 });

    await onRequestPost(
      context('{"jot":"走り書き","preferredModel":"gemini-pro-latest"}', ENV),
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-pro-latest");
  });

  it("LLM 整形が失敗したら SSE error イベントを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { message: "Internal Server Error" } }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"hello"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "error"]);
    expect(String(events[1].data.error)).toContain("LLM 整形に失敗しました");
  });

  it("GitHub API が失敗したら SSE error イベントを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"hello"}', ENV));

    const events = await parseSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["formatting", "creating", "error"]);
    expect(String(events[2].data.error)).toContain("label 'kind/plan' の作成に失敗しました");
  });

  it("内部 repo 指定時はその repo に kind/plan のみで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 11,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/tools/issues/11",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context('{"jot":"走り書き","repo":"t-miura-024/tools"}', ENV),
    );

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/tools");

    const issueCall = fetchMock.mock.calls[2];
    expect(String(issueCall[0])).toContain("/repos/t-miura-024/tools/issues");
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan"]);
  });

  it("外部 repo 指定時は note inbox に external label 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 12,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/12",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context('{"jot":"走り書き","repo":"other-org/some-repo"}', ENV),
    );

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");

    const externalLabelCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(externalLabelCall[1]?.body)).name).toBe(
      "external/other-org-some-repo",
    );
    const issueCall = fetchMock.mock.calls[3];
    expect(String(issueCall[0])).toContain("/repos/t-miura-024/note/issues");
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual([
      "kind/plan",
      "external/other-org-some-repo",
    ]);
  });

  it("repo 未指定（空文字）時は note inbox に external/others 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 13,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/13",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き","repo":""}', ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");

    const externalLabelCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(externalLabelCall[1]?.body)).name).toBe("external/others");
    const issueCall = fetchMock.mock.calls[3];
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan", "external/others"]);
  });

  it("repo フィールド省略時は note inbox に external/others 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 14,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/14",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");

    const issueCall = fetchMock.mock.calls[3];
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan", "external/others"]);
  });

  it("Project secret 設定時は projectAdded: true を done に含める", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 20,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/20",
        },
        201,
      ),
    );
    fetchMock.mockResolvedValueOnce(graphqlOk({ repository: { issue: { id: "I_node20" } } }));
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ addProjectV2ItemById: { item: { id: "PVTI_item" } } }),
    );
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_item" } } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', PROJECT_ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.projectAdded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("Project 連携が失敗しても done + projectAdded: false を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 21,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/21",
        },
        201,
      ),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: "Project not found" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', PROJECT_ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.number).toBe(21);
    expect(done.projectAdded).toBe(false);
  });
});
