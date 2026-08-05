import { describe, expect, it } from "vitest";

import {
  REPO_STORAGE_KEY,
  migrateStoredSelection,
  orderReposForNav,
  persistRepoSelection,
  readStoredRepoSelection,
} from "./repo-selection";

describe("migrateStoredSelection（旧選択値の localStorage 移行）", () => {
  it("新モデル { repo: 内部 repo } はそのまま維持する", () => {
    expect(migrateStoredSelection({ repo: "t-miura-024/tools" })).toBe("t-miura-024/tools");
    expect(migrateStoredSelection({ repo: "t-miura-024/note" })).toBe("t-miura-024/note");
  });

  it("新モデルの repo が空・不正・外部 repo なら note inbox へ移行する", () => {
    expect(migrateStoredSelection({ repo: "" })).toBe("t-miura-024/note");
    expect(migrateStoredSelection({ repo: "   " })).toBe("t-miura-024/note");
    expect(migrateStoredSelection({ repo: "other-org/some-repo" })).toBe("t-miura-024/note");
    expect(migrateStoredSelection({ repo: "justname" })).toBe("t-miura-024/note");
  });

  it("旧モデルの selection: \"\" は note inbox へ移行する", () => {
    expect(migrateStoredSelection({ selection: "", otherRepo: "" })).toBe("t-miura-024/note");
  });

  it("旧モデルの selection: __other__ は note inbox へ移行し、外部 repo 値は移行しない", () => {
    expect(
      migrateStoredSelection({ selection: "__other__", otherRepo: "other-org/some-repo" }),
    ).toBe("t-miura-024/note");
  });

  it("旧モデルの有効な内部 repo 選択は維持する", () => {
    expect(
      migrateStoredSelection({ selection: "t-miura-024/tools", otherRepo: "" }),
    ).toBe("t-miura-024/tools");
  });

  it("旧モデルの外部 repo 選択は note inbox へ移行する（閲覧は内部 repo のみ）", () => {
    expect(
      migrateStoredSelection({ selection: "other-org/some-repo", otherRepo: "" }),
    ).toBe("t-miura-024/note");
  });

  it("未保存・破損・想定外の型は note inbox へフォールバックする", () => {
    expect(migrateStoredSelection(null)).toBe("t-miura-024/note");
    expect(migrateStoredSelection(undefined)).toBe("t-miura-024/note");
    expect(migrateStoredSelection("garbage")).toBe("t-miura-024/note");
    expect(migrateStoredSelection(42)).toBe("t-miura-024/note");
    expect(migrateStoredSelection({})).toBe("t-miura-024/note");
  });
});

describe("readStoredRepoSelection / persistRepoSelection", () => {
  class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string): string | null {
      return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      this.map.set(key, value);
    }
  }

  it("未保存なら note inbox を返す", () => {
    expect(readStoredRepoSelection(new MemoryStorage())).toBe("t-miura-024/note");
  });

  it("保存済みの内部 repo 選択を読み込む", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPO_STORAGE_KEY, JSON.stringify({ repo: "t-miura-024/tools" }));
    expect(readStoredRepoSelection(storage)).toBe("t-miura-024/tools");
  });

  it("旧形式を読み込んで note inbox へ移行する", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPO_STORAGE_KEY, JSON.stringify({ selection: "__other__", otherRepo: "x/y" }));
    expect(readStoredRepoSelection(storage)).toBe("t-miura-024/note");
  });

  it("persistRepoSelection は新モデルで書き込む", () => {
    const storage = new MemoryStorage();
    persistRepoSelection(storage, "t-miura-024/tools");
    expect(storage.getItem(REPO_STORAGE_KEY)).toBe('{"repo":"t-miura-024/tools"}');
  });

  it("JSON が壊れていても note inbox へフォールバックする", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPO_STORAGE_KEY, "{broken");
    expect(readStoredRepoSelection(storage)).toBe("t-miura-024/note");
  });
});

describe("orderReposForNav", () => {
  const repos = [
    { owner: "t-miura-024", name: "tools", fullName: "t-miura-024/tools" },
    { owner: "t-miura-024", name: "note", fullName: "t-miura-024/note" },
    { owner: "t-miura-024", name: "alpha", fullName: "t-miura-024/alpha" },
  ];

  it("note inbox を先頭に置き、残りをアルファベット順にする", () => {
    expect(orderReposForNav(repos).map((repo) => repo.fullName)).toEqual([
      "t-miura-024/note",
      "t-miura-024/alpha",
      "t-miura-024/tools",
    ]);
  });

  it("入力の並びを変更しない（新しい配列を返す）", () => {
    const before = repos.map((repo) => repo.fullName);
    orderReposForNav(repos);
    expect(repos.map((repo) => repo.fullName)).toEqual(before);
  });

  it("note inbox がなくてもアルファベット順に並べる", () => {
    const withoutNote = repos.filter((repo) => repo.fullName !== "t-miura-024/note");
    expect(orderReposForNav(withoutNote).map((repo) => repo.fullName)).toEqual([
      "t-miura-024/alpha",
      "t-miura-024/tools",
    ]);
  });
});
