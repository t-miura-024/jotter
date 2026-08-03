import { useState } from "react";

import { CircleAlert, LoaderCircle, PenLine, RotateCcw, Send, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { DEFAULT_MODEL, ModelSelector } from "@/components/model-selector";
import { RepoSelector } from "@/components/repo-selector";
import { ResultDialog, type SubmitResult } from "@/components/result-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UpdateToast } from "@/components/update-toast";

type SubmitStage = "formatting" | "creating";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; stage: SubmitStage }
  | { status: "success"; result: SubmitResult }
  | { status: "error"; message: string }
  | { status: "offline" };

const STAGE_LABEL: Record<SubmitStage, string> = {
  formatting: "LLM が整形中…",
  creating: "Issue を作成中…",
};

const MotionButton = motion.create(Button);

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

export default function App() {
  const [jot, setJot] = useState("");
  const [repo, setRepo] = useState("");
  const [preferredModel, setPreferredModel] = useState<string>(DEFAULT_MODEL);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [dialogOpen, setDialogOpen] = useState(false);

  const submitting = state.status === "submitting";
  const canSubmit = jot.trim().length > 0 && !submitting;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setState({ status: "submitting", stage: "formatting" });
    try {
      const response = await fetch("/api/submit", {
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
          setJot("");
          setState({ status: "success", result });
          setDialogOpen(true);
        } else if (event.event === "error") {
          throw new Error(String(event.data.error ?? "不明なエラー"));
        }
      }
    } catch (error) {
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16">
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
            走り書きをそのまま。送信すると GitHub に draft 計画 Issue が起票されます。
          </p>
        </div>
        <ThemeToggle />
      </motion.header>

      <Textarea
        autoFocus
        aria-label="jot 本文"
        value={jot}
        onChange={(event) => setJot(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={
          "思ったままを書き留めてください。\nLLM がタイトルを抽出し、本文を Markdown に整えます。"
        }
        className="min-h-[40vh] resize-y text-base leading-relaxed"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <RepoSelector onChange={setRepo} disabled={submitting} />
        <ModelSelector value={preferredModel} onChange={setPreferredModel} disabled={submitting} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          ⌘ / Ctrl + Enter で送信 · <span className="font-mono">kind/plan</span> label
        </p>
        <MotionButton
          size="lg"
          disabled={!canSubmit}
          onClick={() => void submit()}
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        >
          {submitting ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : (
            <Send aria-hidden />
          )}
          {submitting && state.status === "submitting" ? STAGE_LABEL[state.stage] : "起票"}
        </MotionButton>
      </div>

      <AnimatePresence mode="wait">
        {state.status === "offline" && (
          <motion.div
            key="offline"
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="rounded-lg border border-border bg-muted px-4 py-3"
          >
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
          </motion.div>
        )}
        {state.status === "error" && (
          <motion.div
            key="error"
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"
          >
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
          </motion.div>
        )}
      </AnimatePresence>

      <ResultDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        result={state.status === "success" ? state.result : null}
      />

      <UpdateToast />
    </main>
  );
}
