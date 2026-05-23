import DriveSpread from 'drivespread';
import express from 'express';
import * as path from 'path';

// Enforce environment variables in production-like style
const credentials = process.env.GOOGLE_SA_KEY;
const dbName = process.env.DRIVESPREAD_DB || 'todo-html-db';

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

const server = db.serve({
  port: 3000,
  auth: { type: 'none' }, // Simple auth-free access for local demo
  realtime: { enabled: true, pollIntervalMs: 2000 }
});

// Serve local static assets from the example folder
server.use(express.static('./example'));

// Serve the compiled WebSocket client from the installed drivespread package node_modules
server.get('/client.js', (req, res) => {
  res.sendFile(path.resolve('./node_modules/drivespread/dist/client.js'));
});

console.log(`\n🚀 Todo Application Server running at http://localhost:3000 (Database: "${dbName}")\n`);
