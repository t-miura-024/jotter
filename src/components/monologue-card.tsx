import type { Monologue } from "../../shared/monologue";
import { MarkdownBody } from "@/components/markdown-body";
import { cn } from "@/lib/utils";

function SourceBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      aria-label={`${label}${present ? "あり" : "なし"}`}
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none",
        present
          ? "bg-primary text-primary-foreground"
          : "border border-dashed text-muted-foreground opacity-70",
      )}
    >
      {label}
    </span>
  );
}

/**
 * Monologue のカード表示（日付＋バッジ行＋タイトル＋本文＋差分注記の全出し）。
 * タイトル・本文は Markdown 表示し、タイトルは折り返しで省略しない。
 * 詳細モーダルは持たない（shared/monologue.ts の Monologue 定義と対応）。
 */
export function MonologueCard({ monologue }: { monologue: Monologue }) {
  return (
    <article className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {monologue.date} {monologue.time ?? "--:--"}
        </span>
        <span className="min-w-0 flex-1" />
        <SourceBadge label="note" present={monologue.sources.note} />
        <SourceBadge label="GC" present={monologue.sources.google} />
      </div>
      {monologue.title.trim().length > 0 && (
        <div className="text-sm font-medium break-words">
          <MarkdownBody markdown={monologue.title} />
        </div>
      )}
      {monologue.body.trim().length > 0 && (
        <div className="break-words">
          <MarkdownBody markdown={monologue.body} />
        </div>
      )}
      {monologue.hasBodyDifference && (
        <p className="text-xs text-muted-foreground">本文に差分があります・noteを採用しています</p>
      )}
    </article>
  );
}
