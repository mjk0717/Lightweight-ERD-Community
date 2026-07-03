import { nextId, debounce } from './util';
import { AppData, Entity, Column, Relation, SystemColumnDef, SerializedState, Selection, SelectionType, DesignMode, LineStyle } from './types';

type EventName = 'change' | 'move' | 'select';
type Listener = () => void;

const listeners: Record<string, Listener[]> = {};

function on(evt: EventName, cb: Listener): void {
  (listeners[evt] = listeners[evt] || []).push(cb);
}
function off(evt: EventName, cb: Listener): void {
  if (listeners[evt]) listeners[evt] = listeners[evt].filter((f) => f !== cb);
}
function emit(evt: EventName): void {
  (listeners[evt] || []).slice().forEach((cb) => cb());
}

const data: AppData = {
  entities: [],
  relations: [],
  systemColumns: [],
  view: { scale: 1, x: 0, y: 0 },
  selected: null,
  selectedEntityIds: [],
  designMode: 'logical',
  lineStyle: 'curved',
  minimapVisible: true
};

const STORAGE_KEY = 'erd_tool_state_v1';

function persist(): void {
  try {
    const payload: SerializedState = {
      entities: data.entities,
      relations: data.relations,
      systemColumns: data.systemColumns,
      view: data.view,
      designMode: data.designMode,
      lineStyle: data.lineStyle,
      minimapVisible: data.minimapVisible
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // storage unavailable/full - non-fatal, editing still works this session
  }
}
const persistDebounced = debounce(persist, 400);

function notify(evt: EventName = 'change'): void {
  emit(evt);
  persistDebounced();
}

function load(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<SerializedState>;
    data.entities = parsed.entities || [];
    data.relations = parsed.relations || [];
    data.systemColumns = parsed.systemColumns || [];
    data.view = parsed.view || { scale: 1, x: 0, y: 0 };
    data.designMode = parsed.designMode || 'logical';
    data.lineStyle = parsed.lineStyle || 'curved';
    data.minimapVisible = parsed.minimapVisible !== false;
    return true;
  } catch (e) {
    return false;
  }
}

function replaceAll(next: Partial<SerializedState>): void {
  data.entities = next.entities || [];
  data.relations = next.relations || [];
  data.systemColumns = next.systemColumns || [];
  data.view = next.view || { scale: 1, x: 0, y: 0 };
  data.designMode = next.designMode || 'logical';
  data.lineStyle = next.lineStyle || 'curved';
  data.minimapVisible = next.minimapVisible !== false;
  // A loaded project's ids have nothing to do with the previous selection.
  data.selected = null;
  data.selectedEntityIds = [];
  notify('change');
}

function setDesignMode(mode: DesignMode): void {
  data.designMode = mode;
  notify('change');
}

function setLineStyle(lineStyle: LineStyle): void {
  data.lineStyle = lineStyle;
  notify('change');
}

function toggleMinimap(): void {
  data.minimapVisible = !data.minimapVisible;
  notify('change');
}

// ---- entities ----
function nextEntityPosition(): { x: number; y: number } {
  const n = data.entities.length;
  return { x: 60 + (n % 4) * 280, y: 60 + Math.floor(n / 4) * 240 };
}

function getEntity(id: string): Entity | undefined {
  return data.entities.find((e) => e.id === id);
}

function addEntity(entity: Entity): Entity {
  data.entities.push(entity);
  notify('change');
  return entity;
}

function updateEntity(id: string, patch: Partial<Entity>): void {
  const e = getEntity(id);
  if (!e) return;
  Object.assign(e, patch);
  notify('change');
}

function removeEntity(id: string): void {
  data.entities = data.entities.filter((e) => e.id !== id);
  data.relations = data.relations.filter((r) => r.sourceEntityId !== id && r.targetEntityId !== id);
  notify('change');
}

function moveEntity(id: string, x: number, y: number): void {
  const e = getEntity(id);
  if (!e) return;
  e.x = x;
  e.y = y;
  notify('move');
}

// Moves several entities at once, emitting a single 'move' so a group drag
// triggers one render pass instead of one per entity.
function moveEntities(moves: { id: string; x: number; y: number }[]): void {
  moves.forEach((m) => { const e = getEntity(m.id); if (e) { e.x = m.x; e.y = m.y; } });
  notify('move');
}

// ---- columns ----
function getColumn(entityId: string, colId: string): Column | null {
  const e = getEntity(entityId);
  if (!e) return null;
  return e.columns.find((c) => c.id === colId) || null;
}

function addColumn(entityId: string, column: Column): Column | null {
  const e = getEntity(entityId);
  if (!e) return null;
  if (column.isSystem) {
    e.columns.push(column);
  } else if (column.pk) {
    // A new PK column (e.g. the FK column of an identifying relationship)
    // joins the existing PK block, right below the table's other PK columns.
    let insertAt = 0;
    e.columns.forEach((c, i) => { if (c.pk) insertAt = i + 1; });
    e.columns.splice(insertAt, 0, column);
  } else {
    // Plain (non-PK) columns land above system columns, never mixed below them.
    const firstSystemIdx = e.columns.findIndex((c) => c.isSystem);
    if (firstSystemIdx === -1) e.columns.push(column);
    else e.columns.splice(firstSystemIdx, 0, column);
  }
  notify('change');
  return column;
}

function updateColumn(entityId: string, colId: string, patch: Partial<Column>): void {
  const c = getColumn(entityId, colId);
  if (!c) return;
  Object.assign(c, patch);
  notify('change');
}

function removeColumn(entityId: string, colId: string): void {
  const e = getEntity(entityId);
  if (!e) return;
  e.columns = e.columns.filter((c) => c.id !== colId);
  // Drop just the broken pair from each relation's composite key; if that
  // empties it out entirely, the relation itself no longer makes sense.
  data.relations = data.relations
    .map((r) => ({ ...r, columnPairs: r.columnPairs.filter((p) => p.sourceColumnId !== colId && p.targetColumnId !== colId) }))
    .filter((r) => r.columnPairs.length > 0);
  notify('change');
}

function reorderColumns(entityId: string, orderedIds: string[]): void {
  const e = getEntity(entityId);
  if (!e) return;
  const map = new Map(e.columns.map((c) => [c.id, c] as const));
  const next = orderedIds.map((id) => map.get(id)).filter((c): c is Column => !!c);
  e.columns.forEach((c) => { if (next.indexOf(c) === -1) next.push(c); });
  e.columns = next;
  notify('change');
}

// ---- relations ----
function getRelation(id: string): Relation | undefined {
  return data.relations.find((r) => r.id === id);
}
function addRelation(relation: Relation): Relation {
  data.relations.push(relation);
  notify('change');
  return relation;
}
function updateRelation(id: string, patch: Partial<Relation>): void {
  const r = getRelation(id);
  if (!r) return;
  Object.assign(r, patch);
  notify('change');
}
function removeRelation(id: string): void {
  data.relations = data.relations.filter((r) => r.id !== id);
  notify('change');
}
function relationExists(sourceColumnId: string, targetColumnId: string): boolean {
  return data.relations.some((r) => r.columnPairs.some((p) => p.sourceColumnId === sourceColumnId && p.targetColumnId === targetColumnId));
}

// True if some existing relation already links this exact set of column
// pairs (order-independent) - used to dedupe composite FK creation.
function relationExistsWithPairs(pairs: { sourceColumnId: string; targetColumnId: string }[]): boolean {
  const key = (p: { sourceColumnId: string; targetColumnId: string }) => p.sourceColumnId + '::' + p.targetColumnId;
  const candidateKeys = new Set(pairs.map(key));
  return data.relations.some((r) => {
    if (r.columnPairs.length !== pairs.length) return false;
    return r.columnPairs.every((p) => candidateKeys.has(key(p)));
  });
}

// ---- system columns ----
function applySystemColumnsToEntity(e: Entity): void {
  data.systemColumns.forEach((def) => {
    const col = e.columns.find((c) => c.systemColId === def.id);
    if (col) {
      col.name = def.name;
      col.dataType = def.dataType;
      col.comment = def.comment;
      col.defaultValue = def.defaultValue || '';
    } else {
      e.columns.push({
        id: nextId('col'), name: def.name, dataType: def.dataType, comment: def.comment,
        defaultValue: def.defaultValue || '',
        pk: false, fk: false, nullable: true, isSystem: true, systemColId: def.id
      });
    }
  });
}

function setSystemColumns(list: SystemColumnDef[]): void {
  const prevIds = data.systemColumns.map((c) => c.id);
  const nextIds: string[] = [];
  list.forEach((def) => {
    if (!def.id) def.id = nextId('sysdef');
    nextIds.push(def.id);
  });
  prevIds.forEach((id) => {
    if (nextIds.indexOf(id) === -1) {
      data.entities.forEach((e) => { e.columns = e.columns.filter((c) => c.systemColId !== id); });
    }
  });
  data.systemColumns = list;
  data.entities.forEach(applySystemColumnsToEntity);
  notify('change');
}

function select(type: SelectionType, id: string): void {
  data.selected = { type, id } as Selection;
  // Selecting a relation clears the entity multi-selection; selecting an
  // entity collapses it to just that one.
  data.selectedEntityIds = type === 'entity' ? [id] : [];
  emit('select');
}

// Ctrl/Cmd+click behavior: add the entity to the selection if not present,
// remove it if it already is. The primary `selected` follows the most
// recent still-selected entity so single-entity operations keep working.
function toggleEntitySelection(id: string): void {
  const idx = data.selectedEntityIds.indexOf(id);
  if (idx === -1) {
    data.selectedEntityIds.push(id);
    data.selected = { type: 'entity', id };
  } else {
    data.selectedEntityIds.splice(idx, 1);
    const last = data.selectedEntityIds[data.selectedEntityIds.length - 1];
    data.selected = last ? { type: 'entity', id: last } : null;
  }
  emit('select');
}

function isEntitySelected(id: string): boolean {
  return data.selectedEntityIds.indexOf(id) !== -1;
}

// Selects exactly the given entities (used after paste to select the copies).
function selectEntities(ids: string[]): void {
  data.selectedEntityIds = ids.slice();
  data.selected = ids.length ? { type: 'entity', id: ids[ids.length - 1] } : null;
  emit('select');
}

// Batch header-color change - used when a color is picked while several
// entities are multi-selected, so one click recolors them all.
function setHeaderColorForEntities(ids: string[], color: string): void {
  ids.forEach((id) => { const e = getEntity(id); if (e) e.headerColor = color; });
  notify('change');
}

function clearSelection(): void {
  data.selected = null;
  data.selectedEntityIds = [];
  emit('select');
}

export const state = {
  data,
  on, off, emit: notify, load, persist, replaceAll,
  select, clearSelection, toggleEntitySelection, isEntitySelected, selectEntities, setHeaderColorForEntities, setDesignMode, setLineStyle, toggleMinimap,
  nextEntityPosition,
  addEntity, getEntity, updateEntity, removeEntity, moveEntity, moveEntities,
  getColumn, addColumn, updateColumn, removeColumn, reorderColumns,
  addRelation, getRelation, updateRelation, removeRelation, relationExists, relationExistsWithPairs,
  setSystemColumns, applySystemColumnsToEntity
};
