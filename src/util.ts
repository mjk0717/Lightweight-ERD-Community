let idCounter = 0;

export function nextId(prefix: string): string {
  idCounter += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + idCounter.toString(36);
}

export function escapeHtml(str: unknown): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => map[c]);
}

export function debounce<F extends (...args: any[]) => void>(fn: F, wait: number): (...args: Parameters<F>) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return function (this: unknown, ...args: Parameters<F>) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function closest(el: HTMLElement | null, predicate: (el: HTMLElement) => boolean): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (predicate(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadText(text: string, filename: string, mime?: string): void {
  const blob = new Blob([text], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable - user can still select the text manually */ }
  document.body.removeChild(ta);
}

export function copyToClipboard(text: string): void {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

export const ORACLE_TYPES: string[] = [
  'VARCHAR2(50)', 'VARCHAR2(100)', 'VARCHAR2(200)', 'VARCHAR2(4000)',
  'NUMBER', 'NUMBER(10)', 'NUMBER(10,2)', 'NUMBER(1)',
  'CHAR(1)', 'DATE', 'TIMESTAMP', 'CLOB', 'BLOB', 'INTEGER', 'FLOAT', 'RAW(16)', 'NVARCHAR2(100)'
];

// Vendor-neutral ANSI/ISO SQL types, offered in Logical mode where the model
// isn't yet tied to a specific database product.
export const ANSI_TYPES: string[] = [
  'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(200)', 'VARCHAR(4000)',
  'CHARACTER VARYING(255)', 'CHAR(1)', 'NCHAR(1)', 'NVARCHAR(100)',
  'INTEGER', 'SMALLINT', 'BIGINT', 'NUMERIC', 'NUMERIC(10)', 'NUMERIC(10,2)', 'DECIMAL(10,2)',
  'FLOAT', 'REAL', 'DOUBLE PRECISION',
  'BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE',
  'CLOB', 'BLOB'
];

// Column data-type autocomplete suggestions for the current design mode:
// ANSI standard types while modeling logically, physical Oracle types once in
// Physical mode.
export function dataTypeSuggestions(mode: string): string[] {
  return mode === 'logical' ? ANSI_TYPES : ORACLE_TYPES;
}
