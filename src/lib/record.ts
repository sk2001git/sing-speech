/**
 * Recording helpers shared by both voice screens.
 *
 * Pick a container this browser can record. Hardcoding `audio/webm;codecs=opus` throws on
 * iOS Safari, which records MP4/AAC, so the choice is made at record time and travels with
 * the audio. An empty string means "browser default".
 */
export function pickMimeType(): string {
	const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
	if (typeof MediaRecorder === 'undefined') return '';
	return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary);
}
