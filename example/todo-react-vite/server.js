import DriveSpread from 'drivespread';
import express from 'express';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enforce environment variables in production-like style
const credentials = process.env.GOOGLE_SA_KEY;
const dbName = process.env.DRIVESPREAD_DB || 'todo-react-db';

if (!credentials) {
  console.error('\n❌ Error: GOOGLE_SA_KEY environment variable is not defined.');
  console.log('Please define GOOGLE_SA_KEY in your .env file as either a path to your service account key or a raw JSON string.\n');
  process.exit(1);
}

const db = new DriveSpread({
  db: dbName,
  credentials: credentials,
});

// Initialize collection
db.collection('todos', {
  title: { type: 'string', required: true },
  completed: { type: 'boolean', default: false },
  priority: { type: 'number', min: 1, max: 3, default: 2 }, // 1=Low, 2=Medium, 3=High
  createdAt: { type: 'date', default: () => new Date().toISOString() }
});

// Start database backend server (API & WebSockets) on port 3000
const server = await db.serve({
  port: 3000,
  auth: { type: 'none' }, // Simple auth-free access for local demo
  realtime: { enabled: true, pollIntervalMs: 2000 }
});

// Serve frontend build output in production if it exists
const distPath = path.resolve(__dirname, './dist');
server.use(express.static(distPath));

// Fallback to index.html for React Router / SPA routing
server.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

console.log(`\n🚀 Todo React App Backend Server running at http://localhost:3000 (Database: "${dbName}")\n`);
