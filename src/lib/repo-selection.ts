/**
 * repo 選択状態のモデルと localStorage の移行（ADR 0010）。
 *
 * 新モデルは「内部 repo の fullName」1 つだけを保持する。
 * 旧モデル（{ selection: "" | "owner/name" | "__other__", otherRepo }）からは
 * 初回読込時に移行する:
 * - "" と __other__ は note inbox へ移行（__other__ と共に保存されていた外部 repo 値は移行しない）
 * - 有効な内部 repo 選択は維持
 * - 外部 repo 選択・不正値は note inbox へ移行（外部 repo の plan list 閲覧は廃止）
 */

import { INTERNAL_OWNER, NOTE_INBOX, parseRepoRef } from "@/lib/target";

export const REPO_STORAGE_KEY = "jotter-repo-selection";

/** 新モデルの選択値（内部 repo の fullName。既定は note inbox）。 */
export type RepoSelection = string;

/** 旧モデルで「その他（自由入力）」を表していたセレクタ値。 */
const LEGACY_OTHER_VALUE = "__other__";

/** 内部 repo かどうか（新モデルは内部 repo のみ選択可能）。 */
function isInternalRepoFullName(fullName: string): boolean {
  const ref = parseRepoRef(fullName);
  return ref !== null && ref.owner === INTERNAL_OWNER;
}

/**
 * 保存されていた選択値を新モデルへ移行する。
 * 未保存・破損・旧モデル・外部 repo のいずれも note inbox へフォールバックする。
 */
export function migrateStoredSelection(stored: unknown): RepoSelection {
  if (stored && typeof stored === "object") {
    // 新モデル { repo: fullName }
    const candidate = (stored as { repo?: unknown }).repo;
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return isInternalRepoFullName(candidate) ? candidate : NOTE_INBOX;
    }
  }

  // 旧モデル { selection, otherRepo }
  const selection = (stored as { selection?: unknown } | null)?.selection;
  if (typeof selection === "string") {
    if (selection === "" || selection === LEGACY_OTHER_VALUE) return NOTE_INBOX;
    if (isInternalRepoFullName(selection)) return selection;
  }

  return NOTE_INBOX;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** localStorage から選択値を読み込み、新モデルへ移行して返す。 */
export function readStoredRepoSelection(storage: StorageLike): RepoSelection {
  try {
    const raw = storage.getItem(REPO_STORAGE_KEY);
    if (raw) {
      return migrateStoredSelection(JSON.parse(raw));
    }
  } catch {
    // localStorage 利用不可（プライベートモード等）は既定選択にフォールバック。
  }
  return NOTE_INBOX;
}

/** 選択値を localStorage へ永続化する（失敗しても当セッションの選択は維持される）。 */
export function persistRepoSelection(storage: StorageLike, selection: RepoSelection): void {
  try {
    storage.setItem(REPO_STORAGE_KEY, JSON.stringify({ repo: selection }));
  } catch {
    // 永続化できなくても当セッションの選択は維持される。
  }
}

export type RepoNavEntry = {
  owner: string;
  name: string;
  fullName: string;
};

/**
 * sidebar / drawer に並べる repo の順序: note inbox を必ず先頭へ置き、
 * 残りをアルファベット順（fullName 昇順）にする。
 */
export function orderReposForNav(repos: RepoNavEntry[]): RepoNavEntry[] {
  return [...repos].sort((a, b) => {
    const aNote = a.fullName === NOTE_INBOX ? 0 : 1;
    const bNote = b.fullName === NOTE_INBOX ? 0 : 1;
    if (aNote !== bNote) return aNote - bNote;
    return a.fullName.localeCompare(b.fullName);
  });
}
