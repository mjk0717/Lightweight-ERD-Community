import { state } from './state';
import { modal } from './modal';
import { escapeHtml } from './util';
import { relationInteraction } from './relationInteraction';
import { Column, Entity } from './types';

function pkOrFirst(entity: Entity): Column | null {
  return entity.columns.find((c) => c.pk) || entity.columns[0] || null;
}

function columnListHtml(entity: Entity): string {
  if (!entity.columns.length) return '<div class="hint">(no columns)</div>';
  return '<ul class="col-ref-list">' + entity.columns.map((c) => {
    const flag = c.pk ? 'PK' : (c.fk ? 'FK' : '');
    return '<li>' + (flag ? '<b>' + flag + '</b> ' : '') + escapeHtml(c.name) + ' <span class="hint">' + escapeHtml(c.dataType) + '</span></li>';
  }).join('') + '</ul>';
}

function previewText(sourceEntity: Entity, targetColumn: Column | null, targetEntityName: string): string {
  if (!targetColumn) return '';
  const plan = relationInteraction.planFkColumn(sourceEntity.id, targetColumn, targetEntityName);
  if (!plan.isNew) return 'Existing column "' + plan.name + '" on ' + sourceEntity.name + ' will be marked as FK.';
  return 'New FK column "' + plan.name + '" (' + targetColumn.dataType + ') will be added to ' + sourceEntity.name + '.';
}

function openCreate(sourceEntityId: string, targetEntityId: string): void {
  const sourceEntity = state.getEntity(sourceEntityId);
  const targetEntity = state.getEntity(targetEntityId);
  if (!sourceEntity || !targetEntity) return;
  if (!targetEntity.columns.length) {
    window.alert(targetEntity.name + ' has no columns to reference.');
    return;
  }

  const body = document.createElement('div');
  const defaultTarget = pkOrFirst(targetEntity);
  body.innerHTML =
    '<div class="rel-modal-grid">' +
      '<div><h4>' + escapeHtml(sourceEntity.name) + ' <span class="hint">(many)</span></h4>' + columnListHtml(sourceEntity) + '</div>' +
      '<div><h4>' + escapeHtml(targetEntity.name) + ' <span class="hint">(one)</span></h4>' +
        '<label>Referenced column<br><select class="f-target-col"></select></label>' +
      '</div>' +
    '</div>' +
    '<div class="rel-preview"></div>' +
    '<label>Relation name (optional)<br><input type="text" class="f-rel-name" placeholder="e.g. FK_ORDER_CUSTOMER"></label>';

  const select = body.querySelector('.f-target-col') as HTMLSelectElement;
  targetEntity.columns.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.pk ? ' (PK)' : '') + ' - ' + c.dataType;
    select.appendChild(opt);
  });
  if (defaultTarget) select.value = defaultTarget.id;

  const previewEl = body.querySelector('.rel-preview') as HTMLElement;
  function updatePreview(): void {
    const col = targetEntity!.columns.find((c) => c.id === select.value) || null;
    previewEl.textContent = previewText(sourceEntity!, col, targetEntity!.name);
  }
  select.addEventListener('change', updatePreview);
  updatePreview();

  modal.open({
    title: 'New relation',
    width: '620px',
    body,
    actions: [
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Create relation', variant: 'primary', onClick: () => {
        const name = (body.querySelector('.f-rel-name') as HTMLInputElement).value.trim();
        relationInteraction.commit({
          sourceEntityId,
          targetEntityId,
          targetColumnId: select.value,
          name
        });
        modal.close();
      } }
    ]
  });
}

function openEdit(relationId: string): void {
  const relation = state.getRelation(relationId);
  if (!relation) return;
  const sourceEntity = state.getEntity(relation.sourceEntityId);
  const targetEntity = state.getEntity(relation.targetEntityId);
  if (!sourceEntity || !targetEntity) return;

  const body = document.createElement('div');
  body.innerHTML =
    '<div class="rel-modal-grid">' +
      '<div><h4>' + escapeHtml(sourceEntity.name) + ' <span class="hint">(many)</span></h4>' + columnListHtml(sourceEntity) + '</div>' +
      '<div><h4>' + escapeHtml(targetEntity.name) + ' <span class="hint">(one)</span></h4>' + columnListHtml(targetEntity) + '</div>' +
    '</div>' +
    '<label>Relation name (optional)<br><input type="text" class="f-rel-name" value="' + escapeHtml(relation.name || '') + '"></label>';

  modal.open({
    title: 'Edit relation',
    width: '620px',
    body,
    actions: [
      { label: 'Delete relation', variant: 'danger', onClick: () => {
        const colId = relation.sourceColumnId, entId = relation.sourceEntityId;
        state.removeRelation(relationId);
        const stillUsed = state.data.relations.some((r) => r.sourceColumnId === colId);
        if (!stillUsed) state.updateColumn(entId, colId, { fk: false });
        modal.close();
      } },
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Save', variant: 'primary', onClick: () => {
        state.updateRelation(relationId, { name: (body.querySelector('.f-rel-name') as HTMLInputElement).value.trim() });
        modal.close();
      } }
    ]
  });
}

export const modalRelation = { openCreate, openEdit };
