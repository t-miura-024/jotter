import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { SubmitResult } from "../../shared/submit";
import type { FormatJotResult } from "./gemini";

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

/** 応答 200 だが candidates が空（応答解析エラーのテスト用）。 */
const emptyCandidates = (): Response =>
  new Response(JSON.stringify({ candidates: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const OPTIONS = { apiKey: "test-key" };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

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

  it("500 はフォールバック対象", () => {
    const err = new GeminiError("internal error", 500, "gemini-flash-latest");
    expect(isFallbackTarget(err)).toBe(true);
  });

  it("503 はフォールバック対象", () => {
    const err = new GeminiError(
      "This model is currently experiencing high demand.",
      503,
      "gemini-flash-latest",
    );
    expect(isFallbackTarget(err)).toBe(true);
  });

  it("400 はフォールバック対象外", () => {
    const err = new GeminiError("bad request", 400, "gemini-flash-latest");
    expect(isFallbackTarget(err)).toBe(false);
  });

  it("401 はフォールバック対象外", () => {
    const err = new GeminiError("unauthorized", 401, "gemini-flash-latest");
    expect(isFallbackTarget(err)).toBe(false);
  });
});

describe("formatJot", () => {
  it("整形結果と done の履歴は同じ型契約を使う", () => {
    expectTypeOf<FormatJotResult["fallbacks"]>().toEqualTypeOf<SubmitResult["fallbacks"]>();
  });

  it.each([undefined, "gemini-pro-latest"])(
    "複数失敗を実際の試行順に保持する（%s）",
    async (preferredModel) => {
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValueOnce(geminiHttpError(500, "Internal error"));
      fetchMock.mockResolvedValueOnce(geminiHttpError(503, "High demand"));
      fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
      const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock, preferredModel });
      const chain = buildModelChain(preferredModel);
      expect(result.fallbacks).toEqual([
        { model: chain[0], status: 500, message: "Internal error" },
        { model: chain[1], status: 503, message: "High demand" },
      ]);
      expect(result.modelUsed).toBe(chain[2]);
      expect(
        fetchMock.mock.calls.map(([url]) => String(url).split("/models/")[1].split(":")[0]),
      ).toEqual(chain);
      expect(console.warn).toHaveBeenCalledTimes(2);
      result.fallbacks.forEach((fallback, index) => {
        expect(console.warn).toHaveBeenNthCalledWith(
          index + 1,
          "Gemini モデルの整形に失敗しました。",
          fallback,
        );
      });
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it.each([119, 120, 121, 200])(
    "元メッセージ %i 文字を 120 文字以内に切り詰める",
    async (length) => {
      const message = "あ".repeat(length);
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValueOnce(geminiHttpError(429, message));
      fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
      const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
      expect(result.fallbacks).toEqual([
        { model: GEMINI_MODELS[0], status: 429, message: message.slice(0, 120) },
      ]);
    },
  );

  it.each([
    JSON.stringify({ error: { message: "" } }),
    JSON.stringify({ error: {} }),
    JSON.stringify({ error: { message: { code: 503 } } }),
    JSON.stringify({ error: { message: 503 } }),
    "raw secret body",
  ])("message が空・欠落・非文字列・JSON 不正なら statusText のみを使う（%s）", async (body) => {
    const fetchMock = vi.fn<typeof fetch>();
    const statusText = "Service Unavailable ".repeat(10);
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 503, statusText }));
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.fallbacks[0].message).toBe(statusText.slice(0, 120));
  });

  it("切り詰め範囲外の quota でも既存判定を維持する", async () => {
    const message = "x".repeat(130) + " Quota exceeded";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiHttpError(403, message));
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.fallbacks[0]).toEqual({
      model: GEMINI_MODELS[0],
      status: 403,
      message: "x".repeat(120),
    });
  });

  it("ネットワークエラーは同じ例外を即座に投げる", async () => {
    const error = new TypeError("Failed to fetch");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(error);
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    { name: "対象外の 400", failure: async () => geminiHttpError(400, "Invalid argument") },
    {
      name: "ネットワークエラー",
      failure: async () => Promise.reject(new TypeError("Failed to fetch")),
    },
    { name: "応答が空", failure: async () => emptyCandidates() },
  ] as const)(
    "先行 2 モデル失敗後、最後のモデルが $name でも全モデル失敗を 1 回ログに残す",
    async ({ failure }) => {
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValueOnce(geminiHttpError(500, "Internal error"));
      fetchMock.mockResolvedValueOnce(geminiHttpError(503, "High demand"));
      fetchMock.mockImplementationOnce(failure);
      await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const fallbacks = [
        { model: GEMINI_MODELS[0], status: 500, message: "Internal error" },
        { model: GEMINI_MODELS[1], status: 503, message: "High demand" },
      ];
      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "すべての Gemini モデルで整形に失敗しました。",
        fallbacks,
      );
    },
  );
  it("最後のモデルが非文字列 message でも履歴生成で落ちず全モデル失敗をログに残す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiHttpError(500, "Internal error"));
    fetchMock.mockResolvedValueOnce(geminiHttpError(503, "High demand"));
    const statusText = "Service Unavailable";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: { code: 503 } } }), {
        status: 503,
        statusText,
      }),
    );
    await expect(formatJot("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      `Gemini API (${GEMINI_MODELS[2]}): 503 ${statusText}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "すべての Gemini モデルで整形に失敗しました。",
      [
        { model: GEMINI_MODELS[0], status: 500, message: "Internal error" },
        { model: GEMINI_MODELS[1], status: 503, message: "High demand" },
        { model: GEMINI_MODELS[2], status: 503, message: statusText },
      ],
    );
  });
  it("最初のモデルで成功したら fallbacks: [] を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result).toEqual({
      title: "タイトル",
      body: "本文",
      modelUsed: "gemini-flash-latest",
      fallbacks: [],
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
    expect(result.fallbacks).toHaveLength(1);
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
    expect(result.fallbacks).toHaveLength(1);
  });

  it("503 のとき次のモデルへフォールバックする", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      geminiHttpError(503, "This model is currently experiencing high demand."),
    );
    fetchMock.mockResolvedValueOnce(geminiOk("タイトル", "本文"));
    const result = await formatJot("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.modelUsed).toBe("gemini-flash-lite-latest");
    expect(result.fallbacks).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(result.fallbacks).toEqual([]);
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
    expect(result.fallbacks).toHaveLength(1);
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
