/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { JotDialog } from "./jot-dialog";

const sseResponse = (event: string, data: unknown): Response =>
  new Response(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const doneResult = {
  number: 7,
  title: "タイトル",
  url: "https://github.com/t-miura-024/note/issues/7",
  repo: "t-miura-024/note",
  body: "本文",
  modelUsed: "gemini-flash-latest",
  fallbackOccurred: false,
  projectAdded: false,
};

function setup(overrides: { repo?: string; onSuccess?: () => void } = {}) {
  const onSuccess = overrides.onSuccess ?? vi.fn();
  render(
    <JotDialog
      open={true}
      onOpenChange={vi.fn()}
      repo={overrides.repo ?? "t-miura-024/note"}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess };
}

function fillJot(text = "走り書きの本文") {
  fireEvent.change(screen.getByLabelText("jot 本文"), { target: { value: text } });
}

async function clickSubmit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "起票" }));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("JotDialog — 外部 repo 入力の表示条件", () => {
  it("note inbox 選択時だけ外部 repo 入力欄を表示する", () => {
    setup({ repo: "t-miura-024/note" });
    expect(screen.getByLabelText("外部 repo（owner/name 形式）")).toBeTruthy();
  });

  it("note inbox 以外の内部 repo 選択時は外部 repo 入力欄を表示しない", () => {
    setup({ repo: "t-miura-024/tools" });
    expect(screen.queryByLabelText("外部 repo（owner/name 形式）")).toBeNull();
  });

  it("note inbox + 空入力は label なしの note inbox 宛てとして表示する", () => {
    setup({ repo: "t-miura-024/note" });
    // 起票先表示行（p 要素）をスコープにして label の有無を確認する
    const targetLine = screen.getByText(/起票先/);
    expect(targetLine.textContent).toContain("t-miura-024/note");
    expect(targetLine.textContent).not.toContain("label 付き");
  });

  it("note inbox + 有効な外部 repo 入力は external label 付きの表示になる", () => {
    setup({ repo: "t-miura-024/note" });
    fireEvent.change(screen.getByLabelText("外部 repo（owner/name 形式）"), {
      target: { value: "other-org/some-repo" },
    });
    expect(screen.getByText("external/other-org-some-repo")).toBeTruthy();
  });
});

describe("JotDialog — 外部 repo 入力のクライアント検証", () => {
  it("不正な外部 repo 入力ではエラーを表示し、送信（LLM 呼び出し）を開始しない", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/note" });

    fillJot();
    fireEvent.change(screen.getByLabelText("外部 repo（owner/name 形式）"), {
      target: { value: "t-miura-024/tools" }, // 内部 repo は外部 repo に指定不可
    });

    expect(screen.getByRole("alert").textContent).toContain("内部 repo");
    // エラー中は起票ボタンが無効化され、fetch は呼ばれない
    expect(screen.getByRole("button", { name: "起票" }).hasAttribute("disabled")).toBe(true);
    await clickSubmit();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("外部 repo 入力なしなら検証は通る（送信可能）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sseResponse("error", { error: "boom" }));
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/note" });

    fillJot();
    expect(screen.getByRole("button", { name: "起票" }).hasAttribute("disabled")).toBe(false);
    await clickSubmit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("JotDialog — submit payload と状態保持", () => {
  it("note inbox + 有効な外部 repo 入力は externalRepo を payload に含めて送信する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sseResponse("error", { error: "boom" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/note" });

    fillJot();
    fireEvent.change(screen.getByLabelText("外部 repo（owner/name 形式）"), {
      target: { value: "  other-org/some-repo  " },
    });
    await clickSubmit();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.repo).toBe("t-miura-024/note");
    expect(body.externalRepo).toBe("other-org/some-repo");
    expect(body.jot).toBe("走り書きの本文");
  });

  it("note inbox + 空の外部 repo 入力は externalRepo を空で送信する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sseResponse("error", { error: "boom" }));
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/note" });

    fillJot();
    await clickSubmit();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.externalRepo).toBe("");
  });

  it("note inbox 以外の内部 repo 選択時は externalRepo を空で送信する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sseResponse("error", { error: "boom" }));
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/tools" });

    fillJot();
    await clickSubmit();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.repo).toBe("t-miura-024/tools");
    expect(body.externalRepo).toBe("");
  });

  it("失敗時（4xx）はエラーを表示し、jot 本文と外部 repo 入力は保持される", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "外部 repo は owner/name 形式で入力してください" }, 400),
    );
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/note" });

    fillJot("保持される jot");
    fireEvent.change(screen.getByLabelText("外部 repo（owner/name 形式）"), {
      target: { value: "other-org/some-repo" },
    });
    await clickSubmit();

    expect(screen.getByRole("alert").textContent).toContain("起票に失敗しました");
    // 両方とも保持され、再送信できる
    expect((screen.getByLabelText("jot 本文") as HTMLTextAreaElement).value).toBe("保持される jot");
    expect(
      (screen.getByLabelText("外部 repo（owner/name 形式）") as HTMLInputElement).value,
    ).toBe("other-org/some-repo");
  });
});

describe("JotDialog — 起票成功時の消去", () => {
  it("起票成功後は jot 本文と外部 repo 入力の両方が消去される", async () => {
    vi.useFakeTimers();
    const onSuccess = vi.fn();
    // 実サーバーと同じ SSE シーケンス（formatting → creating → done）
    const sse = [
      'event: formatting\ndata: {}\n\n',
      'event: creating\ndata: {}\n\n',
      `event: done\ndata: ${JSON.stringify(doneResult)}\n\n`,
    ].join("");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(sse, { headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setup({ repo: "t-miura-024/note", onSuccess });

    fillJot("消える jot");
    fireEvent.change(screen.getByLabelText("外部 repo（owner/name 形式）"), {
      target: { value: "other-org/some-repo" },
    });
    await clickSubmit();

    // オーバーレイの成功シーケンス（紙飛行機ループ → 飛び立ち → 合図）を完走させる。
    // 各タイマーが React の commit を挟んで次段のタイマーを予約するため、
    // act をまたいでチャンク進行させる。
    const chunks = [600, 500, 400, 500, 1000, 1400, 1200, 2000];
    for (const ms of chunks) {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
      if (onSuccess.mock.calls.length > 0) break;
    }

    expect(onSuccess).toHaveBeenCalledWith(doneResult);
    expect((screen.getByLabelText("jot 本文") as HTMLTextAreaElement).value).toBe("");
    expect(
      (screen.getByLabelText("外部 repo（owner/name 形式）") as HTMLInputElement).value,
    ).toBe("");
  });
});
