// Adds the drawing to the learner channel a submission already has.
// Same channel mapping as Drawing Pad's appendDrawing (LearnHarness, AGPL-3.0).
import type { ImageContent } from "@earendil-works/pi-ai";
import type { PluginSubmission } from "learnharness-plugin-api";

/** Append to the existing native image channel. Never change text, selections or JSON. */
export function appendImage(input: PluginSubmission, image: Readonly<ImageContent>): PluginSubmission {
	switch (input.type) {
		case "text":
		case "thinking":
			return { ...input, content: { ...input.content, images: [...input.content.images, image] } };
		case "answer":
			return { ...input, answer: { ...input.answer, images: [...input.answer.images, image] } };
		case "plugin-question-answer":
			return { ...input, answerImages: [...input.answerImages, image] };
		case "plugin-problem-submission":
			return { ...input, submissionImages: [...input.submissionImages, image] };
	}
}
