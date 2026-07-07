/**
 * Base64 helpers for the live-document wire format: opaque Yjs updates ride
 * as base64 strings inside JSON (matching Go's encoding/json []byte handling).
 * `btoa`/`atob` exist in both browsers and Node 18+, so these are testable in
 * the node vitest project.
 */

const CHUNK = 0x8000;

/** Encode bytes to base64 (chunked so large arrays don't blow the arg limit). */
export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/** Decode base64 to bytes. Throws on malformed input (atob semantics). */
export function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
