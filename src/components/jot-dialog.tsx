import { useState } from "react";

import { CircleAlert, LoaderCircle, RotateCcw, Send, WifiOff } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { DEFAULT_MODEL, ModelSelector } from "@/components/model-selector";
import { AuthExpiredError, apiFetch } from "@/lib/api";
import { AuthExpiredPanel } from "@/components/auth-expired-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmitOverlay, type SubmitStage } from "@/components/submit-overlay";
import { Textarea } from "@/components/ui/textarea";
import type { SubmitResult } from "@/components/result-dialog";
import { describeJotTarget } from "@/lib/target";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; stage: SubmitStage }
  | { status: "error"; message: string }
  | { status: "offline" }
  | { status: "authExpired" };

const STAGE_LABEL: Record<SubmitStage, string> = {
  formatting: "LLM が整形中…",
  creating: "Issue を作成中…",
};

function parseSseEvents(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of text.split("\n\n").filter(Boolean)) {
    const eventMatch = block.match(/^event: (.+)$/m);
    const dataMatch = block.match(/^data: (.+)$/m);
    if (eventMatch && dataMatch) {
      events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
    }
  }
  return events;
}

type JotDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 上部プルダウンの選択値（"owner/name" 形式 or 空）。起票先はこれに連動する。 */
  repo: string;
  /** 起票成功時に結果を渡す（親が ResultDialog 表示・一覧再取得を行う）。 */
  onSuccess: (result: SubmitResult) => void;
};

/**
 * Jot モーダル。下部固定ボタンから開き、走り書きを送信して draft 計画 Issue を起票する。
 * 起票先表示・モデル選択プルダウン・テキストエリアを持ち、参照のみ（編集機能なし）。
 */
export function JotDialog({ open, onOpenChange, repo, onSuccess }: JotDialogProps) {
  const [jot, setJot] = useState("");
  const [preferredModel, setPreferredModel] = useState<string>(DEFAULT_MODEL);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  // done 受信後もオーバーレイの成功シーケンス（飛び立ち＋合図）を完走させてから
  // onSuccess を呼ぶため、結果と完了フラグを一時保持する。
  const [pendingResult, setPendingResult] = useState<SubmitResult | null>(null);
  const [submitDone, setSubmitDone] = useState(false);

  const submitting = state.status === "submitting";
  const canSubmit = jot.trim().length > 0 && !submitting;
  const target = describeJotTarget(repo);

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setPendingResult(null);
    setSubmitDone(false);
    setState({ status: "submitting", stage: "formatting" });
    try {
      const response = await apiFetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jot, repo, preferredModel }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }

      const text = await response.text();
      const events = parseSseEvents(text);

      for (const event of events) {
        if (event.event === "formatting") {
          setState({ status: "submitting", stage: "formatting" });
        } else if (event.event === "creating") {
          setState({ status: "submitting", stage: "creating" });
        } else if (event.event === "done") {
          const result = event.data as unknown as SubmitResult;
          setPendingResult(result);
          setSubmitDone(true);
        } else if (event.event === "error") {
          throw new Error(String(event.data.error ?? "不明なエラー"));
        }
      }
    } catch (error) {
      // セッション切れ（Access への 302）は再ログインを促す。
      if (error instanceof AuthExpiredError) {
        setState({ status: "authExpired" });
        return;
      }
      // オフライン（navigator.onLine が false、または fetch のネットワーク失敗 =
      // same-origin への TypeError）は専用メッセージで案内する。jot 本文は保持される。
      // オフラインキューイングは行わない（ADR 0006）。
      if (!navigator.onLine || error instanceof TypeError) {
        setState({ status: "offline" });
        return;
      }
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** オーバーレイの成功シーケンス完走: 状態を片付けてから結果を親に渡す。 */
  function handleOverlayFinished(): void {
    const result = pendingResult;
    setJot("");
    setPendingResult(null);
    setSubmitDone(false);
    setState({ status: "idle" });
    if (result) {
      onSuccess(result);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl sm:max-w-2xl"
        showCloseButton={!submitting}
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>新しい jot</DialogTitle>
          <DialogDescription>
            走り書きをそのまま。送信すると GitHub に draft 計画 Issue が起票されます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            起票先: <span className="font-mono">{target.repo}</span>
            {target.externalLabel && (
              <>
                {" "}
                （<span className="font-mono">{target.externalLabel}</span> label 付き）
              </>
            )}
          </p>

          <ModelSelector value={preferredModel} onChange={setPreferredModel} disabled={submitting} />

          <Textarea
            autoFocus
            aria-label="jot 本文"
            disabled={submitting}
            value={jot}
            onChange={(event) => setJot(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={"思ったままを書き留めてください。\nLLM がタイトルを抽出し、本文を Markdown に整えます。"}
            className="min-h-[30vh] resize-y text-base leading-relaxed"
          />

          {state.status === "offline" && (
            <div role="alert" className="rounded-lg border border-border bg-muted px-4 py-3">
              <div className="flex items-start gap-2">
                <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">オフラインです。</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    起票にはネットワーク接続が必要です。走り書きの内容は保持されています。
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                >
                  <RotateCcw aria-hidden />
                  リトライ
                </Button>
              </div>
            </div>
          )}

          {state.status === "error" && (
            <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
              <div className="flex items-start gap-2">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">起票に失敗しました。</p>
                  <p className="mt-0.5 text-xs break-all text-muted-foreground">{state.message}</p>
                </div>
              </div>
              <div className="mt-2.5 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                >
                  <RotateCcw aria-hidden />
                  リトライ
                </Button>
              </div>
            </div>
          )}

          {state.status === "authExpired" && <AuthExpiredPanel />}

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              ⌘ / Ctrl + Enter で送信 · <span className="font-mono">kind/plan</span> label
            </p>
            <Button size="lg" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Send aria-hidden />
              )}
              {submitting && state.status === "submitting" ? STAGE_LABEL[state.stage] : "起票"}
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {submitting && state.status === "submitting" && (
            <SubmitOverlay
              stage={state.stage}
              jot={jot}
              done={submitDone}
              onFinished={handleOverlayFinished}
            />
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
