export type GoogleCredentials =
  | string
  | {
      client_email: string;
      private_key: string;
      project_id?: string;
      [key: string]: any;
    };

export interface DriveSpreadOptions {
  db: string;
  credentials?: GoogleCredentials;
}

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'blob' | 'array' | 'object';

export interface FieldDefinition {
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: any | (() => any);
  min?: number;
  max?: number;
  enum?: any[];
  regex?: string | RegExp;
}

export type SchemaDefinition = Record<string, FieldDefinition>;

export type CascadeAction = 'cascade' | 'restrict' | 'setNull';

export interface RelationDefinition {
  type: 'hasOne' | 'hasMany' | 'belongsTo';
  collection: string;
  foreignKey: string;
  onDelete?: CascadeAction;
}

export type RelationsDefinition = Record<string, RelationDefinition>;

export interface PermissionContext {
  id?: string;
  role?: string;
  [key: string]: any;
}

export interface CollectionOptions {
  indexes?: string[];
  permissions?: {
    read?: (user: PermissionContext | null, row: any) => boolean | Promise<boolean>;
    write?: (user: PermissionContext | null, row: any) => boolean | Promise<boolean>;
    delete?: (user: PermissionContext | null, row: any) => boolean | Promise<boolean>;
  };
  relations?: RelationsDefinition;
  cacheTTL?: number; // in seconds
}

export interface SystemColumns {
  _id: string;
  _version: number;
  _createdAt: string;
  _updatedAt: string;
}

export type RowData = Record<string, any> & Partial<SystemColumns>;
export type FullRowData = Record<string, any> & SystemColumns;

// Query operators
export type QueryValue = any;
export interface QueryOperator {
  $eq?: QueryValue;
  $ne?: QueryValue;
  $gt?: QueryValue;
  $gte?: QueryValue;
  $lt?: QueryValue;
  $lte?: QueryValue;
  $in?: QueryValue[];
  $contains?: string;
  $startsWith?: string;
}

export type QueryCondition = QueryValue | QueryOperator;
export type QueryFilter = Record<string, QueryCondition>;

export interface FindOptions {
  select?: string[];
  populate?: string[];
}

// Hooks definition
export type HookFn = (data: any) => void | Promise<void> | any | Promise<any>;

// Database metadata stored in _meta.json
export interface CollectionMetadata {
  shards: string[];
  rowCounts: number[];
  schema: SchemaDefinition;
  indexes: string[];
  relations?: RelationsDefinition;
}

export interface DatabaseMetadata {
  version: string;
  db: string;
  collections: Record<string, CollectionMetadata>;
}

// REST server options
export interface ServerOptions {
  port?: number;
  auth?: {
    type: 'jwt' | 'apikey' | 'none';
    secret?: string;
    expiresIn?: string;
  };
  cors?: {
    origins?: string[];
  };
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
  realtime?: {
    enabled?: boolean;
    pollIntervalMs?: number;
  };
  admin?: {
    secret?: string;
  };
}

// WebSocket event structures
export type WsEventType = 'insert' | 'update' | 'delete';
export interface WsEvent {
  type: WsEventType;
  collection: string;
  row: FullRowData;
}
