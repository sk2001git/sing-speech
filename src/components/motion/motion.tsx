// modern-ui 0.2.2, copied from knowledge-store/skills/modern-ui/primitives. Change the skill, then copy again.
/**
 * Motion primitives — the layer between shadcn/ui (structure) and taste.json (feel).
 * Copy this folder into the project (e.g. src/components/motion/) and import motion.css once.
 * No dependencies beyond React. Works alongside shadcn: pass `className={buttonVariants()}`
 * to MorphButton, wrap a shadcn <Card> in <AiGlow>, etc.
 */
import * as React from "react";
import taste from "./taste.json";
import "./motion.css";

export type MarkVariant = "filled" | "soft" | "outline" | "bare";
export type Flourish = "none" | "ripple" | "burst" | "glow";
export type ActionStatus = "idle" | "pending" | "success" | "error";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** CSS variables for the current taste. Spread onto the app root: <body style={tasteVars()}>. */
export function tasteVars(t: typeof taste = taste): React.CSSProperties {
  return {
    "--mx-accent": t.accent,
    "--mx-accent-fg": t.accentForeground,
    "--mx-light": t.light ?? t.accent,
    "--mx-ease": t.motion.ease,
    "--mx-draw": t.motion.draw,
    "--mx-t": String(t.tempo),
    "--mx-stroke": String(t.stroke),
    "--mx-r": `${t.radius.panel}px`,
    "--mx-rb": t.radius.button >= 999 ? "999px" : `${t.radius.button}px`,
  } as React.CSSProperties;
}

/* ─────────────────────────── SuccessMark ───────────────────────────
   The one confirmation symbol used everywhere. Animates on mount; change `key` to replay.
   `label={null}` when words beside it already say what it means, so it is not read twice.
   `stroke` overrides the taste's stroke width (px), e.g. heavier on a large mark. */
export function SuccessMark({
  size = 48, delay = 0, variant = taste.mark as MarkVariant, flourish = taste.flourish as Flourish,
  label = "Done", stroke, className,
}: { size?: number; delay?: number; variant?: MarkVariant; flourish?: Flourish; label?: string | null; stroke?: number; className?: string }) {
  const a11y = label === null ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <span {...a11y} className={cx("mx-mark", className)} data-variant={variant} data-flourish={flourish}
      style={{ "--mx-size": `${size}px`, "--mx-sizen": size, "--mx-delay": `${delay}s`, ...(stroke != null && { "--mx-stroke": stroke }) } as React.CSSProperties}>
      <span className="mx-fx mx-fx-glow" />
      <span className="mx-fx mx-fx-ripple" />
      <span className="mx-fx mx-fx-burst">
        {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ "--a": `${i * 45}deg` } as React.CSSProperties} />)}
      </span>
      <span className="mx-disc" />
      <svg className="mx-ring" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10.8" pathLength={1} /></svg>
      <svg className="mx-tick" viewBox="0 0 24 24" aria-hidden><path d="M7.4 12.4l3.1 3.1 6.2-6.4" pathLength={1} /></svg>
    </span>
  );
}

/* ─────────────────────────── MorphButton ───────────────────────────
   Primary action that collapses into a spinner and resolves into the SuccessMark, in place.
   The parent owns `status`. The spinner waits 150 ms so fast responses never flash a loader. */
export function MorphButton({
  status = "idle", fullWidth = false, children, className, style, disabled, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { status?: ActionStatus; fullWidth?: boolean }) {
  const labelRef = React.useRef<HTMLSpanElement>(null);
  const [w, setW] = React.useState<number>();
  const [spin, setSpin] = React.useState(false);
  const collapsed = status === "pending" || status === "success";

  React.useLayoutEffect(() => {
    if (!collapsed && labelRef.current) setW(labelRef.current.offsetWidth + 40);
  }, [children, collapsed]);
  React.useEffect(() => {
    if (status !== "pending") { setSpin(false); return; }
    const t = setTimeout(() => setSpin(true), 150);
    return () => clearTimeout(t);
  }, [status]);

  const width = collapsed ? "var(--mx-h)" : fullWidth ? "100%" : w;
  const btn = (
    <button {...props} className={cx("mx-morph", className)} data-status={status} data-mark={taste.mark}
      aria-busy={status === "pending"} aria-live="polite" disabled={disabled || collapsed} style={{ ...style, width }}>
      <span ref={labelRef} className="mx-morph-label">{children}</span>
      {status === "pending" && <span className="mx-spinner" data-visible={spin} aria-hidden />}
      {status === "success" && <SuccessMark size={44} />}
    </button>
  );
  return fullWidth ? <div className="mx-morph-wrap">{btn}</div> : btn;
}

/* ─────────────────────────── SwapText ───────────────────────────
   Crossfades when `value` changes ("Sending…" → "Sent"). The first value renders without motion. */
export function SwapText({ value, className }: { value: string | number; className?: string }) {
  const [items, setItems] = React.useState([{ key: 0, v: value, state: "static" as "static" | "in" | "out" }]);
  const last = React.useRef(value), n = React.useRef(0);
  React.useEffect(() => {
    if (last.current === value) return;
    last.current = value; const key = ++n.current;
    setItems(it => [...it.filter(x => x.state !== "out").map(x => ({ ...x, state: "out" as const })), { key, v: value, state: "in" as const }]);
    const t = setTimeout(() => setItems(it => it.filter(x => x.state !== "out")), 320);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className={cx("mx-swap", className)} aria-live="polite">
      {items.map(x => <span key={x.key} className={x.state === "in" ? "mx-swap-in" : x.state === "out" ? "mx-swap-out" : undefined}
        aria-hidden={x.state === "out" || undefined}>{x.v}</span>)}
    </span>
  );
}

/* ─────────────────────────── ProgressFill ─────────────────────────── */
export function ProgressFill({ value, className, label = "Progress" }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cx("mx-progress", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ transform: `scaleX(${v})` }} />
    </div>
  );
}

/* ─────────────────────────── StepTracker ───────────────────────────
   Steps before `current` are done (ticked, link filled); `current` pulses. */
export function StepTracker({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <div className={cx("mx-steps", className)}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span className="mx-step-link" data-done={current >= i}><i /></span>}
          <div className="mx-step" data-state={i < current ? "done" : i === current ? "active" : "todo"}>
            <span className="mx-step-dot">{i < current && <SuccessMark size={22} delay={0.15} label={`${s} done`} />}</span>
            <span>{s}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ─────────────────────────── TypingDots ─────────────────────────── */
export function TypingDots({ className, label = "Typing" }: { className?: string; label?: string }) {
  return <span className={cx("mx-typing", className)} role="status" aria-label={label}><i /><i /><i /></span>;
}

/* ─────────────────────────── EdgeBolt ───────────────────────────
   A small light travels the border while the card loads, then lights the whole edge once
   when it lands. "off" → "run" → "land" (put a SuccessMark in the card on land) → "off".
   Compositor-only: see the edge-light note in motion.css. The child needs an opaque background. */
export type EdgeState = "off" | "run" | "land";
type EdgeProps = {
  state: EdgeState; radius?: number; width?: number; halo?: boolean; lapMs?: number;
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
};
function Edge({ kind, state, radius, width, halo = true, lapMs, twin, children, className, style }: EdgeProps & { kind: string; twin?: boolean }) {
  const vars = {
    ...(radius != null && { "--mx-edge-r": `${radius}px` }),
    ...(width != null && { "--mx-edge-w": `${width}px` }),
    ...(lapMs != null && { "--mx-edge-lap": `${lapMs / 1000}s` }),
  } as React.CSSProperties;
  return (
    <div className={cx("mx-edge", kind, className)} data-state={state} data-twin={twin || undefined}
      aria-busy={state === "run"} style={{ ...vars, ...style }}>
      {halo && <span className="mx-edge-halo" aria-hidden><span><i /></span></span>}
      <span className="mx-edge-ring" aria-hidden><i /></span>
      {children}
    </div>
  );
}
export function EdgeBolt({ twin, ...p }: EdgeProps & { twin?: boolean }) {
  return <Edge kind="mx-bolt" twin={twin} {...p} />;
}

/* ─────────────────────────── AiGlow ───────────────────────────
   The multicolour edge light, for content an AI is working on. Same core as EdgeBolt. */
export function AiGlow({ active, ...p }: Omit<EdgeProps, "state"> & { active: boolean }) {
  return <Edge kind="mx-glow" state={active ? "run" : "off"} {...p} />;
}

/* ─────────────────────────── LevelRing ───────────────────────────
   Wrap a round microphone button. `level` is loudness 0–1 (RMS, already smoothed or not):
   the inner disc follows it within ~90 ms, the outer ring trails for ~420 ms. The level is
   written straight to a CSS variable, so the child does not re-render per frame.
   Feed it at the analyser's cadence (every 50–60 ms), not from requestAnimationFrame: with
   the smoothing transitions a rAF driver measured 60 restyles/s against 34 (0 paints either). */
export function LevelRing({ active, level, reach = 0.5, color, children, className }: {
  active: boolean; level: number; reach?: number; color?: string; children: React.ReactNode; className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    ref.current?.style.setProperty("--mx-level", String(active ? Math.max(0, Math.min(1, level)) : 0));
  }, [active, level]);
  return (
    <span ref={ref} className={cx("mx-level", className)} data-active={active}
      style={{ "--mx-level-reach": reach, ...(color && { "--mx-level-c": color }) } as React.CSSProperties}>
      <span className="mx-level-disc" data-layer="outer" aria-hidden />
      <span className="mx-level-disc" data-layer="inner" aria-hidden />
      {children}
    </span>
  );
}

/* ─────────────────────────── useFillFrom ───────────────────────────
   A colour grows from the touch point until it covers the host (a yes/no card, a chip).
   Spread `host` onto the element and render `fill` inside it. Keyboard activation fills
   from the centre. `reset()` clears it.

     const f = useFillFrom<HTMLButtonElement>({ color: "var(--ok)" });
     <button {...f.host} onClick={yes}>{f.fill}Yes</button>                              */
export function useFillFrom<T extends HTMLElement>({ color, fg = "#fff" }: { color?: string; fg?: string } = {}) {
  const ref = React.useRef<T>(null);
  const [at, setAt] = React.useState<{ x: number; y: number; d: number; n: number } | null>(null);
  const start = React.useCallback((px?: number, py?: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = px == null ? r.width / 2 : px - r.left, y = py == null ? r.height / 2 : py - r.top;
    // diameter reaches the farthest corner from the touch point
    const d = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    setAt(a => ({ x, y, d, n: (a?.n ?? 0) + 1 }));
  }, []);
  const host = {
    ref,
    className: "mx-fill-host",
    "data-filled": at ? "true" : undefined,
    style: { "--mx-fill-fg": fg } as React.CSSProperties,
    onPointerDown: (e: React.PointerEvent<T>) => start(e.clientX, e.clientY),
    onKeyDown: (e: React.KeyboardEvent<T>) => { if (e.key === "Enter" || e.key === " ") start(); },
  };
  const fill = at && (
    <span key={at.n} className="mx-fill" aria-hidden
      style={{ left: at.x, top: at.y, width: at.d, height: at.d, ...(color && { "--mx-fill-c": color }) } as React.CSSProperties} />
  );
  return { host, fill, reset: () => setAt(null), filled: at != null };
}

/* ─────────────────────────── useAction ───────────────────────────
   Drives MorphButton from an async function: idle → pending → success (→ idle after `resetMs`) or error. */
export function useAction<A extends unknown[]>(fn: (...a: A) => Promise<unknown>, { resetMs = 1600 } = {}) {
  const [status, setStatus] = React.useState<ActionStatus>("idle");
  const run = React.useCallback(async (...a: A) => {
    setStatus("pending");
    try { await fn(...a); setStatus("success"); if (resetMs > 0) setTimeout(() => setStatus("idle"), resetMs); }
    catch (e) { setStatus("error"); setTimeout(() => setStatus("idle"), 400); throw e; }
  }, [fn, resetMs]);
  return { status, run };
}
