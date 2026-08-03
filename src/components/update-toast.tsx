import { RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRegisterSW } from "virtual:pwa-register/react";

import { Button } from "@/components/ui/button";

/**
 * Service Worker を登録し（registerType: prompt）、新バージョンのデプロイを
 * 検知したときにリロードを促すトーストを表示する。サイレント自動更新はしない。
 * オフラインキューイング等の永続化状態は一切持たない（ADR 0006）。
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          key="update"
          role="status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-full max-w-md items-center gap-2 rounded-lg border bg-card px-4 py-3 shadow-lg"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">新しいバージョンがあります。</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              リロードすると更新が適用されます。
            </p>
          </div>
          <Button size="sm" onClick={() => void updateServiceWorker(true)}>
            <RefreshCw aria-hidden />
            リロード
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="閉じる"
            onClick={() => setNeedRefresh(false)}
          >
            <X aria-hidden />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
