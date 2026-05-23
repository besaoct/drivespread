import { QueryFilter, QueryOperator, RowData } from './types.js';

export class QueryEngine {
  /**
   * Filters in-memory rows based on query criteria.
   */
  static filter(rows: RowData[], filter: QueryFilter): RowData[] {
    if (!filter || Object.keys(filter).length === 0) {
      return rows;
    }

    return rows.filter((row) => {
      for (const [key, condition] of Object.entries(filter)) {
        const val = row[key];

        if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
          // It's an operator object
          const op = condition as QueryOperator;

          if ('$eq' in op && val !== op.$eq) return false;
          if ('$ne' in op && val === op.$ne) return false;
          
          if ('$gt' in op) {
            if (val === undefined || val === null || !(val > (op.$gt as any))) return false;
          }
          if ('$gte' in op) {
            if (val === undefined || val === null || !(val >= (op.$gte as any))) return false;
          }
          if ('$lt' in op) {
            if (val === undefined || val === null || !(val < (op.$lt as any))) return false;
          }
          if ('$lte' in op) {
            if (val === undefined || val === null || !(val <= (op.$lte as any))) return false;
          }
          if ('$in' in op && op.$in) {
            if (!op.$in.includes(val)) return false;
          }
          if ('$contains' in op && op.$contains) {
            if (val === undefined || val === null || !String(val).includes(op.$contains)) return false;
          }
          if ('$startsWith' in op && op.$startsWith) {
            if (val === undefined || val === null || !String(val).startsWith(op.$startsWith)) return false;
          }
        } else {
          // Plain equality comparison
          // Handle Date comparison
          if (val instanceof Date && condition instanceof Date) {
            if (val.getTime() !== condition.getTime()) return false;
          } else if (val instanceof Date) {
            if (val.toISOString() !== String(condition)) return false;
          } else if (condition instanceof Date) {
            if (String(val) !== condition.toISOString()) return false;
          } else {
            if (val !== condition) return false;
          }
        }
      }
      return true;
    });
  }

  /**
   * Sorts rows in-memory.
   * sortSpec example: { age: 'desc', name: 'asc' }
   */
  static sort(rows: RowData[], sortSpec: Record<string, 'asc' | 'desc'>): RowData[] {
    const sorted = [...rows];
    const fields = Object.keys(sortSpec);
    if (fields.length === 0) return sorted;

    sorted.sort((a, b) => {
      for (const field of fields) {
        const direction = sortSpec[field];
        let valA = a[field];
        let valB = b[field];

        if (valA === valB) continue;
        if (valA === undefined || valA === null) return direction === 'asc' ? -1 : 1;
        if (valB === undefined || valB === null) return direction === 'asc' ? 1 : -1;

        // Date comparison
        if (valA instanceof Date && valB instanceof Date) {
          return direction === 'asc'
            ? valA.getTime() - valB.getTime()
            : valB.getTime() - valA.getTime();
        }

        // Standard comparison
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return sorted;
  }

  /**
   * Project specific fields (select fields)
   */
  static project(rows: RowData[], selectFields: string[]): RowData[] {
    if (!selectFields || selectFields.length === 0) {
      return rows;
    }
    // Make sure we always include system ID for record tracking unless explicitly excluded
    const fieldsToKeep = new Set([...selectFields, '_id', '_version', '_createdAt', '_updatedAt']);

    return rows.map((row) => {
      const projected: RowData = {};
      for (const key of fieldsToKeep) {
        if (row[key] !== undefined) {
          projected[key] = row[key];
        }
      }
      return projected;
    });
  }

  /**
   * Apply update operators like $inc and $dec to numeric fields
   */
  static applyUpdateOperators(currentRow: RowData, updatePayload: Record<string, any>): RowData {
    const updated = { ...currentRow };
    for (const [key, val] of Object.entries(updatePayload)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        if ('$inc' in val) {
          const currentVal = Number(currentRow[key] || 0);
          updated[key] = currentVal + Number(val.$inc);
        } else if ('$dec' in val) {
          const currentVal = Number(currentRow[key] || 0);
          updated[key] = currentVal - Number(val.$dec);
        } else {
          updated[key] = val;
        }
      } else {
        updated[key] = val;
      }
    }
    return updated;
  }
}
