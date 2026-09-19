import { nowNext, type Journey, type Stage } from '../../lib/kb/journey';
import type { EntryLanguage } from '../../lib/kb/entry';

/**
 * A life event: what to do now, what waits, and what is already behind them.
 *
 * The filter is the point. Somebody whose father died last night should see two things, not
 * forty — probate belongs to a month they have not reached yet. So `Now` carries at most
 * three stages, everything blocked stays behind "Later", and the ending is written down,
 * because a list without one follows a grieving person around (vault plan-suara-0010).
 *
 * Nothing on this screen asserts anything: every fact a person reads is on the cards, which
 * are quoted from official pages. The stage says what this part is and who it is with.
 */
export interface JourneyWords {
	now: string;
	later: string;
	done: string;
	doneOne: string;
	undo: string;
	open: (n: number) => string;
	waitingFor: (name: string) => string;
	withWho: string;
	youKnow: string;
	ends: string;
	finished: string;
}

export interface JourneyViewProps {
	journey: Journey;
	done: string[];
	lang: EntryLanguage;
	w: JourneyWords;
	onOpen: (stageId: string) => void;
	onDone: (stageId: string) => void;
	onUndo: (stageId: string) => void;
}

const WHEN: Record<Stage['when'], { en: string; 'zh-Hans': string }> = {
	'within-24-hours': { en: 'In the first day', 'zh-Hans': '第一天内' },
	'first-week': { en: 'This week', 'zh-Hans': '这个星期' },
	'first-month': { en: 'This month', 'zh-Hans': '这个月' },
	months: { en: 'Over the months ahead', 'zh-Hans': '接下来几个月' },
	'when-ready': { en: 'When you are ready', 'zh-Hans': '等您准备好' },
};

export default function JourneyView({ journey, done, lang, w, onOpen, onDone, onUndo }: JourneyViewProps) {
	const where = nowNext(journey, new Set(done));
	const nameOf = (id: string) => journey.stages.find((s) => s.id === id)?.name ?? id;

	return (
		<section className="k-journey" data-journey={journey.id}>
			<h1 className="k-journey-title">{journey.title.full}</h1>
			<p className="k-journey-summary">{journey.summary}</p>

			{where.finished ? (
				<p className="k-journey-end" data-finished="true">
					{w.finished}
				</p>
			) : (
				<>
					<h2 className="k-journey-heading">{w.now}</h2>
					<ul className="k-stages">
						{where.now.map((stage) => (
							<Card key={stage.id} stage={stage} lang={lang} w={w} onOpen={onOpen} onDone={onDone} open />
						))}
					</ul>
				</>
			)}

			{where.later.length > 0 && (
				<details className="k-journey-later">
					<summary>
						<span>{w.later}</span>
					</summary>
					<ul className="k-stages">
						{where.later.map((stage) => {
							const waiting = stage.blocked_by.filter((id) => !done.includes(id));
							return (
								<li key={stage.id} className="k-stage" data-when={stage.when}>
									<p className="k-stage-when">{WHEN[stage.when][lang]}</p>
									<p className="k-stage-name">{stage.name}</p>
									{waiting.length > 0 && <p className="k-stage-wait">{w.waitingFor(nameOf(waiting[0]!))}</p>}
								</li>
							);
						})}
					</ul>
				</details>
			)}

			{where.done.length > 0 && (
				<details className="k-journey-done">
					<summary>
						<span>{`${w.done} (${where.done.length})`}</span>
					</summary>
					<ul className="k-stages">
						{where.done.map((stage) => (
							<li key={stage.id} className="k-stage" data-done="true">
								<p className="k-stage-name">{stage.name}</p>
								<button className="k-btn k-btn-quiet" type="button" onClick={() => onUndo(stage.id)}>
									{w.undo}
								</button>
							</li>
						))}
					</ul>
				</details>
			)}

			<p className="k-journey-end">{`${w.ends} ${journey.concludes_when}`}</p>
		</section>
	);
}

function Card({
	stage,
	lang,
	w,
	onOpen,
	onDone,
	open,
}: {
	stage: Stage;
	lang: EntryLanguage;
	w: JourneyWords;
	onOpen: (id: string) => void;
	onDone: (id: string) => void;
	open?: boolean;
}) {
	return (
		<li className="k-stage" data-stage={stage.id} data-when={stage.when} data-open={open}>
			<p className="k-stage-when">{WHEN[stage.when][lang]}</p>
			<h3 className="k-stage-name">{stage.name}</h3>
			{stage.note && <p className="k-stage-note">{stage.note}</p>}
			<p className="k-stage-who">{`${w.withWho} ${stage.who.join(' · ')}`}</p>
			<p className="k-stage-donewhen">{`${w.youKnow} ${stage.done_when}`}</p>
			<div className="k-stage-actions">
				<button className="k-btn k-btn-primary" type="button" onClick={() => onOpen(stage.id)}>
					{w.open(stage.cards.length)}
				</button>
				<button className="k-btn k-btn-quiet" type="button" onClick={() => onDone(stage.id)}>
					{w.doneOne}
				</button>
			</div>
		</li>
	);
}
