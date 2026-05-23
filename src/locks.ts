import { GoogleDriveService } from './drive.js';
import { v4 as uuidv4 } from 'uuid';

export class LockManager {
  private driveService: GoogleDriveService;
  private locksSpreadsheetId?: string;

  constructor(driveService: GoogleDriveService) {
    this.driveService = driveService;
  }

  setLocksSpreadsheetId(id: string) {
    this.locksSpreadsheetId = id;
  }

  /**
   * Run a function with retries on conflict (optimistic lock retry)
   */
  async retryOnConflict<T>(
    operation: () => Promise<T>,
    maxRetries = 5,
    baseDelayMs = 100
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (err: any) {
        attempt++;
        if (attempt >= maxRetries || !err.message?.includes('conflict') && !err.message?.includes('version mismatch')) {
          throw err;
        }
        // Exponential backoff with jitter
        const delay = Math.min(
          1000,
          baseDelayMs * Math.pow(2, attempt) + Math.random() * 50
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Acquire a pessimistic distributed lock on a given key.
   * Uses the _locks spreadsheet as a mutex.
   * TTL is in seconds.
   */
  async acquireLock(
    key: string,
    ttlSeconds = 30,
    maxRetries = 10,
    retryDelayMs = 200
  ): Promise<string> {
    if (!this.locksSpreadsheetId) {
      throw new Error('Locks spreadsheet ID not initialized.');
    }

    const ownerId = uuidv4();
    let attempt = 0;

    while (attempt < maxRetries) {
      const now = Date.now();
      const expiresAt = now + ttlSeconds * 1000;

      // 1. Read all locks
      const rows = await this.driveService.readSheetValues(this.locksSpreadsheetId, 'Sheet1!A:D');
      const lockRows = rows.slice(1);

      let keyRowIndex = -1;
      let existingLock: { owner: string; expiresAt: number } | null = null;

      for (let i = 0; i < lockRows.length; i++) {
        if (lockRows[i][0] === key) {
          keyRowIndex = i + 2; // 1-indexed, skipping header
          existingLock = {
            owner: lockRows[i][1],
            expiresAt: parseInt(lockRows[i][3], 10),
          };
          break;
        }
      }

      // If active lock exists and not expired
      if (existingLock && now < existingLock.expiresAt) {
        attempt++;
        const jitter = Math.random() * 50;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs + jitter));
        continue;
      }

      // If not exists, or exists but expired, we write our lock
      if (keyRowIndex !== -1) {
        // Update existing row
        await this.driveService.updateSheetValues(
          this.locksSpreadsheetId,
          `Sheet1!A${keyRowIndex}:D${keyRowIndex}`,
          [[key, ownerId, String(now), String(expiresAt)]]
        );
      } else {
        // Append new row
        const newRowIndex = lockRows.length + 2;
        await this.driveService.updateSheetValues(
          this.locksSpreadsheetId,
          `Sheet1!A${newRowIndex}:D${newRowIndex}`,
          [[key, ownerId, String(now), String(expiresAt)]]
        );
      }

      // 2. Read back to verify ownership (prevent write race conditions)
      const verifyRows = await this.driveService.readSheetValues(this.locksSpreadsheetId, 'Sheet1!A:D');
      const verifyLockRows = verifyRows.slice(1);
      const verifiedLock = verifyLockRows.find((r) => r[0] === key);

      if (verifiedLock && verifiedLock[1] === ownerId) {
        // We own it!
        return ownerId;
      }

      // Someone else overwrote it, retry
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs + Math.random() * 50));
    }

    throw new Error(`Failed to acquire lock for key "${key}" after ${maxRetries} attempts.`);
  }

  /**
   * Release a pessimistic distributed lock if we own it.
   */
  async releaseLock(key: string, ownerId: string): Promise<void> {
    if (!this.locksSpreadsheetId) return;

    const rows = await this.driveService.readSheetValues(this.locksSpreadsheetId, 'Sheet1!A:D');
    const lockRows = rows.slice(1);

    for (let i = 0; i < lockRows.length; i++) {
      if (lockRows[i][0] === key && lockRows[i][1] === ownerId) {
        const rowIndex = i + 2;
        // Overwrite cell or clear. Clearing values is cleaner.
        // We can just clear the row or set values to empty strings.
        await this.driveService.updateSheetValues(
          this.locksSpreadsheetId,
          `Sheet1!A${rowIndex}:D${rowIndex}`,
          [['', '', '', '']]
        );
        break;
      }
    }
  }
}
