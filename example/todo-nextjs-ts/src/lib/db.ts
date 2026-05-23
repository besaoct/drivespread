import DriveSpread from 'drivespread';

const credentials = process.env.GOOGLE_SA_KEY;

if (!credentials && typeof window === 'undefined') {
  console.warn('Warning: GOOGLE_SA_KEY environment variable is not defined on the server.');
}

const globalForDb = global as unknown as { db?: DriveSpread };

export const db = globalForDb.db ?? new DriveSpread({
  db: process.env.DRIVESPREAD_DB || 'todo-nextjs-db',
  credentials: credentials || '{}',
});

if (process.env.NODE_ENV !== 'production') {
  globalForDb.db = db;
}

// Initialize collection
db.collection('todos', {
  title: { type: 'string', required: true },
  completed: { type: 'boolean', default: false },
  priority: { type: 'number', min: 1, max: 3, default: 2 }, // 1=Low, 2=Medium, 3=High
  createdAt: { type: 'date', default: () => new Date().toISOString() }
});
