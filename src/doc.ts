import type { Mark } from "./model";
import { PdfView } from "./pdf-view";

/**
 * Um documento aberto numa aba: o PDF renderizado (com seu próprio
 * contêiner de páginas, que fica escondido quando a aba não está ativa),
 * as marcações, o histórico de desfazer e onde salvar.
 */
export class Doc {
  readonly id = crypto.randomUUID();
  readonly pagesEl: HTMLElement;
  readonly view: PdfView;
  /** false = aba vazia (nenhum PDF carregado ainda). */
  opened = false;
  name = "";
  dirty = false;
  /** Caminho no disco (só no app desktop). */
  path: string | null = null;
  marksPath: string | null = null;
  /** Cópia dos bytes do PDF (o pdf.js consome o buffer original). */
  bytes: Uint8Array | null = null;
  /** Handle da File System Access API (modo navegador). */
  saveHandle: object | null = null;
  marks: Mark[] = [];
  history: Mark[][] = [];
  future: Mark[][] = [];
  selected: string | null = null;
  scrollTop = 0;
  scrollLeft = 0;

  constructor(container: HTMLElement) {
    this.pagesEl = document.createElement("div");
    this.pagesEl.className = "pages";
    this.pagesEl.hidden = true;
    container.append(this.pagesEl);
    this.view = new PdfView(this.pagesEl);
  }

  destroy(): void {
    this.view.clear();
    this.pagesEl.remove();
  }
}
