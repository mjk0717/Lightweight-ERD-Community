import { nextId, debounce } from './util';
import { AppData, Entity, Column, Relation, SystemColumnDef, SerializedState, Selection, SelectionType } from './types';

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
  selected: null
};

const STORAGE_KEY = 'erd_tool_state_v1';

function persist(): void {
  try {
    const payload: SerializedState = {
      entities: data.entities,
      relations: data.relations,
      systemColumns: data.systemColumns,
      view: data.view
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

// ---- columns ----
function getColumn(entityId: string, colId: string): Column | null {
  const e = getEntity(entityId);
  if (!e) return null;
  return e.columns.find((c) => c.id === colId) || null;
}

function addColumn(entityId: string, column: Column): Column | null {
  const e = getEntity(entityId);
  if (!e) return null;
  e.columns.push(column);
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
  data.relations = data.relations.filter((r) => r.sourceColumnId !== colId && r.targetColumnId !== colId);
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
  return data.relations.some((r) => r.sourceColumnId === sourceColumnId && r.targetColumnId === targetColumnId);
}

// ---- system columns ----
function applySystemColumnsToEntity(e: Entity): void {
  data.systemColumns.forEach((def) => {
    const col = e.columns.find((c) => c.systemColId === def.id);
    if (col) {
      col.name = def.name;
      col.dataType = def.dataType;
      col.comment = def.comment;
    } else {
      e.columns.push({
        id: nextId('col'), name: def.name, dataType: def.dataType, comment: def.comment,
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
  emit('select');
}
function clearSelection(): void {
  data.selected = null;
  emit('select');
}

export const state = {
  data,
  on, off, emit: notify, load, persist, replaceAll,
  select, clearSelection,
  nextEntityPosition,
  addEntity, getEntity, updateEntity, removeEntity, moveEntity,
  getColumn, addColumn, updateColumn, removeColumn, reorderColumns,
  addRelation, getRelation, updateRelation, removeRelation, relationExists,
  setSystemColumns, applySystemColumnsToEntity
};
