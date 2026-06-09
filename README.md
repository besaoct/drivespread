# DriveSpread

[![npm version](https://img.shields.io/npm/v/drivespread.svg?style=flat-flat)](https://www.npmjs.com/package/drivespread)
[![CI/CD Status](https://github.com/besaoct/drivespread/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/besaoct/drivespread/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests Passed](https://img.shields.io/badge/Tests-18%2F18%20Passed-brightgreen.svg)]()

> [!IMPORTANT]
> **Beta & Active Development Status**: This project is currently in **Beta** and under active continuous development. Issues, feature requests, and community contributions are highly welcomed! Please feel free to open a GitHub issue or submit a pull request.

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
3. **Async Write Queue & Background Sync**: Write operations (`insert`, `update`, `delete`) are enqueued into an in-memory queue and processed asynchronously in the background. This decouples the server's API/WebSocket responses from Google Sheets API latency. Instead of blocking requests for 6-8 seconds for Google network roundtrips, requests resolve in <20ms. The queue aggregates, batches (using Sheets `batchUpdate` and `batchClear`), and throttles operations to strictly respect Google's 300 requests/minute rate limit.
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

## Use Cases, Limitations & Fit Guide

### Where DriveSpread is a Perfect Fit
* **Side projects and indie apps** are the ideal home for DriveSpread. You ship in hours, pay nothing, and never think about servers. Most side projects never grow beyond what DriveSpread handles comfortably.
* **Hackathons** are almost tailor-made for it. Five minutes to set up a service account, another twenty to have a working REST API with auth. The rest of your time goes toward building the actual product.
* **Internal admin panels and ops tools** work great because write traffic is low, teams are small, and nobody cares about 200ms write latency. Row-level permissions handle access control cleanly.
* **Non-technical founder MVPs** are a strong use case. The founder can open the underlying Sheet (via an explicit share), see real user data, and manually fix things if needed — no engineer required for database ops. Perfect for pre-PMF validation at zero cost.
* **Student and learning projects** benefit because there's no credit card, no cloud account beyond Google, and the concepts you learn — schemas, service accounts, REST APIs, auth — are real and transferable.

### Decent Fit with Caveats
* **Flutter mobile apps** work well with the Dart SDK. Polling-based realtime covers most mobile use cases. Avoid it if you need true offline-first sync or sub-second push notifications.
* **Newsletter and waitlist tools** are a natural fit — write-once, read-rarely, and the Sheet doubles as a natural export to Mailchimp or similar.
* **Simple CMS backends** work if content is updated infrequently. Use Drive blobs for images. Not ideal if editors need real-time collaboration or version history.

### Where You Should Not Use DriveSpread
* **E-commerce at any real scale** is a hard no. Checkout flows need sub-10ms write latency and true transactions. DriveSpread's write queue adds 100–500ms and has no ACID guarantees across collections. Concurrent order updates are a real data loss risk.
* **Real-time collaborative apps** like anything Figma-like need WebSocket infrastructure and CRDTs. DriveSpread's realtime is polling-based with 1–5 second update latency minimum. Concurrent edits to the same document will cause version conflicts and retries.
* **Analytics pipelines and event ingestion** are a mismatch. Millions of events per day means millions of API calls — you'll hit the 300 req/min ceiling almost immediately. Time-series aggregations run in memory and fall apart past a few thousand rows.

### Hard Limitations to Always Keep in Mind
* **Write latency** is 100–500ms on every operation because everything goes through Google's API over the network. You cannot make this faster.
* **The 300 Sheets API requests per minute limit** is a hard ceiling set by Google. The write queue handles bursts, but sustained high-write apps will always run into this wall.
* **There are no true transactions**. Optimistic locking handles concurrent writes to the same row, but cross-collection atomic operations simply aren't possible.
* **There is no offline support**. Every read and write requires a live connection to Google. No local-first model exists here.
* **Realtime is simulated** via server-side polling. The minimum update latency is roughly 1–5 seconds depending on your poll interval config. It is not true push.
* **Multi-collection joins** happen entirely in memory. Fine for small datasets, but it breaks down past tens of thousands of rows across joined collections.

### When to Move On
DriveSpread is built to be outgrown. Once you hit sustained 1k+ writes per minute, 500k+ rows with complex queries, multi-region teams, or compliance requirements like SOC 2 or HIPAA, migrate to Postgres or MongoDB. The `drivespread migrate` CLI command can handle that export for you.

---

## Google Cloud Credentials Setup

DriveSpread runs securely using individual environment variables derived from a Google Cloud Service Account.

### Step 1: Enable Required APIs
You must enable the Google Drive and Google Sheets APIs in your Google Cloud Project (select an existing project or create a new one using the project dropdown selector in the top navbar):
- [Enable Google Drive API](https://console.developers.google.com/apis/api/drive.googleapis.com/overview)
- [Enable Google Sheets API](https://console.developers.google.com/apis/api/sheets.googleapis.com/overview)

### Step 2: Create a Service Account
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create your Google Cloud Project.
3. Navigate to **IAM & Admin > Service Accounts**.
4. Click **Create Service Account**, give it a name, and click **Done** (no specific project/IAM roles are required; the database is isolated within the service account's own Drive space).

### Step 3: Configure Environment using the CLI

In your project directory, run the interactive setup command:
```bash
npx drivespread init
```

The CLI will walk you through the setup based on your preferred authentication method:

#### Option A: Personal Google Account (OAuth2 - Recommended)
This is the easiest path for personal, testing, or development projects. It uses your personal Gmail storage (15 GB free space) and credentials, removing the need for service accounts:
1. When prompted, select **`1) Personal Google Account (OAuth)`**.
2. **Configure OAuth Consent Screen**:
   - Navigate to the [OAuth Consent Screen Console](https://console.cloud.google.com/apis/credentials/consent).
   - Under **User Type**, select **External**, click **Create**, and fill in the required basic app details (app name, support email, developer contact information).
   - Click **Save and Continue** until you reach the **Test users** section.
   - > [!IMPORTANT]
   - > **Crucial Step**: In the **Test users** section, click **+ ADD USERS** and enter the email address of the personal Google account you wish to authenticate. Without this, Google will block your application authentication request.
3. **Generate OAuth Credentials**:
   - Go to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
   - Click **+ CREATE CREDENTIALS** at the top and select **OAuth client ID**.
   - Set the **Application type** to **Web application**.
   - Add a name (e.g., `DriveSpread Local Development`).
   - Under **Authorized redirect URIs**, click **+ ADD URI** and paste:
     ```
     http://localhost:4567/oauth2callback
     ```
     *(Note: This is the local callback handler spawned automatically by the CLI).*
   - Click **Create** to generate your **Client ID** and **Client Secret**.
4. **Complete CLI Flow**:
   - Enter your Client ID and Client Secret in the CLI prompts.
   - The CLI will output a URL and attempt to open your browser to complete the OAuth consent flow.
   - Login with your registered test Google account.
   - If a screen says *"Google hasn't verified this app"*, click **Advanced** followed by **Go to <App Name> (unsafe)** to proceed.
   - Upon completion, the page will confirm authorization and the CLI will write the OAuth tokens directly to your `.env` file.

#### Option B: Google Cloud Service Account (Key JSON)
Ideal for production backends, cron jobs, or serverless deployments where manual browser logins aren't appropriate:
1. **Download Service Account Key**:
   - Go to the [Google Cloud Service Accounts Console](https://console.cloud.google.com/iam-admin/serviceaccounts).
   - Click on your Service Account (or click **Create Service Account** at the top to create one first).
   - Navigate to the **Keys** tab.
   - Click **Add Key** > **Create new key**.
   - Select **JSON** as the format and click **Create** to download the credentials JSON key file. Place it inside your project folder (e.g. as `credentials.json`).
2. **Configure a Shared Folder on Google Drive**:
   - Open your personal Google Drive and create a new folder (e.g., `drivespread-database`).
   - Right-click the folder, click **Share**, and share the folder with the Service Account email (e.g. `your-sa-name@your-project-id.iam.gserviceaccount.com`) as **Editor** (with write/edit permissions).
   - Copy the **Folder ID** from your browser's address bar (it is the long string of alphanumeric characters at the end of the folder's URL: `https://drive.google.com/drive/folders/YOUR_FOLDER_ID`).
   - > [!IMPORTANT]
   - > **Quota Workaround**: Google Cloud Service Accounts have a default **0-byte storage quota** on Google Drive. Sharing a folder owned by your personal account allows the Service Account to write files inside it using your personal storage quota.
3. **Complete CLI Flow**:
   - Run `npx drivespread init` in your terminal and select **`2) Google Cloud Service Account`**.
   - Input the path to the downloaded credentials JSON file (e.g., `./credentials.json`).
   - Paste the copied **Folder ID** when prompted.
   - The CLI will automatically parse the key, format the values, and write them directly into your `.env` file.

### Generated Environment Variables

The CLI will append the configurations directly to your `.env` file depending on the method chosen:

**For Personal Google Account (OAuth2):**
```env
DRIVESPREAD_DB="your-db-name"
DRIVESPREAD_FOLDER_ID="your-folder-id"
GOOGLE_CLIENT_ID="your-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-oauth-client-secret"
GOOGLE_REFRESH_TOKEN="your-oauth-refresh-token"
```

**For Service Account:**
```env
DRIVESPREAD_DB="your-db-name"
DRIVESPREAD_FOLDER_ID="your-folder-id"
GOOGLE_TYPE="service_account"
GOOGLE_PROJECT_ID="your-project-id"
GOOGLE_PRIVATE_KEY_ID="your-private-key-id"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_CLIENT_EMAIL="your-service-account-email"
GOOGLE_CLIENT_ID="your-client-id"
GOOGLE_AUTH_URI="https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URI="https://oauth2.googleapis.com/token"
GOOGLE_AUTH_PROVIDER_X509_CERT_URL="https://www.googleapis.com/oauth2/v1/certs"
GOOGLE_CLIENT_X509_CERT_URL="your-cert-url"
GOOGLE_UNIVERSE_DOMAIN="googleapis.com"
```

---

## Getting Started

### 1. Initialize DriveSpread

With individual environment variables populated, you can initialize the database client cleanly. If you configured `DRIVESPREAD_FOLDER_ID` in your environment, the library will automatically pick it up and use it:

```typescript
import DriveSpread from 'drivespread';

const db = new DriveSpread({
  db: 'my-app-database', // Folder name in Google Drive
  // folderId: process.env.DRIVESPREAD_FOLDER_ID, // (Optional) Explicitly overrides the environment variable
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


## Frontend & Client SDK (`DriveSpreadClient`)

DriveSpread ships with a lightweight, browser-compatible Client SDK that abstracts communication with the REST and WebSocket backend.

### 1. Installation & Import

In client applications, you can import `DriveSpreadClient` directly:

```javascript
import { DriveSpreadClient } from 'drivespread/client';
```

If serving directly from an Express server (like the provided example), the client file can be served as an ES Module:

```javascript
import { DriveSpreadClient } from '/client.js';
```

### 2. Initialization

Instantiate the client with your backend URL. If authentication is enabled, provide a JWT token:

```javascript
const client = new DriveSpreadClient('ws://localhost:3000', {
  token: 'YOUR_JWT_TOKEN' // Optional: if db.serve() configured auth
});
```

*Note: The client automatically converts the `ws://` or `wss://` protocol prefix to `http://` or `https://` respectively when performing HTTP CRUD calls.*

### 3. CRUD Data Operations (REST APIs)

All operations are asynchronous and return promises:

#### Fetch Documents (`find`)
Retrieve documents matching a query filter. Supports Mongo-like operator queries:
```javascript
// Fetch all active todos
const activeTodos = await client.find('todos', { completed: false });

// Query with comparison operators
const premiumProducts = await client.find('products', {
  price: { $gte: 1500 }
});
```

#### Fetch Document by ID (`findById`)
```javascript
const todo = await client.findById('todos', 'uuid-1234');
```

#### Insert Document (`insert`)
```javascript
const newTodo = await client.insert('todos', {
  title: 'Learn DriveSpread SDK',
  completed: false
});
```

#### Update Document by ID (`updateById`)
```javascript
const updatedTodo = await client.updateById('todos', 'uuid-1234', {
  completed: true
});
```

#### Delete Document by ID (`deleteById`)
```javascript
await client.deleteById('todos', 'uuid-1234');
```

### 4. Real-time Event Subscription (WebSockets)

Subscribe to collection-level change events. The socket connection is persistent and auto-reconnects every 3 seconds if disconnected:

```javascript
// Subscribe to any changes in the 'todos' collection
client.subscribe('todos', {}, (event) => {
  const { type, row } = event; // type is 'insert' | 'update' | 'delete'
  console.log(`Action: ${type}`, row);
});

// Unsubscribe when done
client.unsubscribe('todos');
```

### 5. Connection & Request Hooks

DriveSpreadClient exposes callback hooks that you can bind to for handling loading indicators, offline detection, and errors:

#### Request Loading Hook (`onLoadingChange`)
Executes whenever an HTTP request begins or completes, passing `isLoading` (boolean). This tracks concurrent inflight requests and is perfect for managing production-ready loaders and progress bars.
```javascript
client.onLoadingChange = (isLoading) => {
  if (isLoading) {
    showSpinner();
  } else {
    hideSpinner();
  }
};
```

#### WebSocket Lifecycle Hooks
Callbacks to monitor socket connections, useful for driving status badges or user notifications:
```javascript
// Connection established / restored
client.onOpen = () => {
  updateStatusBadge('Synced', 'green');
};

// Connection lost (auto-reconnect will fire in 3 seconds)
client.onClose = () => {
  updateStatusBadge('Offline - Reconnecting...', 'red');
};

// Connection error
client.onError = (err) => {
  console.error('Socket error:', err);
};
```

---


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

Manage credentials, browse data locally, empty trash, share directories, and export data schemas using `npx drivespread`:

```bash
# 1. Interactive service account configuration and workspace initialization
npx drivespread init

# 2. Open an elegant dark-mode glassmorphic Studio interface on port 4567 to inspect and manage data
npx drivespread studio

# 3. Export database schemas and sheet data to PostgreSQL or MongoDB
npx drivespread migrate

# 4. Permanently empty Google Drive trash for the service account to free up storage quota
npx drivespread empty-trash

# 5. Share the database folder in Google Drive with a Gmail collaborator (granting writer permissions)
npx drivespread share [email]
```

---

## Verification & Test Status

DriveSpread is thoroughly tested against schema validations, concurrency limits, locking behaviors, and relation cascades.

```bash
npm run test
```

```
 RUN  v1.6.1 /workspace/drivespread

 ✓ tests/drivespread.test.ts (18 tests) 1462ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Start at  04:14:26
   Duration  1.77s
```

All 18 integration tests pass.

---

## Specifications

- **Runtime**: Node.js >= 24.0.0
- **TypeScript**: Strict-mode ready
- **License**: MIT
- **Bundle size**: 
  - **Client SDK (`client.mjs`)**: ~2.2 KB (fully tree-shakeable)
  - **Core Database Engine (`index.mjs` + chunks)**: ~73 KB
