# Formats

New question formats for LearnHarness tutors, so each question can be asked in the way that tests it best.

## What it does

- **Fill in the blank.** A statement with numbered gaps; type each missing word, value or formula. Numbers match
  by value (0.5, 1/2 and .5 are the same), words ignore case and spacing.
- **Choose the graph.** Two to six small plots; pick the one that matches. Curves are drawn from plain maths
  (`x^2 - 3x + 2`, `sin(2x)`, `1/(x-1)`), with asymptotes handled.
- **Ask as…** On either card you can ask for the same question in another format — multiple choice, a written
  answer, fill in the blank or choose the graph — then press Submit. The tutor asks it again that way; it doesn't
  count as an attempt.
- **Format button** (top bar of a teaching chat). Choose the format of the next question, or keep one for this
  chat. "Tutor decides" is the default.
- The tutor picks a format per question and shows a one-line reason on the card.

## Status

Early. Covered by unit tests and checked in a headless browser against a stand-in host; first use in the app is
still to come.

## Install

See the [repository README](../README.md#install-a-plugin).

## What it stores

Only formats you choose to keep for a chat, in `<plugins folder>/formats/data/chat-formats.json`. Answers are
stored in the chat by LearnHarness itself, like any question. The plugin sends nothing anywhere.

## Licence

AGPL-3.0 — see [LICENSE](LICENSE).
