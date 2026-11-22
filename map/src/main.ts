import type { PluginFrontendContext } from "learnharness-plugin-api";
import { mountMapView } from "./view.ts";

const MAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 6.4l7.4.4M7.3 8.2l3.6 7.6M16.9 9.2l-3.6 6.6"/></svg>`;

/** The Map plugin's window half: the map view and its sidebar entry. */
export function activate(ctx: PluginFrontendContext): () => void {
	const off: (() => void)[] = [];
	off.push(ctx.registerView({ id: "map", name: "Map", mount: (container, signal) => mountMapView(ctx, container, signal) }));
	off.push(ctx.registerAction({ id: "open", name: "Map", icon: MAP_ICON, run: () => ctx.app.openView("map") }));
	off.push(ctx.placeAction({ id: "open-sidebar", actionId: "open", location: "sidebar" }));
	return () => { for (const dispose of off.splice(0)) dispose(); };
}
