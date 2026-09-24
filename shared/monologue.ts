/** Monologue（一覧カード）の出典。note main・Google Calendar の存在を示す。 */
export type MonologueSources = {
  note: boolean;
  google: boolean;
};

/**
 * Monologue（一覧カードの表示単位）。
 * 日付＋タイトル＋本文＋note/GCバッジを全出しする（詳細モーダルなし）。
 */
export type Monologue = {
  title: string;
  body: string;
  /** 対象日（JST）。形式: YYYY-MM-DD。 */
  date: string;
  /**
   * 作成時刻（JST）。形式: HH:MM。
   * GC の終日予定に時刻は無いため、GC のみの一覧は null（時刻なし）とする。
   * 捏造の 00:00 は使わない。表示側は null を "--:--" 等で描画する。
   */
  time: string | null;
  /**
   * GC 説明文の原文。sources.google が true の場合に保持する。
   * 突合時は note 本文を body に優先し、GC 本文は破棄せずここに残す。
   */
  gcBody?: string;
  sources: MonologueSources;
};

/**
 * タイトルを正規化する（突合キー用）。
 * 前後 trim＋連続空白（全角含む）の単一スペース折畳みのみ。絵文字・記号は保持する。
 */
export function normalizeMonologueTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

/**
 * Monologue 本文を正規化する（GC 冪等判定・note 重複判定・一覧マージ用）。
 * 行単位 trim＋空行除去のみ。箇条書きの体裁揺れを吸収する。
 */
export function normalizeMonologueBody(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * 日付＋正規化タイトル＋正規化本文の突合キー（一覧マージ用）。
 * submit 側の冪等判定（isDuplicateCalendarEntry / hasDuplicateMonologueEntry）と同一基準にし、
 * 同日同名でも本文が違えば別物として両方残す（body 違いの誤突合を防ぐ）。
 */
export function monologueMergeKey(date: string, title: string, body: string): string {
  return `${date}\n${normalizeMonologueTitle(title)}\n${normalizeMonologueBody(body)}`;
}

/**
 * 新しい順（date 降順→time 降順）にソートしたコピーを返す。
 * time が null（GC のみ・時刻なし）の整列キーは "" 扱いとし、同日最下位にする。
 * 表示（null → "--:--" 等）と整列（別建てのランク）は分離する。
 */
export function sortMonologuesDesc<T extends Pick<Monologue, "date" | "time">>(list: T[]): T[] {
  const rank = (time: string | null): string => time ?? "";
  return [...list].sort((a, b) =>
    a.date === b.date
      ? rank(a.time) < rank(b.time)
        ? 1
        : rank(a.time) > rank(b.time)
          ? -1
          : 0
      : a.date < b.date
        ? 1
        : -1,
  );
}
