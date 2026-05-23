import { GoogleDriveService } from './drive.js';
import { DatabaseMetadata, SchemaDefinition } from './types.js';

export class ShardManager {
  private driveService: GoogleDriveService;
  private databaseFolderId?: string;

  constructor(driveService: GoogleDriveService) {
    this.driveService = driveService;
  }

  setDatabaseFolderId(id: string) {
    this.databaseFolderId = id;
  }

  /**
   * Get the active spreadsheet shard for writing, auto-sharding if cell limits are reached.
   */
  async getActiveWriteShard(
    collectionName: string,
    metadata: DatabaseMetadata,
    schema: SchemaDefinition,
    saveMetadataCallback: (metadata: DatabaseMetadata) => Promise<void>
  ): Promise<string> {
    if (!this.databaseFolderId) {
      throw new Error('Database folder ID not initialized.');
    }

    const colMeta = metadata.collections[collectionName];
    if (!colMeta || colMeta.shards.length === 0) {
      throw new Error(`Collection "${collectionName}" metadata is missing or has no shards.`);
    }

    const shardCount = colMeta.shards.length;
    const activeShardIndex = shardCount - 1;
    const activeShardId = colMeta.shards[activeShardIndex];
    const activeShardRowCount = colMeta.rowCounts[activeShardIndex];

    // Calculate cell count: rows * (schema fields + system columns)
    const numColumns = Object.keys(schema).length + 4; // schema + _id, _version, _createdAt, _updatedAt
    const currentCells = activeShardRowCount * numColumns;

    // Safety buffer limit: 9.5M cells
    const CELL_LIMIT = 9500000;

    if (currentCells >= CELL_LIMIT) {
      // We must shard! Create a new spreadsheet
      const newShardIndex = shardCount + 1;
      const newShardName = `${metadata.db}_${collectionName}_shard_${newShardIndex}`;
      
      const newShardId = await this.driveService.createSpreadsheet(newShardName, this.databaseFolderId);

      // Initialize headers: system columns + user columns
      const headers = ['_id', '_version', '_createdAt', '_updatedAt', ...Object.keys(schema)];
      await this.driveService.initSheetHeaders(newShardId, headers);

      // Update database metadata
      colMeta.shards.push(newShardId);
      colMeta.rowCounts.push(0); // Start at 0 rows (excluding header)

      await saveMetadataCallback(metadata);

      return newShardId;
    }

    return activeShardId;
  }

  /**
   * Increment row count in metadata after insert
   */
  incrementRowCount(collectionName: string, metadata: DatabaseMetadata, shardId: string): DatabaseMetadata {
    const colMeta = metadata.collections[collectionName];
    const shardIndex = colMeta.shards.indexOf(shardId);
    if (shardIndex !== -1) {
      colMeta.rowCounts[shardIndex] = (colMeta.rowCounts[shardIndex] || 0) + 1;
    }
    return metadata;
  }

  /**
   * Decrement row count in metadata after delete
   */
  decrementRowCount(collectionName: string, metadata: DatabaseMetadata, shardId: string): DatabaseMetadata {
    const colMeta = metadata.collections[collectionName];
    const shardIndex = colMeta.shards.indexOf(shardId);
    if (shardIndex !== -1) {
      colMeta.rowCounts[shardIndex] = Math.max(0, (colMeta.rowCounts[shardIndex] || 0) - 1);
    }
    return metadata;
  }
}
