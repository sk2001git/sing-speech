/**
 * The questions the match thresholds are set from, shared by calibrate-thresholds.ts and
 * bench-cf-embed.ts so every embedding model is judged on the same wording.
 */
/** Questions no official page answers. Nothing here may clear the floor. */
export const OUT_OF_SCOPE = [
	'which brand of vitamin should I buy for my knee',
	'what is the weather tomorrow',
	'can you call my daughter for me',
	'my neighbour is very noisy at night',
	'how do I cook chicken rice',
	'is the stock market going up',
	'my phone screen is cracked',
	'when is the next bus to Tampines',
	'my grandson wants to borrow money',
	'which hospital has the best food',
	'can you book me a taxi',
	'what time does the coffee shop open',
];

/**
 * Real questions in a person's own words, none of them in the index.
 *
 * The entries' own example phrasings cannot be used: they are embedded into the index, so
 * querying with one scores about 1.00 against a copy of itself and teaches nothing. These
 * are the answer-eval questions, which is the wording the product is judged on anyway.
 */
export const ASKED = [
	'what is MediShield Life for',
	'how much is my MediShield premium when I am 70',
	'can I use MediShield if I already have company insurance',
	'I cannot afford my MediShield premium, what can I do',
	'what is the difference between MediShield Life and CareShield Life',
	'can I use my MediSave to pay my father hospital bill',
	'not enough money in my MediSave for the hospital bill, how',
	'how much MediSave can I use for one day in hospital',
	'can MediSave pay for my outpatient medicine',
	'can I use MediSave to pay my wife medical bill',
	'how do I apply for the CHAS card',
	'am I eligible for CHAS subsidy',
	'I lost my Pioneer Generation card how to get a new one',
	'what do I get with the Merdeka Generation package',
	'how do I join Healthier SG at my clinic',
	'the doctor charge too expensive, got subsidy or not',
	'how do I know if I am covered by CareShield Life',
	'how do I claim CareShield Life for my mother',
	'what is ElderShield and do I still have it',
	'what is ElderFund for',
	'who pays for the nursing home',
	'can I use my MediSave for treatment overseas',
	'I live in Malaysia now, can I still get my CPF payout',
	'someone call me say from CPF ask for my Singpass, is it real',
	'I think I got scammed, what do I do now',
	'when do I start getting my CPF monthly payout',
	'how much CPF can I take out at 55',
	'what is the retirement sum this year',
	'can I get my CPF money earlier if I am sick',
];
