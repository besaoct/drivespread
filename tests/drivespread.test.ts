import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchemaValidator } from '../src/schema.js';
import { QueryEngine } from '../src/query.js';
import { CacheManager } from '../src/cache.js';
import { LockManager } from '../src/locks.js';
import { DriveSpread } from '../src/database.js';

// Virtual Google Drive and Sheets storage mock
let virtualDrive: Record<string, { id: string; name: string; mimeType: string; parents?: string[]; content?: string }> = {};
let virtualSheets: Record<string, string[][]> = {};

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        JWT: class {
          getAccessToken() { return { token: 'mock-token' }; }
        }
      },
      drive: () => ({
        files: {
          list: async ({ q }: any) => {
            const nameMatch = q.match(/name\s*=\s*'([^']+)'/);
            const parentMatch = q.match(/'([^']+)'\s+in\s+parents/);
            const mimeMatch = q.match(/mimeType\s*=\s*'([^']+)'/);

            const name = nameMatch ? nameMatch[1] : null;
            const parent = parentMatch ? parentMatch[1] : null;
            const mime = mimeMatch ? mimeMatch[1] : null;

            const files = Object.values(virtualDrive).filter(f => {
              if (name && f.name !== name) return false;
              if (parent && (!f.parents || !f.parents.includes(parent))) return false;
              if (mime && f.mimeType !== mime) return false;
              return true;
            });

            return { data: { files } };
          },
          create: async ({ requestBody, media }: any) => {
            const id = 'file-' + Math.random().toString(36).substring(2, 9);
            virtualDrive[id] = {
              id,
              name: requestBody.name,
              mimeType: requestBody.mimeType,
              parents: requestBody.parents,
              content: media ? media.body : undefined
            };
            if (requestBody.mimeType === 'application/vnd.google-apps.spreadsheet') {
              virtualSheets[id] = [];
            }
            return { data: { id } };
          },
          update: async ({ fileId, media }: any) => {
            if (virtualDrive[fileId]) {
              virtualDrive[fileId].content = media.body;
            }
            return { data: { id: fileId } };
          },
          get: async ({ fileId, alt }: any) => {
            const file = virtualDrive[fileId];
            if (!file) throw new Error('File not found');
            if (alt === 'media') {
              return { data: file.content };
            }
            return { data: { mimeType: file.mimeType } };
          },
          delete: async ({ fileId }: any) => {
            delete virtualDrive[fileId];
            delete virtualSheets[fileId];
          }
        },
        permissions: {
          create: async () => ({})
        }
      }),
      sheets: () => ({
        spreadsheets: {
          get: async ({ spreadsheetId }: any) => {
            const rows = virtualSheets[spreadsheetId] || [];
            const rowCount = Math.max(100, rows.length);
            return {
              data: {
                sheets: [{
                  properties: {
                    gridProperties: {
                      rowCount,
                      columnCount: 26
                    }
                  }
                }]
              }
            };
          },
          values: {
            get: async ({ spreadsheetId, range }: any) => {
              const rows = virtualSheets[spreadsheetId] || [];
              if (range && range.includes('!A')) {
                const match = range.match(/Sheet1!A(\d+):ZZ(\d+)/);
                if (match) {
                  const start = parseInt(match[1], 10) - 1;
                  const end = parseInt(match[2], 10);
                  return { data: { values: rows.slice(start, end) } };
                }
                const singleRowMatch = range.match(/Sheet1!A(\d+)/);
                if (singleRowMatch) {
                  const idx = parseInt(singleRowMatch[1], 10) - 1;
                  return { data: { values: rows[idx] ? [rows[idx]] : [] } };
                }
              }
              return { data: { values: rows } };
            },
            update: async ({ spreadsheetId, range, requestBody }: any) => {
              if (!virtualSheets[spreadsheetId]) {
                virtualSheets[spreadsheetId] = [];
              }
              const values = requestBody.values;
              const match = range.match(/Sheet1!A(\d+)/);
              if (match) {
                const idx = parseInt(match[1], 10) - 1;
                for (let i = 0; i < values.length; i++) {
                  virtualSheets[spreadsheetId][idx + i] = values[i];
                }
              }
              return { data: {} };
            },
            batchUpdate: async ({ spreadsheetId, requestBody }: any) => {
              if (!virtualSheets[spreadsheetId]) {
                virtualSheets[spreadsheetId] = [];
              }
              for (const update of requestBody.data) {
                const match = update.range.match(/Sheet1!A(\d+)/);
                if (match) {
                  const idx = parseInt(match[1], 10) - 1;
                  for (let i = 0; i < update.values.length; i++) {
                    virtualSheets[spreadsheetId][idx + i] = update.values[i];
                  }
                }
              }
              return { data: {} };
            },
            batchClear: async ({ spreadsheetId, requestBody }: any) => {
              const ranges = requestBody.ranges;
              for (const range of ranges) {
                const match = range.match(/Sheet1!A(\d+):ZZ(\d+)/);
                if (match) {
                  const start = parseInt(match[1], 10) - 1;
                  const end = parseInt(match[2], 10);
                  for (let i = start; i < end; i++) {
                    if (virtualSheets[spreadsheetId][i]) {
                      virtualSheets[spreadsheetId][i] = virtualSheets[spreadsheetId][i].map(() => '');
                    }
                  }
                }
              }
              return { data: {} };
            }
          }
        }
      })
    }
  };
});

describe('SchemaValidator', () => {
  const schema = {
    name: { type: 'string' as const, required: true },
    age: { type: 'number' as const, min: 0, max: 120 },
    role: { type: 'string' as const, enum: ['admin', 'user'], default: 'user' },
    tags: { type: 'array' as const, default: () => ['new'] },
  };

  it('should validate and apply default values on insert', () => {
    const data = { name: 'Alice', age: 25 };
    const validated = SchemaValidator.validate(schema, data);
    expect(validated.name).toBe('Alice');
    expect(validated.age).toBe(25);
    expect(validated.role).toBe('user');
    expect(validated.tags).toEqual(['new']);
  });

  it('should throw error for missing required fields', () => {
    const data = { age: 25 };
    expect(() => SchemaValidator.validate(schema, data)).toThrow(/required/);
  });

  it('should validate range constraints (min/max)', () => {
    const data = { name: 'Alice', age: 150 };
    expect(() => SchemaValidator.validate(schema, data)).toThrow(/at most 120/);
  });

  it('should serialize and deserialize complex data types correctly', () => {
    const record = {
      name: 'Alice',
      age: 25,
      role: 'user',
      tags: ['a', 'b'],
    };

    const serialized = SchemaValidator.serializeRow(schema, record);
    expect(typeof serialized.tags).toBe('string');
    expect(serialized.tags).toBe('["a","b"]');

    const deserialized = SchemaValidator.deserializeRow(schema, serialized as any);
    expect(Array.isArray(deserialized.tags)).toBe(true);
    expect(deserialized.tags).toEqual(['a', 'b']);
  });
});

describe('QueryEngine', () => {
  const rows = [
    { _id: '1', name: 'Alice', age: 25, role: 'admin' },
    { _id: '2', name: 'Bob', age: 30, role: 'user' },
    { _id: '3', name: 'Charlie', age: 18, role: 'user' },
  ];

  it('should filter rows by equality', () => {
    const filtered = QueryEngine.filter(rows, { role: 'user' });
    expect(filtered.length).toBe(2);
    expect(filtered.map((r) => r.name)).toEqual(['Bob', 'Charlie']);
  });

  it('should filter rows using operators ($gte, $lt)', () => {
    const filtered = QueryEngine.filter(rows, { age: { $gte: 25 } });
    expect(filtered.length).toBe(2);
    expect(filtered.map((r) => r.name)).toEqual(['Alice', 'Bob']);
  });

  it('should sort rows correctly', () => {
    const sorted = QueryEngine.sort(rows, { age: 'asc' });
    expect(sorted.map((r) => r.name)).toEqual(['Charlie', 'Alice', 'Bob']);

    const sortedDesc = QueryEngine.sort(rows, { age: 'desc' });
    expect(sortedDesc.map((r) => r.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });

  it('should project specific columns', () => {
    const projected = QueryEngine.project(rows, ['name']);
    expect(projected[0]).toHaveProperty('name');
    expect(projected[0]).toHaveProperty('_id');
    expect(projected[0]).not.toHaveProperty('age');
  });

  it('should apply update operators ($inc/$dec)', () => {
    const row = { name: 'Inventory', stock: 10 };
    const updated = QueryEngine.applyUpdateOperators(row, { stock: { $dec: 2 } });
    expect(updated.stock).toBe(8);
  });
});

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager(5);
  });

  it('should set, get and invalidate cache correctly', () => {
    const rows = [{ _id: '1', name: 'Alice' }];
    cache.set('users', rows);
    expect(cache.get('users')).toEqual(rows);

    cache.invalidate('users');
    expect(cache.get('users')).toBeNull();
  });

  it('should automatically invalidate expired items', async () => {
    const shortCache = new CacheManager(0.1);
    shortCache.set('users', [{ _id: '1' }]);
    
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(shortCache.get('users')).toBeNull();
  });

  it('should support write-through updates', () => {
    cache.set('users', [{ _id: '1', name: 'Alice', _version: 1, _updatedAt: '' }]);
    
    cache.insert('users', { _id: '2', name: 'Bob' });
    expect(cache.get('users')?.length).toBe(2);

    cache.update('users', '1', { name: 'Alice Updated' }, 2, 'now');
    const records = cache.get('users') || [];
    expect(records.find((r) => r._id === '1')?.name).toBe('Alice Updated');
    expect(records.find((r) => r._id === '1')?._version).toBe(2);

    cache.delete('users', '2');
    expect(cache.get('users')?.length).toBe(1);
  });
});

describe('LockManager', () => {
  it('should retry operation on conflict', async () => {
    const driveMock = {} as any;
    const locks = new LockManager(driveMock);
    
    let calls = 0;
    const task = async () => {
      calls++;
      if (calls < 3) {
        throw new Error('version mismatch error');
      }
      return 'success';
    };

    const res = await locks.retryOnConflict(task, 5, 5);
    expect(res).toBe('success');
    expect(calls).toBe(3);
  });
});

describe('DriveSpread Integration End-to-End', () => {
  let db: DriveSpread;

  beforeEach(() => {
    virtualDrive = {};
    virtualSheets = {};
    db = new DriveSpread({
      db: 'sandbox',
      credentials: {
        client_email: 'mock@sa.com',
        private_key: 'mock-key'
      }
    });
  });

  it('should initialize folders, locks and load metadata', async () => {
    await db.init();
    expect(db.getFolderId()).toBeDefined();
    expect(db.getMetadata().db).toBe('sandbox');
  });

  it('should perform CRUD operations and maintain O(1) lookup indexes', async () => {
    const users = db.collection('users', {
      name: { type: 'string', required: true },
      email: { type: 'string', unique: true }
    }, {
      indexes: ['email']
    });

    // 1. Insert
    const u1 = await users.insert({ name: 'Alice', email: 'alice@g.com' });
    expect(u1._id).toBeDefined();
    expect(u1._version).toBe(1);

    // 2. Fetch (uses O(1) index lookup)
    const list = await users.find({ email: 'alice@g.com' });
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Alice');

    // 3. Update
    await users.updateById(u1._id!, { name: 'Alice Updated' });
    const checkUpdate = await users.findById(u1._id!);
    expect(checkUpdate?.name).toBe('Alice Updated');
    expect(checkUpdate?._version).toBe(2);

    // 4. Delete
    await users.deleteById(u1._id!);
    const checkDeleted = await users.findById(u1._id!);
    expect(checkDeleted).toBeNull();
  });

  it('should support best-effort transaction commits and rollbacks', async () => {
    const products = db.collection('products', {
      sku: { type: 'string', required: true },
      stock: { type: 'number' }
    });

    const item = await products.insert({ sku: 'IPHONE', stock: 10 });

    let failed = false;
    try {
      await db.transaction(async (tx) => {
        await tx.collection('products').updateById(item._id!, { stock: { $dec: 2 } });
        await tx.collection('products').insert({ sku: 'MACBOOK', stock: 5 });
        // Force rollback
        throw new Error('Simulation rollback');
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);

    // Rollback validation: stock remains 10, MACBOOK not inserted
    const itemCheck = await products.findById(item._id!);
    expect(itemCheck?.stock).toBe(10);

    const checkMacbook = await products.findOne({ sku: 'MACBOOK' });
    expect(checkMacbook).toBeNull();
  });

  it('should enforce relations joins and cascade deletes', async () => {
    const clients = db.collection('clients', {
      name: { type: 'string', required: true }
    });

    const invoices = db.collection('invoices', {
      clientId: { type: 'string', required: true },
      amount: { type: 'number' }
    }, {
      relations: {
        client: {
          type: 'belongsTo',
          collection: 'clients',
          foreignKey: 'clientId',
          onDelete: 'cascade'
        }
      }
    });

    const c = await clients.insert({ name: 'Google' });
    const inv = await invoices.insert({ clientId: c._id!, amount: 5000 });

    // Join populate check
    const list = await invoices.find({ _id: inv._id! }, { populate: ['client'] });
    expect(list.length).toBe(1);
    expect(list[0].client).toBeDefined();
    expect(list[0].client.name).toBe('Google');

    // Cascade delete check
    await clients.deleteById(c._id!);
    const checkInv = await invoices.findById(inv._id!);
    expect(checkInv).toBeNull(); // cascaded
  });
});
