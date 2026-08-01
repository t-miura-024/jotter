/**
 * Gemini REST API クライアント（ADR 0005 / 0007）。
 *
 * fallback chain: gemini-flash-latest → gemini-flash-lite-latest → gemini-pro-latest
 * 429 / quota exceeded のとき次のモデルへフォールバックする（ADR 0005）。
 * API key は Cloudflare secret（env.GEMINI_API_KEY）から受け取り、ブラウザには出さない（ADR 0003）。
 */

/** スピード重視の固定 fallback チェーン（ADR 0005）。 */
export const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-pro-latest",
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number];

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** LLM 整形の結果（title + body）。 */
export type FormattedJot = {
  title: string;
  body: string;
};

/** formatJot の返却値。整形結果 + 使用モデル情報（M5 UI が消費する）。 */
export type FormatJotResult = FormattedJot & {
  /** 実際に応答を返したモデル名。 */
  modelUsed: string;
  /** 優先モデル以外へフォールバックしたか。 */
  fallbackOccurred: boolean;
};

export type GeminiClientOptions = {
  apiKey: string;
  /** fetch 実装。テストで注入可能。 */
  fetch?: typeof fetch;
};

/** Gemini API 呼び出しの失敗。status と model を保持する。 */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly model: string,
    /** フォールバック判定に使う生のエラーボディ。 */
    readonly errorBody?: unknown,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** エラーボディから message 文字列を抜き出す。 */
function extractErrorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  return (body as { error?: { message?: string } }).error?.message ?? "";
}

/** 429 または quota exceeded をフォールバック対象とみなす（ADR 0005）。 */
export function isFallbackTarget(error: GeminiError): boolean {
  if (error.status === 429) return true;
  return extractErrorMessage(error.errorBody).toLowerCase().includes("quota");
}

/**
 * preferredModel を先頭に置いたモデルチェーンを構築する。
 * 無効・未指定の場合は既定のスピード重視順をそのまま返す。
 */
export function buildModelChain(preferredModel?: string): readonly string[] {
  if (!preferredModel || !(GEMINI_MODELS as readonly string[]).includes(preferredModel)) {
    return GEMINI_MODELS;
  }
  const rest = GEMINI_MODELS.filter((m) => m !== preferredModel);
  return [preferredModel as GeminiModel, ...rest];
}

/**
 * ADR 0007: タイトル抽出 + 読みやすい Markdown への清書のみ。
 * 意味変更・セクション捏造禁止。
 */
const SYSTEM_PROMPT = [
  "あなたは走り書き（jot）を整理するアシスタントです。",
  "入力された走り書きから、GitHub Issue 用のタイトルと本文を生成してください。",
  "",
  "ルール:",
  "- タイトル: 内容を簡潔に表すタイトル（120文字以内）。元の走り書きの言語に合わせる。",
  "- 本文: 読みやすい Markdown に清書する。",
  "- 意味の変更やセクションの捏造は禁止。元の走り書きに含まれない情報は追加しない。",
  "",
  "必ず以下の JSON 形式のみで応答してください（説明文・コードブロック不要）:",
  '{"title": "...", "body": "..."}',
].join("\n");

/** 1 モデルに対して Gemini generateContent を呼び出す。 */
async function callGemini(
  jot: string,
  model: string,
  options: GeminiClientOptions,
): Promise<FormattedJot> {
  // workerd の "Illegal invocation" を避けるためアロー関数で束縛を保つ（client.ts と同じ方針）。
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  const response = await doFetch(
    `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
    const detail = extractErrorMessage(errorBody) || response.statusText;
    throw new GeminiError(
      `Gemini API (${model}): ${response.status} ${detail}`,
      response.status,
      model,
      errorBody,
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
  return { title: parsed.title, body: parsed.body };
}

/**
 * jot を LLM で整形する（ADR 0007: 忠実な記録のみ）。
 *
 * preferredModel を先頭にしたチェーンで順に試し、
 * 429 / quota exceeded のときは次のモデルへフォールバックする（ADR 0005）。
 * フォールバック対象外のエラー（ネットワークエラー・4xx 非 429 など）は即座に投げる。
 * 全モデル失敗時は最後に発生したエラーを投げる。
 */
export async function formatJot(
  jot: string,
  options: GeminiClientOptions & { preferredModel?: string },
): Promise<FormatJotResult> {
  const chain = buildModelChain(options.preferredModel);
  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const formatted = await callGemini(jot, model, options);
      return { ...formatted, modelUsed: model, fallbackOccurred: i > 0 };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      // GeminiError 以外（ネットワークエラー等）は即座に投げる
      if (!(err instanceof GeminiError)) throw err;
      // フォールバック対象外（429 以外の 4xx など）は即座に投げる
      if (!isFallbackTarget(err)) throw err;
    }
  }

  throw lastError ?? new Error("すべてのモデルで整形に失敗しました");
}
