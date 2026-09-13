import type { ReactNode } from 'react';
import type { Card } from '../lib/cards';
import type { Mode } from '../lib/mode';
import { localise, stepById, successors, type Procedure } from '../lib/procedure';
import { readbackFor } from '../lib/readback';
import { canPress, type SessionState } from '../lib/session';
import { HELPLINE, type Screen } from '../lib/uispec';
import type { Language } from '../lib/understanding';

/** Wording for each way the microphone can be unavailable. One instruction each. */
export const MIC_HELP: Record<string, string> = {
	permission: 'Please allow the microphone, then press the button again.',
	'no-device': 'I cannot find a microphone on this phone.',
	insecure: 'This page needs a secure connection to use the microphone.',
};

export const OFFLINE_HELP =
	'I could not reach the service. Please check your connection, then press the button and try again.';

const MODE_LABEL: Record<Mode, string> = {
	gemini: 'Gemini 3.5 Flash-Lite',
	openai: 'OpenAI Realtime',
};

type StepCard = Extract<Card, { kind: 'step' }>;
type Readback = Extract<SessionState, { phase: 'readback' }>;
type Guiding = Extract<SessionState, { phase: 'guiding' }>;

interface Props {
	state: SessionState;
	cards: Card[];
	procedure: Procedure | null;
	lang: Language;
	mode: Mode;
	demo: boolean;
	onPress: () => void;
	onContinue: () => void;
	onStep: (answer?: boolean) => void;
	onReplay: () => void;
}

const tel = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

/**
 * Every pixel, and nothing else.
 *
 * No network, no microphone, no timers, no effects: anything shown here can be rendered
 * from a plain `SessionState`. The look follows the Clarion direction the owner chose on
 * 2026-09-13 — a calm monochrome ground, white cards, one black primary action — with the
 * accessibility floor kept underneath it: 72px actions, no text under 16px, no webfont.
 */
export default function ScreenView(props: Props) {
	return (
		<div className="app">
			<header className="bar">
				<div className="bar-inner">
					<div className="brand">
						<span className="brand-mark" aria-hidden="true">
							<WaveIcon />
						</span>
						<span className="brand-text">
							<strong>Suara</strong>
							<small>Voice help</small>
						</span>
					</div>
					<div className="bar-actions">
						<a className="pill-btn" href={tel(HELPLINE)} aria-label={`Call the helpline, ${HELPLINE}`}>
							<PhoneIcon className="icon-alert" />
							<span>Help</span>
						</a>
						<button className="round-btn" type="button" onClick={props.onReplay} aria-label="Say that again">
							<SpeakerIcon />
						</button>
					</div>
				</div>
			</header>

			<main className="page">
				<StatusChip state={props.state} />
				<Body {...props} />
				<p className="reassure">
					<EarIcon />
					<span>Take your time. Suara waits until you tap to say you have finished.</span>
				</p>
				<p className="meta">
					Understanding with {MODE_LABEL[props.mode]}
					{props.demo ? ' · demo mode' : ''}
				</p>
			</main>
		</div>
	);
}

function Body(props: Props) {
	const { state } = props;
	if (state.phase === 'readback') return <ReadbackView {...props} state={state} />;
	if (state.phase === 'guiding') return <GuideView {...props} state={state} />;
	return <TalkView {...props} />;
}

const CHIP: Record<SessionState['phase'], { text: string; tone: 'ready' | 'live' | 'busy' | 'alert' }> = {
	idle: { text: 'Suara is ready', tone: 'ready' },
	arming: { text: 'Getting the microphone ready', tone: 'busy' },
	recording: { text: 'Listening', tone: 'live' },
	submitting: { text: 'Understanding what you said', tone: 'busy' },
	readback: { text: 'Please check', tone: 'busy' },
	guiding: { text: 'Step by step', tone: 'ready' },
	answering: { text: 'Speaking', tone: 'busy' },
	denied: { text: 'Microphone needed', tone: 'alert' },
	offline: { text: 'No connection', tone: 'alert' },
};

function StatusChip({ state }: { state: SessionState }) {
	const chip = CHIP[state.phase];
	return (
		<p className="chip" data-tone={chip.tone} role="status">
			<span className="chip-dot" aria-hidden="true" />
			{chip.text}
		</p>
	);
}

function headlineFor(state: SessionState): string {
	switch (state.phase) {
		case 'arming':
			return 'Getting ready to listen';
		case 'recording':
			return 'I am listening';
		case 'submitting':
			return 'Understanding what you said';
		case 'denied':
			return 'I need the microphone';
		case 'offline':
			return 'I could not connect';
		default:
			switch (state.screen.kind) {
				case 'answer':
					return state.screen.title;
				case 'repeat':
					return 'Let us try that again';
				case 'handoff':
					return 'Let me get you a person';
				default:
					return state.screen.say;
			}
	}
}

function TalkView({ state, onPress }: Props) {
	const live = state.phase === 'recording';
	const waiting = state.phase === 'arming' || state.phase === 'submitting';
	const settled = state.phase === 'idle' || state.phase === 'answering';
	const notice =
		state.phase === 'denied'
			? (MIC_HELP[state.reason] ?? MIC_HELP.permission)
			: state.phase === 'offline'
				? OFFLINE_HELP
				: null;

	const label = live
		? 'Tap when you have finished'
		: waiting
			? 'One moment'
			: state.phase === 'answering'
				? 'Listen, then tap to speak'
				: 'Tap to speak';

	return (
		<>
			<h1 className="headline">{headlineFor(state)}</h1>
			{state.phase === 'idle' && state.screen.kind === 'listening' && (
				<p className="lead">Tap the big button and say it in your own words.</p>
			)}
			{settled && <ScreenCard screen={state.screen} />}
			{notice && (
				<article className="card card-notice">
					<p className="card-text">{notice}</p>
				</article>
			)}

			<section className="orb-zone">
				<button
					className="orb"
					type="button"
					data-live={live}
					onClick={onPress}
					disabled={!live && !canPress(state)}
					aria-label={live ? 'I have finished speaking' : 'Press to speak'}
				>
					{live ? <StopIcon /> : waiting ? <DotsIcon /> : <MicIcon />}
				</button>
				<div className="wave" data-on={live} aria-hidden="true">
					{[0, 1, 2, 3, 4].map((i) => (
						<i key={i} />
					))}
				</div>
				<p className="orb-label" aria-live="polite">
					{label}
				</p>
			</section>
		</>
	);
}

function ScreenCard({ screen }: { screen: Screen }): ReactNode {
	switch (screen.kind) {
		case 'listening':
			return null;
		case 'answer':
			return (
				<article className="card">
					<p className="label">Suara says</p>
					<p className="card-text">{screen.say}</p>
					{screen.facts.length > 0 && (
						<dl className="facts">
							{screen.facts.map((f) => (
								<div key={f.label} className="fact">
									<dt>{f.label}</dt>
									<dd>{f.value}</dd>
								</div>
							))}
						</dl>
					)}
				</article>
			);
		case 'repeat':
			return (
				<article className="card">
					<p className="card-text">{screen.say}</p>
					<p className="label label-gap">You can say something like</p>
					<p className="quote">&ldquo;{screen.example}&rdquo;</p>
				</article>
			);
		case 'handoff':
			return (
				<article className="card">
					<p className="card-text">{screen.say}</p>
					<a className="btn btn-primary btn-gap" href={tel(screen.phone)}>
						<PhoneIcon />
						Call {screen.phone}
					</a>
				</article>
			);
		case 'confirm':
			return (
				<article className="card">
					<p className="card-text">{screen.say}</p>
				</article>
			);
	}
}

function Tracker({ active }: { active: 2 | 3 }) {
	const items = ['Heard', 'Check', 'Steps'];
	return (
		<ol className="tracker" aria-label="Progress">
			{items.map((name, i) => {
				const n = i + 1;
				const status = n < active ? 'done' : n === active ? 'active' : 'future';
				return (
					<li key={name} data-state={status} aria-current={status === 'active' ? 'step' : undefined}>
						<span className="tracker-dot">{status === 'done' ? <CheckIcon /> : n}</span>
						<span className="tracker-name">{name}</span>
					</li>
				);
			})}
		</ol>
	);
}

function ReadbackView({ state, onContinue, onPress, onReplay }: Props & { state: Readback }) {
	const view = readbackFor(state);
	const screen = state.screen;

	if (!view.canContinue) {
		return (
			<>
				<Tracker active={2} />
				<h1 className="headline">{headlineFor(state)}</h1>
				<ScreenCard screen={screen} />
				<div className="actions">
					<button
						className={`btn ${screen.kind === 'handoff' ? 'btn-quiet' : 'btn-primary'}`}
						type="button"
						onClick={onPress}
					>
						<MicIcon />
						{screen.kind === 'handoff' ? 'Or say it again' : 'Say it again'}
					</button>
				</div>
			</>
		);
	}

	return (
		<>
			<Tracker active={2} />
			<h1 className="headline">Have I got this right?</h1>
			<article className="card card-readback">
				<div className="card-top">
					<p className="label">Suara understood</p>
					<button className="link-btn" type="button" onClick={onReplay}>
						<SpeakerIcon />
						Read aloud
					</button>
				</div>
				<p className="readback">{view.sentence}</p>
			</article>
			<div className="actions">
				<button className="btn btn-primary" type="button" onClick={onContinue}>
					<CheckIcon />
					Yes, that is right
				</button>
				<button className="btn btn-quiet" type="button" onClick={onPress}>
					<MicIcon />
					No, let me say it again
				</button>
			</div>
		</>
	);
}

/**
 * Steps already done, the current one, and the ones still reachable from it.
 *
 * A branch arm the user did not take is hidden once it is behind them — otherwise
 * "call the hospital" would sit in the list as a step still to do after they said they
 * already have their letter.
 */
function visibleSteps(cards: StepCard[], proc: Procedure, cursorStep: string): StepCard[] {
	const ahead = new Set<string>();
	const queue = [cursorStep];
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (ahead.has(id)) continue;
		ahead.add(id);
		const step = stepById(proc, id);
		if (step) queue.push(...successors(step));
	}
	return cards.filter((card) => {
		const id = proc.steps[card.index - 1]?.id;
		return card.state === 'done' || (id !== undefined && ahead.has(id));
	});
}

function GuideView({ state, cards, procedure, lang, onStep, onPress }: Props & { state: Guiding }) {
	const steps = cards.filter((c): c is StepCard => c.kind === 'step');

	if (!procedure || steps.length === 0) {
		return (
			<>
				<h1 className="headline">I cannot show these steps yet</h1>
				<article className="card">
					<p className="card-text">They have not been checked yet. A person on the helpline can take you through it.</p>
					<a className="btn btn-primary btn-gap" href={tel(HELPLINE)}>
						<PhoneIcon />
						Call {HELPLINE}
					</a>
				</article>
				<div className="actions">
					<button className="btn btn-quiet" type="button" onClick={onPress}>
						<MicIcon />
						Ask something else
					</button>
				</div>
			</>
		);
	}

	const shown = visibleSteps(steps, procedure, state.cursor.stepId);
	const position = shown.findIndex((c) => c.state === 'active') + 1;

	return (
		<>
			<Tracker active={3} />
			{procedure.sample && (
				<p className="sample-banner">
					<InfoIcon />
					<span>Sample steps for review. Not checked with any hospital.</span>
				</p>
			)}
			<div className="guide-head">
				<p className="label">
					Step {position} of {shown.length}
				</p>
				<h1 className="headline">{localise(procedure.title, lang)}</h1>
			</div>

			<ol className="timeline">
				{shown.map((card, i) => {
					const step = procedure.steps[card.index - 1]!;
					const branch = step.next !== null && typeof step.next === 'object' ? step.next : null;
					return (
						<li key={card.key} className="tl-item" data-state={card.state}>
							<span className="tl-dot" aria-hidden="true">
								{card.state === 'done' ? <CheckIcon /> : i + 1}
							</span>
							<div className="tl-body">
								<p className="tl-text">{card.instruction}</p>
								{card.state === 'active' && card.image && (
									<img className="tl-image" src={card.image.src} alt={card.image.alt.en} />
								)}
								{card.state === 'active' &&
									(branch ? (
										<div className="tl-branch">
											<p className="tl-question">{localise(branch.question, lang)}</p>
											<div className="actions actions-row">
												<button className="btn btn-primary" type="button" onClick={() => onStep(true)}>
													Yes
												</button>
												<button className="btn btn-quiet" type="button" onClick={() => onStep(false)}>
													No
												</button>
											</div>
										</div>
									) : (
										<button className="btn btn-primary btn-gap" type="button" onClick={() => onStep()}>
											Done, what is next
											<ArrowIcon />
										</button>
									))}
							</div>
						</li>
					);
				})}
			</ol>

			<div className="actions">
				<button className="btn btn-quiet" type="button" onClick={onPress}>
					<MicIcon />
					Ask something else
				</button>
			</div>
		</>
	);
}

/* Icons. Inline SVG, because a webfont icon set is a download this audience pays for. */

function Svg({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<svg
			className={`icon ${className ?? ''}`}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

function MicIcon() {
	return (
		<Svg>
			<rect x="9" y="3" width="6" height="11" rx="3" />
			<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
		</Svg>
	);
}

function StopIcon() {
	return (
		<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
			<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
		</svg>
	);
}

function DotsIcon() {
	return (
		<svg className="icon icon-dots" viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="6" cy="12" r="2" fill="currentColor" />
			<circle cx="12" cy="12" r="2" fill="currentColor" />
			<circle cx="18" cy="12" r="2" fill="currentColor" />
		</svg>
	);
}

function SpeakerIcon() {
	return (
		<Svg>
			<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
			<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
		</Svg>
	);
}

function PhoneIcon({ className }: { className?: string }) {
	return (
		<Svg className={className}>
			<path d="M6.6 3.5h2.6l1.4 4-2 1.4a11 11 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />
		</Svg>
	);
}

function CheckIcon() {
	return (
		<Svg>
			<path d="m5 12.5 4.5 4.5L19 7.5" />
		</Svg>
	);
}

function ArrowIcon() {
	return (
		<Svg>
			<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
		</Svg>
	);
}

function WaveIcon() {
	return (
		<Svg>
			<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" />
		</Svg>
	);
}

function EarIcon() {
	return (
		<Svg>
			<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6" />
			<path d="M10 9.5a2 2 0 0 1 4 0" />
		</Svg>
	);
}

function InfoIcon() {
	return (
		<Svg>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v5.5M12 7.5v.01" />
		</Svg>
	);
}
