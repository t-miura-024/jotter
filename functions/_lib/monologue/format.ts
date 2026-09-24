/**
 * Monologue 専用 Gemini クライアント。
 *
 * Plan 用 `../gemini.ts` の SYSTEM_PROMPT は流用せず別管理する。
 * faithful 継承（ADR 0007: 意味変更・情報追加の禁止）に加え、
 * 「タイトル120字以内＋本文箇条書きのみ＋入力の表現・口調そのまま」を課す。
 * フォールバック鎖・エラー型・判定は既存 gemini.ts をそのまま再利用する。
 */
import type { FallbackEvent } from "../../../shared/submit";
import type { GeminiClientOptions } from "../gemini";
import { buildModelChain, GeminiError, isFallbackTarget } from "../gemini";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** LLM 整形の結果（title + body）。本文は箇条書きのみ。 */
export type FormattedMonologue = {
  title: string;
  body: string;
};

/** formatMonologue の返却値。整形結果 + 使用モデル情報。 */
export type FormatMonologueResult = FormattedMonologue & {
  /** 実際に応答を返したモデル名。 */
  modelUsed: string;
  /** 試行順に保持した失敗モデルの履歴。空配列＝フォールバックなし。 */
  fallbacks: FallbackEvent[];
};

/**
 * Monologue 専用プロンプト（Plan と別管理）。
 * タイトル120字以内・本文箇条書きのみ・口調維持（言い換え・丁寧語化しない）。
 */
export const MONOLOGUE_SYSTEM_PROMPT = [
  "あなたは日々の断片（monologue）を整理するアシスタントです。",
  "入力された走り書きから、タイトルと本文を生成してください。",
  "",
  "ルール:",
  "- タイトル: 内容を簡潔に表すタイトル（120文字以内）。元の走り書きの言語に合わせる。",
  "- 本文: 箇条書きのみ（- で始まる行だけ）で清書する。箇条書き以外の形式は使わない。",
  "- 入力の表現・口調をそのまま利用する。言い換え・丁寧語化はしない。",
  "- 意味の変更や情報の追加は禁止。元の走り書きに含まれない情報は追加しない。",
  "",
  "必ず以下の JSON 形式のみで応答してください（説明文・コードブロック不要）:",
  '{"title": "...", "body": "..."}',
].join("\n");

/** 1 モデルに対して Gemini generateContent を呼び出す。 */
async function callMonologue(
  jot: string,
  model: string,
  options: GeminiClientOptions,
): Promise<FormattedMonologue> {
  // workerd の "Illegal invocation" を避けるためアロー関数で束縛を保つ（gemini.ts と同じ方針）。
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  const response = await doFetch(
    `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: MONOLOGUE_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: jot }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    },
  );

  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      // body 解析失敗時はステータス行を使う
    }
    const message =
      typeof errorBody === "object" &&
      errorBody !== null &&
      typeof (errorBody as { error?: { message?: unknown } }).error?.message === "string"
        ? ((errorBody as { error: { message: string } }).error.message as string)
        : response.statusText;
    throw new GeminiError(
      `Gemini API (${model}): ${response.status} ${message}`,
      response.status,
      model,
      errorBody,
      message,
    );
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError(`Gemini API (${model}): 応答が空です`, response.status, model);
  }

  let parsed: { title?: unknown; body?: unknown };
  try {
    parsed = JSON.parse(text) as { title?: unknown; body?: unknown };
  } catch {
    throw new GeminiError(
      `Gemini API (${model}): 応答の JSON 解析に失敗しました`,
      response.status,
      model,
    );
  }
  if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new GeminiError(
      `Gemini API (${model}): title/body が文字列ではありません`,
      response.status,
      model,
    );
  }
  return validateFormattedMonologue(parsed.title, parsed.body, model, response.status);
}

/** Monologue 用 LLM 出力の遵守検証上限。 */
const MAX_MONOLOGUE_TITLE_LENGTH = 120;

/**
 * LLM 整形結果を検証する。プロンプト遵守（タイトル120字以内・本文箇条書きのみ）を
 * 未検証のまま信用せず、違反時は GeminiError を投げる（整形失敗として SSE error へ）。
 */
function validateFormattedMonologue(
  title: string,
  body: string,
  model: string,
  status: number,
): FormattedMonologue {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new GeminiError(`Gemini API (${model}): title が空です`, status, model);
  }
  if (normalizedTitle.includes("\n") || normalizedTitle.includes("\r")) {
    throw new GeminiError(`Gemini API (${model}): title に改行が含まれています`, status, model);
  }
  if ([...normalizedTitle].length > MAX_MONOLOGUE_TITLE_LENGTH) {
    throw new GeminiError(`Gemini API (${model}): title が120文字を超えています`, status, model);
  }
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    throw new GeminiError(`Gemini API (${model}): body が空です`, status, model);
  }
  const invalid = normalizedBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .find((line) => !line.startsWith("- "));
  if (invalid !== undefined) {
    throw new GeminiError(
      `Gemini API (${model}): body に箇条書き以外の行があります`,
      status,
      model,
    );
  }
  return { title: normalizedTitle, body: normalizedBody };
}

/**
 * jot を Monologue 用に LLM で整形する。
 *
 * preferredModel を先頭にしたチェーンで順に試し、
 * 429 / 500 / 503 / quota exceeded のときは次のモデルへフォールバックする（gemini.ts と同一）。
 */
export async function formatMonologue(
  jot: string,
  options: GeminiClientOptions & { preferredModel?: string },
): Promise<FormatMonologueResult> {
  const chain = buildModelChain(options.preferredModel);
  let lastError: Error | null = null;
  const fallbacks: FallbackEvent[] = [];

  for (const [index, model] of chain.entries()) {
    try {
      const formatted = await callMonologue(jot, model, options);
      return { ...formatted, modelUsed: model, fallbacks };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      if (!(err instanceof GeminiError) || !isFallbackTarget(err)) {
        if (index === chain.length - 1) break;
        throw err;
      }
      const fallback: FallbackEvent = {
        model: err.model,
        status: err.status,
        message: err.detail.slice(0, 120),
      };
      fallbacks.push(fallback);
      console.warn("Gemini モデルの整形に失敗しました。", fallback);
    }
  }

  console.error("すべての Gemini モデルで整形に失敗しました。", fallbacks);
  throw lastError ?? new Error("すべてのモデルで整形に失敗しました");
}
