/**
 * Google Calendar クライアント（ADR 0013）。
 *
 * Monologue 専用カレンダー（env MONOLOGUE_CALENDAR_ID）の終日予定を
 * events.list / events.insert の fetch 直呼びで扱う。新規依存は追加しない。
 * 終日予定（date 指定）の timeZone は API で無視されるため送らない。
 * 対象カレンダー自体のタイムゾーンを Asia/Tokyo（JST）にすること。
 * 専用カレンダー内の終日予定はすべて Monologue 扱いとする。
 */

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export type CalendarOptions = {
  /** fetch 実装。テストで注入可能。 */
  fetch?: typeof fetch;
};

/** 終日予定 1 件分（list のマップ結果・insert の入力）。 */
export type MonologueCalendarEntry = {
  /** 対象日（JST）。形式: YYYY-MM-DD。 */
  date: string;
  /** 予定タイトル（Monologue タイトル）。 */
  title: string;
  /** 予定説明（Monologue 本文・箇条書き）。 */
  body: string;
};

export type CreatedCalendarEvent = {
  id: string;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** YYYY-MM-DD が暦上実在するか（02-30 等のロールオーバーを排除）。正規表現通過後に使う。 */
export function isValidCalendarDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/** YYYY-MM-DD に 1 日足す（終日予定の end.date 用。月末・年末跨ぎ対応）。 */
export function addOneDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** 対象月の翌月 YYYY-MM を返す（events.list の timeMax 用）。 */
function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, mon, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function authHeaders(accessToken: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${accessToken}`);
  return headers;
}

/**
 * 対象月の終日予定を新しい順（date 降順）で一覧する。
 * 専用カレンダーのため中の終日予定はすべて Monologue 扱い。終日以外は無視する。
 */
export async function listMonologueEvents(
  accessToken: string,
  calendarId: string,
  month: string,
  options: CalendarOptions = {},
): Promise<MonologueCalendarEntry[]> {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error(`month が不正です: ${month}（YYYY-MM 形式で指定してください）`);
  }
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const baseParams = {
    timeMin: `${month}-01T00:00:00+09:00`,
    timeMax: `${nextMonth(month)}-01T00:00:00+09:00`,
    singleEvents: "true",
    maxResults: "2500",
    orderBy: "startTime",
  };
  // 上限到達時は nextPageToken を辿って全件取得する。
  const items: Array<{ start?: { date?: unknown }; summary?: unknown; description?: unknown }> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams(baseParams);
    if (pageToken !== undefined) {
      params.set("pageToken", pageToken);
    }
    const response = await doFetch(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { method: "GET", headers: authHeaders(accessToken) },
    );
    if (!response.ok) {
      throw new Error(
        `Google Calendar の取得に失敗しました: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      items?: Array<{ start?: { date?: unknown }; summary?: unknown; description?: unknown }>;
      nextPageToken?: unknown;
    };
    items.push(...(data.items ?? []));
    pageToken =
      typeof data.nextPageToken === "string" && data.nextPageToken.length > 0
        ? data.nextPageToken
        : undefined;
  } while (pageToken !== undefined);
  const entries: MonologueCalendarEntry[] = [];
  for (const item of items) {
    if (typeof item.start?.date !== "string" || !isValidCalendarDate(item.start.date)) continue;
    entries.push({
      date: item.start.date,
      title: typeof item.summary === "string" ? item.summary : "",
      body: typeof item.description === "string" ? item.description : "",
    });
  }
  return entries.sort((a, b) =>
    a.date === b.date
      ? a.title < b.title
        ? -1
        : a.title > b.title
          ? 1
          : 0
      : a.date < b.date
        ? 1
        : -1,
  );
}

/**
 * 終日予定を 1 件作成する（start.date＝対象日、end.date＝翌日）。
 * 作成時刻の `- HH:MM` は description 先頭に含めない（thino 側の責務）。
 */
export async function insertMonologueEvent(
  accessToken: string,
  calendarId: string,
  entry: MonologueCalendarEntry,
  options: CalendarOptions = {},
): Promise<CreatedCalendarEvent> {
  if (!isValidCalendarDate(entry.date)) {
    throw new Error(`date が不正です: ${entry.date}（YYYY-MM-DD 形式で指定してください）`);
  }
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const response = await doFetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: (() => {
        const headers = authHeaders(accessToken);
        headers.set("Content-Type", "application/json");
        return headers;
      })(),
      body: JSON.stringify({
        summary: entry.title,
        description: entry.body,
        start: { date: entry.date },
        end: { date: addOneDay(entry.date) },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Google Calendar の作成に失敗しました: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "string" || data.id.length === 0) {
    throw new Error("Google Calendar の作成に失敗しました: 応答の形式が不正です");
  }
  return { id: data.id };
}
