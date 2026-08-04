import { useCallback, useEffect, useRef, useState } from "react";

import { CircleAlert, LoaderCircle, PenLine, RefreshCw, RotateCcw } from "lucide-react";
import { motion } from "motion/react";

import { JotDialog } from "@/components/jot-dialog";
import { PlanDetailDialog } from "@/components/plan-detail-dialog";
import { PlanList } from "@/components/plan-list";
import { REPO_OTHER_VALUE, RepoSelector } from "@/components/repo-selector";
import { ResultDialog, type SubmitResult } from "@/components/result-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthExpiredPanel } from "@/components/auth-expired-panel";
import { Button } from "@/components/ui/button";
import { UpdateToast } from "@/components/update-toast";
import { AuthExpiredError } from "@/lib/api";
import {
  fetchPlans,
  getCachedPlans,
  invalidatePlansCache,
  type PlanItem,
} from "@/lib/plans";

type PlansState =
  | { status: "loading" }
  | { status: "ready"; plans: PlanItem[] }
  | { status: "error"; message: string; authExpired: boolean };

/** repo 選択の localStorage キー（キー名は AI 判断範囲で決定）。 */
const REPO_STORAGE_KEY = "jotter-repo-selection";

/** 「その他（自由入力）」モードの一覧読み込み debounce 時間（ms）。キーストローク毎の fetch を防ぐ。 */
const OTHER_REPO_DEBOUNCE_MS = 300;

/**
 * 上部プルダウンの選択状態。
 * selection: ""（指定しない）| "owner/name" | REPO_OTHER_VALUE（その他）。
 */
type RepoSelection = {
  selection: string;
  otherRepo: string;
};

/** 初回訪問（未保存・破損）は「指定しない（note inbox へ）」を選択する。 */
function readStoredRepoSelection(): RepoSelection {
  try {
    const raw = localStorage.getItem(REPO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RepoSelection>;
      if (typeof parsed.selection === "string" && typeof parsed.otherRepo === "string") {
        return { selection: parsed.selection, otherRepo: parsed.otherRepo };
      }
    }
  } catch {
    // localStorage 利用不可（プライベートモード等）は既定選択にフォールバック。
  }
  return { selection: "", otherRepo: "" };
}

const MotionButton = motion.create(Button);

export default function App() {
  const [repoSelection, setRepoSelection] = useState<RepoSelection>(readStoredRepoSelection);
  const [plansState, setPlansState] = useState<PlansState>({ status: "loading" });
  const [detailPlan, setDetailPlan] = useState<PlanItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [jotOpen, setJotOpen] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  /** 上部プルダウンの選択に連動した起票先（API に送る repo 文字列）。 */
  const repo =
    repoSelection.selection === REPO_OTHER_VALUE ? repoSelection.otherRepo : repoSelection.selection;

  // 選択状態を localStorage へ永続化（ページを開いたときの復元用）。
  useEffect(() => {
    try {
      localStorage.setItem(REPO_STORAGE_KEY, JSON.stringify(repoSelection));
    } catch {
      // 永続化できなくても当セッションの選択は維持される。
    }
  }, [repoSelection]);

  // repo 切り替え競合のガード用（最後に開始した取得のみ状態へ反映する）。
  const loadSeq = useRef(0);

  const loadPlans = useCallback(async (repoKey: string, force: boolean) => {
    const seq = ++loadSeq.current;

    // クライアント側メモリキャッシュ: リフレッシュ押下または起票成功まで再 fetch しない。
    if (!force) {
      const cached = getCachedPlans(repoKey);
      if (cached) {
        setPlansState({ status: "ready", plans: cached });
        return;
      }
    }

    setPlansState({ status: "loading" });
    try {
      const plans = await fetchPlans(repoKey);
      if (loadSeq.current === seq) {
        setPlansState({ status: "ready", plans });
      }
    } catch (error) {
      if (loadSeq.current === seq) {
        setPlansState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
          authExpired: error instanceof AuthExpiredError,
        });
      }
    }
  }, []);

  // repo 切り替え時に一覧を読み込む。「その他（自由入力）」モードはキーストロークごとに
  // otherRepo が変化し、中間文字列は毎回新規キャッシュキーになるため、debounce して
  // キーストローク毎の fetch を防ぐ（入力停止後に 1 回だけ fetch する）。
  // セレクト切り替え等の一過性の変更は即時読み込む。
  useEffect(() => {
    const delay = repoSelection.selection === REPO_OTHER_VALUE ? OTHER_REPO_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => {
      void loadPlans(repo, false);
    }, delay);
    return () => clearTimeout(timer);
  }, [repo, loadPlans, repoSelection.selection]);

  function openPlan(plan: PlanItem): void {
    setDetailPlan(plan);
    setDetailOpen(true);
  }

  /** 起票成功: ResultDialog を表示し、キャッシュを破棄して一覧を再取得する。 */
  function handleJotSuccess(submitResult: SubmitResult): void {
    setJotOpen(false);
    setResult(submitResult);
    setResultOpen(true);
    invalidatePlansCache();
    void loadPlans(repo, true);
  }

  const loading = plansState.status === "loading";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 pb-28 sm:py-16">
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex items-start justify-between gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <PenLine aria-hidden className="size-5 text-primary" />
            <h1 className="font-heading text-2xl font-extrabold tracking-tighter">
              Jotter<span className="text-primary">.</span>
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            選択した repo のアクティブな計画 Issue を Project の Status 別に表示します。
          </p>
        </div>
        <ThemeToggle />
      </motion.header>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RepoSelector
            selection={repoSelection.selection}
            otherRepo={repoSelection.otherRepo}
            onSelectionChange={(selection) =>
              setRepoSelection((prev) => ({ ...prev, selection }))
            }
            onOtherRepoChange={(otherRepo) =>
              setRepoSelection((prev) => ({ ...prev, otherRepo }))
            }
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="一覧をリフレッシュ"
          title="一覧をリフレッシュ"
          disabled={loading}
          onClick={() => void loadPlans(repo, true)}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>

      {plansState.status === "loading" && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-6 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          計画一覧を読み込み中…
        </div>
      )}

      {plansState.status === "error" &&
        (plansState.authExpired ? (
          <AuthExpiredPanel />
        ) : (
          <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
            <div className="flex items-start gap-2">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">計画一覧の取得に失敗しました。</p>
                <p className="mt-0.5 text-xs break-all text-muted-foreground">
                  {plansState.message}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => void loadPlans(repo, true)}>
                <RotateCcw aria-hidden />
                リトライ
              </Button>
            </div>
          </div>
        ))}

      {plansState.status === "ready" && (
        <PlanList plans={plansState.plans} onSelect={openPlan} />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
        <MotionButton
          size="lg"
          className="pointer-events-auto rounded-full px-6 shadow-md"
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          onClick={() => setJotOpen(true)}
        >
          <PenLine aria-hidden />
          新しい jot
        </MotionButton>
      </div>

      <PlanDetailDialog plan={detailPlan} open={detailOpen} onOpenChange={setDetailOpen} />

      <JotDialog open={jotOpen} onOpenChange={setJotOpen} repo={repo} onSuccess={handleJotSuccess} />

      <ResultDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={result}
      />

      <UpdateToast />
    </main>
  );
}
