import { Cardinality } from './types';

// Grouped for the cardinality <select> (rendered as <optgroup>s): a "One"
// group and a "Many" group, one guide-line separator each.
export const CARDINALITY_GROUPS: { label: string; options: { value: Cardinality; label: string }[] }[] = [
  {
    label: 'One',
    options: [
      { value: 'one', label: 'One' },
      { value: 'zero-or-one', label: 'Zero or One' }
    ]
  },
  {
    label: 'Many',
    options: [
      { value: 'many', label: 'Many' },
      { value: 'zero-or-many', label: 'Zero or Many' },
      { value: 'one-or-many', label: 'One or Many' }
    ]
  }
];

export const DEFAULT_SOURCE_CARDINALITY: Cardinality = 'one-or-many';
export const DEFAULT_TARGET_CARDINALITY: Cardinality = 'one';

// Older saved relations (or relations built before this field existed) may
// be missing the cardinality fields - fall back to the current default look.
export function sourceCardinalityOf(c: { sourceCardinality?: Cardinality }): Cardinality {
  return c.sourceCardinality || DEFAULT_SOURCE_CARDINALITY;
}
export function targetCardinalityOf(c: { targetCardinality?: Cardinality }): Cardinality {
  return c.targetCardinality || DEFAULT_TARGET_CARDINALITY;
}
