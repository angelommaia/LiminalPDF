export type Tool = "select" | "line" | "polyline" | "rect" | "text" | "highlight";

export interface Pt {
  x: number;
  y: number;
}

/** Estilo de traço. Largura em pontos do PDF (escala junto com o zoom). */
interface MarkBase {
  id: string;
  page: number;
  color: string;
  width: number;
  opacity: number;
}

/** De–para: vínculo entre dois pontos (sinal, cabo, duto…). */
export interface Relation {
  from: string;
  to: string;
  fn: string;
  circuit: string;
  status: string;
  note: string;
}

export const RELATION_KEYS = ["from", "to", "fn", "circuit", "status", "note"] as const;

export interface LineMark extends MarkBase, Relation {
  type: "line";
  a: Pt;
  b: Pt;
}

export interface PolylineMark extends MarkBase, Relation {
  type: "polyline";
  points: Pt[];
}

export interface RectMark extends MarkBase {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
}

/**
 * Caixa de texto. `color`/`width`/`opacity` descrevem a moldura
 * (width 0 = sem moldura). O fundo tem cor e opacidade próprias.
 */
export interface TextMark extends MarkBase {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  textColor: string;
  fill: string;
  fillOpacity: number;
  note: string;
}

export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Marca-texto. `mode: "text"` cobre linhas de texto (um retângulo por
 * linha, `text` guarda o trecho destacado); `mode: "area"` é um retângulo
 * livre. Cor e opacidade vêm de MarkBase; `width` não é usado.
 */
export interface HighlightMark extends MarkBase {
  type: "highlight";
  mode: "text" | "area";
  rects: PdfRect[];
  text: string;
  note: string;
}

export type Mark = LineMark | PolylineMark | RectMark | TextMark | HighlightMark;
export type BoxMark = RectMark | TextMark;
export type RelationMark = LineMark | PolylineMark;

export function hasRelation(m: Mark): m is RelationMark {
  return m.type === "line" || m.type === "polyline";
}

function emptyRelation(): Relation {
  return { from: "", to: "", fn: "", circuit: "", status: "", note: "" };
}

export const FORMAT = "liminalpdf" as const;
export const FORMAT_VERSION = 2;
export const DEFAULT_COLOR = "#b42318";

export interface StrokeStyle {
  color: string;
  width: number;
  opacity: number;
}

export interface TextStyle extends StrokeStyle {
  fontSize: number;
  textColor: string;
  fill: string;
  fillOpacity: number;
}

export const DEFAULT_STROKE: StrokeStyle = {
  color: DEFAULT_COLOR,
  width: 1.2,
  opacity: 1,
};

export const DEFAULT_HIGHLIGHT: StrokeStyle = {
  color: "#ffd400",
  width: 0,
  opacity: 0.45,
};

export const DEFAULT_TEXT: TextStyle = {
  color: "#1c1916",
  width: 0.8,
  opacity: 1,
  fontSize: 9,
  textColor: "#1c1916",
  fill: "#fff8c4",
  fillOpacity: 0.85,
};

export interface Sidecar {
  format: typeof FORMAT;
  version: number;
  pdfName: string;
  marks: Mark[];
}

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyPolyline(
  page: number,
  points: Pt[],
  s: StrokeStyle,
): PolylineMark {
  return {
    id: newId(),
    type: "polyline",
    page,
    ...pickStroke(s),
    points,
    ...emptyRelation(),
  };
}

export function emptyLine(page: number, a: Pt, b: Pt, s: StrokeStyle): LineMark {
  return { id: newId(), type: "line", page, ...pickStroke(s), a, b, ...emptyRelation() };
}

export function emptyRect(
  page: number,
  r: { x: number; y: number; w: number; h: number },
  s: StrokeStyle,
): RectMark {
  return { id: newId(), type: "rect", page, ...pickStroke(s), ...r, note: "" };
}

export function emptyText(
  page: number,
  r: { x: number; y: number; w: number; h: number },
  s: TextStyle,
): TextMark {
  return {
    id: newId(),
    type: "text",
    page,
    ...pickStroke(s),
    ...r,
    text: "",
    fontSize: s.fontSize,
    textColor: s.textColor,
    fill: s.fill,
    fillOpacity: s.fillOpacity,
    note: "",
  };
}

function pickStroke(s: StrokeStyle): StrokeStyle {
  return { color: s.color, width: s.width, opacity: s.opacity };
}

export function emptyHighlight(
  page: number,
  mode: "text" | "area",
  rects: PdfRect[],
  text: string,
  s: StrokeStyle,
): HighlightMark {
  return {
    id: newId(),
    type: "highlight",
    page,
    color: s.color,
    width: 0,
    opacity: s.opacity,
    mode,
    rects,
    text,
    note: "",
  };
}

/** Caixa que envolve todos os retângulos de um destaque. */
export function boundsOf(rects: PdfRect[]): PdfRect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function toSidecar(pdfName: string, marks: Mark[]): Sidecar {
  return { format: FORMAT, version: FORMAT_VERSION, pdfName, marks };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/** Completa campos ausentes (arquivos antigos não têm estilo, nem de–para em linhas). */
function normalize(m: Mark): Mark {
  const base =
    m.type === "text" ? DEFAULT_TEXT : m.type === "highlight" ? DEFAULT_HIGHLIGHT : DEFAULT_STROKE;
  m.color = str(m.color, base.color);
  m.width = num(m.width, base.width);
  m.opacity = num(m.opacity, base.opacity);
  if (hasRelation(m)) {
    for (const k of RELATION_KEYS) m[k] = str(m[k], "");
  }
  if (m.type === "rect") m.note = str(m.note, "");
  if (m.type === "highlight") {
    m.mode = m.mode === "text" ? "text" : "area";
    m.rects = Array.isArray(m.rects) ? m.rects : [];
    m.text = str(m.text, "");
    m.note = str(m.note, "");
  }
  if (m.type === "text") {
    m.note = str(m.note, "");
    m.text = str(m.text, "");
    m.fontSize = num(m.fontSize, DEFAULT_TEXT.fontSize);
    m.textColor = str(m.textColor, DEFAULT_TEXT.textColor);
    m.fill = str(m.fill, DEFAULT_TEXT.fill);
    m.fillOpacity = num(m.fillOpacity, DEFAULT_TEXT.fillOpacity);
  }
  return m;
}

export function parseSidecar(raw: unknown): Mark[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("Arquivo de marcações inválido.");
  }
  const doc = raw as Partial<Sidecar>;
  if (doc.format !== FORMAT) {
    throw new Error("Este JSON não é um arquivo LiminalPDF.");
  }
  if (!Array.isArray(doc.marks)) {
    throw new Error("Arquivo de marcações sem lista de marcas.");
  }
  if (typeof doc.version === "number" && doc.version > FORMAT_VERSION) {
    throw new Error("Arquivo criado por uma versão mais nova do LiminalPDF.");
  }
  return (doc.marks as Mark[]).map(normalize);
}

export function ofType<T extends Mark["type"]>(
  marks: Mark[],
  type: T,
): Extract<Mark, { type: T }>[] {
  return marks.filter((m): m is Extract<Mark, { type: T }> => m.type === type);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function hitTest(mark: Mark, p: Pt, tol: number): boolean {
  const t = tol + mark.width / 2;
  if (mark.type === "line") {
    return distToSegment(p, mark.a, mark.b) <= t;
  }
  if (mark.type === "polyline") {
    return segmentAt(mark.points, p, t) >= 0;
  }
  if (mark.type === "highlight") {
    return mark.rects.some((r) => inRect(r, p, tol));
  }
  const minX = Math.min(mark.x, mark.x + mark.w) - tol;
  const maxX = Math.max(mark.x, mark.x + mark.w) + tol;
  const minY = Math.min(mark.y, mark.y + mark.h) - tol;
  const maxY = Math.max(mark.y, mark.y + mark.h) + tol;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

/** Índice do segmento (i-1 → i) mais próximo de p dentro da tolerância, ou -1. */
export function segmentAt(points: Pt[], p: Pt, tol: number): number {
  let best = -1;
  let bestD = tol;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(p, points[i - 1], points[i]);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Pontos editáveis de uma marca (vértices ou cantos). */
function inRect(r: PdfRect, p: Pt, tol: number): boolean {
  return (
    p.x >= Math.min(r.x, r.x + r.w) - tol &&
    p.x <= Math.max(r.x, r.x + r.w) + tol &&
    p.y >= Math.min(r.y, r.y + r.h) - tol &&
    p.y <= Math.max(r.y, r.y + r.h) + tol
  );
}

export function handlesOf(mark: Mark): Pt[] {
  if (mark.type === "line") return [mark.a, mark.b];
  if (mark.type === "polyline") return mark.points;
  if (mark.type === "highlight") {
    // destaque de texto acompanha o texto: só se move ou se apaga
    if (mark.mode === "text" || !mark.rects[0]) return [];
    const r = mark.rects[0];
    return corners(r);
  }
  return corners(mark);
}

function corners(mark: PdfRect): Pt[] {
  return [
    { x: mark.x, y: mark.y },
    { x: mark.x + mark.w, y: mark.y },
    { x: mark.x + mark.w, y: mark.y + mark.h },
    { x: mark.x, y: mark.y + mark.h },
  ];
}

/** Move o ponto editável `i` para `p`. */
export function setHandle(mark: Mark, i: number, p: Pt): void {
  if (mark.type === "line") {
    if (i === 0) mark.a = p;
    else mark.b = p;
    return;
  }
  if (mark.type === "polyline") {
    mark.points[i] = p;
    return;
  }
  if (mark.type === "highlight") {
    if (mark.mode !== "area" || !mark.rects[0]) return;
    const c = corners(mark.rects[0])[(i + 2) % 4];
    mark.rects[0] = normalizeRect(c.x, c.y, p.x, p.y);
    return;
  }
  // canto oposto fica fixo
  const c = handlesOf(mark)[(i + 2) % 4];
  const r = normalizeRect(c.x, c.y, p.x, p.y);
  mark.x = r.x;
  mark.y = r.y;
  mark.w = r.w;
  mark.h = r.h;
}

export function translate(mark: Mark, dx: number, dy: number): void {
  const mv = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  if (mark.type === "line") {
    mark.a = mv(mark.a);
    mark.b = mv(mark.b);
  } else if (mark.type === "polyline") {
    mark.points = mark.points.map(mv);
  } else if (mark.type === "highlight") {
    mark.rects = mark.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  } else {
    mark.x += dx;
    mark.y += dy;
  }
}

/**
 * Trava a direção de `anchor` → `p` em múltiplos de `stepDeg`
 * (Shift). Mantém a projeção do cursor sobre a direção escolhida.
 */
export function snapAngle(anchor: Pt, p: Pt, stepDeg = 45): Pt {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const proj = dx * ux + dy * uy;
  // evita -0 e ruído de ponto flutuante nos eixos
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return {
    x: anchor.x + clean(proj * ux),
    y: anchor.y + clean(proj * uy),
  };
}

export function normalizeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
