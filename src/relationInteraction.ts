import { state } from './state';
import { viewport } from './viewport';
import { nextId, closest, escapeHtml } from './util';
import { entityRenderer } from './entityRenderer';
import { relationRenderer } from './relationRenderer';
import { modalRelation } from './modalRelation';
import { modalEntity } from './modalEntity';
import { modal } from './modal';
import { Cardinality, Column, FkPlan, Relation } from './types';
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

function findOrCreateFkColumn(sourceEntityId: string, targetColumn: Column, targetEntityName: string): string {
  const plan = planFkColumn(sourceEntityId, targetColumn, targetEntityName);
  if (!plan.isNew) {
    state.updateColumn(sourceEntityId, plan.existingId!, { fk: true });
    return plan.existingId!;
  }
  const newCol: Column = {
    id: nextId('col'), name: plan.name, dataType: targetColumn.dataType,
    comment: 'FK -> ' + targetEntityName, pk: false, fk: true, nullable: true, isSystem: false, systemColId: null
  };
  state.addColumn(sourceEntityId, newCol);
  return newCol.id;
}

interface CommitOptions {
  sourceEntityId: string;
  targetEntityId: string;
  targetColumnId: string;
  name: string;
  logicalName?: string;
  sourceCardinality?: Cardinality;
  targetCardinality?: Cardinality;
}

// Creates (or reuses) the FK column on the source entity based on the
// chosen target column, then records the relation. Returns null if the
// exact same source/target column pair is already linked.
function commit(opts: CommitOptions): Relation | null {
  const targetEntity = state.getEntity(opts.targetEntityId);
  const targetColumn = state.getColumn(opts.targetEntityId, opts.targetColumnId);
  if (!targetEntity || !targetColumn) return null;
  const sourceColumnId = findOrCreateFkColumn(opts.sourceEntityId, targetColumn, targetEntity.name);
  if (state.relationExists(sourceColumnId, opts.targetColumnId)) return null;
  return state.addRelation({
    id: nextId('rel'),
    name: opts.name || '',
    logicalName: opts.logicalName || '',
    sourceEntityId: opts.sourceEntityId,
    sourceColumnId,
    targetEntityId: opts.targetEntityId,
    targetColumnId: opts.targetColumnId,
    sourceCardinality: opts.sourceCardinality || DEFAULT_SOURCE_CARDINALITY,
    targetCardinality: opts.targetCardinality || DEFAULT_TARGET_CARDINALITY
  });
}

// Removes a relation. If its FK column isn't shared with another relation,
// asks whether to also delete that column from the child table or leave it
// behind as a plain (non-FK) attribute.
function remove(relationId: string): void {
  const relation = state.getRelation(relationId);
  if (!relation) return;
  const colId = relation.sourceColumnId, entId = relation.sourceEntityId;
  const stillUsedByOthers = state.data.relations.some((r) => r.id !== relationId && r.sourceColumnId === colId);

  if (stillUsedByOthers) {
    state.removeRelation(relationId);
    return;
  }

  const col = state.getColumn(entId, colId);
  const entity = state.getEntity(entId);
  const body = document.createElement('div');
  body.innerHTML = '<p>Remove this relation. What should happen to the column "' +
    escapeHtml(col ? col.name : '') + '" on ' + escapeHtml(entity ? entity.name : '') + '?</p>';

  modal.open({
    title: 'Delete relation',
    body,
    actions: [
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Keep column', onClick: () => {
        state.removeRelation(relationId);
        state.updateColumn(entId, colId, { fk: false });
        modal.close();
      } },
      { label: 'Delete column', variant: 'danger', onClick: () => {
        state.removeRelation(relationId);
        state.removeColumn(entId, colId);
        modal.close();
      } }
    ]
  });
}

function start(entityId: string, colId: string, startEvent: MouseEvent): void {
  const box = entityRenderer.getEntityBox(entityId);
  const rowCenter = entityRenderer.getColumnRowCenter(entityId, colId);
  if (!box || !rowCenter) return;

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
    const anchor = { x: side === 'right' ? box!.x + box!.w : box!.x, y: rowCenter!.y };
    relationRenderer.setTempLine(anchor, mouseWorld);
  }

  function onUp(ev: MouseEvent): void {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    relationRenderer.clearTempLine();

    if (!dragging) {
      // A plain click on the body (no real drag) opens the table details
      // instead of misfiring a relation-create modal against itself.
      modalEntity.open(entityId);
      return;
    }

    const targetEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const entityNode = targetEl && closest(targetEl, (el) => el.classList && el.classList.contains('entity'));
    if (!entityNode) return;
    // Dragging goes parent -> child: the entity you start on is the "one"
    // side being referenced, the entity you drop onto is the "many" side
    // that receives the FK column.
    const droppedEntityId = entityNode.dataset.entityId!;
    modalRelation.openCreate(droppedEntityId, entityId);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export const relationInteraction = { start, commit, planFkColumn, remove };
