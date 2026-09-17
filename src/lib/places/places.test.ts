import { describe, expect, it } from 'vitest';
import { addressLine, displayName, findPlaces, parseKvTable, placeFromChas, placeFromEldercare, placeFromPharmacy, placeIntent, type Place } from './places';

/** Verbatim shapes from the three data.gov.sg datasets, trimmed. */
const chasFeature = {
	geometry: { type: 'Point', coordinates: [103.678409741881, 1.32561767794228, 0] },
	properties: {
		Name: 'kml_1',
		Description:
			"<center><table><tr><th colspan='2'><em>Attributes</em></th></tr>" +
			'<tr><th>HCI_CODE</th> <td>15M0211</td> </tr><tr><th>HCI_NAME</th> <td>Acumed Medical Group</td> </tr>' +
			'<tr><th>LICENCE_TYPE</th> <td>MC</td> </tr><tr><th>HCI_TEL</th> <td>68615755</td> </tr>' +
			'<tr><th>POSTAL_CD</th> <td>629117</td> </tr><tr><th>BLK_HSE_NO</th> <td>1</td> </tr>' +
			'<tr><th>FLOOR_NO</th> <td>01</td> </tr><tr><th>UNIT_NO</th> <td>23</td> </tr>' +
			'<tr><th>STREET_NAME</th> <td>JOO KOON CIRCLE</td> </tr><tr><th>BUILDING_NAME</th> <td>FAIRPRICE HUB</td> </tr>' +
			'<tr><th>CLINIC_PROGRAMME_CODE</th> <td>CDMP,CHAS</td> </tr></table></center>',
	},
};

const eldercareFeature = {
	geometry: { type: 'Point', coordinates: [103.7405, 1.3339, 0] },
	properties: {
		Description:
			'<center><table><tr><th>ADDRESSBLOCKHOUSENUMBER</th> <td></td> </tr>' +
			'<tr><th>ADDRESSPOSTALCODE</th> <td>601318</td> </tr>' +
			'<tr><th>ADDRESSSTREETNAME</th> <td>318A Jurong East Avenue 1 #02-308</td> </tr>' +
			'<tr><th>NAME</th> <td>NTUC Health Senior Day Care (Jurong East)</td> </tr>' +
			'<tr><th>DESCRIPTION</th> <td>Senior day care</td> </tr>' +
			'<tr><th>HYPERLINK</th> <td>https://example.gov.sg/centre</td> </tr></table></center>',
	},
};

const pharmacyFeature = {
	geometry: { type: 'Point', coordinates: [103.8455, 1.2977, 0] },
	properties: {
		OBJECTID_1: 12,
		POSTAL_CODE: '238877',
		BUILDING_NAME: 'ION ORCHARD',
		UNIT_NO: '15',
		LEVEL_NO: 'B4',
		ROAD_NAME: 'ORCHARD TURN',
		HOUSE_BLK_NO: '2',
		PHARMACY_NAME: 'Guardian Health & Beauty',
	},
};

describe('parseKvTable', () => {
	it('reads the attribute table data.gov.sg hides inside a description', () => {
		const fields = parseKvTable(chasFeature.properties.Description);
		expect(fields.HCI_NAME).toBe('Acumed Medical Group');
		expect(fields.HCI_TEL).toBe('68615755');
		expect(fields.POSTAL_CD).toBe('629117');
	});

	it('returns nothing for a description that is not a table', () => {
		expect(parseKvTable('<p>no table here</p>')).toEqual({});
	});
});

describe('reading each dataset into one shape', () => {
	it('reads a CHAS clinic, with its phone and what it takes', () => {
		const place = placeFromChas(chasFeature)!;
		expect(place).toMatchObject({
			kind: 'chas-clinic',
			name: 'Acumed Medical Group',
			phone: '68615755',
			postal: '629117',
			street: 'JOO KOON CIRCLE',
			building: 'FAIRPRICE HUB',
			block: '1',
			unit: '01-23',
		});
		expect(place.lat).toBeCloseTo(1.3256, 3);
		expect(place.lon).toBeCloseTo(103.6784, 3);
		expect(place.tags).toContain('CHAS');
	});

	it('reads an eldercare service, whose address is one loose line', () => {
		const place = placeFromEldercare(eldercareFeature)!;
		expect(place).toMatchObject({
			kind: 'eldercare',
			name: 'NTUC Health Senior Day Care (Jurong East)',
			postal: '601318',
			street: '318A Jurong East Avenue 1 #02-308',
			link: 'https://example.gov.sg/centre',
		});
	});

	it('reads a pharmacy, whose fields are plain', () => {
		expect(placeFromPharmacy(pharmacyFeature)!).toMatchObject({
			kind: 'pharmacy',
			name: 'Guardian Health & Beauty',
			postal: '238877',
			street: 'ORCHARD TURN',
			building: 'ION ORCHARD',
			block: '2',
			unit: 'B4-15',
		});
	});

	it('skips a feature with no name rather than showing a blank card', () => {
		expect(placeFromPharmacy({ ...pharmacyFeature, properties: { ...pharmacyFeature.properties, PHARMACY_NAME: '' } })).toBeNull();
	});
});

describe('addressLine', () => {
	it('reads the way someone would say it, not shouted the way the file stores it', () => {
		// Brand capitalisation ("FairPrice") cannot be recovered from an all-caps record,
		// and inventing it would be a guess on a card that claims to come from a dataset.
		expect(addressLine(placeFromChas(chasFeature)!)).toBe('Blk 1 Joo Koon Circle, #01-23, Fairprice Hub, Singapore 629117');
	});

	it('leaves out the parts a record does not have', () => {
		expect(addressLine(placeFromEldercare(eldercareFeature)!)).toBe('318A Jurong East Avenue 1 #02-308, Singapore 601318');
	});
});

describe('displayName', () => {
	it('stops a shouted record shouting on the card', () => {
		expect(displayName({ ...placeFromChas(chasFeature)!, name: 'BALKIS FAMILY CLINIC' })).toBe('Balkis Family Clinic');
	});

	it('leaves a name that was already written properly', () => {
		expect(displayName(placeFromEldercare(eldercareFeature)!)).toBe('NTUC Health Senior Day Care (Jurong East)');
	});
});

describe('placeIntent', () => {
	it('hears a clinic question and keeps only the area words', () => {
		expect(placeIntent('Where is the nearest CHAS clinic in Bedok?')).toEqual({ kind: 'chas-clinic', area: 'bedok' });
		expect(placeIntent('I need a doctor near Toa Payoh')).toEqual({ kind: 'chas-clinic', area: 'toa payoh' });
	});

	it('hears the other two kinds', () => {
		expect(placeIntent('Is there a pharmacy at Ion Orchard')).toMatchObject({ kind: 'pharmacy', area: 'ion orchard' });
		expect(placeIntent('senior day care centre in Jurong East')).toMatchObject({ kind: 'eldercare', area: 'jurong east' });
	});

	it('is not a place question without a place word', () => {
		expect(placeIntent('How do I reset my Singpass password')).toBeNull();
		expect(placeIntent('What is CHAS')).toBeNull();
	});

	it('is not a place question without somewhere to look', () => {
		expect(placeIntent('Where is the nearest clinic')).toBeNull();
	});
});

describe('findPlaces', () => {
	const places: Place[] = [
		placeFromChas(chasFeature)!,
		placeFromEldercare(eldercareFeature)!,
		placeFromPharmacy(pharmacyFeature)!,
		{ ...placeFromChas(chasFeature)!, id: 'c2', name: 'Bedok Family Clinic', street: 'BEDOK NORTH STREET 1', building: '', postal: '460123' },
		{ ...placeFromChas(chasFeature)!, id: 'c3', name: 'Bedok Day Clinic', street: 'BEDOK SOUTH AVENUE 2', building: '', postal: '460456' },
	];

	it('finds places by the area a person would say, in a stable order', () => {
		const found = findPlaces(places, { area: 'bedok' });
		expect(found.map((p) => p.name)).toEqual(['Bedok Day Clinic', 'Bedok Family Clinic']);
	});

	it('narrows to the kind they asked for', () => {
		expect(findPlaces(places, { area: 'jurong east', kind: 'eldercare' }).map((p) => p.kind)).toEqual(['eldercare']);
		expect(findPlaces(places, { area: 'jurong', kind: 'pharmacy' })).toEqual([]);
	});

	it('matches a building or a clinic name as well as a street', () => {
		expect(findPlaces(places, { area: 'ion orchard' }).map((p) => p.kind)).toEqual(['pharmacy']);
		expect(findPlaces(places, { area: 'acumed' }).map((p) => p.name)).toContain('Acumed Medical Group');
	});

	it('returns at most six, so the screen stays the same shape as an answer', () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ ...places[3]!, id: `x${i}`, name: `Bedok Clinic ${i}` }));
		expect(findPlaces(many, { area: 'bedok' })).toHaveLength(6);
	});

	it('gives nothing rather than everything when the area is unknown', () => {
		expect(findPlaces(places, { area: 'atlantis' })).toEqual([]);
		expect(findPlaces(places, { area: '' })).toEqual([]);
	});
});
