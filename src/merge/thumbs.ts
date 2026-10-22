import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

const THUMB_H = 160; // px de altura renderizada (exibida menor via CSS)

/**
 * Miniaturas de página sob demanda, com cache por arquivo e fila com
 * concorrência limitada para não travar a janela em arquivos grandes.
 */
export class Thumbs {
  private docs = new Map<string, Promise<PDFDocumentProxy>>();
  private cache = new Map<string, Promise<string>>();
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private observer: IntersectionObserver;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const img = e.target as HTMLImageElement;
          this.observer.unobserve(img);
          const { src, page } = img.dataset;
          if (!src || !page) continue;
          void this.get(src, Number(page)).then((url) => {
            img.src = url;
            img.classList.add("ready");
          });
        }
      },
      { rootMargin: "200px" },
    );
  }

  register(source: string, bytes: Uint8Array): void {
    if (this.docs.has(source)) return;
    // pdf.js transfere o buffer para o worker: passa uma cópia
    const task = getDocument({ data: bytes.slice(), isEvalSupported: false });
    this.docs.set(source, task.promise);
  }

  forget(source: string): void {
    void this.docs.get(source)?.then((d) => d.destroy());
    this.docs.delete(source);
    for (const [k, v] of this.cache) {
      if (k.startsWith(source + ":")) {
        void v.then((u) => URL.revokeObjectURL(u));
        this.cache.delete(k);
      }
    }
  }

  /** Cria um <img> que só renderiza quando entra na tela. */
  img(source: string, page: number): HTMLImageElement {
    const img = document.createElement("img");
    img.alt = `Página ${page}`;
    img.dataset.src = source;
    img.dataset.page = String(page);
    img.decoding = "async";
    const key = `${source}:${page}`;
    const hit = this.cache.get(key);
    if (hit) {
      void hit.then((u) => {
        img.src = u;
        img.classList.add("ready");
      });
    } else {
      this.observer.observe(img);
    }
    return img;
  }

  get(source: string, page: number): Promise<string> {
    const key = `${source}:${page}`;
    let p = this.cache.get(key);
    if (!p) {
      p = new Promise<string>((resolve, reject) => {
        this.queue.push(() => this.render(source, page).then(resolve, reject));
        this.pump();
      });
      this.cache.set(key, p);
    }
    return p;
  }

  private pump(): void {
    while (this.running < 3 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async render(source: string, pageNum: number): Promise<string> {
    const doc = await this.docs.get(source);
    if (!doc) throw new Error("arquivo removido");
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: THUMB_H / base.height });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("falha ao gerar miniatura");
    return URL.createObjectURL(blob);
  }
}
