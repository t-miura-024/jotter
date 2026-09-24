import type { Monologue } from "../../shared/monologue";
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
 * Monologue のカード表示（日付＋タイトル＋本文＋note/GCバッジ全出し）。
 * 詳細モーダルは持たない（shared/monologue.ts の Monologue 定義と対応）。
 */
export function MonologueCard({ monologue }: { monologue: Monologue }) {
  const gcBodyMismatch =
    monologue.sources.google &&
    monologue.gcBody !== undefined &&
    monologue.gcBody.trim().length > 0 &&
    monologue.gcBody.trim() !== monologue.body.trim();
  return (
    <article className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {monologue.date} {monologue.time ?? "--:--"}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{monologue.title}</h3>
        <SourceBadge label="note" present={monologue.sources.note} />
        <SourceBadge label="GC" present={monologue.sources.google} />
      </div>
      {monologue.body.trim().length > 0 && (
        <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
          {monologue.body}
        </p>
      )}
      {gcBodyMismatch && (
        <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground/80">
          <span className="font-mono">[GC] </span>
          {monologue.gcBody}
        </p>
      )}
    </article>
  );
}
