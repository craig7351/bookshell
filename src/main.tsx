/* @refresh reload */
import { render } from "solid-js/web";
import "@xterm/xterm/css/xterm.css";
import App from "./App";
import { RAW, applyTokens } from "./theme";

// Design tokens land on :root before the first render so nothing paints with a
// missing var(). tokens.css already carries the same literals as a fallback;
// this call is the swap point for future palettes.
applyTokens(RAW);

render(() => <App />, document.getElementById("root")!);
