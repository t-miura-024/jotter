import { LogIn, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Access ログイン URL へ移動して再認証する。 */
function relogin(): void {
  // /api/* は SW の navigateFallbackDenylist のためネットワーク直通でログイン画面が表示される。
  window.location.href = "/api/repos";
}

/** セッション切れ（Cloudflare Access）を通知し、再ログインへ誘導するパネル。 */
export function AuthExpiredPanel() {
  return (
    <div role="alert" className="rounded-lg border border-border bg-muted px-4 py-3">
      <div className="flex items-start gap-2">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">セッションが切れています。</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cloudflare Access で再認証すると、続きから利用できます。
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex justify-end">
        <Button variant="outline" size="sm" onClick={relogin}>
          <LogIn aria-hidden />
          再ログイン
        </Button>
      </div>
    </div>
  );
}