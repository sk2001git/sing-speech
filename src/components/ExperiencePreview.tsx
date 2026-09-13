import { useEffect, useState } from 'react';
import '../styles/preview.css';

type PreviewState = 'ready' | 'listening' | 'confirm' | 'guidance';

const SAMPLE_INTENT = 'You need help paying for a doctor or medicine.';

function speakPreview(text: string) {
	if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
	window.speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = 'en-SG';
	utterance.rate = 0.82;
	window.speechSynthesis.speak(utterance);
}

function MicIcon() {
	return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" strokeLinecap="round" /></svg>;
}

function SpeakerIcon() {
	return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 10v4h4l5 4V6l-5 4H4Z" strokeLinejoin="round" /><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" strokeLinecap="round" /></svg>;
}

function ArrowIcon() {
	return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h13M14 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ReadyView({ start }: { start: () => void }) {
	return <>
		<div className="preview-intro">
			<p className="preview-eyebrow">Good morning, Ah Huat</p>
			<h1>What do you need help with today?</h1>
			<p className="preview-support">Speak naturally. Suara will take its time and ask before moving ahead.</p>
		</div>
		<div className="preview-orb-wrap">
			<button className="preview-orb" onClick={start} aria-label="Try a sample voice request"><span className="preview-orb-ring ring-one" /><span className="preview-orb-ring ring-two" /><span className="preview-orb-core"><MicIcon /></span></button>
			<p>Tap to speak</p><span>You decide when you have finished.</span>
		</div>
		<section className="preview-shortcuts" aria-label="Try a sample request">
			<p className="preview-section-label">You can also start here</p>
			<button onClick={start}><span className="shortcut-mark">01</span><span><strong>Help with doctor costs</strong><small>CHAS, clinic and medicine support</small></span><ArrowIcon /></button>
			<button onClick={start}><span className="shortcut-mark">02</span><span><strong>My payments and benefits</strong><small>Retirement and older-person support</small></span><ArrowIcon /></button>
			<button onClick={start}><span className="shortcut-mark">03</span><span><strong>Prepare for an appointment</strong><small>What to bring and how to get there</small></span><ArrowIcon /></button>
		</section>
	</>;
}

function ListeningView({ continueToReadback, reset }: { continueToReadback: () => void; reset: () => void }) {
	return <div className="preview-state">
		<button className="preview-back" onClick={reset}>Back</button>
		<div className="preview-listening-copy"><p className="preview-eyebrow live-label"><span />Listening</p><h1>Take your time.<br />I am here.</h1><p>Pause whenever you need to. Suara will wait for you to finish.</p></div>
		<div className="preview-wave" aria-label="Listening indicator">{Array.from({ length: 19 }, (_, index) => <i key={index} style={{ '--wave-delay': String(index * 65) + 'ms' } as React.CSSProperties} />)}</div>
		<div className="preview-sample-panel"><p>Sample request</p><strong>“The doctor is too expensive for me.”</strong></div>
		<button className="preview-primary" onClick={continueToReadback}>Show what Suara understood <ArrowIcon /></button>
	</div>;
}

function ConfirmationView({ accept, reset }: { accept: () => void; reset: () => void }) {
	return <div className="preview-state">
		<button className="preview-back" onClick={reset}>Back</button>
		<div className="preview-confirm-copy"><p className="preview-eyebrow">Let me check</p><h1>Have I got this right?</h1><p>Suara checks the meaning, not a written transcript of every word.</p></div>
		<div className="preview-readback"><div className="preview-readback-top"><span>Suara heard</span><button onClick={() => speakPreview(SAMPLE_INTENT)} aria-label="Read the sample understanding aloud"><SpeakerIcon /> Read aloud</button></div><p>{SAMPLE_INTENT}</p><small>This is a sample for reviewing the design. No request has been sent.</small></div>
		<div className="preview-decisions"><button className="preview-primary" onClick={accept}>Yes, that is right <ArrowIcon /></button><button className="preview-secondary" onClick={reset}>No, it is something else</button></div>
	</div>;
}

function GuidanceView({ reset }: { reset: () => void }) {
	return <div className="preview-state">
		<button className="preview-back" onClick={reset}>Back to home</button>
		<div className="preview-guide-heading"><div><p className="preview-eyebrow">A clear next step</p><h1>Let’s do this together.</h1></div><span className="preview-step-count">1 <small>of 3</small></span></div>
		<div className="preview-guide-card"><div className="preview-card-number">01</div><div><p className="preview-section-label">Start here</p><h2>Find the right official service</h2><p>When this is live, Suara will show only reviewed information and a clear way to reach the right person.</p></div><button className="preview-primary" onClick={() => speakPreview('This is a design preview. Official service details will appear only after they have been verified.')}>Hear this step <SpeakerIcon /></button></div>
		<ol className="preview-path" aria-label="Sample guidance progress"><li className="is-active"><span>1</span><div><strong>Start with one trusted next step</strong><small>Now</small></div></li><li><span>2</span><div><strong>Prepare what you need</strong><small>Next</small></div></li><li><span>3</span><div><strong>Reach the official service</strong><small>Then</small></div></li></ol>
		<button className="preview-quiet-action" onClick={reset}>I need help from a person</button>
	</div>;
}

export default function ExperiencePreview() {
	const [state, setState] = useState<PreviewState>('ready');

	useEffect(() => {
		document.title = 'Suara - ' + (state === 'ready' ? 'Design preview' : state);
		return () => { document.title = 'Suara'; };
	}, [state]);

	return <main className="suara-preview" data-state={state}>
		<div className="preview-shell">
			<header className="preview-header">
				<a className="preview-brand" href="/" aria-label="Suara design preview home" onClick={(event) => { event.preventDefault(); setState('ready'); }}><span className="preview-brand-mark" aria-hidden="true"><i /><i /><i /></span><span>suara</span></a>
				<span className="preview-status"><i /> Design preview</span>
			</header>
			<div className="preview-content">
				{state === 'ready' && <ReadyView start={() => setState('listening')} />}
				{state === 'listening' && <ListeningView continueToReadback={() => setState('confirm')} reset={() => setState('ready')} />}
				{state === 'confirm' && <ConfirmationView accept={() => setState('guidance')} reset={() => setState('ready')} />}
				{state === 'guidance' && <GuidanceView reset={() => setState('ready')} />}
			</div>
			<footer className="preview-footer"><span>For review only</span><span>No microphone or request is sent</span></footer>
		</div>
	</main>;
}

