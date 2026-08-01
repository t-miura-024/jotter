import { useState } from "react";

import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  LoaderCircle,
  PenLine,
  RotateCcw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { DEFAULT_MODEL, ModelSelector } from "@/components/model-selector";
import { RepoSelector } from "@/components/repo-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type SubmitResult = {
  number: number;
  title: string;
  url: string;
  repo: string;
  /** 実際に整形に応答した Gemini モデル名。 */
  modelUsed: string;
  /** 優先モデル以外へフォールバックしたか。 */
  fallbackOccurred: boolean;
  /** 起票後に GitHub Project へ追加されたか（secret 未設定・連携失敗時は false）。 */
  projectAdded: boolean;
};

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; result: SubmitResult }
  | { status: "error"; message: string };

const MotionButton = motion.create(Button);

export default function App() {
  const [jot, setJot] = useState("");
  const [repo, setRepo] = useState("");
  const [preferredModel, setPreferredModel] = useState<string>(DEFAULT_MODEL);
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const submitting = state.status === "submitting";
  const canSubmit = jot.trim().length > 0 && !submitting;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setState({ status: "submitting" });
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
      const result = (await response.json()) as SubmitResult;
      setJot("");
      setState({ status: "success", result });
    } catch (error) {
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
        placeholder={"思ったままを書き留めてください。\nLLM がタイトルを抽出し、本文を Markdown に整えます。"}
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
          {submitting ? "起票中…" : "起票"}
        </MotionButton>
      </div>

      <AnimatePresence mode="wait">
        {state.status === "success" && (
          <motion.div
            key="success"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-primary" />
              draft Issue として起票しました。
            </p>
            <a
              href={state.result.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 flex items-start gap-1.5 text-primary underline-offset-4 hover:underline"
            >
              <span className="font-mono text-xs leading-5 break-all">{state.result.url}</span>
              <ExternalLink aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            </a>
            {(state.result.fallbackOccurred || !state.result.projectAdded) && (
              <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                {state.result.fallbackOccurred && (
                  <p className="flex items-center gap-1.5">
                    <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                    フォールバック発生: <span className="font-mono">{state.result.modelUsed}</span>{" "}
                    を使用しました。
                  </p>
                )}
                {!state.result.projectAdded && (
                  <p className="flex items-center gap-1.5">
                    <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                    Project 連携をスキップしました（secret 未設定または連携失敗）。起票は成功しています。
                  </p>
                )}
              </div>
            )}
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
    </main>
  );
}
