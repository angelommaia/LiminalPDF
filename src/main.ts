import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import { initTheme } from "./theme";
import { App } from "./app";
import { isDesktop } from "./desktop";

initTheme();
const app = new App();

if (isDesktop) {
  void app.startDesktop();
} else {
  window.addEventListener("beforeunload", (e) => {
    if (!app.isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
