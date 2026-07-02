import { state } from './state';
import { modal } from './modal';
import { escapeHtml } from './util';
import { relationInteraction } from './relationInteraction';
import { CARDINALITY_OPTIONS, DEFAULT_SOURCE_CARDINALITY, DEFAULT_TARGET_CARDINALITY, sourceCardinalityOf, targetCardinalityOf } from './cardinality';
import { Cardinality, Column, Entity } from './types';

function cardinalitySelectHtml(className: string, selected: Cardinality): string {
  const options = CARDINALITY_OPTIONS.map((o) =>
    '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>' + o.label + '</option>'
  ).join('');
  return '<label>Cardinality<br><select class="' + className + '">' + options + '</select></label>';
}

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
      '<div><h4>' + escapeHtml(targetEntity.name) + ' <span class="hint">(one)</span></h4>' +
        '<label>Referenced column<br><select class="f-target-col"></select></label>' +
        cardinalitySelectHtml('f-target-card', DEFAULT_TARGET_CARDINALITY) +
      '</div>' +
      '<div><h4>' + escapeHtml(sourceEntity.name) + ' <span class="hint">(many)</span></h4>' + columnListHtml(sourceEntity) +
        cardinalitySelectHtml('f-source-card', DEFAULT_SOURCE_CARDINALITY) +
      '</div>' +
    '</div>' +
    '<div class="rel-preview"></div>' +
    '<label>Relation name - physical (optional)<br><input type="text" class="f-rel-name" placeholder="e.g. FK_ORDER_CUSTOMER"></label>' +
    '<label>Relation name - logical (optional)<br><input type="text" class="f-rel-logical-name" placeholder="e.g. places"></label>';

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
        const logicalName = (body.querySelector('.f-rel-logical-name') as HTMLInputElement).value.trim();
        const sourceCardinality = (body.querySelector('.f-source-card') as HTMLSelectElement).value as Cardinality;
        const targetCardinality = (body.querySelector('.f-target-card') as HTMLSelectElement).value as Cardinality;
        relationInteraction.commit({
          sourceEntityId,
          targetEntityId,
          targetColumnId: select.value,
          name,
          logicalName,
          sourceCardinality,
          targetCardinality
        });
        modal.close();
      } }
    ]
  });
}

function columnSelectHtml(entity: Entity, selectedId: string): string {
  return entity.columns.map((c) => {
    const flag = c.pk ? ' (PK)' : (c.fk ? ' (FK)' : '');
    return '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' +
      escapeHtml(c.name + flag + ' - ' + c.dataType) + '</option>';
  }).join('');
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
      '<div><h4>' + escapeHtml(targetEntity.name) + ' <span class="hint">(one)</span></h4>' +
        '<label>Referenced column<br><select class="f-target-col">' + columnSelectHtml(targetEntity, relation.targetColumnId) + '</select></label>' +
        cardinalitySelectHtml('f-target-card', targetCardinalityOf(relation)) +
      '</div>' +
      '<div><h4>' + escapeHtml(sourceEntity.name) + ' <span class="hint">(many)</span></h4>' +
        '<label>Column<br><select class="f-source-col">' + columnSelectHtml(sourceEntity, relation.sourceColumnId) + '</select></label>' +
        cardinalitySelectHtml('f-source-card', sourceCardinalityOf(relation)) +
      '</div>' +
    '</div>' +
    '<label>Relation name - physical (optional)<br><input type="text" class="f-rel-name" value="' + escapeHtml(relation.name || '') + '"></label>' +
    '<label>Relation name - logical (optional)<br><input type="text" class="f-rel-logical-name" value="' + escapeHtml(relation.logicalName || '') + '"></label>';

  modal.open({
    title: 'Edit relation',
    width: '620px',
    body,
    actions: [
      { label: 'Delete relation', variant: 'danger', onClick: () => {
        modal.close();
        relationInteraction.remove(relationId);
      } },
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Save', variant: 'primary', onClick: () => {
        const newSourceColId = (body.querySelector('.f-source-col') as HTMLSelectElement).value;
        const newTargetColId = (body.querySelector('.f-target-col') as HTMLSelectElement).value;
        const oldSourceColId = relation.sourceColumnId;
        const name = (body.querySelector('.f-rel-name') as HTMLInputElement).value.trim();
        const logicalName = (body.querySelector('.f-rel-logical-name') as HTMLInputElement).value.trim();

        const newSourceCol = sourceEntity.columns.find((c) => c.id === newSourceColId);
        if (newSourceCol && newSourceCol.pk) {
          window.alert(sourceEntity.name + '.' + newSourceCol.name + ' is that table\'s primary key and cannot be used as the FK column.');
          return;
        }

        const changed = newSourceColId !== oldSourceColId || newTargetColId !== relation.targetColumnId;
        if (changed && state.relationExists(newSourceColId, newTargetColId)) {
          window.alert('That column pair is already linked by another relation.');
          return;
        }

        const sourceCardinality = (body.querySelector('.f-source-card') as HTMLSelectElement).value as Cardinality;
        const targetCardinality = (body.querySelector('.f-target-card') as HTMLSelectElement).value as Cardinality;

        state.updateColumn(relation.sourceEntityId, newSourceColId, { fk: true });
        if (oldSourceColId !== newSourceColId) {
          const stillUsed = state.data.relations.some((r) => r.id !== relationId && r.sourceColumnId === oldSourceColId);
          if (!stillUsed) state.updateColumn(relation.sourceEntityId, oldSourceColId, { fk: false });
        }
        state.updateRelation(relationId, { name, logicalName, sourceColumnId: newSourceColId, targetColumnId: newTargetColId, sourceCardinality, targetCardinality });
        modal.close();
      } }
    ]
  });
}

export const modalRelation = { openCreate, openEdit };
