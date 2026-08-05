/**
 * 起票先・external label のクライアント側ミラー（ADR 0010）。
 *
 * サーバ側 functions/_github/target.ts / external-repo.ts の表示・検証用ミラーで、
 * JotDialog の起票先表示とクライアント検証にのみ使う（実際の判定はサーバが行う）。
 */

/** 内部 repo の owner（サーバ側と同一）。 */
export const INTERNAL_OWNER = "t-miura-024";

/** note inbox（外部 repo 入力がない jot も直接起票できる既定の target repo）。 */
export const NOTE_INBOX = `${INTERNAL_OWNER}/note`;

export type RepoRef = {
  owner: string;
  name: string;
};

/** GitHub の owner（ユーザー名）の上限文字数。 */
export const EXTERNAL_OWNER_MAX_LENGTH = 39;

/** GitHub の repo 名の上限文字数。 */
export const EXTERNAL_NAME_MAX_LENGTH = 100;

/** GitHub label 名の上限文字数。 */
export const EXTERNAL_LABEL_MAX_LENGTH = 50;

const EXTERNAL_LABEL_BUDGET = EXTERNAL_LABEL_MAX_LENGTH - "external/".length - 1;

const OWNER_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export type ExternalRepoValidation =
  | { ok: true; repo: RepoRef | null }
  | { ok: false; error: string };

/**
 * 外部 repo 入力を検証する（サーバ側 validateExternalRepo と同一規則）。
 * 空入力は外部 repo なし（ok, repo: null）として扱う。
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

  if (owner.length > EXTERNAL_OWNER_MAX_LENGTH || !OWNER_PATTERN.test(owner)) {
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

/**
 * "owner/name" 形式の文字列を RepoRef にパースする（サーバ側 parseRepoRef と同一）。
 * 空文字・空白のみ・不正形式は null。
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

export type JotTarget = {
  /** jot が実際に起票される target repo（owner/name）。 */
  repo: string;
  /** 付与される external label（note inbox + 外部 repo 入力がある場合のみ）。 */
  externalLabel: string | null;
};

/**
 * repo 選択（内部 repo）と外部 repo 入力から jot の実起票先を導く。
 * 外部 repo 入力は target repo と解釈せず、note inbox のときだけ label になる。
 */
export function describeJotTarget(repo: string, externalRepo: string): JotTarget {
  const targetRepo = repo.trim() === "" ? NOTE_INBOX : repo.trim();
  const isNoteInbox = targetRepo === NOTE_INBOX;

  const validation = validateExternalRepo(externalRepo);
  const externalRepoRef = validation.ok ? validation.repo : null;

  return {
    repo: targetRepo,
    externalLabel:
      isNoteInbox && externalRepoRef
        ? `external/${externalRepoRef.owner}-${externalRepoRef.name}`
        : null,
  };
}
