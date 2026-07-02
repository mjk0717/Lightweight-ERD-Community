import { state } from './state';
import { downloadText, readFileAsText } from './util';
import { SerializedState } from './types';

let fileInput: HTMLInputElement | null = null;

function exportJson(): void {
  const data = state.data;
  const payload: SerializedState = {
    entities: data.entities, relations: data.relations, systemColumns: data.systemColumns, view: data.view
  };
  downloadText(JSON.stringify(payload, null, 2), 'erd-diagram.json', 'application/json');
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

export const jsonIO = { exportJson, importJson };
