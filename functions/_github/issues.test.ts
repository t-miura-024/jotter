import { describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubError } from "./client";
import { createIssue } from "./issues";

const REPO = { owner: "t-miura-024", name: "note" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("createIssue", () => {
  it("Issue を作成し html_url を url へマップして返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          number: 42,
          title: "バグを直す",
          html_url: "https://github.com/t-miura-024/note/issues/42",
        },
        201,
      ),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const issue = await createIssue(client, REPO, {
      title: "バグを直す",
      body: "詳細な説明",
      labels: ["kind/plan"],
    });

    expect(issue).toEqual({
      number: 42,
      title: "バグを直す",
      url: "https://github.com/t-miura-024/note/issues/42",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/t-miura-024/note/issues");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "バグを直す",
      body: "詳細な説明",
      labels: ["kind/plan"],
    });
  });

  it("失敗時は GitHub のエラーメッセージを GitHubError に含める", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          message: "Validation Failed",
          errors: [{ code: "custom", message: "title is too long" }],
        },
        422,
      ),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const promise = createIssue(client, REPO, {
      title: "t",
      body: "b",
      labels: ["kind/plan"],
    });
    await expect(promise).rejects.toThrow(GitHubError);
    await expect(promise).rejects.toThrow(
      "Issue の作成に失敗しました: Validation Failed (title is too long)",
    );
  });
});
