import { state } from './state';
import { viewport } from './viewport';
import { nextId, closest, escapeHtml, clamp } from './util';
import { entityRenderer } from './entityRenderer';
import { relationRenderer } from './relationRenderer';
import { modalRelation } from './modalRelation';
import { modalEntity } from './modalEntity';
import { modal } from './modal';
import { theme } from './theme';
import { Cardinality, Column, FkPlan, Relation, RelationColumnPair } from './types';
import { DEFAULT_SOURCE_CARDINALITY, DEFAULT_TARGET_CARDINALITY } from './cardinality';

const DRAG_THRESHOLD = 4;

// Decides what the FK column on the source entity should look like without
// mutating anything, so both the commit path and the relation modal's
// preview text stay in sync. A column already acting as the source
// entity's own primary key is never repurposed as an FK - only a same-name
// non-PK column is reused; otherwise a new column is added, qualified with
// the target entity name if the plain target column name would collide.
function planFkColumn(sourceEntityId: string, targetColumn: Column, targetEntityName: string): FkPlan {
  const source = state.getEntity(sourceEntityId)!;
  const reusable = source.columns.find((c) => !c.pk && c.name.toUpperCase() === targetColumn.name.toUpperCase());
  if (reusable) return { isNew: false, name: reusable.name, existingId: reusable.id };
  let candidateName = targetColumn.name;
  const collides = source.columns.some((c) => c.name.toUpperCase() === candidateName.toUpperCase());
  if (collides) candidateName = targetEntityName + '_' + targetColumn.name;
  return { isNew: true, name: candidateName };
}

// Reuses an existing column as the relation's FK column as-is: only fk is
// set. Its current PK status decides identifying (already PK) vs
// non-identifying (not PK) - neither is forced - and it stays exactly where
// it already is, no repositioning. Shared by the auto find-or-create path
// and by explicitly picking an existing column in the create-relation modal.
function reuseColumnAsFk(sourceEntityId: string, colId: string): void {
  state.updateColumn(sourceEntityId, colId, { fk: true });
}

function findOrCreateFkColumn(sourceEntityId: string, targetColumn: Column, targetEntityName: string): string {
  const plan = planFkColumn(sourceEntityId, targetColumn, targetEntityName);
  if (!plan.isNew) {
    reuseColumnAsFk(sourceEntityId, plan.existingId!);
    return plan.existingId!;
  }
  const newCol: Column = {
    id: nextId('col'), name: plan.name, dataType: targetColumn.dataType,
    comment: 'FK -> ' + targetEntityName, pk: true, fk: true, nullable: false, isSystem: false, systemColId: null
  };
  state.addColumn(sourceEntityId, newCol);
  return newCol.id;
}

interface CommitOptions {
  sourceEntityId: string;
  targetEntityId: string;
  // One target (parent) column per FK column - more than one means a
  // composite (multi-column) FK.
  targetColumnIds: string[];
  name: string;
  logicalName?: string;
  sourceCardinality?: Cardinality;
  targetCardinality?: Cardinality;
  // When set for a given target column, use that specific existing child
  // column as its FK instead of the auto find-or-create-by-name logic (the
  // "specify" path in the create-relation modal, as opposed to "create new
  // column"). Keyed by targetColumnId.
  explicitSourceColumnIds?: Record<string, string>;
}

// Creates (or reuses) the FK column(s) on the source entity based on the
// chosen target column(s), then records the relation. Returns null if the
// exact same set of column pairs is already linked.
function commit(opts: CommitOptions): Relation | null {
  const targetEntity = state.getEntity(opts.targetEntityId);
  if (!targetEntity || !opts.targetColumnIds.length) return null;

  const pairs: RelationColumnPair[] = [];
  for (const targetColumnId of opts.targetColumnIds) {
    const targetColumn = state.getColumn(opts.targetEntityId, targetColumnId);
    if (!targetColumn) return null;
    const explicitSourceColumnId = opts.explicitSourceColumnIds && opts.explicitSourceColumnIds[targetColumnId];
    let sourceColumnId: string;
    if (explicitSourceColumnId) {
      reuseColumnAsFk(opts.sourceEntityId, explicitSourceColumnId);
      sourceColumnId = explicitSourceColumnId;
    } else {
      sourceColumnId = findOrCreateFkColumn(opts.sourceEntityId, targetColumn, targetEntity.name);
    }
    pairs.push({ sourceColumnId, targetColumnId });
  }

  if (state.relationExistsWithPairs(pairs)) return null;
  return state.addRelation({
    id: nextId('rel'),
    name: opts.name || '',
    logicalName: opts.logicalName || '',
    sourceEntityId: opts.sourceEntityId,
    targetEntityId: opts.targetEntityId,
    columnPairs: pairs,
    sourceCardinality: opts.sourceCardinality || DEFAULT_SOURCE_CARDINALITY,
    targetCardinality: opts.targetCardinality || DEFAULT_TARGET_CARDINALITY
  });
}

// Removes a relation. If none of its FK columns are shared with another
// relation, asks whether to also delete them from the child table or leave
// them behind as plain (non-FK) attributes. If any column IS shared, the
// relation is just unlinked and those columns are left untouched.
function remove(relationId: string): void {
  const relation = state.getRelation(relationId);
  if (!relation) return;
  const entId = relation.sourceEntityId;
  const colIds = relation.columnPairs.map((p) => p.sourceColumnId);
  const stillUsedByOthers = colIds.some((colId) =>
    state.data.relations.some((r) => r.id !== relationId && r.columnPairs.some((p) => p.sourceColumnId === colId))
  );

  if (stillUsedByOthers) {
    state.removeRelation(relationId);
    return;
  }

  const entity = state.getEntity(entId);
  const colNames = colIds.map((id) => state.getColumn(entId, id)).filter((c): c is Column => !!c).map((c) => c.name).join(', ');
  const plural = colIds.length > 1;
  const body = document.createElement('div');
  body.innerHTML = '<p>Remove this relation. What should happen to the column' + (plural ? 's' : '') + ' "' +
    escapeHtml(colNames) + '" on ' + escapeHtml(entity ? entity.name : '') + '?</p>';

  modal.open({
    title: 'Delete relation',
    body,
    actions: [
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Keep column' + (plural ? 's' : ''), onClick: () => {
        state.removeRelation(relationId);
        colIds.forEach((colId) => state.updateColumn(entId, colId, { fk: false }));
        modal.close();
      } },
      { label: 'Delete column' + (plural ? 's' : ''), variant: 'danger', onClick: () => {
        state.removeRelation(relationId);
        colIds.forEach((colId) => state.removeColumn(entId, colId));
        modal.close();
      } }
    ]
  });
}

// Starting a relation drag no longer requires grabbing a specific column
// row - anywhere on the entity's body works. The row nearest the pointer is
// only used as a visual anchor for the temp line; which column(s) actually
// become the FK is decided entirely in the create-relation modal.
function start(entityId: string, startEvent: MouseEvent): void {
  const box = entityRenderer.getEntityBox(entityId);
  const entity = state.getEntity(entityId);
  if (!box || !entity) return;

  const maxRowIdx = Math.max(entity.columns.length - 1, 0);

  // Not pinned to whichever row you happened to grab - the anchor follows
  // the pointer's current vertical position for the whole drag (still
  // clamped to the entity's row range), so the start point can be dragged
  // freely instead of being locked to the initial click.
  function anchorYFor(worldY: number): number {
    const rowIdx = clamp(Math.floor((worldY - box!.y - theme.headerHeight) / theme.rowHeight), 0, maxRowIdx);
    return box!.y + theme.headerHeight + rowIdx * theme.rowHeight + theme.rowHeight / 2;
  }

  const startClient = { x: startEvent.clientX, y: startEvent.clientY };
  let dragging = false;

  function onMove(ev: MouseEvent): void {
    if (!dragging) {
      const dx = ev.clientX - startClient.x, dy = ev.clientY - startClient.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging = true;
    }
    const mouseWorld = viewport.screenToWorld(ev.clientX, ev.clientY);
    const side = mouseWorld.x >= box!.x + box!.w / 2 ? 'right' : 'left';
    const anchor = { x: side === 'right' ? box!.x + box!.w : box!.x, y: anchorYFor(mouseWorld.y) };
    relationRenderer.setTempLine(anchor, mouseWorld);
  }

  function onUp(ev: MouseEvent): void {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    relationRenderer.clearTempLine();

    if (!dragging) {
      // A plain click on the body (no real drag) opens the table details
      // instead of misfiring a self-relation.
      modalEntity.open(entityId);
      return;
    }

    const targetEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const entityNode = targetEl && closest(targetEl, (el) => el.classList && el.classList.contains('entity'));
    if (!entityNode) return;
    // Dragging goes parent -> child: the entity you start on is the "one"
    // side being referenced, the entity you drop onto is the "many" side
    // that receives the FK column(s).
    const droppedEntityId = entityNode.dataset.entityId!;
    modalRelation.openCreate(droppedEntityId, entityId);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export const relationInteraction = { start, commit, planFkColumn, remove };
