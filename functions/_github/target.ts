import type { LabelSpec, RepoRef } from "./labels";

/** 内部 repo の owner（draft.rs の config_owner 相当）。 */
export const INTERNAL_OWNER = "t-miura-024";

/** note inbox（外部 repo 指定・repo 未指定の draft Issue を受け取る固定の集約先）。 */
export const NOTE_INBOX: RepoRef = { owner: INTERNAL_OWNER, name: "note" };

/** external label の共通カラー（draft.rs ensure_labels 由来）。 */
const EXTERNAL_LABEL_COLOR = "BFD4F2";

/** repo 未指定時に付与する external label。 */
export const EXTERNAL_OTHERS_LABEL: LabelSpec = {
  name: "external/others",
  color: EXTERNAL_LABEL_COLOR,
  description: "External repo: unspecified",
};

/**
 * 起票先（target repo）と label を決定する（draft.rs determine_target の移植）。
 *
 * - 内部 repo（owner == INTERNAL_OWNER）→ その repo に直接起票。label は kind/plan のみ。
 * - 外部 repo（owner != INTERNAL_OWNER）→ note inbox に起票。label は kind/plan + external/{owner}-{name}。
 * - repo 未指定（null）→ note inbox に起票。label は kind/plan + external/others。
 */
export type TargetResult = {
  /** draft Issue を作成する target repo。 */
  repo: RepoRef;
  /** external label（外部 repo 指定 or 未指定の場合）。内部 repo の場合は null。 */
  externalLabel: LabelSpec | null;
};

export function determineTarget(selected: RepoRef | null): TargetResult {
  if (selected === null) {
    return { repo: NOTE_INBOX, externalLabel: EXTERNAL_OTHERS_LABEL };
  }

  if (selected.owner === INTERNAL_OWNER) {
    return { repo: selected, externalLabel: null };
  }

  return {
    repo: NOTE_INBOX,
    externalLabel: {
      name: `external/${selected.owner}-${selected.name}`,
      color: EXTERNAL_LABEL_COLOR,
      description: `External repo: ${selected.owner}/${selected.name}`,
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
