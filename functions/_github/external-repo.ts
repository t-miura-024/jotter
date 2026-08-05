import type { RepoRef } from "./labels";
import { INTERNAL_OWNER } from "./target";

/**
 * 外部 repo 入力の検証（クライアント側 src/lib/target.ts のミラー実装）。
 *
 * GitHub の命名規則を根拠にする（ADR 0010 方針）:
 * - owner（ユーザー名）: 英数字または単一ハイフン、先頭・末尾ハイフン不可、
 *   連続ハイフン不可、1〜39 文字。
 * - name（リポジトリ名）: 英数字と `.` `_` `-`、1〜100 文字、
 *   連続ピリオド（..）・先頭/末尾の `.`・`.git` 終端は不可。
 * - external label: `external/{owner}-{name}` が GitHub の label 名の上限 50 文字以内。
 */

/** GitHub の owner（ユーザー名）の上限文字数。 */
export const EXTERNAL_OWNER_MAX_LENGTH = 39;

/** GitHub の repo 名の上限文字数。 */
export const EXTERNAL_NAME_MAX_LENGTH = 100;

/** GitHub label 名の上限文字数（`external/` 9 文字 + `-` 1 文字を差し引く）。 */
export const EXTERNAL_LABEL_MAX_LENGTH = 50;

/** owner/name の合計上限（external/ とハイフンの分を除いた残り）。 */
const EXTERNAL_LABEL_BUDGET = EXTERNAL_LABEL_MAX_LENGTH - "external/".length - 1;

const OWNER_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export type ExternalRepoValidation =
  | { ok: true; repo: RepoRef | null }
  | { ok: false; error: string };

/**
 * 外部 repo 入力を検証する。
 * - 空入力（または空白のみ）: 外部 repo なしとして ok（repo: null）。
 * - 不正な入力: ok: false とユーザー向けエラーメッセージ。
 */
export function validateExternalRepo(input: string): ExternalRepoValidation {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: true, repo: null };
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || trimmed.indexOf("/", slashIndex + 1) !== -1) {
    return { ok: false, error: "外部 repo は owner/name 形式で入力してください" };
  }

  const owner = trimmed.slice(0, slashIndex);
  const name = trimmed.slice(slashIndex + 1);
  if (name === "") {
    return { ok: false, error: "外部 repo は owner/name 形式で入力してください" };
  }

  if (owner === INTERNAL_OWNER) {
    return {
      ok: false,
      error: "t-miura-024/* は内部 repo のため外部 repo に指定できません",
    };
  }

  if (
    owner.length > EXTERNAL_OWNER_MAX_LENGTH ||
    !OWNER_PATTERN.test(owner)
  ) {
    return {
      ok: false,
      error: `owner は英数字とハイフン（先頭・末尾・連続ハイフン不可）で 1〜${EXTERNAL_OWNER_MAX_LENGTH} 文字にしてください`,
    };
  }

  const nameInvalid =
    name.length > EXTERNAL_NAME_MAX_LENGTH ||
    !NAME_PATTERN.test(name) ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    name.includes("..") ||
    name.endsWith(".git");
  if (nameInvalid) {
    return {
      ok: false,
      error: `name は英数字と . _ - で 1〜${EXTERNAL_NAME_MAX_LENGTH} 文字（.. や先頭・末尾の .、.git 終端は不可）にしてください`,
    };
  }

  if (owner.length + name.length > EXTERNAL_LABEL_BUDGET) {
    return {
      ok: false,
      error: `external label が長すぎます（owner と name をあわせて ${EXTERNAL_LABEL_BUDGET} 文字以内にしてください）`,
    };
  }

  return { ok: true, repo: { owner, name } };
}
