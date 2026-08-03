import { useEffect, useId, useRef, useState } from "react";

import { Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type SubmitStage = "formatting" | "creating";

type Phase =
  | "paper-in"
  | "crease"
  | "collapse"
  | "reveal"
  | "hover"
  | "depart"
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

/** ステージの設計サイズ。実表示はモバイルで CSS scale して縮める。 */
const STAGE_W = 320;
const STAGE_H = 240;
const PAPER_W = 168;
const PAPER_H = 208;
const PLANE_SIZE = 116;

/** 紙がエッジオン（ほぼ真横）になる角度。紙と飛行機の入れ替え点。 */
const EDGE_ON_DEG = -80;

const LAUNCH_MS = 1320;
const SUCCESS_HOLD_MS = 1000;
const MESSAGE_ROTATE_MS = 2600;

const LOOP_STEPS: Array<{ phase: Phase; duration: number }> = [
  { phase: "paper-in", duration: 520 },
  { phase: "crease", duration: 440 },
  { phase: "collapse", duration: 340 },
  { phase: "reveal", duration: 420 },
  { phase: "hover", duration: 880 },
  { phase: "depart", duration: 760 },
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

/** 背景に漂う塵。奥行きと空気感を出すためのアンビエント要素。 */
const MOTES = [
  { x: "16%", y: "24%", size: 3, drift: 16, duration: 9.5, delay: 0 },
  { x: "78%", y: "30%", size: 2, drift: 12, duration: 11, delay: 1.4 },
  { x: "30%", y: "72%", size: 2.5, drift: 18, duration: 10.5, delay: 0.7 },
  { x: "68%", y: "68%", size: 3.5, drift: 14, duration: 12, delay: 2.1 },
  { x: "50%", y: "14%", size: 2, drift: 10, duration: 8.5, delay: 1.1 },
];

/**
 * 送信中のオーバーレイ。jot が書かれた紙に折り目が入り、エッジオンまで回って
 * 紙飛行機に切り替わり、旋回して去るループを繰り返す。creating 遷移でループの
 * キリまで完了してから大きく飛び立ち、done 受信後に成功の合図を見せる。
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

  // 折りたたみループのランナー。ループのキリで creating/done を確認して離脱する。
  useEffect(() => {
    if (reducedMotion) return;
    let cancelled = false;
    let timer = 0;
    let idx = 0;

    const advance = () => {
      if (cancelled) return;
      const step = LOOP_STEPS[idx % LOOP_STEPS.length];
      const shouldLaunch = stageRef.current !== "formatting" || doneRef.current;
      // depart 直前、または depart 中に遷移が来て次の紙が出る直前で離脱する。
      if (shouldLaunch && (step.phase === "depart" || (step.phase === "paper-in" && idx > 0))) {
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

  useEffect(() => {
    if (phase !== "launch") return;
    const timer = window.setTimeout(() => setLaunchDone(true), LAUNCH_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // 成功への遷移: 通常は「飛び立ち完了 かつ done 受信」の両方を待つ。
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

  useEffect(() => {
    if (phase !== "success") return;
    const timer = window.setTimeout(() => onFinishedRef.current(), SUCCESS_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const showPaper = phase === "paper-in" || phase === "crease" || phase === "collapse";
  const showPlane =
    phase === "reveal" || phase === "hover" || phase === "depart" || phase === "launch";
  const flying = phase === "depart" || phase === "launch";

  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-[inherit] bg-popover/92 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      {/* 背後の淡いグロー（奥行き） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 62%)",
        }}
      />
      {!reducedMotion && <Motes />}

      <div className="relative flex h-44 w-full items-center justify-center overflow-hidden sm:h-60">
        <div
          className="relative origin-center scale-[0.62] sm:scale-100"
          style={{ width: STAGE_W, height: STAGE_H }}
        >
          <GroundShadow phase={phase} reduced={Boolean(reducedMotion)} />

          {reducedMotion ? (
            phase !== "success" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <PlaneSvg size={PLANE_SIZE} />
              </div>
            )
          ) : (
            <>
              {phase === "launch" && <LaunchTrail />}
              {showPaper && <PaperSheet phase={phase} jot={jot} />}
              {phase === "reveal" && <FoldPuff />}
              {showPlane && <Plane phase={phase} />}
              {flying && <SpeedLines strong={phase === "launch"} />}
            </>
          )}

          {phase === "success" && <SuccessBurst />}
        </div>
      </div>

      {phase !== "success" && <MessageLine stage={stage} />}
    </motion.div>
  );
}

/** jot を載せた紙。折り目が入り、エッジオンまで回って飛行機に入れ替わる。 */
function PaperSheet({ phase, jot }: { phase: Phase; jot: string }) {
  const creasing = phase === "crease" || phase === "collapse";
  const collapsing = phase === "collapse";

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ perspective: 900 }}
    >
      <motion.div
        className="relative"
        style={{ width: PAPER_W, height: PAPER_H, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, y: 34, rotateX: 18, rotateZ: -5, scale: 0.9 }}
        animate={{
          opacity: 1,
          y: collapsing ? -10 : 0,
          rotateX: creasing ? 4 : 0,
          rotateZ: collapsing ? -2 : 0,
          rotateY: collapsing ? EDGE_ON_DEG : 0,
          // 飛行機のエッジオン時の見かけの高さに寄せて、入れ替えの継ぎ目を目立たせない。
          scale: collapsing ? 0.5 : 1,
          // 折り目が入る瞬間に紙がわずかにたわむ
          scaleY: phase === "crease" ? 0.985 : 1,
        }}
        transition={
          collapsing
            ? { duration: 0.32, ease: "easeIn" }
            : { type: "spring", stiffness: 180, damping: 18, mass: 0.9 }
        }
      >
        {/* 紙本体 */}
        <div className="absolute inset-0 overflow-hidden rounded-md border border-border bg-background shadow-[0_18px_35px_-18px_rgb(0_0_0/0.45)]">
          {/* 罫線 */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0 15px, color-mix(in oklab, var(--border) 55%, transparent) 15px 16px)",
            }}
          />
          {/* 斜めの光沢 */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(128deg, color-mix(in oklab, white 14%, transparent) 0%, transparent 46%, color-mix(in oklab, black 5%, transparent) 100%)",
            }}
          />
          <motion.p
            className="relative whitespace-pre-wrap break-words p-3.5 text-[9px] leading-4 text-muted-foreground [mask-image:linear-gradient(to_bottom,black_58%,transparent_94%)]"
            animate={{ opacity: collapsing ? 0 : 1 }}
            transition={{ duration: collapsing ? 0.18 : 0.3 }}
          >
            {jot}
          </motion.p>
        </div>

        {/* 折り目 */}
        <AnimatePresence>
          {creasing && (
            <motion.svg
              className="absolute inset-0 size-full"
              viewBox={`0 0 ${PAPER_W} ${PAPER_H}`}
              fill="none"
              aria-hidden
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              {[
                { d: `M${PAPER_W / 2} 6 L${PAPER_W / 2} ${PAPER_H - 6}`, delay: 0 },
                { d: `M${PAPER_W / 2} 10 L18 ${PAPER_H * 0.42}`, delay: 0.12 },
                { d: `M${PAPER_W / 2} 10 L${PAPER_W - 18} ${PAPER_H * 0.42}`, delay: 0.12 },
              ].map((crease) => (
                <motion.path
                  key={crease.d}
                  d={crease.d}
                  stroke="color-mix(in oklab, var(--foreground) 22%, transparent)"
                  strokeWidth={1}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.26, delay: crease.delay, ease: "easeOut" }}
                />
              ))}
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/** 紙 → 飛行機の入れ替え点で舞う粉塵。継ぎ目を隠しつつ質感を足す。 */
function FoldPuff() {
  const particles = [
    { x: -26, y: -18, size: 4, delay: 0 },
    { x: 22, y: -26, size: 3, delay: 0.04 },
    { x: -14, y: 20, size: 3.5, delay: 0.02 },
    { x: 30, y: 14, size: 2.5, delay: 0.06 },
    { x: 0, y: -34, size: 2.5, delay: 0.08 },
    { x: -34, y: 4, size: 2, delay: 0.05 },
  ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {particles.map((particle) => (
        <motion.span
          key={`${particle.x},${particle.y}`}
          className="absolute rounded-full"
          style={{
            width: particle.size,
            height: particle.size,
            background: "color-mix(in oklab, var(--primary) 55%, transparent)",
          }}
          initial={{ x: 0, y: 0, opacity: 0.7, scale: 0.6 }}
          animate={{
            x: particle.x,
            y: particle.y,
            opacity: 0,
            scale: 1.4,
          }}
          transition={{ duration: 0.5, delay: particle.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

/** 紙飛行機。エッジオンから現れ、ホバリングし、弧を描いて飛び去る。 */
function Plane({ phase }: { phase: Phase }) {
  const animate =
    phase === "reveal"
      ? { rotateY: 0, scale: 1, x: 0, y: 0, rotate: 0, opacity: 1 }
      : phase === "hover"
        ? {
            rotateY: 0,
            scale: 1,
            opacity: 1,
            x: 0,
            y: [0, -10, 0],
            rotate: [0, -3, 0],
          }
        : phase === "depart"
          ? {
              rotateY: 0,
              opacity: [1, 1, 1, 0],
              x: [0, 10, 92, 188],
              y: [0, 8, -42, -108],
              rotate: [0, -7, 5, 15],
              scale: [1, 0.98, 0.9, 0.68],
            }
          : {
              rotateY: 0,
              opacity: [1, 1, 1, 1, 0.85, 0],
              x: [0, -14, 42, 126, 216, 300],
              y: [0, 12, -28, -74, -126, -186],
              rotate: [0, -8, -2, 7, 13, 19],
              scale: [1, 0.96, 1.08, 1, 0.86, 0.66],
            };

  const transition =
    phase === "reveal"
      ? { type: "spring" as const, stiffness: 240, damping: 16, mass: 0.8 }
      : phase === "hover"
        ? { duration: 0.88, ease: "easeInOut" as const }
        : phase === "depart"
          ? { duration: 0.76, times: [0, 0.18, 0.62, 1], ease: "easeIn" as const }
          : {
              duration: 1.25,
              times: [0, 0.12, 0.32, 0.58, 0.82, 1],
              ease: "easeInOut" as const,
            };

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: 900 }}>
      <motion.div
        style={{ transformStyle: "preserve-3d" }}
        initial={{ rotateY: EDGE_ON_DEG, scale: 0.72, opacity: 1 }}
        animate={animate}
        transition={transition}
      >
        <PlaneSvg size={PLANE_SIZE} sheen={phase === "hover"} />
      </motion.div>
    </div>
  );
}

/**
 * 面ごとに陰影をつけた紙飛行機。上面 2 枚 + 胴の陰の 3 面構成で、
 * 折り目のハイライトと輪郭線を持つ。hover 時は光沢が横切る。
 */
function PlaneSvg({ size, sheen = false }: { size: number; sheen?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const farId = `plane-far-${uid}`;
  const nearId = `plane-near-${uid}`;
  const keelId = `plane-keel-${uid}`;
  const sheenId = `plane-sheen-${uid}`;
  const clipId = `plane-clip-${uid}`;

  const FAR = "112,12 6,44 54,60";
  const NEAR = "112,12 54,60 34,102";
  const KEEL = "112,12 54,60 58,74";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden
      style={{ filter: "drop-shadow(0 10px 12px rgb(0 0 0 / 0.28))" }}
    >
      <defs>
        <linearGradient id={farId} x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient id={nearId} x1="0.2" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={keelId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="50%" stopColor="white" stopOpacity="0.55" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipId}>
          <polygon points={FAR} />
          <polygon points={NEAR} />
          <polygon points={KEEL} />
        </clipPath>
      </defs>

      <polygon points={FAR} fill={`url(#${farId})`} />
      <polygon points={NEAR} fill={`url(#${nearId})`} />
      <polygon points={KEEL} fill={`url(#${keelId})`} />

      {/* 折り目のハイライトと輪郭 */}
      <path
        d="M112 12 L54 60"
        stroke="color-mix(in oklab, white 55%, transparent)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M112 12 L6 44 L54 60 L34 102 Z"
        stroke="var(--primary)"
        strokeOpacity={0.5}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />

      {sheen && (
        <g clipPath={`url(#${clipId})`}>
          <g transform="rotate(18 60 60)">
            <motion.rect
              y={-10}
              width={26}
              height={140}
              fill={`url(#${sheenId})`}
              initial={{ x: -40 }}
              animate={{ x: 130 }}
              transition={{ duration: 1.3, repeat: Infinity, repeatDelay: 0.5, ease: "easeInOut" }}
            />
          </g>
        </g>
      )}
    </svg>
  );
}

/** 接地感を出す落ち影。被写体の状態に応じて広がり・濃さが変わる。 */
function GroundShadow({ phase, reduced }: { phase: Phase; reduced: boolean }) {
  const flying = phase === "depart" || phase === "launch";
  const airborne = phase === "reveal" || phase === "hover";

  return (
    <motion.div
      aria-hidden
      className="absolute left-1/2 rounded-[50%] blur-md"
      style={{
        bottom: 14,
        width: 132,
        height: 16,
        x: "-50%",
        background: "color-mix(in oklab, var(--foreground) 22%, transparent)",
      }}
      initial={{ opacity: 0, scaleX: 0.7 }}
      animate={
        reduced
          ? { opacity: 0.35, scaleX: 0.85, scaleY: 1 }
          : flying
            ? { opacity: 0, scaleX: 1.5, scaleY: 0.6 }
            : airborne
              ? { opacity: 0.28, scaleX: 0.78, scaleY: 0.85 }
              : { opacity: 0.42, scaleX: 1, scaleY: 1 }
      }
      transition={{ duration: flying ? 0.6 : 0.45, ease: "easeOut" }}
    />
  );
}

/** 飛び立ちの軌跡。先端に向かって濃くなるグラデーションで引かれる。 */
function LaunchTrail() {
  const uid = useId().replace(/:/g, "");
  const gradientId = `trail-${uid}`;

  return (
    <svg
      className="absolute inset-0 size-full"
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
          <stop offset="55%" stopColor="var(--primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <motion.path
        d={`M${STAGE_W / 2} ${STAGE_H / 2 + 12} C ${STAGE_W / 2 + 40} ${STAGE_H / 2 - 10}, ${STAGE_W / 2 + 130} ${STAGE_H / 2 - 60}, ${STAGE_W - 4} 24`}
        stroke={`url(#${gradientId})`}
        strokeWidth={2}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.25, times: [0, 0.2, 0.7, 1], ease: "easeIn" }}
      />
    </svg>
  );
}

/** 飛行中の速度線。空気を切っている感じを足す。 */
function SpeedLines({ strong }: { strong: boolean }) {
  const lines = strong
    ? [
        { top: "42%", left: "34%", width: 34, delay: 0.18 },
        { top: "52%", left: "26%", width: 26, delay: 0.28 },
        { top: "34%", left: "44%", width: 22, delay: 0.38 },
      ]
    : [
        { top: "46%", left: "36%", width: 22, delay: 0.12 },
        { top: "56%", left: "30%", width: 16, delay: 0.22 },
      ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {lines.map((line) => (
        <motion.span
          key={`${line.top}-${line.left}`}
          className="absolute h-px rounded-full"
          style={{
            top: line.top,
            left: line.left,
            width: line.width,
            rotate: "-24deg",
            background:
              "linear-gradient(to right, transparent, color-mix(in oklab, var(--primary) 55%, transparent), transparent)",
          }}
          initial={{ opacity: 0, x: 0 }}
          animate={{ opacity: [0, 0.9, 0], x: -34 }}
          transition={{ duration: 0.44, delay: line.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

/** 成功の合図。広がるリングとチェックで「届いた」を伝える。 */
function SuccessBurst() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      <div className="relative flex items-center justify-center">
        {[0, 0.14].map((delay) => (
          <motion.span
            key={delay}
            aria-hidden
            className="absolute rounded-full border"
            style={{ width: 52, height: 52, borderColor: "var(--primary)" }}
            initial={{ opacity: 0.5, scale: 0.7 }}
            animate={{ opacity: 0, scale: 2.4 }}
            transition={{ duration: 0.85, delay, ease: "easeOut" }}
          />
        ))}
        <motion.span
          className="flex size-13 items-center justify-center rounded-full bg-primary text-primary-foreground"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 340, damping: 17 }}
        >
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.12, type: "spring", stiffness: 400, damping: 18 }}
          >
            <Check aria-hidden className="size-7" strokeWidth={3} />
          </motion.span>
        </motion.span>
      </div>
      <motion.p
        className="text-sm font-medium"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.3, ease: "easeOut" }}
      >
        起票しました！
      </motion.p>
    </div>
  );
}

/** 背景に漂う塵。 */
function Motes() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {MOTES.map((mote) => (
        <motion.span
          key={`${mote.x}-${mote.y}`}
          className="absolute rounded-full"
          style={{
            left: mote.x,
            top: mote.y,
            width: mote.size,
            height: mote.size,
            background: "color-mix(in oklab, var(--primary) 45%, transparent)",
          }}
          initial={{ opacity: 0.08 }}
          animate={{
            y: [0, -mote.drift, 0],
            x: [0, mote.drift * 0.4, 0],
            opacity: [0.08, 0.22, 0.08],
          }}
          transition={{
            duration: mote.duration,
            delay: mote.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/** ステージ別のローテーションメッセージ。2.6 秒ごとに切り替わる。 */
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
    <div
      className="relative flex h-6 items-center justify-center px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        <motion.p
          key={message}
          className="text-xs text-muted-foreground sm:text-sm"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {message}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
