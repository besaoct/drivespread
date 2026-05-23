import { DriveSpread } from './database.js';

export class FrameworkAdapters {
  private db: DriveSpread;

  constructor(db: DriveSpread) {
    this.db = db;
  }

  /**
   * Express/Connect router middleware wrapper.
   */
  middleware() {
    // Simply return a middleware/handler that forwards to the Express server setup
    // But since the user might want to mount it directly:
    // app.use('/api', db.middleware())
    // We can import the express router and build a sub-router.
    const express = require('express');
    const router = express.Router();

    // Map base routes
    router.get('/:collection', async (req: any, res: any) => {
      try {
        const col = this.db.collection(req.params.collection);
        const rows = await col.find(req.query);
        res.json(rows);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    router.get('/:collection/:id', async (req: any, res: any) => {
      try {
        const col = this.db.collection(req.params.collection);
        const row = await col.findById(req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    router.post('/:collection', async (req: any, res: any) => {
      try {
        const col = this.db.collection(req.params.collection);
        const row = await col.insert(req.body);
        res.status(201).json(row);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    router.put('/:collection/:id', async (req: any, res: any) => {
      try {
        const col = this.db.collection(req.params.collection);
        await col.updateById(req.params.id, req.body);
        const updated = await col.findById(req.params.id);
        res.json(updated);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    router.delete('/:collection/:id', async (req: any, res: any) => {
      try {
        const col = this.db.collection(req.params.collection);
        await col.deleteById(req.params.id);
        res.json({ message: 'Deleted' });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    return router;
  }

  /**
   * Helper to parse query parameters from Next.js Request URL.
   */
  private parseUrlParams(urlString: string) {
    const url = new URL(urlString);
    const filter: Record<string, any> = {};
    const select: string[] = [];
    const populate: string[] = [];
    let sort: any = undefined;
    let limit: number | undefined = undefined;
    let offset: number | undefined = undefined;

    url.searchParams.forEach((val, key) => {
      if (key === 'sort') {
        sort = {};
        const parts = val.split(',');
        for (const p of parts) {
          if (p.startsWith('-')) sort[p.substring(1)] = 'desc';
          else sort[p] = 'asc';
        }
      } else if (key === 'limit') {
        limit = parseInt(val, 10);
      } else if (key === 'offset') {
        offset = parseInt(val, 10);
      } else if (key === 'select') {
        select.push(...val.split(','));
      } else if (key === 'populate') {
        populate.push(...val.split(','));
      } else {
        const numeric = Number(val);
        filter[key] = !isNaN(numeric) && val !== '' ? numeric : val;
      }
    });

    return { filter, options: { select, populate }, sort, limit, offset };
  }

  /**
   * Next.js App Router API Route handler.
   */
  nextHandler() {
    const handleRoute = async (req: Request) => {
      const url = new URL(req.url);
      // Path format: /api/users or /api/users/uuid-123
      const pathParts = url.pathname.split('/').filter(Boolean);
      // E.g. ['api', 'users', 'uuid-123']
      const colIndex = pathParts.indexOf('api') + 1;
      const collection = pathParts[colIndex];
      const id = pathParts[colIndex + 1];

      if (!collection) {
        return new Response(JSON.stringify({ error: 'Collection name is required.' }), { status: 400 });
      }

      const col = this.db.collection(collection);

      try {
        const method = req.method.toUpperCase();

        if (method === 'GET') {
          if (id) {
            const row = await col.findById(id);
            if (!row) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
            return new Response(JSON.stringify(row), { status: 200 });
          } else {
            const { filter, options, sort, limit, offset } = this.parseUrlParams(req.url);
            let chain = col.find(filter, options);
            if (sort) chain = chain.sort(sort);
            if (limit !== undefined) chain = chain.limit(limit);
            if (offset !== undefined) chain = chain.offset(offset);
            const rows = await chain;
            return new Response(JSON.stringify(rows), { status: 200 });
          }
        }

        if (method === 'POST') {
          const body = await req.json();
          const row = await col.insert(body);
          return new Response(JSON.stringify(row), { status: 201 });
        }

        if (method === 'PUT' || method === 'PATCH') {
          if (!id) return new Response(JSON.stringify({ error: 'ID is required.' }), { status: 400 });
          const body = await req.json();
          await col.updateById(id, body);
          const updated = await col.findById(id);
          return new Response(JSON.stringify(updated), { status: 200 });
        }

        if (method === 'DELETE') {
          if (!id) return new Response(JSON.stringify({ error: 'ID is required.' }), { status: 400 });
          await col.deleteById(id);
          return new Response(JSON.stringify({ message: 'Deleted successfully.' }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405 });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
      }
    };

    return {
      GET: handleRoute,
      POST: handleRoute,
      PUT: handleRoute,
      PATCH: handleRoute,
      DELETE: handleRoute,
    };
  }

  /**
   * Vercel Edge handler. Identical signature to standard Web APIs handlers.
   */
  edgeHandler() {
    return this.nextHandler().GET; // return the routing function
  }

  /**
   * AWS Lambda Handler proxying API Gateway events.
   */
  lambdaHandler() {
    return async (event: any) => {
      const method = event.httpMethod || event.requestContext?.http?.method;
      const path = event.path || event.requestContext?.http?.path;
      const pathParts = path.split('/').filter(Boolean);
      const collection = pathParts[0];
      const id = pathParts[1];

      if (!collection) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Collection name is required.' }),
        };
      }

      const col = this.db.collection(collection);

      try {
        const queryParams = event.queryStringParameters || {};
        
        if (method === 'GET') {
          if (id) {
            const row = await col.findById(id);
            if (!row) return { statusCode: 404, body: JSON.stringify({ error: 'Not found.' }) };
            return { statusCode: 200, body: JSON.stringify(row) };
          } else {
            const rows = await col.find(queryParams);
            return { statusCode: 200, body: JSON.stringify(rows) };
          }
        }

        const body = event.body ? JSON.parse(event.body) : {};

        if (method === 'POST') {
          const row = await col.insert(body);
          return { statusCode: 201, body: JSON.stringify(row) };
        }

        if (method === 'PUT' || method === 'PATCH') {
          if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'ID is required.' }) };
          await col.updateById(id, body);
          const updated = await col.findById(id);
          return { statusCode: 200, body: JSON.stringify(updated) };
        }

        if (method === 'DELETE') {
          if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'ID is required.' }) };
          await col.deleteById(id);
          return { statusCode: 200, body: JSON.stringify({ message: 'Deleted successfully.' }) };
        }

        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
      } catch (err) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: (err as Error).message }),
        };
      }
    };
  }
}

// Add these handlers directly to DriveSpread prototype to match PRD
DriveSpread.prototype.middleware = function(this: DriveSpread) {
  return new FrameworkAdapters(this).middleware();
};

DriveSpread.prototype.nextHandler = function(this: DriveSpread) {
  return new FrameworkAdapters(this).nextHandler();
};

DriveSpread.prototype.edgeHandler = function(this: DriveSpread) {
  return new FrameworkAdapters(this).edgeHandler();
};

DriveSpread.prototype.lambdaHandler = function(this: DriveSpread) {
  return new FrameworkAdapters(this).lambdaHandler();
};
