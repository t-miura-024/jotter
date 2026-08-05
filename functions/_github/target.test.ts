import { describe, expect, it } from "vitest";

import {
  INTERNAL_OWNER,
  NOTE_INBOX,
  determineTarget,
  isNoteInbox,
  parseRepoRef,
} from "./target";

describe("determineTarget（新 semantics: repo 選択 + 外部 repo 入力の分離）", () => {
  it("内部 repo 選択 → その repo に直接起票、external label なし", () => {
    const result = determineTarget({ owner: "t-miura-024", name: "tools" }, null);
    expect(result.repo).toEqual({ owner: "t-miura-024", name: "tools" });
    expect(result.externalLabel).toBeNull();
  });

  it("内部 repo（note inbox 以外）選択 + 外部 repo 入力 → external label は付かない", () => {
    const result = determineTarget(
      { owner: "t-miura-024", name: "tools" },
      { owner: "other-org", name: "some-repo" },
    );
    expect(result.repo).toEqual({ owner: "t-miura-024", name: "tools" });
    expect(result.externalLabel).toBeNull();
  });

  it("repo 未指定（null）→ note inbox に起票、外部 repo 入力がなければ label なし", () => {
    const result = determineTarget(null, null);
    expect(result.repo).toEqual(NOTE_INBOX);
    expect(result.externalLabel).toBeNull();
  });

  it("note inbox 選択 + 外部 repo 入力 → note inbox に external/{owner}-{name} label 付きで起票", () => {
    const result = determineTarget(NOTE_INBOX, { owner: "other-org", name: "some-repo" });
    expect(result.repo).toEqual(NOTE_INBOX);
    expect(result.externalLabel).toEqual({
      name: "external/other-org-some-repo",
      color: "BFD4F2",
      description: "External repo: other-org/some-repo",
    });
  });

  it("INTERNAL_OWNER 定数が t-miura-024 である", () => {
    expect(INTERNAL_OWNER).toBe("t-miura-024");
  });

  it("NOTE_INBOX が t-miura-024/note である", () => {
    expect(NOTE_INBOX).toEqual({ owner: "t-miura-024", name: "note" });
  });
});

describe("isNoteInbox", () => {
  it("t-miura-024/note を note inbox と判定する", () => {
    expect(isNoteInbox({ owner: "t-miura-024", name: "note" })).toBe(true);
  });

  it("note inbox 以外の内部 repo は false", () => {
    expect(isNoteInbox({ owner: "t-miura-024", name: "tools" })).toBe(false);
  });

  it("外部 repo は false", () => {
    expect(isNoteInbox({ owner: "other-org", name: "note" })).toBe(false);
  });
});

describe("parseRepoRef", () => {
  it("owner/name 形式を RepoRef にパースする", () => {
    expect(parseRepoRef("t-miura-024/tools")).toEqual({
      owner: "t-miura-024",
      name: "tools",
    });
  });

  it("前後の空白を除去する", () => {
    expect(parseRepoRef("  owner/name  ")).toEqual({
      owner: "owner",
      name: "name",
    });
  });

  it("空文字は null（repo 未指定）", () => {
    expect(parseRepoRef("")).toBeNull();
  });

  it("空白のみは null（repo 未指定）", () => {
    expect(parseRepoRef("   ")).toBeNull();
  });

  it("スラッシュなしは null", () => {
    expect(parseRepoRef("justname")).toBeNull();
  });

  it("先頭スラッシュ（owner 空）は null", () => {
    expect(parseRepoRef("/name")).toBeNull();
  });

  it("末尾スラッシュ（name 空）は null", () => {
    expect(parseRepoRef("owner/")).toBeNull();
  });

  it("スラッシュ複数（owner/name/extra）は null", () => {
    expect(parseRepoRef("owner/name/extra")).toBeNull();
  });
});
