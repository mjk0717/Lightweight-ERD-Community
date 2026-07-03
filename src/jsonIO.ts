import { state } from './state';
import { history } from './history';
import { downloadText, readFileAsText } from './util';
import { SerializedState } from './types';

let fileInput: HTMLInputElement | null = null;

// The File System Access API (showSaveFilePicker) is what lets the user
// choose the exact save location/filename via the OS "Save As" dialog. It's
// only present in a secure context on supporting browsers - notably absent
// when the app is opened straight from file:// - so this is feature-detected
// with a plain download as the fallback.
async function exportJson(): Promise<void> {
  const data = state.data;
  const payload: SerializedState = {
    entities: data.entities, relations: data.relations, systemColumns: data.systemColumns, view: data.view,
    designMode: data.designMode, lineStyle: data.lineStyle, minimapVisible: data.minimapVisible,
    history: history.exportHistory()
  };
  const text = JSON.stringify(payload, null, 2);

  const picker = (window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: 'erd-diagram.json',
        types: [{ description: 'ERD diagram (JSON)', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (e) {
      // The user dismissing the dialog throws AbortError - that's a normal
      // cancel, not an error to fall back from.
      if ((e as { name?: string }).name === 'AbortError') return;
      // Anything else (e.g. permission/quirk) falls through to the download.
    }
  }
  downloadText(text, 'erd-diagram.json', 'application/json');
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

function ensureFileInput(): HTMLInputElement {
  if (fileInput) return fileInput;
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput!.files && fileInput!.files[0];
    if (!file) return;
    readFileAsText(file).then((text) => {
      try {
        const parsed = JSON.parse(text) as Partial<SerializedState>;
        state.replaceAll(parsed);
        // Restore the saved undo/redo stack (or reset to a single checkpoint
        // of the loaded document when the file carries none). Must run after
        // replaceAll, which is what put the document into state.
        history.importHistory(parsed.history);
      } catch (e) {
        window.alert('Could not read that file as ERD JSON: ' + (e as Error).message);
      }
      fileInput!.value = '';
    });
  });
  document.body.appendChild(fileInput);
  return fileInput;
}

function importJson(): void {
  ensureFileInput().click();
}

// Fingerprint of the last auto-loaded erd-diagram.json. Auto-load only
// replaces the working state when the sidecar file is new or its content
// changed - a plain refresh with the same file keeps the user's in-progress
// (localStorage) edits instead of clobbering them with the older file.
const AUTOLOAD_KEY = 'erd_tool_autoload_v1';

function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h + ':' + text.length;
}

// Best-effort startup import of an erd-diagram.json sitting next to
// index.html. Works when the app is served over http(s); browsers block
// reading sibling files from a plain file:// page, in which case the fetch
// throws and this silently no-ops.
async function autoLoad(): Promise<void> {
  let text: string;
  try {
    const res = await fetch('erd-diagram.json', { cache: 'no-store' });
    if (!res.ok) return;
    text = await res.text();
  } catch (e) {
    return; // no file, or file:// fetch blocked - nothing to auto-load
  }
  try {
    const fp = fingerprint(text);
    if (localStorage.getItem(AUTOLOAD_KEY) === fp) return;
    const parsed = JSON.parse(text) as Partial<SerializedState>;
    state.replaceAll(parsed);
    history.importHistory(parsed.history);
    localStorage.setItem(AUTOLOAD_KEY, fp);
  } catch (e) {
    // Malformed sidecar file - leave the current diagram untouched.
  }
}

export const jsonIO = { exportJson, importJson, autoLoad };
