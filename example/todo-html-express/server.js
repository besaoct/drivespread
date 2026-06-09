import DriveSpread from 'drivespread';
import express from 'express';
import * as path from 'path';
import dotenv from 'dotenv';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load environment variables (supports .env.local or .env)
if (fs.existsSync(path.join(__dirname, '.env.local'))) {
  dotenv.config({ path: path.join(__dirname, '.env.local') });
} else {
  dotenv.config({ path: path.join(__dirname, '.env') });
}

// Enforce environment variables in production-like style
const credentials = process.env.GOOGLE_SA_KEY;
const hasServiceAccountEnv = process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL;
const hasOAuthEnv = process.env.GOOGLE_REFRESH_TOKEN;
const dbName = process.env.DRIVESPREAD_DB || 'todo-html-db';

if (!credentials && !hasServiceAccountEnv && !hasOAuthEnv) {
  console.error('\n❌ Error: Google Cloud credentials are not defined.');
  console.log('Please define either GOOGLE_SA_KEY, individual Service Account variables (GOOGLE_PRIVATE_KEY and GOOGLE_CLIENT_EMAIL), or Personal OAuth tokens (GOOGLE_REFRESH_TOKEN) in your .env file.\n');
  process.exit(1);
}

const db = new DriveSpread({
  db: dbName,
  credentials: credentials || undefined,
});

// Initialize collection
db.collection('todos', {
  title: { type: 'string', required: true },
  completed: { type: 'boolean', default: false },
  priority: { type: 'number', min: 1, max: 3, default: 2 }, // 1=Low, 2=Medium, 3=High
  createdAt: { type: 'date', default: () => new Date().toISOString() }
});

const server = await db.serve({
  port: 3000,
  auth: { type: 'none' }, // Simple auth-free access for local demo
  realtime: { enabled: true, pollIntervalMs: 2000 }
});

// Serve local static assets from the same directory where server.js is located
server.use(express.static(__dirname));

const distPath = path.dirname(require.resolve('drivespread/client'));

// Serve the compiled WebSocket client dynamically using node module resolution (ES Module)
// Must be registered BEFORE express.static(distPath) so it isn't intercepted by client.js (CommonJS)
server.get('/client.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(distPath, 'client.mjs'));
});

// Serve any compiled chunks or assets from the installed drivespread dist folder
server.use(express.static(distPath));

console.log(`\n🚀 Todo Application Server running at http://localhost:3000 (Database: "${dbName}")\n`);
