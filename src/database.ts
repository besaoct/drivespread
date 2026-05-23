import { GoogleDriveService } from './drive.js';
import { LockManager } from './locks.js';
import { CacheManager } from './cache.js';
import { BlobManager } from './blobs.js';
import { IndexManager } from './indexes.js';
import { ShardManager } from './shards.js';
import { WriteQueue } from './queue.js';
import { Collection } from './collection.js';
import {
  DriveSpreadOptions,
  DatabaseMetadata,
  SchemaDefinition,
  CollectionOptions,
  ServerOptions,
  RowData,
} from './types.js';

export class DriveSpread {
  public options: DriveSpreadOptions;
  public driveService: GoogleDriveService;
  public lockManager: LockManager;
  public cacheManager: CacheManager;
  public blobManager: BlobManager;
  public indexManager: IndexManager;
  public shardManager: ShardManager;
  public writeQueue: WriteQueue;

  private dbFolderId?: string;
  private metaFileId?: string;
  private metadata?: DatabaseMetadata;
  private initialized = false;
  private initPromise?: Promise<void>;

  private collectionsMap = new Map<string, Collection>();

  constructor(options: DriveSpreadOptions) {
    this.options = options;
    const creds = options.credentials || process.env.GOOGLE_SA_KEY;
    const hasIndividualEnv = (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) || process.env.GOOGLE_REFRESH_TOKEN;
    if (!creds && !hasIndividualEnv) {
      throw new Error(
        'Google Cloud credentials are required. Set "credentials" option, GOOGLE_SA_KEY env, or individual GOOGLE_PRIVATE_KEY/GOOGLE_CLIENT_EMAIL or GOOGLE_REFRESH_TOKEN env variables.'
      );
    }

    this.driveService = new GoogleDriveService(creds);
    this.lockManager = new LockManager(this.driveService);
    this.cacheManager = new CacheManager();
    this.blobManager = new BlobManager(this.driveService);
    this.indexManager = new IndexManager(this.driveService);
    this.shardManager = new ShardManager(this.driveService);
    this.writeQueue = new WriteQueue(this.driveService);
  }

  /**
   * Lazily initialize database connection, folder, metadata, and mutex sheet.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      let folderId = this.options.folderId || process.env.DRIVESPREAD_FOLDER_ID;
      if (!folderId) {
        const folderName = `drivespread_${this.options.db}`;
        // 1. Find or create Database namespace folder
        folderId = await this.driveService.findByName(folderName, undefined, 'application/vnd.google-apps.folder') || undefined;
        if (!folderId) {
          folderId = await this.driveService.createFolder(folderName);
        }
      }
      this.dbFolderId = folderId;

      this.lockManager.setLocksSpreadsheetId('');
      this.indexManager.setDatabaseFolderId(folderId);
      this.blobManager.setDatabaseFolderId(folderId);
      this.shardManager.setDatabaseFolderId(folderId);

      // 2. Find or create Locks sheet
      let locksId = await this.driveService.findByName('_locks', folderId, 'application/vnd.google-apps.spreadsheet');
      if (!locksId) {
        locksId = await this.driveService.createSpreadsheet('_locks', folderId);
        // Header
        await this.driveService.initSheetHeaders(locksId, ['key', 'owner', 'lockedAt', 'expiresAt']);
      }
      this.lockManager.setLocksSpreadsheetId(locksId);

      // 3. Find or load _meta.json
      let metaId = await this.driveService.findByName('_meta.json', folderId, 'application/json');
      let meta: DatabaseMetadata;
      if (!metaId) {
        meta = {
          version: '1.0.0',
          db: this.options.db,
          collections: {},
        };
        metaId = await this.driveService.writeJsonFile('_meta.json', meta, folderId);
      } else {
        meta = await this.driveService.readJsonFile<DatabaseMetadata>(metaId);
      }
      this.metaFileId = metaId;
      this.metadata = meta;
      this.initialized = true;
    })();

    return this.initPromise;
  }

  getFolderId(): string | undefined {
    return this.dbFolderId;
  }

  getMetadata(): DatabaseMetadata {
    if (!this.metadata) {
      throw new Error('Database not initialized.');
    }
    return this.metadata;
  }

  async saveMetadata(newMeta: DatabaseMetadata): Promise<void> {
    if (!this.dbFolderId || !this.metaFileId) {
      throw new Error('Database not initialized.');
    }
    await this.driveService.writeJsonFile('_meta.json', newMeta, this.dbFolderId, this.metaFileId);
    this.metadata = newMeta;
  }

  /**
   * Instantiate or retrieve a Collection instance.
   */
  collection(name: string, schema?: SchemaDefinition, options?: CollectionOptions): Collection {
    let col = this.collectionsMap.get(name);
    if (!col) {
      col = new Collection(this, name, schema || {}, options || {});
      this.collectionsMap.set(name, col);
    }
    return col;
  }

  /**
   * Invalidate cache for a collection.
   */
  invalidate(collectionName: string): void {
    this.cacheManager.invalidate(collectionName);
  }

  /**
   * Upload a blob file.
   */
  async uploadBlob(fileInput: string | Buffer, options?: { name?: string; contentType?: string }): Promise<string> {
    await this.init();
    return await this.blobManager.uploadBlob(fileInput, options);
  }

  /**
   * Get blob short-lived signed access URL.
   */
  async getBlobUrl(fileId: string): Promise<string> {
    await this.init();
    return await this.blobManager.getBlobUrl(fileId);
  }

  /**
   * Serve a REST + WebSocket server for this database.
   */
  async serve(options?: ServerOptions): Promise<any> {
    await this.init();
    // Dynamically load server to avoid bundling Express/WS if unused
    const { startServer } = await import('./server.js');
    return startServer(this, options || {});
  }

  /**
   * Best-effort sequential operations block with automatic rollback.
   */
  async transaction(fn: (tx: TransactionSession) => Promise<void>): Promise<void> {
    await this.init();
    const session = new TransactionSession(this);
    try {
      await fn(session);
      await session.commit();
    } catch (err) {
      await session.rollback();
      throw err;
    }
  }
  // Dynamically populated by adapters.ts
  middleware(): any {
    throw new Error('Express adapter not loaded.');
  }
  nextHandler(): any {
    throw new Error('Next.js adapter not loaded.');
  }
  edgeHandler(): any {
    throw new Error('Edge adapter not loaded.');
  }
  lambdaHandler(): any {
    throw new Error('Lambda adapter not loaded.');
  }
}

interface JournalEntry {
  type: 'insert' | 'update' | 'delete';
  collectionName: string;
  rowId: string;
  previousData?: RowData;
}

export class TransactionSession {
  private db: DriveSpread;
  private journal: JournalEntry[] = [];

  constructor(db: DriveSpread) {
    this.db = db;
  }

  collection(name: string): TransactionCollection {
    return new TransactionCollection(this, this.db.collection(name));
  }

  logInsert(collectionName: string, rowId: string) {
    this.journal.push({ type: 'insert', collectionName, rowId });
  }

  logUpdate(collectionName: string, rowId: string, previousData: RowData) {
    this.journal.push({ type: 'update', collectionName, rowId, previousData });
  }

  logDelete(collectionName: string, rowId: string, previousData: RowData) {
    this.journal.push({ type: 'delete', collectionName, rowId, previousData });
  }

  async commit(): Promise<void> {
    // Transaction successfully executed, clear cache invalidations if needed
    // or batch cache updates
    this.journal = [];
  }

  async rollback(): Promise<void> {
    // Process journal entries in reverse order
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const entry = this.journal[i];
      const col = this.db.collection(entry.collectionName);

      try {
        if (entry.type === 'insert') {
          // Delete inserted row
          await col.deleteById(entry.rowId, true); // bypass transaction logging
        } else if (entry.type === 'update' && entry.previousData) {
          // Revert updated row fields
          await col.updateById(entry.rowId, entry.previousData, true);
        } else if (entry.type === 'delete' && entry.previousData) {
          // Re-insert deleted row
          await col.insert(entry.previousData, true);
        }
      } catch (err) {
        console.error(`Rollback failed for entry: ${JSON.stringify(entry)}. Error: ${(err as Error).message}`);
      }
    }
    this.journal = [];
  }
}

export class TransactionCollection {
  private session: TransactionSession;
  private collection: Collection;

  constructor(session: TransactionSession, collection: Collection) {
    this.session = session;
    this.collection = collection;
  }

  async insert(data: RowData): Promise<RowData> {
    const row = await this.collection.insert(data);
    this.session.logInsert(this.collection.name, row._id!);
    return row;
  }

  async update(filter: any, data: any): Promise<void> {
    const rows = await this.collection.find(filter);
    for (const row of rows) {
      this.session.logUpdate(this.collection.name, row._id!, { ...row });
      await this.collection.updateById(row._id!, data);
    }
  }

  async updateById(id: string, data: any): Promise<void> {
    const row = await this.collection.findById(id);
    if (row) {
      this.session.logUpdate(this.collection.name, id, { ...row });
      await this.collection.updateById(id, data);
    }
  }

  async delete(filter: any): Promise<void> {
    const rows = await this.collection.find(filter);
    for (const row of rows) {
      this.session.logDelete(this.collection.name, row._id!, { ...row });
      await this.collection.deleteById(row._id!);
    }
  }

  async deleteById(id: string): Promise<void> {
    const row = await this.collection.findById(id);
    if (row) {
      this.session.logDelete(this.collection.name, id, { ...row });
      await this.collection.deleteById(id);
    }
  }
}
