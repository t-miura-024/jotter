import { useEffect, useRef, useState } from "react";

import { CircleCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type SubmitStage = "formatting" | "creating";

type Phase =
  | "paper-in"
  | "fold1"
  | "fold2"
  | "morph"
  | "hover"
  | "flyaway"
  | "launch"
  | "success";

type SubmitOverlayProps = {
  stage: SubmitStage;
  /** 紙の上に表示する jot 本文。 */
  jot: string;
  /** サーバーから done イベントを受信したか。 */
  done: boolean;
  /** 成功シーケンス（飛び立ち＋合図）が完走したときに呼ばれる。 */
  onFinished: () => void;
};

const PAPER_W = 176;
const PAPER_H = 216;
const LAUNCH_MS = 1250;
const SUCCESS_HOLD_MS = 900;
const MESSAGE_ROTATE_MS = 2600;

const LOOP_STEPS: Array<{ phase: Phase; duration: number }> = [
  { phase: "paper-in", duration: 450 },
  { phase: "fold1", duration: 650 },
  { phase: "fold2", duration: 500 },
  { phase: "morph", duration: 400 },
  { phase: "hover", duration: 550 },
  { phase: "flyaway", duration: 700 },
];

const STAGE_MESSAGES: Record<SubmitStage, string[]> = {
  formatting: [
    "走り書きを読みやすい形に整えています…",
    "タイトルをひねり出し中…",
    "Markdown の魔法をかけています…",
    "要点をすくい上げています…",
  ],
  creating: [
    "GitHub に届けています…",
    "Issue をしたためています…",
    "kind/plan ラベルを貼っています…",
  ],
};

/**
 * 送信中のオーバーレイ。jot が書かれた紙が折られて紙飛行機になり、
 * 旋回して去るループを繰り返す。creating 遷移でループのキリまで完了してから
 * 大きく飛び立ち、done 受信後に成功の合図を見せて onFinished を呼ぶ。
 */
export function SubmitOverlay({ stage, jot, done, onFinished }: SubmitOverlayProps) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("paper-in");
  const [launchDone, setLaunchDone] = useState(false);

  const stageRef = useRef(stage);
  const doneRef = useRef(done);
  const onFinishedRef = useRef(onFinished);
  stageRef.current = stage;
  doneRef.current = done;
  onFinishedRef.current = onFinished;

  // 折りたたみループのランナー。flyaway のタイミングで creating/done を確認し、
  // 条件が来ていればループを離脱して launch に移行する（Q5: ループのキリで離脱）。
  useEffect(() => {
    if (reducedMotion) return;
    let cancelled = false;
    let timer = 0;
    let idx = 0;

    const advance = () => {
      if (cancelled) return;
      const step = LOOP_STEPS[idx % LOOP_STEPS.length];
      const shouldLaunch = stageRef.current !== "formatting" || doneRef.current;
      // ループのキリ（flyaway 直前、または flyaway 中に遷移が来て次の紙が出る直前）で離脱。
      if (shouldLaunch && (step.phase === "flyaway" || (step.phase === "paper-in" && idx > 0))) {
        setPhase("launch");
        return;
      }
      setPhase(step.phase);
      idx += 1;
      timer = window.setTimeout(advance, step.duration);
    };

    advance();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reducedMotion]);

  // launch アニメ完了のトラッキング。
  useEffect(() => {
    if (phase !== "launch") return;
    const timer = window.setTimeout(() => setLaunchDone(true), LAUNCH_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // 成功への遷移: 通常は「launch 完了 かつ done 受信」の両方を待つ（Q7）。
  // reduced-motion の場合は done 受信のみで進む。
  useEffect(() => {
    if (reducedMotion) {
      if (!done) return;
      const timer = window.setTimeout(() => setPhase("success"), 300);
      return () => window.clearTimeout(timer);
    }
    if (phase === "launch" && launchDone && done) {
      setPhase("success");
    }
  }, [reducedMotion, phase, launchDone, done]);

  // 成功の合図を短く表示してから完了を通知する。
  useEffect(() => {
    if (phase !== "success") return;
    const timer = window.setTimeout(() => onFinishedRef.current(), SUCCESS_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const showPaper =
    phase === "paper-in" || phase === "fold1" || phase === "fold2" || phase === "morph";
  const showPlane =
    phase === "morph" || phase === "hover" || phase === "flyaway" || phase === "launch";

  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 rounded-[inherit] bg-popover/90 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <div className="relative flex h-56 w-full items-center justify-center">
        {!reducedMotion && phase === "launch" && <LaunchTrail />}
        {!reducedMotion && showPaper && <FoldablePaper phase={phase} jot={jot} />}
        {!reducedMotion && showPlane && <Plane phase={phase} />}
        {phase === "success" ? (
          <SuccessBadge />
        ) : (
          reducedMotion && <PlaneSvg className="size-28 drop-shadow-md" />
        )}
      </div>
      {phase !== "success" && <MessageLine stage={stage} />}
    </motion.div>
  );
}

/** jot テキストを載せた紙。fold1（左右折り）→ fold2（上下折り）→ morph で飛行機へ。 */
function FoldablePaper({ phase, jot }: { phase: Phase; jot: string }) {
  const folded1 = phase === "fold1" || phase === "fold2" || phase === "morph";
  const folded2 = phase === "fold2" || phase === "morph";
  const morphing = phase === "morph";

  return (
    <motion.div
      className="relative"
      style={{ width: PAPER_W, height: PAPER_H, perspective: 700 }}
      initial={{ opacity: 0, y: 26, rotate: -4 }}
      animate={{
        opacity: morphing ? 0 : 1,
        scale: morphing ? 0.8 : 1,
        rotate: 0,
        x: folded1 ? PAPER_W / 4 : 0,
        y: folded2 ? PAPER_H / 4 : 0,
      }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden rounded-l-lg border border-border bg-background shadow-sm">
        <PaperText jot={jot} offsetX={0} />
      </div>

      <motion.div
        className="absolute inset-y-0 right-0 w-1/2"
        style={{ transformOrigin: "left center", transformStyle: "preserve-3d" }}
        initial={false}
        animate={{ rotateY: folded1 ? -180 : 0 }}
        transition={{ duration: 0.55, ease: "easeInOut" }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-r-lg border border-border bg-background shadow-sm [backface-visibility:hidden]">
          <PaperText jot={jot} offsetX={-PAPER_W / 2} />
        </div>
        <div
          className="absolute inset-0 rounded-lg border border-border bg-muted"
          style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}
        />
      </motion.div>

      {folded1 && (
        <>
          <div className="absolute left-0 top-0 h-1/2 w-1/2 rounded-lg border border-border bg-muted" />
          <motion.div
            className="absolute bottom-0 left-0 h-1/2 w-1/2"
            style={{ transformOrigin: "center top", transformStyle: "preserve-3d" }}
            initial={false}
            animate={{ rotateX: folded2 ? 180 : 0 }}
            transition={{ duration: 0.45, ease: "easeInOut" }}
          >
            <div className="absolute inset-0 rounded-b-lg border border-border bg-muted [backface-visibility:hidden]" />
            <div
              className="absolute inset-0 rounded-lg border border-border bg-secondary"
              style={{ transform: "rotateX(180deg)", backfaceVisibility: "hidden" }}
            />
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

/** 紙の片面。幅 PAPER_W 分のテキストを描き、offsetX で左右半分の表示位置をずらす。 */
function PaperText({ jot, offsetX }: { jot: string; offsetX: number }) {
  return (
    <div className="h-full p-3" style={{ width: PAPER_W, transform: `translateX(${offsetX}px)` }}>
      <p className="whitespace-pre-wrap break-words text-[9px] leading-4 text-muted-foreground [mask-image:linear-gradient(to_bottom,black_55%,transparent_92%)]">
        {jot}
      </p>
    </div>
  );
}

/** 折りたたみ後のペーパークロス。morph で Plane とクロスフェードする。 */
function Plane({ phase }: { phase: Phase }) {
  return (
    <motion.div
      className="flex items-center justify-center"
      initial={{ opacity: 0, scale: 0.5, rotate: -12 }}
      animate={
        phase === "morph" || phase === "hover"
          ? {
              opacity: 1,
              scale: 1,
              rotate: 0,
              x: 0,
              y: phase === "hover" ? [0, -8, 0] : 0,
            }
          : phase === "flyaway"
            ? {
                opacity: [1, 1, 0],
                x: [0, 70, 160],
                y: [0, -28, -95],
                rotate: [0, 8, 16],
                scale: [1, 0.92, 0.75],
              }
            : {
                opacity: [1, 1, 0],
                x: [0, 80, 152],
                y: [0, -42, -112],
                rotate: [0, 9, 18],
                scale: [1, 1.05, 0.9],
              }
      }
      transition={
        phase === "morph"
          ? { duration: 0.35, ease: "easeOut" }
          : phase === "hover"
            ? { duration: 0.55, ease: "easeInOut" }
            : phase === "flyaway"
              ? { duration: 0.7, times: [0, 0.55, 1], ease: "easeIn" }
              : { duration: 1.2, times: [0, 0.55, 1], ease: "easeIn" }
      }
    >
      <PlaneSvg className="size-28 drop-shadow-md" />
    </motion.div>
  );
}

/** launch 時に進行方向へ引かれる軌跡線。 */
function LaunchTrail() {
  return (
    <svg
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      width="340"
      height="240"
      viewBox="0 0 340 240"
      fill="none"
      aria-hidden
    >
      <motion.path
        d="M170 120 Q 250 78 322 8"
        stroke="var(--muted-foreground)"
        strokeOpacity={0.35}
        strokeWidth={1.5}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 1 }}
        animate={{ pathLength: 1, opacity: [1, 1, 0] }}
        transition={{ duration: 1.25, times: [0, 0.75, 1], ease: "easeOut" }}
      />
    </svg>
  );
}

function PlaneSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden className={className}>
      <polygon points="112,16 10,52 52,64" fill="var(--primary)" opacity="0.45" />
      <polygon points="112,16 52,64 46,98" fill="var(--primary)" opacity="0.75" />
      <polygon points="112,16 52,64 58,70" fill="var(--primary)" />
    </svg>
  );
}

function SuccessBadge() {
  return (
    <motion.div
      className="flex flex-col items-center gap-2.5"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 20 }}
    >
      <CircleCheck aria-hidden className="size-11 text-primary" />
      <p className="text-sm font-medium">起票しました！</p>
    </motion.div>
  );
}

/** ステージ別のローテーションメッセージ（Q6）。2.6 秒ごとに切り替わる。 */
function MessageLine({ stage }: { stage: SubmitStage }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    const timer = window.setInterval(() => setIndex((i) => i + 1), MESSAGE_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [stage]);

  const messages = STAGE_MESSAGES[stage];
  const message = messages[index % messages.length];

  return (
    <div className="flex h-6 items-center justify-center" role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={message}
          className="text-sm text-muted-foreground"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.25 }}
        >
          {message}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
