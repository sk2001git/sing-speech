import { describe, expect, it } from 'vitest';
import { journeyFor } from './journey-match';
import { parseJourney, type Journey } from './journey';

const bereavement = (): Journey => {
	const parsed = parseJourney({
		schema_version: '1.0.0',
		id: 'sg.journey.death-of-a-loved-one',
		language: 'en',
		title: { short: 'Someone has died', full: 'When someone close to you dies' },
		summary: 'What has to happen now, what can wait, and what is settled later.',
		search: {
			example_phrasings: [
				'my father passed away',
				'my husband died last night',
				'what do I do when someone dies',
				'my mother just died, what now',
			],
		},
		stages: [
			{
				id: 'the-certificate',
				name: 'Get the death certificate',
				when: 'within-24-hours',
				priority: 'must-do-now',
				who: ['ICA'],
				cards: ['sg.ica.getting-the-digital-death-certificate'],
				done_when: 'You have the certificate',
				blocked_by: [],
			},
		],
		concludes_when: 'The estate is settled.',
	});
	if (!parsed.ok) throw new Error(parsed.errors.join('; '));
	return parsed.entry;
};

const journeys = [bereavement()];

describe('journeyFor', () => {
	it('recognises the event however a person says it', () => {
		for (const said of [
			'my father passed away',
			'my father passed away last night and I do not know what to do',
			'my mother died yesterday',
			'my wife has died, what must I settle',
			'someone in my family passed on',
		]) {
			expect(journeyFor(journeys, said)?.id, said).toBe('sg.journey.death-of-a-loved-one');
		}
	});

	it('leaves an ordinary question alone', () => {
		for (const said of [
			'can I use my MediSave to pay my father hospital bill',
			'how do I apply for the CHAS card',
			'where is a clinic near Bedok',
			'what is the retirement sum this year',
		]) {
			expect(journeyFor(journeys, said), said).toBeUndefined();
		}
	});

	it('does not fire on a question that merely mentions death in passing', () => {
		// A person asking what happens to CPF money after death wants that answer, not a
		// seven-stage journey through a funeral they may not be arranging.
		expect(journeyFor(journeys, 'what happens to CPF savings after death')).toBeUndefined();
	});

	it('finds nothing when there are no journeys', () => {
		expect(journeyFor([], 'my father passed away')).toBeUndefined();
	});
});
