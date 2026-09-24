/**
 * thino 互換のパーサ・シリアライザ（ADR 0014）。
 *
 * note デイリーノートの `# 💬 Monologue` セクション配下を `###` 単位で扱う。
 * 実測形式: `- HH:MM` ＋ 4スペース indent `### タイトル` ＋ 4スペース indent `- 箇条書き`。
 * 追加マーカーは付けず、thino 互換性を崩さない。
 */
import type { Monologue } from "../../../shared/monologue";
import { sortMonologuesDesc } from "../../../shared/monologue";

/** `# 💬 Monologue` セクションの見出し（完全一致で検出する）。 */
export const MONOLOGUE_SECTION_HEADING = "# 💬 Monologue";

/** 追記する 1 件分（M2 が JST 当日時刻を付与する）。 */
export type ThinoEntry = {
  /** 作成時刻（JST）。形式: HH:MM。 */
  time: string;
  title: string;
  /** 箇条書きのみ（`- ` で始まる行）。 */
  body: string;
};

const TIME_LINE = /^- (\d{2}:\d{2})\s*$/;
const TITLE_LINE = /^(?: {4}|\t)###\s+(.*\S)\s*$/;
const BULLET_LINE = /^(?: {4}|\t)-\s?(.*)$/;
const LEVEL1_HEADING = /^#(\s|$)/;

/** セクション配下の 1 エントリ分を Monologue へ変換する。タイトルなしは不正として捨てる。 */
function toMonologue(
  date: string,
  time: string,
  title: string,
  bullets: string[],
): Monologue | null {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return null;
  return {
    title: normalizedTitle,
    body: bullets.map((bullet) => `- ${bullet}`.trimEnd()).join("\n"),
    date,
    time,
    hasBodyDifference: false,
    sources: { note: true, google: false },
  };
}

/**
 * デイリーノート全文から Monologue セクション配下を `###` 単位で読み取る。
 * セクション不存在時は空配列。新しい順（time 降順）で返す。
 */
export function parseMonologueSection(markdown: string, date: string): Monologue[] {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === MONOLOGUE_SECTION_HEADING);
  if (headingIndex === -1) return [];

  const result: Monologue[] = [];
  let time: string | null = null;
  let title: string | null = null;
  let bullets: string[] = [];
  const flush = () => {
    if (time !== null && title !== null) {
      const entry = toMonologue(date, time, title, bullets);
      if (entry) result.push(entry);
    }
    time = null;
    title = null;
    bullets = [];
  };

  for (const line of lines.slice(headingIndex + 1)) {
    // インデントなしの `# ` 級見出しでセクション終了（`###` は 4スペース付きなので混同しない）。
    if (LEVEL1_HEADING.test(line)) break;
    const timeMatch = TIME_LINE.exec(line);
    if (timeMatch) {
      flush();
      time = timeMatch[1];
      continue;
    }
    if (time === null) continue;
    const titleMatch = TITLE_LINE.exec(line);
    if (titleMatch) {
      title = titleMatch[1];
      continue;
    }
    const bulletMatch = BULLET_LINE.exec(line);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
    }
  }
  flush();

  return sortMonologuesDesc(result);
}

/** thino 注入前の検証上限（Monologue プロンプトと同一）。 */
const MAX_THINO_TITLE_LENGTH = 120;

/**
 * thino 注入前の検証・正規化。title の改行は除去し、120字上限違反・空は throw
 * （submit 経路では SSE error になる）。body は `- ` 始まり行のみ許可し、
 * `#` / `###` 見出し行を含む箇条書き以外の行は除去せず拒否（throw）する。
 */
export function sanitizeThinoEntry(entry: ThinoEntry): ThinoEntry {
  const title = entry.title.replace(/[\r\n]+/g, " ").trim();
  if (!title) {
    throw new Error("thino エントリの title が空です");
  }
  if ([...title].length > MAX_THINO_TITLE_LENGTH) {
    throw new Error(`thino エントリの title が120文字を超えています（${[...title].length}文字）`);
  }
  const bodyLines = entry.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (bodyLines.length === 0) {
    throw new Error("thino エントリの body が空です");
  }
  for (const line of bodyLines) {
    if (!line.startsWith("- ")) {
      throw new Error(`thino エントリの body に箇条書き以外の行があります: ${line.slice(0, 60)}`);
    }
  }
  return { time: entry.time.trim(), title, body: bodyLines.join("\n") };
}

/** 1 件分を thino 形式のブロックに整形する。不正な title/body は throw する。 */
export function formatThinoEntry(entry: ThinoEntry): string {
  const sanitized = sanitizeThinoEntry(entry);
  const bodyLines = sanitized.body.split("\n").map((line) => `    ${line}`);
  return [`- ${sanitized.time}`, `    ### ${sanitized.title}`, ...bodyLines].join("\n");
}

/**
 * 全文の Monologue セクション末尾へ 1 件追記する。
 * セクション不存在時は末尾に作成する。空文書でも `# 💬 Monologue` から始める。
 */
export function appendMonologueEntry(markdown: string, entry: ThinoEntry): string {
  const block = formatThinoEntry(entry);
  if (markdown.trim().length === 0) {
    return `${MONOLOGUE_SECTION_HEADING}\n${block}\n`;
  }
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === MONOLOGUE_SECTION_HEADING);
  if (headingIndex === -1) {
    return `${markdown.replace(/\s+$/, "")}\n\n${MONOLOGUE_SECTION_HEADING}\n${block}\n`;
  }
  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (LEVEL1_HEADING.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  const before = `${lines.slice(0, sectionEnd).join("\n").replace(/\s+$/, "")}\n`;
  const after = lines.slice(sectionEnd).join("\n").replace(/^\n+/, "");
  return `${before}${block}\n${after ? `\n${after}` : ""}`;
}
