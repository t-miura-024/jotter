import { ClipboardList, MessageCircle } from "lucide-react";

import type { ViewSelection } from "@/lib/view-selection";
import { cn } from "@/lib/utils";

type MobileFooterProps = {
  /** 現在の表示（plan / monologue）。 */
  activeView: ViewSelection;
  onChange: (view: ViewSelection) => void;
};

/**
 * モバイルの画面下フッター（PC では非表示）。Plan / Monologue の切替だけを持つ。
 *
 * - `fixed bottom-0` で画面下に固定し、safe-area 分を下パディングに足す。
 * - App 側で一覧末尾にフッター高さ分の余白（pb-24）と FAB の底上げを行う。
 */
export function MobileFooter({ activeView, onChange }: MobileFooterProps) {
  return (
    <nav
      aria-label="表示切替"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden"
    >
      <div className="flex gap-1 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <FooterButton
          active={activeView === "plan"}
          onClick={() => onChange("plan")}
          icon={<ClipboardList aria-hidden className="size-4 shrink-0" />}
          label="Plan"
        />
        <FooterButton
          active={activeView === "monologue"}
          onClick={() => onChange("monologue")}
          icon={<MessageCircle aria-hidden className="size-4 shrink-0" />}
          label="Monologue"
        />
      </div>
    </nav>
  );
}

function FooterButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
