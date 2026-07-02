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

// Which of the target entity's columns get pre-checked as the referenced
// key: its PK columns (composite or single), falling back to the first
// column if it has no PK defined at all.
function defaultTargetColumnIds(entity: Entity): string[] {
  const pks = entity.columns.filter((c) => c.pk);
  if (pks.length) return pks.map((c) => c.id);
  return entity.columns[0] ? [entity.columns[0].id] : [];
}

function previewLine(sourceEntity: Entity, targetColumn: Column, targetEntityName: string): string {
  const plan = relationInteraction.planFkColumn(sourceEntity.id, targetColumn, targetEntityName);
  if (!plan.isNew) return 'Existing column "' + plan.name + '" on ' + sourceEntity.name + ' will be marked as FK and join its primary key.';
  return 'New FK column "' + plan.name + '" (' + targetColumn.dataType + ') will be added to ' + sourceEntity.name + ' as part of its primary key.';
}

function targetChecklistHtml(entity: Entity, checkedIds: string[]): string {
  return entity.columns.map((c) => {
    const flag = c.pk ? ' (PK)' : '';
    const checked = checkedIds.indexOf(c.id) !== -1 ? ' checked' : '';
    return '<label class="col-check-row"><input type="checkbox" class="f-target-col-check" value="' + c.id + '"' + checked + '> ' +
      escapeHtml(c.name + flag + ' - ' + c.dataType) + '</label>';
  }).join('');
}

function existingColumnSelectHtml(entity: Entity): string {
  return entity.columns.map((c) => {
    const flag = c.pk ? ' (PK)' : (c.fk ? ' (FK)' : '');
    return '<option value="' + c.id + '">' + escapeHtml(c.name + flag + ' - ' + c.dataType) + '</option>';
  }).join('');
}

// A same-name column already on the child, whether it's currently a PK or a
// plain attribute - if the parent's key column already exists by name,
// that's the column to reuse, not a fresh auto-generated one.
function findMatchingSourceColumn(sourceEntity: Entity, targetColumn: Column): Column | null {
  return sourceEntity.columns.find((c) => c.name.toUpperCase() === targetColumn.name.toUpperCase()) || null;
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
  body.innerHTML =
    '<div class="rel-modal-grid">' +
      '<div><h4>' + escapeHtml(targetEntity.name) + ' <span class="hint">(one)</span></h4>' +
        '<div class="target-col-checklist">' + targetChecklistHtml(targetEntity, defaultTargetColumnIds(targetEntity)) + '</div>' +
        cardinalitySelectHtml('f-target-card', DEFAULT_TARGET_CARDINALITY) +
      '</div>' +
      '<div><h4>' + escapeHtml(sourceEntity.name) + ' <span class="hint">(many)</span></h4>' +
        '<div class="fk-mode-choice">' +
          '<label><input type="radio" name="fk-mode" class="f-fk-mode" value="new" checked> New column(s)</label>' +
          '<label><input type="radio" name="fk-mode" class="f-fk-mode" value="existing"> Existing column(s)</label>' +
        '</div>' +
        '<div class="f-existing-col-mapping" style="display:none"></div>' +
        cardinalitySelectHtml('f-source-card', DEFAULT_SOURCE_CARDINALITY) +
      '</div>' +
    '</div>' +
    '<div class="rel-preview"></div>' +
    '<label>Relation name - physical (optional)<br><input type="text" class="f-rel-name" placeholder="e.g. FK_ORDER_CUSTOMER"></label>' +
    '<label>Relation name - logical (optional)<br><input type="text" class="f-rel-logical-name" placeholder="e.g. places"></label>';

  const targetChecks = Array.from(body.querySelectorAll('.f-target-col-check')) as HTMLInputElement[];
  const fkModeInputs = Array.from(body.querySelectorAll('.f-fk-mode')) as HTMLInputElement[];
  const mappingWrap = body.querySelector('.f-existing-col-mapping') as HTMLElement;
  const previewEl = body.querySelector('.rel-preview') as HTMLElement;

  function fkMode(): 'new' | 'existing' {
    return (fkModeInputs.find((r) => r.checked) as HTMLInputElement).value as 'new' | 'existing';
  }
  function checkedTargetColumns(): Column[] {
    return targetChecks.filter((cb) => cb.checked).map((cb) => targetEntity!.columns.find((c) => c.id === cb.value)!).filter(Boolean);
  }

  function updatePreview(): void {
    const cols = checkedTargetColumns();
    if (!cols.length) { previewEl.textContent = 'Select at least one column to reference.'; return; }
    if (fkMode() === 'existing') {
      const lines = cols.map((tCol) => {
        const sel = mappingWrap.querySelector('.f-map-col[data-target-col-id="' + tCol.id + '"]') as HTMLSelectElement | null;
        const sCol = sel && sourceEntity!.columns.find((c) => c.id === sel.value);
        return sCol ? 'Column "' + sCol.name + '" on ' + sourceEntity!.name + ' will be marked as FK and join its primary key.' : '';
      });
      previewEl.textContent = lines.filter(Boolean).join('\n');
      return;
    }
    previewEl.textContent = cols.map((c) => previewLine(sourceEntity!, c, targetEntity!.name)).join('\n');
  }

  function renderMapping(): void {
    const cols = checkedTargetColumns();
    if (fkMode() !== 'existing') { mappingWrap.style.display = 'none'; updatePreview(); return; }
    mappingWrap.style.display = '';
    mappingWrap.innerHTML = '';
    cols.forEach((tCol) => {
      const row = document.createElement('label');
      row.innerHTML = escapeHtml(tCol.name) + ' &rarr; <select class="f-map-col" data-target-col-id="' + tCol.id + '">' +
        existingColumnSelectHtml(sourceEntity!) + '</select>';
      const select = row.querySelector('select') as HTMLSelectElement;
      const matched = findMatchingSourceColumn(sourceEntity!, tCol);
      if (matched) select.value = matched.id;
      select.addEventListener('change', updatePreview);
      mappingWrap.appendChild(row);
    });
    updatePreview();
  }

  // If the parent's (checked) key column already exists on the child under
  // the same name - PK or not - there's nothing to "create", so default to
  // "Existing column(s)" and pre-match the pair instead of leaving the user
  // on "New column(s)" looking at a column that's about to be duplicated.
  function autoSwitchToExistingIfMatched(): void {
    const cols = checkedTargetColumns();
    const anyMatch = cols.some((tCol) => findMatchingSourceColumn(sourceEntity!, tCol));
    if (anyMatch) (fkModeInputs.find((r) => r.value === 'existing') as HTMLInputElement).checked = true;
  }

  targetChecks.forEach((cb) => cb.addEventListener('change', () => { autoSwitchToExistingIfMatched(); renderMapping(); }));
  fkModeInputs.forEach((r) => r.addEventListener('change', renderMapping));
  autoSwitchToExistingIfMatched();
  renderMapping();

  modal.open({
    title: 'New relation',
    width: '660px',
    body,
    actions: [
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Create relation', variant: 'primary', onClick: () => {
        const cols = checkedTargetColumns();
        if (!cols.length) { window.alert('Select at least one column to reference.'); return; }

        const name = (body.querySelector('.f-rel-name') as HTMLInputElement).value.trim();
        const logicalName = (body.querySelector('.f-rel-logical-name') as HTMLInputElement).value.trim();
        const sourceCardinality = (body.querySelector('.f-source-card') as HTMLSelectElement).value as Cardinality;
        const targetCardinality = (body.querySelector('.f-target-card') as HTMLSelectElement).value as Cardinality;

        const targetColumnIds = cols.map((c) => c.id);
        // Picking an existing column that's already the child's PK is a
        // valid, deliberate choice (a 1:1 identifying relationship sharing
        // the same key) - it just becomes PK+FK, no need to block it.
        let explicitSourceColumnIds: Record<string, string> | undefined;
        if (fkMode() === 'existing') {
          explicitSourceColumnIds = {};
          for (const tCol of cols) {
            const sel = mappingWrap.querySelector('.f-map-col[data-target-col-id="' + tCol.id + '"]') as HTMLSelectElement;
            explicitSourceColumnIds[tCol.id] = sel.value;
          }
        }

        relationInteraction.commit({
          sourceEntityId,
          targetEntityId,
          targetColumnIds,
          name,
          logicalName,
          sourceCardinality,
          targetCardinality,
          explicitSourceColumnIds
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

  const pairsHtml = relation.columnPairs.map((p) => {
    const sCol = sourceEntity.columns.find((c) => c.id === p.sourceColumnId);
    const tCol = targetEntity.columns.find((c) => c.id === p.targetColumnId);
    return '<li>' + escapeHtml(sourceEntity.name) + '.' + escapeHtml(sCol ? sCol.name : '?') +
      ' &rarr; ' + escapeHtml(targetEntity.name) + '.' + escapeHtml(tCol ? tCol.name : '?') + '</li>';
  }).join('');

  const body = document.createElement('div');
  body.innerHTML =
    '<div class="rel-modal-grid">' +
      '<div><h4>' + escapeHtml(targetEntity.name) + ' <span class="hint">(one)</span></h4>' +
        cardinalitySelectHtml('f-target-card', targetCardinalityOf(relation)) +
      '</div>' +
      '<div><h4>' + escapeHtml(sourceEntity.name) + ' <span class="hint">(many)</span></h4>' +
        cardinalitySelectHtml('f-source-card', sourceCardinalityOf(relation)) +
      '</div>' +
    '</div>' +
    '<div class="rel-pairs-readout"><span class="hint">Linked columns</span><ul class="col-ref-list">' + pairsHtml + '</ul></div>' +
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
        const name = (body.querySelector('.f-rel-name') as HTMLInputElement).value.trim();
        const logicalName = (body.querySelector('.f-rel-logical-name') as HTMLInputElement).value.trim();
        const sourceCardinality = (body.querySelector('.f-source-card') as HTMLSelectElement).value as Cardinality;
        const targetCardinality = (body.querySelector('.f-target-card') as HTMLSelectElement).value as Cardinality;
        state.updateRelation(relationId, { name, logicalName, sourceCardinality, targetCardinality });
        modal.close();
      } }
    ]
  });
}

export const modalRelation = { openCreate, openEdit };
