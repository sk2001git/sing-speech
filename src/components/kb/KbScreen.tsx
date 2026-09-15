import type { ReactNode } from 'react';
import { AREA_LABEL, AREAS, type Area } from '../../lib/kb/areas';
import type { Entry, EntryLanguage } from '../../lib/kb/entry';
import { canSpeak, type FlowEvent, type FlowState } from '../../lib/kb/flow';
import type { ReplySetting } from '../../lib/kb/hearing';

/**
 * Every knowledge-base screen, from a plain `FlowState`. No network, microphone or
 * timers here — the driver is `Suara.tsx`. Follows the approved canvas
 * (vault spec-suara-0006): one-line titles, detail on demand, colour only for state.
 */
export interface KbScreenProps {
	state: FlowState;
	setting: ReplySetting;
	/** Cards shown in English although the reader's language is Chinese. */
	englishIds: string[];
	loadingMore: boolean;
	dispatch: (event: FlowEvent) => void;
	onSpeak: () => void;
	onMore: () => void;
	onTopic: (area: Area) => void;
	onSay: (text: string, language: EntryLanguage) => void;
	onLanguage: (setting: ReplySetting) => void;
	/** Which vendor route heard the request, shown small at the foot. */
	routeLabel?: string;
}

const WORDS = {
	en: {
		ready: 'Ready',
		listening: 'Listening',
		busy: 'One moment',
		whatNeed: 'What do you need?',
		hello: 'Hello! What do you need?',
		tapSpeak: 'Tap to speak',
		tapDone: 'Tap when done',
		imListening: "I'm listening",
		gettingReady: 'Getting ready',
		finding: 'Finding answers',
		orTopic: 'Or pick a topic',
		youAsked: 'You asked',
		readAloud: 'Read aloud',
		answers: (n: number) => `${n} ${n === 1 ? 'answer' : 'answers'}`,
		best: 'Best match',
		closest: 'Closest I have, not a sure match',
		steps: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`,
		info: 'Answer',
		from: (who: string) => `From ${who}, ask.gov.sg`,
		startGuide: 'Start guide',
		more: 'Show 6 more',
		loading: 'Loading',
		noneFit: 'None fit? Ask again',
		english: 'English',
		gridView: 'Two per row',
		singleView: 'One large card',
		back: 'Answers',
		startThese: 'Start these steps?',
		confirmEach: (n: number) => `${n} steps · you confirm each one`,
		seeAll: 'See all steps',
		yesStart: 'Yes, start',
		notThis: 'Not this',
		stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
		readAgain: 'Read again',
		askElse: 'Ask something else',
		allDone: 'That is every step',
		allDoneLead: 'You have gone through every step.',
		notIn: 'Not in Suara yet',
		tryTopic: 'Try a topic, or ask again.',
		askAgain: 'Ask again',
		micTitle: 'I need the microphone',
		mic: {
			permission: 'Please allow the microphone, then tap the button again.',
			'no-device': 'I cannot find a microphone on this phone.',
			insecure: 'This page needs a secure connection to use the microphone.',
		},
		offlineTitle: 'I could not connect',
		offline: 'Please check your connection, then tap to try again.',
		tryAgain: 'Try again',
		home: 'Home',
		language: 'Language',
	},
	'zh-Hans': {
		ready: '准备好了',
		listening: '正在听',
		busy: '请稍等',
		whatNeed: '您需要什么帮助？',
		hello: '您好！您需要什么帮助？',
		tapSpeak: '点一下说话',
		tapDone: '说完点一下',
		imListening: '我在听',
		gettingReady: '准备中',
		finding: '正在找答案',
		orTopic: '或选一个主题',
		youAsked: '您问',
		readAloud: '朗读',
		answers: (n: number) => `${n} 个答案`,
		best: '最符合',
		closest: '最接近的答案，不一定准确',
		steps: (n: number) => `${n} 个步骤`,
		info: '答案',
		from: (who: string) => `来自 ${who}，ask.gov.sg`,
		startGuide: '开始步骤',
		more: '再看 6 个',
		loading: '加载中',
		noneFit: '都不对？再问一次',
		english: 'English',
		gridView: '每行两个',
		singleView: '一个大卡片',
		back: '答案',
		startThese: '开始这些步骤？',
		confirmEach: (n: number) => `${n} 个步骤 · 每步您来确认`,
		seeAll: '查看所有步骤',
		yesStart: '好，开始',
		notThis: '不是这个',
		stepOf: (i: number, n: number) => `第 ${i} 步，共 ${n} 步`,
		readAgain: '再读一次',
		askElse: '问别的',
		allDone: '所有步骤都完成了',
		allDoneLead: '您已经完成每一步。',
		notIn: 'Suara 还没有这个答案',
		tryTopic: '试试选一个主题，或再问一次。',
		askAgain: '再问一次',
		micTitle: '需要使用麦克风',
		mic: {
			permission: '请允许使用麦克风，然后再点一下按钮。',
			'no-device': '这部手机找不到麦克风。',
			insecure: '这个页面需要安全连接才能使用麦克风。',
		},
		offlineTitle: '连接不上',
		offline: '请检查网络，然后点一下再试。',
		tryAgain: '再试一次',
		home: '首页',
		language: '语言',
	},
};

type Words = (typeof WORDS)['en'];

const LANGUAGE_PILL: Record<ReplySetting, string> = { en: 'English', 'zh-Hans': '中文', auto: 'Auto' };
const NEXT_SETTING: Record<ReplySetting, ReplySetting> = { en: 'zh-Hans', 'zh-Hans': 'auto', auto: 'en' };

/** The interface language: the chosen one, or on Automatic the language of the last answer. */
function uiLanguage(state: FlowState, setting: ReplySetting): EntryLanguage {
	if (setting !== 'auto') return setting;
	if (state.phase === 'results') return state.result.language;
	if ('back' in state) return state.back.result.language;
	return 'en';
}

const publisherOf = (e: Entry) => e.sources[0]?.publisher ?? '';

export default function KbScreen(props: KbScreenProps) {
	const lang = uiLanguage(props.state, props.setting);
	const w = WORDS[lang];
	return (
		<div className="k-app" lang={lang === 'zh-Hans' ? 'zh-Hans' : 'en'}>
			<header className="k-bar">
				<button className="k-brand" type="button" onClick={() => props.dispatch({ type: 'HOME' })} aria-label={w.home}>
					<span className="k-brand-mark" aria-hidden="true">
						<WaveIcon />
					</span>
					<span className="k-brand-name">Suara</span>
				</button>
				<button
					className="k-pill"
					type="button"
					onClick={() => props.onLanguage(NEXT_SETTING[props.setting])}
					aria-label={`${w.language}: ${LANGUAGE_PILL[props.setting]}`}
				>
					{LANGUAGE_PILL[props.setting]}
				</button>
			</header>
			<main className="k-page">
				<Body {...props} w={w} lang={lang} />
				{props.routeLabel && <p className="k-foot">{props.routeLabel}</p>}
			</main>
		</div>
	);
}

type BodyProps = KbScreenProps & { w: Words; lang: EntryLanguage };

function Body(p: BodyProps) {
	const s = p.state;
	switch (s.phase) {
		case 'home':
		case 'arming':
		case 'listening':
		case 'searching':
			return <Talk {...p} />;
		case 'results':
			return <Results {...p} state={s} />;
		case 'confirm':
			return <Confirm {...p} state={s} />;
		case 'steps':
			return <Steps {...p} state={s} />;
		case 'done':
			return (
				<>
					<BackRow {...p} />
					<Chip tone="ready" text={p.w.ready} />
					<h1 className="k-h1">{p.w.allDone}</h1>
					<p className="k-lead">{s.entry.title.full}</p>
					<AskButton {...p} label={p.w.askElse} primary />
				</>
			);
		case 'notfound':
			return (
				<>
					<HeardRow w={p.w} short={s.heard.short} />
					<h1 className="k-h1">{p.w.notIn}</h1>
					<p className="k-lead">{p.w.tryTopic}</p>
					<Topics {...p} />
					<AskButton {...p} label={p.w.askAgain} primary />
				</>
			);
		case 'denied':
			return (
				<>
					<Chip tone="alert" text={p.w.micTitle} />
					<h1 className="k-h1">{p.w.micTitle}</h1>
					<p className="k-notice">{p.w.mic[s.reason]}</p>
					<AskButton {...p} label={p.w.tryAgain} primary />
				</>
			);
		case 'offline':
			return (
				<>
					<Chip tone="alert" text={p.w.offlineTitle} />
					<h1 className="k-h1">{p.w.offlineTitle}</h1>
					<p className="k-notice">{p.w.offline}</p>
					<AskButton {...p} label={p.w.tryAgain} primary />
					<Topics {...p} />
				</>
			);
	}
}

function Chip({ tone, text }: { tone: 'ready' | 'live' | 'busy' | 'alert'; text: string }) {
	return (
		<p className="k-chip" data-tone={tone} role="status">
			<span className="k-chip-dot" aria-hidden="true" />
			{text}
		</p>
	);
}

function Talk(p: BodyProps) {
	const s = p.state;
	const live = s.phase === 'listening';
	const waiting = s.phase === 'arming' || s.phase === 'searching';
	const greeting = s.phase === 'home' && s.greeting;
	const heading = live ? p.w.imListening : s.phase === 'arming' ? p.w.gettingReady : s.phase === 'searching' ? p.w.finding : greeting ? p.w.hello : p.w.whatNeed;
	return (
		<>
			<Chip tone={live ? 'live' : waiting ? 'busy' : 'ready'} text={live ? p.w.listening : waiting ? p.w.busy : p.w.ready} />
			<h1 className="k-h1">{heading}</h1>
			<section className="k-orb-zone">
				<button
					className="k-orb"
					type="button"
					data-live={live}
					onClick={p.onSpeak}
					disabled={waiting}
					aria-label={live ? p.w.tapDone : p.w.tapSpeak}
				>
					{live ? <StopIcon /> : waiting ? <DotsIcon /> : <MicIcon />}
				</button>
				<div className="k-wave" data-on={live} aria-hidden="true">
					{[0, 1, 2, 3, 4].map((i) => (
						<i key={i} />
					))}
				</div>
				<p className="k-orb-label" aria-live="polite">
					{live ? p.w.tapDone : waiting ? p.w.busy : p.w.tapSpeak}
				</p>
			</section>
			{s.phase === 'home' && (
				<>
					<p className="k-label">{p.w.orTopic}</p>
					<Topics {...p} />
				</>
			)}
		</>
	);
}

function Topics(p: BodyProps) {
	return (
		<div className="k-topics">
			{AREAS.map((area) => (
				<button key={area} className="k-topic" type="button" data-topic={area} onClick={() => p.onTopic(area)}>
					{AREA_LABEL[area][p.lang]}
				</button>
			))}
		</div>
	);
}

function HeardRow({ w, short, sentence, onSay, lang }: { w: Words; short: string; sentence?: string; onSay?: BodyProps['onSay']; lang?: EntryLanguage }) {
	if (!sentence) {
		return (
			<div className="k-heard">
				<span className="k-heard-label">{w.youAsked}</span>
				<span className="k-heard-text">{short}</span>
			</div>
		);
	}
	return (
		<details className="k-heard k-heard-open">
			<summary>
				<span className="k-heard-label">{w.youAsked}</span>
				<span className="k-heard-text">{short}</span>
				<ChevronIcon />
			</summary>
			<div className="k-heard-body">
				<p>{sentence}</p>
				{onSay && lang && (
					<button className="k-pill k-pill-small" type="button" onClick={() => onSay(sentence, lang)}>
						<SpeakerIcon />
						{w.readAloud}
					</button>
				)}
			</div>
		</details>
	);
}

type ResultsState = Extract<FlowState, { phase: 'results' }>;

function Results(p: BodyProps & { state: ResultsState }) {
	const { result, openId, view } = p.state;
	const english = new Set(p.englishIds);
	return (
		<>
			<HeardRow w={p.w} short={result.heard.short} sentence={result.heard.sentence} onSay={p.onSay} lang={result.language} />
			{result.fit === 'weak' && (
				<p className="k-closest">
					<InfoIcon />
					<span>{p.w.closest}</span>
				</p>
			)}
			<div className="k-results-head">
				<span className="k-count">{p.w.answers(result.cards.length)}</span>
				<div className="k-toggle" role="group">
					<button type="button" aria-pressed={view === 'grid'} aria-label={p.w.gridView} onClick={() => p.dispatch({ type: 'VIEW', view: 'grid' })}>
						<GridIcon />
					</button>
					<button type="button" aria-pressed={view === 'single'} aria-label={p.w.singleView} onClick={() => p.dispatch({ type: 'VIEW', view: 'single' })}>
						<RowsIcon />
					</button>
				</div>
			</div>
			<div className="k-cards" data-view={view}>
				{result.cards.map((card, i) => (
					<Card
						key={card.id}
						{...p}
						entry={card}
						best={result.fit === 'strong' && i === 0}
						open={openId === card.id}
						inEnglish={english.has(card.id)}
					/>
				))}
			</div>
			{result.nextOffset !== null && (
				<button className="k-btn k-btn-quiet" type="button" onClick={p.onMore} disabled={p.loadingMore}>
					<ChevronIcon />
					{p.loadingMore ? p.w.loading : p.w.more}
				</button>
			)}
			<AskButton {...p} label={p.w.noneFit} />
		</>
	);
}

function Card(p: BodyProps & { entry: Entry; best: boolean; open: boolean; inEnglish: boolean }) {
	const e = p.entry;
	const steps = e.steps?.length ?? 0;
	return (
		<article className="k-card" data-card={e.id} data-best={p.best} data-open={p.open} {...(p.inEnglish ? { 'data-english': 'true' } : {})}>
			<button className="k-card-head" type="button" aria-expanded={p.open} onClick={() => p.dispatch({ type: 'OPEN', id: e.id })}>
				{p.best && <span className="k-badge">{p.w.best}</span>}
				<span className="k-card-title">{p.state.view === 'grid' && !p.open ? e.title.short : e.title.full}</span>
				<span className="k-card-meta">
					<span>
						{steps > 0 ? p.w.steps(steps) : p.w.info}
						{p.inEnglish && <span className="k-tag">{p.w.english}</span>}
					</span>
					<ChevronIcon />
				</span>
			</button>
			{p.open && (
				<div className="k-card-body">
					<p className="k-summary">{e.summary.text}</p>
					{(e.details ?? []).map((d) => (
						<details key={d.heading} className="k-detail">
							<summary>
								<span>{d.heading}</span>
								<ChevronIcon />
							</summary>
							<p>{d.body}</p>
						</details>
					))}
					<CardAction {...p} />
					<button className="k-btn k-btn-quiet k-btn-mid" type="button" onClick={() => p.onSay(`${e.title.full}. ${e.summary.text}`, e.language)}>
						<SpeakerIcon />
						{p.w.readAloud}
					</button>
					<a className="k-source" href={e.sources[0]?.url} target="_blank" rel="noopener noreferrer">
						{p.w.from(publisherOf(e))}
					</a>
				</div>
			)}
		</article>
	);
}

function CardAction(p: BodyProps & { entry: Entry }) {
	const e = p.entry;
	if (e.kind === 'process') {
		return (
			<button className="k-btn k-btn-primary" type="button" onClick={() => p.dispatch({ type: 'START', id: e.id })}>
				{p.w.startGuide}
				<ArrowIcon />
			</button>
		);
	}
	const a = e.action;
	if (!a?.value) return null;
	if (a.type === 'call') {
		const href = a.value.startsWith('tel:') ? a.value : `tel:${a.value.replace(/[^\d+]/g, '')}`;
		return (
			<a className="k-btn k-btn-primary" href={href}>
				<PhoneIcon />
				{a.label}
			</a>
		);
	}
	if (a.type === 'open-website' && a.value.startsWith('https://')) {
		return (
			<a className="k-btn k-btn-primary" href={a.value} target="_blank" rel="noopener noreferrer">
				{a.label}
				<ArrowIcon />
			</a>
		);
	}
	return null;
}

function BackRow(p: BodyProps) {
	return (
		<button className="k-back" type="button" onClick={() => p.dispatch({ type: 'BACK' })}>
			<BackIcon />
			{p.w.back}
		</button>
	);
}

function Confirm(p: BodyProps & { state: Extract<FlowState, { phase: 'confirm' }> }) {
	const e = p.state.entry;
	const steps = e.steps ?? [];
	return (
		<>
			<BackRow {...p} />
			<h1 className="k-h1">{p.w.startThese}</h1>
			<article className="k-card k-card-lead">
				<p className="k-card-title k-card-title-lg">{e.title.full}</p>
				<p className="k-card-meta">{p.w.confirmEach(steps.length)}</p>
				<details className="k-detail">
					<summary>
						<span>{p.w.seeAll}</span>
						<ChevronIcon />
					</summary>
					<ol className="k-step-list">
						{steps.map((st) => (
							<li key={st.position}>{st.name}</li>
						))}
					</ol>
				</details>
			</article>
			<div className="k-confirm">
				<button className="k-confirm-card confirm-yes" type="button" onClick={() => p.dispatch({ type: 'YES' })}>
					<CheckIcon />
					<span>{p.w.yesStart}</span>
				</button>
				<button className="k-confirm-card confirm-no" type="button" onClick={() => p.dispatch({ type: 'NO' })}>
					<CrossIcon />
					<span>{p.w.notThis}</span>
				</button>
			</div>
		</>
	);
}

function Steps(p: BodyProps & { state: Extract<FlowState, { phase: 'steps' }> }) {
	const e = p.state.entry;
	const steps = e.steps ?? [];
	const current = steps[p.state.index]!;
	return (
		<>
			<BackRow {...p} />
			<div className="k-guide-head">
				<p className="k-label">{p.w.stepOf(p.state.index + 1, steps.length)}</p>
				<h1 className="k-h1">{e.title.short}</h1>
			</div>
			<ol className="k-steps">
				{steps.map((st, i) =>
					i === p.state.index ? (
						<li key={st.position} className="k-step k-step-now">
							<div className="k-step-row">
								<span className="k-step-dot" data-state="now">
									{i + 1}
								</span>
								<span className="k-step-name">{st.name}</span>
							</div>
							<p className="k-step-text">{current.text}</p>
							<button className="k-btn k-btn-yes" type="button" onClick={() => p.dispatch({ type: 'STEP_DONE' })}>
								<CheckIcon />
								{current.confirm_label}
							</button>
							<button className="k-btn k-btn-quiet k-btn-mid" type="button" onClick={() => p.onSay(`${current.name}. ${current.text}`, e.language)}>
								<SpeakerIcon />
								{p.w.readAgain}
							</button>
						</li>
					) : (
						<li key={st.position} className="k-step" data-state={i < p.state.index ? 'done' : 'later'}>
							<span className="k-step-dot" data-state={i < p.state.index ? 'done' : 'later'}>
								{i < p.state.index ? <CheckIcon /> : i + 1}
							</span>
							<span className="k-step-name">{st.name}</span>
						</li>
					),
				)}
			</ol>
			<a className="k-source k-source-row" href={e.sources[0]?.url} target="_blank" rel="noopener noreferrer">
				{p.w.from(publisherOf(e))}
			</a>
			<AskButton {...p} label={p.w.askElse} />
		</>
	);
}

function AskButton(p: BodyProps & { label: string; primary?: boolean }) {
	return (
		<button className={`k-btn ${p.primary ? 'k-btn-primary' : 'k-btn-plain'}`} type="button" onClick={p.onSpeak} disabled={!canSpeak(p.state)}>
			<MicIcon />
			{p.label}
		</button>
	);
}

/* Icons: inline SVG, no icon font to download. */

function Svg({ children }: { children: ReactNode }) {
	return (
		<svg className="k-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{children}
		</svg>
	);
}
const MicIcon = () => (
	<Svg>
		<rect x="9" y="3" width="6" height="11" rx="3" />
		<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
	</Svg>
);
const StopIcon = () => (
	<svg className="k-icon" viewBox="0 0 24 24" aria-hidden="true">
		<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
	</svg>
);
const DotsIcon = () => (
	<svg className="k-icon k-dots" viewBox="0 0 24 24" aria-hidden="true">
		<circle cx="6" cy="12" r="2" fill="currentColor" />
		<circle cx="12" cy="12" r="2" fill="currentColor" />
		<circle cx="18" cy="12" r="2" fill="currentColor" />
	</svg>
);
const SpeakerIcon = () => (
	<Svg>
		<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
		<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
	</Svg>
);
const ChevronIcon = () => (
	<Svg>
		<path d="m6 9 6 6 6-6" />
	</Svg>
);
const BackIcon = () => (
	<Svg>
		<path d="m15 6-6 6 6 6" />
	</Svg>
);
const ArrowIcon = () => (
	<Svg>
		<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
	</Svg>
);
const CheckIcon = () => (
	<Svg>
		<path d="m5 12.5 4.5 4.5L19 7.5" />
	</Svg>
);
const CrossIcon = () => (
	<Svg>
		<path d="M6 6l12 12M18 6 6 18" />
	</Svg>
);
const InfoIcon = () => (
	<Svg>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5.5M12 7.5v.01" />
	</Svg>
);
const PhoneIcon = () => (
	<Svg>
		<path d="M6.6 3.5h2.6l1.4 4-2 1.4a11 11 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />
	</Svg>
);
const GridIcon = () => (
	<Svg>
		<rect x="4" y="4" width="7" height="7" rx="1.5" />
		<rect x="13" y="4" width="7" height="7" rx="1.5" />
		<rect x="4" y="13" width="7" height="7" rx="1.5" />
		<rect x="13" y="13" width="7" height="7" rx="1.5" />
	</Svg>
);
const RowsIcon = () => (
	<Svg>
		<rect x="4" y="4" width="16" height="7" rx="1.5" />
		<rect x="4" y="13" width="16" height="7" rx="1.5" />
	</Svg>
);
const WaveIcon = () => (
	<Svg>
		<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" />
	</Svg>
);
