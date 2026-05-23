import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DriveSpread } from './database.js';
import { QueryEngine } from './query.js';
import { ServerOptions, RowData, WsEvent, PermissionContext } from './types.js';

export async function startServer(db: DriveSpread, options: ServerOptions = {}) {
  const app = express();
  const port = options.port || 3000;
  const secret = options.auth?.secret || 'drivespread-default-jwt-secret';

  // Middleware
  app.use(cors(options.cors?.origins ? { origin: options.cors.origins } : {}));
  
  // Rate limiting
  if (options.rateLimit) {
    app.use(
      rateLimit({
        windowMs: options.rateLimit.windowMs || 60000,
        max: options.rateLimit.max || 100,
        message: { error: 'Too many requests, please try again later.' },
      })
    );
  }

  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));
  // Parse raw body for binary blob uploads
  app.use('/api/blobs/upload', express.raw({ type: '*/*', limit: '50mb' }));

  // Helper to authenticate requests
  const authenticate = (req: any, res: any, next: any) => {
    if (options.auth?.type === 'none') {
      req.user = null;
      return next();
    }

    if (options.auth?.type === 'apikey') {
      const apiKey = req.headers['x-api-key'] || req.query.apikey;
      if (apiKey === secret) {
        req.user = { role: 'admin' };
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key.' });
    }

    // Default: JWT Auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, secret);
      req.user = decoded as PermissionContext;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }
  };

  // Auth endpoints (JWT only)
  if (options.auth?.type !== 'none' && options.auth?.type !== 'apikey') {
    app.post('/auth/signup', async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      try {
        const usersCol = db.collection('_users', {
          email: { type: 'string', required: true, unique: true },
          password: { type: 'string', required: true },
        });

        // Check if user already exists
        const existing = await usersCol.findOne({ email });
        if (existing) {
          return res.status(400).json({ error: 'User already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await usersCol.insert({ email, password: hashedPassword });

        const token = jwt.sign({ id: newUser._id, email: newUser.email }, secret, {
          expiresIn: options.auth?.expiresIn || '7d',
        } as any);

        res.status(201).json({ token, user: { id: newUser._id, email: newUser.email } });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    app.post('/auth/login', async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      try {
        const usersCol = db.collection('_users');
        const user = await usersCol.findOne({ email });
        if (!user) {
          return res.status(400).json({ error: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(400).json({ error: 'Invalid credentials.' });
        }

        const token = jwt.sign({ id: user._id, email: user.email }, secret, {
          expiresIn: options.auth?.expiresIn || '7d',
        } as any);

        res.json({ token, user: { id: user._id, email: user.email } });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });
  }

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', database: db.options.db });
  });

  // Admin Meta Info
  app.get('/api/_meta', authenticate, (req: any, res) => {
    if (options.admin?.secret) {
      const adminKey = req.headers['x-admin-secret'];
      if (adminKey !== options.admin.secret) {
        return res.status(403).json({ error: 'Forbidden: Admin access only.' });
      }
    } else if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access only.' });
    }
    res.json(db.getMetadata());
  });

  /**
   * Helper to parse query parameters into Filter, Sort, Limit, Offset, Select options
   */
  function parseQueryParams(query: any) {
    const filter: Record<string, any> = {};
    const findOpts: any = {};
    let sortSpec: any = undefined;
    let limit: number | undefined = undefined;
    let offset: number | undefined = undefined;

    for (const [key, val] of Object.entries(query)) {
      if (key === 'sort') {
        sortSpec = {};
        const parts = String(val).split(',');
        for (const p of parts) {
          if (p.startsWith('-')) {
            sortSpec[p.substring(1)] = 'desc';
          } else {
            sortSpec[p] = 'asc';
          }
        }
      } else if (key === 'limit') {
        limit = parseInt(String(val), 10);
      } else if (key === 'offset') {
        offset = parseInt(String(val), 10);
      } else if (key === 'select') {
        findOpts.select = String(val).split(',');
      } else if (key === 'populate') {
        findOpts.populate = String(val).split(',');
      } else {
        // Parse operator syntax: field[$gte]=18 -> { field: { $gte: 18 } }
        // Express decodes bracket syntax automatically into nested objects!
        // E.g. Query: { age: { '$gte': '18' } }
        if (val && typeof val === 'object') {
          const typedVal: Record<string, any> = {};
          for (const [op, opVal] of Object.entries(val)) {
            // Cast numeric string values if appropriate
            const numeric = Number(opVal);
            typedVal[op] = !isNaN(numeric) && opVal !== '' ? numeric : opVal;
          }
          filter[key] = typedVal;
        } else {
          const numeric = Number(val);
          filter[key] = !isNaN(numeric) && val !== '' ? numeric : val;
        }
      }
    }

    return { filter, findOpts, sortSpec, limit, offset };
  }

  // REST API Endpoints
  app.get('/api/:collection', authenticate, async (req: any, res) => {
    const { collection } = req.params;
    try {
      const col = db.collection(collection);
      const { filter, findOpts, sortSpec, limit, offset } = parseQueryParams(req.query);

      let queryChain = col.find(filter, findOpts);

      if (sortSpec) queryChain = queryChain.sort(sortSpec);
      if (limit !== undefined) queryChain = queryChain.limit(limit);
      if (offset !== undefined) queryChain = queryChain.offset(offset);

      const rows = await queryChain;

      // Filter rows based on read permissions
      const allowedRows: RowData[] = [];
      const readPerm = col.options.permissions?.read;
      
      for (const row of rows) {
        if (readPerm) {
          const allowed = await readPerm(req.user, row);
          if (allowed) allowedRows.push(row);
        } else {
          allowedRows.push(row);
        }
      }

      res.json(allowedRows);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/:collection/:id', authenticate, async (req: any, res) => {
    const { collection, id } = req.params;
    try {
      const col = db.collection(collection);
      const row = await col.findById(id, req.query.populate ? { populate: String(req.query.populate).split(',') } : {});

      if (!row) {
        return res.status(404).json({ error: 'Document not found.' });
      }

      const readPerm = col.options.permissions?.read;
      if (readPerm) {
        const allowed = await readPerm(req.user, row);
        if (!allowed) return res.status(403).json({ error: 'Forbidden.' });
      }

      res.json(row);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/:collection', authenticate, async (req: any, res) => {
    const { collection } = req.params;
    try {
      const col = db.collection(collection);

      const writePerm = col.options.permissions?.write;
      if (writePerm) {
        const allowed = await writePerm(req.user, req.body);
        if (!allowed) return res.status(403).json({ error: 'Forbidden.' });
      }

      const row = await col.insert(req.body);
      broadcastEvent('insert', collection, row);
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/:collection/:id', authenticate, async (req: any, res) => {
    const { collection, id } = req.params;
    try {
      const col = db.collection(collection);
      const row = await col.findById(id);
      if (!row) return res.status(404).json({ error: 'Document not found.' });

      const writePerm = col.options.permissions?.write;
      if (writePerm) {
        const allowed = await writePerm(req.user, { ...row, ...req.body });
        if (!allowed) return res.status(403).json({ error: 'Forbidden.' });
      }

      await col.updateById(id, req.body);
      const updated = await col.findById(id);
      if (updated) broadcastEvent('update', collection, updated);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/:collection/:id', authenticate, async (req: any, res) => {
    const { collection, id } = req.params;
    try {
      const col = db.collection(collection);
      const row = await col.findById(id);
      if (!row) return res.status(404).json({ error: 'Document not found.' });

      const writePerm = col.options.permissions?.write;
      if (writePerm) {
        const allowed = await writePerm(req.user, { ...row, ...req.body });
        if (!allowed) return res.status(403).json({ error: 'Forbidden.' });
      }

      await col.updateById(id, req.body);
      const updated = await col.findById(id);
      if (updated) broadcastEvent('update', collection, updated);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/:collection/:id', authenticate, async (req: any, res) => {
    const { collection, id } = req.params;
    try {
      const col = db.collection(collection);
      const row = await col.findById(id);
      if (!row) return res.status(404).json({ error: 'Document not found.' });

      const deletePerm = col.options.permissions?.delete;
      if (deletePerm) {
        const allowed = await deletePerm(req.user, row);
        if (!allowed) return res.status(403).json({ error: 'Forbidden.' });
      }

      await col.deleteById(id);
      broadcastEvent('delete', collection, row);
      res.json({ message: 'Document deleted successfully.' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Bulk endpoints
  app.post('/api/:collection/bulk', authenticate, async (req: any, res) => {
    const { collection } = req.params;
    const items = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Payload must be an array of documents.' });
    }

    try {
      const col = db.collection(collection);
      const writePerm = col.options.permissions?.write;
      
      const inserted: RowData[] = [];
      for (const item of items) {
        if (writePerm) {
          const allowed = await writePerm(req.user, item);
          if (!allowed) continue;
        }
        const row = await col.insert(item);
        broadcastEvent('insert', collection, row);
        inserted.push(row);
      }
      res.status(201).json(inserted);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/:collection/bulk', authenticate, async (req: any, res) => {
    const { collection } = req.params;
    try {
      const col = db.collection(collection);
      const { filter } = parseQueryParams(req.query);
      const rows = await col.find(filter);
      
      const deletePerm = col.options.permissions?.delete;
      let count = 0;
      for (const row of rows) {
        if (deletePerm) {
          const allowed = await deletePerm(req.user, row);
          if (!allowed) continue;
        }
        await col.deleteById(row._id!);
        broadcastEvent('delete', collection, row);
        count++;
      }
      res.json({ message: `Successfully deleted ${count} documents.` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Blobs endpoints
  app.post('/api/blobs/upload', authenticate, async (req: any, res) => {
    try {
      const name = String(req.query.name || 'upload_blob');
      const contentType = req.headers['content-type'] || 'application/octet-stream';
      const buffer = req.body as Buffer;

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: 'No binary payload received.' });
      }

      const fileId = await db.uploadBlob(buffer, { name, contentType });
      res.status(201).json({ fileId, name, contentType });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/blobs/:fileId', authenticate, async (req, res) => {
    const { fileId } = req.params;
    try {
      const { data, contentType } = await db.blobManager.downloadBlob(fileId);
      res.setHeader('Content-Type', contentType);
      res.send(data);
    } catch (err) {
      res.status(404).json({ error: 'Blob not found.' });
    }
  });

  // Start server
  const server = http.createServer(app);
  
  // Realtime WebSocket support
  const wss = new WebSocketServer({ noServer: true });
  
  interface Subscriber {
    ws: WebSocket;
    collection: string;
    filter?: any;
    user: any;
  }

  const subscribers = new Set<Subscriber>();

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let sub: Subscriber | null = null;

    ws.on('message', async (message: string) => {
      try {
        const payload = JSON.parse(message);
        if (payload.type === 'subscribe') {
          // Verify authentication token if required
          let user: any = null;
          if (options.auth?.type !== 'none') {
            const token = payload.token;
            if (!token) {
              ws.send(JSON.stringify({ error: 'Unauthorized: No token provided.' }));
              ws.close();
              return;
            }
            user = jwt.verify(token, secret);
          }

          sub = {
            ws,
            collection: payload.collection,
            filter: payload.filter || {},
            user,
          };
          subscribers.add(sub);
          ws.send(JSON.stringify({ status: 'subscribed', collection: payload.collection }));
        } else if (payload.type === 'unsubscribe') {
          if (sub) {
            subscribers.delete(sub);
          }
        }
      } catch (err) {
        ws.send(JSON.stringify({ error: (err as Error).message }));
      }
    });

    ws.on('close', () => {
      if (sub) {
        subscribers.delete(sub);
      }
    });
  });

  // Broadcast function
  function broadcastEvent(type: 'insert' | 'update' | 'delete', collection: string, row: RowData) {
    const event: WsEvent = { type, collection, row: row as any };
    for (const sub of subscribers) {
      if (sub.collection !== collection) continue;
      
      // Filter matching check
      const filterMatches = QueryEngine.filter([row], sub.filter).length > 0;
      if (!filterMatches) continue;

      // Permission check
      const col = db.collection(collection);
      const readPerm = col.options.permissions?.read;
      if (readPerm) {
        Promise.resolve(readPerm(sub.user, row)).then((allowed) => {
          if (allowed) {
            sub.ws.send(JSON.stringify(event));
          }
        });
      } else {
        sub.ws.send(JSON.stringify(event));
      }
    }
  }

  // Polling-based change detection (in case sheets are updated outside this process)
  if (options.realtime?.enabled) {
    const pollInterval = options.realtime.pollIntervalMs || 5000;
    const lastRowCache: Record<string, string> = {}; // collectionName -> stringified row state

    setInterval(async () => {
      // Only poll collections that have active subscribers
      const activeCollections = Array.from(new Set(Array.from(subscribers).map((s) => s.collection)));
      if (activeCollections.length === 0) return;

      for (const colName of activeCollections) {
        try {
          const col = db.collection(colName);
          // Bypass cache to fetch fresh sheets values
          db.invalidate(colName);
          const currentRows = await col.getAllRawRows();

          const prevHash = lastRowCache[colName];
          const currHash = JSON.stringify(currentRows.map((r: RowData) => ({ _id: r._id, _version: r._version })));

          if (prevHash && prevHash !== currHash) {
            // Changes detected! Compute diff and broadcast
            const prevRowsMap = new Map(JSON.parse(prevHash).map((r: any) => [r._id, r._version]));
            const currRowsMap = new Map(currentRows.map((r: RowData) => [r._id, r._version]));

            // Detect inserts and updates
            for (const r of currentRows) {
              const oldVer = prevRowsMap.get(r._id);
              if (oldVer === undefined) {
                // Insert
                broadcastEvent('insert', colName, r);
              } else if (oldVer !== r._version) {
                // Update
                broadcastEvent('update', colName, r);
              }
            }

            // Detect deletes
            const prevRowsList = JSON.parse(prevHash);
            for (const pr of prevRowsList) {
              if (!currRowsMap.has(pr._id)) {
                // Delete
                broadcastEvent('delete', colName, pr);
              }
            }
          }

          lastRowCache[colName] = currHash;
        } catch (err) {
          // Fail silently in background poll
        }
      }
    }, pollInterval);
  }

  server.listen(port, () => {
    console.log(`DriveSpread REST server listening on port ${port}`);
  });

  return server;
}
