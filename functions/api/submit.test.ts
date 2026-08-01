import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../_types";
import { onRequestPost } from "./submit";

type SubmitContext = Parameters<typeof onRequestPost>[0];

const ENV: Env = { GITHUB_PAT: "test-token", GEMINI_API_KEY: "test-gemini-key" };

/** Project 連携の secret まで揃った環境（M4）。 */
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

/** Gemini generateContent の成功レスポンスを模す。 */
const geminiOk = (title: string, body: string): Response =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ title, body }) }] } }],
  });

/** GitHub GraphQL の成功レスポンス（HTTP 200 + data）を模す。 */
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

  it("リクエストが不正なら PAT 未設定より先に 400 を返す", async () => {
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

  it("成功時は 201 と Issue 情報 + modelUsed + fallbackOccurred を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("LLM タイトル", "LLM 本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 7,
          title: "LLM タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/7",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書きの本文"}', ENV));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      number: 7,
      title: "LLM タイトル",
      url: "https://github.com/t-miura-024/note/issues/7",
      repo: "t-miura-024/note",
      modelUsed: "gemini-flash-latest",
      fallbackOccurred: false,
      projectAdded: false,
    });
  });

  it("fallback 発生時は fallbackOccurred: true と最終モデルを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Resource exhausted" } }, 429), // flash 429
    );
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // flash-lite OK
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 8,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/8",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', ENV));

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      modelUsed: string;
      fallbackOccurred: boolean;
    };
    expect(body.modelUsed).toBe("gemini-flash-lite-latest");
    expect(body.fallbackOccurred).toBe(true);
  });

  it("preferredModel をリクエストで指定できる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 9,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/9",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(
      context('{"jot":"走り書き","preferredModel":"gemini-pro-latest"}', ENV),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { modelUsed: string };
    expect(body.modelUsed).toBe("gemini-pro-latest");
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-pro-latest");
  });

  it("LLM 整形が失敗したら 502 を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { message: "Internal Server Error" } }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"hello"}', ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("LLM 整形に失敗しました");
  });

  it("GitHub API が失敗したら 502 にエラーメッセージを載せる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini OK
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Internal Server Error" }, 500), // label 失敗
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"hello"}', ENV));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("label 'kind/plan' の作成に失敗しました");
  });

  it("内部 repo 指定時はその repo に kind/plan のみで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
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

    expect(response.status).toBe(201);
    const body = (await response.json()) as { repo: string };
    expect(body.repo).toBe("t-miura-024/tools");

    // Issue 作成リクエストが t-miura-024/tools に向いている
    const issueCall = fetchMock.mock.calls[2];
    expect(String(issueCall[0])).toContain("/repos/t-miura-024/tools/issues");
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan"]);
  });

  it("外部 repo 指定時は note inbox に external label 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external label 確保
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

    expect(response.status).toBe(201);
    const body = (await response.json()) as { repo: string };
    expect(body.repo).toBe("t-miura-024/note");

    // external label が確保されている
    const externalLabelCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(externalLabelCall[1]?.body)).name).toBe(
      "external/other-org-some-repo",
    );
    // Issue 作成リクエストに両 label が付いている
    const issueCall = fetchMock.mock.calls[3];
    expect(String(issueCall[0])).toContain("/repos/t-miura-024/note/issues");
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual([
      "kind/plan",
      "external/other-org-some-repo",
    ]);
  });

  it("repo 未指定（空文字）時は note inbox に external/others 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
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

    expect(response.status).toBe(201);
    const body = (await response.json()) as { repo: string };
    expect(body.repo).toBe("t-miura-024/note");

    // external/others label が確保されている
    const externalLabelCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(externalLabelCall[1]?.body)).name).toBe("external/others");
    // Issue 作成リクエストに両 label が付いている
    const issueCall = fetchMock.mock.calls[3];
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan", "external/others"]);
  });

  it("repo フィールド省略時は note inbox に external/others 付きで起票する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
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

    expect(response.status).toBe(201);
    const body = (await response.json()) as { repo: string };
    expect(body.repo).toBe("t-miura-024/note");

    const issueCall = fetchMock.mock.calls[3];
    expect(JSON.parse(String(issueCall[1]?.body)).labels).toEqual(["kind/plan", "external/others"]);
  });

  it("Project secret 設定時は Project 追加 + Status 設定まで行い projectAdded: true を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 20,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/20",
        },
        201,
      ),
    ); // Issue 作成
    fetchMock.mockResolvedValueOnce(graphqlOk({ repository: { issue: { id: "I_node20" } } })); // node ID 解決
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ addProjectV2ItemById: { item: { id: "PVTI_item" } } }),
    ); // item 追加
    fetchMock.mockResolvedValueOnce(
      graphqlOk({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_item" } } }),
    ); // Status=draft
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', PROJECT_ENV));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { projectAdded: boolean };
    expect(body.projectAdded).toBe(true);

    // 起票 4 呼び出し + GraphQL 3 呼び出し
    expect(fetchMock).toHaveBeenCalledTimes(7);
    // node ID 解決が起票した Issue（t-miura-024/note#20）を対象にしている
    const nodeIdCall = fetchMock.mock.calls[4];
    expect(String(nodeIdCall[0])).toBe("https://api.github.com/graphql");
    expect(JSON.parse(String(nodeIdCall[1]?.body)).variables).toEqual({
      owner: "t-miura-024",
      name: "note",
      number: 20,
    });
    // item 追加が解決済み node ID を contentId に使っている
    const addItemBody = JSON.parse(String(fetchMock.mock.calls[5][1]?.body));
    expect(addItemBody.query).toContain("addProjectV2ItemById");
    expect(addItemBody.variables).toEqual({ projectId: "PVT_project", contentId: "I_node20" });
    // Status=draft 設定が追加済み item ID と secret の field/option を使っている
    const statusBody = JSON.parse(String(fetchMock.mock.calls[6][1]?.body));
    expect(statusBody.query).toContain("updateProjectV2ItemFieldValue");
    expect(statusBody.variables).toEqual({
      projectId: "PVT_project",
      itemId: "PVTI_item",
      fieldId: "PVTSSF_field",
      optionId: "option_draft",
    });
  });

  it("Project 連携が失敗しても 201 + projectAdded: false を返す（起票は成功扱い）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文")); // Gemini
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan label 確保
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external/others label 確保
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 21,
          title: "タイトル",
          html_url: "https://github.com/t-miura-024/note/issues/21",
        },
        201,
      ),
    ); // Issue 作成
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: "Project not found" }] })); // node ID 解決が失敗
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context('{"jot":"走り書き"}', PROJECT_ENV));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { number: number; projectAdded: boolean };
    expect(body.number).toBe(21);
    expect(body.projectAdded).toBe(false);
  });
});
