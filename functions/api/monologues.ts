import type { Monologue } from "../../shared/monologue";
import { monologueMergeKey, sortMonologuesDesc } from "../../shared/monologue";
import { GitHubClient } from "../_github/client";
import { dailyNotePath, getNoteFile } from "../_github/monologue-note";
import { getAccessToken } from "../_google/auth";
import { listMonologueEvents, type MonologueCalendarEntry } from "../_google/calendar";
import { parseMonologueSection } from "../_lib/monologue/thino";
import { resolveStatsCache } from "../_lib/repo-stats-cache";
import type { Env } from "../_types";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Monologue 一覧のサーバーキャッシュ TTL（repo-stats に合わせる）。 */
const MONOLOGUES_CACHE_MAX_AGE_SECONDS = 300;

/** 日次ノート取得の並列上限。月内全日（最大31件）の一括並列を避けチャンク逐次で取得する。 */
export const MONOLOGUE_DAILY_FETCH_CONCURRENCY = 5;

/**
 * GC にしか存在しない Monologue の時刻は null（時刻なし）とする。
 * 終日予定に時刻は無いため 00:00 等で捏造しない。表示側で "--:--" 描画する。
 */
const GOOGLE_ONLY_TIME: null = null;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** キャッシュキー: パス＋month の canonical URL（月ごとに分ける）。 */
function cacheKey(url: URL): string {
  const key = new URL(url.origin);
  key.pathname = url.pathname;
  key.searchParams.set("month", url.searchParams.get("month") ?? "");
  return key.toString();
}

/** submit 成功パスから呼ぶ同一月キャッシュキー（cacheKey と同一形式）。 */
export function monologueMonthCacheKey(origin: string, month: string): string {
  const key = new URL(origin);
  key.pathname = "/api/monologues";
  key.searchParams.set("month", month);
  return key.toString();
}

/**
 * submit 成功時に同一 month のサーバキャッシュを破棄する（次回 GET で最新を返す）。
 * キャッシュなし環境・破棄失敗時は無視する（表示フォールバック優先のため throw しない）。
 * submit 側（monologue/submit.ts）から直接 import する。monologues 側は submit を
 * import しないため循環 import は起きない。
 */
export async function purgeMonologueMonthCache(month: string, origin: string): Promise<void> {
  const cache = resolveStatsCache();
  if (!cache?.delete) return;
  try {
    await cache.delete(monologueMonthCacheKey(origin, month));
  } catch {
    // キャッシュ破棄失敗は表示を優先して無視する。
  }
}

/** 対象月の全日付（YYYY-MM-DD）を昇順で返す。 */
export function datesInMonth(month: string): string[] {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: lastDay }, (_, i) => `${year}-${pad(mon)}-${pad(i + 1)}`);
}

/**
 * note 由来と GC 由来を日付＋正規化タイトル＋正規化本文で突合してマージする。
 * submit 側の冪等判定（isDuplicateCalendarEntry / hasDuplicateMonologueEntry）と同一基準にし、
 * 同日同名でも本文が違えば別物として両方残す（body 違いの誤突合を防ぐ）。
 * 一致すれば両方の sources を立て、片方のみも許容する（note の本文・時刻を優先し、
 * GC 本文は gcBody に保持して破棄しない）。
 * 同キー重複は潰さない。突合は消費済みを除外する 1:1 消費方式とし、
 * note 側 N 件・GC 側 M 件の同キーは min(N, M) 件だけ突合し、残りは両方残す。
 * 新しい順（date 降順→time 降順。時刻なしは同日最下位）で返す。
 */
export function mergeMonologues(
  noteEntries: Monologue[],
  googleEntries: MonologueCalendarEntry[],
): Monologue[] {
  const merged: Monologue[] = noteEntries.map((entry) => ({
    ...entry,
    sources: { note: true, google: false },
  }));
  const consumed = new Set<number>();
  for (const gc of googleEntries) {
    const key = monologueMergeKey(gc.date, gc.title, gc.body);
    // 未消費の一致にだけ GC フラグを立て、消費済みは再利用しない（同キー複数は両方残す）。
    const index = merged.findIndex(
      (entry, i) =>
        !consumed.has(i) &&
        entry.sources.note &&
        monologueMergeKey(entry.date, entry.title, entry.body) === key,
    );
    if (index >= 0) {
      consumed.add(index);
      merged[index].sources.google = true;
      merged[index].gcBody = gc.body;
    } else {
      merged.push({
        title: gc.title.trim(),
        body: gc.body,
        gcBody: gc.body,
        date: gc.date,
        time: GOOGLE_ONLY_TIME,
        sources: { note: false, google: true },
      });
    }
  }
  return sortMonologuesDesc(merged);
}

/**
 * GET /api/monologues?month=YYYY-MM — 対象月の Monologue 一覧を新しい順で返す。
 *
 * - note の該当月デイリーノート（📝daily-note/YYYY-MM-DD.md）の Monologue セクションと
 *   GC 専用カレンダーの対象月終日予定をマージし、日付＋タイトル＋本文の正規化一致で突合する。
 * - month 不正は 400。secret 欠落は 500。
 * - 日次ノート取得は単日失敗をスキップし、warnings/failedDates として返す
 *   （5 並列チャンク維持）。endpoint 全体の 502 は全日失敗時と GC 取得失敗時のみ。
 * - 結果は Cloudflare Cache API で月キーごとに数分間キャッシュする。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  if (!MONTH_PATTERN.test(month)) {
    return json({ error: "month が不正です（YYYY-MM 形式で指定してください）" }, 400);
  }

  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
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

  // narrowing は非同期処理に伝搬しないため local に確定させる（monologue/submit と同じ方針）。
  const githubPat = env.GITHUB_PAT;
  const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const calendarId = env.MONOLOGUE_CALENDAR_ID;

  const cache = resolveStatsCache();
  const key = cacheKey(url);

  if (cache) {
    try {
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch {
      // キャッシュ障害時は直接取得へフォールバック（表示を優先する）。
    }
  }

  try {
    const client = new GitHubClient({ token: githubPat });
    // 日次ノート取得はチャンク逐次（5件ずつ）で行い、同時リクエスト数を抑える。
    // 単日失敗はスキップし warnings/failedDates として返す（allSettled）。
    // 全日失敗時のみ endpoint 全体を 502 とする。
    const dates = datesInMonth(month);
    const noteEntries: Monologue[] = [];
    const failedDates: string[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < dates.length; i += MONOLOGUE_DAILY_FETCH_CONCURRENCY) {
      const chunkDates = dates.slice(i, i + MONOLOGUE_DAILY_FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunkDates.map(async (date) => {
          const file = await getNoteFile(client, dailyNotePath(date));
          if (!file) return [];
          return parseMonologueSection(file.content, date);
        }),
      );
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          noteEntries.push(...result.value);
        } else {
          const date = chunkDates[index];
          failedDates.push(date);
          const message =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          warnings.push(`${date} の取得に失敗しました: ${message}`);
        }
      });
    }
    if (failedDates.length === dates.length) {
      throw new Error(`全ての日次ノート取得に失敗しました: ${warnings.join("; ")}`);
    }

    const accessToken = await getAccessToken({ serviceAccountJson });
    const googleEntries = await listMonologueEvents(accessToken, calendarId, month);

    const monologues = mergeMonologues(noteEntries, googleEntries);
    const response = json(
      {
        month,
        monologues,
        fetchedAt: new Date().toISOString(),
        ...(failedDates.length > 0 ? { warnings, failedDates } : {}),
      },
      200,
      { "Cache-Control": `public, max-age=${MONOLOGUES_CACHE_MAX_AGE_SECONDS}` },
    );

    if (cache) {
      try {
        await cache.put(key, response.clone());
      } catch {
        // キャッシュ書き込み失敗は表示を優先して無視する。
      }
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `Monologue一覧の取得に失敗しました: ${message}` }, 502);
  }
};
