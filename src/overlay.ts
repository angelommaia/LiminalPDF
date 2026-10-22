import { boundsOf, handlesOf, type Mark, type PdfRect, type Pt, type StrokeStyle } from "./model";
import type { PageSlot, PdfView } from "./pdf-view";

const NS = "http://www.w3.org/2000/svg";
const XHTML = "http://www.w3.org/1999/xhtml";
export const HANDLE_PX = 8;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function pts(view: PdfView, slot: PageSlot, points: Pt[]): string {
  return points
    .map((p) => {
      const v = view.toView(slot, p);
      return `${v.x},${v.y}`;
    })
    .join(" ");
}

export function strokePx(widthPt: number, scale: number): number {
  return Math.max(0.6, widthPt * scale);
}

export function boxToView(
  view: PdfView,
  slot: PageSlot,
  m: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const a = view.toView(slot, { x: m.x, y: m.y });
  const b = view.toView(slot, { x: m.x + m.w, y: m.y + m.h });
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Geometria da marca como elemento SVG, sem estilo. */
function shape(view: PdfView, slot: PageSlot, mark: Mark): SVGElement {
  if (mark.type === "line") {
    const a = view.toView(slot, mark.a);
    const b = view.toView(slot, mark.b);
    return el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  if (mark.type === "polyline") {
    return el("polyline", { points: pts(view, slot, mark.points) });
  }
  if (mark.type === "highlight") {
    const d = mark.rects
      .map((pr) => {
        const r = boxToView(view, slot, pr);
        return `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`;
      })
      .join("");
    return el("path", { d });
  }
  const r = boxToView(view, slot, mark);
  return el("rect", { x: r.x, y: r.y, width: r.w, height: r.h });
}

export interface Draft {
  page: number;
  d: string;
  style: StrokeStyle;
  box?: boolean;
  /** Prévia do marca-texto: retângulos preenchidos, em px da página. */
  fills?: PdfRect[];
}

export function drawMarks(
  view: PdfView,
  marks: Mark[],
  selectedId: string | null,
  draft: Draft | null,
  editingId: string | null,
): void {
  for (const slot of view.slots) {
    const scale = slot.viewport.scale;
    slot.svg.replaceChildren();
    let selected: Mark | null = null;

    // destaques ficam por baixo das outras marcações
    const ordered = [
      ...marks.filter((m) => m.type === "highlight"),
      ...marks.filter((m) => m.type !== "highlight"),
    ];
    for (const mark of ordered) {
      if (mark.page !== slot.pageNum) continue;
      const isSel = mark.id === selectedId;
      if (isSel) selected = mark;
      const px = strokePx(mark.width, scale);

      if (mark.type === "highlight") {
        const g = el("g", { "data-id": mark.id, class: "hl" });
        for (const pr of mark.rects) {
          const r = boxToView(view, slot, pr);
          g.append(
            el("rect", {
              x: r.x,
              y: r.y,
              width: r.w,
              height: r.h,
              fill: mark.color,
              "fill-opacity": mark.opacity,
            }),
          );
        }
        slot.svg.append(g);
        continue;
      }

      if (isSel && mark.type !== "text") {
        // halo de seleção por baixo, sem alterar a cor da marca
        const halo = shape(view, slot, mark);
        halo.setAttribute("class", "halo");
        halo.setAttribute("stroke-width", String(px + 6));
        halo.setAttribute("fill", "none");
        slot.svg.append(halo);
      }

      if (mark.type === "text") {
        drawText(view, slot, mark, mark.id === editingId);
        continue;
      }

      const s = shape(view, slot, mark);
      s.setAttribute("stroke", mark.color);
      s.setAttribute("stroke-width", String(px));
      s.setAttribute("stroke-opacity", String(mark.opacity));
      s.setAttribute("stroke-linejoin", "round");
      s.setAttribute("stroke-linecap", "round");
      s.setAttribute("data-id", mark.id);
      if (mark.type === "rect") {
        s.setAttribute("fill", mark.color);
        s.setAttribute("fill-opacity", String(mark.opacity * 0.08));
      } else {
        s.setAttribute("fill", "none");
      }
      slot.svg.append(s);
    }

    if (selected) drawHandles(view, slot, selected);

    if (draft && draft.page === slot.pageNum && draft.fills) {
      const g = el("g", { class: "hl draft-fill" });
      for (const r of draft.fills) {
        g.append(
          el("rect", {
            x: r.x,
            y: r.y,
            width: r.w,
            height: r.h,
            fill: draft.style.color,
            "fill-opacity": draft.style.opacity,
          }),
        );
      }
      slot.svg.append(g);
    } else if (draft && draft.page === slot.pageNum) {
      slot.svg.append(
        el("path", {
          d: draft.d,
          stroke: draft.style.color,
          "stroke-width": strokePx(draft.style.width, scale),
          "stroke-opacity": Math.max(0.35, draft.style.opacity),
          fill: draft.box ? draft.style.color : "none",
          "fill-opacity": draft.box ? 0.06 : 0,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
          class: "draft",
        }),
      );
    }
  }
}

function drawText(
  view: PdfView,
  slot: PageSlot,
  mark: Extract<Mark, { type: "text" }>,
  editing: boolean,
): void {
  const scale = slot.viewport.scale;
  const r = boxToView(view, slot, mark);
  const g = el("g", { "data-id": mark.id });
  g.append(
    el("rect", {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      fill: mark.fill,
      "fill-opacity": mark.fillOpacity,
      stroke: mark.width > 0 ? mark.color : "none",
      "stroke-width": mark.width > 0 ? mark.width * scale : 0,
      "stroke-opacity": mark.opacity,
    }),
  );
  if (!editing) {
    const fo = el("foreignObject", { x: r.x, y: r.y, width: r.w, height: r.h });
    const div = document.createElementNS(XHTML, "div") as HTMLDivElement;
    div.className = "textbox";
    applyTextCss(div.style, mark, scale);
    div.textContent = mark.text;
    fo.append(div);
    g.append(fo);
  }
  slot.svg.append(g);
}

/** CSS compartilhado entre o texto renderizado e o editor inline. */
export function applyTextCss(
  st: CSSStyleDeclaration,
  mark: { fontSize: number; textColor: string; width: number },
  scale: number,
): void {
  const fs = mark.fontSize * scale;
  st.fontSize = `${fs}px`;
  st.lineHeight = "1.25";
  st.color = mark.textColor;
  st.padding = `${Math.max(2, (2 + mark.width) * scale)}px`;
}

function drawHandles(view: PdfView, slot: PageSlot, mark: Mark): void {
  if (mark.type === "text" || mark.type === "highlight") {
    const r = boxToView(view, slot, mark.type === "text" ? mark : boundsOf(mark.rects));
    slot.svg.append(
      el("rect", {
        x: r.x - 2,
        y: r.y - 2,
        width: r.w + 4,
        height: r.h + 4,
        class: "sel-box",
      }),
    );
  }
  const h = HANDLE_PX;
  for (const p of handlesOf(mark)) {
    const v = view.toView(slot, p);
    slot.svg.append(
      el("rect", {
        x: v.x - h / 2,
        y: v.y - h / 2,
        width: h,
        height: h,
        class: "handle",
      }),
    );
  }
}

export function draftLine(a: Pt, b: Pt): string {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

export function draftPoly(points: Pt[], cursor: Pt | null): string {
  const all = cursor ? [...points, cursor] : points;
  if (all.length === 0) return "";
  return all.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

export function draftRect(a: Pt, b: Pt): string {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return `M ${x} ${y} h ${w} v ${h} h ${-w} z`;
}
