import { describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubError } from "./client";
import { submitDraft } from "./submit-draft";

const REPO = { owner: "t-miura-024", name: "note" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("submitDraft", () => {
  it("label を冪等確保してから kind/plan 付きで Issue を作成する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // label 作成
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 7,
          title: "走り書きの先頭行",
          html_url: "https://github.com/t-miura-024/note/issues/7",
        },
        201,
      ),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const result = await submitDraft(client, {
      repo: REPO,
      title: "走り書きの先頭行",
      body: "走り書きの先頭行\n続きの本文",
    });

    expect(result).toEqual({
      number: 7,
      title: "走り書きの先頭行",
      url: "https://github.com/t-miura-024/note/issues/7",
      repo: "t-miura-024/note",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/labels");
    const [issueUrl, issueInit] = fetchMock.mock.calls[1];
    expect(String(issueUrl)).toContain("/issues");
    expect(JSON.parse(String(issueInit?.body)).labels).toEqual(["kind/plan"]);
  });

  it("external label 指定時は kind/plan と external label の両方を確保して Issue に付与する", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // kind/plan 作成
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 })); // external label 作成
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          number: 10,
          title: "外部 repo 起票",
          html_url: "https://github.com/t-miura-024/note/issues/10",
        },
        201,
      ),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    const result = await submitDraft(client, {
      repo: REPO,
      title: "外部 repo 起票",
      body: "本文",
      externalLabel: {
        name: "external/other-org-some-repo",
        color: "BFD4F2",
        description: "External repo: other-org/some-repo",
      },
    });

    expect(result).toEqual({
      number: 10,
      title: "外部 repo 起票",
      url: "https://github.com/t-miura-024/note/issues/10",
      repo: "t-miura-024/note",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 1 回目: kind/plan label 確保
    expect(String(fetchMock.mock.calls[0][0])).toContain("/labels");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).name).toBe("kind/plan");
    // 2 回目: external label 確保
    expect(String(fetchMock.mock.calls[1][0])).toContain("/labels");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).name).toBe(
      "external/other-org-some-repo",
    );
    // 3 回目: Issue 作成（両 label 付き）
    const [issueUrl, issueInit] = fetchMock.mock.calls[2];
    expect(String(issueUrl)).toContain("/issues");
    expect(JSON.parse(String(issueInit?.body)).labels).toEqual([
      "kind/plan",
      "external/other-org-some-repo",
    ]);
  });

  it("label 確保に失敗したら Issue を作成しない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Internal Server Error" }, 500),
    );
    const client = new GitHubClient({ token: "test-token", fetch: fetchMock });

    await expect(submitDraft(client, { repo: REPO, title: "t", body: "b" })).rejects.toThrow(
      GitHubError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
