export interface Column {
  id: string;
  name: string;
  dataType: string;
  comment: string;
  pk: boolean;
  fk: boolean;
  nullable: boolean;
  isSystem: boolean;
  systemColId: string | null;
}

export interface Entity {
  id: string;
  name: string;
  comment: string;
  x: number;
  y: number;
  columns: Column[];
  headerColor: string | null;
}

export type Cardinality = 'zero-or-one' | 'one' | 'zero-or-many' | 'many' | 'one-or-many';

// One column pair of the FK relationship - a relation has one pair for a
// plain FK, or several for a composite (multi-column) FK.
export interface RelationColumnPair {
  sourceColumnId: string;
  targetColumnId: string;
}

export interface Relation {
  id: string;
  name: string;
  logicalName: string;
  sourceEntityId: string;
  targetEntityId: string;
  columnPairs: RelationColumnPair[];
  sourceCardinality: Cardinality;
  targetCardinality: Cardinality;
  // Purely visual: where along the entity's own edge the line attaches,
  // as a 0-1 fraction of its height. Undefined falls back to the default
  // (the first column pair's row center) - dragging an endpoint handle only
  // ever sets this, never changes which entity/column the relation targets.
  sourceAnchorT?: number;
  targetAnchorT?: number;
}

export interface SystemColumnDef {
  id: string;
  name: string;
  dataType: string;
  comment: string;
}

export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export type SelectionType = 'entity' | 'relation';

export interface Selection {
  type: SelectionType;
  id: string;
}

export type DesignMode = 'physical' | 'logical';
export type LineStyle = 'curved' | 'angular';

export interface AppData {
  entities: Entity[];
  relations: Relation[];
  systemColumns: SystemColumnDef[];
  view: ViewState;
  selected: Selection | null;
  designMode: DesignMode;
  lineStyle: LineStyle;
}

export interface SerializedState {
  entities: Entity[];
  relations: Relation[];
  systemColumns: SystemColumnDef[];
  view: ViewState;
  designMode: DesignMode;
  lineStyle: LineStyle;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RowCenter {
  x: number;
  xRight: number;
  y: number;
}

export interface DdlTable {
  name: string;
  comment: string;
  columns: Column[];
}

export interface DdlRelation {
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  name: string;
}

export interface DdlParseResult {
  tables: DdlTable[];
  relations: DdlRelation[];
  warnings: string[];
}

export interface DdlFkCandidate {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface FkPlan {
  isNew: boolean;
  name: string;
  existingId?: string;
}

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'danger';
  onClick: () => void;
}

export interface ModalOptions {
  title: string;
  body: HTMLElement;
  actions?: ModalAction[];
  width?: string;
  onClose?: () => void;
}

export interface ModalHandle {
  close: () => void;
  root: HTMLElement;
  body: HTMLElement;
}

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}
