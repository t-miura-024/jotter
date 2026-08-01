import { describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubError } from "./client";
import { KIND_PLAN_LABEL, ensureLabel } from "./labels";

const REPO = { owner: "t-miura-024", name: "note" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("ensureLabel", () => {
  it("label が存在しなければ作成する（POST 201）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await ensureLabel(client, REPO, KIND_PLAN_LABEL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/t-miura-024/note/labels");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "kind/plan",
      color: "0E8A16",
      description: "mt-plan で管理する計画 Issue",
    });
  });

  it("認証・API バージョンの共通ヘッダを付与する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await ensureLabel(client, REPO, KIND_PLAN_LABEL);

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(headers.get("User-Agent")).toBe("jotter");
  });

  it("既に存在する（422）場合は PATCH で更新する（--force 相当）", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Validation Failed" }, 422));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await ensureLabel(client, REPO, KIND_PLAN_LABEL);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe("https://api.github.com/repos/t-miura-024/note/labels/kind%2Fplan");
    expect(patchInit?.method).toBe("PATCH");
    expect(JSON.parse(String(patchInit?.body))).toEqual({
      color: "0E8A16",
      description: "mt-plan で管理する計画 Issue",
    });
  });

  it("PATCH も失敗した場合は GitHubError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Validation Failed" }, 422));
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Server Error" }, 500));
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(ensureLabel(client, REPO, KIND_PLAN_LABEL)).rejects.toThrow(
      "label 'kind/plan' の更新に失敗しました: Server Error",
    );
  });

  it("422 以外の失敗では即座に GitHubError を投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const promise = ensureLabel(client, REPO, KIND_PLAN_LABEL);
    await expect(promise).rejects.toThrow(GitHubError);
    await expect(promise).rejects.toMatchObject({
      status: 500,
      message: "label 'kind/plan' の作成に失敗しました: Internal Server Error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
