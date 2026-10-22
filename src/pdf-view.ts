import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Pt } from "./model";

GlobalWorkerOptions.workerSrc = workerSrc;

export interface PageSlot {
  pageNum: number;
  page: PDFPageProxy;
  viewport: PageViewport;
  canvas: HTMLCanvasElement;
  svg: SVGSVGElement;
  /** Camada de texto invisível do pdf.js (para o marca-texto). */
  textLayer: HTMLDivElement;
  wrap: HTMLElement;
}

export class PdfView {
  doc: PDFDocumentProxy | null = null;
  slots: PageSlot[] = [];
  scale = 1;
  baseWidth = 612;
  private pagesEl: HTMLElement;
  private renderGen = 0;

  constructor(pagesEl: HTMLElement) {
    this.pagesEl = pagesEl;
  }

  async load(data: ArrayBuffer): Promise<void> {
    this.clear();
    // sem eval: compatível com a CSP do app desktop
    const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false });
    this.doc = await task.promise;
    const first = await this.doc.getPage(1);
    this.baseWidth = first.getViewport({ scale: 1 }).width;
  }

  clear(): void {
    this.renderGen += 1;
    this.doc?.destroy().catch(() => undefined);
    this.doc = null;
    this.slots = [];
    this.pagesEl.replaceChildren();
  }

  pageCount(): number {
    return this.doc?.numPages ?? 0;
  }

  fitWidthScale(stageWidth: number): number {
    const usable = Math.max(200, stageWidth - 48);
    return Math.max(0.15, Math.min(6, usable / this.baseWidth));
  }

  async render(scale: number, onLayout?: () => void): Promise<void> {
    if (!this.doc) return;
    this.scale = scale;
    const gen = ++this.renderGen;
    const next: PageSlot[] = [];

    for (let i = 1; i <= this.doc.numPages; i++) {
      if (gen !== this.renderGen) return;
      const page = await this.doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const wrap = document.createElement("div");
      wrap.className = "page";
      wrap.dataset.page = String(i);

      const canvas = document.createElement("canvas");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
      svg.setAttribute("width", String(viewport.width));
      svg.setAttribute("height", String(viewport.height));

      // o CSS da camada de texto do pdf.js usa --scale-factor
      wrap.style.setProperty("--scale-factor", String(viewport.scale));
      const textLayer = document.createElement("div");
      textLayer.className = "textLayer";

      wrap.append(canvas, textLayer, svg);
      next.push({ pageNum: i, page, viewport, canvas, svg, textLayer, wrap });
    }

    if (gen !== this.renderGen) return;
    this.pagesEl.replaceChildren(...next.map((s) => s.wrap));
    this.slots = next;
    onLayout?.();

    for (const slot of this.slots) {
      if (gen !== this.renderGen) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = slot.canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await slot.page.render({
        canvasContext: ctx,
        viewport: slot.viewport,
      }).promise;
    }
    // texto depois dos desenhos: a página aparece primeiro, a seleção logo em seguida
    for (const slot of this.slots) {
      if (gen !== this.renderGen) return;
      try {
        const tl = new TextLayer({
          textContentSource: slot.page.streamTextContent(),
          container: slot.textLayer,
          viewport: slot.viewport,
        });
        await tl.render();
      } catch {
        /* página sem texto extraível: o marca-texto cai no modo área */
      }
    }
  }

  slotAt(pageNum: number): PageSlot | undefined {
    return this.slots.find((s) => s.pageNum === pageNum);
  }

  toPdf(slot: PageSlot, x: number, y: number): Pt {
    const [px, py] = slot.viewport.convertToPdfPoint(x, y);
    return { x: px, y: py };
  }

  toView(slot: PageSlot, p: Pt): Pt {
    const [x, y] = slot.viewport.convertToViewportPoint(p.x, p.y);
    return { x, y };
  }

  clientToSlot(
    ev: { clientX: number; clientY: number },
  ): { slot: PageSlot; view: Pt; pdf: Pt } | null {
    for (const slot of this.slots) {
      const r = slot.svg.getBoundingClientRect();
      if (
        ev.clientX >= r.left &&
        ev.clientX <= r.right &&
        ev.clientY >= r.top &&
        ev.clientY <= r.bottom
      ) {
        const view = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        return { slot, view, pdf: this.toPdf(slot, view.x, view.y) };
      }
    }
    return null;
  }
}
