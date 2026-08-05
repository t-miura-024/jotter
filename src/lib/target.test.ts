import { describe, expect, it } from "vitest";

import { NOTE_INBOX, describeJotTarget, validateExternalRepo } from "./target";

describe("validateExternalRepo（クライアント側: サーバと同一規則）", () => {
  it("空入力は外部 repo なしとして ok", () => {
    expect(validateExternalRepo("")).toEqual({ ok: true, repo: null });
  });

  it("有効な owner/name をパースする", () => {
    const result = validateExternalRepo("other-org/some-repo");
    expect(result).toEqual({ ok: true, repo: { owner: "other-org", name: "some-repo" } });
  });

  it("t-miura-024/* は内部 repo のため拒否する", () => {
    const result = validateExternalRepo("t-miura-024/tools");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("内部 repo");
  });

  it("境界値: owner 39 + name 1 は許可、owner 40 は拒否", () => {
    expect(validateExternalRepo(`${"o".repeat(39)}/n`).ok).toBe(true);
    expect(validateExternalRepo(`${"o".repeat(40)}/n`).ok).toBe(false);
  });

  it("境界値: owner + name が 40 文字ちょうどは許可、41 文字は label 長超過で拒否", () => {
    expect(validateExternalRepo(`${"o".repeat(20)}/${"n".repeat(20)}`).ok).toBe(true);
    const result = validateExternalRepo(`${"o".repeat(21)}/${"n".repeat(20)}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("長すぎます");
  });

  it.each([
    "no-slash",
    "/leading",
    "trailing/",
    "a/b/extra",
    "-lead/name",
    "a--b/name",
    "a.b/name",
    "owner/a..b",
    "owner/.leading",
    "owner/trailing.",
    "owner/name.git",
    "owner/名前",
  ])("不正な入力 %s を拒否する", (input) => {
    expect(validateExternalRepo(input).ok).toBe(false);
  });
});

describe("describeJotTarget（新 semantics）", () => {
  it("note inbox 選択 + 有効な外部 repo 入力 → note inbox + external label", () => {
    expect(describeJotTarget(NOTE_INBOX, "other-org/some-repo")).toEqual({
      repo: "t-miura-024/note",
      externalLabel: "external/other-org-some-repo",
    });
  });

  it("note inbox 選択 + 空入力 → note inbox、label なし（external/others は付けない）", () => {
    expect(describeJotTarget(NOTE_INBOX, "")).toEqual({
      repo: "t-miura-024/note",
      externalLabel: null,
    });
  });

  it("note inbox 選択 + 不正な外部 repo 入力 → label なしで表示する（サーバ側で拒否される）", () => {
    expect(describeJotTarget(NOTE_INBOX, "no-slash")).toEqual({
      repo: "t-miura-024/note",
      externalLabel: null,
    });
  });

  it("note inbox 以外の内部 repo 選択 → 外部 repo 入力があっても label なし", () => {
    expect(describeJotTarget("t-miura-024/tools", "other-org/some-repo")).toEqual({
      repo: "t-miura-024/tools",
      externalLabel: null,
    });
  });

  it("repo 空文字は note inbox として扱う", () => {
    expect(describeJotTarget("", "")).toEqual({
      repo: "t-miura-024/note",
      externalLabel: null,
    });
  });
});
