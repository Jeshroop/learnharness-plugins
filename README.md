# LearnHarness plugins

Community plugins for [LearnHarness](https://github.com/amosblomqvist/learnharness), built on its public plugin
API (v1) so app updates don't conflict with them. Each folder is a complete plugin project with its own build and
tests.

| Plugin | What it does | Status |
| --- | --- | --- |
| [`sketch/`](sketch/) | A lightweight Excalidraw whiteboard for working problems: send a drawing with your answer, or keep it. | Early |
| [`map/`](map/) | A map of the ideas you're learning and the evidence that you've mastered them. | Early |

## Install a plugin

You need Node.js (tested with 24) and LearnHarness 0.6.1 or newer.

```sh
git clone https://github.com/Jeshroop/learnharness-plugins.git
cd learnharness-plugins/sketch        # or map
npm ci
npm run install:local -- "<plugins folder>"
```

The plugins folder is shown in **Settings → Community plugins**. Press **Refresh** there, then enable the plugin.

To update: `git pull`, run the last two commands again, and restart LearnHarness.

## Development

In a plugin folder, `npm test` runs its tests and `npm run typecheck` checks types. `sdk/` holds the plugin API
types from LearnHarness's official authoring kit (**Settings → Community plugins → Download authoring skill**,
folder `types/`); refresh it from a newer kit when the plugin API changes.

## Licence

AGPL-3.0 — see [LICENSE](LICENSE). Sketch includes code adapted from LearnHarness's Drawing Pad plugin.
Third-party notices: [THIRD-PARTY.md](THIRD-PARTY.md).
