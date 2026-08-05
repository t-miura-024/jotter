/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import {
  MobileRepoButton,
  RepoDrawer,
  RepoSidebar,
  type RepoNavProps,
} from "./repo-nav";

afterEach(() => {
  cleanup();
});

const REPOS = [
  { owner: "t-miura-024", name: "tools", fullName: "t-miura-024/tools" },
  { owner: "t-miura-024", name: "note", fullName: "t-miura-024/note" },
  { owner: "t-miura-024", name: "alpha", fullName: "t-miura-024/alpha" },
];

const STATS = [
  {
    owner: "t-miura-024",
    name: "note",
    fullName: "t-miura-024/note",
    counts: { draft: 2, refined: 0, "in-progress": 1, done: 0, unregistered: 3 },
  },
  {
    owner: "t-miura-024",
    name: "tools",
    fullName: "t-miura-024/tools",
    counts: { draft: 0, refined: 0, "in-progress": 0, done: 0, unregistered: 0 },
  },
];

function baseProps(overrides: Partial<RepoNavProps> = {}): RepoNavProps {
  return {
    repos: REPOS,
    stats: STATS,
    statsLoading: false,
    selected: "t-miura-024/note",
    onSelect: vi.fn(),
    onRetryStats: vi.fn(),
    ...overrides,
  };
}

describe("RepoSidebar（PC 固定左 sidebar）", () => {
  it("内部 repo だけを note inbox 先頭 + アルファベット順で並べる", () => {
    render(<RepoSidebar {...baseProps()} />);

    const buttons = screen.getAllByRole("button", { name: /^(note|alpha|tools)/ });
    const names = buttons.map((button) =>
      within(button).getByText(/^(note|alpha|tools)/).textContent,
    );
    expect(names).toEqual(["note", "alpha", "tools"]);
  });

  it("repo 行全体が選択可能で、クリックで onSelect に fullName を渡す", () => {
    const onSelect = vi.fn();
    render(<RepoSidebar {...baseProps({ onSelect })} />);

    const tools = screen.getByRole("button", { name: /^tools/ });
    fireEvent.click(tools);

    expect(onSelect).toHaveBeenCalledWith("t-miura-024/tools");
  });

  it("選択中の repo 行に aria-current を付ける", () => {
    render(<RepoSidebar {...baseProps({ selected: "t-miura-024/tools" })} />);

    const tools = screen.getByRole("button", { name: /^tools/ });
    expect(tools.getAttribute("aria-current")).toBe("true");
    const note = screen.getByRole("button", { name: /^note/ });
    expect(note.getAttribute("aria-current")).toBeNull();
  });

  it("5 件数を PlanList と同じ順序・アイコンで表示し、0 件は薄い色で判別できる", () => {
    const { container } = render(<RepoSidebar {...baseProps()} />);

    const note = screen.getByRole("button", { name: /^note/ });
    expect(within(note).getByText("2")).toBeTruthy();
    expect(within(note).getByText("1")).toBeTruthy();
    expect(within(note).getByText("3")).toBeTruthy();

    // 0 件セルは opacity-40（薄い色）が付く
    const zeroCells = container.querySelectorAll("[class*='opacity-40']");
    expect(zeroCells.length).toBeGreaterThan(0);

    // note 行の 0 件セル（refined / done）が薄くなっている
    const noteZeroCells = within(note).getAllByText("0", { selector: "span" });
    expect(noteZeroCells.length).toBeGreaterThan(0);
    for (const cell of noteZeroCells) {
      expect(cell.parentElement?.className).toContain("opacity-40");
    }
  });

  it("stats 取得失敗時は全件数を – で縮退表示し、再取得導線を表示する", () => {
    const onRetryStats = vi.fn();
    render(<RepoSidebar {...baseProps({ stats: null, onRetryStats })} />);

    // 件数の代わりに – を表示
    const dashes = screen.getAllByText("–");
    expect(dashes.length).toBe(REPOS.length);

    // 再取得ボタンで stats だけを再取得できる
    const retry = screen.getByRole("button", { name: "件数を再取得" });
    fireEvent.click(retry);
    expect(onRetryStats).toHaveBeenCalledTimes(1);
  });

  it("stats 取得中は – ではなく … を表示し、再取得導線は出さない", () => {
    render(<RepoSidebar {...baseProps({ stats: null, statsLoading: true })} />);

    expect(screen.getAllByText("…").length).toBe(REPOS.length);
    expect(screen.queryByRole("button", { name: "件数を再取得" })).toBeNull();
  });
});

describe("MobileRepoButton / RepoDrawer（モバイル drawer）", () => {
  it("上部ボタンに選択中 repo 名とメニューアイコンを表示し、クリックで開く", () => {
    const onClick = vi.fn();
    render(<MobileRepoButton selected="t-miura-024/note" reposLoading={false} onClick={onClick} />);

    const button = screen.getByRole("button", { name: "リポジトリを選択" });
    expect(within(button).getByText("note")).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("drawer を開くと内部 repo が並び、repo 選択後に自動で閉じる", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RepoDrawer
        {...baseProps({ onSelect })}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    // drawer 内の repo 行（閉じるボタン・見出しを除外）
    const tools = screen.getByRole("button", { name: /^tools/ });
    fireEvent.click(tools);

    expect(onSelect).toHaveBeenCalledWith("t-miura-024/tools");
    // 選択後はドロワーが自動で閉じる（onOpenChange(false)）
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("drawer の閉じるボタンで閉じられる", () => {
    const onOpenChange = vi.fn();
    render(
      <RepoDrawer
        {...baseProps()}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "ドロワーを閉じる" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("drawer 内でも stats 縮退時は – と再取得導線を表示する", () => {
    const onRetryStats = vi.fn();
    render(
      <RepoDrawer
        {...baseProps({ stats: null, onRetryStats })}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText("–").length).toBe(REPOS.length);
    fireEvent.click(screen.getByRole("button", { name: "件数を再取得" }));
    expect(onRetryStats).toHaveBeenCalledTimes(1);
  });
});
