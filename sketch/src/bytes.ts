// Browser-safe base64 (no Buffer in the window); chunked so large PNGs don't overflow the call stack.
export function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let start = 0; start < bytes.length; start += 32_768) {
		binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
	}
	return btoa(binary);
}
