// Test-only drawing payloads.
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from("rest-of-png")]).toString("base64");
export const SCENE = JSON.stringify({ type: "excalidraw", version: 2, elements: [], files: {} });
