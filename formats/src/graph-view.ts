// Choose the graph: the question card, the plot picker and the answered card.
import type { PluginFrontendContext, PluginQuestionEditorHandle, PluginQuestionRenderer } from "learnharness-plugin-api";
import { mountPrompt, mountWhy } from "./card.ts";
import { bag, el } from "./dom.ts";
import { formatLabel, readReformat } from "./formats.ts";
import { GRAPH_TYPE_ID, LETTERS, graphViewport, optionPaths, type GraphAnswer, type GraphGrade, type GraphPayload } from "./graph.ts";
import { axisTicks, tickLabels, toSvgPath, type Path } from "./plot.ts";
import { mountReformat } from "./reformat-view.ts";

type Ui = PluginFrontendContext["ui"];
type View = { x: [number, number]; y: [number, number] };
const SVG_NS = "http://www.w3.org/2000/svg";
const W = 220, H = 160;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, typeof value === "number" ? value.toFixed(1) : value);
	return node;
}

/** One option's mini-plot: light grid, axes through the origin when in view, the curves. */
export function plotSvg(paths: Path[], view: View, label: string): SVGSVGElement {
	const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "fmt-plot", role: "img", "aria-label": label });
	const sx = (x: number) => ((x - view.x[0]) / (view.x[1] - view.x[0])) * W;
	const sy = (y: number) => H - ((y - view.y[0]) / (view.y[1] - view.y[0])) * H;
	for (const t of axisTicks(view.x)) root.append(svg("line", { x1: sx(t), x2: sx(t), y1: 0, y2: H, class: "fmt-grid" }));
	for (const t of axisTicks(view.y)) root.append(svg("line", { x1: 0, x2: W, y1: sy(t), y2: sy(t), class: "fmt-grid" }));
	if (view.y[0] <= 0 && view.y[1] >= 0) root.append(svg("line", { x1: 0, x2: W, y1: sy(0), y2: sy(0), class: "fmt-axis" }));
	if (view.x[0] <= 0 && view.x[1] >= 0) root.append(svg("line", { x1: sx(0), x2: sx(0), y1: 0, y2: H, class: "fmt-axis" }));
	const d = toSvgPath(paths, { ...view, width: W, height: H });
	if (d) root.append(svg("path", { d, class: "fmt-curve" }));
	for (const label of tickLabels({ ...view, width: W, height: H })) {
		const node = svg("text", { x: label.x, y: label.y, class: "fmt-tick", "text-anchor": label.axis === "x" ? "middle" : "start" });
		node.textContent = label.text;
		root.append(node);
	}
	return root;
}

function readChoice(value: unknown): string | null {
	const choice = value && typeof value === "object" ? (value as { choice?: unknown }).choice : undefined;
	return typeof choice === "string" ? choice : null;
}

export function graphRenderer(ui: Ui): PluginQuestionRenderer<GraphPayload, GraphAnswer> {
	return {
		id: GRAPH_TYPE_ID,
		supportedContractVersions: [1],
		mountQuestion(container, context) {
			const cleanup = bag();
			const root = el("div", "fmt-question");
			container.append(root);
			cleanup.add(() => root.remove());
			mountPrompt(root, ui, context.input.question, context.signal, cleanup);
			mountWhy(root, context.input.payload.why);
			return () => cleanup.dispose();
		},
		mountAnswerEditor(container, props): PluginQuestionEditorHandle {
			const payload = props.input.payload;
			const view = graphViewport(payload);
			const paths = optionPaths(payload, view.x);
			let active = props.active, disposed = false;
			let choice: string | null = props.answer.status !== "empty" ? readChoice(props.answer.value) : null;
			const root = el("div", "fmt-editor fmt-graph-editor");
			const group = el("div", "fmt-options");
			group.setAttribute("role", "radiogroup");
			group.setAttribute("aria-label", "Graphs");
			const cards = payload.options.map((_, i) => {
				const letter = LETTERS[i]!;
				const card = el("button", "fmt-option");
				card.type = "button";
				card.setAttribute("role", "radio");
				card.dataset.letter = letter;
				card.append(el("span", "fmt-option-letter", letter), plotSvg(paths[i] ?? [], view, `Graph ${letter}`));
				card.addEventListener("click", () => select(letter));
				group.append(card);
				return card;
			});
			root.append(group);
			container.append(root);
			const render = () => cards.forEach((card, i) => {
				const on = card.dataset.letter === choice;
				card.setAttribute("aria-checked", String(on));
				card.tabIndex = on || (!choice && i === 0) ? 0 : -1;
			});
			const publish = () => {
				if (disposed || props.signal.aborted || !active) return;
				props.onChange(choice ? { status: "ready", value: { choice } } : { status: "empty" });
			};
			function select(letter: string) { choice = letter; render(); publish(); }
			const onKey = (event: KeyboardEvent) => {
				const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
				if (!step || disposed || !active) return;
				event.preventDefault();
				const index = Math.max(0, cards.findIndex(card => card.dataset.letter === choice));
				const next = cards[(index + step + cards.length) % cards.length]!;
				select(next.dataset.letter!);
				next.focus();
			};
			group.addEventListener("keydown", onKey);
			const reformat = mountReformat(root, "graph", {
				pick: id => { if (!disposed && active) props.onChange({ status: "ready", value: { reformat: id } }); },
				undo: publish,
				setDisabled: off => { for (const card of cards) card.disabled = off; },
			});
			render();
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				group.removeEventListener("keydown", onKey);
				reformat.dispose();
				root.remove();
			};
			props.signal.addEventListener("abort", dispose, { once: true });
			return {
				update(next) {
					if (disposed) return;
					active = next.active;
					choice = next.answer.status !== "empty" ? readChoice(next.answer.value) ?? choice : null;
					render();
				},
				focus() { if (!disposed && active) (cards.find(card => card.dataset.letter === choice) ?? cards[0])?.focus(); },
				handleKeyDown: () => "pass",
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
			const payload = props.input.payload;
			const grade = props.grading && "result" in props.grading ? props.grading.result as GraphGrade : undefined;
			const picked = "choice" in props.answer ? props.answer.choice : "";
			const answer = grade && "answer" in grade ? grade.answer : payload.correct;
			const view = graphViewport(payload);
			const paths = optionPaths(payload, view.x);
			const group = el("div", "fmt-options");
			payload.options.forEach((_, i) => {
				const letter = LETTERS[i]!;
				const card = el("div", "fmt-option fmt-option-static");
				if (letter === picked) card.classList.add("fmt-picked");
				if (letter === answer) card.classList.add("fmt-answer");
				card.append(el("span", "fmt-option-letter", letter), plotSvg(paths[i] ?? [], view, `Graph ${letter}`));
				const tags = [letter === picked ? "Your pick" : "", letter === answer ? "Answer" : ""].filter(Boolean).join(" · ");
				if (tags) card.append(el("span", "fmt-option-tag", tags));
				group.append(card);
			});
			root.append(group);
			if (grade && "correct" in grade && props.headerContainer) {
				cleanup.add(ui.mountBadge(props.headerContainer, { text: grade.correct ? "Correct" : "Not quite" }, { signal: props.signal }));
			}
			return () => cleanup.dispose();
		},
	};
}
