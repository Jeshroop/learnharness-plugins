// One Sketch surface at a time, toggled per chat. The host disposes a surface WITHOUT
// calling onClose when the page is left or the boundary aborts, so a content mount that
// departs for good also counts as closed. Same latest-mount rule as Drawing Pad's main.ts
// (LearnHarness, AGPL-3.0): a mount the host replays at once does not count as leaving.

export interface PadSurface {
	readonly sessionId: string;
	/** Aborted when this pad closes. */
	readonly signal: AbortSignal;
	/** Wrap a content mount's cleanup; when the latest mount departs, the pad counts as closed. */
	departs(cleanup: () => void): () => void;
	/** For the surface's onClose (X or Escape). */
	close(): void;
}

export interface PadToggle {
	toggle(sessionId: string): void;
	close(): void;
	/** The chat whose pad is open, if any. */
	openFor(): string | undefined;
}

interface Pad { sessionId: string; controller: AbortController; closed: boolean; handle?: { dispose(): void }; latest?: object }

export function createPadToggle(open: (pad: PadSurface) => { dispose(): void }): PadToggle {
	let current: Pad | undefined;
	const close = (pad: Pad) => {
		if (pad.closed) return;
		pad.closed = true;
		if (current === pad) current = undefined;
		pad.controller.abort();
		pad.handle?.dispose();
	};
	return {
		toggle(sessionId) {
			const wasOpen = current?.sessionId === sessionId;
			if (current) close(current);
			if (wasOpen) return;
			const pad: Pad = { sessionId, controller: new AbortController(), closed: false };
			current = pad;
			try {
				pad.handle = open({
					sessionId,
					signal: pad.controller.signal,
					departs(cleanup) {
						const mount = {};
						pad.latest = mount;
						let done = false;
						return () => {
							if (done) return;
							done = true;
							cleanup();
							queueMicrotask(() => { if (pad.latest === mount) close(pad); });
						};
					},
					close: () => close(pad),
				});
				if (pad.closed) pad.handle.dispose();
			} catch (error) {
				close(pad);
				throw error;
			}
		},
		close() { if (current) close(current); },
		openFor: () => current?.sessionId,
	};
}
