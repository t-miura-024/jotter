/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { SubmitResult } from "../../shared/submit";
import { ResultDialog } from "./result-dialog";

const result: SubmitResult = {
  number: 7,
  title: "タイトル",
  url: "https://github.com/t-miura-024/note/issues/7",
  repo: "t-miura-024/note",
  body: "本文",
  modelUsed: "gemini-flash-lite-latest",
  fallbacks: [],
  projectAdded: true,
};

function setup(overrides: Partial<SubmitResult> = {}) {
  render(<ResultDialog open onOpenChange={vi.fn()} result={{ ...result, ...overrides }} />);
}

afterEach(cleanup);

describe("ResultDialog — フォールバック履歴", () => {
  it("通常成功ではフォールバック表示を出さない", () => {
    setup();
    expect(screen.queryByText(/フォールバック発生/)).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByText("本文")).toBeTruthy();
  });

  it.each([1, 2])("%i 件の失敗を native details の折りたたみで試行順に表示する", (count) => {
    const fallbacks = [
      { model: "gemini-pro-latest", status: 429, message: "Resource exhausted" },
      { model: "gemini-flash-latest", status: 503, message: "High demand" },
    ].slice(0, count);
    setup({ fallbacks });
    const details = document.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(details.open).toBe(false);
    expect(summary.textContent).toBe(
      `フォールバック発生（${count} 件失敗）: gemini-flash-lite-latest を使用しました`,
    );
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    const list = within(details).getByRole("list");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(fallbacks.map(({ model, status, message }) => `${model}: ${status} ${message}`));
    expect(list.textContent).not.toContain(result.modelUsed);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("メッセージを HTML として解釈せず文字列で表示する", () => {
    const message = '<img src=x onerror="alert(1)">';
    setup({ fallbacks: [{ model: "gemini-pro-latest", status: 500, message }] });
    const details = document.querySelector("details")!;
    expect(details.textContent).toContain(message);
    expect(details.querySelector("img")).toBeNull();
  });

  it("フォールバックなしでも Project 連携の既存表示を維持する", () => {
    setup({ projectAdded: false });
    expect(screen.getByText(/Project 連携をスキップしました/)).toBeTruthy();
    expect(document.querySelector("details")).toBeNull();
  });
});
