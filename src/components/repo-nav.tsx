import { LoaderCircle, Menu, RefreshCw, X } from "lucide-react";

import { PLAN_GROUP_ORDER, PLAN_STATUS_META } from "@/lib/plan-status";
import type { RepoStatsEntry } from "@/lib/repo-stats";
import { NOTE_INBOX } from "@/lib/target";
import { orderReposForNav, type RepoNavEntry } from "@/lib/repo-selection";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * repo sidebar / mobile drawer の共通ナビゲーション（ADR 0010）。
 *
 * - 内部 repo だけを並べ、note inbox が先頭・残りはアルファベット順。
 * - 各 repo 行に draft / refined / in-progress / done / unregistered の 5 件数を
 *   PlanList と同じアイコン・色で常時表示し、0 件は薄い色で判別できる。
 *   件数表示自体は選択・絞り込み・スクロール操作を持たない。
 * - stats 取得失敗時は全件数を – で縮退表示し、件数の再取得導線（リトライ）を出す。
 */

export type RepoNavProps = {
  /** 内部 repo 一覧（/api/repos）。 */
  repos: RepoNavEntry[];
  /** repo stats（null = 未取得または取得失敗 → 件数を – で表示）。 */
  stats: RepoStatsEntry[] | null;
  /** stats 取得中かどうか（取得中は – の代わりに … を表示）。 */
  statsLoading: boolean;
  /** 選択中の内部 repo fullName。 */
  selected: string;
  onSelect: (fullName: string) => void;
  /** stats だけを再取得する導線（sidebar のリトライボタン）。 */
  onRetryStats: () => void;
};

/** 1 件分の件数表示。0 件は薄くして判別できるようにする（選択・絞り込み操作は持たない）。 */
function StatusCounts({ counts }: { counts: RepoStatsEntry["counts"] }) {
  return (
    <span className="flex items-center gap-1.5">
      {PLAN_GROUP_ORDER.map((status) => {
        const { Icon, iconClass } = PLAN_STATUS_META[status];
        const value = counts[status];
        return (
          <span
            key={status}
            className={cn(
              "flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground",
              value === 0 && "opacity-40",
            )}
          >
            <Icon aria-hidden className={cn("size-3 shrink-0", iconClass)} />
            <span>{value}</span>
          </span>
        );
      })}
    </span>
  );
}

function RepoNavContent({
  repos,
  stats,
  statsLoading,
  selected,
  onSelect,
  onRetryStats,
}: RepoNavProps) {
  const ordered = orderReposForNav(repos);
  const statsFailed = stats === null && !statsLoading;

  return (
    <nav aria-label="リポジトリ選択" className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold text-muted-foreground">Repos</h2>
        {statsFailed && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="件数を再取得"
            title="件数を再取得"
            onClick={onRetryStats}
          >
            <RefreshCw aria-hidden />
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {ordered.map((repo) => {
          const entry = stats?.find((item) => item.fullName === repo.fullName) ?? null;
          const isSelected = repo.fullName === selected;
          return (
            <li key={repo.fullName}>
              <button
                type="button"
                onClick={() => onSelect(repo.fullName)}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left transition-colors",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/60",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-xs font-medium">
                    {repo.fullName}
                  </span>
                  {repo.fullName === NOTE_INBOX && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] text-primary">
                      inbox
                    </span>
                  )}
                </span>
                {entry ? (
                  <StatusCounts counts={entry.counts} />
                ) : (
                  <span
                    aria-hidden
                    className="font-mono text-[10px] text-muted-foreground"
                  >
                    {statsLoading ? "…" : "–"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** PC の固定左 sidebar（モバイルでは非表示）。 */
export function RepoSidebar({ className, ...props }: RepoNavProps & { className?: string }) {
  return (
    <aside className={cn("hidden w-60 shrink-0 md:block", className)}>
      <div className="rounded-xl border bg-card p-2.5 md:sticky md:top-16">
        <RepoNavContent {...props} />
      </div>
    </aside>
  );
}

/** モバイルの plan list 上部ボタン（選択中 repo 名 + メニューアイコン）。 */
export function MobileRepoButton({
  selected,
  reposLoading,
  onClick,
}: {
  selected: string;
  reposLoading: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      className="min-w-0 flex-1 justify-between md:hidden"
      aria-label="リポジトリを選択"
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Menu aria-hidden className="size-4 shrink-0" />
        <span className="truncate font-mono text-sm">{selected || NOTE_INBOX}</span>
      </span>
      {reposLoading && (
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
      )}
    </Button>
  );
}

/** モバイルの左ドロワー（選択後は自動で閉じる）。 */
export function RepoDrawer({
  open,
  onOpenChange,
  onSelect,
  ...navProps
}: RepoNavProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-y-0 left-0 m-0 h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 items-start gap-3 overflow-y-auto rounded-none bg-background p-3 sm:max-w-[85vw] md:hidden"
      >
        <div className="flex w-full items-center justify-between">
          <DialogTitle className="font-heading text-sm">リポジトリ</DialogTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="ドロワーを閉じる"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden />
          </Button>
        </div>
        <div className="w-full">
          <RepoNavContent
            {...navProps}
            onSelect={(fullName) => {
              onSelect(fullName);
              onOpenChange(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
