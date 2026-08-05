import { CircleCheck, CircleQuestionMark, Hammer, Sparkles, Sprout } from "lucide-react";

/**
 * Status の表示定義（PlanList と repo sidebar で共有）。
 * 順序・アイコン・色は PlanList と同じものを sidebar の件数表示にも使い、
 * 意味や見た目がずれないようにする（ADR 0010 方針）。
 */

/** Status 別 5 グループの表示順（ライフサイクル順 + 未登録）。 */
export const PLAN_GROUP_ORDER = [
  "draft",
  "refined",
  "in-progress",
  "done",
  "unregistered",
] as const;

export type PlanStatus = (typeof PLAN_GROUP_ORDER)[number];

/** Status 別の表示メタ（label / アイコン / アイコンカラー）。 */
export const PLAN_STATUS_META: Record<
  PlanStatus,
  { label: string; Icon: typeof Sprout; iconClass: string }
> = {
  draft: {
    label: "draft",
    Icon: Sprout,
    iconClass: "text-teal-600 dark:text-teal-400",
  },
  refined: {
    label: "refined",
    Icon: Sparkles,
    iconClass: "text-violet-600 dark:text-violet-400",
  },
  "in-progress": {
    label: "in-progress",
    Icon: Hammer,
    iconClass: "text-amber-600 dark:text-amber-500",
  },
  done: {
    label: "done",
    Icon: CircleCheck,
    iconClass: "text-green-600 dark:text-green-400",
  },
  unregistered: {
    label: "未登録",
    Icon: CircleQuestionMark,
    iconClass: "text-rose-500 dark:text-rose-400",
  },
};
