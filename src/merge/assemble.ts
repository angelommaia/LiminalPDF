import { PDFDocument } from "@cantoo/pdf-lib";

export interface Piece {
  /** Identificador do arquivo de origem (o mesmo arquivo pode aparecer em vários trechos). */
  source: string;
  /** Páginas base 1, na ordem final. */
  pages: number[];
}

/**
 * Monta um PDF novo a partir de trechos de vários arquivos.
 *
 * As páginas de um mesmo arquivo são copiadas numa única chamada, para que
 * fontes e imagens compartilhadas entrem uma vez só no resultado. Uma página
 * que aparece mais de uma vez é copiada de novo a cada repetição (o PDF não
 * permite que o mesmo objeto de página apareça duas vezes na árvore).
 */
export async function assemble(
  pieces: Piece[],
  load: (source: string) => Promise<Uint8Array>,
  title = "LiminalPDF",
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setProducer("LiminalPDF");
  out.setCreator("LiminalPDF");

  // posição final de cada página: [fonte, página]
  const order: { source: string; page: number }[] = [];
  for (const p of pieces) for (const page of p.pages) order.push({ source: p.source, page });

  const docs = new Map<string, PDFDocument>();
  // cópias por fonte, em "rodadas": rodada k atende a k-ésima ocorrência da página
  const copies = new Map<string, Map<number, ReturnType<PDFDocument["getPage"]>[]>>();

  for (const source of new Set(order.map((o) => o.source))) {
    const doc = await PDFDocument.load(await load(source), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    docs.set(source, doc);
    const occ = new Map<number, number>();
    for (const o of order) if (o.source === source) occ.set(o.page, (occ.get(o.page) ?? 0) + 1);
    const byPage = new Map<number, ReturnType<PDFDocument["getPage"]>[]>();
    for (let round = 0; ; round++) {
      const idx = [...occ].filter(([, n]) => n > round).map(([p]) => p);
      if (!idx.length) break;
      const copied = await out.copyPages(doc, idx.map((p) => p - 1));
      idx.forEach((p, i) => {
        const list = byPage.get(p) ?? [];
        list.push(copied[i]);
        byPage.set(p, list);
      });
    }
    copies.set(source, byPage);
  }

  for (const o of order) {
    const page = copies.get(o.source)!.get(o.page)!.shift()!;
    out.addPage(page);
  }
  return out.save({ useObjectStreams: true });
}

/** Número de páginas, lido sem renderizar. */
export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}
