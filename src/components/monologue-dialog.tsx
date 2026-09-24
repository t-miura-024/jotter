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
import { SubmitOverlay } from "@/components/submit-overlay";
import { Textarea } from "@/components/ui/textarea";
import type { FallbackEvent } from "../../shared/submit";

/** POST /api/monologue/submit の done ペイロード（サーバー型と同形）。
 * NOTE: GC の eventId は YAGNI のため含めない。GC 追跡が将来必要になれば再導入する。 */
export type MonologueDialogResult = {
  title: string;
  body: string;
  date: string;
  time: string;
  modelUsed: string;
  fallbacks: FallbackEvent[];
  noteOk: boolean;
  gcOk: boolean;
  noteError?: string;
  gcError?: string;
  /** 失敗側専用リトライで非実行側に付く。ok:false と併せて「未実行」を表す。 */
  noteSkipped?: boolean;
  gcSkipped?: boolean;
};

type MonologueStage = "formatting" | "writing-note" | "creating-event";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; stage: MonologueStage }
  | { status: "partial"; result: MonologueDialogResult }
  | { status: "error"; message: string }
  | { status: "offline" }
  | { status: "authExpired" };

const STAGE_LABEL: Record<MonologueStage, string> = {
  formatting: "LLM が整形中…",
  "writing-note": "note書込中…",
  "creating-event": "GC作成中…",
};

/** AbortSignal.timeout による中断か（DOMException name === "TimeoutError"）。 */
function isTimeoutError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "TimeoutError") ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "TimeoutError")
  );
}

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

type MonologueDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 記録成功時に結果を渡す（親が一覧再取得を行う）。両出力が成功したときだけ呼ばれる。 */
  onSuccess: (result: MonologueDialogResult) => void;
};

/**
 * Monologue 作成モーダル。JotDialog 流用の構成。
 *
 * - 自由テキスト＋モデル選択から POST /api/monologue/submit（SSE）へ送信する。
 * - 進捗は 整形中→note書込中→GC作成中 の 3 段階で表示する。
 *   紙飛行機オーバーレイにも 3 段階をそのまま写像して再利用する。
 * - 片方失敗時は done＋失敗明示とし、入力を保持したまま失敗側のリトライができる。
 *   リトライは retryOnly（'note' | 'gc'）＋ done の title/body/date/time 再送で
 *   失敗側だけ実行し、成功側の重複を作らない。
 * - 成功時のみ入力を消去する。送信中は閉じ操作を抑止する。
 */
export function MonologueDialog({ open, onOpenChange, onSuccess }: MonologueDialogProps) {
  const [jot, setJot] = useState("");
  const [preferredModel, setPreferredModel] = useState<string>(DEFAULT_MODEL);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  // done 受信後もオーバーレイの成功シーケンス（飛び立ち＋合図）を完走させてから
  // onSuccess を呼ぶため、結果と完了フラグを一時保持する。
  const [pendingResult, setPendingResult] = useState<MonologueDialogResult | null>(null);
  const [submitDone, setSubmitDone] = useState(false);

  const submitting = state.status === "submitting";
  const canSubmit = jot.trim().length > 0 && !submitting;

  async function requestMonologue(payload: Record<string, unknown>): Promise<void> {
    setPendingResult(null);
    setSubmitDone(false);
    setState({ status: "submitting", stage: "formatting" });
    try {
      // AbortSignal.timeout 未対応環境（旧ブラウザ等）では signal なしで送る。
      const timeoutSupported =
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function";
      const response = await apiFetch("/api/monologue/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        ...(timeoutSupported ? { signal: AbortSignal.timeout(60_000) } : {}),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }

      const text = await response.text();
      const events = parseSseEvents(text);

      let settled = false;
      for (const event of events) {
        if (event.event === "formatting") {
          setState({ status: "submitting", stage: "formatting" });
        } else if (event.event === "writing-note") {
          setState({ status: "submitting", stage: "writing-note" });
        } else if (event.event === "creating-event") {
          setState({ status: "submitting", stage: "creating-event" });
        } else if (event.event === "done") {
          settled = true;
          const result = event.data as MonologueDialogResult;
          if (
            (result.noteOk && result.gcOk) ||
            (result.noteOk && result.gcSkipped) ||
            (result.gcOk && result.noteSkipped)
          ) {
            // 初回両成功、または失敗側リトライで実行側が成功（非実行側は skipped）。
            // 非実行側は前回成功済みのため全体成功として扱う。
            setPendingResult(result);
            setSubmitDone(true);
          } else {
            // 片方失敗: 失敗を明示し、入力保持のまま失敗側のリトライを促す。
            setState({ status: "partial", result });
          }
        } else if (event.event === "error") {
          settled = true;
          throw new Error(String(event.data.error ?? "不明なエラー"));
        }
      }
      if (!settled) {
        // done/error 欠落（接続切断・プロキシ切断等）で submitting に固着させない。
        setState({
          status: "error",
          message: "応答が中断されました。もう一度お試しください。",
        });
      }
    } catch (error) {
      // セッション切れ（Access への 302）は再ログインを促す。
      if (error instanceof AuthExpiredError) {
        setState({ status: "authExpired" });
        return;
      }
      // オフライン（navigator.onLine が false の場合のみ）は専用メッセージで案内する。
      // 入力は保持される。オフラインキューイングは行わない（ADR 0006）。
      // NOTE: タイムアウト（AbortSignal.timeout の TimeoutError）は汎用エラー表示にする。
      // fetch の TypeError を一律オフライン扱いにしない（誤分類防止）。
      if (isTimeoutError(error)) {
        setState({
          status: "error",
          message: "リクエストがタイムアウトしました。もう一度お試しください。",
        });
        return;
      }
      if (!navigator.onLine) {
        setState({ status: "offline" });
        return;
      }
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    await requestMonologue({ jot, preferredModel });
  }

  /**
   * 片方失敗時の失敗側専用リトライ。done の title/body/date/time をそのまま
   * retryOnly 付きで再送し、成功側を再実行しない（成功側の重複防止）。
   * 両方失敗時は成功側が存在しないため全文再送する。
   */
  async function retryFailed(): Promise<void> {
    if (state.status !== "partial" || submitting) return;
    const result = state.result;
    const noteFailed = !result.noteOk && !result.noteSkipped;
    const gcFailed = !result.gcOk && !result.gcSkipped;
    if (noteFailed && gcFailed) {
      await requestMonologue({ jot, preferredModel });
      return;
    }
    await requestMonologue({
      retryOnly: noteFailed ? "note" : "gc",
      title: result.title,
      body: result.body,
      date: result.date,
      time: result.time,
    });
  }

  /** オーバーレイの成功シーケンス完走: 状態を片付けてから結果を親に渡す。 */
  function handleOverlayFinished(): void {
    const result = pendingResult;
    // 両出力の成功時だけ入力を消去する。
    setJot("");
    setPendingResult(null);
    setSubmitDone(false);
    setState({ status: "idle" });
    if (result) {
      onSuccess(result);
    }
  }

  const partial = state.status === "partial" ? state.result : null;
  const failedSides = partial
    ? [
        !partial.noteOk && !partial.noteSkipped ? "note" : null,
        !partial.gcOk && !partial.gcSkipped ? "Google カレンダー" : null,
      ].filter((side): side is string => side !== null)
    : [];
  const skippedSides = partial
    ? [partial.noteSkipped ? "note" : null, partial.gcSkipped ? "Google カレンダー" : null].filter(
        (side): side is string => side !== null,
      )
    : [];

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
          <DialogTitle>新しい Monologue</DialogTitle>
          <DialogDescription>
            日々の断片をそのまま。送信すると note デイリーノートと Google
            カレンダーの両方へ記録されます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <ModelSelector
            value={preferredModel}
            onChange={setPreferredModel}
            disabled={submitting}
          />

          <Textarea
            autoFocus
            aria-label="monologue 本文"
            disabled={submitting}
            value={jot}
            onChange={(event) => setJot(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              "思ったままを書き留めてください。\nLLM がタイトルを抽出し、箇条書きに整えます。"
            }
            className="min-h-[30vh] resize-y text-base leading-relaxed"
          />

          {state.status === "offline" && (
            <div role="alert" className="rounded-lg border border-border bg-muted px-4 py-3">
              <div className="flex items-start gap-2">
                <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">オフラインです。</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    記録にはネットワーク接続が必要です。入力内容は保持されています。
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
            <div
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">記録に失敗しました。</p>
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

          {partial && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {failedSides.join("・")}への記録に失敗しました。
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs break-all text-muted-foreground">
                    <li>
                      note:{" "}
                      {partial.noteSkipped
                        ? "未実行"
                        : partial.noteOk
                          ? "成功"
                          : (partial.noteError ?? "失敗")}
                    </li>
                    <li>
                      Google カレンダー:{" "}
                      {partial.gcSkipped
                        ? "未実行"
                        : partial.gcOk
                          ? "成功"
                          : (partial.gcError ?? "失敗")}
                    </li>
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    入力は保持されています。失敗側だけ記録し直せます。
                    {skippedSides.length > 0 &&
                      `${skippedSides.join("・")}は未実行です（前回成功済みのため再送しません）。`}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSubmit}
                  onClick={() => void retryFailed()}
                >
                  <RotateCcw aria-hidden />
                  {failedSides.join("・")}をリトライ
                </Button>
              </div>
            </div>
          )}

          {state.status === "authExpired" && <AuthExpiredPanel />}

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">⌘ / Ctrl + Enter で送信</p>
            <Button size="lg" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Send aria-hidden />
              )}
              {submitting && state.status === "submitting" ? STAGE_LABEL[state.stage] : "記録"}
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
