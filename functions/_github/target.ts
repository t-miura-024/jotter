import type { LabelSpec, RepoRef } from "./labels";

/** 内部 repo の owner（draft.rs の config_owner 相当）。 */
export const INTERNAL_OWNER = "t-miura-024";

/** note inbox（外部 repo 由来の draft Issue を受け取る固定の集約先、既定の target repo）。 */
export const NOTE_INBOX: RepoRef = { owner: INTERNAL_OWNER, name: "note" };

/** external label の共通カラー（draft.rs ensure_labels 由来）。 */
const EXTERNAL_LABEL_COLOR = "BFD4F2";

/**
 * 起票先（target repo）と label を決定する（新 semantics、ADR 0010）。
 *
 * - repo 未指定（null）→ note inbox に起票。外部 repo 入力がなければ label なし。
 * - 内部 repo 選択 → その repo に直接起票。external label は note inbox のときだけ意味を持つ。
 * - 外部 repo 入力 → note inbox に起票し external/{owner}-{name} を付与。
 *   external/others は新規付与しない（既存 Issue の label は変更しない）。
 */
export type TargetResult = {
  /** draft Issue を作成する target repo。 */
  repo: RepoRef;
  /** external label（note inbox + 外部 repo 入力がある場合のみ）。それ以外は null。 */
  externalLabel: LabelSpec | null;
};

/** repo が note inbox（t-miura-024/note）であるかを判定する。 */
export function isNoteInbox(repo: RepoRef): boolean {
  return repo.owner === NOTE_INBOX.owner && repo.name === NOTE_INBOX.name;
}

export function determineTarget(selected: RepoRef | null, external: RepoRef | null): TargetResult {
  const repo = selected ?? NOTE_INBOX;

  // 外部 repo 入力は target repo と解釈せず、note inbox 上の外部由来情報としてだけ扱う。
  if (!external || !isNoteInbox(repo)) {
    return { repo, externalLabel: null };
  }

  return {
    repo,
    externalLabel: {
      name: `external/${external.owner}-${external.name}`,
      color: EXTERNAL_LABEL_COLOR,
      description: `External repo: ${external.owner}/${external.name}`,
    },
  };
}

/**
 * "owner/name" 形式の文字列を RepoRef にパースする。
 * 空文字・空白のみ・不正形式は null（repo 未指定）を返す。
 */
export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0) return null;

  const owner = trimmed.slice(0, slashIndex);
  const name = trimmed.slice(slashIndex + 1);
  if (owner === "" || name === "" || name.includes("/")) return null;

  return { owner, name };
}
