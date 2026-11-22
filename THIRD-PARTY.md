# Third-party notices

## Bundled into Sketch's build

| Component | Licence |
| --- | --- |
| [Excalidraw](https://github.com/excalidraw/excalidraw) (`@excalidraw/excalidraw`) and the libraries it bundles | MIT |
| Fonts distributed with Excalidraw: Assistant, Cascadia Code, Comic Shanns, Excalifont, Liberation Sans, Lilita One, Nunito, Virgil | SIL Open Font License 1.1 (Comic Shanns: MIT) |
| [html-to-image](https://github.com/bubkoo/html-to-image) | MIT |
| [React and React DOM](https://github.com/facebook/react) | MIT |

The build keeps each library's licence comments at the end of the bundles. The full licence texts come with each
package in `node_modules/` after `npm ci`.

## Adapted code

- `sketch/src/reference.ts`, `sketch/src/fonts.ts`, `sketch/src/abort.ts`, parts of `sketch/src/capture.ts` and
  `sketch/src/pad-toggle.ts`, and `sketch/tests/reference.test.ts` and `sketch/tests/fonts.test.ts` are adapted
  from the Drawing Pad plugin in [LearnHarness](https://github.com/amosblomqvist/learnharness) (AGPL-3.0).
- `sdk/` holds the plugin API types from LearnHarness's authoring kit (AGPL-3.0).

Map and Formats bundle no third-party code.
