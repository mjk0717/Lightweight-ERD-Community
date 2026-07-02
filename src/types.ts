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
}

export type Cardinality = 'zero-or-one' | 'one' | 'zero-or-many' | 'many' | 'one-or-many';

export interface Relation {
  id: string;
  name: string;
  logicalName: string;
  sourceEntityId: string;
  sourceColumnId: string;
  targetEntityId: string;
  targetColumnId: string;
  sourceCardinality: Cardinality;
  targetCardinality: Cardinality;
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
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
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
