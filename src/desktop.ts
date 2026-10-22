/**
 * Ponte com a casca nativa (Tauri). Tudo aqui só é chamado quando
 * `isDesktop` é verdadeiro; no navegador o app usa as APIs web.
 */
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";

export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const MARKS_FILTER = [{ name: "Marcações LiminalPDF", extensions: ["json"] }];

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

/** `desenho.pdf` → `desenho.liminal.json`, na mesma pasta. */
export function sidecarFor(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, "") + ".liminal.json";
}

export async function pickPdf(): Promise<string | null> {
  const r = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return typeof r === "string" ? r : null;
}

export async function pickMarks(near: string | null): Promise<string | null> {
  const r = await open({
    multiple: false,
    directory: false,
    defaultPath: near ? dirname(near) : undefined,
    filters: MARKS_FILTER,
  });
  return typeof r === "string" ? r : null;
}

export async function pickSaveMarks(suggested: string): Promise<string | null> {
  const r = await save({ defaultPath: suggested, filters: MARKS_FILTER });
  return r ?? null;
}

export function readPdf(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_pdf", { path });
}

export function readMarks(path: string): Promise<string | null> {
  return invoke<string | null>("read_marks", { path });
}

export function writeMarks(path: string, contents: string): Promise<void> {
  return invoke<void>("write_marks", { path, contents });
}

export function startupFile(): Promise<string | null> {
  return invoke<string | null>("startup_file");
}

export function confirmDiscard(): Promise<boolean> {
  return ask("Há marcações não salvas. Descartar as alterações?", {
    title: "LiminalPDF",
    kind: "warning",
    okLabel: "Descartar",
    cancelLabel: "Cancelar",
  });
}

export function confirmAsk(message: string, okLabel = "OK"): Promise<boolean> {
  return ask(message, { title: "LiminalPDF", kind: "warning", okLabel, cancelLabel: "Cancelar" });
}

export function setTitle(title: string): void {
  void getCurrentWindow().setTitle(title);
}

/** Pergunta antes de fechar a janela se houver alterações. */
export function guardClose(isDirty: () => boolean): void {
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!isDirty()) return;
    if (!(await confirmDiscard())) event.preventDefault();
  });
}

/** Arquivos soltos sobre a janela chegam como caminhos completos. */
export function onDropPaths(cb: (paths: string[]) => void): void {
  void getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === "drop") cb(e.payload.paths);
  });
}

/* ------------------------------------------------------------ montagem */

export const MERGE_LABEL = "merge";
const EV_OPEN = "liminal:open-pdf";
const EV_ADD = "liminal:add-source";

export async function pickPdfs(): Promise<string[]> {
  const r = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function pickSavePdf(suggested: string): Promise<string | null> {
  const r = await save({ defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!r) return null;
  return /\.pdf$/i.test(r) ? r : `${r}.pdf`;
}

/** Bytes crus no corpo da chamada; o caminho vai codificado num cabeçalho. */
export function writePdf(path: string, bytes: Uint8Array): Promise<void> {
  return invoke<void>("write_pdf", bytes, { headers: { path: encodeURIComponent(path) } });
}

/** Abre (ou traz para frente) a janela de montagem, já com `src` carregado. */
export async function openMergeWindow(src: string | null): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(MERGE_LABEL);
  if (existing) {
    await existing.unminimize();
    await existing.setFocus();
    if (src) await emitTo(MERGE_LABEL, EV_ADD, src);
    return;
  }
  const url = "merge.html" + (src ? `?src=${encodeURIComponent(src)}` : "");
  const w = new WebviewWindow(MERGE_LABEL, {
    url,
    title: "Montar PDF — LiminalPDF",
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 520,
  });
  await new Promise<void>((resolve, reject) => {
    void w.once("tauri://created", () => resolve());
    void w.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
}

/** Janela de montagem → editor: "abra este arquivo". */
export function requestOpenInEditor(path: string): Promise<void> {
  return emitTo("main", EV_OPEN, path);
}

export function onOpenRequest(cb: (path: string) => void): void {
  void listen<string>(EV_OPEN, (e) => cb(e.payload));
}

export function onAddSource(cb: (path: string) => void): void {
  void listen<string>(EV_ADD, (e) => cb(e.payload));
}
