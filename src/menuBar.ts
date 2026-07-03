import { state } from './state';
import { jsonIO } from './jsonIO';
import { ddlImport } from './ddlImport';
import { exportWizard } from './exportWizard';
import { modalSystemColumns } from './modalSystemColumns';
import { viewport } from './viewport';
import { history } from './history';

// VS Code-style top menu bar: a row of menu titles that open dropdowns
// (Project / Edit / View) plus a couple of direct-action titles that fire
// immediately with no dropdown (Import / Export). Item shortcuts render in
// gray on the right, disabled/checked states are evaluated fresh each time a
// dropdown opens (so undo/redo availability and the current view mode are
// always accurate without any live re-sync).

interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
  disabled?: () => boolean;
  checked?: () => boolean;
}

interface MenuEntry {
  title: string;
  items?: MenuItem[];   // dropdown menu
  onClick?: () => void;  // direct-action title (no dropdown)
}

let barEl: HTMLElement;
let openState: { entry: MenuEntry; trigger: HTMLElement; panel: HTMLElement } | null = null;

const MENUS: MenuEntry[] = [
  {
    title: 'Project',
    items: [
      { label: 'Open…', onClick: () => jsonIO.importJson() },
      { label: 'Save', onClick: () => jsonIO.exportJson() },
      { separator: true },
      { label: 'Close', onClick: closeProject }
    ]
  },
  {
    title: 'Edit',
    items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: () => !history.canUndo(), onClick: () => history.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: () => !history.canRedo(), onClick: () => history.redo() },
      { separator: true },
      { label: 'System columns', onClick: () => modalSystemColumns.open() }
    ]
  },
  {
    title: 'View',
    items: [
      { label: 'Logical', checked: () => state.data.designMode === 'logical', onClick: () => state.setDesignMode('logical') },
      { label: 'Physical', checked: () => state.data.designMode === 'physical', onClick: () => state.setDesignMode('physical') },
      { separator: true },
      { label: 'Reset view', onClick: () => viewport.resetView() },
      { separator: true },
      { label: 'Curved lines', checked: () => state.data.lineStyle === 'curved', onClick: () => state.setLineStyle('curved') },
      { label: 'Angular lines', checked: () => state.data.lineStyle === 'angular', onClick: () => state.setLineStyle('angular') }
    ]
  },
  { title: 'Import', onClick: () => ddlImport.open() },
  { title: 'Export', onClick: () => exportWizard.open() }
];

function closeProject(): void {
  if (!state.data.entities.length && !state.data.relations.length) return;
  if (!window.confirm('Close the current project? All tables and relations will be removed. System column definitions are kept.')) return;
  state.data.entities = [];
  state.data.relations = [];
  state.clearSelection();
  state.emit('change');
}

function closeMenu(): void {
  if (!openState) return;
  openState.panel.remove();
  openState.trigger.classList.remove('menu-title-open');
  openState = null;
  document.removeEventListener('mousedown', onOutside);
  document.removeEventListener('keydown', onKeydown);
}

function onOutside(e: MouseEvent): void {
  if (!openState) return;
  if (openState.panel.contains(e.target as Node) || openState.trigger.contains(e.target as Node)) return;
  closeMenu();
}
function onKeydown(e: KeyboardEvent): void { if (e.key === 'Escape') closeMenu(); }

function buildPanel(entry: MenuEntry): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'menu-dropdown';
  (entry.items || []).forEach((item) => {
    if (item.separator) { panel.appendChild(document.createElement('div')).className = 'menu-dropdown-sep'; return; }
    const btn = document.createElement('button');
    btn.type = 'button';
    const disabled = item.disabled ? item.disabled() : false;
    btn.className = 'menu-dropdown-item' + (disabled ? ' disabled' : '');
    const checked = item.checked ? item.checked() : false;
    btn.innerHTML =
      '<span class="menu-item-check">' + (checked ? '✓' : '') + '</span>' +
      '<span class="menu-item-label"></span>' +
      '<span class="menu-item-shortcut">' + (item.shortcut || '') + '</span>';
    (btn.querySelector('.menu-item-label') as HTMLElement).textContent = item.label || '';
    if (!disabled && item.onClick) {
      btn.addEventListener('click', () => { const fn = item.onClick!; closeMenu(); fn(); });
    }
    panel.appendChild(btn);
  });
  return panel;
}

function openDropdown(entry: MenuEntry, trigger: HTMLElement): void {
  closeMenu();
  const panel = buildPanel(entry);
  const rect = trigger.getBoundingClientRect();
  panel.style.left = rect.left + 'px';
  panel.style.top = rect.bottom + 'px';
  document.body.appendChild(panel);
  trigger.classList.add('menu-title-open');
  openState = { entry, trigger, panel };
  // Defer so the click that opened it doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKeydown);
  }, 0);
}

function init(): void {
  barEl = document.getElementById('menu-bar')!;
  if (!barEl) return;
  MENUS.forEach((entry) => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'menu-title';
    trigger.textContent = entry.title;
    if (entry.items) {
      trigger.addEventListener('click', () => {
        if (openState && openState.entry === entry) { closeMenu(); return; }
        openDropdown(entry, trigger);
      });
      // Once any dropdown is open, hovering another title switches to it -
      // the standard menu-bar behavior.
      trigger.addEventListener('mouseenter', () => { if (openState && openState.entry !== entry) openDropdown(entry, trigger); });
    } else {
      trigger.classList.add('menu-title-action');
      trigger.addEventListener('click', () => { closeMenu(); entry.onClick && entry.onClick(); });
    }
    barEl.appendChild(trigger);
  });
}

export const menuBar = { init };
