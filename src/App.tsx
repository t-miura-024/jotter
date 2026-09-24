import { useCallback, useEffect, useRef, useState } from "react";

import { CircleAlert, PenLine, RotateCcw } from "lucide-react";
import { motion } from "motion/react";

import { JotDialog } from "@/components/jot-dialog";
import { MobileFooter } from "@/components/mobile-footer";
import { MonologueDialog, type MonologueDialogResult } from "@/components/monologue-dialog";
import { MonologueList, MonologueListSkeleton } from "@/components/monologue-list";
import { MonologueMonthPicker } from "@/components/monologue-month-picker";
import { PlanDetailDialog } from "@/components/plan-detail-dialog";
import { PlanList } from "@/components/plan-list";
import { PlanListSkeleton } from "@/components/plan-list-skeleton";
import { MobileRepoButton, BrandHeader, RepoDrawer, RepoSidebar } from "@/components/repo-nav";
import { ResultDialog } from "@/components/result-dialog";
import type { SubmitResult } from "../shared/submit";
import type { Monologue } from "../shared/monologue";
import { AuthExpiredPanel } from "@/components/auth-expired-panel";
import { Button } from "@/components/ui/button";
import { UpdateToast } from "@/components/update-toast";
import { AuthExpiredError, apiFetch } from "@/lib/api";
import { fetchMonologues, getCachedMonologues, invalidateMonologuesCache } from "@/lib/monologues";
import { fetchPlans, getCachedPlans, invalidatePlansCache, type PlanItem } from "@/lib/plans";
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
import {
  persistViewSelection,
  readStoredViewSelection,
  type ViewSelection,
} from "@/lib/view-selection";

type PlansState =
  | { status: "loading" }
  | { status: "ready"; plans: PlanItem[] }
  | { status: "error"; message: string; authExpired: boolean };

type MonologuesState =
  | { status: "loading" }
  | { status: "ready"; monologues: Monologue[]; warnings?: string[] }
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

/** JST の今月（YYYY-MM）。Monologue 一覧の既定の対象月。 */
function currentMonthJST(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

export default function App() {
  // 選択中の内部 repo（fullName）。旧選択値は初回読込時に移行される（ADR 0010）。
  const [selectedRepo, setSelectedRepo] = useState<string>(() =>
    readStoredRepoSelection(window.localStorage),
  );
  // Plan / Monologue の表示切替（ルーターなし state 切替。不正値は plan へ移行）。
  const [activeView, setActiveView] = useState<ViewSelection>(() =>
    readStoredViewSelection(window.localStorage),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reposState, setReposState] = useState<ReposState>({ status: "loading" });
  const [statsState, setStatsState] = useState<StatsState>({ status: "loading" });
  const [plansState, setPlansState] = useState<PlansState>({ status: "loading" });
  const [month, setMonth] = useState<string>(() => currentMonthJST());
  const [monologuesState, setMonologuesState] = useState<MonologuesState>({ status: "loading" });
  const [detailPlan, setDetailPlan] = useState<PlanItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [jotOpen, setJotOpen] = useState(false);
  const [monologueOpen, setMonologueOpen] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  // 選択状態を localStorage へ永続化（ページを開いたときの復元用）。
  useEffect(() => {
    persistRepoSelection(window.localStorage, selectedRepo);
  }, [selectedRepo]);

  // 表示切替を localStorage へ永続化（ページを開いたときの復元用）。
  useEffect(() => {
    persistViewSelection(window.localStorage, activeView);
  }, [activeView]);

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

  // 月切り替え競合のガード用（最後に開始した取得のみ状態へ反映する）。
  const monoSeq = useRef(0);

  const loadMonologues = useCallback(async (targetMonth: string, force: boolean) => {
    const seq = ++monoSeq.current;

    // クライアント側メモリキャッシュ: 月切替・リフレッシュ押下または記録成功まで再 fetch しない。
    if (!force) {
      const cached = getCachedMonologues(targetMonth);
      if (cached) {
        setMonologuesState({ status: "ready", monologues: cached });
        return;
      }
    }

    setMonologuesState({ status: "loading" });
    try {
      const result = await fetchMonologues(targetMonth);
      if (monoSeq.current === seq) {
        setMonologuesState({
          status: "ready",
          monologues: result.monologues,
          warnings: result.warnings,
        });
      }
    } catch (error) {
      if (monoSeq.current === seq) {
        setMonologuesState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
          authExpired: error instanceof AuthExpiredError,
        });
      }
    }
  }, []);

  // Monologue 表示中は対象月の一覧を読み込む（Plan 一覧とは独立）。
  useEffect(() => {
    if (activeView === "monologue") {
      void loadMonologues(month, false);
    }
  }, [activeView, month, loadMonologues]);

  function openPlan(plan: PlanItem): void {
    setDetailPlan(plan);
    setDetailOpen(true);
  }

  /** 手動リフレッシュ: 表示中の view の一覧（と Plan 側は repo stats）を cache bypass で強制更新する。 */
  function handleRefresh(): void {
    if (activeView === "monologue") {
      invalidateMonologuesCache();
      void loadMonologues(month, true);
      return;
    }
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

  /** Monologue 記録成功（両出力成功）: ダイアログを閉じ、記録日の月の一覧を再取得して表示を同期する。 */
  function handleMonologueSuccess(result: MonologueDialogResult): void {
    setMonologueOpen(false);
    invalidateMonologuesCache();
    const targetMonth = /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date.slice(0, 7) : month;
    if (targetMonth !== month) {
      setMonth(targetMonth);
    }
    void loadMonologues(targetMonth, true);
  }

  const repos = reposState.status === "ready" ? reposState.repos : [];
  const stats = statsState.status === "ready" ? statsState.stats.repos : null;
  const statsLoading = statsState.status === "loading";
  const isMonologueView = activeView === "monologue";

  return (
    // PC は viewport 高さで固定し、sidebar / content がそれぞれ独立スクロールする。モバイルは従来通りのページスクロール。
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16 md:h-dvh md:max-w-none md:min-h-0 md:flex-row md:gap-0 md:overflow-hidden md:p-0">
      <RepoSidebar
        repos={repos}
        stats={stats}
        statsLoading={statsLoading}
        reposLoading={reposState.status === "loading"}
        selected={selectedRepo}
        onSelect={setSelectedRepo}
        onRetryStats={handleRetryStats}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      {/* モバイルのヘッダー（PC では sidebar 最上部に BrandHeader を表示）。 */}
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="md:hidden"
      >
        <BrandHeader />
      </motion.header>

      <div className="flex min-w-0 flex-1 flex-col gap-6 pb-24 md:mx-auto md:max-w-2xl md:overflow-y-auto md:px-8 md:py-8 md:pb-8">
        {isMonologueView ? (
          <>
            <div className="flex">
              <MonologueMonthPicker value={month} onChange={setMonth} />
            </div>

            {monologuesState.status === "loading" && <MonologueListSkeleton />}

            {monologuesState.status === "error" &&
              (monologuesState.authExpired ? (
                <AuthExpiredPanel />
              ) : (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"
                >
                  <div className="flex items-start gap-2">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Monologue一覧の取得に失敗しました。</p>
                      <p className="mt-0.5 text-xs break-all text-muted-foreground">
                        {monologuesState.message}
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

            {monologuesState.status === "ready" && (
              <>
                {monologuesState.warnings && monologuesState.warnings.length > 0 && (
                  <div
                    role="status"
                    className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
                  >
                    <p className="text-sm font-medium">一部の日の取得に失敗しました。</p>
                    <ul className="mt-1 space-y-0.5 text-xs break-all text-muted-foreground">
                      {monologuesState.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <MonologueList monologues={monologuesState.monologues} />
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex">
              <MobileRepoButton
                selected={selectedRepo}
                reposLoading={reposState.status === "loading"}
                onClick={() => setDrawerOpen(true)}
              />
            </div>

            {plansState.status === "loading" && <PlanListSkeleton />}

            {plansState.status === "error" &&
              (plansState.authExpired ? (
                <AuthExpiredPanel />
              ) : (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"
                >
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
          </>
        )}

        <MotionButton
          size="icon"
          aria-label={isMonologueView ? "新しい Monologue" : "新しい jot"}
          className="fixed right-6 bottom-20 z-40 size-12 rounded-full shadow-md md:bottom-6 [&_svg]:size-5"
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          onClick={() => (isMonologueView ? setMonologueOpen(true) : setJotOpen(true))}
        >
          <PenLine aria-hidden />
        </MotionButton>
      </div>

      <RepoDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        repos={repos}
        stats={stats}
        statsLoading={statsLoading}
        reposLoading={reposState.status === "loading"}
        selected={selectedRepo}
        onSelect={setSelectedRepo}
        onRetryStats={handleRetryStats}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      <PlanDetailDialog plan={detailPlan} open={detailOpen} onOpenChange={setDetailOpen} />

      <JotDialog
        open={jotOpen}
        onOpenChange={setJotOpen}
        repo={selectedRepo}
        onSuccess={handleJotSuccess}
      />

      <MonologueDialog
        open={monologueOpen}
        onOpenChange={setMonologueOpen}
        onSuccess={handleMonologueSuccess}
      />

      <ResultDialog open={resultOpen} onOpenChange={setResultOpen} result={result} />

      <MobileFooter activeView={activeView} onChange={setActiveView} />

      {/* モバイルフッターと重ならないよう UpdateToast の内側トーストを底上げする。 */}
      <div className="[&_[role=status]]:bottom-24 [&_[role=status]]:md:bottom-4">
        <UpdateToast />
      </div>
    </main>
  );
}
