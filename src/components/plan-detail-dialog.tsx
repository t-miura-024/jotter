import { ExternalLink } from "lucide-react";

import { MarkdownBody } from "@/components/markdown-body";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanItem } from "@/lib/plans";

type PlanDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** プレビューする計画（直前に選択した計画を閉じるまで保持する）。 */
  plan: PlanItem | null;
};

/**
 * 計画詳細モーダル。Issue 本文を Markdown プレビュー表示する（参照のみ）。
 * 編集・削除などの mutation 機能は意図的に持たせない。
 */
export function PlanDetailDialog({ open, onOpenChange, plan }: PlanDetailDialogProps) {
  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{plan.title}</DialogTitle>
          <DialogDescription asChild>
            <a
              href={plan.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
            >
              <span className="font-mono text-xs break-all">{plan.url}</span>
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
          <MarkdownBody markdown={plan.body} />
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
