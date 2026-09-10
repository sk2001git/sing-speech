import type { Card } from '../lib/cards';
import { canPress, type SessionState } from '../lib/session';

interface Props {
	state: SessionState;
	cards: Card[];
	onPress: () => void;
	onConfirm: (accepted: boolean) => void;
	onStepDone: () => void;
}

/** Wording for each way the microphone can be unavailable. One instruction each. */
const MIC_HELP: Record<string, string> = {
	permission: 'Please allow microphone access, then press the green button.',
	'no-device': 'I cannot find a microphone on this device.',
	insecure: 'This page needs a secure connection to use the microphone.',
};

/**
 * Every pixel, and nothing else.
 *
 * No network, no microphone, no timers, no effects. That is what lets the dev route in
 * Task 5 render any state from a query string, and it is the same rule `FakeProvider`
 * already enforces on the backend: if it cannot be driven by a plain object, the state
 * is hiding somewhere it cannot be tested.
 */
export default function ScreenView({ state, cards, onPress, onConfirm, onStepDone }: Props) {
	const recording = state.phase === 'recording';
	const working = state.phase === 'submitting';

	return (
		<main className="mx-auto flex min-h-svh max-w-xl flex-col justify-between px-6 py-8">
			<div className="pt-6">
				{recording && (
					<p className="text-live mb-6 text-[length:var(--text-micro)] font-semibold">
						Listening. Press the button again when you finish.
					</p>
				)}

				<p className="text-[length:var(--text-title)] font-semibold leading-tight text-balance">
					{state.screen.say}
				</p>

				{/* Height reserved whether or not there is text, so the question above never
				    jumps as words arrive. A moving target is hard to read for anyone. */}
				<div className="mt-8 min-h-28" aria-live="polite">
					{recording && (
						<>
							<p className="text-quiet text-[length:var(--text-micro)]">I am hearing</p>
							<p className="text-ink mt-1 text-[length:var(--text-lead)] leading-snug">
								{state.heard || '…'}
								<span className="caret" aria-hidden="true" />
							</p>
						</>
					)}
					{cards.map((card) => (
						<CardView key={card.key} card={card} onStepDone={onStepDone} />
					))}
				</div>

				{state.phase === 'denied' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						{MIC_HELP[state.reason] ?? MIC_HELP.permission}
					</p>
				)}

				{state.phase === 'offline' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						I could not reach the service. Please check your connection and try again.
					</p>
				)}

				{state.screen.kind === 'repeat' && (
					<p className="text-quiet mt-6 text-[length:var(--text-lead)]">
						For example: &ldquo;{state.screen.example}&rdquo;
					</p>
				)}
			</div>

			<div className="space-y-4 pb-2">
				{state.phase === 'readback' && state.screen.kind === 'confirm' && (
					<>
						<button className="tap tap-quiet" onClick={() => onConfirm(true)}>
							{state.screen.yes}
						</button>
						<button className="tap tap-quiet" onClick={() => onConfirm(false)}>
							{state.screen.no}
						</button>
					</>
				)}

				<button
					className="tap tap-speak"
					data-live={recording}
					onClick={onPress}
					disabled={!recording && !canPress(state)}
					aria-label={recording ? 'Stop speaking' : 'Press to speak'}
				>
					{working ? 'One moment' : recording ? 'I have finished' : 'Press to speak'}
				</button>
			</div>
		</main>
	);
}

function CardView({ card, onStepDone }: { card: Card; onStepDone: () => void }) {
	switch (card.kind) {
		case 'heard':
			return (
				<>
					<p className="text-quiet text-[length:var(--text-micro)]">You said</p>
					<p className="text-quiet mt-1 text-[length:var(--text-lead)] leading-snug">
						{card.text}
					</p>
				</>
			);

		case 'fact':
			return (
				<div className="mt-7">
					<p className="text-quiet m-0 text-[length:var(--text-micro)]">{card.label}</p>
					<p className="m-0 text-[length:var(--text-lead)] font-semibold">{card.value}</p>
				</div>
			);

		case 'contact':
			return (
				<a
					href={`tel:${card.phone.replace(/\s/g, '')}`}
					className="tap tap-quiet mt-10 text-center no-underline"
				>
					{card.label}
				</a>
			);

		case 'step':
			return (
				<div className="step" data-state={card.state}>
					<p className="text-quiet m-0 text-[length:var(--text-micro)]">
						Step {card.index} of {card.of}
					</p>
					<p className="m-0 text-[length:var(--text-lead)] font-semibold">
						{card.instruction}
					</p>
					{card.state === 'active' && card.image && (
						<img
							className="mt-4 rounded-xl"
							src={card.image.src}
							alt={card.image.alt.en}
							/* Dimensions are reserved by CSS aspect-ratio so arrival shifts nothing. */
						/>
					)}
					{card.state === 'active' && (
						<button className="tap tap-quiet mt-5" onClick={onStepDone}>
							Done, what is next
						</button>
					)}
				</div>
			);
	}
}
