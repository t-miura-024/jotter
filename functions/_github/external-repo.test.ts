import { describe, expect, it } from "vitest";

import { validateExternalRepo } from "./external-repo";

const valid = (input: string) => {
  const result = validateExternalRepo(input);
  expect(result.ok).toBe(true);
  return result.ok ? result.repo : null;
};

describe("validateExternalRepo（GitHub 命名規則に基づく境界値検証）", () => {
  it("空入力は外部 repo なし（repo: null）として ok", () => {
    expect(validateExternalRepo("")).toEqual({ ok: true, repo: null });
    expect(validateExternalRepo("   ")).toEqual({ ok: true, repo: null });
  });

  it("有効な owner/name をパースする", () => {
    expect(valid("other-org/some-repo")).toEqual({ owner: "other-org", name: "some-repo" });
    expect(valid("a/b")).toEqual({ owner: "a", name: "b" });
    expect(valid("org-1/repo.name_2-x")).toEqual({ owner: "org-1", name: "repo.name_2-x" });
  });

  it("前後の空白を除去してから検証する", () => {
    expect(valid("  other-org/some-repo  ")).toEqual({
      owner: "other-org",
      name: "some-repo",
    });
  });

  it("t-miura-024/* は内部 repo のため拒否する", () => {
    const result = validateExternalRepo("t-miura-024/tools");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("内部 repo");
  });

  describe("owner 形式", () => {
    it.each([
      "no-slash",
      "/leading",
      "trailing/",
      "a/b/extra",
      "owner//name",
      "-leading/name",
      "trailing-/name",
      "a--b/name",
      "a.b/name", // owner は英数字とハイフンのみ
      "a_b/name",
      "a b/name",
    ])("%s を拒否する", (input) => {
      expect(validateExternalRepo(input).ok).toBe(false);
    });

    it("owner が 39 文字ちょうどは許可し、40 文字は拒否する（label 予算内の組み合わせで検証）", () => {
      const owner39 = "o".repeat(39);
      const owner40 = "o".repeat(40);
      expect(valid(`${owner39}/n`)).toEqual({ owner: owner39, name: "n" });
      expect(validateExternalRepo(`${owner40}/n`).ok).toBe(false);
    });
  });

  describe("name 形式", () => {
    it.each([
      "owner/a..b", // 連続ピリオド
      "owner/.leading", // 先頭ピリオド
      "owner/trailing.", // 末尾ピリオド
      "owner/name.git", // .git 終端
      "owner/na me",
      "owner/名前", // 非 ASCII
    ])("%s を拒否する", (input) => {
      expect(validateExternalRepo(input).ok).toBe(false);
    });

    it("name が 100 文字を超える値は拒否する（101 文字）", () => {
      const name101 = "n".repeat(101);
      expect(validateExternalRepo(`o/${name101}`).ok).toBe(false);
    });

    it("name が 39 文字ちょうどは許可し、40 文字は label 予算超過で拒否する（owner 1 文字の場合）", () => {
      const name39 = "n".repeat(39);
      const name40 = "n".repeat(40);
      expect(valid(`o/${name39}`)).toEqual({ owner: "o", name: name39 });
      const result = validateExternalRepo(`o/${name40}`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("長すぎます");
    });
  });

  describe("external label 長", () => {
    it("owner + name が 40 文字ちょうどは許可する（label 50 文字）", () => {
      const owner = "o".repeat(20);
      const name = "n".repeat(20);
      expect(valid(`${owner}/${name}`)).toEqual({ owner, name });
    });

    it("owner + name が 41 文字では label 上限（50 文字）を超えるため拒否する", () => {
      const owner = "o".repeat(21);
      const name = "n".repeat(20);
      const result = validateExternalRepo(`${owner}/${name}`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("長すぎます");
    });

    it("個別の長さ上限内でも label 長で拒否される（owner 39 + name 2）", () => {
      const owner = "o".repeat(39);
      const result = validateExternalRepo(`${owner}/nn`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("長すぎます");
    });
  });
});
