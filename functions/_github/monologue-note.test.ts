import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubError } from "./client";
import {
  appendMonologueToNote,
  base64ToUtf8,
  dailyNotePath,
  FALLBACK_TEMPLATE,
  getDailyNoteTemplate,
  getNoteFile,
  utf8ToBase64,
} from "./monologue-note";

const clientWith = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): GitHubClient =>
  new GitHubClient({ token: "test-token", fetch: fetchMock });

const contentsResponse = (content: string, sha: string): Response =>
  new Response(JSON.stringify({ sha, content: utf8ToBase64(content), encoding: "base64" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const putResponse = (sha: string): Response =>
  new Response(JSON.stringify({ content: { sha } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const errorResponse = (status: number, message: string): Response =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.restoreAllMocks());

describe("dailyNotePath", () => {
  it("📝daily-note/YYYY-MM-DD.md を返す", () => {
    expect(dailyNotePath("2026-09-23")).toBe("📝daily-note/2026-09-23.md");
  });
});

describe("base64 変換", () => {
  it("日本語・絵文字を往復できる", () => {
    const text = "# 💬 Monologue\n- 08:15\n    ### 朝の思いつき\n    - まず書く";
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });
});

describe("getNoteFile", () => {
  it("404 は null（新規作成の合図）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("Not Found", { status: 404 }));
    expect(await getNoteFile(clientWith(fetchMock), dailyNotePath("2026-09-23"))).toBeNull();
  });

  it("取得内容を sha＋UTF-8 で返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => contentsResponse("# 💬 Monologue\n", "abc"));
    const file = await getNoteFile(clientWith(fetchMock), dailyNotePath("2026-09-23"));
    expect(file).toEqual({ sha: "abc", content: "# 💬 Monologue\n" });
  });

  it("パスを percent-encode して main ref で取得する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => contentsResponse("x", "abc"));
    await getNoteFile(clientWith(fetchMock), dailyNotePath("2026-09-23"));
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.github.com/repos/t-miura-024/note/contents/%F0%9F%93%9Ddaily-note/2026-09-23.md?ref=main",
    );
  });

  it("500 は GitHubError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => errorResponse(500, "Server Error"));
    await expect(getNoteFile(clientWith(fetchMock), dailyNotePath("2026-09-23"))).rejects.toThrow(
      GitHubError,
    );
  });
});

describe("getDailyNoteTemplate", () => {
  it("note main から取得する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => contentsResponse("# template\n", "t1"));
    expect(await getDailyNoteTemplate(clientWith(fetchMock))).toBe("# template\n");
  });

  it("不存在時は固定文面へフォールバックする", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("Not Found", { status: 404 }));
    expect(await getDailyNoteTemplate(clientWith(fetchMock))).toBe(FALLBACK_TEMPLATE);
  });

  it("500 はフォールバックせず GitHubError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => errorResponse(500, "Server Error"));
    await expect(getDailyNoteTemplate(clientWith(fetchMock))).rejects.toThrow(GitHubError);
  });

  it("401 はフォールバックせず GitHubError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => errorResponse(401, "Unauthorized"));
    await expect(getDailyNoteTemplate(clientWith(fetchMock))).rejects.toThrow(GitHubError);
  });

  it("ネットワーク例外はフォールバックせず再throwする", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(getDailyNoteTemplate(clientWith(fetchMock))).rejects.toThrow(TypeError);
  });
});

describe("appendMonologueToNote", () => {
  it("既存ファイルへ sha 付き PUT で追記する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(contentsResponse("# 💬 Monologue\n", "sha-1"));
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        sha?: string;
        branch?: string;
        content?: string;
      };
      expect(payload.sha).toBe("sha-1");
      expect(payload.branch).toBe("main");
      expect(base64ToUtf8(payload.content ?? "")).toContain("- 08:15\n    ### 朝\n    - 書く");
      return putResponse("sha-2");
    });
    const result = await appendMonologueToNote(clientWith(fetchMock), {
      date: "2026-09-23",
      time: "08:15",
      title: "朝",
      body: "- 書く",
    });
    expect(result).toEqual({ sha: "sha-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ファイル不存在時はテンプレート複製＋追記を sha なし PUT する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    fetchMock.mockResolvedValueOnce(contentsResponse("# template\n", "t1"));
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        sha?: string;
        content?: string;
      };
      expect(payload.sha).toBeUndefined();
      expect(base64ToUtf8(payload.content ?? "")).toContain("- 08:15\n    ### 初回\n    - はじめ");
      return putResponse("sha-new");
    });
    const result = await appendMonologueToNote(clientWith(fetchMock), {
      date: "2026-09-23",
      time: "08:15",
      title: "初回",
      body: "- はじめ",
    });
    expect(result).toEqual({ sha: "sha-new" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("取得済み（KnownNoteFile）を渡すと初回 GET を省略する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        sha?: string;
        content?: string;
      };
      expect(payload.sha).toBe("sha-9");
      expect(base64ToUtf8(payload.content ?? "")).toContain("### 追記");
      return putResponse("sha-10");
    });
    const result = await appendMonologueToNote(
      clientWith(fetchMock),
      { date: "2026-09-23", time: "08:15", title: "追記", body: "- 内容" },
      { sha: "sha-9", content: "# 💬 Monologue\n" },
    );
    expect(result).toEqual({ sha: "sha-10" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("不存在確認済み（null）を渡すと GET せずテンプレート取得のみ行う", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(contentsResponse("# template\n", "t1"));
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        sha?: string;
        content?: string;
      };
      expect(payload.sha).toBeUndefined();
      return putResponse("sha-new");
    });
    const result = await appendMonologueToNote(
      clientWith(fetchMock),
      { date: "2026-09-23", time: "08:15", title: "初回", body: "- はじめ" },
      null,
    );
    expect(result).toEqual({ sha: "sha-new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("競合（409）時は再読込＋再追記を 1 回だけリトライする", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(contentsResponse("# 💬 Monologue\n", "sha-1"));
    fetchMock.mockResolvedValueOnce(errorResponse(409, "Conflict"));
    fetchMock.mockResolvedValueOnce(
      contentsResponse("# 💬 Monologue\n- 09:00\n    ### 他\n    - 先勝ち\n", "sha-2"),
    );
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        sha?: string;
        content?: string;
      };
      expect(payload.sha).toBe("sha-2");
      const content = base64ToUtf8(payload.content ?? "");
      // 再読込後の内容＋今回分が両方含まれる
      expect(content).toContain("### 他");
      expect(content).toContain("### 自分");
      return putResponse("sha-3");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await appendMonologueToNote(clientWith(fetchMock), {
      date: "2026-09-23",
      time: "10:00",
      title: "自分",
      body: "- 追記",
    });
    expect(result).toEqual({ sha: "sha-3" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("2 回目の競合は投げる（リトライは 1 回まで）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(contentsResponse("# 💬 Monologue\n", "sha-1"));
    fetchMock.mockResolvedValueOnce(errorResponse(409, "Conflict"));
    fetchMock.mockResolvedValueOnce(contentsResponse("# 💬 Monologue\n", "sha-2"));
    fetchMock.mockResolvedValueOnce(errorResponse(409, "Conflict"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      appendMonologueToNote(clientWith(fetchMock), {
        date: "2026-09-23",
        time: "10:00",
        title: "自分",
        body: "- 追記",
      }),
    ).rejects.toThrow(GitHubError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("競合以外（500）はリトライせず投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(contentsResponse("# 💬 Monologue\n", "sha-1"));
    fetchMock.mockResolvedValueOnce(errorResponse(500, "Server Error"));
    await expect(
      appendMonologueToNote(clientWith(fetchMock), {
        date: "2026-09-23",
        time: "10:00",
        title: "自分",
        body: "- 追記",
      }),
    ).rejects.toThrow(GitHubError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
