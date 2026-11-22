// What the tutors are told about the formats. Pronoun-neutral ("the learner").

const REFORMAT = "If an answer to one of these questions is {\"reformat\": \"<format>\"}, the learner wants the same question in that format (multiple-choice, written, blank or graph): ask it again in that format with the same content. It is not an attempt — don't judge it or record it as evidence.";
const CHOICE = "When the question_format tool is present, the learner has chosen a format: follow it unless the question can't be asked that way, and then say why in one line. An explicit learner choice outranks other question-format guidance. If your tool for a requested format isn't available, use the closest one you have and say so.";

export const TEACHER_INSTRUCTIONS = [
	"**Question formats (Formats plugin).** Besides multiple choice and written answers you can ask:",
	"fill_in_blank — numbered gaps the learner types into; best for exact terms, values, formulas, units or steps;",
	"choose_graph — the learner picks which of 2–6 plotted graphs matches; best for the shapes of functions, transformations, roots, turning points and asymptotes.",
	"For each question choose the format that best tests the idea, and give a one-line reason in the payload's why (it is shown on the card).",
	REFORMAT,
	CHOICE,
].join(" ");

export const PROBER_INSTRUCTIONS = [
	"**Question formats (Formats plugin).** Besides your usual probes you can probe with probe_fill_in_blank (numbered gaps for exact terms, values or formulas)",
	"and probe_choose_graph (pick which plotted graph matches). Choose the format that best reveals what the learner already knows, with a one-line why.",
	REFORMAT,
	CHOICE,
].join(" ");
