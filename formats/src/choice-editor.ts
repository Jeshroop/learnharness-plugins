// The Format dialog's state. A change shows at once and builds on the previous change (not on the
// last saved value); only the newest save's reply is shown; the stored choice loading late never
// undoes a change; a failed save shows the newest saved choice again.
export interface FormatValue { format: string; keep: boolean }

export interface ChoiceEditor {
	readonly value: FormatValue;
	loaded(stored: FormatValue): void;
	change(next: Partial<FormatValue>): Promise<void>;
}

export function createChoiceEditor(save: (value: FormatValue) => Promise<FormatValue>, show: (value: FormatValue) => void): ChoiceEditor {
	let value: FormatValue = { format: "auto", keep: false };
	let confirmed = value, confirmedAt = 0, latest = 0, touched = false;
	return {
		get value() { return value; },
		loaded(stored) {
			if (touched) return;
			value = confirmed = stored;
			show(value);
		},
		async change(next) {
			touched = true;
			const format = next.format ?? value.format;
			value = { format, keep: format === "auto" ? false : next.keep ?? value.keep };
			show(value);
			const mine = ++latest;
			try {
				const saved = await save(value);
				if (mine > confirmedAt) { confirmed = saved; confirmedAt = mine; }
				if (mine === latest) { value = saved; show(value); }
			} catch (error) {
				if (mine !== latest) return;
				value = confirmed;
				show(value);
				throw error;
			}
		},
	};
}
