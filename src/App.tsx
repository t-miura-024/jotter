import { useCallback, useEffect, useRef, useState } from "react";

import { CircleAlert, LoaderCircle, PenLine, RefreshCw, RotateCcw } from "lucide-react";
import { motion } from "motion/react";

import { JotDialog } from "@/components/jot-dialog";
import { PlanDetailDialog } from "@/components/plan-detail-dialog";
import { PlanList } from "@/components/plan-list";
import { MobileRepoButton, RepoDrawer, RepoSidebar } from "@/components/repo-nav";
import { ResultDialog, type SubmitResult } from "@/components/result-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthExpiredPanel } from "@/components/auth-expired-panel";
import { Button } from "@/components/ui/button";
import { UpdateToast } from "@/components/update-toast";
import { AuthExpiredError, apiFetch } from "@/lib/api";
import {
  fetchPlans,
  getCachedPlans,
  invalidatePlansCache,
  type PlanItem,
} from "@/lib/plans";
import {
  fetchRepoStats,
  getCachedRepoStats,
  invalidateRepoStatsCache,
  type RepoStatsResponse,
} from "@/lib/repo-stats";
import {
  persistRepoSelection,
  readStoredRepoSelection,
  type RepoNavEntry,
} from "@/lib/repo-selection";

type PlansState =
  | { status: "loading" }
  | { status: "ready"; plans: PlanItem[] }
  | { status: "error"; message: string; authExpired: boolean };

type ReposState =
  | { status: "loading" }
  | { status: "ready"; repos: RepoNavEntry[] }
  | { status: "error" };

type StatsState =
  | { status: "loading" }
  | { status: "ready"; stats: RepoStatsResponse }
  | { status: "error"; message: string };

const MotionButton = motion.create(Button);

export default function App() {
  // 選択中の内部 repo（fullName）。旧選択値は初回読込時に移行される（ADR 0010）。
  const [selectedRepo, setSelectedRepo] = useState<string>(() =>
    readStoredRepoSelection(window.localStorage),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reposState, setReposState] = useState<ReposState>({ status: "loading" });
  const [statsState, setStatsState] = useState<StatsState>({ status: "loading" });
  const [plansState, setPlansState] = useState<PlansState>({ status: "loading" });
  const [detailPlan, setDetailPlan] = useState<PlanItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [jotOpen, setJotOpen] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  // 選択状態を localStorage へ永続化（ページを開いたときの復元用）。
  useEffect(() => {
    persistRepoSelection(window.localStorage, selectedRepo);
  }, [selectedRepo]);

  // repo 一覧は独立して読み込む（stats 障害で navigation を失わせない、ADR 0011）。
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/repos")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ repos: RepoNavEntry[] }>;
      })
      .then((data) => {
        if (!cancelled) setReposState({ status: "ready", repos: data.repos });
      })
      .catch(() => {
        if (!cancelled) setReposState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // repo stats も独立して読み込む。通常表示はサーバーキャッシュを利用する。
  const loadStats = useCallback(async (force: boolean) => {
    if (!force) {
      const cached = getCachedRepoStats();
      if (cached) {
        setStatsState({ status: "ready", stats: cached });
        return;
      }
    }
    setStatsState({ status: "loading" });
    try {
      const stats = await fetchRepoStats(force);
      setStatsState({ status: "ready", stats });
    } catch (error) {
      setStatsState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void loadStats(false);
  }, [loadStats]);

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

  // repo 切り替え時に一覧を読み込む。
  useEffect(() => {
    void loadPlans(selectedRepo, false);
  }, [selectedRepo, loadPlans]);

  function openPlan(plan: PlanItem): void {
    setDetailPlan(plan);
    setDetailOpen(true);
  }

  /** 手動リフレッシュ: plan list と repo stats の双方を cache bypass で強制更新する。 */
  function handleRefresh(): void {
    invalidatePlansCache();
    invalidateRepoStatsCache();
    void loadPlans(selectedRepo, true);
    void loadStats(true);
  }

  /** stats だけを再取得する（sidebar の再取得導線）。 */
  function handleRetryStats(): void {
    invalidateRepoStatsCache();
    void loadStats(true);
  }

  /** 起票成功: ResultDialog を表示し、plan list と repo stats の双方を再取得して表示を同期する。 */
  function handleJotSuccess(submitResult: SubmitResult): void {
    setJotOpen(false);
    setResult(submitResult);
    setResultOpen(true);
    invalidatePlansCache();
    invalidateRepoStatsCache();
    void loadPlans(selectedRepo, true);
    void loadStats(true);
  }

  const loading = plansState.status === "loading";
  const repos = reposState.status === "ready" ? reposState.repos : [];
  const stats = statsState.status === "ready" ? statsState.stats.repos : null;
  const statsLoading = statsState.status === "loading";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 pb-28 sm:py-16 md:max-w-5xl md:flex-row md:items-start">
      <RepoSidebar
        repos={repos}
        stats={stats}
        statsLoading={statsLoading}
        selected={selectedRepo}
        onSelect={setSelectedRepo}
        onRetryStats={handleRetryStats}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-6 md:max-w-2xl">
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

        <div className="flex items-center gap-2">
          <MobileRepoButton
            selected={selectedRepo}
            reposLoading={reposState.status === "loading"}
            onClick={() => setDrawerOpen(true)}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="一覧と件数をリフレッシュ"
            title="一覧と件数をリフレッシュ"
            disabled={loading}
            onClick={handleRefresh}
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
                <Button variant="outline" size="sm" onClick={handleRefresh}>
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
      </div>

      <RepoDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        repos={repos}
        stats={stats}
        statsLoading={statsLoading}
        selected={selectedRepo}
        onSelect={setSelectedRepo}
        onRetryStats={handleRetryStats}
      />

      <PlanDetailDialog plan={detailPlan} open={detailOpen} onOpenChange={setDetailOpen} />

      <JotDialog
        open={jotOpen}
        onOpenChange={setJotOpen}
        repo={selectedRepo}
        onSuccess={handleJotSuccess}
      />

      <ResultDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={result}
      />

      <UpdateToast />
    </main>
  );
}
