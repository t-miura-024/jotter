/** 内部 repo の owner（サーバ側 functions/_github/target.ts の INTERNAL_OWNER と同一）。 */
const INTERNAL_OWNER = "t-miura-024";

/** note inbox（外部 repo 指定・repo 未指定の起票先）。 */
const NOTE_INBOX = `${INTERNAL_OWNER}/note`;

export type JotTarget = {
  /** jot が実際に起票される target repo（owner/name）。 */
  repo: string;
  /** 付与される external label（外部 repo 指定 or 未指定の場合）。内部 repo では null。 */
  externalLabel: string | null;
};

/**
 * 上部プルダウンの選択値から jot の実起票先を導く。
 * サーバ側 determineTarget（functions/_github/target.ts）の表示用ミラーで、
 * Jot モーダルの起票先表示にのみ使う（実際の判定はサーバが行う）。
 */
export function describeJotTarget(repo: string): JotTarget {
  const trimmed = repo.trim();
  if (trimmed === "") {
    return { repo: NOTE_INBOX, externalLabel: "external/others" };
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0) {
    return { repo: NOTE_INBOX, externalLabel: "external/others" };
  }

  const owner = trimmed.slice(0, slashIndex);
  const name = trimmed.slice(slashIndex + 1);
  if (owner === "" || name === "" || name.includes("/")) {
    return { repo: NOTE_INBOX, externalLabel: "external/others" };
  }

  if (owner === INTERNAL_OWNER) {
    return { repo: trimmed, externalLabel: null };
  }

  return { repo: NOTE_INBOX, externalLabel: `external/${owner}-${name}` };
}
