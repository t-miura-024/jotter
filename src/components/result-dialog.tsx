import { ExternalLink, TriangleAlert } from "lucide-react";

import { MarkdownBody } from "@/components/markdown-body";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SubmitResult = {
  number: number;
  title: string;
  url: string;
  repo: string;
  body: string;
  modelUsed: string;
  fallbackOccurred: boolean;
  projectAdded: boolean;
};

type ResultDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: SubmitResult | null;
};

export function ResultDialog({ open, onOpenChange, result }: ResultDialogProps) {
  if (!result) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{result.title}</DialogTitle>
          <DialogDescription asChild>
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
            >
              <span className="font-mono text-xs break-all">{result.url}</span>
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
          <MarkdownBody markdown={result.body} />
        </div>

        {(result.fallbackOccurred || !result.projectAdded) && (
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {result.fallbackOccurred && (
              <p className="flex items-center gap-1.5">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                フォールバック発生: <span className="font-mono">{result.modelUsed}</span>{" "}
                を使用しました。
              </p>
            )}
            {!result.projectAdded && (
              <p className="flex items-center gap-1.5">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                Project 連携をスキップしました（secret 未設定または連携失敗）。
              </p>
            )}
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
