import { MonologueCard } from "@/components/monologue-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Monologue } from "../../shared/monologue";

/**
 * Monologue 一覧の新しい順カード表示。
 * 空状態は PlanList の空グループ表示（「なし」系）を踏襲する。
 */
export function MonologueList({ monologues }: { monologues: Monologue[] }) {
  if (monologues.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        この月の Monologue はありません
      </p>
    );
  }
  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card">
      {monologues.map((monologue, index) => (
        <li key={`${monologue.date}-${monologue.title}-${monologue.time ?? ""}-${index}`}>
          <MonologueCard monologue={monologue} />
        </li>
      ))}
    </ul>
  );
}

/** Monologue 一覧のスケルトン。実レイアウト（カード 3 件）に同型でレイアウトシフトを防ぐ。 */
export function MonologueListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
      <span role="status" className="sr-only">
        Monologue一覧を読み込み中…
      </span>
      <div className="overflow-hidden rounded-lg border bg-card">
        <ul className="divide-y" aria-hidden>
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-24 shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-8 shrink-0 rounded-full" />
              </div>
              <Skeleton
                className="h-3"
                style={{ width: row === 0 ? "72%" : row === 1 ? "55%" : "64%" }}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
