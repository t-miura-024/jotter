import { PLAN_GROUP_ORDER } from "@/lib/plan-status";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * plan list のスケルトン。実レイアウト（5グループ + 各2行）に同型で
 * レイアウトシフトを防ぐ（grill-map R2-Q6）。
 */
export function PlanListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-5">
      <span role="status" className="sr-only">
        計画一覧を読み込み中…
      </span>
      {PLAN_GROUP_ORDER.map((status) => (
        <section key={status} className="flex flex-col gap-1.5">
          {/* 見出しスケルトン: アイコン円 + label 矩形 + 件数矩形 */}
          <div className="flex items-center gap-1.5 px-0.5">
            <Skeleton className="size-3.5 shrink-0 rounded-full" aria-hidden />
            <Skeleton className="h-3 w-[60px]" aria-hidden />
            <Skeleton className="h-3 w-4" aria-hidden />
          </div>
          {/* 行スケルトン: # + title + 日付 の3要素を1行として再現 */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <ul className="divide-y" aria-hidden>
              {[0, 1].map((row) => (
                <li key={row} className="flex items-center gap-2.5 px-3 py-2.5">
                  <Skeleton className="h-3 w-10 shrink-0" />
                  <Skeleton className="h-4 flex-1" style={{ width: row === 0 ? "78%" : "62%" }} />
                  <Skeleton className="h-3 w-14 shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
