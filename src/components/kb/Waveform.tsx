import { useEffect, useRef } from 'react';

/**
 * The live waveform while the microphone is open.
 *
 * Ported by hand from ElevenLabs UI's `live-waveform` (MIT, github.com/elevenlabs/ui):
 * the same idea — a history of loudness drawn as rounded bars scrolling away from the
 * newest — rewritten to take levels the driver already measures, to use our tokens, and
 * to carry no dependencies. It draws nothing when the microphone is closed, and stops
 * entirely when the device asks for reduced motion.
 */
export interface WaveformProps {
	active: boolean;
	/** Most recent loudness, 0 to 1, updated about ten times a second. */
	level: number;
	height?: number;
	bars?: number;
}

export default function Waveform({ active, level, height = 44, bars = 28 }: WaveformProps) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const history = useRef<number[]>([]);
	const latest = useRef(0);
	latest.current = level;

	useEffect(() => {
		const el = canvas.current;
		if (!el) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;

		const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const colour = getComputedStyle(el).getPropertyValue('--live').trim() || '#d70015';
		let timer: ReturnType<typeof setInterval> | undefined;

		const size = () => {
			const ratio = window.devicePixelRatio || 1;
			const width = el.clientWidth;
			el.width = width * ratio;
			el.height = height * ratio;
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			return width;
		};

		const draw = () => {
			const width = size();
			ctx.clearRect(0, 0, width, height);
			const gap = 3;
			const barWidth = Math.max(3, (width - gap * (bars - 1)) / bars);
			const radius = barWidth / 2;
			ctx.fillStyle = colour;
			for (let i = 0; i < bars; i++) {
				// Newest on the right; older bars fade as they travel left.
				const value = history.current[history.current.length - bars + i] ?? 0;
				const loud = Math.min(1, value * 6);
				const barHeight = Math.max(barWidth, loud * height);
				const x = i * (barWidth + gap);
				const y = (height - barHeight) / 2;
				ctx.globalAlpha = 0.25 + (i / bars) * 0.75;
				ctx.beginPath();
				ctx.roundRect(x, y, barWidth, barHeight, radius);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		};

		if (!active) {
			history.current = [];
			draw();
			return;
		}

		const tick = () => {
			history.current.push(latest.current);
			if (history.current.length > bars * 2) history.current.shift();
			draw();
		};
		tick();
		if (!still) timer = setInterval(tick, 100);
		return () => clearInterval(timer);
	}, [active, height, bars]);

	return <canvas ref={canvas} className="k-wave-canvas" style={{ height }} aria-hidden="true" />;
}
