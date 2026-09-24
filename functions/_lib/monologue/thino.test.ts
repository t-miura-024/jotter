import { describe, expect, it } from "vitest";

import {
  monologueMergeKey,
  normalizeMonologueTitle,
  sortMonologuesDesc,
} from "../../../shared/monologue";
import {
  appendMonologueEntry,
  formatThinoEntry,
  MONOLOGUE_SECTION_HEADING,
  parseMonologueSection,
} from "./thino";

const SAMPLE = [
  "# 📝 Daily Note",
  "",
  "# 💬 Monologue",
  "- 08:15",
  "    ### 朝の思いつき",
  "    - まず書く",
  "    - あとで読む",
  "- 21:40",
  "    ### 夜のメモ",
  "    - 今日のふりかえり",
  "",
  "# 📎 Links",
  "- https://example.com",
  "",
].join("\n");

describe("normalizeMonologueTitle / monologueMergeKey", () => {
  it("trim＋空白折畳みで正規化する", () => {
    expect(normalizeMonologueTitle("  朝の　思いつき\nメモ ")).toBe("朝の 思いつき メモ");
  });

  it("日付＋正規化タイトル＋正規化本文で突合キーを作る", () => {
    expect(monologueMergeKey("2026-09-23", "  朝の　思いつき ", "- まず書く\n\n- あとで読む")).toBe(
      "2026-09-23\n朝の 思いつき\n- まず書く\n- あとで読む",
    );
  });

  it("新しい順（date 降順→time 降順）にソートする", () => {
    const sorted = sortMonologuesDesc([
      { date: "2026-09-22", time: "21:00" },
      { date: "2026-09-23", time: "08:15" },
      { date: "2026-09-23", time: "21:40" },
    ]);
    expect(sorted.map((e) => e.time)).toEqual(["21:40", "08:15", "21:00"]);
    expect(sorted.map((e) => e.date)).toEqual(["2026-09-23", "2026-09-23", "2026-09-22"]);
  });
});

describe("parseMonologueSection", () => {
  it("### 単位で読み取り新しい順で返す", () => {
    const entries = parseMonologueSection(SAMPLE, "2026-09-23");
    expect(entries).toEqual([
      {
        title: "夜のメモ",
        body: "- 今日のふりかえり",
        date: "2026-09-23",
        time: "21:40",
        sources: { note: true, google: false },
      },
      {
        title: "朝の思いつき",
        body: "- まず書く\n- あとで読む",
        date: "2026-09-23",
        time: "08:15",
        sources: { note: true, google: false },
      },
    ]);
  });

  it("セクション不存在時は空配列", () => {
    expect(parseMonologueSection("# 📝 Daily Note\n- a\n", "2026-09-23")).toEqual([]);
  });

  it("タイトルなしの時刻ブロックは捨てる", () => {
    const markdown = [
      "# 💬 Monologue",
      "- 08:15",
      "    - 箇条だけ",
      "- 09:00",
      "    ### ある",
      "    - ok",
      "",
    ].join("\n");
    const entries = parseMonologueSection(markdown, "2026-09-23");
    expect(entries.map((e) => e.time)).toEqual(["09:00"]);
  });

  it("タイトルの絵文字はそのまま保持する", () => {
    const markdown = ["# 💬 Monologue", "- 08:15", "    ### 💡 ひらめき", "    - x", ""].join("\n");
    expect(parseMonologueSection(markdown, "2026-09-23")[0].title).toBe("💡 ひらめき");
  });
});

describe("formatThinoEntry / appendMonologueEntry", () => {
  it("thino 形式（- HH:MM＋indent ###＋indent 箇条書き）に整形する", () => {
    expect(
      formatThinoEntry({ time: "08:15", title: "朝の思いつき", body: "- まず書く\n- あとで読む" }),
    ).toBe("- 08:15\n    ### 朝の思いつき\n    - まず書く\n    - あとで読む");
  });

  it("セクション末尾へ追記し後続セクションを壊さない", () => {
    const updated = appendMonologueEntry(SAMPLE, {
      time: "23:00",
      title: "追記",
      body: "- おやすみ",
    });
    expect(updated).toContain("- 23:00\n    ### 追記\n    - おやすみ\n\n# 📎 Links");
    // 既存 2 件を維持する
    expect(updated).toContain("### 朝の思いつき");
    expect(updated).toContain("### 夜のメモ");
    // 追記分をパースできる
    const entries = parseMonologueSection(updated, "2026-09-23");
    expect(entries.map((e) => e.time)).toEqual(["23:00", "21:40", "08:15"]);
  });

  it("セクション不存在時は末尾に作成する", () => {
    const updated = appendMonologueEntry("# 📝 Daily Note\n", {
      time: "08:15",
      title: "初回",
      body: "- はじめ",
    });
    expect(updated).toContain(`${MONOLOGUE_SECTION_HEADING}\n- 08:15\n    ### 初回\n    - はじめ`);
  });

  it("空文書はセクションから始める", () => {
    expect(appendMonologueEntry("", { time: "08:15", title: "初回", body: "- はじめ" })).toBe(
      "# 💬 Monologue\n- 08:15\n    ### 初回\n    - はじめ\n",
    );
  });
});

describe("sanitizeThinoEntry / formatThinoEntry バリデーション", () => {
  it("title の改行は除去して単一行にする", () => {
    expect(formatThinoEntry({ time: "08:15", title: "朝の\n思いつき", body: "- x" })).toBe(
      "- 08:15\n    ### 朝の 思いつき\n    - x",
    );
  });

  it("title 121文字は投げる", () => {
    expect(() => formatThinoEntry({ time: "08:15", title: "あ".repeat(121), body: "- x" })).toThrow(
      "120文字を超えています",
    );
  });

  it("title 120文字は通す", () => {
    expect(formatThinoEntry({ time: "08:15", title: "あ".repeat(120), body: "- x" })).toContain(
      `### ${"あ".repeat(120)}`,
    );
  });

  it("body の見出し行（# / ###）は拒否する", () => {
    expect(() => formatThinoEntry({ time: "08:15", title: "t", body: "- ok\n### 見出し" })).toThrow(
      "箇条書き以外",
    );
    expect(() => formatThinoEntry({ time: "08:15", title: "t", body: "# 見出し" })).toThrow(
      "箇条書き以外",
    );
  });

  it("body の箇条書きでない平文は拒否する", () => {
    expect(() => formatThinoEntry({ time: "08:15", title: "t", body: "plain text" })).toThrow(
      "箇条書き以外",
    );
  });

  it("空 title/body は投げる", () => {
    expect(() => formatThinoEntry({ time: "08:15", title: "   ", body: "- x" })).toThrow(
      "title が空",
    );
    expect(() => formatThinoEntry({ time: "08:15", title: "t", body: "   " })).toThrow("body が空");
  });
});
