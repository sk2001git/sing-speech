/**
 * Places from Singapore open data: CHAS clinics, eldercare services, retail pharmacies
 * (vault obs-0038, dec-suara-0019).
 *
 * These are not knowledge-base entries and never pretend to be: an entry quotes an
 * official page, a place is a row from a published dataset. They are shown on their own
 * card with the dataset named and the date it was read.
 *
 * Every dataset stores its detail differently — two hide an attribute table inside an HTML
 * description, one keeps plain fields — so each gets a reader here and they all end as the
 * same `Place`.
 */
export type PlaceKind = 'chas-clinic' | 'eldercare' | 'pharmacy';

export interface Place {
	id: string;
	kind: PlaceKind;
	name: string;
	phone?: string;
	block?: string;
	street?: string;
	building?: string;
	unit?: string;
	postal?: string;
	link?: string;
	note?: string;
	tags?: string[];
	lat?: number;
	lon?: number;
}

interface Feature {
	geometry?: { coordinates?: number[] };
	properties?: Record<string, unknown>;
}

/** data.gov.sg hides the real fields in an HTML table inside `Description`. */
export function parseKvTable(html: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!html) return out;
	for (const m of html.matchAll(/<th>\s*([A-Z_0-9]+)\s*<\/th>\s*<td>([^<]*)<\/td>/g)) {
		const value = m[2]!.trim();
		if (value) out[m[1]!] = value;
	}
	return out;
}

const coords = (f: Feature) => ({ lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] });

/** "01" + "23" is how a record spells "#01-23". */
const unitOf = (floor?: string, unit?: string) => (floor && unit ? `${floor}-${unit}` : undefined);

export function placeFromChas(f: Feature): Place | null {
	const k = parseKvTable(f.properties?.Description as string);
	if (!k.HCI_NAME) return null;
	return {
		id: `chas:${k.HCI_CODE ?? k.HCI_NAME}`,
		kind: 'chas-clinic',
		name: k.HCI_NAME,
		...(k.HCI_TEL ? { phone: k.HCI_TEL } : {}),
		...(k.BLK_HSE_NO ? { block: k.BLK_HSE_NO } : {}),
		...(k.STREET_NAME ? { street: k.STREET_NAME } : {}),
		...(k.BUILDING_NAME ? { building: k.BUILDING_NAME } : {}),
		...(unitOf(k.FLOOR_NO, k.UNIT_NO) ? { unit: unitOf(k.FLOOR_NO, k.UNIT_NO) } : {}),
		...(k.POSTAL_CD ? { postal: k.POSTAL_CD } : {}),
		tags: (k.CLINIC_PROGRAMME_CODE ?? '').split(',').map((t) => t.trim()).filter(Boolean),
		...coords(f),
	};
}

export function placeFromEldercare(f: Feature): Place | null {
	const k = parseKvTable(f.properties?.Description as string);
	if (!k.NAME) return null;
	return {
		id: `eldercare:${k.ADDRESSPOSTALCODE ?? ''}:${k.NAME}`,
		kind: 'eldercare',
		name: k.NAME,
		...(k.ADDRESSBLOCKHOUSENUMBER ? { block: k.ADDRESSBLOCKHOUSENUMBER } : {}),
		...(k.ADDRESSSTREETNAME ? { street: k.ADDRESSSTREETNAME } : {}),
		...(k.ADDRESSBUILDINGNAME ? { building: k.ADDRESSBUILDINGNAME } : {}),
		...(unitOf(k.ADDRESSFLOORNUMBER, k.ADDRESSUNITNUMBER) ? { unit: unitOf(k.ADDRESSFLOORNUMBER, k.ADDRESSUNITNUMBER) } : {}),
		...(k.ADDRESSPOSTALCODE ? { postal: k.ADDRESSPOSTALCODE } : {}),
		...(k.HYPERLINK ? { link: k.HYPERLINK } : {}),
		...(k.DESCRIPTION ? { note: k.DESCRIPTION } : {}),
		...coords(f),
	};
}

export function placeFromPharmacy(f: Feature): Place | null {
	const p = (f.properties ?? {}) as Record<string, string>;
	if (!p.PHARMACY_NAME) return null;
	return {
		id: `pharmacy:${p.OBJECTID_1 ?? p.POSTAL_CODE ?? p.PHARMACY_NAME}`,
		kind: 'pharmacy',
		name: p.PHARMACY_NAME,
		...(p.HOUSE_BLK_NO ? { block: p.HOUSE_BLK_NO } : {}),
		...(p.ROAD_NAME ? { street: p.ROAD_NAME } : {}),
		...(p.BUILDING_NAME ? { building: p.BUILDING_NAME } : {}),
		...(unitOf(p.LEVEL_NO, p.UNIT_NO) ? { unit: unitOf(p.LEVEL_NO, p.UNIT_NO) } : {}),
		...(p.POSTAL_CODE ? { postal: p.POSTAL_CODE } : {}),
		...coords(f),
	};
}

/** Datasets shout their addresses in capitals; a person reading a card should not be shouted at. */
function titleCase(text: string): string {
	if (!/[a-z]/.test(text)) {
		return text
			.toLowerCase()
			.replace(/\b([a-z])/g, (c) => c.toUpperCase())
			.replace(/\bBlk\b/gi, 'Blk');
	}
	return text;
}

/** Datasets store names in capitals; a card should not shout at a reader. */
export const displayName = (place: Place) => titleCase(place.name);

export function addressLine(place: Place): string {
	const parts: string[] = [];
	// Title-case the street itself, then add the block, so "Blk" is not the lowercase that
	// makes the rest look already-cased.
	if (place.street) parts.push(place.block ? `Blk ${place.block} ${titleCase(place.street)}` : titleCase(place.street));
	else if (place.block) parts.push(`Blk ${place.block}`);
	if (place.unit) parts.push(`#${place.unit}`);
	if (place.building) parts.push(titleCase(place.building));
	if (place.postal) parts.push(`Singapore ${place.postal}`);
	return parts.join(', ');
}

/** Words that say which kind of place, in the ways people ask for them. */
const KIND_WORDS: Array<[PlaceKind, RegExp]> = [
	['pharmacy', /\b(pharmacy|pharmacies|chemist|guardian|watsons|medicine shop|drug ?store)\b/],
	['eldercare', /\b(eldercare|elder care|day care|daycare|senior care|senior centre|senior center|active ageing|nursing home|respite)\b/],
	['chas-clinic', /\b(chas|clinic|clinics|gp|doctor|polyclinic|dentist|dental)\b/],
];

/** Words that carry no place, so they never count as an area. */
const NOT_AN_AREA = new Set(
	('where is the nearest near me my closest find any there a an and or of at in to for i need want looking' +
		' show tell know get go can please help me house home hdb block street road avenue singapore sg' +
		' open now today tomorrow which what who how does do is are ' +
		'chas clinic clinics gp doctor polyclinic dentist dental pharmacy pharmacies chemist medicine shop drugstore' +
		' eldercare elder care day daycare senior centre center active ageing nursing respite')
		.split(/\s+/)
		.filter(Boolean),
);

export interface PlaceIntent {
	kind: PlaceKind;
	/** The words left after the question itself: where to look. */
	area: string;
}

/**
 * Is this a "where is…" question, and about what? Returns null unless the request names
 * both a kind of place and somewhere to look — "where is the nearest clinic" alone cannot
 * be answered honestly without a location, and guessing one would be worse than asking.
 */
export function placeIntent(meaning: string): PlaceIntent | null {
	const text = normalise(meaning);
	const kind = KIND_WORDS.find(([, re]) => re.test(text))?.[0];
	if (!kind) return null;
	const area = text
		.split(' ')
		.filter((word) => word.length > 1 && !NOT_AN_AREA.has(word))
		.join(' ')
		.trim();
	return area ? { kind, area } : null;
}

export const PLACE_PAGE = 6;

export interface PlaceQuery {
	/** What the person said: an area, a street, a building or a name. */
	area: string;
	kind?: PlaceKind;
	limit?: number;
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Match on the words a person actually says — "bedok", "jurong east", "ion orchard" — over
 * the street, building and name. No geocoder: an unknown area returns nothing, which is
 * honest, rather than the whole island sorted by accident.
 */
export function findPlaces(places: readonly Place[], query: PlaceQuery): Place[] {
	const area = normalise(query.area);
	if (!area) return [];
	const words = area.split(' ').filter((w) => w.length > 1);
	if (words.length === 0) return [];

	const scored: Array<{ place: Place; score: number }> = [];
	for (const place of places) {
		if (query.kind && place.kind !== query.kind) continue;
		const haystack = normalise([place.street, place.building, place.name, place.postal].filter(Boolean).join(' '));
		if (!haystack) continue;
		let score = 0;
		if (haystack.includes(area)) score += 10;
		for (const word of words) if (haystack.includes(word)) score += 2;
		if (score > 0) scored.push({ place, score });
	}

	return scored
		.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
		.slice(0, query.limit ?? PLACE_PAGE)
		.map((s) => s.place);
}
