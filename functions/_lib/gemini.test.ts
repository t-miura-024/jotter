import { describe, expect, it, vi } from "vitest";

import { GEMINI_MODELS, GeminiError, buildModelChain, formatJot, isFallbackTarget } from "./gemini";

const geminiOk = (title: string, body: string): Response =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ title, body }) }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const geminiHttpError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const OPTIONS = { apiKey: "test-key" };

describe("buildModelChain", () => {
  it("未指定ならスピード重視の既定順を返す", () => {
    expect(buildModelChain()).toEqual([...GEMINI_MODELS]);
  });

  it("有効な preferredModel を先頭に移動する", () => {
    expect(buildModelChain("gemini-pro-latest")).toEqual([
      "gemini-pro-latest",
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
    ]);
  });

  it("無効な preferredModel は無視して既定順を返す", () => {
    expect(buildModelChain("gemini-unknown")).toEqual([...GEMINI_MODELS]);
  });

  it("空文字の preferredModel は無視して既定順を返す", () => {
    expect(buildModelChain("")).toEqual([...GEMINI_MODELS]);
  });
});

describe("isFallbackTarget", () => {
  it("429 はフォールバック対象", () => {
    const err = new GeminiError("rate limit", 429, "gemini-flash-latest");
    expect(isFallbackTarget(err)).toBe(true);
  });

  it("quota exceeded メッセージはフォールバック対象", () => {
    const err = new GeminiError("quota", 403, "gemini-flash-latest", {
      error: { message: "Quota exceeded for quota metric 'GenerateContent'" },
    });
    expect(isFallbackTarget(err)).toBe(true);
  });

  it("400 はフォールバック対象外", () => {
    const err = new GeminiError("bad request", 400, "gemini-flash-latest");
    expect(isFallbackTarget(err)).toBe(false);
  });

  it("500 はフォールバック対象外", () => {
    const err = new GeminiError("server error", 500, "gemini-flash-latest");
    expect(isFallbackTarget(err)).toBe(false);
  });
});

describe("formatJot", () => {
  it("最初のモデルで成功したら fallbackOccurred: false を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result).toEqual({
      title: "タイトル",
      body: "本文",
      modelUsed: "gemini-flash-latest",
      fallbackOccurred: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-flash-latest");
  });

  it("429 のとき次のモデルへフォールバックする", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiHttpError(429, "Resource exhausted"));
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.modelUsed).toBe("gemini-flash-lite-latest");
    expect(result.fallbackOccurred).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("quota exceeded のとき次のモデルへフォールバックする", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      geminiHttpError(403, "Quota exceeded for quota metric 'GenerateContent'"),
    );
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.modelUsed).toBe("gemini-flash-lite-latest");
    expect(result.fallbackOccurred).toBe(true);
  });

  it("400 はフォールバックせず即座に投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiHttpError(400, "Invalid argument"));
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      GeminiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("全モデル失敗時は最後のエラーを投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiHttpError(429, "Resource exhausted"));
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "gemini-pro-latest",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preferredModel を先頭に使う", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", {
      ...OPTIONS,
      preferredModel: "gemini-pro-latest",
      fetch: fetchMock,
    });
    expect(result.modelUsed).toBe("gemini-pro-latest");
    expect(result.fallbackOccurred).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-pro-latest");
  });

  it("preferredModel が 429 のとき残りのチェーンでフォールバックする", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiHttpError(429, "Resource exhausted"));
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", {
      ...OPTIONS,
      preferredModel: "gemini-pro-latest",
      fetch: fetchMock,
    });
    // pro が 429 → 次の flash-latest で成功
    expect(result.modelUsed).toBe("gemini-flash-latest");
    expect(result.fallbackOccurred).toBe(true);
  });

  it("応答が空なら GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "応答が空です",
    );
  });

  it("応答の JSON が不正なら GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "not json" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "JSON 解析に失敗しました",
    );
  });

  it("title/body が文字列でなければ GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"title": 123, "body": "ok"}' }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "title/body が文字列ではありません",
    );
  });

  it("API key が URL に含まれる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("タイトル", "本文"));
    await formatJot("走り書き", { apiKey: "my-secret-key", fetch: fetchMock });
    expect(String(fetchMock.mock.calls[0][0])).toContain("key=my-secret-key");
  });
});
