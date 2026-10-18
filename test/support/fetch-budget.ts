// Static per-pixel texture-fetch count of a GLSL block: loops with literal
// bounds multiply the fetches inside them, helper calls are expanded, every
// branch is counted (an upper bound), and a loop form the analyser does not
// understand throws instead of being skipped. Correctness tests on a CPU
// transcription say nothing about what the GPU executes per draw, and
// per-draw cost is what hang watchdogs act on.

type Memo = Map<string, number | null>;

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function closingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces");
}

function collectFunctions(src: string): Map<string, string> {
  const fns = new Map<string, string>();
  const def = /\b(?:float|int|bool|vec[234]|ivec[234]|mat[34]|void)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = def.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(src, open);
    fns.set(m[1], src.slice(open + 1, close));
    def.lastIndex = close;
  }
  return fns;
}

const LOOP =
  /\bfor\s*\(\s*int\s+(\w+)\s*=\s*(-?\d+)\s*;\s*\1\s*(<=|<)\s*(-?\d+)\s*;\s*\1\s*(?:\+\+|\+=\s*1)\s*\)\s*\{/g;

function functionFetches(name: string, fns: Map<string, string>, memo: Memo): number {
  const seen = memo.get(name);
  if (seen === null) throw new Error(`recursive helper ${name}`);
  if (seen !== undefined) return seen;
  memo.set(name, null);
  const v = blockFetches(fns.get(name) ?? "", fns, memo);
  memo.set(name, v);
  return v;
}

function flatFetches(text: string, fns: Map<string, string>, memo: Memo): number {
  if (/\b(for|while|do)\b/.test(text)) {
    throw new Error(`unrecognised loop form: ${text.trim().slice(0, 80)}`);
  }
  let n = (text.match(/\b(?:texture|texelFetch|readPrev)\s*\(/g) ?? []).length;
  for (const name of fns.keys()) {
    const calls = (text.match(new RegExp(`\\b${name}\\s*\\(`, "g")) ?? []).length;
    if (calls) n += calls * functionFetches(name, fns, memo);
  }
  return n;
}

function blockFetches(block: string, fns: Map<string, string>, memo: Memo): number {
  let total = 0;
  let cursor = 0;
  const loop = new RegExp(LOOP.source, "g");
  let m: RegExpExecArray | null;
  while ((m = loop.exec(block))) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(block, open);
    total += flatFetches(block.slice(cursor, m.index), fns, memo);
    const from = Number(m[2]);
    const to = Number(m[4]);
    const trips = Math.max(0, m[3] === "<=" ? to - from + 1 : to - from);
    total += trips * blockFetches(block.slice(open + 1, close), fns, memo);
    cursor = close + 1;
    loop.lastIndex = cursor;
  }
  return total + flatFetches(block.slice(cursor), fns, memo);
}

/** Fetches per pixel of one draw of a pass, including the host's own
 *  `vec3 c = readPrev(vUv)`. */
export function fetchBudget(glsl: string, helpers: string): number {
  return 1 + blockFetches(stripComments(glsl), collectFunctions(stripComments(helpers)), new Map());
}

/** Fetches per pixel of an inline block (the host's own stageResult prelude
 *  fetch not included). */
export function inlineFetches(glsl: string, helpers: string): number {
  return blockFetches(stripComments(glsl), collectFunctions(stripComments(helpers)), new Map());
}
