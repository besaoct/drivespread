import { GoogleDriveService } from './drive.js';

interface WriteTask {
  spreadsheetId: string;
  range: string;
  values: any[][];
  type: 'update' | 'clear';
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

export class WriteQueue {
  private driveService: GoogleDriveService;
  private queue: WriteTask[] = [];
  private isProcessing = false;
  private flushIntervalMs: number;
  private maxBatchSize: number;
  private consecutive429s = 0;

  constructor(driveService: GoogleDriveService, flushIntervalMs = 100, maxBatchSize = 50) {
    this.driveService = driveService;
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
  }

  /**
   * Queue a values update operation
   */
  enqueueUpdate(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        spreadsheetId,
        range,
        values,
        type: 'update',
        resolve,
        reject,
      });
      this.triggerFlush();
    });
  }

  /**
   * Queue a clear operation
   */
  enqueueClear(spreadsheetId: string, range: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        spreadsheetId,
        range,
        values: [],
        type: 'clear',
        resolve,
        reject,
      });
      this.triggerFlush();
    });
  }

  private triggerFlush() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    setTimeout(() => this.flush(), this.flushIntervalMs);
  }

  private async flush() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
      }

    // 1. Take a batch of up to maxBatchSize tasks
    const batchTasks = this.queue.splice(0, this.maxBatchSize);

    // 2. Group tasks by spreadsheet ID and type to maximize batching
    const updatesBySheet: Record<string, { range: string; values: any[][] }[]> = {};
    const clearsBySheet: Record<string, string[]> = {};
    const sheetTasksMap: Record<string, WriteTask[]> = {};

    for (const task of batchTasks) {
      const sheetId = task.spreadsheetId;
      if (!sheetTasksMap[sheetId]) {
        sheetTasksMap[sheetId] = [];
      }
      sheetTasksMap[sheetId].push(task);

      if (task.type === 'update') {
        if (!updatesBySheet[sheetId]) {
          updatesBySheet[sheetId] = [];
        }
        updatesBySheet[sheetId].push({ range: task.range, values: task.values });
      } else {
        if (!clearsBySheet[sheetId]) {
          clearsBySheet[sheetId] = [];
        }
        clearsBySheet[sheetId].push(task.range);
      }
    }

    // 3. Process each sheet's batched requests
    const promises: Promise<void>[] = [];

    // Check rate limit backoff if we recently encountered 429s
    if (this.consecutive429s > 0) {
      const backoffDelay = Math.min(10000, 1000 * Math.pow(2, this.consecutive429s) + Math.random() * 200);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }

    // Process updates
    for (const [spreadsheetId, data] of Object.entries(updatesBySheet)) {
      const tasks = sheetTasksMap[spreadsheetId].filter((t) => t.type === 'update');
      promises.push(
        (async () => {
          try {
            await this.driveService.sheets.spreadsheets.values.batchUpdate({
              spreadsheetId,
              requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: data.map((d) => ({
                  range: d.range,
                  values: d.values,
                })),
              },
            });
            this.consecutive429s = 0;
            tasks.forEach((t) => t.resolve(undefined));
          } catch (err: any) {
            if (err.status === 429 || err.code === 429) {
              this.consecutive429s++;
              // Re-queue tasks to the front
              this.queue.unshift(...tasks);
            } else {
              tasks.forEach((t) => t.reject(err));
            }
          }
        })()
      );
    }

    // Process clears
    for (const [spreadsheetId, ranges] of Object.entries(clearsBySheet)) {
      const tasks = sheetTasksMap[spreadsheetId].filter((t) => t.type === 'clear');
      promises.push(
        (async () => {
          try {
            // Clear multiple ranges in a single call using batchClear
            await this.driveService.sheets.spreadsheets.values.batchClear({
              spreadsheetId,
              requestBody: {
                ranges,
              },
            });
            this.consecutive429s = 0;
            tasks.forEach((t) => t.resolve(undefined));
          } catch (err: any) {
            if (err.status === 429 || err.code === 429) {
              this.consecutive429s++;
              this.queue.unshift(...tasks);
            } else {
              tasks.forEach((t) => t.reject(err));
            }
          }
        })()
      );
    }

    await Promise.all(promises);

    // Continue processing
    if (this.queue.length > 0) {
      setTimeout(() => this.flush(), this.flushIntervalMs);
    } else {
      this.isProcessing = false;
    }
  }
}
