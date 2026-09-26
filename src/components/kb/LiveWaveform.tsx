import { useEffect, useRef } from 'react';

/**
 * The listening waveform: ElevenLabs UI's LiveWaveform (github.com/elevenlabs/ui, MIT,
 * Copyright (c) 2025 Eleven Labs Inc.), at the settings the owner chose from its demo
 * (2026-09-27): static mirrored bars, 3 px wide with 2 px gaps, faded edges, grey, 80 px tall.
 *
 * Ported, not installed: Suara has no Tailwind or shadcn. One real change: the original opens
 * its own microphone. Suara already has one open for the recording, and a second
 * getUserMedia would prompt twice and compete with it, so this reads the analyser Suara
 * shares. It also redraws only when new data arrives, not every frame, and with reduced
 * motion reads ten times a second instead of thirty.
 */
export interface LiveWaveformProps {
	active: boolean;
	/** The open microphone's analyser. Without it the waveform rests on its dotted line. */
	analyser?: AnalyserNode | null;
	height?: number;
	barWidth?: number;
	barGap?: number;
	barRadius?: number;
	barColor?: string;
	/** Shortest bar, in px, so silence still shows a row of dots. */
	barHeight?: number;
	fadeEdges?: boolean;
	fadeWidth?: number;
	sensitivity?: number;
	/** Milliseconds between readings. */
	updateRate?: number;
}

/**
 * One frame of frequency data as mirrored bars, 0.05 to 1. The voice band (5% to 40% of the
 * bins) runs from the centre outwards, lowest in the middle, the same on both sides.
 */
export function staticBars(bins: Uint8Array, barCount: number, sensitivity = 1): number[] {
	const relevant = bins.slice(Math.floor(bins.length * 0.05), Math.floor(bins.length * 0.4));
	const half = Math.floor(barCount / 2);
	const at = (i: number) => Math.max(0.05, Math.min(1, ((relevant[Math.floor((i / half) * relevant.length)] ?? 0) / 255) * sensitivity));
	const bars: number[] = [];
	for (let i = half - 1; i >= 0; i--) bars.push(at(i));
	for (let i = 0; i < half; i++) bars.push(at(i));
	return bars;
}

export default function LiveWaveform({
	active,
	analyser,
	height = 80,
	barWidth = 3,
	barGap = 2,
	barRadius = 1.5,
	barColor = 'gray',
	barHeight = 4,
	fadeEdges = true,
	fadeWidth = 24,
	sensitivity = 1,
	updateRate = 30,
}: LiveWaveformProps) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const source = useRef<AnalyserNode | null | undefined>(analyser);
	source.current = analyser;

	useEffect(() => {
		const el = canvas.current;
		const ctx = el?.getContext('2d');
		if (!el || !ctx) return;
		const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const every = still ? Math.max(100, updateRate) : updateRate;

		let width = 0;
		let fade: CanvasGradient | null = null;
		let bars: number[] = [];
		const size = () => {
			const ratio = window.devicePixelRatio || 1;
			width = el.clientWidth;
			el.width = Math.round(width * ratio);
			el.height = Math.round(height * ratio);
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			fade = null;
			draw();
		};

		const draw = () => {
			ctx.clearRect(0, 0, width, height);
			const step = barWidth + barGap;
			const count = Math.floor(width / step);
			const mid = height / 2;
			ctx.fillStyle = barColor;
			for (let i = 0; i < count && i < bars.length; i++) {
				const value = bars[i] ?? 0.1;
				const h = Math.max(barHeight, value * height * 0.8);
				ctx.globalAlpha = 0.4 + value * 0.6;
				ctx.beginPath();
				ctx.roundRect(i * step, mid - h / 2, barWidth, h, barRadius);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			if (fadeEdges && fadeWidth > 0 && width > 0) {
				if (!fade) {
					const edge = Math.min(0.3, fadeWidth / width);
					fade = ctx.createLinearGradient(0, 0, width, 0);
					fade.addColorStop(0, 'rgba(255,255,255,1)');
					fade.addColorStop(edge, 'rgba(255,255,255,0)');
					fade.addColorStop(1 - edge, 'rgba(255,255,255,0)');
					fade.addColorStop(1, 'rgba(255,255,255,1)');
				}
				// destination-out removes the bars under the opaque ends, so the edges fade out.
				ctx.globalCompositeOperation = 'destination-out';
				ctx.fillStyle = fade;
				ctx.fillRect(0, 0, width, height);
				ctx.globalCompositeOperation = 'source-over';
			}
		};

		const observer = new ResizeObserver(size);
		observer.observe(el);
		size();

		let raf = 0;
		let last = 0;
		let data: Uint8Array<ArrayBuffer> | null = null;
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			const a = source.current;
			if (!active || !a || now - last < every) return;
			last = now;
			if (!data || data.length !== a.frequencyBinCount) data = new Uint8Array(a.frequencyBinCount);
			a.getByteFrequencyData(data);
			bars = staticBars(data, Math.floor(width / (barWidth + barGap)), sensitivity);
			draw();
		};
		raf = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	}, [active, height, barWidth, barGap, barRadius, barColor, barHeight, fadeEdges, fadeWidth, sensitivity, updateRate]);

	return (
		<div className="k-livewave" role="img" aria-label={active ? 'Live audio waveform' : 'Audio waveform idle'} data-idle={!active || !analyser} style={{ height }}>
			<canvas ref={canvas} aria-hidden="true" />
		</div>
	);
}
