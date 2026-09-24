import type { FallbackEvent } from "../../../shared/submit";
import { normalizeMonologueBody, normalizeMonologueTitle } from "../../../shared/monologue";
import { GitHubClient } from "../../_github/client";
import { appendMonologueToNote, dailyNotePath, getNoteFile } from "../../_github/monologue-note";
import { getAccessToken } from "../../_google/auth";
import {
  insertMonologueEvent,
  isValidCalendarDate,
  listMonologueEvents,
} from "../../_google/calendar";
import { GEMINI_MODELS } from "../../_lib/gemini";
import { formatMonologue } from "../../_lib/monologue/format";
import { parseMonologueSection, sanitizeThinoEntry } from "../../_lib/monologue/thino";
import type { Env } from "../../_types";
// monologues 側は submit を import しないため循環 import は起きない（直接 import）。
import { purgeMonologueMonthCache } from "../monologues";

type MonologueSubmitRequestBody = {
  jot?: unknown;
  preferredModel?: unknown;
  /** 失敗側専用リトライ時に指定する。'note' | 'gc' のみ受け付ける。 */
  retryOnly?: unknown;
  /** リトライ対象（done ペイロードの値をそのまま再送する）。 */
  title?: unknown;
  body?: unknown;
  date?: unknown;
  time?: unknown;
};

/**
 * POST /api/monologue/submit の done ペイロード。
 *
 * 常時両出力（note＋GC）の成否を両方含める。片方失敗時は SSE error ではなく
 * done＋失敗明示とし（既存 submit.ts の projectAdded パターン踏襲）、失敗側のみ
 * リトライできる。入力保持はクライアント側責務（done 内の title/body/date/time を再送に使う）。
 * リトライ時は { retryOnly: 'note' | 'gc', title, body, date, time } を送ると
 * 成功側を再実行せず失敗側だけ実行する（成功側の重複を防ぐ）。
 */
export type MonologueSubmitResult = {
  title: string;
  body: string;
  /** 対象日（JST）。形式: YYYY-MM-DD。 */
  date: string;
  /** 作成時刻（JST）。形式: HH:MM。 */
  time: string;
  modelUsed: string;
  fallbacks: FallbackEvent[];
  noteOk: boolean;
  gcOk: boolean;
  /** note 失敗時のみ存在する。 */
  noteError?: string;
  /** GC 失敗時のみ存在する。 */
  gcError?: string;
  /**
   * 非実行側の明示フラグ。失敗側専用リトライでは実行しない側を
   * ok:true（成功扱い）にせず、ok:false＋skipped:true＋「未実行」エラーで返す。
   * 成功偽装（非実行側を true で返す）を避け、クライアントが再送要否を誤判定しないため。
   */
  noteSkipped?: boolean;
  gcSkipped?: boolean;
  // NOTE: GC の eventId は YAGNI のため done に含めない（クライアント側で未使用）。
  // GC 追跡が将来必要になれば eventId?: string を再導入する。
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** 現在時刻から JST の日付（YYYY-MM-DD）と時刻（HH:MM）を求める。作成日＝当日固定用。 */
export function getJstDateTime(now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

const RETRY_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const RETRY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 通常経路の jot 上限（文字数）。超過は 400 で拒否する。 */
export const MAX_MONOLOGUE_JOT_LENGTH = 4000;
/** リトライ経路の body 上限（文字数）。title 120字は sanitizeThinoEntry が検証する。 */
export const MAX_MONOLOGUE_RETRY_BODY_LENGTH = 4000;

export type MonologueRetryEntry = {
  /** 作成時刻（JST）。形式: HH:MM。 */
  time: string;
  title: string;
  /** 箇条書きのみ（`- ` で始まる行）。 */
  body: string;
};

/**
 * Monologue 本文を正規化する（GC 冪等判定・note 重複判定用）。
 * 実体は shared/monologue の同一名関数（重複排除のため再export）。
 */
export { normalizeMonologueBody } from "../../../shared/monologue";

/**
 * GC 予定が対象エントリと重複するか。
 * 同日＋正規化タイトル＋正規化本文で判定する（note 側 hasDuplicate 相当）。
 */
export function isDuplicateCalendarEntry(
  entry: { date: string; title: string; body: string },
  want: { date: string; title: string; body: string },
): boolean {
  return (
    entry.date === want.date &&
    normalizeMonologueTitle(entry.title) === normalizeMonologueTitle(want.title) &&
    normalizeMonologueBody(entry.body) === normalizeMonologueBody(want.body)
  );
}

/**
 * デイリーノート全文に同一エントリが既に存在するか。
 *
 * matchTime=true のとき title/body/date/time の完全一致（リトライ再送の冪等判定用）。
 * matchTime=false のとき時刻を無視し、日付＋正規化タイトル＋正規化本文で判定する
 * （jot 再送リトライで LLM 出力は同じまま時刻だけ変わっても二重追記しないため）。
 * タイトルは normalizeMonologueTitle、本文は行単位 trim＋空行除去で比較する。
 */
export function hasDuplicateMonologueEntry(
  markdown: string,
  date: string,
  entry: MonologueRetryEntry,
  matchTime = true,
): boolean {
  const wantTitle = normalizeMonologueTitle(entry.title);
  const wantBody = normalizeMonologueBody(entry.body);
  return parseMonologueSection(markdown, date).some(
    (existing) =>
      (!matchTime || existing.time === entry.time) &&
      normalizeMonologueTitle(existing.title) === wantTitle &&
      normalizeMonologueBody(existing.body) === wantBody,
  );
}

export type MonologueRetryTarget = MonologueRetryEntry & {
  retryOnly: "note" | "gc";
  /** 対象日（JST）。形式: YYYY-MM-DD。 */
  date: string;
};

/**
 * リトライ受付の日付窓（当日含む過去 N 日分）。YYYY-MM-DD は辞書式比較が時系列順と一致する。
 * 日跨ぎ回復を可能にしつつ偽造窓を狭めるための上限。
 */
export const RETRY_DATE_WINDOW_DAYS = 7;

/** YYYY-MM-DD に dayOffset 日加算する（JST 暦日ベース。月末・年末跨ぎ対応）。 */
function addDaysToDateString(date: string, dayOffset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * リトライ対象日が受付窓（todayJst の当日含む過去 RETRY_DATE_WINDOW_DAYS 日以内）に入るか。
 * 未来日は受け付けない。
 */
export function isRetryDateInWindow(date: string, todayJst: string): boolean {
  return date >= addDaysToDateString(todayJst, -RETRY_DATE_WINDOW_DAYS) && date <= todayJst;
}

/**
 * 失敗側専用リトライのリクエスト検証。正常時は検証・正規化済みの対象を返す。
 * 不正時は 400 で返すエラーメッセージを返す（throw しない）。
 *
 * 脅威モデル注記: /api/* は Cloudflare Access で Gmail 単独許可済み（ADR 0001）のため、
 * 到達可能な主体は本人のみ。retry パラメータの偽造は自己攻撃に限定される。
 * よって HMAC 等の重機構は導入せず、サイズ上限・日付窓・sanitize で足りる。
 *
 * 制約:
 * - date は暦上実在すること（GC 側 isValidCalendarDate と同一判定。02-30 等を拒否）。
 * - date はサーバ JST 当日から過去7日以内（当日含む）のみ受け付ける。
 *   当日一致のみだと、日跨ぎ直前の失敗（23:59 の note 失敗等）を翌日に回復できない。
 *   一方で無期限の過去日追記を許すと date 偽造の窓が広がるため、7日窓に狭める。
 */
export function parseMonologueRetry(
  payload: MonologueSubmitRequestBody,
  now: Date = new Date(),
): { ok: true; retry: MonologueRetryTarget } | { ok: false; error: string } {
  const { retryOnly } = payload;
  if (retryOnly !== "note" && retryOnly !== "gc") {
    return { ok: false, error: "retryOnly は 'note' または 'gc' を指定してください" };
  }
  const date = typeof payload.date === "string" ? payload.date : "";
  const time = typeof payload.time === "string" ? payload.time : "";
  if (!RETRY_DATE_PATTERN.test(date) || !isValidCalendarDate(date)) {
    return { ok: false, error: "date が不正です（YYYY-MM-DD 形式で指定してください）" };
  }
  if (!isRetryDateInWindow(date, getJstDateTime(now).date)) {
    return { ok: false, error: "date は過去7日以内〜当日（JST）のみ指定できます" };
  }
  if (!RETRY_TIME_PATTERN.test(time)) {
    return { ok: false, error: "time が不正です（HH:MM 形式で指定してください）" };
  }
  try {
    const sanitized = sanitizeThinoEntry({
      time,
      title: typeof payload.title === "string" ? payload.title : "",
      body: typeof payload.body === "string" ? payload.body : "",
    });
    if ([...sanitized.body].length > MAX_MONOLOGUE_RETRY_BODY_LENGTH) {
      return {
        ok: false,
        error: `body が${MAX_MONOLOGUE_RETRY_BODY_LENGTH}文字を超えています（${[...sanitized.body].length}文字）`,
      };
    }
    return { ok: true, retry: { retryOnly, date, ...sanitized } };
  } catch (error) {
    return {
      ok: false,
      error: `title/body が不正です: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * POST /api/monologue/submit — jot を Monologue 専用プロンプトで整形し、
 * note デイリーノートと GC 専用カレンダーの両方へ出力する。
 *
 * SSE: formatting（整形中）→ writing-note（note書込中）→ creating-event（GC作成中）→ done/error。
 * 検証エラー（4xx/5xx）は SSE に乗せず通常の JSON で返す（既存 submit.ts と同じ方針）。
 * owner 検証は不要（note 固定・GC 固定のため受け付けない）。
 *
 * 失敗側専用リトライ: { retryOnly: 'note' | 'gc', title, body, date, time }
 * を送ると成功側を再実行せず失敗側だけ実行する（成功側の重複を防ぐ）。
 * リトライ時は writing-note / creating-event のうち対象側だけ送る。
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: MonologueSubmitRequestBody;
  try {
    payload = (await request.json()) as MonologueSubmitRequestBody;
  } catch {
    return json({ error: "リクエストボディが不正な JSON です" }, 400);
  }

  const encoder = new TextEncoder();
  const startRetryStream = (
    sendEvents: (send: (event: string, data: unknown) => void) => Promise<void>,
  ): Response => {
    const retryStream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        };
        try {
          await sendEvents(send);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          send("error", { error: message });
        } finally {
          controller.close();
        }
      },
    });
    return sseResponse(retryStream);
  };

  // 失敗側専用リトライ。成功側を再実行しないため成功側の重複が起きない。
  // done ペイロードの title/body/date/time をそのまま再送する。
  if (payload.retryOnly !== undefined) {
    const parsed = parseMonologueRetry(payload);
    if (!parsed.ok) {
      return json({ error: parsed.error }, 400);
    }
    const retry = parsed.retry;
    // 一覧キャッシュ purge 用の origin（同一 month の GET キャッシュを破棄する）。
    const retryOrigin = new URL(request.url).origin;
    if (retry.retryOnly === "note") {
      if (!env.GITHUB_PAT) {
        return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
      }
      const githubPat = env.GITHUB_PAT;
      return startRetryStream(async (send) => {
        send("writing-note", { date: retry.date, time: retry.time });
        let noteOk = false;
        let noteError: string | undefined;
        try {
          const client = new GitHubClient({ token: githubPat });
          const existing = await getNoteFile(client, dailyNotePath(retry.date));
          if (
            existing &&
            hasDuplicateMonologueEntry(
              existing.content,
              retry.date,
              { time: retry.time, title: retry.title, body: retry.body },
              true,
            )
          ) {
            // 同一 title/body/date/time が既に追記済み＝前回リトライが成功していた。
            // 再追記せず成功扱いにする（冪等）。
            noteOk = true;
          } else {
            // 重複チェックで取得済みの existing を渡し、append 側の再 GET を省く（二重取得の解消）。
            await appendMonologueToNote(
              client,
              {
                date: retry.date,
                time: retry.time,
                title: retry.title,
                body: retry.body,
              },
              existing,
            );
            noteOk = true;
          }
        } catch (error) {
          noteError = error instanceof Error ? error.message : String(error);
        }
        // note 成功時は同一 month の一覧キャッシュを破棄する（次回 GET で最新を返す）。
        if (noteOk) await purgeMonologueMonthCache(retry.date.slice(0, 7), retryOrigin);
        send("done", {
          title: retry.title,
          body: retry.body,
          date: retry.date,
          time: retry.time,
          modelUsed: "retry",
          fallbacks: [],
          noteOk,
          // note 専用リトライでは GC 側は実行しない。成功扱い（gcOk:true）にせず
          // 未実行として明示する（成功偽装の回避）。
          gcOk: false,
          gcSkipped: true,
          gcError: "未実行（失敗側のみ再送のため）",
          ...(noteError ? { noteError } : {}),
        } satisfies MonologueSubmitResult);
      });
    }
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return json(
        { error: "サーバー設定エラー: GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません" },
        500,
      );
    }
    if (!env.MONOLOGUE_CALENDAR_ID) {
      return json({ error: "サーバー設定エラー: MONOLOGUE_CALENDAR_ID が設定されていません" }, 500);
    }
    // narrowing は非同期クロージャに伝搬しないため local に確定させる
    const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const calendarId = env.MONOLOGUE_CALENDAR_ID;
    return startRetryStream(async (send) => {
      send("creating-event", { date: retry.date, time: retry.time });
      let gcOk = false;
      let gcError: string | undefined;
      // NOTE: insert 結果の eventId は done に含めない（YAGNI）。
      // GC 追跡が将来必要になれば再導入する。
      try {
        const accessToken = await getAccessToken({ serviceAccountJson });
        const existing = await listMonologueEvents(accessToken, calendarId, retry.date.slice(0, 7));
        const duplicate = existing.some((entry) =>
          isDuplicateCalendarEntry(entry, {
            date: retry.date,
            title: retry.title,
            body: retry.body,
          }),
        );
        if (duplicate) {
          // 同日＋正規化タイトル＋正規化本文一致の予定が既にある＝前回リトライが成功していた。
          // 再作成せず成功扱いにする（冪等）。
          gcOk = true;
        } else {
          await insertMonologueEvent(accessToken, calendarId, {
            date: retry.date,
            title: retry.title,
            body: retry.body,
          });
          gcOk = true;
        }
      } catch (error) {
        gcError = error instanceof Error ? error.message : String(error);
      }
      // GC 成功時は同一 month の一覧キャッシュを破棄する（次回 GET で最新を返す）。
      if (gcOk) await purgeMonologueMonthCache(retry.date.slice(0, 7), retryOrigin);
      send("done", {
        title: retry.title,
        body: retry.body,
        date: retry.date,
        time: retry.time,
        modelUsed: "retry",
        fallbacks: [],
        // GC 専用リトライでは note 側は実行しない。成功扱いにせず未実行として明示する。
        noteOk: false,
        noteSkipped: true,
        noteError: "未実行（失敗側のみ再送のため）",
        gcOk,
        ...(gcError ? { gcError } : {}),
      } satisfies MonologueSubmitResult);
    });
  }

  const jot = typeof payload.jot === "string" ? payload.jot.trim() : "";
  if (jot.length === 0) {
    return json({ error: "jot が空です" }, 400);
  }
  if ([...jot].length > MAX_MONOLOGUE_JOT_LENGTH) {
    return json({ error: `jot が${MAX_MONOLOGUE_JOT_LENGTH}文字を超えています` }, 400);
  }

  if (payload.preferredModel !== undefined) {
    if (
      typeof payload.preferredModel !== "string" ||
      !(GEMINI_MODELS as readonly string[]).includes(payload.preferredModel)
    ) {
      return json({ error: "preferredModel が不正です" }, 400);
    }
  }

  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: "サーバー設定エラー: GEMINI_API_KEY が設定されていません" }, 500);
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return json(
      { error: "サーバー設定エラー: GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません" },
      500,
    );
  }
  if (!env.MONOLOGUE_CALENDAR_ID) {
    return json({ error: "サーバー設定エラー: MONOLOGUE_CALENDAR_ID が設定されていません" }, 500);
  }

  const preferredModel =
    typeof payload.preferredModel === "string" ? payload.preferredModel : undefined;

  // narrowing は非同期クロージャに伝搬しないため local に確定させる
  const githubPat = env.GITHUB_PAT;
  const geminiApiKey = env.GEMINI_API_KEY;
  const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const calendarId = env.MONOLOGUE_CALENDAR_ID;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        send("formatting", {});
        let formatted;
        try {
          formatted = await formatMonologue(jot, {
            apiKey: geminiApiKey,
            preferredModel,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`LLM 整形に失敗しました: ${message}`);
        }

        const { date, time } = getJstDateTime();

        // thino 注入前の fail-fast 検証。LLM 逸脱・不正な整形結果は note/GC へ
        // 書き込む前に SSE error とする（format 側検証の二重化）。
        let title = formatted.title;
        let body = formatted.body;
        try {
          const sanitized = sanitizeThinoEntry({ time, title, body });
          // 通常経路にもリトライ経路と同一の 4000 字上限を課す（由来: MAX_MONOLOGUE_RETRY_BODY_LENGTH）。
          // LLM 出力は jot 上限（4000字）以下でも整形で膨らみ得るため、sanitize 後の実書き込み文で検証する。
          if ([...sanitized.body].length > MAX_MONOLOGUE_RETRY_BODY_LENGTH) {
            throw new Error(
              `body が${MAX_MONOLOGUE_RETRY_BODY_LENGTH}文字を超えています（${[...sanitized.body].length}文字）`,
            );
          }
          title = sanitized.title;
          body = sanitized.body;
        } catch (error) {
          throw new Error(
            `LLM 整形結果が不正です: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        send("writing-note", { date, time });
        let noteOk = false;
        let noteError: string | undefined;
        try {
          const client = new GitHubClient({ token: githubPat });
          // jot 再送リトライの二重追記抑止。時刻だけ変わって同じ内容が再送されても
          // 追記済みなら PUT せず成功扱いにする（同日＋正規化タイトル＋正規化本文で判定）。
          const existing = await getNoteFile(client, dailyNotePath(date));
          if (
            existing &&
            hasDuplicateMonologueEntry(existing.content, date, { time, title, body }, false)
          ) {
            noteOk = true;
          } else {
            // 重複チェックで取得済みの existing を渡し、append 側の再 GET を省く（二重取得の解消）。
            // existing=null（不存在確認済み）の場合もテンプレート取得のみで GET は増えない。
            await appendMonologueToNote(
              client,
              {
                date,
                time,
                title,
                body,
              },
              existing,
            );
            noteOk = true;
          }
        } catch (error) {
          noteError = error instanceof Error ? error.message : String(error);
        }

        send("creating-event", { date, time });
        let gcOk = false;
        let gcError: string | undefined;
        // NOTE: insert 結果の eventId は done に含めない（YAGNI）。
        // GC 追跡が将来必要になれば再導入する。
        try {
          const accessToken = await getAccessToken({
            serviceAccountJson,
          });
          // 通常経路の jot 再送で GC へ二重作成しないよう、retry-gc と同等の
          // 冪等チェック（同日＋正規化タイトル＋正規化本文）を入れる。
          const existing = await listMonologueEvents(accessToken, calendarId, date.slice(0, 7));
          const duplicate = existing.some((entry) =>
            isDuplicateCalendarEntry(entry, { date, title, body }),
          );
          if (duplicate) {
            gcOk = true;
          } else {
            await insertMonologueEvent(accessToken, calendarId, {
              date,
              title,
              body,
            });
            gcOk = true;
          }
        } catch (error) {
          gcError = error instanceof Error ? error.message : String(error);
        }

        // いずれか成功時は同一 month の一覧キャッシュを破棄する（次回 GET で最新を返す）。
        if (noteOk || gcOk) {
          await purgeMonologueMonthCache(date.slice(0, 7), new URL(request.url).origin);
        }

        send("done", {
          title,
          body,
          date,
          time,
          modelUsed: formatted.modelUsed,
          fallbacks: formatted.fallbacks,
          noteOk,
          gcOk,
          ...(noteError ? { noteError } : {}),
          ...(gcError ? { gcError } : {}),
        } satisfies MonologueSubmitResult);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return sseResponse(stream);
};
