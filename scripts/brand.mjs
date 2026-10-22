// Gera a identidade visual do LiminalPDF a partir de um único lugar.
//   node scripts/brand.mjs
// Saídas: docs/brand/*.svg|png e public/favicon.svg. docs/brand/icone-1024.png
// é a fonte para `npx tauri icon docs/brand/icone-1024.png`.
//
// Textos viram curvas (IBM Plex Sans, OFL) para os SVGs ficarem iguais em
// qualquer lugar, inclusive no GitHub, sem depender de fontes instaladas.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "brand");
mkdirSync(out, { recursive: true });
mkdirSync(join(root, "public"), { recursive: true });

const fontFile = (w) =>
  join(root, `node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff`);
const loadFont = (w) => {
  const b = readFileSync(fontFile(w));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const REG = loadFont(400);
const SEMI = loadFont(600);

/* ------------------------------------------------------------ paleta */

export const BRAND = {
  red: "#b42318", // vermelho de revisão
  blue: "#1d4e89", // azul de seleção
  ochre: "#8a5a2b",
  ink: "#1c1916",
  paper: "#ece6dc",
  sepia: "#e7e0d4",
  tile: "#241f1b",
};

const THEMES = {
  sepia: { ring: null, bg: "#f3eee6", grid: "#1c1916", ink: "#1c1916", muted: "#6d655c", frame: "#cfc6b8", sheet: "#ece6dc" },
  light: { ring: null, bg: "#ffffff", grid: "#1c1916", ink: "#1c1916", muted: "#66625c", frame: "#dcdad5", sheet: "#f1f1ef" },
  dark: { ring: "#4a433c", bg: "#1b1917", grid: "#ece6dc", ink: "#ece6dc", muted: "#a1988c", frame: "#3a342e", sheet: "#26221f" },
};

/* ------------------------------------------------------------ texto → curvas */

function textPath(font, text, x, y, size, { tracking = 0, fill = "#000" } = {}) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  let cx = x;
  let d = "";
  glyphs.forEach((g, i) => {
    d += g.getPath(cx, y, size).toPathData(2);
    let adv = g.advanceWidth * scale + tracking * size;
    if (i < glyphs.length - 1) adv += font.getKerningValue(g, glyphs[i + 1]) * scale;
    cx += adv;
  });
  return { svg: `<path d="${d}" fill="${fill}"/>`, width: cx - x - (glyphs.length ? tracking * size : 0) };
}

function textWidth(font, text, size, tracking = 0) {
  return textPath(font, text, 0, 0, size, { tracking }).width;
}

/* ------------------------------------------------------------ símbolo */

// Folha com dobra e uma polilinha de revisão que atravessa a borda da
// folha: a anotação vive no limiar entre o desenho e a revisão.
// Grade de 1024; `tile` desenha o fundo arredondado (ícone do app).
function symbol({ tile = true, sheet = BRAND.paper, fold = "#cfc6b8", stroke = null, ring = null } = {}) {
  const parts = [];
  if (tile) {
    // `ring`: contorno sutil para o ladrilho não sumir em fundos escuros
    const r = ring ? ` stroke="${ring}" stroke-width="16"` : "";
    parts.push(`<rect x="64" y="64" width="896" height="896" rx="200" fill="${BRAND.tile}"${r}/>`);
  }
  const sheetAttrs = stroke
    ? `fill="none" stroke="${stroke}" stroke-width="40" stroke-linejoin="round"`
    : `fill="${sheet}"`;
  parts.push(`<path d="M288 184 H612 L752 324 V840 H288 Z" ${sheetAttrs}/>`);
  parts.push(
    stroke
      ? `<path d="M612 184 V324 H752" fill="none" stroke="${stroke}" stroke-width="40" stroke-linejoin="round"/>`
      : `<path d="M612 184 V324 H752 Z" fill="${fold}"/>`,
  );
  parts.push(
    `<polyline points="372,712 372,544 556,544 556,420 860,420" fill="none" stroke="${BRAND.red}" stroke-width="52" stroke-linejoin="round" stroke-linecap="round"/>`,
  );
  for (const [x, y] of [
    [372, 712],
    [860, 420],
  ]) {
    parts.push(
      `<rect x="${x - 34}" y="${y - 34}" width="68" height="68" fill="#ffffff" stroke="${BRAND.blue}" stroke-width="18"/>`,
    );
  }
  return parts.join("");
}

const svgDoc = (w, h, body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${extra}>${body}</svg>\n`;

/* ------------------------------------------------------------ wordmark */

function wordmark(x, baseline, size, t) {
  const tr = 0.14;
  const a = textPath(SEMI, "LIMINAL", x, baseline, size, { tracking: tr, fill: t.ink });
  const gap = size * 0.42;
  const b = textPath(REG, "PDF", x + a.width + gap, baseline, size, { tracking: tr, fill: t.muted });
  return { svg: a.svg + b.svg, width: a.width + gap + b.width };
}

/* ------------------------------------------------------------ fundo técnico */

function grid(w, h, t, step = 24) {
  let d = "";
  for (let x = step; x < w; x += step) d += `M${x} 0V${h}`;
  for (let y = step; y < h; y += step) d += `M0 ${y}H${w}`;
  return `<path d="${d}" stroke="${t.grid}" stroke-opacity="0.045" stroke-width="1"/>`;
}

// Moldura de prancha com carimbo no canto, como num desenho técnico.
function frame(w, h, t, m, stamp) {
  const sw = stamp.w;
  const sh = stamp.h;
  const x2 = w - m;
  const y2 = h - m;
  let s = `<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${t.frame}" stroke-width="2"/>`;
  s += `<path d="M${x2 - sw} ${y2} V${y2 - sh} H${x2} M${x2 - sw} ${y2 - sh / 2} H${x2} M${x2 - sw * 0.38} ${y2 - sh / 2} V${y2}" fill="none" stroke="${t.frame}" stroke-width="2"/>`;
  const fs = sh * 0.2;
  s += textPath(REG, "LIMINALPDF", x2 - sw + fs * 0.7, y2 - sh / 2 - fs * 0.75, fs, { tracking: 0.12, fill: t.muted }).svg;
  s += textPath(REG, "REV. A", x2 - sw + fs * 0.7, y2 - fs * 0.75, fs, { tracking: 0.12, fill: t.muted }).svg;
  s += textPath(REG, "FOSS", x2 - sw * 0.38 + fs * 0.7, y2 - fs * 0.75, fs, { tracking: 0.12, fill: t.muted }).svg;
  return s;
}

// Polilinha decorativa que cruza a moldura (o "limiar").
function redline(points, w) {
  const pts = points.map((p) => p.join(",")).join(" ");
  let s = `<polyline points="${pts}" fill="none" stroke="${BRAND.red}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const hs = w * 2.6;
  for (const [x, y] of [points[0], points[points.length - 1]]) {
    s += `<rect x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="${BRAND.blue}" stroke-width="${w * 0.7}"/>`;
  }
  return s;
}

/* ------------------------------------------------------------ peças */

function banner(theme) {
  const t = THEMES[theme];
  const W = 1280;
  const H = 320;
  let s = `<rect width="${W}" height="${H}" rx="16" fill="${t.bg}"/>`;
  s += grid(W, H, t);
  s += frame(W, H, t, 20, { w: 230, h: 64 });
  s += redline(
    [
      [1000, 236],
      [1000, 176],
      [1092, 176],
      [1092, 112],
      [1300, 112],
    ],
    6,
  );
  s += `<g transform="translate(88 88) scale(${144 / 1024})">${symbol({ ring: t.ring })}</g>`;
  const wm = wordmark(272, 162, 50, t);
  s += wm.svg;
  s += textPath(REG, "Editor de anotações em PDF para revisão de projetos", 274, 206, 21, { fill: t.muted }).svg;
  s += textPath(REG, "de engenharia. Leve, local e livre.", 274, 236, 21, { fill: t.muted }).svg;
  return svgDoc(W, H, s, ' role="img" aria-label="LiminalPDF"');
}

function social() {
  const t = THEMES.sepia;
  const W = 1280;
  const H = 640;
  let s = `<rect width="${W}" height="${H}" fill="${t.bg}"/>`;
  s += grid(W, H, t, 32);
  s += frame(W, H, t, 32, { w: 300, h: 84 });
  s += redline(
    [
      [880, 470],
      [880, 380],
      [1010, 380],
      [1010, 300],
      [1300, 300],
    ],
    8,
  );
  s += `<g transform="translate(112 132) scale(${200 / 1024})">${symbol()}</g>`;
  s += wordmark(116, 420, 76, t).svg;
  s += textPath(REG, "Editor de anotações em PDF para", 118, 482, 30, { fill: t.muted }).svg;
  s += textPath(REG, "revisão de projetos de engenharia.", 118, 522, 30, { fill: t.muted }).svg;
  s += textPath(SEMI, "LEVE · LOCAL · LIVRE (MIT)", 118, 578, 18, { tracking: 0.14, fill: BRAND.ochre }).svg;
  return svgDoc(W, H, s);
}

function horizontal(theme) {
  const t = THEMES[theme];
  const size = 44;
  const sym = 72;
  const wm = wordmark(sym + 22, 52, size, t);
  const W = Math.ceil(sym + 22 + wm.width + 4);
  const H = 72;
  const s = `<g transform="scale(${sym / 1024})">${symbol({ ring: t.ring })}</g>` + wm.svg;
  return svgDoc(W, H, s, ' role="img" aria-label="LiminalPDF"');
}

function wordmarkOnly(theme) {
  const t = THEMES[theme];
  const wm = wordmark(0, 44, 44, t);
  return svgDoc(Math.ceil(wm.width + 2), 56, wm.svg, ' role="img" aria-label="LiminalPDF"');
}

function glyph(color) {
  // contorno, sem fundo: para uso pequeno e monocromático
  return svgDoc(1024, 1024, symbol({ tile: false, stroke: color }));
}

/* ------------------------------------------------------------ paleta */

// Tokens principais da interface, espelhando src/style.css.
const UI = {
  sepia: { nome: "Sépia (padrão)", cores: [["Fundo", "#e7e0d4"], ["Barra", "#241f1b"], ["Painel", "#f3eee6"], ["Texto", "#1c1916"], ["Secundário", "#6d655c"], ["Linhas", "#cfc6b8"], ["Foco", "#8a5a2b"]] },
  light: { nome: "Claro", cores: [["Fundo", "#f1f1ef"], ["Barra", "#ffffff"], ["Painel", "#ffffff"], ["Texto", "#1c1916"], ["Secundário", "#66625c"], ["Linhas", "#dcdad5"], ["Foco", "#8a5a2b"]] },
  dark: { nome: "Escuro", cores: [["Fundo", "#1b1917"], ["Barra", "#0f0d0c"], ["Painel", "#201d1a"], ["Texto", "#ece6dc"], ["Secundário", "#a1988c"], ["Linhas", "#3a342e"], ["Foco", "#d29a5c"]] },
};

function palette() {
  const W = 1200;
  const col = 360;
  const sw = 44;
  const t = THEMES.light;
  let s = `<rect width="${W}" height="620" rx="16" fill="#ffffff"/>`;
  s += textPath(SEMI, "MARCA", 40, 56, 14, { tracking: 0.14, fill: t.muted }).svg;
  const marca = [["Vermelho de revisão", BRAND.red], ["Azul de seleção", BRAND.blue], ["Ocre", BRAND.ochre], ["Carvão", BRAND.ink], ["Papel", BRAND.paper]];
  marca.forEach(([n, c], i) => {
    const x = 40 + i * 228;
    s += `<rect x="${x}" y="74" width="${sw * 1.6}" height="${sw * 1.6}" rx="8" fill="${c}" stroke="#00000022"/>`;
    s += textPath(SEMI, n, x, 74 + sw * 1.6 + 26, 15, { fill: t.ink }).svg;
    s += textPath(REG, c.toUpperCase(), x, 74 + sw * 1.6 + 46, 14, { fill: t.muted }).svg;
  });
  ["sepia", "light", "dark"].forEach((th, k) => {
    const x0 = 40 + k * (col + 20);
    const y0 = 250;
    s += textPath(SEMI, UI[th].nome.toUpperCase(), x0, y0, 14, { tracking: 0.14, fill: t.muted }).svg;
    UI[th].cores.forEach(([n, c], i) => {
      const y = y0 + 20 + i * 48;
      s += `<rect x="${x0}" y="${y}" width="${sw}" height="${sw * 0.8}" rx="6" fill="${c}" stroke="#00000022"/>`;
      s += textPath(REG, n, x0 + sw + 14, y + 23, 15, { fill: t.ink }).svg;
      s += textPath(REG, c.toUpperCase(), x0 + 200, y + 23, 14, { fill: t.muted }).svg;
    });
  });
  return svgDoc(W, 620, s, ' role="img" aria-label="Paleta do LiminalPDF"');
}

/* ------------------------------------------------------------ escrita */

const write = (name, svg) => writeFileSync(join(out, name), svg);
const png = (svg, file, width) => {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
  writeFileSync(file, r.render().asPng());
};

const icon = svgDoc(1024, 1024, symbol());
write("simbolo.svg", icon);
write("simbolo-contorno-escuro.svg", glyph(BRAND.ink));
write("simbolo-contorno-claro.svg", glyph(BRAND.paper));
for (const th of ["sepia", "light", "dark"]) {
  write(`logo-${th}.svg`, horizontal(th));
  write(`wordmark-${th}.svg`, wordmarkOnly(th));
  write(`banner-${th}.svg`, banner(th));
}
write("paleta.svg", palette());
const soc = social();
write("social-preview.svg", soc);
png(soc, join(out, "social-preview.png"), 1280);
png(icon, join(out, "simbolo-512.png"), 512);
png(icon, join(out, "icone-1024.png"), 1024);
writeFileSync(join(root, "public", "favicon.svg"), icon);
console.log("identidade gerada em docs/brand/");
