import { RowData } from './types.js';

export class CacheManager {
  private cache: Record<string, { data: RowData[]; fetchedAt: number }> = {};
  private defaultTtlSeconds: number;

  constructor(defaultTtlSeconds = 30) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  /**
   * Get cached rows for a collection if not expired.
   */
  get(collectionName: string, ttlSeconds = this.defaultTtlSeconds): RowData[] | null {
    const entry = this.cache[collectionName];
    if (!entry) return null;

    const age = (Date.now() - entry.fetchedAt) / 1000;
    if (age > ttlSeconds) {
      delete this.cache[collectionName];
      return null;
    }
    // Return a copy to avoid mutation bugs by reference
    return JSON.parse(JSON.stringify(entry.data));
  }

  /**
   * Set cache entry for a collection.
   */
  set(collectionName: string, data: RowData[]) {
    this.cache[collectionName] = {
      data: JSON.parse(JSON.stringify(data)),
      fetchedAt: Date.now(),
    };
  }

  /**
   * Manually invalidate a cache entry.
   */
  invalidate(collectionName: string) {
    delete this.cache[collectionName];
  }

  /**
   * Write-through insert.
   */
  insert(collectionName: string, row: RowData) {
    const entry = this.cache[collectionName];
    if (entry) {
      entry.data.push(JSON.parse(JSON.stringify(row)));
    }
  }

  /**
   * Write-through update.
   */
  update(
    collectionName: string,
    rowId: string,
    updatedFields: Partial<RowData>,
    version: number,
    updatedAt: string
  ) {
    const entry = this.cache[collectionName];
    if (entry) {
      const idx = entry.data.findIndex((r) => r._id === rowId);
      if (idx !== -1) {
        entry.data[idx] = {
          ...entry.data[idx],
          ...updatedFields,
          _version: version,
          _updatedAt: updatedAt,
        };
      }
    }
  }

  /**
   * Write-through delete.
   */
  delete(collectionName: string, rowId: string) {
    const entry = this.cache[collectionName];
    if (entry) {
      entry.data = entry.data.filter((r) => r._id !== rowId);
    }
  }
}
