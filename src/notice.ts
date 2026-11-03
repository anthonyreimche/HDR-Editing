// What the user is told when an HDR export falls back to the SDR file, or loses
// its metadata. An export processor can only return a file: the core has no way
// for it to say "this one didn't get HDR", and logs nothing a user would see. A
// small card in the corner of the window does, listing the photos of the
// running export that fell short. Styled with theme variables, as runtime bundles aren't
// scanned for Tailwind classes.

export interface Fallback {
  /** The photo's filename. */
  label: string;
  /** What happened to it, as a clause to follow the label. */
  problem: string;
}

export function describeFallbacks(entries: Fallback[]): string {
  const [first] = entries;
  if (entries.length === 1) return `${first.label} ${first.problem}`;
  return `${entries.length} photos didn't export as asked. First: ${first.label} ${first.problem}`;
}

/** An export starts a new tally once this long has passed since the last
 *  photo fell back. */
const SAME_EXPORT_MS = 5 * 60_000;

export interface FallbackBoard {
  add(label: string, problem: string): void;
  clear(): void;
}

/** Collects the photos that fell short during one export and shows the tally
 *  after each one. The processor is told about one photo at a time and not
 *  when an export begins, so a gap in time separates exports. */
export function createFallbackBoard(show: (message: string) => void, now: () => number = Date.now): FallbackBoard {
  let entries: Fallback[] = [];
  let last = 0;
  return {
    add(label, problem) {
      const t = now();
      if (t - last > SAME_EXPORT_MS) entries = [];
      last = t;
      entries.push({ label, problem });
      show(describeFallbacks(entries));
    },
    clear() {
      entries = [];
    },
  };
}

let root: HTMLDivElement | null = null;
let text: HTMLDivElement | null = null;

function ensureCard(): HTMLDivElement {
  if (root && document.body.contains(root)) return root;
  const card = document.createElement("div");
  card.setAttribute("data-hdr-editing-notice", "");
  card.setAttribute("role", "status");
  Object.assign(card.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483000",
    maxWidth: "340px",
    padding: "10px 26px 10px 12px",
    borderRadius: "6px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-1)",
    color: "var(--color-text-primary)",
    font: "11px/1.45 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  } satisfies Partial<CSSStyleDeclaration>);

  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "Dismiss";
  close.setAttribute("aria-label", "Dismiss");
  Object.assign(close.style, {
    position: "absolute",
    top: "4px",
    right: "6px",
    border: "none",
    background: "none",
    color: "var(--color-text-muted)",
    font: "10px/1 system-ui, sans-serif",
    cursor: "pointer",
    padding: "2px",
  } satisfies Partial<CSSStyleDeclaration>);
  close.addEventListener("click", () => {
    fallbackBoard.clear();
    card.style.display = "none";
  });

  // The message is selectable, so a reason can be copied into a bug report.
  text = document.createElement("div");
  text.style.userSelect = "text";
  card.append(close, text);
  document.body.appendChild(card);
  root = card;
  return card;
}

export function showNotice(message: string): void {
  const card = ensureCard();
  card.style.display = "block";
  if (text) text.textContent = message;
}

/** Removes the card (the extension is deactivating). */
export function disposeNotice(): void {
  fallbackBoard.clear();
  root?.remove();
  root = null;
  text = null;
}

export const fallbackBoard = createFallbackBoard(showNotice);
