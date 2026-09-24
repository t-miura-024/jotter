import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GEMINI_MODELS, GeminiError } from "../gemini";
import { formatMonologue, MONOLOGUE_SYSTEM_PROMPT } from "./format";

const monologueOk = (title: string, body: string): Response =>
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

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("MONOLOGUE_SYSTEM_PROMPT", () => {
  it("Plan と別管理で箇条書き強制＋口調維持を含む", () => {
    expect(MONOLOGUE_SYSTEM_PROMPT).toContain("120文字以内");
    expect(MONOLOGUE_SYSTEM_PROMPT).toContain("箇条書きのみ");
    expect(MONOLOGUE_SYSTEM_PROMPT).toContain("口調をそのまま");
  });
});

describe("formatMonologue", () => {
  it("整形結果と使用モデル・空履歴を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("朝の思いつき", "- まず書く"));
    const result = await formatMonologue("朝 思いつき 書く", { ...OPTIONS, fetch: fetchMock });
    expect(result).toEqual({
      title: "朝の思いつき",
      body: "- まず書く",
      modelUsed: "gemini-flash-latest",
      fallbacks: [],
    });
  });

  it("Monologue 専用プロンプトと temperature 0.1 で呼び出す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("t", "- b"));
    await formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { temperature: number };
    };
    expect(payload.systemInstruction.parts[0].text).toBe(MONOLOGUE_SYSTEM_PROMPT);
    expect(payload.systemInstruction.parts[0].text).toContain("箇条書きのみ");
    expect(payload.generationConfig.temperature).toBe(0.1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("key=test-key");
  });

  it("429 のとき次のモデルへフォールバックし履歴を残す", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(geminiHttpError(429, "Resource exhausted"));
    fetchMock.mockResolvedValueOnce(monologueOk("t", "- b"));
    const result = await formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.modelUsed).toBe("gemini-flash-lite-latest");
    expect(result.fallbacks).toEqual([
      { model: GEMINI_MODELS[0], status: 429, message: "Resource exhausted" },
    ]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("400 はフォールバックせず即座に投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiHttpError(400, "Invalid argument"));
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      GeminiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("全モデル失敗時は最後のエラーを投げ全失敗を 1 回ログに残す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiHttpError(503, "High demand"));
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "gemini-pro-latest",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("応答の JSON が不正なら GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "JSON 解析に失敗しました",
    );
  });

  it("body に箇条書き以外の行があれば GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("t", "# 見出し\n- b"));
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "箇条書き以外の行",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("body の平文混入も GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("t", "- ok\nただの文"));
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "箇条書き以外の行",
    );
  });

  it("title が121文字なら GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("あ".repeat(121), "- b"));
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "120文字を超えています",
    );
  });

  it("title の改行混入は GeminiError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("朝の\n思いつき", "- b"));
    await expect(formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock })).rejects.toThrow(
      "改行が含まれています",
    );
  });

  it("title ちょうど120文字・箇条書き複数行は通す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => monologueOk("あ".repeat(120), "- a\n- b"));
    const result = await formatMonologue("走り書き", { ...OPTIONS, fetch: fetchMock });
    expect(result.title).toBe("あ".repeat(120));
    expect(result.body).toBe("- a\n- b");
  });
});
