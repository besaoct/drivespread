import { GoogleDriveService } from './drive.js';

interface IndexMapping {
  shardId: string;
  row: number; // 1-indexed row number in the Sheets shard
}

export class IndexManager {
  private driveService: GoogleDriveService;
  private databaseFolderId?: string;

  constructor(driveService: GoogleDriveService) {
    this.driveService = driveService;
  }

  setDatabaseFolderId(id: string) {
    this.databaseFolderId = id;
  }

  private getIndexFileName(collectionName: string, fieldName: string): string {
    return `_index_${collectionName}_${fieldName}.json`;
  }

  /**
   * Loads an index from Google Drive, returning a record of value -> IndexMapping.
   */
  async loadIndex(collectionName: string, fieldName: string): Promise<Record<string, IndexMapping>> {
    if (!this.databaseFolderId) {
      throw new Error('Database folder ID not initialized.');
    }

    const fileName = this.getIndexFileName(collectionName, fieldName);
    const fileId = await this.driveService.findByName(fileName, this.databaseFolderId, 'application/json');

    if (!fileId) {
      return {};
    }

    try {
      const data = await this.driveService.readJsonFile<{ mappings: Record<string, IndexMapping> }>(fileId);
      return data.mappings || {};
    } catch {
      return {};
    }
  }

  /**
   * Saves an index back to Google Drive.
   */
  async saveIndex(collectionName: string, fieldName: string, mappings: Record<string, IndexMapping>): Promise<void> {
    if (!this.databaseFolderId) {
      throw new Error('Database folder ID not initialized.');
    }

    const fileName = this.getIndexFileName(collectionName, fieldName);
    const fileId = await this.driveService.findByName(fileName, this.databaseFolderId, 'application/json');

    await this.driveService.writeJsonFile(
      fileName,
      {
        collection: collectionName,
        field: fieldName,
        mappings,
      },
      this.databaseFolderId,
      fileId || undefined
    );
  }

  /**
   * Updates all index files for a collection following a write operation (insert/update/delete).
   */
  async updateIndexes(
    collectionName: string,
    indexedFields: string[],
    newRow: any | null, // null for delete
    oldRow: any | null, // null for insert
    location: IndexMapping // where the row resides now (only relevant for insert/update)
  ): Promise<void> {
    // We always maintain an index on '_id'
    const fieldsToUpdate = ['_id', ...indexedFields];

    for (const field of fieldsToUpdate) {
      const mappings = await this.loadIndex(collectionName, field);

      // 1. Remove old value mapping
      if (oldRow && oldRow[field] !== undefined) {
        const oldKey = String(oldRow[field]);
        delete mappings[oldKey];
      }

      // 2. Add new value mapping
      if (newRow && newRow[field] !== undefined) {
        const newKey = String(newRow[field]);
        mappings[newKey] = location;
      }

      await this.saveIndex(collectionName, field, mappings);
    }
  }

  /**
   * Helper to perform O(1) lookup on an indexed field.
   */
  async lookup(collectionName: string, fieldName: string, value: any): Promise<IndexMapping | null> {
    const mappings = await this.loadIndex(collectionName, fieldName);
    return mappings[String(value)] || null;
  }
}
