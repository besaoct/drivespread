import { SchemaDefinition, FieldDefinition, RowData } from './types.js';

export class SchemaValidator {
  /**
   * Validates row data against the schema, applying defaults and casting types where appropriate.
   */
  static validate(
    schema: SchemaDefinition,
    data: RowData,
    isUpdate = false
  ): RowData {
    const validated: RowData = { ...data };

    for (const [key, fieldDef] of Object.entries(schema)) {
      let val = validated[key];

      // Handle default value on insert
      if (val === undefined && !isUpdate) {
        if (fieldDef.default !== undefined) {
          val = typeof fieldDef.default === 'function' ? fieldDef.default() : fieldDef.default;
          validated[key] = val;
        }
      }

      // Check required
      if (fieldDef.required && val === undefined) {
        throw new Error(`Field "${key}" is required by the schema.`);
      }

      // If value exists, check type and constraints
      if (val !== undefined && val !== null) {
        this.validateType(key, val, fieldDef.type);
        this.validateConstraints(key, val, fieldDef);
      }
    }

    return validated;
  }

  /**
   * Type validation
   */
  private static validateType(key: string, val: any, type: string) {
    switch (type) {
      case 'string':
      case 'blob': // Blobs are references (string fileId)
        if (typeof val !== 'string') {
          throw new Error(`Field "${key}" must be a string.`);
        }
        break;
      case 'number':
        if (typeof val !== 'number' || isNaN(val)) {
          throw new Error(`Field "${key}" must be a number.`);
        }
        break;
      case 'boolean':
        if (typeof val !== 'boolean') {
          throw new Error(`Field "${key}" must be a boolean.`);
        }
        break;
      case 'date':
        const dateVal = val instanceof Date ? val : new Date(val);
        if (isNaN(dateVal.getTime())) {
          throw new Error(`Field "${key}" must be a valid date.`);
        }
        break;
      case 'array':
        if (!Array.isArray(val)) {
          throw new Error(`Field "${key}" must be an array.`);
        }
        break;
      case 'object':
        if (typeof val !== 'object' || val === null || Array.isArray(val)) {
          throw new Error(`Field "${key}" must be an object.`);
        }
        break;
      default:
        throw new Error(`Unsupported schema type "${type}" for field "${key}".`);
    }
  }

  /**
   * Constraint validation
   */
  private static validateConstraints(key: string, val: any, fieldDef: FieldDefinition) {
    // Min constraint
    if (fieldDef.min !== undefined) {
      if (fieldDef.type === 'number' && val < fieldDef.min) {
        throw new Error(`Field "${key}" must be at least ${fieldDef.min}.`);
      }
      if (fieldDef.type === 'string' && val.length < fieldDef.min) {
        throw new Error(`Field "${key}" length must be at least ${fieldDef.min} characters.`);
      }
    }

    // Max constraint
    if (fieldDef.max !== undefined) {
      if (fieldDef.type === 'number' && val > fieldDef.max) {
        throw new Error(`Field "${key}" must be at most ${fieldDef.max}.`);
      }
      if (fieldDef.type === 'string' && val.length > fieldDef.max) {
        throw new Error(`Field "${key}" length must be at most ${fieldDef.max} characters.`);
      }
    }

    // Enum constraint
    if (fieldDef.enum !== undefined) {
      if (!fieldDef.enum.includes(val)) {
        throw new Error(`Field "${key}" value "${val}" must be one of: ${fieldDef.enum.join(', ')}.`);
      }
    }

    // Regex constraint
    if (fieldDef.regex !== undefined) {
      const regex = typeof fieldDef.regex === 'string' ? new RegExp(fieldDef.regex) : fieldDef.regex;
      if (!regex.test(String(val))) {
        throw new Error(`Field "${key}" value does not match pattern.`);
      }
    }
  }

  /**
   * Serialize values from JavaScript objects to Google Sheets representation (strings/numbers/booleans)
   */
  static serializeRow(schema: SchemaDefinition, data: RowData): Record<string, string | number | boolean> {
    const serialized: Record<string, string | number | boolean> = {};

    // First serialize system fields
    const systemFields = ['_id', '_version', '_createdAt', '_updatedAt'];
    for (const key of systemFields) {
      if (data[key] !== undefined) {
        serialized[key] = String(data[key]);
      }
    }

    // Then serialize schema fields
    for (const [key, fieldDef] of Object.entries(schema)) {
      const val = data[key];
      if (val === undefined || val === null) {
        serialized[key] = '';
        continue;
      }

      switch (fieldDef.type) {
        case 'array':
        case 'object':
          serialized[key] = JSON.stringify(val);
          break;
        case 'date':
          serialized[key] = val instanceof Date ? val.toISOString() : new Date(val).toISOString();
          break;
        case 'boolean':
          serialized[key] = val ? 'TRUE' : 'FALSE';
          break;
        default:
          serialized[key] = val;
      }
    }

    return serialized;
  }

  /**
   * Deserialize values from Google Sheets representation back to JavaScript types
   */
  static deserializeRow(schema: SchemaDefinition, row: Record<string, string>): RowData {
    const deserialized: RowData = {};

    // Deserialize system fields first
    if (row['_id'] !== undefined) deserialized._id = row['_id'];
    if (row['_version'] !== undefined) deserialized._version = parseInt(row['_version'], 10);
    if (row['_createdAt'] !== undefined) deserialized._createdAt = row['_createdAt'];
    if (row['_updatedAt'] !== undefined) deserialized._updatedAt = row['_updatedAt'];

    // Deserialize schema fields
    for (const [key, fieldDef] of Object.entries(schema)) {
      const rawVal = row[key];
      if (rawVal === undefined || rawVal === '' || rawVal === null) {
        continue;
      }

      switch (fieldDef.type) {
        case 'number':
          deserialized[key] = Number(rawVal);
          break;
        case 'boolean':
          deserialized[key] = rawVal === 'TRUE' || rawVal === 'true' || rawVal === '1';
          break;
        case 'date':
          deserialized[key] = new Date(rawVal);
          break;
        case 'array':
        case 'object':
          try {
            deserialized[key] = JSON.parse(rawVal);
          } catch {
            deserialized[key] = rawVal; // Fallback to raw string if parsing fails
          }
          break;
        default:
          deserialized[key] = rawVal;
      }
    }

    return deserialized;
  }
}
