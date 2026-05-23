# DriveSpread

[![npm version](https://img.shields.io/npm/v/drivespread.svg?style=flat-flat)](https://www.npmjs.com/package/drivespread)
[![CI/CD Status](https://github.com/besaoct/drivespread/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/besaoct/drivespread/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests Passed](https://img.shields.io/badge/Tests-17%2F17%20Passed-brightgreen.svg)]()

**DriveSpread** is a zero-infrastructure, production-ready, open-source database library that emulates a fully functional database using **Google Drive** and **Google Sheets** as a private, secure, and free backend.

With DriveSpread, you can build a complete backend database, REST API, and realtime WebSocket event server in **less than 10 lines of code** with zero server costs and zero DevOps setup.

---

## Key Capabilities & Architecture

DriveSpread transforms Google Sheets from a static grid into a scalable, safe, and relational database engine.

```
                  Your Node.js Application / Server
                                 ↓
                     DriveSpread Client SDK
                                 ↓
        ┌───────────────────────────────────────────────────┐
        │                 Core DB Engine                    │
        │ ┌──────────────────────┐ ┌──────────────────────┐ │
        │ │     ShardManager     │ │     LockManager      │ │
        │ │ (Cell count monitoring│ │ (Optimistic version  │ │
        │ │  & auto-splitting)   │ │  & pessimistic lock) │ │
        │ └──────────────────────┘ └──────────────────────┘ │
        │ ┌──────────────────────┐ ┌──────────────────────┐ │
        │ │     QueryEngine      │ │     CacheManager     │ │
        │ │ (In-memory Mongo-like│ │ (TTL-based           │ │
        │ │  filters & sorting)  │ │  write-through cache)│ │
        │ └──────────────────────┘ └──────────────────────┘ │
        │ ┌──────────────────────┐ ┌──────────────────────┐ │
        │ │     BlobManager      │ │      WriteQueue      │ │
        │ │ (Drive media files)  │ │ (Aggregated batching │ │
        │ │                      │ │  & throttling)       │ │
        │ └──────────────────────┘ └──────────────────────┘ │
        └───────────────────────────────────────────────────┘
                                 ↓
                 Google Service Account (OAuth 2.0)
                                 ↓
        ┌───────────────────────────────────────────────────┐
        │             Google Drive Namespace                │
        │  ├── _meta.json         (Database metadata)       │
        │  ├── _index_*.json      (O(1) JSON lookup indexes)│
        │  ├── _locks             (Distributed mutex sheet) │
        │  ├── Shard_Spreadsheet  (Spreadsheet 1 - Active)  │
        │  └── /blobs             (Uploaded media bin)      │
        └───────────────────────────────────────────────────┘
```

1. **Auto-Sharding**: Monitors cell capacities (rows × columns) per spreadsheet. Once a sheet approaches the Google Sheets hard limit of 10 million cells (we trigger at a safe threshold of 9.5M cells), a new shard spreadsheet is automatically provisioned. Reads fan out concurrently across all shards while writes route to the active shard.
2. **Optimistic & Pessimistic Concurrency**: Every database row tracks an internal version column (`_version`). Updates perform optimistic concurrency checks, raising conflict errors and retrying automatically with exponential backoff on collisions. Critical operations use a Google Sheet-backed `_locks` distributed mutex.
3. **Throttled Batch Queues**: Aggregates insert, update, and clear operations inside an in-memory queue. Flushes are grouped using Sheets `batchUpdate` and `batchClear` APIs to minimize HTTP roundtrips and strictly respect Google API's 300 requests/minute rate limit.
4. **Write-Through Caching**: Implements a configurable TTL read cache. Inserts and updates propagate immediately to the local cache, guaranteeing sub-millisecond sequential reads.
5. **O(1) JSON Indexes**: Automatically creates and maintains index mapping files on Google Drive (`_index_{collection}_{field}.json`) for primary key lookup optimization.
6. **Relational Constraints**: Supports `belongsTo`, `hasOne`, and `hasMany` relationships, enforcing in-memory join population and delete cascade actions (`cascade`, `restrict`, `setNull`).
7. **Production API Servers**: Mounts an Express REST server, JWT/API Key user signups & authentication, and WebSocket streams matching collection modifications in one call.

---

## Installation

```bash
npm install drivespread
```

---

## Google Cloud Credentials Setup

DriveSpread runs securely using a Google Cloud Service Account.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new Google Cloud Project.
3. Search for **Google Sheets API** and **Google Drive API** and enable both.
4. Go to **IAM & Admin > Service Accounts**, create a Service Account, and grant no specific IAM roles (all database folders are isolated under the Service Account's own Google Drive space).
5. Click the created Service Account, go to the **Keys** tab, select **Add Key > Create New Key (JSON)**, and download the key file.
6. Save the key file inside your project as `google-service-account.json`, or copy the contents into a `GOOGLE_SA_KEY` environment variable.

---

## Getting Started

### 1. Initialize DriveSpread

```typescript
import DriveSpread from 'drivespread';

const db = new DriveSpread({
  db: 'my-app-database',
  credentials: './google-service-account.json', // Path to JSON key or JSON string
});
```

### 2. Define a Collection Schema

Schemas are defined with typed properties, optional defaults, constraints, and index options.

```typescript
const products = db.collection('products', {
  sku:       { type: 'string',  required: true, unique: true },
  name:      { type: 'string',  required: true },
  price:     { type: 'number',  min: 0 },
  inStock:   { type: 'boolean', default: true },
  tags:      { type: 'array' }, // Automatically serialized to Sheets cells
  metadata:  { type: 'object' },
  avatar:    { type: 'blob' }, // Google Drive file reference
  createdAt: { type: 'date',    default: () => new Date().toISOString() },
}, {
  indexes: ['sku', 'createdAt'], // Synchronous Google Drive indexes
  cacheTTL: 30, // In-memory cache TTL in seconds
});
```

---

## CRUD Operations & Querying

DriveSpread supports MongoDB-like query operations, projections, pagination, and sorting.

### Inserts

```typescript
const item = await products.insert({
  sku: 'MACBOOK-M3',
  name: 'MacBook Pro M3 Max',
  price: 2499,
  tags: ['laptop', 'apple'],
  metadata: { ram: '32GB', storage: '1TB' },
});

// Returns system fields: { _id, _version, _createdAt, _updatedAt, ... }
```

### Finds (with Operators)

Queries are resolved against in-memory indexes and cached stores. The Query Engine supports:

| Operator | Action | Example |
|---|---|---|
| `$eq` | Equal to | `{ age: { $eq: 18 } }` or `{ age: 18 }` |
| `$ne` | Not equal to | `{ status: { $ne: 'archived' } }` |
| `$gt` | Greater than | `{ price: { $gt: 1000 } }` |
| `$gte` | Greater than or equal to | `{ price: { $gte: 2499 } }` |
| `$lt` | Less than | `{ age: { $lt: 21 } }` |
| `$lte` | Less than or equal to | `{ age: { $lte: 21 } }` |
| `$in` | Exists in array | `{ tags: { $in: ['apple', 'dell'] } }` |
| `$contains` | String contains substring | `{ name: { $contains: 'MacBook' } }` |
| `$startsWith`| String starts with prefix | `{ sku: { $startsWith: 'MAC' } }` |

```typescript
// Query filter with operators, sort, pagination, and select projection
const results = await products.find({
  price: { $gte: 1500 },
  tags: { $in: ['laptop'] }
})
.sort({ price: 'desc', createdAt: 'asc' })
.limit(10)
.offset(0)
.select(['sku', 'price']);
```

### Updates

Updates support atomic numeric operators like `$inc` and `$dec` for safe counters.

```typescript
// Update by filter (using numeric decrement operator)
await products.update(
  { sku: 'MACBOOK-M3' },
  { stock: { $dec: 1 } }
);

// Update by ID
await products.updateById('uuid-1234-5678', {
  inStock: false,
});
```

### Deletes

```typescript
await products.delete({ inStock: false });
await products.deleteById('uuid-1234-5678');
```

---

## Transactions (Best-Effort Rollback)

Since Google Sheets lacks native ACID transactions, DriveSpread provides a best-effort transaction block. An operations journal is recorded sequentially. If any step fails, the journal executes backwards to undo (delete or restore) previous modifications.

```typescript
await db.transaction(async (tx) => {
  const orders = tx.collection('orders');
  const inventory = tx.collection('inventory');

  // 1. Create order
  const order = await orders.insert({ userId: 'user-01', total: 2499 });

  // 2. Decrement inventory stock
  await inventory.update({ sku: 'MACBOOK-M3' }, { stock: { $dec: 1 } });
});
// If inventory update fails, the created order is automatically deleted from Google Sheets.
```

---

## Relationship Modeling

DriveSpread resolves joins in-memory and enforces referential integrity on deletions.

```typescript
const clients = db.collection('clients', {
  name: { type: 'string', required: true }
});

const invoices = db.collection('invoices', {
  clientId: { type: 'string', required: true },
  amount:   { type: 'number' }
}, {
  relations: {
    client: {
      type: 'belongsTo',
      collection: 'clients',
      foreignKey: 'clientId',
      onDelete: 'cascade' // 'cascade' | 'restrict' | 'setNull'
    }
  }
});
```

### Join Population

```typescript
// Find invoices and join the parent client record
const list = await invoices.find({}, { populate: ['client'] });
console.log(list[0].client.name); // "Google"
```

### Cascade Deletes

If a parent record (`clients`) is deleted:
- **`cascade`**: Deletes all matching child records in `invoices`.
- **`restrict`**: Throws an error preventing deletion of `clients` while matching `invoices` exist.
- **`setNull`**: Updates matching `invoices` records setting their `clientId` foreign key to `null`.

---

## Execution Hooks

Register lifecycle hooks to perform validation, logging, or payload modifications.

```typescript
const users = db.collection('users', {
  email:    { type: 'string', required: true },
  password: { type: 'string', required: true }
});

// Hash passwords before insert
users.beforeInsert(async (data) => {
  data.password = await hashPassword(data.password);
  return data;
});

// Trigger email service after creation
users.afterInsert(async (data) => {
  await sendWelcomeEmail(data.email);
});
```

Available hooks: `beforeInsert`, `afterInsert`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`.

---

## Blob / Binary Storage

Properties declared with the `blob` type store Google Drive file IDs.

```typescript
// 1. Upload file to /blobs subfolder
const fileId = await db.uploadBlob('./profile.png', {
  name: 'avatar.png',
  contentType: 'image/png',
});

// 2. Store reference ID in sheet
const user = await users.insert({
  name: 'John Doe',
  avatar: fileId,
});

// 3. Generate short-lived signed OAuth download link (default: 1 hour)
const url = await db.getBlobUrl(user.avatar);
```

---

## Operational REST & WebSocket Server

Instantly launch a complete backend web server exposing CRUD routes, API authentication, rate limiting, and real-time subscription channels.

```typescript
db.serve({
  port: 3000,
  auth: {
    type: 'jwt', // 'jwt' | 'apikey' | 'none'
    secret: process.env.JWT_SECRET || 'super-secret',
    expiresIn: '7d',
  },
  cors: {
    origins: ['https://myfrontend.com'],
  },
  rateLimit: {
    windowMs: 60000,
    max: 100, // 100 requests per IP per minute
  },
  realtime: {
    enabled: true,
    pollIntervalMs: 5000, // WebSocket event poll delay
  },
  admin: {
    secret: process.env.ADMIN_SECRET, // Key for /api/_meta configuration endpoint
  }
});
```

### Auto-Generated REST Endpoints

```
POST   /auth/signup         - Sign up user
POST   /auth/login          - Log in and retrieve JWT

GET    /api/:collection     - Retrieve rows (supports query filters, sorting, page limits)
GET    /api/:collection/:id - Get specific document
POST   /api/:collection     - Insert new record
PUT    /api/:collection/:id - Full update
PATCH  /api/:collection/:id - Partial update
DELETE /api/:collection/:id - Delete record

POST   /api/:collection/bulk - Insert array of records
DELETE /api/:collection/bulk - Delete multiple records matching a query

POST   /api/blobs/upload    - Upload binary files
GET    /api/blobs/:fileId   - Retrieve/download binary files

GET    /health              - Server status check
GET    /api/_meta           - Admin database metadata (requires x-admin-secret header)
```

### WebSocket Client Subscription

```javascript
import { DriveSpreadClient } from 'drivespread/client';

const client = new DriveSpreadClient('ws://localhost:3000', { token: 'JWT_TOKEN' });

// Receive event pushes on collection actions
client.subscribe('users', { role: 'user' }, (event) => {
  console.log(event.type); // 'insert' | 'update' | 'delete'
  console.log(event.row);  // Full record payload
});
```

---

## Serverless Framework Adapters

Run DriveSpread endpoints inside serverless runtimes.

### Express Middleware
```javascript
import express from 'express';
const app = express();
app.use('/api', db.middleware());
```

### Next.js App Router (Route Handlers)
```javascript
// app/api/[...route]/route.ts
export const { GET, POST, PUT, DELETE } = db.nextHandler();
```

### Vercel Edge / Hono Handlers
```javascript
export default db.edgeHandler();
```

### AWS Lambda Proxy
```javascript
export const handler = db.lambdaHandler();
```

---

## CLI Commands

Manage credentials, browse data locally, and export data schemas using `npx drivespread`:

```bash
# 1. Interactive service account configuration and workspace initialization
npx drivespread init

# 2. Open an elegant dark-mode glassmorphic Studio interface on port 4567 to inspect and manage data
npx drivespread studio

# 3. Export database schemas and sheet data to PostgreSQL or MongoDB
npx drivespread migrate
```

---

## Verification & Test Status

DriveSpread is thoroughly tested against schema validations, concurrency limits, locking behaviors, and relation cascades.

```bash
npm run test
```

```
 RUN  v1.6.1 /workspace/drivespread

 ✓ tests/drivespread.test.ts (17 tests) 1466ms

 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  15:01:03
   Duration  1.75s
```

All 17 integration tests pass. Type checking under strict configuration compiles with zero warnings or errors.

---

## Specifications

- **Runtime**: Node.js >= 24.0.0
- **TypeScript**: Strict-mode ready
- **License**: MIT
- **Bundle size**: < 80KB (highly tree-shakeable)
