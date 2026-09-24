import type { ReactNode } from 'react';
import { ProgressFill, SuccessMark } from '../motion/motion';
import SpectreWave from './SpectreWave';
import { addressLine, displayName } from '../../lib/places/places';
import { AREA_LABEL, AREAS, type Area } from '../../lib/kb/areas';
import JourneyView from './JourneyView';
import Palette from './Palette';
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
	/** Microphone loudness, 0 to 1. */
	level?: number;
	/** The open microphone's analyser, for the listening wave. */
	analyser?: AnalyserNode | null;
	/** Find: typing a few letters instead of speaking. */
	finding?: boolean;
	onFind?: () => void;
	onFindClose?: () => void;
	onFound?: (id: string, label: string) => void;
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
		youSaid: 'You said',
		nothingHeard: "I didn't hear you. Tap and try again.",
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
		find: 'Find',
		journeyNow: 'Start with this',
		journeyLater: 'Later, when these are done',
		journeyDone: 'Done',
		journeyDoneOne: 'I have done this',
		journeyUndo: 'Not done after all',
		journeyOpen: (n: number) => `Show me how (${n})`,
		journeyWaiting: (name: string) => `Waits until: ${name}`,
		journeyWho: 'With:',
		journeyKnow: 'Finished when:',
		journeyEnds: 'This ends when:',
		journeyFinished: 'That is everything. Nothing is left outstanding.',
		findPlaceholder: 'Type a few letters',
		findNothing: 'Not in Suara yet.',
		speakInstead: 'Say it instead',
		close: 'Close',
		call: 'Call',
		placeKind: { 'chas-clinic': 'CHAS clinics', eldercare: 'Eldercare services', pharmacy: 'Pharmacies' } as Record<string, string>,
		placesNear: (kind: string, area: string) => `${kind} near ${area}`,
		placesFound: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
		fromDataset: (name: string, agency: string) => `From ${name}, ${agency}, data.gov.sg`,
		checkedOn: (date: string) => `checked ${date}`,
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
		youSaid: '您说',
		nothingHeard: '我没听到。请点一下再说。',
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
		find: '查找',
		journeyNow: '先做这些',
		journeyLater: '之后再说',
		journeyDone: '已完成',
		journeyDoneOne: '这个我做好了',
		journeyUndo: '还没做好',
		journeyOpen: (n: number) => `告诉我怎么做（${n}）`,
		journeyWaiting: (name: string) => `要先完成：${name}`,
		journeyWho: '联系：',
		journeyKnow: '完成的标志：',
		journeyEnds: '全部结束的标志：',
		journeyFinished: '都办好了，没有未了的事。',
		findPlaceholder: '输入几个字母',
		findNothing: 'Suara 还没有这个。',
		speakInstead: '改用说的',
		close: '关闭',
		call: '拨打',
		placeKind: { 'chas-clinic': 'CHAS 诊所', eldercare: '乐龄服务', pharmacy: '药房' } as Record<string, string>,
		placesNear: (kind: string, area: string) => `${area}附近的${kind}`,
		placesFound: (n: number) => `${n} 个地点`,
		fromDataset: (name: string, agency: string) => `来自 ${name}，${agency}，data.gov.sg`,
		checkedOn: (date: string) => `查询于 ${date}`,
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

function FindIcon() {
	return (
		<svg className="k-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
			<circle cx="11" cy="11" r="6.5" />
			<path d="m16 16 4.5 4.5" />
		</svg>
	);
}

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
				<div className="k-bar-right">
					{props.onFind && (
						<button className="k-pill k-pill-icon" type="button" onClick={props.onFind} aria-label={w.find}>
							<FindIcon />
							<span className="k-pill-text">{w.find}</span>
						</button>
					)}
					<button
						className="k-pill"
						type="button"
						onClick={() => props.onLanguage(NEXT_SETTING[props.setting])}
						aria-label={`${w.language}: ${LANGUAGE_PILL[props.setting]}`}
					>
						{LANGUAGE_PILL[props.setting]}
					</button>
				</div>
			</header>
			<main className="k-page">
				<Body {...props} w={w} lang={lang} />
				{props.routeLabel && <p className="k-foot">{props.routeLabel}</p>}
			</main>
			{props.onFound && props.onFindClose && (
				<Palette
					open={Boolean(props.finding)}
					words={{ find: w.find, placeholder: w.findPlaceholder, nothing: w.findNothing, speakInstead: w.speakInstead, close: w.close }}
					onClose={props.onFindClose}
					onChoose={props.onFound}
					onSpeak={props.onSpeak}
				/>
			)}
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
		case 'places':
			return <Places {...p} state={s} />;
		case 'journey':
			return (
				<JourneyView
					journey={s.result.journey}
					done={s.done}
					lang={p.lang}
					w={{
						now: p.w.journeyNow,
						later: p.w.journeyLater,
						done: p.w.journeyDone,
						doneOne: p.w.journeyDoneOne,
						undo: p.w.journeyUndo,
						open: p.w.journeyOpen,
						waitingFor: p.w.journeyWaiting,
						withWho: p.w.journeyWho,
						youKnow: p.w.journeyKnow,
						ends: p.w.journeyEnds,
						finished: p.w.journeyFinished,
					}}
					onOpen={(id) => p.dispatch({ type: 'STAGE_CARDS', id })}
					onDone={(id) => p.dispatch({ type: 'STAGE_DONE', id })}
					onUndo={(id) => p.dispatch({ type: 'STAGE_UNDONE', id })}
				/>
			);
		case 'confirm':
			return <Confirm {...p} state={s} />;
		case 'steps':
			return <Steps {...p} state={s} />;
		case 'done':
			return (
				<>
					<BackRow {...p} />
					<div className="k-done-mark">
						<SuccessMark size={80} stroke={4.5} flourish="ripple" label={null} />
					</div>
					<h1 className="k-h1">{p.w.allDone}</h1>
					<p className="k-lead">{s.entry.title.full}</p>
					<AskButton {...p} label={p.w.askElse} primary />
				</>
			);
		case 'notfound':
			return (
				<>
					{s.heard.said && <Said w={p.w} said={s.heard.said} />}
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

/**
 * Home, arming, listening and searching: the owner's picks from the taste lab (vault plan
 * suara-2026-09-25-feature-apply-taste-lab-picks). Home is the microphone and nothing else,
 * with the topics one tap away; listening is a spectral wave (plan
 * suara-2026-09-25-feature-spectre-listening-wave); searching is a grey outline.
 */
function Talk(p: BodyProps) {
	const s = p.state;
	const waiting = s.phase === 'arming';
	const greeting = s.phase === 'home' && s.greeting;
	if (s.phase === 'searching') {
		return (
			<>
				<h1 className="k-h1" aria-live="polite">
					{p.w.finding}
				</h1>
				<div className="k-skeleton" aria-hidden="true">
					<i />
					<i />
					<i />
				</div>
				<div className="k-skeleton" aria-hidden="true">
					<i />
					<i />
				</div>
			</>
		);
	}
	// Listening: a spectral wave that follows the voice, and one big stop button at the bottom.
	if (s.phase === 'listening') {
		return (
			<section className="k-listen">
				<h1 className="k-h1">{p.w.imListening}</h1>
				<SpectreWave active analyser={p.analyser} />
				<div className="k-listen-foot">
					<button className="k-stop" type="button" aria-label={p.w.tapDone} onClick={p.onSpeak}>
						<StopIcon />
					</button>
					<p className="k-orb-label" aria-live="polite">
						{p.w.tapDone}
					</p>
				</div>
			</section>
		);
	}
	const heading = waiting ? p.w.gettingReady : greeting ? p.w.hello : p.w.whatNeed;
	return (
		<>
			<h1 className="k-h1">{heading}</h1>
			{s.phase === 'home' && s.notice === 'nothing' && <p className="k-notice">{p.w.nothingHeard}</p>}
			<section className="k-orb-zone">
				<button className="k-orb" type="button" onClick={p.onSpeak} disabled={waiting} aria-label={p.w.tapSpeak}>
					{waiting ? <DotsIcon /> : <MicIcon />}
				</button>
				<p className="k-orb-label" aria-live="polite">
					{waiting ? p.w.busy : p.w.tapSpeak}
				</p>
			</section>
			{s.phase === 'home' && (
				<details className="k-more">
					<summary className="k-btn k-btn-quiet">
						{p.w.orTopic}
						<ChevronIcon />
					</summary>
					<Topics {...p} />
				</details>
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

/** Their own words, always open, so they can see Suara heard them before reading answers. */
function Said({ w, said }: { w: Words; said: string }) {
	return (
		<div className="k-said">
			<span className="k-heard-label">{w.youSaid}</span>
			<p>&ldquo;{said}&rdquo;</p>
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
			{result.heard.said && <Said w={p.w} said={result.heard.said} />}
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
					<Card key={card.id} {...p} entry={card} best={result.fit === 'strong' && i === 0} open={openId === card.id} inEnglish={english.has(card.id)} />
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
				{p.best && (
					<span className="k-best">
						<SuccessMark size={22} delay={0.12} label={null} />
						{p.w.best}
					</span>
				)}
				<span className="k-card-title">{p.state.view === 'grid' && !p.open ? e.title.short : e.title.full}</span>
				{p.best && !p.open && p.state.view === 'single' && <span className="k-card-sum">{e.summary.text}</span>}
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

/**
 * Addresses from open data. Deliberately unlike an answer card: no quotes, no steps, and
 * the dataset named underneath with the date it was read, because this is a published row
 * rather than a sentence from an official page.
 */
function Places(p: BodyProps & { state: Extract<FlowState, { phase: 'places' }> }) {
	const { heard, places, what, area, source } = p.state.result;
	const checked = new Date(source.fetchedAt).toLocaleDateString(p.lang === 'zh-Hans' ? 'zh-SG' : 'en-SG', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
	return (
		<>
			{heard.said && <Said w={p.w} said={heard.said} />}
			<h1 className="k-h1">{p.w.placesNear(p.w.placeKind[what] ?? what, titleWords(area))}</h1>
			<p className="k-count">{p.w.placesFound(places.length)}</p>
			<div className="k-places">
				{places.map((place) => (
					<article className="k-place" data-place={place.id} key={place.id}>
						<p className="k-place-name">{displayName(place)}</p>
						<p className="k-place-address">{addressLine(place)}</p>
						{place.tags && place.tags.length > 0 && (
							<p className="k-place-tags">{place.tags.join(' · ')}</p>
						)}
						{place.phone && (
							<a className="k-btn k-btn-quiet k-btn-mid" href={`tel:${place.phone}`}>
								<PhoneIcon />
								{p.w.call} {place.phone}
							</a>
						)}
					</article>
				))}
			</div>
			<a className="k-source k-source-row" href={source.url} target="_blank" rel="noopener noreferrer">
				{p.w.fromDataset(source.name, source.agency)} · {p.w.checkedOn(checked)}
			</a>
			<AskButton {...p} label={p.w.askAgain} />
		</>
	);
}

/** "bedok north" as a person would see it on a card. */
const titleWords = (text: string) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function BackRow(p: BodyProps) {
	return (
		<button className="k-back" type="button" onClick={() => p.dispatch({ type: 'BACK' })}>
			<BackIcon />
			{p.w.back}
		</button>
	);
}

/**
 * "Start these steps?" as a bottom sheet: one black button and a plain "Not this", the way
 * Airbnb asks (owner's pick, taste lab round 2). The entry stays visible behind it.
 */
function Confirm(p: BodyProps & { state: Extract<FlowState, { phase: 'confirm' }> }) {
	const e = p.state.entry;
	const steps = e.steps ?? [];
	return (
		<>
			<BackRow {...p} />
			<article className="k-card k-card-lead">
				<p className="k-card-title k-card-title-lg">{e.title.full}</p>
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
			<div className="k-scrim" aria-hidden="true" />
			<section className="k-sheet" aria-labelledby="k-sheet-title">
				<h2 className="k-sheet-title" id="k-sheet-title">
					{p.w.startThese}
				</h2>
				<p className="k-lead">{p.w.confirmEach(steps.length)}</p>
				<button className="k-btn k-btn-primary confirm-yes" type="button" onClick={() => p.dispatch({ type: 'YES' })}>
					{p.w.yesStart}
				</button>
				<button className="k-link confirm-no" type="button" onClick={() => p.dispatch({ type: 'NO' })}>
					{p.w.notThis}
				</button>
			</section>
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
				<ProgressFill value={(p.state.index + 1) / steps.length} label={p.w.stepOf(p.state.index + 1, steps.length)} className="k-progress" />
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
