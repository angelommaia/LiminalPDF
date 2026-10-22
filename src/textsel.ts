/**
 * Seleção de texto por coordenadas sobre a camada de texto do pdf.js.
 * Não usa a seleção nativa do navegador (o editor intercepta o ponteiro);
 * só pergunta "qual caractere está neste ponto?" e mede o intervalo.
 */

export interface Caret {
  node: Text;
  offset: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function rawCaret(x: number, y: number): Caret | null {
  const d = document as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  return node && node.nodeType === Node.TEXT_NODE ? { node: node as Text, offset } : null;
}

function textSpans(layer: HTMLElement): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>("span")].filter(
    (s) => s.firstChild?.nodeType === Node.TEXT_NODE && (s.textContent ?? "").length > 0,
  );
}

/** Há texto exatamente sob o ponto? (decide entre marcar texto ou área) */
export function textAt(layer: HTMLElement, x: number, y: number): boolean {
  for (const s of textSpans(layer)) {
    const r = s.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

/**
 * Caractere mais próximo do ponto. Fora de qualquer trecho de texto, usa a
 * linha mais próxima e prende o ponto às bordas dela, como os leitores de PDF.
 */
export function caretNear(layer: HTMLElement, x: number, y: number): Caret | null {
  const spans = textSpans(layer);
  if (!spans.length) return null;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  let bestRect: DOMRect | null = null;
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const score = dy * 6 + dx;
    if (score < bestScore) {
      bestScore = score;
      best = s;
      bestRect = r;
    }
  }
  if (!best || !bestRect) return null;
  const text = best.firstChild as Text;
  const r = bestRect;
  if (x <= r.left) return { node: text, offset: 0 };
  if (x >= r.right) return { node: text, offset: text.length };
  const c = rawCaret(x, r.top + r.height / 2);
  if (c && c.node === text) return c;
  // proporcional à largura, se o navegador não souber responder
  const frac = (x - r.left) / r.width;
  return { node: text, offset: Math.round(frac * text.length) };
}

function ordered(a: Caret, b: Caret): Range {
  const r = document.createRange();
  const cmp = a.node.compareDocumentPosition(b.node);
  const aFirst =
    a.node === b.node ? a.offset <= b.offset : !(cmp & Node.DOCUMENT_POSITION_PRECEDING);
  const [s, e] = aFirst ? [a, b] : [b, a];
  r.setStart(s.node, Math.min(s.offset, s.node.length));
  r.setEnd(e.node, Math.min(e.offset, e.node.length));
  return r;
}

/**
 * Retângulos (em coordenadas da página, px de tela) cobrindo o texto entre
 * dois carets, já unidos por linha, e o texto selecionado.
 */
export function measure(
  layer: HTMLElement,
  a: Caret,
  b: Caret,
  origin: { left: number; top: number },
): { boxes: Box[]; text: string } {
  const range = ordered(a, b);
  const raw: Box[] = [];
  for (const r of range.getClientRects()) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    raw.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  }
  return { boxes: mergeLines(raw), text: rangeText(layer, range) };
}

/** Une retângulos da mesma linha que estejam próximos. */
export function mergeLines(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2) || p.x - q.x);
  const lines: Box[][] = [];
  for (const b of sorted) {
    const mid = b.y + b.h / 2;
    const line = lines.find((l) => {
      const top = Math.min(...l.map((r) => r.y));
      const bottom = Math.max(...l.map((r) => r.y + r.h));
      return mid > top && mid < bottom;
    });
    if (line) line.push(b);
    else lines.push([b]);
  }
  const out: Box[] = [];
  for (const l of lines) {
    l.sort((p, q) => p.x - q.x);
    let cur = { ...l[0] };
    for (const b of l.slice(1)) {
      const gap = b.x - (cur.x + cur.w);
      const h = Math.max(cur.h, b.h);
      if (gap < h * 1.5) {
        const x2 = Math.max(cur.x + cur.w, b.x + b.w);
        const y1 = Math.min(cur.y, b.y);
        const y2 = Math.max(cur.y + cur.h, b.y + b.h);
        cur = { x: cur.x, y: y1, w: x2 - cur.x, h: y2 - y1 };
      } else {
        out.push(cur);
        cur = { ...b };
      }
    }
    out.push(cur);
  }
  return out;
}

/** Texto do intervalo, com espaço nas quebras de linha do pdf.js. */
function rangeText(layer: HTMLElement, range: Range): string {
  let out = "";
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    if (n.nodeName === "BR") {
      out += " ";
      continue;
    }
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const t = n as Text;
    const start = t === range.startContainer ? range.startOffset : 0;
    const end = t === range.endContainer ? range.endOffset : t.length;
    out += t.data.slice(start, end);
  }
  return out.replace(/\s+/g, " ").trim();
}
