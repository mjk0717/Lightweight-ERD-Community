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

// Which edge of an entity's box a relation endpoint attaches to, and how far
// along that edge (0-1, left-to-right for top/bottom, top-to-bottom for
// left/right).
export type AnchorSide = 'left' | 'right' | 'top' | 'bottom';
export interface Anchor {
  side: AnchorSide;
  t: number;
}

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
  // Purely visual: which edge of the entity's own box the line attaches to,
  // and how far along it. Undefined falls back to the default (auto left/
  // right side, at the first column pair's row) - dragging an endpoint
  // handle only ever sets this, never changes which entity/column the
  // relation targets.
  sourceAnchor?: Anchor;
  targetAnchor?: Anchor;
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
  // The primary selection - drives the relation-edit path and single-entity
  // operations. For entities it always mirrors the last entity added to
  // selectedEntityIds.
  selected: Selection | null;
  // All currently-selected entities (Ctrl+click builds this up). A single
  // plain click leaves exactly one id here; relation selection empties it.
  selectedEntityIds: string[];
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

// A PRIMARY KEY named for a table by an ALTER TABLE ... ADD (...) statement
// where that table isn't (re)defined in the same DDL text - so there's no
// local DdlTable/Column to mark pk on directly. Applied against whichever
// entity the table name resolves to (new or already existing) once import
// has real Column objects to work with.
export interface DdlPkUpdate {
  table: string;
  columns: string[];
}

export interface DdlParseResult {
  tables: DdlTable[];
  relations: DdlRelation[];
  pkUpdates: DdlPkUpdate[];
  warnings: string[];
}

export interface DdlFkCandidate {
  table: string;
  name?: string;
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
  sepBefore?: boolean;
  onClick: () => void;
}
