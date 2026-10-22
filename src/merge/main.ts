import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import * as desktop from "../desktop";
import { initTheme } from "../theme";
import { assemble, countPages } from "./assemble";
import { formatPages, parsePages } from "./pages";
import { Thumbs } from "./thumbs";

/* ------------------------------------------------------------ tipos */

interface Source {
  id: string;
  name: string;
  /** Caminho no disco (app desktop); null no navegador. */
  path: string | null;
  bytes: Uint8Array;
  count: number;
}

interface PieceState {
  id: string;
  source: string;
  spec: string;
}

/** Mensagens entre janelas no modo navegador (no desktop são eventos do Tauri). */
type WebMsg =
  | { type: "liminal:ready" }
  | { type: "liminal:add-bytes"; name: string; bytes: ArrayBuffer }
  | { type: "liminal:open-bytes"; name: string; bytes: ArrayBuffer };

const STRIP_MAX = 14;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} ausente`);
  return el as T;
};

const ui = {
  add: $<HTMLButtonElement>("m-add"),
  build: $<HTMLButtonElement>("m-build"),
  status: $("m-status"),
  openAfter: $<HTMLInputElement>("m-open-after"),
  sourceList: $("m-source-list"),
  drop: $("m-drop"),
  pieces: $("m-pieces"),
  empty: $("m-empty"),
  total: $("m-total"),
  file: $<HTMLInputElement>("m-file"),
  picker: $<HTMLDialogElement>("m-picker"),
  pTitle: $("p-title"),
  pSub: $("p-sub"),
  pGrid: $("p-grid"),
  pSpec: $("p-spec"),
  pAll: $<HTMLButtonElement>("p-all"),
  pNone: $<HTMLButtonElement>("p-none"),
};

const sources = new Map<string, Source>();
let pieces: PieceState[] = [];
const thumbs = new Thumbs();
let busy = false;

const uid = () => crypto.randomUUID().slice(0, 8);
const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

function setStatus(text: string, kind: "" | "error" | "ok" = ""): void {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
}

/* ------------------------------------------------------------ arquivos */

async function addSource(name: string, bytes: Uint8Array, path: string | null): Promise<void> {
  try {
    const count = await countPages(bytes);
    const id = uid();
    sources.set(id, { id, name, path, bytes, count });
    thumbs.register(id, bytes);
    pieces.push({ id: uid(), source: id, spec: "" });
    renderSources();
    renderPieces();
    setStatus(`${name}: ${count} página${count === 1 ? "" : "s"}`);
  } catch (err) {
    setStatus(`Não foi possível ler ${name}: ${errText(err)}`, "error");
  }
}

async function addPaths(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (!/\.pdf$/i.test(p)) continue;
    try {
      const bytes = new Uint8Array(await desktop.readPdf(p));
      await addSource(basename(p), bytes, p);
    } catch (err) {
      setStatus(`Não foi possível abrir ${basename(p)}: ${errText(err)}`, "error");
    }
  }
}

async function addFiles(files: Iterable<File>): Promise<void> {
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") continue;
    await addSource(f.name, new Uint8Array(await f.arrayBuffer()), null);
  }
}

async function pickFiles(): Promise<void> {
  if (desktop.isDesktop) await addPaths(await desktop.pickPdfs());
  else ui.file.click();
}

async function removeSource(id: string): Promise<void> {
  const used = pieces.filter((p) => p.source === id).length;
  const s = sources.get(id);
  if (!s) return;
  if (used) {
    const msg = `Remover ${s.name} e ${used} trecho${used === 1 ? "" : "s"} que usa${used === 1 ? "" : "m"} esse arquivo?`;
    const ok = desktop.isDesktop ? await desktop.confirmAsk(msg, "Remover") : window.confirm(msg);
    if (!ok) return;
  }
  pieces = pieces.filter((p) => p.source !== id);
  sources.delete(id);
  thumbs.forget(id);
  renderSources();
  renderPieces();
}

function renderSources(): void {
  ui.drop.classList.toggle("compact", sources.size > 0);
  ui.sourceList.replaceChildren(
    ...[...sources.values()].map((s) => {
      const li = document.createElement("li");
      const used = pieces.filter((p) => p.source === s.id).length;
      const thumb = thumbs.img(s.id, 1);
      const info = document.createElement("div");
      info.className = "s-info";
      const name = document.createElement("div");
      name.className = "s-name";
      name.textContent = s.name;
      name.title = s.path ?? s.name;
      const meta = document.createElement("div");
      meta.className = "quiet";
      meta.textContent = `${s.count} pág. · ${used} trecho${used === 1 ? "" : "s"}`;
      info.append(name, meta);
      const actions = document.createElement("div");
      actions.className = "s-actions";
      actions.append(
        button("+ Trecho", "Adicionar um trecho deste arquivo ao fim da sequência", () => {
          pieces.push({ id: uid(), source: s.id, spec: "" });
          renderSources();
          renderPieces();
          ui.pieces.lastElementChild?.querySelector<HTMLInputElement>("input.spec")?.focus();
        }),
        button("✕", "Remover arquivo", () => void removeSource(s.id), "icon"),
      );
      li.append(thumb, info, actions);
      return li;
    }),
  );
}

/* ------------------------------------------------------------ trechos */

function button(label: string, title: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function evaluate(p: PieceState) {
  const s = sources.get(p.source);
  return s ? parsePages(p.spec, s.count) : { pages: [], errors: ["arquivo removido"] };
}

function renderPieces(): void {
  ui.empty.hidden = pieces.length > 0;
  ui.pieces.replaceChildren(...pieces.map((p, i) => pieceCard(p, i)));
  renderTotals();
}

function pieceCard(p: PieceState, index: number): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "piece";
  li.dataset.id = p.id;

  const grip = document.createElement("div");
  grip.className = "grip";
  grip.title = "Arraste para reordenar";
  grip.textContent = "⋮⋮";
  grip.addEventListener("pointerdown", (e) => startDrag(e, li));

  const num = document.createElement("div");
  num.className = "p-num";
  num.textContent = String(index + 1);

  const top = document.createElement("div");
  top.className = "p-top";

  const sel = document.createElement("select");
  sel.title = "Arquivo de origem";
  for (const s of sources.values()) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.name} (${s.count} pág.)`;
    sel.append(o);
  }
  sel.value = p.source;
  sel.addEventListener("change", () => {
    p.source = sel.value;
    renderSources();
    renderPieces();
  });

  const spec = document.createElement("input");
  spec.className = "spec";
  spec.type = "text";
  spec.value = p.spec;
  spec.placeholder = "todas";
  spec.spellcheck = false;
  spec.title = "Páginas: 1-5, 7, 9 · 45-66 · 10-fim · 5-1";
  spec.setAttribute("aria-label", "Páginas");

  const count = document.createElement("span");
  count.className = "p-count";
  const err = document.createElement("div");
  err.className = "p-error";
  const strip = document.createElement("div");
  strip.className = "strip";

  const refresh = () => {
    const r = evaluate(p);
    count.textContent = `${r.pages.length} pág.`;
    spec.classList.toggle("bad", r.errors.length > 0);
    err.textContent = r.errors.join(" · ");
    err.hidden = r.errors.length === 0;
    strip.replaceChildren(
      ...r.pages.slice(0, STRIP_MAX).map((n) => {
        const fig = document.createElement("figure");
        fig.append(thumbs.img(p.source, n));
        const cap = document.createElement("figcaption");
        cap.textContent = String(n);
        fig.append(cap);
        return fig;
      }),
    );
    if (r.pages.length > STRIP_MAX) {
      const more = document.createElement("div");
      more.className = "more";
      more.textContent = `+${r.pages.length - STRIP_MAX}`;
      strip.append(more);
    }
  };
  let t = 0;
  spec.addEventListener("input", () => {
    p.spec = spec.value;
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      refresh();
      renderTotals();
    }, 180);
  });
  spec.addEventListener("keydown", (e) => {
    if (e.key === "Enter") spec.blur();
  });

  const pageField = document.createElement("label");
  pageField.className = "p-pages";
  pageField.append("Páginas", spec);

  const actions = document.createElement("div");
  actions.className = "p-actions";
  actions.append(
    button("Escolher…", "Escolher páginas pelas miniaturas", () => openPicker(p)),
    button("↑", "Mover para cima", () => move(p.id, -1), "icon"),
    button("↓", "Mover para baixo", () => move(p.id, 1), "icon"),
    button("⧉", "Duplicar trecho", () => duplicate(p.id), "icon"),
    button("✕", "Remover trecho", () => removePiece(p.id), "icon"),
  );

  top.append(sel, pageField, count, actions);
  const body = document.createElement("div");
  body.className = "p-body";
  body.append(top, err, strip);
  li.append(grip, num, body);
  refresh();
  return li;
}

function move(id: string, delta: number): void {
  const i = pieces.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= pieces.length) return;
  [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  renderPieces();
  ui.pieces.querySelector<HTMLElement>(`[data-id="${id}"] .p-actions button[title^="Mover para ${delta < 0 ? "cima" : "baixo"}"]`)?.focus();
}

function duplicate(id: string): void {
  const i = pieces.findIndex((p) => p.id === id);
  if (i < 0) return;
  pieces.splice(i + 1, 0, { ...pieces[i], id: uid() });
  renderSources();
  renderPieces();
}

function removePiece(id: string): void {
  pieces = pieces.filter((p) => p.id !== id);
  renderSources();
  renderPieces();
}

function renderTotals(): void {
  let total = 0;
  let bad = 0;
  for (const p of pieces) {
    const r = evaluate(p);
    total += r.pages.length;
    if (r.errors.length) bad++;
  }
  ui.total.textContent = pieces.length
    ? `${pieces.length} trecho${pieces.length === 1 ? "" : "s"} · ${total} página${total === 1 ? "" : "s"}` +
      (bad ? ` · ${bad} com erro` : "")
    : "";
  ui.build.disabled = busy || total === 0 || bad > 0;
}

/* ------------------------------------------------------------ arrastar para reordenar */

// Ponteiro em vez de drag-and-drop HTML5: no Windows o WebView2 com
// arrastar-arquivos ativo bloqueia o DnD HTML5 dentro da página.
// Quem se move no DOM são os vizinhos, nunca o cartão arrastado.
function startDrag(e: PointerEvent, li: HTMLLIElement): void {
  if (e.button !== 0) return;
  e.preventDefault();
  li.classList.add("dragging");
  document.body.classList.add("reordering");

  const onMove = (ev: PointerEvent) => {
    for (;;) {
      const prev = li.previousElementSibling as HTMLElement | null;
      const next = li.nextElementSibling as HTMLElement | null;
      if (prev) {
        const r = prev.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          ui.pieces.insertBefore(prev, li.nextElementSibling);
          continue;
        }
      }
      if (next) {
        const r = next.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) {
          ui.pieces.insertBefore(next, li);
          continue;
        }
      }
      break;
    }
    autoScroll(ev.clientY);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    li.classList.remove("dragging");
    document.body.classList.remove("reordering");
    const order = [...ui.pieces.children].map((c) => (c as HTMLElement).dataset.id);
    pieces.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    renderPieces();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function autoScroll(y: number): void {
  const main = ui.pieces.closest("main")!;
  const r = main.getBoundingClientRect();
  if (y < r.top + 40) main.scrollTop -= 12;
  else if (y > r.bottom - 40) main.scrollTop += 12;
}

/* ------------------------------------------------------------ seletor de páginas */

let pickerPiece: PieceState | null = null;
let pickerSel = new Set<number>();
let lastClicked = 0;

function openPicker(p: PieceState): void {
  const s = sources.get(p.source);
  if (!s) return;
  pickerPiece = p;
  pickerSel = new Set(evaluate(p).pages);
  lastClicked = 0;
  ui.pTitle.textContent = s.name;
  ui.pSub.textContent = `${s.count} páginas. A seleção segue a ordem do arquivo; para outra ordem ou repetições, digite no campo.`;
  ui.pGrid.replaceChildren(
    ...Array.from({ length: s.count }, (_, i) => {
      const n = i + 1;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "p-page";
      b.dataset.page = String(n);
      b.setAttribute("aria-pressed", String(pickerSel.has(n)));
      b.append(thumbs.img(s.id, n));
      const cap = document.createElement("span");
      cap.textContent = String(n);
      b.append(cap);
      b.addEventListener("click", (e) => togglePage(n, e.shiftKey));
      return b;
    }),
  );
  updatePicker();
  ui.picker.showModal();
  // leva até a primeira página já marcada
  ui.pGrid.querySelector<HTMLElement>('.p-page[aria-pressed="true"]')?.scrollIntoView({ block: "center" });
}

function togglePage(n: number, range: boolean): void {
  const on = !pickerSel.has(n);
  if (range && lastClicked) {
    const [a, b] = lastClicked < n ? [lastClicked, n] : [n, lastClicked];
    const target = pickerSel.has(lastClicked);
    for (let i = a; i <= b; i++) {
      if (target) pickerSel.add(i);
      else pickerSel.delete(i);
    }
  } else if (on) {
    pickerSel.add(n);
  } else {
    pickerSel.delete(n);
  }
  lastClicked = n;
  updatePicker();
}

function updatePicker(): void {
  const s = pickerPiece && sources.get(pickerPiece.source);
  if (!pickerPiece || !s) return;
  for (const b of ui.pGrid.querySelectorAll<HTMLButtonElement>(".p-page")) {
    b.setAttribute("aria-pressed", String(pickerSel.has(Number(b.dataset.page))));
  }
  const sorted = [...pickerSel].sort((a, b) => a - b);
  const text = formatPages(sorted, s.count);
  ui.pSpec.textContent = sorted.length
    ? `${sorted.length} selecionada${sorted.length === 1 ? "" : "s"}: ${text || "todas"}`
    : "Nenhuma página selecionada";
}

function closePicker(): void {
  const p = pickerPiece;
  const s = p && sources.get(p.source);
  if (p && s) {
    const sorted = [...pickerSel].sort((a, b) => a - b);
    // nenhuma marcada = remove o trecho seria surpresa; mantém o texto anterior
    if (sorted.length) p.spec = formatPages(sorted, s.count);
  }
  pickerPiece = null;
  renderPieces();
}

/* ------------------------------------------------------------ gerar */

async function build(): Promise<void> {
  if (busy) return;
  const parts = pieces.map((p) => ({ source: p.source, pages: evaluate(p).pages }));
  const total = parts.reduce((n, p) => n + p.pages.length, 0);
  if (!total) return;
  const first = sources.get(pieces[0].source);
  const suggested = suggestName(first);

  let path: string | null = null;
  if (desktop.isDesktop) {
    path = await desktop.pickSavePdf(suggested);
    if (!path) return;
  }

  busy = true;
  renderTotals();
  setStatus(`Montando ${total} páginas…`);
  try {
    const bytes = await assemble(parts, async (id) => sources.get(id)!.bytes, titleOf(path ?? suggested));
    const size = formatSize(bytes.length);
    if (desktop.isDesktop && path) {
      await desktop.writePdf(path, bytes);
      setStatus(`Salvo: ${basename(path)} · ${total} páginas · ${size}`, "ok");
      if (ui.openAfter.checked) await desktop.requestOpenInEditor(path);
    } else {
      download(bytes, basename(suggested));
      setStatus(`Gerado: ${basename(suggested)} · ${total} páginas · ${size}`, "ok");
      if (ui.openAfter.checked) sendToOpener(bytes, basename(suggested));
    }
  } catch (err) {
    setStatus(`Falha ao montar: ${errText(err)}`, "error");
  } finally {
    busy = false;
    renderTotals();
  }
}

function suggestName(first: Source | undefined): string {
  const name = "montagem.pdf";
  if (!first?.path) return name;
  const i = Math.max(first.path.lastIndexOf("/"), first.path.lastIndexOf("\\"));
  return i > 0 ? first.path.slice(0, i + 1) + name : name;
}

function titleOf(path: string): string {
  return basename(path).replace(/\.pdf$/i, "");
}

function download(bytes: Uint8Array, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function formatSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : String(err);
}

/* ------------------------------------------------------------ ponte com o editor (navegador) */

function sendToOpener(bytes: Uint8Array, name: string): void {
  const opener = window.opener as Window | null;
  if (!opener || opener.closed) return;
  const buf = bytes.slice().buffer;
  const msg: WebMsg = { type: "liminal:open-bytes", name, bytes: buf };
  opener.postMessage(msg, location.origin, [buf]);
}

/* ------------------------------------------------------------ início */

function bind(): void {
  ui.add.addEventListener("click", () => void pickFiles());
  ui.build.addEventListener("click", () => void build());
  ui.file.addEventListener("change", () => {
    const files = [...(ui.file.files ?? [])];
    ui.file.value = "";
    void addFiles(files);
  });
  ui.picker.addEventListener("close", closePicker);
  ui.pAll.addEventListener("click", () => {
    const s = pickerPiece && sources.get(pickerPiece.source);
    if (!s) return;
    pickerSel = new Set(Array.from({ length: s.count }, (_, i) => i + 1));
    updatePicker();
  });
  ui.pNone.addEventListener("click", () => {
    pickerSel.clear();
    updatePicker();
  });

  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === "o") {
      e.preventDefault();
      void pickFiles();
    } else if (ctrl && k === "s") {
      e.preventDefault();
      if (!ui.build.disabled) void build();
    } else if (desktop.isDesktop && (e.key === "F5" || (ctrl && (k === "r" || k === "p")))) {
      e.preventDefault();
    }
  });

  // arrastar arquivos: no desktop chegam como caminhos; no navegador, como File
  if (desktop.isDesktop) {
    desktop.onDropPaths((paths) => void addPaths(paths));
    desktop.onAddSource((path) => void addPaths([path]));
    window.addEventListener("contextmenu", (e) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
  } else {
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      ui.drop.classList.add("over");
    });
    window.addEventListener("dragleave", () => ui.drop.classList.remove("over"));
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      ui.drop.classList.remove("over");
      if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
    });
    window.addEventListener("message", (e: MessageEvent<WebMsg>) => {
      if (e.origin !== location.origin) return;
      if (e.data?.type === "liminal:add-bytes") {
        void addSource(e.data.name, new Uint8Array(e.data.bytes), null);
      }
    });
  }
}

async function start(): Promise<void> {
  initTheme();
  bind();
  renderSources();
  renderPieces();
  if (desktop.isDesktop) {
    const src = new URLSearchParams(location.search).get("src");
    if (src) await addPaths([src]);
  } else {
    const opener = window.opener as Window | null;
    const msg: WebMsg = { type: "liminal:ready" };
    opener?.postMessage(msg, location.origin);
  }
}

void start();
