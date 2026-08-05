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
import { Input } from "@/components/ui/input";
import { SubmitOverlay, type SubmitStage } from "@/components/submit-overlay";
import { Textarea } from "@/components/ui/textarea";
import type { SubmitResult } from "@/components/result-dialog";
import { NOTE_INBOX, describeJotTarget, validateExternalRepo } from "@/lib/target";

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
  /** 選択中の内部 repo（"owner/name" 形式）。空なら note inbox として扱う。 */
  repo: string;
  /** 起票成功時に結果を渡す（親が ResultDialog 表示・一覧再取得を行う）。 */
  onSuccess: (result: SubmitResult) => void;
};

/**
 * Jot モーダル。下部固定ボタンから開き、走り書きを送信して draft 計画 Issue を起票する。
 *
 * - note inbox 選択時だけ外部 repo 入力欄を表示する。外部 repo 入力は target repo と
 *   解釈せず、note inbox への external/{owner}-{name} label 付与だけを決める（ADR 0010）。
 * - 外部 repo 入力はモーダルを閉じても保持され、起票成功時に jot 本文とともに消去される。
 *   失敗時は両方が保持され、再送信できる。
 * - 外部 repo 入力はクライアントでも検証し、エラー時は LLM 呼び出しを開始しない
 *   （サーバー側でも検証し、迂回した不正リクエストには 4xx を返す）。
 */
export function JotDialog({ open, onOpenChange, repo, onSuccess }: JotDialogProps) {
  const [jot, setJot] = useState("");
  const [externalRepo, setExternalRepo] = useState("");
  const [preferredModel, setPreferredModel] = useState<string>(DEFAULT_MODEL);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  // done 受信後もオーバーレイの成功シーケンス（飛び立ち＋合図）を完走させてから
  // onSuccess を呼ぶため、結果と完了フラグを一時保持する。
  const [pendingResult, setPendingResult] = useState<SubmitResult | null>(null);
  const [submitDone, setSubmitDone] = useState(false);

  const submitting = state.status === "submitting";
  const canSubmit = jot.trim().length > 0 && !submitting;

  const isNoteInbox = repo.trim() === "" || repo.trim() === NOTE_INBOX;
  // 外部 repo 入力は note inbox のときだけ意味を持つ（他の内部 repo では無視される）。
  const externalValidation =
    isNoteInbox && externalRepo.trim() !== ""
      ? validateExternalRepo(externalRepo)
      : { ok: true as const, repo: null };
  const externalError = externalValidation.ok ? null : externalValidation.error;

  const target = describeJotTarget(repo, isNoteInbox ? externalRepo : "");

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    // クライアント検証: 不正な外部 repo 入力では送信しない（LLM・GitHub API を呼ばない）。
    if (!externalValidation.ok) return;

    setPendingResult(null);
    setSubmitDone(false);
    setState({ status: "submitting", stage: "formatting" });
    try {
      const response = await apiFetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jot,
          repo,
          externalRepo: isNoteInbox ? externalRepo.trim() : "",
          preferredModel,
        }),
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
    // 起票成功時は jot 本文と外部 repo 入力の両方を消去する。
    setJot("");
    setExternalRepo("");
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

          {isNoteInbox && (
            <div className="flex flex-col gap-1">
              <label htmlFor="external-repo" className="text-xs text-muted-foreground">
                外部 repo（任意）— 入力すると <span className="font-mono">external/owner-name</span>{" "}
                label 付きで note inbox に起票
              </label>
              <Input
                id="external-repo"
                aria-label="外部 repo（owner/name 形式）"
                placeholder="owner/name"
                value={externalRepo}
                onChange={(event) => setExternalRepo(event.target.value)}
                disabled={submitting}
                aria-invalid={externalError ? true : undefined}
              />
              {externalError && (
                <p role="alert" className="text-xs text-destructive">
                  {externalError}
                </p>
              )}
            </div>
          )}

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
            <Button
              size="lg"
              disabled={!canSubmit || externalError !== null}
              onClick={() => void submit()}
            >
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
