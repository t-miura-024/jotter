import type { PlanItem, PlanStatus } from "@/lib/plans";
import { PLAN_GROUP_ORDER, PLAN_STATUS_META } from "@/lib/plan-status";
import { cn } from "@/lib/utils";

type PlanListProps = {
  plans: PlanItem[];
  onSelect: (plan: PlanItem) => void;
};

/**
 * 計画一覧の Status 別グルーピング表示。
 * 5 グループ（draft / refined / in-progress / done / 未登録）を常に描画し、
 * 空グループは「なし」と表示する。
 * 表示定義（順序・アイコン・色）は repo sidebar と共有する（lib/plan-status）。
 */
export function PlanList({ plans, onSelect }: PlanListProps) {
  const grouped = new Map<PlanStatus, PlanItem[]>(
    PLAN_GROUP_ORDER.map((status) => [status, []]),
  );
  for (const plan of plans) {
    // API は常に 5 値のいずれかを返すが、未知の値は防御的に未登録へ入れる。
    const key = grouped.has(plan.status) ? plan.status : "unregistered";
    grouped.get(key)!.push(plan);
  }

  return (
    <div className="flex flex-col gap-5">
      {PLAN_GROUP_ORDER.map((status) => {
        const items = grouped.get(status)!;
        const { Icon, iconClass, label } = PLAN_STATUS_META[status];
        return (
          <section key={status} className="flex flex-col gap-1.5">
            <h2 className="flex items-center gap-1.5 px-0.5 text-xs font-semibold text-muted-foreground">
              <Icon aria-hidden className={cn("size-3.5 shrink-0", iconClass)} />
              <span className="font-mono uppercase tracking-wide">{label}</span>
              <span className="font-mono text-[11px] tabular-nums">{items.length}</span>
            </h2>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                なし
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {items.map((plan) => (
                  <li key={plan.number}>
                    <button
                      type="button"
                      onClick={() => onSelect(plan)}
                      className="flex w-full items-baseline gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        #{plan.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{plan.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {plan.updatedAt.slice(0, 10)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
