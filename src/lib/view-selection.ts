/**
 * Plan / Monologue の表示切替状態と localStorage 永続化。
 *
 * repo-selection.ts と同じパターン: 新モデル `{ view: "plan" | "monologue" }` を
 * `jotter-view-selection` キーで保存する。未保存・破損・不正値は plan へ
 * フォールバックする（既定の表示は Plan のまま）。
 */

export const VIEW_STORAGE_KEY = "jotter-view-selection";

/** 表示切替の選択値（既定は plan）。 */
export type ViewSelection = "plan" | "monologue";

function isViewSelection(value: unknown): value is ViewSelection {
  return value === "plan" || value === "monologue";
}

/**
 * 保存されていた選択値を新モデルへ移行する。
 * 未保存・破損・想定外の型・不正値は plan へフォールバックする。
 */
export function migrateViewSelection(stored: unknown): ViewSelection {
  if (stored && typeof stored === "object") {
    const candidate = (stored as { view?: unknown }).view;
    if (isViewSelection(candidate)) return candidate;
  }
  // 旧形式の素朴な文字列保存（"plan" / "monologue"）も受け付ける。
  if (isViewSelection(stored)) return stored;
  return "plan";
}

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** localStorage から選択値を読み込み、不正値は plan へ移行して返す。 */
export function readStoredViewSelection(storage: StorageLike): ViewSelection {
  try {
    const raw = storage.getItem(VIEW_STORAGE_KEY);
    if (raw) {
      return migrateViewSelection(JSON.parse(raw));
    }
  } catch {
    // localStorage 利用不可（プライベートモード等）は既定選択にフォールバック。
  }
  return "plan";
}

/** 選択値を localStorage へ永続化する（失敗しても当セッションの選択は維持される）。 */
export function persistViewSelection(storage: StorageLike, selection: ViewSelection): void {
  try {
    storage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ view: selection }));
  } catch {
    // 永続化できなくても当セッションの選択は維持される。
  }
}
