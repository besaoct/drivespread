import { DriveSpread } from './database.js';
import { SchemaValidator } from './schema.js';
import { QueryEngine } from './query.js';
import { RelationManager } from './relations.js';
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in QueryChain
  SchemaDefinition,
  CollectionOptions,
  RowData,
  QueryFilter,
  FindOptions,
  HookFn,
  CollectionMetadata,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class Collection {
  private db: DriveSpread;
  public name: string;
  public schema: SchemaDefinition;
  public options: CollectionOptions;

  // Hooks
  private _beforeInsert: HookFn[] = [];
  private _afterInsert: HookFn[] = [];
  private _beforeUpdate: HookFn[] = [];
  private _afterUpdate: HookFn[] = [];
  private _beforeDelete: HookFn[] = [];
  private _afterDelete: HookFn[] = [];

  constructor(
    db: DriveSpread,
    name: string,
    schema: SchemaDefinition = {},
    options: CollectionOptions = {}
  ) {
    this.db = db;
    this.name = name;
    this.schema = schema;
    this.options = options;
  }

  // Register Hooks
  beforeInsert(fn: HookFn) { this._beforeInsert.push(fn); }
  afterInsert(fn: HookFn) { this._afterInsert.push(fn); }
  beforeUpdate(fn: HookFn) { this._beforeUpdate.push(fn); }
  afterUpdate(fn: HookFn) { this._afterUpdate.push(fn); }
  beforeDelete(fn: HookFn) { this._beforeDelete.push(fn); }
  afterDelete(fn: HookFn) { this._afterDelete.push(fn); }

  /**
   * Internal helper to make sure metadata matches this collection
   */
  private async ensureCollectionInitialized(): Promise<CollectionMetadata> {
    await this.db.init();
    const meta = this.db.getMetadata();

    if (!meta.collections[this.name]) {
      // 1. Create initial shard spreadsheet
      const folderId = this.db.getFolderId()!;
      const shardName = `${meta.db}_${this.name}_shard_1`;
      const shardId = await this.db.driveService.createSpreadsheet(shardName, folderId);

      // 2. Initialize sheet headers
      const headers = ['_id', '_version', '_createdAt', '_updatedAt', ...Object.keys(this.schema)];
      await this.db.driveService.initSheetHeaders(shardId, headers);

      // 3. Update database metadata
      meta.collections[this.name] = {
        shards: [shardId],
        rowCounts: [0],
        schema: this.schema,
        indexes: this.options.indexes || [],
        relations: this.options.relations,
      };

      await this.db.saveMetadata(meta);
    } else {
      // Merge schemas if schema passed in constructor is newer/different
      const colMeta = meta.collections[this.name];
      if (Object.keys(this.schema).length > 0 && JSON.stringify(colMeta.schema) !== JSON.stringify(this.schema)) {
        colMeta.schema = { ...colMeta.schema, ...this.schema };
        colMeta.indexes = Array.from(new Set([...colMeta.indexes, ...(this.options.indexes || [])]));
        if (this.options.relations) {
          colMeta.relations = { ...colMeta.relations, ...this.options.relations };
        }
        await this.db.saveMetadata(meta);
      } else {
        // Hydrate schema from metadata if not provided in code
        this.schema = colMeta.schema;
      }
    }

    return meta.collections[this.name];
  }

  /**
   * Helper to turn Sheets rows (string[][]) into RowData objects.
   */
  private parseRows(headers: string[], values: string[][], shardId: string): RowData[] {
    const rows: RowData[] = [];
    
    for (let r = 0; r < values.length; r++) {
      const rowArr = values[r];
      // Skip empty/deleted rows
      if (rowArr.length === 0 || !rowArr[0]) continue;

      const rowObj: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        rowObj[headers[c]] = rowArr[c] !== undefined ? rowArr[c] : '';
      }

      const deserialized = SchemaValidator.deserializeRow(this.schema, rowObj);
      
      // Inject row metadata for updates
      deserialized._shardId = shardId;
      deserialized._rowNumber = r + 2; // header is row 1, 0-indexed is +2

      rows.push(deserialized);
    }

    return rows;
  }

  /**
   * Fetch all rows for this collection (scanning all shards).
   */
  async getAllRawRows(): Promise<RowData[]> {
    const colMeta = await this.ensureCollectionInitialized();
    
    // Check cache
    const cached = this.db.cacheManager.get(this.name, this.options.cacheTTL);
    if (cached) return cached;

    const allRows: RowData[] = [];

    for (const shardId of colMeta.shards) {
      const values = await this.db.driveService.readSheetValues(shardId, 'Sheet1!A:ZZ');
      if (values.length <= 1) continue; // Only header or empty

      const headers = values[0];
      const dataRows = values.slice(1);
      const parsed = this.parseRows(headers, dataRows, shardId);
      allRows.push(...parsed);
    }

    this.db.cacheManager.set(this.name, allRows);
    return allRows;
  }

  /**
   * Look up a row at a specific shard + row location.
   */
  private async getRowAtLocation(shardId: string, rowNumber: number): Promise<RowData | null> {
    const range = `Sheet1!A${rowNumber}:ZZ${rowNumber}`;
    const values = await this.db.driveService.readSheetValues(shardId, range);
    if (values.length === 0 || values[0].length === 0 || !values[0][0]) {
      return null;
    }

    // Load headers to index fields correctly
    const allValues = await this.db.driveService.readSheetValues(shardId, 'Sheet1!A1:ZZ1');
    if (allValues.length === 0) return null;
    const headers = allValues[0];

    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = values[0][c] !== undefined ? values[0][c] : '';
    }

    const deserialized = SchemaValidator.deserializeRow(this.schema, rowObj);
    deserialized._shardId = shardId;
    deserialized._rowNumber = rowNumber;

    return deserialized;
  }

  /**
   * Helper to check uniqueness constraint in the collection
   */
  private async checkUniqueness(data: RowData, excludeId?: string) {
    const uniqueFields = Object.entries(this.schema)
      .filter(([_, def]) => def.unique)
      .map(([key]) => key);

    if (uniqueFields.length === 0) return;

    const rows = await this.getAllRawRows();
    for (const field of uniqueFields) {
      const val = data[field];
      if (val === undefined || val === null) continue;

      const conflict = rows.find((r) => r[field] === val && r._id !== excludeId);
      if (conflict) {
        throw new Error(`Uniqueness constraint failed: field "${field}" already has value "${val}".`);
      }
    }
  }

  /**
   * Insert a row.
   */
  async insert(data: RowData, bypassTxLog = false): Promise<RowData> {
    const colMeta = await this.ensureCollectionInitialized();

    const row: RowData = {
      _id: data._id || uuidv4(),
      _version: 1,
      _createdAt: data._createdAt || new Date().toISOString(),
      _updatedAt: data._updatedAt || new Date().toISOString(),
      ...data,
    };

    // 1. Schema validation
    const validated = SchemaValidator.validate(this.schema, row);

    // 2. Uniqueness check
    await this.checkUniqueness(validated);

    // 3. BeforeInsert hook
    let processedData = validated;
    if (!bypassTxLog) {
      for (const hook of this._beforeInsert) {
        const res = await hook(processedData);
        if (res !== undefined) processedData = res;
      }
    }

    // 4. Get active write shard (auto-shard if cell limit reached)
    const activeShardId = await this.db.shardManager.getActiveWriteShard(
      this.name,
      this.db.getMetadata(),
      this.schema,
      async (m) => this.db.saveMetadata(m)
    );

    // 5. Serialize
    const serialized = SchemaValidator.serializeRow(this.schema, processedData);
    const headers = ['_id', '_version', '_createdAt', '_updatedAt', ...Object.keys(this.schema)];
    const rowValues = headers.map((h) => serialized[h] ?? '');

    // 6. Find row offset and write
    const allValues = await this.db.driveService.readSheetValues(activeShardId, 'Sheet1!A:A');
    const nextRowNumber = allValues.length + 1;

    const range = `Sheet1!A${nextRowNumber}`;
    await this.db.writeQueue.enqueueUpdate(activeShardId, range, [rowValues]);

    // 7. Increment row count in metadata
    let meta = this.db.getMetadata();
    meta = this.db.shardManager.incrementRowCount(this.name, meta, activeShardId);
    await this.db.saveMetadata(meta);

    // 8. Update indexes
    const location = { shardId: activeShardId, row: nextRowNumber };
    await this.db.indexManager.updateIndexes(
      this.name,
      colMeta.indexes,
      processedData,
      null,
      location
    );

    // 9. Write-through cache update
    processedData._shardId = activeShardId;
    processedData._rowNumber = nextRowNumber;
    this.db.cacheManager.insert(this.name, processedData);

    // 10. AfterInsert hook
    if (!bypassTxLog) {
      for (const hook of this._afterInsert) {
        await hook(processedData);
      }
    }

    return processedData;
  }

  /**
   * Find rows matching a filter query.
   */
  async executeFind(filter: QueryFilter = {}, options: FindOptions = {}): Promise<RowData[]> {
    const colMeta = await this.ensureCollectionInitialized();

    // Check if we can do O(1) index lookup
    // Only if filter specifies a direct equality on an indexed field
    const indexedFields = ['_id', ...colMeta.indexes];
    let matchedLocation = false;
    let rowsToQuery: RowData[] = [];

    for (const field of indexedFields) {
      if (filter[field] !== undefined && (typeof filter[field] !== 'object' || filter[field] === null)) {
        const lookupVal = filter[field];
        const location = await this.db.indexManager.lookup(this.name, field, lookupVal);
        if (location) {
          const row = await this.getRowAtLocation(location.shardId, location.row);
          if (row) {
            rowsToQuery = [row];
            matchedLocation = true;
          }
        } else {
          // Field is indexed but value doesn't exist, return empty directly
          return [];
        }
        break;
      }
    }

    if (!matchedLocation) {
      // Full scan (cache or Sheets read)
      rowsToQuery = await this.getAllRawRows();
    }

    // In-memory filter
    let results = QueryEngine.filter(rowsToQuery, filter);

    // Populate relations
    if (colMeta.relations && options.populate) {
      results = await RelationManager.populateRelations(
        this.db,
        this.name,
        colMeta.relations,
        results,
        options.populate
      );
    }

    return results;
  }

  find(filter: QueryFilter = {}, options: FindOptions = {}): QueryChain {
    return new QueryChain(this, filter, options);
  }

  /**
   * Find single row.
   */
  async findOne(filter: QueryFilter = {}, options: FindOptions = {}): Promise<RowData | null> {
    const rows = await this.find(filter, options);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find row by ID.
   */
  async findById(id: string, options: FindOptions = {}): Promise<RowData | null> {
    return await this.findOne({ _id: id }, options);
  }

  /**
   * Update rows matching a filter.
   */
  async update(filter: QueryFilter, updatePayload: Record<string, any>): Promise<void> {
    const rows = await this.find(filter);
    for (const row of rows) {
      await this.updateById(row._id!, updatePayload);
    }
  }

  /**
   * Update a specific row by ID.
   */
  async updateById(id: string, updatePayload: Record<string, any>, bypassTxLog = false): Promise<void> {
    const colMeta = await this.ensureCollectionInitialized();

    await this.db.lockManager.retryOnConflict(async () => {
      // Read current location & data
      const location = await this.db.indexManager.lookup(this.name, '_id', id);
      if (!location) {
        throw new Error(`Document not found for update with ID "${id}".`);
      }

      const currentRow = await this.getRowAtLocation(location.shardId, location.row);
      if (!currentRow) {
        throw new Error(`Document metadata found but sheet row is empty or corrupted (ID: "${id}").`);
      }

      // Check version matching for optimistic lock
      if (!bypassTxLog && currentRow._version !== undefined && updatePayload._version !== undefined) {
        if (currentRow._version !== updatePayload._version) {
          throw new Error('Version conflict: document has been modified by another process.');
        }
      }

      // Apply update operators ($inc/$dec) and modifications
      const updatedRow = bypassTxLog ? { ...currentRow, ...updatePayload } : QueryEngine.applyUpdateOperators(currentRow, updatePayload);
      updatedRow._version = (currentRow._version ?? 1) + 1;
      updatedRow._updatedAt = new Date().toISOString();

      // Schema validate
      const validated = SchemaValidator.validate(this.schema, updatedRow, true);

      // Check uniqueness
      await this.checkUniqueness(validated, id);

      // 3. BeforeUpdate hook
      let processedData = validated;
      if (!bypassTxLog) {
        for (const hook of this._beforeUpdate) {
          const res = await hook(processedData);
          if (res !== undefined) processedData = res;
        }
      }

      // Serialize
      const serialized = SchemaValidator.serializeRow(this.schema, processedData);
      const headers = ['_id', '_version', '_createdAt', '_updatedAt', ...Object.keys(this.schema)];
      const rowValues = headers.map((h) => serialized[h] ?? '');

      // Write back to sheets range
      const range = `Sheet1!A${location.row}:ZZ${location.row}`;
      await this.db.writeQueue.enqueueUpdate(location.shardId, range, [rowValues]);

      // Update indexes
      await this.db.indexManager.updateIndexes(
        this.name,
        colMeta.indexes,
        processedData,
        currentRow,
        location
      );

      // Update cache
      this.db.cacheManager.update(
        this.name,
        id,
        processedData,
        processedData._version ?? 1,
        processedData._updatedAt!
      );

      // AfterUpdate hook
      if (!bypassTxLog) {
        for (const hook of this._afterUpdate) {
          await hook(processedData);
        }
      }
    });
  }

  /**
   * Delete rows matching a filter.
   */
  async delete(filter: QueryFilter): Promise<void> {
    const rows = await this.find(filter);
    for (const row of rows) {
      await this.deleteById(row._id!);
    }
  }

  /**
   * Delete a specific row by ID.
   */
  async deleteById(id: string, bypassTxLog = false): Promise<void> {
    const colMeta = await this.ensureCollectionInitialized();

    const location = await this.db.indexManager.lookup(this.name, '_id', id);
    if (!location) return; // Already deleted or doesn't exist

    const currentRow = await this.getRowAtLocation(location.shardId, location.row);
    if (!currentRow) return;

    // 1. BeforeDelete hooks
    if (!bypassTxLog) {
      for (const hook of this._beforeDelete) {
        await hook(currentRow);
      }
    }

    // 2. Cascade delete relationships
    await RelationManager.handleCascadeDelete(this.db, this.name, id, bypassTxLog);

    // 3. Clear row in spreadsheet
    const headers = ['_id', '_version', '_createdAt', '_updatedAt', ...Object.keys(this.schema)];
    const emptyRow = headers.map(() => '');
    const range = `Sheet1!A${location.row}:ZZ${location.row}`;
    await this.db.writeQueue.enqueueUpdate(location.shardId, range, [emptyRow]);

    // 4. Update metadata
    let meta = this.db.getMetadata();
    meta = this.db.shardManager.decrementRowCount(this.name, meta, location.shardId);
    await this.db.saveMetadata(meta);

    // 5. Update indexes (remove mappings)
    await this.db.indexManager.updateIndexes(
      this.name,
      colMeta.indexes,
      null,
      currentRow,
      location
    );

    // 6. Cache eviction
    this.db.cacheManager.delete(this.name, id);

    // 7. AfterDelete hooks
    if (!bypassTxLog) {
      for (const hook of this._afterDelete) {
        await hook(currentRow);
      }
    }
  }
}

/**
 * Decorate return values with filter chaining support (sort, limit, offset)
 */
export class QueryChain implements PromiseLike<RowData[]> {
  private collection: Collection;
  private filterQuery: QueryFilter;
  private options: FindOptions;
  
  private sortSpec?: Record<string, 'asc' | 'desc'>;
  private limitCount?: number;
  private offsetCount?: number;
  private selectFields?: string[];

  constructor(collection: Collection, filterQuery: QueryFilter, options: FindOptions) {
    this.collection = collection;
    this.filterQuery = filterQuery;
    this.options = options;
  }

  sort(sortSpec: Record<string, 'asc' | 'desc'> | string): this {
    if (typeof sortSpec === 'string') {
      const parts = sortSpec.split(' ');
      const field = parts[0];
      const dir = (parts[1]?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';
      this.sortSpec = { [field]: dir };
    } else {
      this.sortSpec = sortSpec;
    }
    return this;
  }

  limit(limit: number): this {
    this.limitCount = limit;
    return this;
  }

  offset(offset: number): this {
    this.offsetCount = offset;
    return this;
  }

  select(fields: string[]): this {
    this.selectFields = fields;
    return this;
  }

  async get(): Promise<RowData[]> {
    let rows = await this.collection.executeFind(this.filterQuery, this.options);

    if (this.sortSpec) {
      rows = QueryEngine.sort(rows, this.sortSpec);
    }

    if (this.offsetCount !== undefined) {
      rows = rows.slice(this.offsetCount);
    }

    if (this.limitCount !== undefined) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.selectFields && this.selectFields.length > 0) {
      rows = QueryEngine.project(rows, this.selectFields);
    }

    return rows;
  }

  then<TResult1 = RowData[], TResult2 = never>(
    onfulfilled?: ((value: RowData[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.get().then(onfulfilled, onrejected);
  }
}
