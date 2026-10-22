export type Theme = "sepia" | "light" | "dark";

const KEY = "liminalpdf.theme";
const THEMES: Theme[] = ["sepia", "light", "dark"];

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (THEMES as string[]).includes(v)) return v as Theme;
  } catch {
    /* sem armazenamento */
  }
  return "sepia";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) {
    const on = b.dataset.themeChoice === theme;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignora */
  }
}

/** Aplica o tema salvo (sépia por padrão) e liga os botões da barra. */
export function initTheme(): void {
  applyTheme(stored());
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) {
    b.addEventListener("click", () => applyTheme(b.dataset.themeChoice as Theme));
  }
  // outra janela do app trocou o tema: acompanha
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue && (THEMES as string[]).includes(e.newValue)) {
      applyTheme(e.newValue as Theme);
    }
  });
}
