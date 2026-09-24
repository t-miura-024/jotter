/**
 * note デイリーノートへの Monologue 追記クライアント（ADR 0014）。
 *
 * `📝daily-note/YYYY-MM-DD.md` の `# 💬 Monologue` セクション末尾へ追記し、
 * Contents API の sha 付き PUT＋競合時再読込 1 回リトライで反映する（main 直書き・PR なし）。
 * ファイル不存在時はテンプレートを実行時取得して複製し今回分を追記する。
 * 通信は GitHubClient（Classic PAT・共通ヘッダ）に委ねる。
 */
import type { Monologue } from "../../shared/monologue";
import type { GitHubClient } from "./client";
import { GitHubError, toGitHubError } from "./client";
import type { ThinoEntry } from "../_lib/monologue/thino";
import { appendMonologueEntry } from "../_lib/monologue/thino";

/** note inbox の参照（固定）。 */
export const NOTE_OWNER = "t-miura-024";
export const NOTE_REPO = "note";
/** 直書き対象ブランチ（固定）。 */
export const NOTE_BRANCH = "main";
/** デイリーノートのテンプレート（実行時取得。失敗時のみ固定文面へフォールバック）。 */
export const NOTE_TEMPLATE_PATH = "🔖template/📝daily-note/📝daily-note-template.md";
/** テンプレート取得失敗時に使う固定文面。 */
export const FALLBACK_TEMPLATE = "# 💬 Monologue\n";
/** 競合とみなすステータス（sha 不一致）。再読込＋再追記を 1 回だけ行う。 */
const CONFLICT_STATUSES = new Set([409, 422]);

export type { ThinoEntry };

/** 対象日のデイリーノートパス。形式: 📝daily-note/YYYY-MM-DD.md。 */
export function dailyNotePath(date: string): string {
  return `📝daily-note/${date}.md`;
}

/** 追記する 1 件分（date はパス解決用、time/title/body は thino ブロック用）。 */
export type MonologueNoteEntry = ThinoEntry & Pick<Monologue, "date">;

type NoteFile = {
  sha: string;
  content: string;
};

/**
 * 取得済みノート（getNoteFile の結果）。submit 側の重複チェック GET と
 * append 側の内部 GET の二重取得を避けるため、取得済みがあれば渡す。
 * undefined＝未取得（内部で GET する）、null＝不存在確認済み（GET しない）。
 */
export type KnownNoteFile = NoteFile | null | undefined;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** UTF-8 文字列 → base64（workerd・node 両対応。チャンク化で大容量の引数展開を避ける）。 */
export function utf8ToBase64(text: string): string {
  const bytes = textEncoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 → UTF-8 文字列。 */
export function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return textDecoder.decode(bytes);
}

/** Contents API 用にパスをセグメント単位で percent-encode する（絵文字パス対応）。 */
function encodeContentPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function contentsUrl(path: string): string {
  return `/repos/${NOTE_OWNER}/${NOTE_REPO}/contents/${encodeContentPath(path)}?ref=${NOTE_BRANCH}`;
}

/**
 * note main からファイルを取得する。不存在（404）のとき null。
 * それ以外の失敗は GitHubError を投げる。
 */
export async function getNoteFile(client: GitHubClient, path: string): Promise<NoteFile | null> {
  const response = await client.request(contentsUrl(path), { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw await toGitHubError(response, "note の取得に失敗しました");
  }
  const data = (await response.json()) as { sha?: unknown; content?: unknown };
  if (typeof data.sha !== "string" || typeof data.content !== "string") {
    throw new GitHubError("note の取得に失敗しました: 応答の形式が不正です", response.status);
  }
  return { sha: data.sha, content: base64ToUtf8(data.content) };
}

/** テンプレートを note main から取得する。不存在（404/null）時のみ固定文面へフォールバックし、それ以外の失敗は投げる。 */
export async function getDailyNoteTemplate(client: GitHubClient): Promise<string> {
  let template: NoteFile | null;
  try {
    template = await getNoteFile(client, NOTE_TEMPLATE_PATH);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      console.warn("テンプレートが存在しません。固定文面を使います。", error);
      return FALLBACK_TEMPLATE;
    }
    throw error;
  }
  if (template) return template.content;
  return FALLBACK_TEMPLATE;
}

type PutResult = {
  sha: string;
};

/** sha 付き PUT で反映する。sha なしは新規作成。 */
async function putNoteFile(
  client: GitHubClient,
  path: string,
  content: string,
  sha: string | null,
  message: string,
): Promise<PutResult> {
  const response = await client.request(
    `/repos/${NOTE_OWNER}/${NOTE_REPO}/contents/${encodeContentPath(path)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: utf8ToBase64(content),
        branch: NOTE_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw await toGitHubError(response, "note の更新に失敗しました");
  }
  const data = (await response.json()) as { content?: { sha?: unknown } };
  const nextSha = data.content?.sha;
  if (typeof nextSha !== "string") {
    throw new GitHubError("note の更新に失敗しました: 応答の形式が不正です", response.status);
  }
  return { sha: nextSha };
}

/**
 * デイリーノートへ 1 件追記する。
 * 競合（409/422）のとき再読込＋再追記を 1 回だけリトライする。
 * knownFile に取得済み（null＝不存在確認済み含む）を渡すと初回 GET を省略する。
 */
export async function appendMonologueToNote(
  client: GitHubClient,
  entry: MonologueNoteEntry,
  knownFile: KnownNoteFile = undefined,
): Promise<PutResult> {
  const path = dailyNotePath(entry.date);
  const message = `Monologue を追記 (${entry.date})`;

  const current = knownFile !== undefined ? knownFile : await getNoteFile(client, path);
  const base = current?.content ?? (await getDailyNoteTemplate(client));
  try {
    return await putNoteFile(
      client,
      path,
      appendMonologueEntry(base, entry),
      current?.sha ?? null,
      message,
    );
  } catch (error) {
    if (!(error instanceof GitHubError) || !CONFLICT_STATUSES.has(error.status)) throw error;
    console.warn("note の更新が競合しました。再読込して 1 回だけ再試行します。", error);
    const latest = await getNoteFile(client, path);
    const latestBase = latest?.content ?? (await getDailyNoteTemplate(client));
    return await putNoteFile(
      client,
      path,
      appendMonologueEntry(latestBase, entry),
      latest?.sha ?? null,
      message,
    );
  }
}
