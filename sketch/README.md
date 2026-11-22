# Sketch

A lightweight [Excalidraw](https://excalidraw.com) whiteboard inside LearnHarness, for working problems by hand.

## What it does

- **Sketch** in the top bar of a teaching or practice chat opens the pad: the real Excalidraw editor, with lines,
  arrows and shapes you can change afterwards, text and handwriting. The pen is the starting tool, and the pad
  follows the app's theme.
- **The question underneath.** The current question appears on the board as a card you can draw beside or on.
  **Question** hides or shows it. When a new question arrives and the board already has working on it, the new
  card goes below it: a new page, and nothing is erased.
- **Send with answer** (on by default). Your next answer or message carries a PNG of the current page. A drawing
  that hasn't changed is never sent twice. Switch it off to keep the drawing to yourself.
- **Nothing is kept by default.** Drawings live in memory, one board per chat, until the app closes. They are
  written to disk only when you press **Save**, or when the tutor keeps one with `keep_sketch` because it shows an
  error in your working (with a one-line reason). Kept drawings are listed under **Sketches** in the sidebar.

## Status

Early. Covered by 58 tests and checked in a headless browser against a stand-in host; first use in the app is
still to come.

## Install

See the [repository README](../README.md#install-a-plugin).

## What it stores

Only kept drawings, in `<plugins folder>/sketch/data/sketches/`: for each, a PNG, the editable `.excalidraw` scene
(it opens in Excalidraw and in Obsidian's Excalidraw plugin) and a small JSON file saying who kept it and why.
An image you send with an answer is stored in the chat by LearnHarness itself, like any attached image. The
plugin sends nothing anywhere.

## Licence

AGPL-3.0. The question capture and the pad's open/close handling are adapted from LearnHarness's Drawing Pad
plugin (AGPL-3.0). Third-party notices: [THIRD-PARTY.md](../THIRD-PARTY.md).
