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

const createdIssue = (number: number, repo: string): Response =>
  jsonResponse(
    {
      number,
      title: "LLM タイトル",
      html_url: `https://github.com/${repo}/issues/${number}`,
    },
    201,
  );

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

/** note inbox への起票（外部 repo なし: kind/plan label のみ）の正常系モック。 */
function mockNoteInboxSuccess(fetchMock: ReturnType<typeof vi.fn>, number = 7) {
  fetchMock.mockResolvedValueOnce(geminiOk("LLM タイトル", "LLM 本文"));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
  fetchMock.mockResolvedValueOnce(createdIssue(number, "t-miura-024/note"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/submit — 基本バリデーション", () => {
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
});

describe("POST /api/submit — repo 選択（内部 repo 限定）", () => {
  it("内部 repo 指定時はその repo に kind/plan のみで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(createdIssue(11, "t-miura-024/tools"));
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

  it("repo 未指定（空文字）時は note inbox に label なしで起票する（external/others は付けない）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockNoteInboxSuccess(fetchMock, 13);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き","repo":""}', ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");

    // kind/plan label の確保のみ（external label の確保は行わない）
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const issueCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan"]);
  });

  it("repo フィールド省略時は note inbox に label なしで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockNoteInboxSuccess(fetchMock, 14);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).labels).toEqual(["kind/plan"]);
  });

  it("外部 repo を repo に指定すると 400（新 semantics: repo は内部 repo のみ）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context('{"jot":"走り書き","repo":"other-org/some-repo"}', ENV),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("内部 repo");
    // LLM・GitHub API は一切呼ばない
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("成功時は SSE で formatting → creating → done を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockNoteInboxSuccess(fetchMock, 7);
    vi.stubGlobal("fetch", fetchMock);

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
    fetchMock.mockResolvedValueOnce(createdIssue(8, "t-miura-024/note"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.modelUsed).toBe("gemini-flash-lite-latest");
    expect(done.fallbackOccurred).toBe(true);
  });

  it("preferredModel をリクエストで指定できる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockNoteInboxSuccess(fetchMock, 9);
    vi.stubGlobal("fetch", fetchMock);

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

  it("Project secret 設定時は projectAdded: true を done に含める", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(createdIssue(20, "t-miura-024/note"));
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
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("Project 連携が失敗しても done + projectAdded: false を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(createdIssue(21, "t-miura-024/note"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: "Project not found" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', PROJECT_ENV));

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.number).toBe(21);
    expect(done.projectAdded).toBe(false);
  });
});

describe("POST /api/submit — 外部 repo 入力（note inbox 限定の external label）", () => {
  it("note inbox 選択 + 有効な外部 repo 入力 → note inbox に external/{owner}-{name} 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(createdIssue(12, "t-miura-024/note"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context('{"jot":"走り書き","repo":"t-miura-024/note","externalRepo":"other-org/some-repo"}', ENV),
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

  it("note inbox 選択 + 空の外部 repo 入力 → label なしで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    mockNoteInboxSuccess(fetchMock, 15);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context('{"jot":"走り書き","repo":"t-miura-024/note","externalRepo":""}', ENV),
    );

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).labels).toEqual(["kind/plan"]);
  });

  it("note inbox 以外の内部 repo 選択 + 外部 repo 入力 → 入力は無視してその repo に直接起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(createdIssue(16, "t-miura-024/tools"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context(
        '{"jot":"走り書き","repo":"t-miura-024/tools","externalRepo":"other-org/some-repo"}',
        ENV,
      ),
    );

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/tools");
    // external label の確保は行われない（kind/plan のみ）
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).labels).toEqual(["kind/plan"]);
  });

  it("不正な外部 repo 入力は 400 で、LLM・GitHub API を呼ばずに失敗する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const cases = [
      "t-miura-024/tools", // 内部 repo
      "no-slash", // owner/name 形式でない
      "owner/a..b", // repo 名規則違反
      "bad owner/name", // owner 規則違反
      `${"o".repeat(21)}/${"n".repeat(20)}`, // label 長超過
    ];
    for (const externalRepo of cases) {
      const response = await onRequestPost(
        context(
          JSON.stringify({ jot: "走り書き", repo: "t-miura-024/note", externalRepo }),
          ENV,
        ),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error.length).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("外部 repo 入力の前後空白は除去して検証する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    fetchMock.mockResolvedValueOnce(createdIssue(17, "t-miura-024/note"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context(
        '{"jot":"走り書き","repo":"t-miura-024/note","externalRepo":"  other-org/some-repo  "}',
        ENV,
      ),
    );

    const events = await parseSseEvents(response);
    const done = events.find((e) => e.event === "done")!.data;
    expect(done.repo).toBe("t-miura-024/note");
    const externalLabelCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(externalLabelCall[1]?.body)).name).toBe(
      "external/other-org-some-repo",
    );
  });
});
