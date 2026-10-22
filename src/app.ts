import {
  DEFAULT_HIGHLIGHT,
  DEFAULT_STROKE,
  DEFAULT_TEXT,
  emptyLine,
  emptyPolyline,
  emptyRect,
  emptyHighlight,
  emptyText,
  handlesOf,
  hitTest,
  normalizeRect,
  parseSidecar,
  hasRelation,
  ofType,
  segmentAt,
  setHandle,
  snapAngle,
  toSidecar,
  translate,
  type Mark,
  type Pt,
  type StrokeStyle,
  type TextMark,
  type TextStyle,
  type Tool,
} from "./model";
import {
  HANDLE_PX,
  applyTextCss,
  boxToView,
  draftLine,
  draftPoly,
  draftRect,
  drawMarks,
  type Draft,
} from "./overlay";
import * as desktop from "./desktop";
import { caretNear, measure, textAt, type Box, type Caret } from "./textsel";
import { PdfView, type PageSlot } from "./pdf-view";

const ZOOM_STEP = 1.15;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const DRAG_THRESHOLD_PX = 3;
const NEW_TEXT_W = 140;
const NEW_TEXT_H = 26;
const SWATCHES = [
  "#b42318", "#1d4e89", "#1f7a3a", "#c4620a",
  "#7a2a8c", "#0e7c86", "#1c1916", "#e5b400",
];
const HL_SWATCHES = ["#ffd400", "#7ee081", "#ff8fc7", "#7cc8ff", "#ffa94d", "#c39bff", "#ff6b6b", "#b8b8b8"];
const STORE_KEY = "liminalpdf.styles";
const SHEET_KEY = "liminalpdf.sheetHeight";
/** Altura padrão da lista: abas + cabeçalho + 5 linhas. */
const SHEET_DEFAULT = 176;
/** Cruz com contorno, visível em fundo branco e escuro (definida no CSS). */
const CROSS = "var(--cursor-cross)";

type ShapeDrag = { page: number; a: Pt; x: number; y: number };
type EditDrag = {
  id: string;
  page: number;
  index: number;
  start: Pt;
  x: number;
  y: number;
  before: Mark[];
  orig: Mark;
  moved: boolean;
};
type Drag =
  | { kind: "pan"; x: number; y: number; sl: number; st: number }
  | (ShapeDrag & { kind: "line" })
  | (ShapeDrag & { kind: "rect" })
  | (ShapeDrag & { kind: "text" })
  | { kind: "poly"; page: number; points: Pt[] }
  | (EditDrag & { kind: "vertex" })
  | (EditDrag & { kind: "move" })
  | {
      kind: "hl";
      page: number;
      /** "text" segue as linhas de texto; "area" é um retângulo livre. */
      mode: "text" | "area";
      a: Pt;
      x: number;
      y: number;
      start: Caret | null;
      boxes: Box[];
      text: string;
    };

interface Editor {
  id: string;
  isNew: boolean;
  area: HTMLTextAreaElement;
}

type FileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }>;
};
type PickerWindow = Window & {
  showSaveFilePicker?: (o: object) => Promise<FileHandle>;
  showOpenFilePicker?: (o: object) => Promise<FileHandle[]>;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} ausente`);
  return el as T;
};

export class App {
  private view: PdfView;
  private marks: Mark[] = [];
  private history: Mark[][] = [];
  private future: Mark[][] = [];
  private tool: Tool = "select";
  private selected: string | null = null;
  private drag: Drag | null = null;
  private pdfName = "";
  private _dirty = false;
  /** Caminhos no disco (só no app desktop). */
  private pdfPath: string | null = null;
  /** Cópia dos bytes do PDF aberto (o pdf.js consome o buffer original). */
  private pdfBytes: Uint8Array | null = null;
  private mergeWin: Window | null = null;
  private marksPath: string | null = null;
  /** Posição do cursor em coordenadas PDF (já com Shift aplicado). */
  private cursor: { page: number; pdf: Pt } | null = null;
  private lastPointer: { clientX: number; clientY: number; shiftKey: boolean } | null =
    null;
  private zoomTimer = 0;
  private pendingScale: number | null = null;
  private pendingAnchor: { clientX: number; clientY: number } | null = null;
  private space = false;
  /** Detecção própria de duplo-clique (preventDefault no pointerdown suprime o dblclick). */
  private lastDown: { t: number; x: number; y: number } | null = null;
  private editSession = false;
  private editor: Editor | null = null;
  private saveHandle: FileHandle | null = null;
  private stroke: StrokeStyle = { ...DEFAULT_STROKE };
  /** Aba ativa da lista inferior. */
  private sheetTab: Mark["type"] = "polyline";
  private textStyle: TextStyle = { ...DEFAULT_TEXT };
  private hlStyle: StrokeStyle = { ...DEFAULT_HIGHLIGHT };
  private swatchSet: "stroke" | "hl" | null = null;

  private ui = {
    stage: $("stage"),
    pages: $("pages"),
    empty: $("empty"),
    side: $("side"),
    sheet: $("sheet"),
    sheetBody: $("sheet-body"),
    sheetHead: $("sheet-head"),
    sheetEmpty: $("sheet-empty"),
    hint: $("hint"),
    zoomLabel: $("zoom-label"),
    selKind: $("sel-kind"),
    grpRel: $("grp-rel"),
    grpNote: $("grp-note"),
    grpText: $("grp-text"),
    styleTitle: $("style-title"),
    lblColor: $("lbl-color"),
    lblWidth: $("lbl-width"),
    lblOpacity: $("lbl-opacity"),
    swatches: $("swatches"),
    fields: {
      from: $<HTMLInputElement>("f-from"),
      to: $<HTMLInputElement>("f-to"),
      fn: $<HTMLInputElement>("f-fn"),
      circuit: $<HTMLInputElement>("f-circuit"),
      status: $<HTMLInputElement>("f-status"),
      note: $<HTMLTextAreaElement>("f-note"),
    },
    style: {
      color: $<HTMLInputElement>("s-color"),
      width: $<HTMLInputElement>("s-width"),
      opacity: $<HTMLInputElement>("s-opacity"),
      opacityVal: $<HTMLOutputElement>("s-opacity-val"),
      textColor: $<HTMLInputElement>("t-color"),
      fontSize: $<HTMLInputElement>("t-size"),
      fill: $<HTMLInputElement>("t-fill"),
      fillOpacity: $<HTMLInputElement>("t-fill-opacity"),
      fillOpacityVal: $<HTMLOutputElement>("t-fill-opacity-val"),
    },
    buttons: {
      open: $<HTMLButtonElement>("btn-open"),
      load: $<HTMLButtonElement>("btn-load-marks"),
      save: $<HTMLButtonElement>("btn-save"),
      merge: $<HTMLButtonElement>("btn-merge"),
      zoomIn: $<HTMLButtonElement>("btn-zoom-in"),
      zoomOut: $<HTMLButtonElement>("btn-zoom-out"),
      fit: $<HTMLButtonElement>("btn-fit"),
      del: $<HTMLButtonElement>("btn-delete"),
    },
    filePdf: $<HTMLInputElement>("file-pdf"),
    fileJson: $<HTMLInputElement>("file-json"),
  };

  constructor() {
    this.view = new PdfView(this.ui.pages);
    this.loadStyles();
    this.bind();
    this.syncInspector();
    this.setHint("Abra um PDF para começar.");
  }

  /* ------------------------------------------------------------ eventos */

  private bind(): void {
    const b = this.ui.buttons;
    b.open.addEventListener("click", () => void this.openDialog());
    b.load.addEventListener("click", () => void this.loadMarks());
    b.save.addEventListener("click", () => void this.save(false));
    b.merge.addEventListener("click", () => void this.openMerge());
    window.addEventListener("message", (e) => this.onWebMessage(e));
    b.zoomIn.addEventListener("click", () => void this.zoomBy(ZOOM_STEP));
    b.zoomOut.addEventListener("click", () => void this.zoomBy(1 / ZOOM_STEP));
    b.fit.addEventListener("click", () => void this.fit());
    b.del.addEventListener("click", () => this.removeSelected());

    this.ui.filePdf.addEventListener("change", () => {
      const f = this.ui.filePdf.files?.[0];
      this.ui.filePdf.value = "";
      if (f) void this.openPdf(f);
    });
    this.ui.fileJson.addEventListener("change", () => {
      const f = this.ui.fileJson.files?.[0];
      this.ui.fileJson.value = "";
      if (f) void this.openSidecar(f, null);
    });

    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      btn.addEventListener("click", () => this.setTool(btn.dataset.tool as Tool));
    }

    const stage = this.ui.stage;
    stage.addEventListener("pointerdown", (e) => this.onDown(e));
    stage.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    stage.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });

    stage.addEventListener("dragover", (e) => e.preventDefault());
    stage.addEventListener("drop", (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      const name = f.name.toLowerCase();
      if (f.type === "application/pdf" || name.endsWith(".pdf")) void this.openPdf(f);
      else if (name.endsWith(".json") && this.view.doc) void this.openSidecar(f, null);
    });

    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("keyup", (e) => {
      if (e.key === " ") this.space = false;
      if (e.key === "Shift") this.refreshCursor(false);
    });

    for (const el of Object.values(this.ui.fields)) {
      el.addEventListener("input", () => this.applyFields());
      el.addEventListener("change", () => (this.editSession = false));
    }

    const s = this.ui.style;
    for (const el of [s.color, s.width, s.opacity, s.textColor, s.fontSize, s.fill, s.fillOpacity]) {
      el.addEventListener("input", () => this.applyStyle());
      el.addEventListener("change", () => (this.editSession = false));
    }

    this.renderSwatches("stroke");

    for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sheet-tab]")) {
      tab.addEventListener("click", () => {
        this.sheetTab = tab.dataset.sheetTab as Mark["type"];
        this.renderSheet();
      });
    }

    this.bindSheetResize();

    this.ui.sheetBody.addEventListener("click", (e) => {
      const tr = (e.target as HTMLElement).closest("tr");
      const id = tr?.dataset.id;
      if (id) this.select(id, true);
    });
  }

  private setTool(tool: Tool): void {
    this.commitEditor();
    this.tool = tool;
    this.drag = null;
    this.cursor = null;
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      btn.classList.toggle("on", btn.dataset.tool === tool);
    }
    this.ui.stage.dataset.tool = tool;
    const hints: Record<Tool, string> = {
      select:
        "Clique seleciona, arraste move. Vértices: arraste; duplo-clique insere/remove. Shift trava 45°.",
      line: "Clique e arraste. Shift trava em 0°/45°/90°.",
      polyline:
        "Clique nos vértices. Shift trava 45°. Enter/duplo-clique termina, Backspace desfaz vértice, Esc cancela.",
      rect: "Clique e arraste para marcar uma área. Shift faz um quadrado.",
      text: "Clique para uma caixa padrão ou arraste para definir o tamanho.",
      highlight:
        "Arraste sobre o texto para destacá-lo. Fora do texto (ou com Alt) marca uma área livre.",
    };
    if (this.view.doc) this.setHint(hints[tool]);
    this.syncInspector();
    this.redraw();
  }

  /** Lista inferior redimensionável pela borda superior; a altura fica salva. */
  private bindSheetResize(): void {
    const sheet = this.ui.sheet;
    const handle = $("sheet-resizer");
    const clamp = (h: number) =>
      Math.round(Math.max(90, Math.min(h, window.innerHeight * 0.7)));
    const apply = (h: number) => {
      sheet.style.height = `${clamp(h)}px`;
    };
    let stored = SHEET_DEFAULT;
    try {
      stored = Number(localStorage.getItem(SHEET_KEY)) || SHEET_DEFAULT;
    } catch {
      /* sem armazenamento */
    }
    apply(stored);
    const save = () => {
      try {
        localStorage.setItem(SHEET_KEY, String(sheet.offsetHeight));
      } catch {
        /* ignora */
      }
    };
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = sheet.offsetHeight;
      document.body.classList.add("resizing-sheet");
      const move = (ev: PointerEvent) => apply(startH + (startY - ev.clientY));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("resizing-sheet");
        save();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    handle.addEventListener("dblclick", () => {
      apply(SHEET_DEFAULT);
      save();
    });
    window.addEventListener("resize", () => apply(sheet.offsetHeight));
  }

  /** Paleta rápida: cores de traço ou tons claros de marca-texto. */
  private renderSwatches(set: "stroke" | "hl"): void {
    if (this.swatchSet === set) return;
    this.swatchSet = set;
    const s = this.ui.style;
    this.ui.swatches.replaceChildren(
      ...(set === "hl" ? HL_SWATCHES : SWATCHES).map((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = c;
        btn.style.background = c;
        btn.addEventListener("click", () => {
          s.color.value = c;
          this.applyStyle();
          this.editSession = false;
        });
        return btn;
      }),
    );
  }

  private setHint(text: string): void {
    this.ui.hint.textContent = text;
  }

  private get dirty(): boolean {
    return this._dirty;
  }

  private set dirty(v: boolean) {
    if (v === this._dirty) return;
    this._dirty = v;
    this.updateTitle();
  }

  private updateTitle(): void {
    const t = this.pdfName
      ? `${this._dirty ? "● " : ""}${this.pdfName} — LiminalPDF`
      : "LiminalPDF";
    document.title = t;
    if (desktop.isDesktop) desktop.setTitle(t);
  }

  /** Chamado uma vez pelo main.ts quando roda dentro do Tauri. */
  async startDesktop(): Promise<void> {
    desktop.guardClose(() => this.dirty);
    desktop.onOpenRequest((path) => void this.openPdfPath(path));
    desktop.onDropPaths((paths) => {
      const pdf = paths.find((p) => /\.pdf$/i.test(p));
      const json = paths.find((p) => /\.json$/i.test(p));
      if (pdf) void this.openPdfPath(pdf);
      else if (json && this.view.doc) void this.loadMarksPath(json);
    });
    // atalhos do navegador que não fazem sentido numa janela de app
    window.addEventListener("contextmenu", (e) => {
      if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && (k === "r" || k === "p"))) {
        e.preventDefault();
      }
    });
    const first = await desktop.startupFile();
    if (first) await this.openPdfPath(first);
  }

  /* ------------------------------------------------------------ arquivos */

  private async okToDiscard(): Promise<boolean> {
    if (!this.dirty) return true;
    return desktop.isDesktop
      ? desktop.confirmDiscard()
      : window.confirm("Há marcações não salvas. Descartar as alterações?");
  }

  private async openDialog(): Promise<void> {
    if (!desktop.isDesktop) {
      this.ui.filePdf.click();
      return;
    }
    const path = await desktop.pickPdf();
    if (path) await this.openPdfPath(path);
  }

  /**
   * Desktop: abre o PDF pelo caminho e, se existir `nome.liminal.json`
   * ao lado, carrega as marcações. O Ctrl+S grava nesse mesmo arquivo.
   */
  private async openPdfPath(path: string): Promise<void> {
    if (!(await this.okToDiscard())) return;
    try {
      const data = await desktop.readPdf(path);
      await this.openPdfData(data, desktop.basename(path));
      this.pdfPath = path;
      this.marksPath = desktop.sidecarFor(path);
      const text = await desktop.readMarks(this.marksPath);
      if (text != null) {
        this.applyMarksText(text, desktop.basename(this.marksPath), false);
        const n = this.marks.length;
        this.setHint(
          `${desktop.basename(path)} · ${n} marcaç${n === 1 ? "ão" : "ões"} de ${desktop.basename(this.marksPath)}`,
        );
      }
    } catch (err) {
      this.setHint(`Não foi possível abrir: ${errText(err)}`);
    }
  }

  private async openPdf(file: File): Promise<void> {
    if (!(await this.okToDiscard())) return;
    await this.openPdfData(await file.arrayBuffer(), file.name);
  }

  private async openPdfData(data: ArrayBuffer, name: string): Promise<void> {
    this.commitEditor();
    this.pdfBytes = new Uint8Array(data.slice(0));
    await this.view.load(data);
    this.pdfName = name;
    this.pdfPath = null;
    this.marksPath = null;
    this.marks = [];
    this.history = [];
    this.future = [];
    this.selected = null;
    this.dirty = false;
    this.saveHandle = null;
    this.ui.empty.hidden = true;
    this.ui.pages.hidden = false;
    this.ui.side.hidden = false;
    this.ui.sheet.hidden = false;
    this.ui.buttons.load.disabled = false;
    this.ui.buttons.save.disabled = false;
    this.ui.buttons.fit.disabled = false;
    await this.fit();
    this.ui.stage.scrollTop = 0;
    this.updateTitle();
    this.setHint(`Documento: ${name}`);
    this.ui.stage.focus();
  }

  private async loadMarks(): Promise<void> {
    if (desktop.isDesktop) {
      const path = await desktop.pickMarks(this.marksPath ?? this.pdfPath);
      if (path) await this.loadMarksPath(path);
      return;
    }
    const w = window as PickerWindow;
    if (!w.showOpenFilePicker) {
      this.ui.fileJson.click();
      return;
    }
    try {
      const [h] = await w.showOpenFilePicker({
        types: [{ description: "Marcações LiminalPDF", accept: { "application/json": [".json"] } }],
      });
      await this.openSidecar(await h.getFile(), h);
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") this.ui.fileJson.click();
    }
  }

  private async loadMarksPath(path: string): Promise<void> {
    if (!(await this.okToDiscard())) return;
    try {
      const text = await desktop.readMarks(path);
      if (text == null) throw new Error("arquivo não encontrado");
      if (this.applyMarksText(text, desktop.basename(path), true)) this.marksPath = path;
    } catch (err) {
      this.setHint(`Falha ao ler marcações: ${errText(err)}`);
    }
  }

  private async openSidecar(file: File, handle: FileHandle | null): Promise<void> {
    if (!(await this.okToDiscard())) return;
    if (this.applyMarksText(await file.text(), file.name, true)) this.saveHandle = handle;
  }

  /** Substitui as marcações pelas do JSON. `undoable` guarda o estado anterior. */
  private applyMarksText(text: string, name: string, undoable: boolean): boolean {
    try {
      const marks = parseSidecar(JSON.parse(text) as unknown);
      this.commitEditor();
      if (undoable) this.pushHistory();
      this.marks = marks;
      this.selected = null;
      this.dirty = false;
      this.redraw();
      this.setHint(`Marcações: ${name}`);
      return true;
    } catch (err) {
      this.setHint(err instanceof Error ? err.message : "Falha ao ler JSON.");
      return false;
    }
  }

  /**
   * Com a File System Access API (Edge/Chrome) o primeiro Ctrl+S pergunta
   * onde salvar e os seguintes gravam no mesmo arquivo. Sem ela, baixa.
   */
  private async save(saveAs: boolean): Promise<void> {
    this.commitEditor();
    const name = this.pdfName.replace(/\.pdf$/i, "") + ".liminal.json";
    const json = JSON.stringify(toSidecar(this.pdfName, this.marks), null, 2);
    if (desktop.isDesktop) {
      let path = this.marksPath;
      if (!path || saveAs) {
        const near = this.pdfPath ? desktop.sidecarFor(this.pdfPath) : name;
        path = await desktop.pickSaveMarks(path ?? near);
        if (!path) return;
      }
      try {
        await desktop.writeMarks(path, json);
        this.marksPath = path;
        this.dirty = false;
        this.setHint(`Salvo em ${desktop.basename(path)}`);
      } catch (err) {
        this.setHint(`Falha ao salvar: ${errText(err)}`);
      }
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const w = window as PickerWindow;
    if (w.showSaveFilePicker) {
      try {
        if (!this.saveHandle || saveAs) {
          this.saveHandle = await w.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: "Marcações LiminalPDF", accept: { "application/json": [".json"] } }],
          });
        }
        const out = await this.saveHandle.createWritable();
        await out.write(blob);
        await out.close();
        this.dirty = false;
        this.setHint(`Salvo em ${this.saveHandle.name}`);
        return;
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return;
        this.saveHandle = null;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    this.dirty = false;
    this.setHint(`Salvo como ${name}`);
  }

  /* ------------------------------------------------------------ montagem */

  /** Abre a janela "Montar PDF", já com o documento atual como primeiro arquivo. */
  private async openMerge(): Promise<void> {
    if (desktop.isDesktop) {
      try {
        await desktop.openMergeWindow(this.pdfPath);
      } catch (err) {
        this.setHint(`Não foi possível abrir a montagem: ${errText(err)}`);
      }
      return;
    }
    if (this.mergeWin && !this.mergeWin.closed) {
      this.mergeWin.focus();
      return;
    }
    this.mergeWin = window.open("merge.html", "liminal-merge", "width=1180,height=780");
    if (!this.mergeWin) this.setHint("O navegador bloqueou a janela. Permita pop-ups para este endereço.");
  }

  /** Modo navegador: conversa com a janela de montagem por postMessage. */
  private onWebMessage(e: MessageEvent): void {
    if (e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
    const msg = e.data as { type?: string; name?: string; bytes?: ArrayBuffer };
    if (msg.type === "liminal:ready" && this.pdfBytes && e.source) {
      const buf = this.pdfBytes.slice().buffer;
      (e.source as Window).postMessage(
        { type: "liminal:add-bytes", name: this.pdfName, bytes: buf },
        { targetOrigin: location.origin, transfer: [buf] },
      );
    } else if (msg.type === "liminal:open-bytes" && msg.bytes && msg.name) {
      const bytes = msg.bytes;
      const name = msg.name;
      void this.okToDiscard().then((ok) => {
        if (ok) void this.openPdfData(bytes, name);
      });
    }
  }

  /* ------------------------------------------------------------ zoom */

  private onWheel(e: WheelEvent): void {
    if (!this.view.doc) return;
    // Roda = rolar (nativo). Ctrl+roda ou pinça do touchpad = zoom.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = Math.min(1.5, Math.max(1 / 1.5, Math.pow(ZOOM_STEP, -dy / 100)));
    void this.zoomBy(factor, { clientX: e.clientX, clientY: e.clientY });
  }

  private async fit(): Promise<void> {
    const scale = this.view.fitWidthScale(this.ui.stage.clientWidth);
    await this.setScale(scale, null);
  }

  private async zoomBy(
    factor: number,
    anchor: { clientX: number; clientY: number } | null = null,
  ): Promise<void> {
    const base = this.pendingScale ?? this.view.scale;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base * factor));
    if (!anchor) {
      this.pendingScale = null;
      window.clearTimeout(this.zoomTimer);
      await this.setScale(next, null);
      return;
    }
    // várias notches seguidas viram um único render
    this.pendingScale = next;
    this.pendingAnchor = anchor;
    this.ui.zoomLabel.textContent = `${Math.round(next * 100)}%`;
    window.clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => {
      const s = this.pendingScale;
      const a = this.pendingAnchor;
      this.pendingScale = null;
      this.pendingAnchor = null;
      if (s != null) void this.setScale(s, a);
    }, 60);
  }

  /** Re-renderiza mantendo fixo o ponto do PDF sob `anchor` (ou o centro). */
  private async setScale(
    scale: number,
    anchor: { clientX: number; clientY: number } | null,
  ): Promise<void> {
    if (!this.view.doc) return;
    this.commitEditor();
    const stage = this.ui.stage;
    const sr = stage.getBoundingClientRect();
    const at = anchor ?? {
      clientX: sr.left + stage.clientWidth / 2,
      clientY: sr.top + stage.clientHeight / 2,
    };
    const hit = this.view.clientToSlot(at);
    const cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(stage.scrollWidth, 1);
    const cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(stage.scrollHeight, 1);

    await this.view.render(scale, () => {
      this.ui.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      this.redraw();
      const slot = hit ? this.view.slotAt(hit.slot.pageNum) : undefined;
      if (hit && slot) {
        const v = this.view.toView(slot, hit.pdf);
        const r = slot.svg.getBoundingClientRect();
        stage.scrollLeft += r.left + v.x - at.clientX;
        stage.scrollTop += r.top + v.y - at.clientY;
      } else {
        stage.scrollLeft = cx * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = cy * stage.scrollHeight - stage.clientHeight / 2;
      }
    });
  }

  /* ------------------------------------------------------------ ponteiro */

  private pdfTol(scale: number): number {
    return 6 / scale;
  }

  private startPan(e: PointerEvent): void {
    this.drag = {
      kind: "pan",
      x: e.clientX,
      y: e.clientY,
      sl: this.ui.stage.scrollLeft,
      st: this.ui.stage.scrollTop,
    };
  }

  /** Índice do vértice/canto da marca selecionada sob o ponteiro. */
  private handleAt(slot: PageSlot, view: Pt): number {
    const m = this.current();
    if (!m || m.page !== slot.pageNum) return -1;
    const hs = handlesOf(m);
    const r = HANDLE_PX * 0.75 + 2;
    for (let i = hs.length - 1; i >= 0; i--) {
      const v = this.view.toView(slot, hs[i]);
      if (Math.abs(v.x - view.x) <= r && Math.abs(v.y - view.y) <= r) return i;
    }
    return -1;
  }

  private markAt(slot: PageSlot, pdf: Pt): Mark | undefined {
    const tol = this.pdfTol(slot.viewport.scale);
    // a selecionada tem prioridade, depois a mais recente
    const sel = this.current();
    if (sel && sel.page === slot.pageNum && hitTest(sel, pdf, tol)) return sel;
    return [...this.marks]
      .reverse()
      .find((m) => m.page === slot.pageNum && hitTest(m, pdf, tol));
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    if (!this.view.doc) return;
    if (this.editor && e.target === this.editor.area) return;
    this.commitEditor();
    if (e.button === 0 && !this.space) {
      const now = performance.now();
      const l = this.lastDown;
      const dbl = !!l && now - l.t < 450 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6;
      this.lastDown = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
      if (dbl && this.onDouble(e)) {
        e.preventDefault();
        return;
      }
    }
    if (e.button === 1 || this.space) {
      e.preventDefault();
      this.startPan(e);
      return;
    }
    const hit = this.view.clientToSlot(e);

    // Vértices da seleção podem ser pegos com qualquer ferramenta,
    // desde que não haja uma polilinha em andamento.
    if (hit && this.drag?.kind !== "poly") {
      const hi = this.handleAt(hit.slot, hit.view);
      if (hi >= 0) {
        e.preventDefault();
        this.beginEditDrag("vertex", this.current()!, hi, hit.pdf, e);
        return;
      }
    }

    if (this.tool === "select") {
      if (!hit || (e.pointerType === "mouse" && e.altKey)) {
        this.startPan(e);
        return;
      }
      const found = this.markAt(hit.slot, hit.pdf);
      if (found) {
        e.preventDefault();
        this.select(found.id, false);
        this.beginEditDrag("move", found, -1, hit.pdf, e);
        return;
      }
      this.select(null, false);
      this.startPan(e);
      return;
    }

    if (!hit) return;
    e.preventDefault();
    const page = hit.slot.pageNum;
    if (this.tool === "polyline") {
      const d = this.drag;
      if (d?.kind === "poly" && d.page === page) {
        d.points.push(this.constrain(d.points[d.points.length - 1], hit.pdf, e.shiftKey));
      } else {
        this.drag = { kind: "poly", page, points: [hit.pdf] };
      }
      this.cursor = { page, pdf: hit.pdf };
      this.redraw();
      return;
    }
    if (this.tool === "highlight") {
      const layer = hit.slot.textLayer;
      const onText = !e.altKey && textAt(layer, e.clientX, e.clientY);
      this.drag = {
        kind: "hl",
        page,
        mode: onText ? "text" : "area",
        a: hit.pdf,
        x: e.clientX,
        y: e.clientY,
        start: onText ? caretNear(layer, e.clientX, e.clientY) : null,
        boxes: [],
        text: "",
      };
      this.cursor = { page, pdf: hit.pdf };
      return;
    }
    const kind = this.tool;
    if (kind === "line" || kind === "rect" || kind === "text") {
      const base = { page, a: hit.pdf, x: e.clientX, y: e.clientY };
      this.drag =
        kind === "line" ? { ...base, kind } : kind === "rect" ? { ...base, kind } : { ...base, kind };
      this.cursor = { page, pdf: hit.pdf };
    }
  }

  private beginEditDrag(
    kind: "vertex" | "move",
    mark: Mark,
    index: number,
    start: Pt,
    e: PointerEvent,
  ): void {
    const base: EditDrag = {
      id: mark.id,
      page: mark.page,
      index,
      start,
      x: e.clientX,
      y: e.clientY,
      before: structuredClone(this.marks),
      orig: structuredClone(mark),
      moved: false,
    };
    this.drag = kind === "vertex" ? { ...base, kind } : { ...base, kind };
  }

  private constrain(anchor: Pt, p: Pt, shift: boolean): Pt {
    return shift ? snapAngle(anchor, p) : p;
  }

  private onMove(e: PointerEvent): void {
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    const d = this.drag;
    if (!d) {
      this.hoverCursor(e);
      return;
    }
    if (d.kind === "pan") {
      this.ui.stage.scrollLeft = d.sl - (e.clientX - d.x);
      this.ui.stage.scrollTop = d.st - (e.clientY - d.y);
      return;
    }
    const hit = this.view.clientToSlot(e);
    const onPage = hit && hit.slot.pageNum === d.page ? hit : null;

    if (d.kind === "vertex" || d.kind === "move") {
      if (!onPage) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX) return;
      const m = this.marks.find((x) => x.id === d.id);
      if (!m) return;
      if (!d.moved) {
        d.moved = true;
        this.history.push(d.before);
        this.future = [];
      }
      if (d.kind === "move") {
        const to = this.constrain(d.start, onPage.pdf, e.shiftKey);
        const fresh = structuredClone(d.orig);
        translate(fresh, to.x - d.start.x, to.y - d.start.y);
        Object.assign(m, fresh);
      } else {
        setHandle(m, d.index, this.vertexTarget(d.orig, d.index, onPage.pdf, e.shiftKey));
      }
      this.dirty = true;
      this.redraw();
      return;
    }

    if (d.kind === "poly") {
      if (!onPage) {
        this.cursor = null;
      } else {
        const last = d.points[d.points.length - 1];
        this.cursor = { page: d.page, pdf: this.constrain(last, onPage.pdf, e.shiftKey) };
      }
      this.redraw();
      return;
    }
    if (d.kind === "hl") {
      if (d.mode === "text") this.measureHighlight(d, e);
      else if (onPage) this.cursor = { page: d.page, pdf: onPage.pdf };
      this.redraw();
      return;
    }
    if (!onPage) return;
    this.cursor = { page: d.page, pdf: this.dragTarget(d.kind, d.a, onPage.pdf, e.shiftKey) };
    this.redraw();
  }

  /** Recalcula as linhas destacadas entre o início e o ponteiro. */
  private measureHighlight(
    d: Extract<Drag, { kind: "hl" }>,
    e: { clientX: number; clientY: number },
  ): void {
    const slot = this.view.slotAt(d.page);
    if (!slot || !d.start) return;
    const end = caretNear(slot.textLayer, e.clientX, e.clientY);
    if (!end) return;
    const origin = slot.svg.getBoundingClientRect();
    const m = measure(slot.textLayer, d.start, end, origin);
    d.boxes = m.boxes;
    d.text = m.text;
  }

  private viewBoxToPdf(slot: PageSlot, b: Box): { x: number; y: number; w: number; h: number } {
    const p1 = this.view.toPdf(slot, b.x, b.y);
    const p2 = this.view.toPdf(slot, b.x + b.w, b.y + b.h);
    return normalizeRect(p1.x, p1.y, p2.x, p2.y);
  }

  private finishHighlight(d: Extract<Drag, { kind: "hl" }>, e: PointerEvent): void {
    const slot = this.view.slotAt(d.page);
    this.cursor = null;
    if (!slot) return;
    let mark: Mark | null = null;
    if (d.mode === "text") {
      this.measureHighlight(d, e);
      if (d.boxes.length && d.text) {
        const rects = d.boxes.map((b) => this.viewBoxToPdf(slot, b));
        mark = emptyHighlight(d.page, "text", rects, d.text, this.hlStyle);
      }
    } else {
      const hit = this.view.clientToSlot(e);
      const b = hit && hit.slot.pageNum === d.page ? hit.pdf : null;
      if (b) {
        const r = normalizeRect(d.a.x, d.a.y, b.x, b.y);
        if (r.w * slot.viewport.scale >= 4 && r.h * slot.viewport.scale >= 4) {
          mark = emptyHighlight(d.page, "area", [r], "", this.hlStyle);
        }
      }
    }
    if (!mark) {
      this.redraw();
      return;
    }
    this.pushHistory();
    this.marks.push(mark);
    this.dirty = true;
    this.select(mark.id, false);
  }

  /** Destino de um vértice arrastado; com Shift trava em relação ao vizinho. */
  private vertexTarget(orig: Mark, i: number, p: Pt, shift: boolean): Pt {
    if (!shift) return p;
    if (orig.type === "line") return snapAngle(i === 0 ? orig.b : orig.a, p);
    if (orig.type === "polyline") {
      const n = orig.points[i - 1] ?? orig.points[i + 1];
      return n ? snapAngle(n, p) : p;
    }
    // caixas: Shift mantém quadrado em relação ao canto oposto
    const c = handlesOf(orig)[(i + 2) % 4];
    return square(c, p);
  }

  private dragTarget(kind: "line" | "rect" | "text", a: Pt, p: Pt, shift: boolean): Pt {
    if (!shift) return p;
    return kind === "line" ? snapAngle(a, p) : square(a, p);
  }

  /** Atualiza o rascunho quando Shift muda sem mover o mouse. */
  private refreshCursor(shift: boolean): void {
    const lp = this.lastPointer;
    const d = this.drag;
    if (!lp || !d || (d.kind !== "poly" && d.kind !== "line" && d.kind !== "rect")) return;
    this.onMove(new PointerEvent("pointermove", { ...lp, shiftKey: shift }));
  }

  private hoverCursor(e: PointerEvent): void {
    const stage = this.ui.stage;
    const hit = this.view.doc ? this.view.clientToSlot(e) : null;
    let c = "";
    if (hit && !this.space) {
      if (this.handleAt(hit.slot, hit.view) >= 0) c = CROSS;
      else if (this.tool === "select" && this.markAt(hit.slot, hit.pdf)) c = "move";
      else if (this.tool === "highlight")
        c = !e.altKey && textAt(hit.slot.textLayer, e.clientX, e.clientY) ? "text" : CROSS;
    }
    stage.style.cursor = c;
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === "pan" || d.kind === "vertex" || d.kind === "move") {
      this.drag = null;
      if (d.kind !== "pan" && d.moved) this.cleanupAfterEdit(d.id);
      this.redraw();
      return;
    }
    if (d.kind === "poly") return;
    if (d.kind === "hl") {
      this.drag = null;
      this.finishHighlight(d, e);
      return;
    }

    this.drag = null;
    const hit = this.view.clientToSlot(e);
    const onPage = hit && hit.slot.pageNum === d.page ? hit : null;
    const end = onPage ? this.dragTarget(d.kind, d.a, onPage.pdf, e.shiftKey) : null;
    const clicked = Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX;
    this.cursor = null;

    if (d.kind === "text") {
      // clique simples cria caixa padrão com o canto superior esquerdo no clique
      const r = clicked || !end
        ? { x: d.a.x, y: d.a.y - NEW_TEXT_H, w: NEW_TEXT_W, h: NEW_TEXT_H }
        : normalizeRect(d.a.x, d.a.y, end.x, end.y);
      if (r.w < 8 || r.h < 8) {
        this.redraw();
        return;
      }
      this.pushHistory();
      const mark = emptyText(d.page, r, this.textStyle);
      this.marks.push(mark);
      this.setTool("select");
      this.select(mark.id, false);
      this.dirty = true;
      this.openEditor(mark, true);
      return;
    }

    if (!end || clicked) {
      this.redraw();
      return;
    }
    let mark: Mark;
    if (d.kind === "line") {
      if (Math.hypot(end.x - d.a.x, end.y - d.a.y) < 2) {
        this.redraw();
        return;
      }
      mark = emptyLine(d.page, d.a, end, this.stroke);
    } else {
      const r = normalizeRect(d.a.x, d.a.y, end.x, end.y);
      if (r.w < 2 || r.h < 2) {
        this.redraw();
        return;
      }
      mark = emptyRect(d.page, r, this.stroke);
    }
    this.pushHistory();
    this.marks.push(mark);
    this.select(mark.id, false);
    this.dirty = true;
    this.redraw();
  }

  /** Remove vértices duplicados que sobraram após arrastar um sobre o outro. */
  private cleanupAfterEdit(id: string): void {
    const m = this.marks.find((x) => x.id === id);
    if (m?.type !== "polyline") return;
    m.points = dedupe(m.points);
  }

  /**
   * Segundo clique de um duplo-clique (mesmo ponto, < 450 ms).
   * Retorna true se consumiu o evento.
   */
  private onDouble(e: PointerEvent): boolean {
    if (this.drag?.kind === "poly") {
      // o primeiro clique já criou o último vértice; o segundo termina
      this.finishPoly();
      return true;
    }
    const hit = this.view.clientToSlot(e);
    const m = this.current();
    if (!hit || !m || m.page !== hit.slot.pageNum) return false;

    if (m.type === "text" && hitTest(m, hit.pdf, 0)) {
      this.drag = null;
      this.openEditor(m, false);
      return true;
    }
    if (m.type !== "polyline") return false;

    const hi = this.handleAt(hit.slot, hit.view);
    if (hi >= 0) {
      // remove vértice (mantém ao menos 2)
      this.drag = null;
      if (m.points.length <= 2) return true;
      this.pushHistory();
      m.points.splice(hi, 1);
      this.dirty = true;
      this.redraw();
      return true;
    }
    const seg = segmentAt(m.points, hit.pdf, this.pdfTol(hit.slot.viewport.scale) + m.width / 2);
    if (seg < 0) return false;
    this.drag = null;
    this.pushHistory();
    const a = m.points[seg - 1];
    const b = m.points[seg];
    m.points.splice(seg, 0, projectOnSegment(hit.pdf, a, b));
    this.dirty = true;
    this.redraw();
    return true;
  }

  private finishPoly(): void {
    const d = this.drag;
    if (d?.kind !== "poly") return;
    this.drag = null;
    this.cursor = null;
    const points = dedupe(d.points);
    if (points.length < 2) {
      this.redraw();
      return;
    }
    this.pushHistory();
    const mark = emptyPolyline(d.page, points, this.stroke);
    this.marks.push(mark);
    this.select(mark.id, false);
    this.dirty = true;
    this.redraw();
  }

  /* ------------------------------------------------------------ teclado */

  private onKey(e: KeyboardEvent): void {
    // sliders e seletores de cor não capturam atalhos
    const typing =
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLInputElement &&
        !["range", "color", "button", "checkbox"].includes(e.target.type));
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (ctrl && k === "s") {
      e.preventDefault();
      if (this.view.doc) void this.save(e.shiftKey);
      return;
    }
    if (ctrl && (k === "=" || k === "+")) {
      e.preventDefault();
      void this.zoomBy(ZOOM_STEP);
      return;
    }
    if (ctrl && k === "-") {
      e.preventDefault();
      void this.zoomBy(1 / ZOOM_STEP);
      return;
    }
    if (ctrl && k === "m") {
      e.preventDefault();
      void this.openMerge();
      return;
    }
    if (ctrl && k === "0") {
      e.preventDefault();
      void this.fit();
      return;
    }

    if (this.editor && e.target === this.editor.area) {
      if (e.key === "Escape" || (ctrl && e.key === "Enter")) {
        e.preventDefault();
        this.commitEditor();
      }
      return;
    }
    if (typing) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }

    if (e.key === "Shift") {
      this.refreshCursor(true);
      return;
    }
    if (ctrl && k === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && k === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.key === "Escape") {
      if (this.drag?.kind === "vertex" || this.drag?.kind === "move") {
        // cancela o arraste em andamento
        const d = this.drag;
        if (d.moved) this.marks = this.history.pop() ?? this.marks;
      } else if (!this.drag && this.selected) {
        this.select(null, false);
      }
      this.drag = null;
      this.cursor = null;
      this.redraw();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      this.space = true;
      return;
    }
    if (e.key === "Enter" && this.drag?.kind === "poly") {
      e.preventDefault();
      this.finishPoly();
      return;
    }
    if (e.key === "Enter" && this.current()?.type === "text") {
      e.preventDefault();
      this.openEditor(this.current() as TextMark, false);
      return;
    }
    if (e.key === "Backspace" && this.drag?.kind === "poly") {
      e.preventDefault();
      this.drag.points.pop();
      if (this.drag.points.length === 0) this.drag = null;
      this.redraw();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      this.removeSelected();
      return;
    }
    if (e.key.startsWith("Arrow") && this.current()) {
      e.preventDefault();
      this.nudge(e.key, e.shiftKey ? 10 : 1);
      return;
    }
    if (ctrl || e.altKey) return;
    const map: Record<string, Tool> = {
      v: "select",
      l: "line",
      p: "polyline",
      r: "rect",
      t: "text",
      h: "highlight",
    };
    const t = map[k];
    if (t) this.setTool(t);
  }

  /** Setas movem a seleção em pixels de tela (Shift = 10×). */
  private nudge(key: string, px: number): void {
    const m = this.current()!;
    const slot = this.view.slotAt(m.page);
    if (!slot) return;
    const dv = {
      ArrowLeft: [-px, 0],
      ArrowRight: [px, 0],
      ArrowUp: [0, -px],
      ArrowDown: [0, px],
    }[key];
    if (!dv) return;
    const o = this.view.toPdf(slot, 0, 0);
    const t = this.view.toPdf(slot, dv[0], dv[1]);
    this.beginEdit();
    translate(m, t.x - o.x, t.y - o.y);
    this.editSession = false;
    this.dirty = true;
    this.redraw();
  }

  /* ------------------------------------------------------------ texto */

  private openEditor(mark: TextMark, isNew: boolean): void {
    this.commitEditor();
    const slot = this.view.slotAt(mark.page);
    if (!slot) return;
    const area = document.createElement("textarea");
    area.className = "text-editor";
    area.value = mark.text;
    area.spellcheck = false;
    this.editor = { id: mark.id, isNew, area };
    this.layoutEditor();
    slot.wrap.append(area);
    area.addEventListener("input", () => {
      mark.text = area.value;
      this.growToFit(mark);
      this.dirty = true;
    });
    area.addEventListener("blur", () => this.commitEditor());
    this.redraw();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    this.setHint("Digitando. Esc ou clique fora conclui.");
  }

  private layoutEditor(): void {
    const ed = this.editor;
    if (!ed) return;
    const m = this.marks.find((x) => x.id === ed.id);
    const slot = m ? this.view.slotAt(m.page) : undefined;
    if (m?.type !== "text" || !slot) return;
    const scale = slot.viewport.scale;
    const r = boxToView(this.view, slot, m);
    const st = ed.area.style;
    st.left = `${r.x}px`;
    st.top = `${r.y}px`;
    st.width = `${r.w}px`;
    st.height = `${r.h}px`;
    st.borderWidth = m.width > 0 ? `${m.width * scale}px` : "0";
    applyTextCss(st, m, scale);
  }

  /** Cresce a caixa para baixo quando o texto não cabe. */
  private growToFit(mark: TextMark): void {
    const ed = this.editor;
    const slot = this.view.slotAt(mark.page);
    if (!ed || !slot) return;
    const scale = slot.viewport.scale;
    const need = ed.area.scrollHeight / scale;
    if (need > mark.h + 0.5) {
      const top = mark.y + mark.h;
      mark.h = need;
      mark.y = top - need;
      this.layoutEditor();
      this.redraw();
    }
  }

  private commitEditor(): void {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;
    ed.area.remove();
    const m = this.marks.find((x) => x.id === ed.id);
    if (m?.type === "text" && !m.text.trim()) {
      if (ed.isNew) {
        this.marks = this.marks.filter((x) => x.id !== m.id);
        this.history.pop();
        if (this.selected === m.id) this.selected = null;
      }
    }
    this.setHint("Duplo-clique ou Enter edita o texto selecionado.");
    this.redraw();
    this.ui.stage.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ inspetor */

  private current(): Mark | undefined {
    return this.selected ? this.marks.find((m) => m.id === this.selected) : undefined;
  }

  private select(id: string | null, scroll: boolean): void {
    if (id !== this.selected) this.commitEditor();
    this.selected = id;
    this.editSession = false;
    const sel = this.current();
    if (sel) this.sheetTab = sel.type;
    this.syncInspector();
    this.redraw();
    if (scroll && id) {
      const mark = this.current();
      const slot = mark ? this.view.slotAt(mark.page) : undefined;
      slot?.wrap.scrollIntoView({ block: "center", inline: "center" });
    }
  }

  private removeSelected(): void {
    if (!this.selected) return;
    this.commitEditor();
    this.pushHistory();
    this.marks = this.marks.filter((m) => m.id !== this.selected);
    this.selected = null;
    this.dirty = true;
    this.syncInspector();
    this.redraw();
  }

  /** Agrupa uma sequência de edições do inspetor num único passo de desfazer. */
  private beginEdit(): void {
    if (this.editSession) return;
    this.pushHistory();
    this.editSession = true;
  }

  private applyFields(): void {
    const m = this.current();
    if (!m) return;
    const f = this.ui.fields;
    this.beginEdit();
    if (hasRelation(m)) {
      m.from = f.from.value;
      m.to = f.to.value;
      m.fn = f.fn.value;
      m.circuit = f.circuit.value;
      m.status = f.status.value;
    }
    m.note = f.note.value;
    this.dirty = true;
    this.renderSheet();
  }

  private readStyleInputs(): TextStyle {
    const s = this.ui.style;
    const n = (v: string, f: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : f);
    return {
      color: s.color.value,
      width: Math.max(0, n(s.width.value, 1)),
      opacity: n(s.opacity.value, 100) / 100,
      textColor: s.textColor.value,
      fontSize: Math.max(4, n(s.fontSize.value, 9)),
      fill: s.fill.value,
      fillOpacity: n(s.fillOpacity.value, 85) / 100,
    };
  }

  private applyStyle(): void {
    const v = this.readStyleInputs();
    const s = this.ui.style;
    s.opacityVal.textContent = `${Math.round(v.opacity * 100)}%`;
    s.fillOpacityVal.textContent = `${Math.round(v.fillOpacity * 100)}%`;
    const m = this.current();
    if (m) {
      this.beginEdit();
      m.color = v.color;
      m.width = v.width;
      m.opacity = v.opacity;
      if (m.type === "highlight") {
        m.width = 0;
        this.hlStyle = { color: v.color, width: 0, opacity: v.opacity };
      } else if (m.type === "text") {
        Object.assign(m, {
          textColor: v.textColor,
          fontSize: v.fontSize,
          fill: v.fill,
          fillOpacity: v.fillOpacity,
        });
        this.textStyle = { ...v };
        this.layoutEditor();
      } else {
        this.stroke = { color: v.color, width: v.width, opacity: v.opacity };
      }
      this.dirty = true;
    } else if (this.tool === "text") {
      this.textStyle = { ...v };
    } else if (this.tool === "highlight") {
      this.hlStyle = { color: v.color, width: 0, opacity: v.opacity };
    } else {
      this.stroke = { color: v.color, width: v.width, opacity: v.opacity };
    }
    this.saveStyles();
    this.redraw();
  }

  private syncInspector(): void {
    const m = this.current();
    const f = this.ui.fields;
    const u = this.ui;
    u.buttons.del.disabled = !m;

    u.grpRel.hidden = !m || !hasRelation(m);
    u.grpNote.hidden = !m;

    const names = {
      polyline: "Polilinha",
      line: "Linha",
      rect: "Área",
      text: "Texto",
      highlight: m?.type === "highlight" && m.mode === "area" ? "Marca-texto (área)" : "Marca-texto",
    };
    if (m) {
      u.selKind.textContent = `${names[m.type]} · p. ${m.page}`;
      const active = document.activeElement;
      const put = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
        if (el !== active) el.value = v;
      };
      if (hasRelation(m)) {
        put(f.from, m.from);
        put(f.to, m.to);
        put(f.fn, m.fn);
        put(f.circuit, m.circuit);
        put(f.status, m.status);
      }
      put(f.note, m.note);
    } else {
      u.selKind.textContent = "Nada selecionado";
    }

    // estilo: da seleção, ou o padrão da ferramenta ativa
    const isText = m ? m.type === "text" : this.tool === "text";
    const isHl = m ? m.type === "highlight" : this.tool === "highlight";
    const st: TextStyle = m
      ? m.type === "text"
        ? m
        : { ...this.textStyle, color: m.color, width: m.width, opacity: m.opacity }
      : isText
        ? this.textStyle
        : isHl
          ? { ...this.textStyle, ...this.hlStyle }
          : { ...this.textStyle, ...this.stroke };
    u.styleTitle.textContent = m
      ? "Estilo"
      : `Estilo padrão · ${isText ? "Texto" : isHl ? "Marca-texto" : "Traço"}`;
    this.renderSwatches(isHl ? "hl" : "stroke");
    const widthLabel = u.style.width.closest("label");
    if (widthLabel) widthLabel.hidden = isHl;
    u.grpText.hidden = !isText;
    u.lblColor.textContent = isText ? "Moldura" : "Cor";
    u.lblWidth.textContent = "Espessura (pt)";
    u.lblOpacity.textContent = isText ? "Opacidade da moldura" : "Opacidade";
    u.style.width.min = isText ? "0" : "0.1";
    u.style.width.title = isText ? "0 = sem moldura" : "";

    const s = u.style;
    const active = document.activeElement;
    const put = (el: HTMLInputElement, val: string) => {
      if (el !== active) el.value = val;
    };
    put(s.color, st.color);
    put(s.width, String(round(st.width)));
    put(s.opacity, String(Math.round(st.opacity * 100)));
    put(s.textColor, st.textColor);
    put(s.fontSize, String(round(st.fontSize)));
    put(s.fill, st.fill);
    put(s.fillOpacity, String(Math.round(st.fillOpacity * 100)));
    s.opacityVal.textContent = `${Math.round(st.opacity * 100)}%`;
    s.fillOpacityVal.textContent = `${Math.round(st.fillOpacity * 100)}%`;
  }

  private loadStyles(): void {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as { stroke?: StrokeStyle; text?: TextStyle; hl?: StrokeStyle };
      if (v.hl) this.hlStyle = { ...DEFAULT_HIGHLIGHT, ...v.hl };
      if (v.stroke) this.stroke = { ...DEFAULT_STROKE, ...v.stroke };
      if (v.text) this.textStyle = { ...DEFAULT_TEXT, ...v.text };
    } catch {
      /* sem armazenamento: usa os padrões */
    }
  }

  private saveStyles(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ stroke: this.stroke, text: this.textStyle, hl: this.hlStyle }));
    } catch {
      /* ignora */
    }
  }

  /* ------------------------------------------------------------ histórico */

  private pushHistory(): void {
    this.history.push(structuredClone(this.marks));
    if (this.history.length > 120) this.history.shift();
    this.future = [];
  }

  private undo(): void {
    this.commitEditor();
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(structuredClone(this.marks));
    this.marks = prev;
    this.afterHistory();
  }

  private redo(): void {
    this.commitEditor();
    const next = this.future.pop();
    if (!next) return;
    this.history.push(structuredClone(this.marks));
    this.marks = next;
    this.afterHistory();
  }

  private afterHistory(): void {
    if (!this.current()) this.selected = null;
    this.editSession = false;
    this.dirty = true;
    this.syncInspector();
    this.redraw();
  }

  /* ------------------------------------------------------------ desenho */

  private redraw(): void {
    drawMarks(this.view, this.marks, this.selected, this.makeDraft(), this.editor?.id ?? null);
    this.renderSheet();
    this.syncInspector();
  }

  private makeDraft(): Draft | null {
    const d = this.drag;
    if (!d || d.kind === "pan" || d.kind === "vertex" || d.kind === "move") return null;
    const slot = this.view.slotAt(d.page);
    if (!slot) return null;
    const cur = this.cursor && this.cursor.page === d.page
      ? this.view.toView(slot, this.cursor.pdf)
      : null;
    if (d.kind === "poly") {
      const pts = d.points.map((p) => this.view.toView(slot, p));
      return { page: d.page, d: draftPoly(pts, cur), style: this.stroke };
    }
    if (d.kind === "hl") {
      if (d.mode === "text") return { page: d.page, d: "", style: this.hlStyle, fills: d.boxes };
      const a = this.view.toView(slot, d.a);
      const b = cur ?? a;
      const fill = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      };
      return { page: d.page, d: "", style: this.hlStyle, fills: [fill] };
    }
    const a = this.view.toView(slot, d.a);
    const b = cur ?? a;
    if (d.kind === "line") return { page: d.page, d: draftLine(a, b), style: this.stroke };
    const style = d.kind === "text" ? this.textStyle : this.stroke;
    return { page: d.page, d: draftRect(a, b), style, box: true };
  }

  private renderSheet(): void {
    const u = this.ui;
    const counts: Record<Mark["type"], number> = { line: 0, polyline: 0, rect: 0, text: 0, highlight: 0 };
    for (const m of this.marks) counts[m.type]++;
    for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sheet-tab]")) {
      const t = tab.dataset.sheetTab as Mark["type"];
      const on = t === this.sheetTab;
      tab.classList.toggle("on", on);
      tab.setAttribute("aria-selected", String(on));
      const c = tab.querySelector(".count");
      if (c) c.textContent = counts[t] ? String(counts[t]) : "";
    }

    const rel = this.sheetTab === "line" || this.sheetTab === "polyline";
    const cols = rel
      ? ["Pág.", "Cor", "Origem", "Destino", "Função", "Circuito", "Status", "Nota"]
      : this.sheetTab === "highlight"
        ? ["Pág.", "Cor", "Trecho destacado", "Nota"]
        : ["Pág.", "Cor", "Nota"];
    const head = document.createElement("tr");
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c;
      head.append(th);
    }
    u.sheetHead.replaceChildren(head);

    const rows = ofType(this.marks, this.sheetTab);
    const empty = {
      line: "Nenhuma linha",
      polyline: "Nenhuma polilinha",
      rect: "Nenhuma área",
      text: "Nenhum texto",
      highlight: "Nenhum destaque",
    };
    u.sheetEmpty.hidden = rows.length > 0;
    u.sheetEmpty.textContent = `${empty[this.sheetTab]} neste documento.`;

    u.sheetBody.replaceChildren(
      ...rows.map((m) => {
        const tr = document.createElement("tr");
        tr.dataset.id = m.id;
        tr.classList.toggle("on", m.id === this.selected);
        const cell = (text: string, cls = "") => {
          const td = document.createElement("td");
          td.textContent = text;
          if (cls) td.className = cls;
          tr.append(td);
          return td;
        };
        const clip = (text: string, cls: string, full: string) => {
          const td = cell("", cls);
          const span = document.createElement("span");
          span.className = "clip";
          span.textContent = text;
          td.title = full;
          td.append(span);
        };
        cell(String(m.page), "num");
        tr.append(colorCell(m));
        if (hasRelation(m)) {
          for (const v of [m.from, m.to, m.fn, m.circuit, m.status]) cell(v);
        }
        if (m.type === "highlight") {
          // pontilhados de sumário viram reticências na lista
          const t = m.mode === "area" ? "(área)" : m.text.replace(/[.·…_]{4,}/g, " … ");
          clip(t, "quote", m.text);
        }
        clip(m.note.replace(/\s+/g, " "), "note", m.note);
        return tr;
      }),
    );
  }

  isDirty(): boolean {
    return this.dirty;
  }
}

/** Amostra de cor: traço para linhas e áreas; para texto, fundo + moldura + letra. */
function colorCell(m: Mark): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "num";
  const chip = document.createElement("span");
  chip.className = "chip";
  if (m.type === "text") {
    chip.classList.add("text");
    chip.textContent = "A";
    chip.style.color = m.textColor;
    chip.style.background = hexAlpha(m.fill, m.fillOpacity);
    chip.style.borderColor = m.width > 0 ? m.color : "transparent";
    chip.title = `Texto ${m.textColor} · fundo ${m.fill} · moldura ${m.width > 0 ? m.color : "nenhuma"}`;
  } else {
    chip.style.background = m.color;
    chip.style.opacity = String(Math.max(0.35, m.opacity));
    chip.title = m.color;
  }
  td.append(chip);
  return td;
}

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : String(err);
}

function dedupe(points: Pt[]): Pt[] {
  return points.filter(
    (p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-6,
  );
}

function projectOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Ponto que forma um quadrado com `a`, no quadrante do cursor. */
function square(a: Pt, p: Pt): Pt {
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
