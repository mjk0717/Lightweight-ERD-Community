import { Cardinality } from './types';

export const CARDINALITY_OPTIONS: { value: Cardinality; label: string }[] = [
  { value: 'zero-or-one', label: 'Zero or one' },
  { value: 'one', label: 'One' },
  { value: 'zero-or-many', label: 'Zero or many' },
  { value: 'many', label: 'Many' },
  { value: 'one-or-many', label: 'One or many' }
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
