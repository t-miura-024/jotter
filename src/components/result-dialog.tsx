import { ExternalLink, TriangleAlert } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
          <div className="prose-sm max-w-none text-sm leading-relaxed [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4 [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1">
            <Markdown remarkPlugins={[remarkGfm]}>{result.body}</Markdown>
          </div>
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
