import { useEffect, useRef } from 'react';

/**
 * The listening wave: white waves with black outlines, layered like a spectre, rising and
 * rippling with the voice (owner, 2026-09-25: "like Siri … waves oscillating according to
 * frequency and amplitude … specter kind of vibe, white waves black outline").
 *
 * The shape follows the Siri wave as kopiro/siriwave (MIT) builds it: sine curves under an
 * envelope of the form (K / (K + xⁿ))^K, mirrored about a centre line (here n = 4, for a
 * broader middle and quicker fall-off at the edges). The drawing is our own:
 * each wave is filled white and outlined in ink, back to front, so nearer waves cover the
 * lines behind them.
 *
 * Driven by the microphone's analyser, read every frame: four frequency bands set the
 * height of four waves, the spectral centroid sets how tightly they ripple, and loudness sets
 * how fast they drift. Heights rise fast and fall slowly. With no analyser (or before one
 * opens) it draws a calm, near-flat line. Reduced motion: ten frames a second, no drift.
 */
export interface SpectreWaveProps {
	active: boolean;
	/** The open microphone's analyser. Optional: without it the wave idles. */
	analyser?: AnalyserNode | null;
	height?: number;
}

/** Hz ranges for the four waves, back to front: low voice, body, presence, air. */
const BANDS: [number, number][] = [
	[90, 250],
	[250, 700],
	[700, 1800],
	[1800, 4500],
];
/** Per-wave shape: base ripple count, drift speed, phase offset, how much of the height it may take. */
const WAVES = [
	{ ripple: 1.1, speed: 0.55, phase: 0.0, reach: 1.0 },
	{ ripple: 1.6, speed: -0.75, phase: 1.9, reach: 0.85 },
	{ ripple: 2.3, speed: 0.95, phase: 3.7, reach: 0.7 },
	{ ripple: 3.1, speed: -1.2, phase: 5.1, reach: 0.55 },
];
const K = 2;
const envelope = (x: number) => Math.pow(K / (K + x * x * x * x), K); // x in [-2, 2]

export default function SpectreWave({ active, analyser, height = 200 }: SpectreWaveProps) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const source = useRef<AnalyserNode | null | undefined>(analyser);
	source.current = analyser;

	useEffect(() => {
		const el = canvas.current;
		const ctx = el?.getContext('2d');
		if (!el || !ctx) return;
		const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const css = getComputedStyle(el);
		const ink = css.getPropertyValue('--ink').trim() || '#1d1d1f';
		const paper = css.getPropertyValue('--surface').trim() || '#ffffff';

		let width = 0;
		const size = () => {
			const ratio = window.devicePixelRatio || 1;
			width = el.clientWidth;
			el.width = Math.round(width * ratio);
			el.height = Math.round(height * ratio);
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		};
		size();
		const onResize = () => size();
		window.addEventListener('resize', onResize);

		const amps = WAVES.map(() => 0.04); // eased heights, 0..1
		let tight = 1; // eased ripple multiplier from the spectral centroid
		let loud = 0; // eased overall loudness
		let t = 0;
		let bins: Uint8Array<ArrayBuffer> | null = null;

		const listen = () => {
			const a = source.current;
			if (!active || !a) {
				for (let i = 0; i < amps.length; i++) amps[i] = amps[i]! + (0.04 - amps[i]!) * 0.08;
				loud += (0 - loud) * 0.08;
				return;
			}
			if (!bins || bins.length !== a.frequencyBinCount) bins = new Uint8Array(a.frequencyBinCount);
			a.getByteFrequencyData(bins);
			const hzPerBin = a.context.sampleRate / 2 / bins.length;
			let sum = 0, weighted = 0;
			BANDS.forEach(([lo, hi], i) => {
				const from = Math.max(1, Math.floor(lo / hzPerBin)), to = Math.min(bins!.length - 1, Math.ceil(hi / hzPerBin));
				let e = 0;
				for (let b = from; b <= to; b++) e += bins![b]!;
				const level = Math.min(1, e / ((to - from + 1) * 255) * 1.8);
				// rise fast, fall slowly: speech reads as shapes, not flicker
				amps[i] = amps[i]! + (Math.max(0.04, level) - amps[i]!) * (level > amps[i]! ? 0.45 : 0.07);
				sum += level;
				weighted += level * (i + 1);
			});
			const centroid = sum > 0.02 ? weighted / sum : 1.5; // 1..4
			tight += (0.7 + centroid * 0.3 - tight) * 0.08;
			loud += (sum / BANDS.length - loud) * 0.2;
		};

		const draw = () => {
			const h = height, mid = h / 2, steps = Math.max(48, Math.round(width / 4));
			ctx.clearRect(0, 0, width, h);
			ctx.lineJoin = 'round';
			// the centre line, so silence still reads as "listening"
			ctx.strokeStyle = ink;
			ctx.globalAlpha = 0.25;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, mid);
			ctx.lineTo(width, mid);
			ctx.stroke();
			ctx.globalAlpha = 1;
			for (let w = 0; w < WAVES.length; w++) {
				const wave = WAVES[w]!;
				const amp = amps[w]! * wave.reach * (mid - 6);
				const ripple = wave.ripple * tight;
				const phase = wave.phase + t * wave.speed * (0.6 + loud * 2.4);
				const y = (i: number) => {
					const x = (i / steps) * 4 - 2;
					return amp * envelope(x) * Math.abs(Math.sin(ripple * x * Math.PI * 0.5 - phase));
				};
				ctx.beginPath();
				for (let i = 0; i <= steps; i++) ctx.lineTo((i / steps) * width, mid - y(i));
				for (let i = steps; i >= 0; i--) ctx.lineTo((i / steps) * width, mid + y(i));
				ctx.closePath();
				ctx.fillStyle = paper;
				ctx.fill();
				ctx.strokeStyle = ink;
				ctx.lineWidth = 1.75;
				ctx.stroke();
			}
		};

		let raf = 0, timer: ReturnType<typeof setInterval> | undefined, last = performance.now();
		const frame = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			if (!still) t += dt;
			listen();
			draw();
		};
		if (still) timer = setInterval(() => frame(performance.now()), 100);
		else {
			const loop = (now: number) => {
				frame(now);
				raf = requestAnimationFrame(loop);
			};
			raf = requestAnimationFrame(loop);
		}
		return () => {
			cancelAnimationFrame(raf);
			clearInterval(timer);
			window.removeEventListener('resize', onResize);
		};
	}, [active, height]);

	return <canvas ref={canvas} className="k-spectre" style={{ height }} aria-hidden="true" />;
}
