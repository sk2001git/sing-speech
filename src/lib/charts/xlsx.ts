/**
 * Just enough of .xlsx to read a government statistics file in a Worker (vault plan-suara-0017),
 * with no library: an .xlsx is a zip of XML parts, the platform inflates zip entries
 * (DecompressionStream 'deflate-raw', in Workers, browsers and Node), and the cells are plain XML.
 *
 * Reads values only: text (shared or inline) and numbers. Dates stay Excel day numbers; turn
 * them into ISO dates with `excelDate`. Formulas give their cached value. Styles are ignored.
 */
export type Cell = string | number | null;
export type Sheets = Record<string, Cell[][]>;

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/** Every entry of a zip, name to bytes. */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
	// The end-of-central-directory record sits in the last 64 KB plus 22 bytes.
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
		if (u32(bytes, i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not an .xlsx file: no zip directory');
	const count = u16(bytes, eocd + 10);
	let at = u32(bytes, eocd + 16);
	const out = new Map<string, Uint8Array>();
	const names = new TextDecoder();
	for (let n = 0; n < count; n++) {
		if (u32(bytes, at) !== 0x02014b50) throw new Error('not an .xlsx file: broken zip directory');
		const method = u16(bytes, at + 10);
		const size = u32(bytes, at + 20);
		const nameLen = u16(bytes, at + 28);
		const extraLen = u16(bytes, at + 30);
		const commentLen = u16(bytes, at + 32);
		const local = u32(bytes, at + 42);
		const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLen));
		at += 46 + nameLen + extraLen + commentLen;
		const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
		const data = bytes.subarray(start, start + size);
		if (method === 0) out.set(name, data);
		else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
	}
	return out;
}

const decodeXml = (s: string) =>
	s.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (_, name: string, dec?: string, hex?: string) =>
		dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()]!,
	);
/** The text of every <t> inside a fragment: a shared string can be split into runs. */
const textOf = (xml: string) => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(''));

/** "B12" -> column 1. */
function column(ref: string): number {
	let n = 0;
	for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

export async function readSheets(bytes: Uint8Array): Promise<Sheets> {
	const parts = await unzip(bytes);
	const text = (name: string) => {
		const p = parts.get(name);
		return p ? new TextDecoder().decode(p) : '';
	};
	const workbook = text('xl/workbook.xml');
	if (!workbook) throw new Error('not an .xlsx file: no workbook');
	const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1]!, m[2]!.replace(/^\/?(xl\/)?/, 'xl/')]));
	const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

	const sheets: Sheets = {};
	for (const m of workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
		const xml = text(rels.get(m[2]!) ?? '');
		const rows: Cell[][] = [];
		for (const row of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
			const cells: Cell[] = [];
			for (const c of row[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
				const attrs = c[1]!;
				const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
				const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
				const body = c[2] ?? '';
				const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
				let value: Cell = null;
				if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
				else if (type === 'inlineStr') value = textOf(body);
				else if (type === 'str' || type === 'b') value = v === undefined ? null : decodeXml(v);
				else if (v !== undefined) value = Number(v);
				if (ref) cells[column(ref)] = value;
			}
			rows[Number(row[1]) - 1] = Array.from(cells, (x) => x ?? null);
		}
		sheets[decodeXml(m[1]!)] = Array.from(rows, (r) => r ?? []);
	}
	return sheets;
}

/** Excel's day number (1900 date system) as an ISO date. */
export function excelDate(serial: number): string {
	return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}
