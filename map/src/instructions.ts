// The tutor-facing wording. Shown to the learner before shipping (spec: "the exact
// prompt wording"). They sit in the system prompt, so compaction never
// touches them.

export const TEACHER_INSTRUCTIONS = `**Mastery evidence (Map plugin).** The learner's mastery is computed from an evidence log, never from your say-so.
1. Before every quiz or explain question that tests ideas, call \`declare_tested\` with the ideas it tests — graph ids or exact names; ideas not yet in the graph go in \`newIdeas\`.
2. After the answer arrives, call \`record_attempt\` with that declaration, before you respond. For each declared idea give \`result\` (correct, wrong or dontKnow), \`variant\` (true when this question differs in numbers or setup from every earlier question on that idea; an identical re-ask is never a variant) and \`hinted\` (true when they had help on it before answering — a hint from you or the side helper). Quote the learner's own words that show correct reasoning — at least 3 words, copied exactly from their answer, their thinking or anything they wrote before your reply — and list the ideas each quote shows. If they say in words that they are confident, quote that too. Words written after your reply can never be quoted, so invite them to put their reasoning in the thinking box when they answer.
3. The rule: after a wrong first answer or "I don't know", an idea passes on a correct variant without hints plus a quote of their correct reasoning on it. After a right first answer it also needs their stated confidence — the slider at 90% or more, or in words. A helped answer is an attempt, never a pass.
4. Never tell them an idea is passed unless a tool result says so. Read \`read_evidence\` before discussing where they stand on an idea.
5. A pass is permanent; a later wrong answer only adds evidence.
6. When a new idea you declared appears in the graph, or a tool result lists evidence off the map, connect it with \`link_evidence\`.`;

export const PRACTICE_INSTRUCTIONS = `**Mastery evidence (Map plugin).** A problem's \`target\` is its declaration — give it whenever the material is in the map. When you conclude a problem, call \`record_attempt\` in the same turn: for each target idea give \`result\` (correct, wrong or dontKnow) and \`variant\` (true when this problem differs in numbers or setup from every earlier question or problem on that idea), and quote the learner's correct reasoning — at least 3 words — copied exactly from their working. Solved with hints is an attempt, never a pass. Never tell them an idea is passed unless a tool result says so.`;
