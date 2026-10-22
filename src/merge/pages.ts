/**
 * Seleção de páginas em texto, no formato que se digita numa impressora:
 *   "1-5, 7, 9"   "45-66"   "4, 6, 8, 92"   "10-fim"   "5-1" (ordem inversa)
 * Vazio = todas. A ordem digitada é respeitada e repetições são permitidas.
 */

export interface PageSpec {
  /** Páginas (base 1) na ordem em que entram no PDF final. */
  pages: number[];
  /** Mensagens de erro legíveis; se houver, `pages` traz só o que foi válido. */
  errors: string[];
}

const LAST = /^(fim|f|última|ultima|ult|\$|end|last)$/i;

function num(tok: string, count: number): number | null {
  const t = tok.trim();
  if (LAST.test(t)) return count;
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

export function parsePages(spec: string, count: number): PageSpec {
  const pages: number[] = [];
  const errors: string[] = [];
  const text = spec.trim();
  if (!text || /^(todas|tudo|all|\*)$/i.test(text)) {
    for (let i = 1; i <= count; i++) pages.push(i);
    return { pages, errors };
  }
  const norm = text.replace(/\s*[-–]\s*/g, "-");
  for (const raw of norm.split(/[,;\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^([^-]+)-([^-]+)$/);
    if (m) {
      const a = num(m[1], count);
      const b = num(m[2], count);
      if (a == null || b == null) {
        errors.push(`"${part}" não é um intervalo válido`);
        continue;
      }
      const bad = [a, b].filter((n) => n < 1 || n > count);
      if (bad.length) {
        errors.push(outOfRange(bad[0], count));
        continue;
      }
      const step = a <= b ? 1 : -1;
      for (let i = a; i !== b + step; i += step) pages.push(i);
      continue;
    }
    if (part.startsWith("-") || part.endsWith("-")) {
      errors.push(`"${part}" é um intervalo incompleto`);
      continue;
    }
    const n = num(part, count);
    if (n == null) {
      errors.push(`"${part}" não é um número de página`);
    } else if (n < 1 || n > count) {
      errors.push(outOfRange(n, count));
    } else {
      pages.push(n);
    }
  }
  return { pages, errors };
}

function outOfRange(n: number, count: number): string {
  return n < 1
    ? "as páginas começam em 1"
    : `a página ${n} não existe (o arquivo tem ${count})`;
}

/** Converte uma lista em texto compacto: [1,2,3,5,9,8,7] → "1-3, 5, 9-7". */
export function formatPages(pages: number[], count: number): string {
  if (count > 0 && pages.length === count && pages.every((p, i) => p === i + 1)) {
    return "";
  }
  const out: string[] = [];
  let i = 0;
  while (i < pages.length) {
    const start = pages[i];
    let j = i;
    const dir = pages[i + 1] - start;
    if (dir === 1 || dir === -1) {
      while (j + 1 < pages.length && pages[j + 1] - pages[j] === dir) j++;
    }
    const end = pages[j];
    if (j - i >= 2) out.push(`${start}-${end}`);
    else for (let k = i; k <= j; k++) out.push(String(pages[k]));
    i = j + 1;
  }
  return out.join(", ");
}
