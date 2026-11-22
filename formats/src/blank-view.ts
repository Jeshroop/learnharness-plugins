// Fill in the blank: the question card, the answer box and the answered card.
import type { PluginFrontendContext, PluginQuestionEditorHandle, PluginQuestionRenderer } from "learnharness-plugin-api";
import { BLANK_TYPE_ID, stemMarkdown, type BlankAnswer, type BlankGrade, type BlankPayload } from "./blank.ts";
import { mountPrompt, mountWhy } from "./card.ts";
import { bag, el, escapeMarkdown } from "./dom.ts";
import { formatLabel, readReformat } from "./formats.ts";
import { mountReformat } from "./reformat-view.ts";

type Ui = PluginFrontendContext["ui"];

export function blankRenderer(ui: Ui): PluginQuestionRenderer<BlankPayload, BlankAnswer> {
	return {
		id: BLANK_TYPE_ID,
		supportedContractVersions: [1],
		mountQuestion(container, context) {
			const cleanup = bag();
			const root = el("div", "fmt-question");
			container.append(root);
			cleanup.add(() => root.remove());
			mountPrompt(root, ui, context.input.question, context.signal, cleanup);
			const stem = el("div", "fmt-stem");
			root.append(stem);
			cleanup.add(ui.mountMarkdown(stem, { text: stemMarkdown(context.input.payload.text, k => `**[ ${k} ]**`) }, { signal: context.signal }));
			mountWhy(root, context.input.payload.why);
			return () => cleanup.dispose();
		},
		mountAnswerEditor(container, props): PluginQuestionEditorHandle {
			const payload = props.input.payload;
			let active = props.active, disposed = false;
			const root = el("div", "fmt-editor fmt-blank-editor");
			container.append(root);
			const initial = props.answer.status !== "empty" && props.answer.value && typeof props.answer.value === "object" && "blanks" in (props.answer.value as object)
				? (props.answer.value as { blanks: string[] }).blanks : [];
			const inputs = payload.blanks.map((gap, i) => {
				const row = el("label", "fmt-gap");
				row.append(el("span", "fmt-gap-number", String(i + 1)));
				const input = el("input", "fmt-gap-input");
				input.type = "text";
				input.autocomplete = "off";
				input.spellcheck = false;
				input.placeholder = gap.hint ?? "";
				input.setAttribute("aria-label", `Gap ${i + 1}`);
				input.value = initial[i] ?? "";
				row.append(input);
				root.append(row);
				return input;
			});
			const publish = () => {
				if (disposed || props.signal.aborted || !active) return;
				const values = inputs.map(input => input.value);
				const filled = values.filter(v => v.trim() !== "").length;
				props.onChange(filled === 0 ? { status: "empty" } : { status: filled === values.length ? "ready" : "unready", value: { blanks: values } });
			};
			const reformat = mountReformat(root, "blank", {
				pick: id => { if (!disposed && active) props.onChange({ status: "ready", value: { reformat: id } }); },
				undo: publish,
				setDisabled: off => { for (const input of inputs) input.disabled = off; },
			});
			for (const input of inputs) input.addEventListener("input", publish);
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				for (const input of inputs) input.removeEventListener("input", publish);
				reformat.dispose();
				root.remove();
			};
			props.signal.addEventListener("abort", dispose, { once: true });
			if (!props.signal.aborted && props.answer.status === "empty") publish();
			return {
				update(next) {
					if (disposed) return;
					active = next.active;
					const value = next.answer.status !== "empty" ? next.answer.value as { blanks?: unknown } | null : null;
					if (value && Array.isArray(value.blanks)) value.blanks.forEach((text, i) => { if (inputs[i] && inputs[i].value !== text && typeof text === "string") inputs[i].value = text; });
					else if (next.answer.status === "empty") for (const input of inputs) input.value = "";
				},
				focus() { if (!disposed && active) (inputs.find(input => input.value.trim() === "") ?? inputs[0])?.focus(); },
				handleKeyDown(key) {
					if (disposed || !active || key !== "Tab") return "pass";
					const index = inputs.findIndex(input => input === document.activeElement);
					if (index >= 0 && index < inputs.length - 1) { inputs[index + 1]!.focus(); return "handled"; }
					return "pass";
				},
				dispose,
			};
		},
		mountAnswered(container, props) {
			const cleanup = bag();
			const root = el("div", "fmt-question fmt-answered");
			container.append(root);
			cleanup.add(() => root.remove());
			mountPrompt(root, ui, props.input.question, props.signal, cleanup);
			const requested = readReformat(props.answer);
			if (requested) {
				root.append(el("p", "fmt-reformatted", `Asked for this as “${formatLabel(requested)}” instead.`));
				return () => cleanup.dispose();
			}
			const given = "blanks" in props.answer ? props.answer.blanks : [];
			const grade = props.grading && "result" in props.grading ? props.grading.result as BlankGrade : undefined;
			const marks = grade && "blanks" in grade ? grade.blanks : undefined;
			const stem = el("div", "fmt-stem");
			root.append(stem);
			cleanup.add(ui.mountMarkdown(stem, {
				text: stemMarkdown(props.input.payload.text, k => {
					const mark = marks?.[k - 1] ? (marks[k - 1]!.correct ? " ✓" : " ✗") : "";
					return `**${escapeMarkdown(given[k - 1]?.trim() || "—")}**${mark}`;
				}),
			}, { signal: props.signal }));
			const misses = marks ? props.input.payload.blanks.map((gap, i) => ({ gap, i })).filter(({ i }) => marks[i] && !marks[i]!.correct) : [];
			if (misses.length) {
				const list = el("ul", "fmt-misses");
				for (const { gap, i } of misses) list.append(el("li", undefined, `Gap ${i + 1}: ${gap.accept.join(" / ")}`));
				root.append(el("p", "fmt-misses-label", "Accepted answers"), list);
			}
			if (marks && props.headerContainer) {
				const right = marks.filter(m => m.correct).length;
				cleanup.add(ui.mountBadge(props.headerContainer, { text: right === marks.length ? "All correct" : `${right} of ${marks.length}` }, { signal: props.signal }));
			}
			return () => cleanup.dispose();
		},
	};
}
