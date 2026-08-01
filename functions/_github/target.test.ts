import { describe, expect, it } from "vitest";

import {
  EXTERNAL_OTHERS_LABEL,
  INTERNAL_OWNER,
  NOTE_INBOX,
  determineTarget,
  parseRepoRef,
} from "./target";

describe("determineTarget", () => {
  it("内部 repo（owner == INTERNAL_OWNER）→ その repo に直接起票、external label なし", () => {
    const result = determineTarget({ owner: "t-miura-024", name: "tools" });
    expect(result.repo).toEqual({ owner: "t-miura-024", name: "tools" });
    expect(result.externalLabel).toBeNull();
  });

  it("外部 repo（owner != INTERNAL_OWNER）→ note inbox に起票、external/{owner}-{name} label", () => {
    const result = determineTarget({ owner: "other-org", name: "some-repo" });
    expect(result.repo).toEqual(NOTE_INBOX);
    expect(result.externalLabel).toEqual({
      name: "external/other-org-some-repo",
      color: "BFD4F2",
      description: "External repo: other-org/some-repo",
    });
  });

  it("repo 未指定（null）→ note inbox に起票、external/others label", () => {
    const result = determineTarget(null);
    expect(result.repo).toEqual(NOTE_INBOX);
    expect(result.externalLabel).toEqual(EXTERNAL_OTHERS_LABEL);
  });

  it("INTERNAL_OWNER 定数が t-miura-024 である", () => {
    expect(INTERNAL_OWNER).toBe("t-miura-024");
  });

  it("NOTE_INBOX が t-miura-024/note である", () => {
    expect(NOTE_INBOX).toEqual({ owner: "t-miura-024", name: "note" });
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
