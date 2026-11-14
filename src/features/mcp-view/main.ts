import { App, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import { mountDiagramView } from "./diagramView";

/**
 * The chat view's entry point (#202): the SDK's `App` speaks the MCP Apps
 * protocol to the host over postMessage; `mountDiagramView` is the view.
 * Handlers go on before `connect`, so the first tool result is not missed.
 */
const app = new App({ name: "Dosik diagram", version: "1.0.0" });
const view = mountDiagramView(document.getElementById("root") as HTMLElement, {
  callServerTool: (params) => app.callServerTool(params),
  getHostContext: () => app.getHostContext(),
});
/** the host's own colours, radii and shadows, for the controls (MCP Apps standard style variables) */
const adoptHostStyles = () => {
  const variables = app.getHostContext()?.styles?.variables;
  if (variables) applyHostStyleVariables(variables);
};
app.ontoolresult = (result) => view.showResult(result);
app.onhostcontextchanged = () => {
  adoptHostStyles();
  view.hostContextChanged();
};
// the host's theme and styles arrive with the handshake
void app.connect().then(() => {
  adoptHostStyles();
  view.hostContextChanged();
});
