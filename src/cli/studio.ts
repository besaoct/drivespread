import express from 'express';
import cors from 'cors';
import { DriveSpread } from '../database.js';

export function startStudio(dbName: string, credentials: string) {
  const app = express();
  const port = 4567;
  const db = new DriveSpread({ db: dbName, credentials });

  app.use(cors());
  app.use(express.json());

  // API Endpoints
  app.get('/api/collections', async (_req, res) => {
    try {
      await db.init();
      const meta = db.getMetadata();
      res.json({
        db: dbName,
        collections: Object.entries(meta.collections).map(([name, config]) => ({
          name,
          schema: config.schema,
          indexes: config.indexes,
          relations: config.relations,
          rowCount: config.rowCounts.reduce((a, b) => a + b, 0),
          shardsCount: config.shards.length,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/collections/:name', async (req, res) => {
    const { name } = req.params;
    try {
      const col = db.collection(name);
      db.invalidate(name); // Force refresh
      const rows = await col.find({});
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/collections/:name', async (req, res) => {
    const { name } = req.params;
    try {
      const col = db.collection(name);
      const row = await col.insert(req.body);
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/collections/:name/:id', async (req, res) => {
    const { name, id } = req.params;
    try {
      const col = db.collection(name);
      await col.updateById(id, req.body);
      const updated = await col.findById(id);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/collections/:name/:id', async (req, res) => {
    const { name, id } = req.params;
    try {
      const col = db.collection(name);
      await col.deleteById(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve Single Page Application UI directly
  app.get('/', (_req, res) => {
    res.send(htmlStudioUI(dbName));
  });

  app.listen(port, () => {
    console.log(`DriveSpread Studio running at http://localhost:${port}`);
  });
}

function htmlStudioUI(dbName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DriveSpread Studio — ${dbName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #09090b;
      --bg-card: rgba(24, 24, 27, 0.6);
      --border-card: rgba(63, 63, 70, 0.4);
      --text-main: #f4f4f5;
      --text-muted: #a1a1aa;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --success: #10b981;
      --danger: #ef4444;
      --font-outfit: 'Outfit', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-outfit);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(168, 85, 247, 0.1) 0px, transparent 50%);
    }

    header {
      background: rgba(9, 9, 11, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-card);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-glow {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
    }

    .brand h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      background: linear-gradient(to right, #ffffff, var(--text-muted));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .db-badge {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      color: #818cf8;
      font-family: var(--font-mono);
    }

    .studio-container {
      display: flex;
      flex: 1;
      height: calc(100vh - 65px);
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      border-right: 1px solid var(--border-card);
      background: rgba(18, 18, 20, 0.4);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      overflow-y: auto;
    }

    .sidebar-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
    }

    .collection-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .collection-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      text-align: left;
      font-family: var(--font-outfit);
      font-size: 0.95rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
    }

    .collection-btn:hover {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-main);
    }

    .collection-btn.active {
      background: var(--accent-glow);
      border-color: rgba(99, 102, 241, 0.3);
      color: var(--text-main);
      font-weight: 600;
    }

    .col-count {
      font-size: 0.75rem;
      background: rgba(255, 255, 255, 0.08);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      color: var(--text-muted);
    }

    /* Main Dashboard */
    .dashboard {
      flex: 1;
      padding: 2rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      padding: 1.25rem;
      border-radius: 12px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
    }

    .stat-card h3 {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .stat-card p {
      font-size: 1.75rem;
      font-weight: 700;
    }

    /* Data Table Card */
    .data-card {
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      border-radius: 14px;
      backdrop-filter: blur(8px);
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 400px;
    }

    .data-header {
      padding: 1.25rem;
      border-bottom: 1px solid var(--border-card);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }

    .data-title {
      font-size: 1.2rem;
      font-weight: 600;
    }

    .action-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 8px;
      font-family: var(--font-outfit);
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
    }

    .btn:hover {
      background: var(--accent-hover);
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.4);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-main);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.15);
      box-shadow: none;
    }

    .search-input {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border-card);
      padding: 0.55rem 1rem;
      border-radius: 8px;
      color: var(--text-main);
      font-family: var(--font-outfit);
      font-size: 0.9rem;
      outline: none;
      width: 250px;
      transition: all 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.2);
    }

    /* Table */
    .table-container {
      overflow-x: auto;
      flex: 1;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th, td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border-card);
      font-size: 0.95rem;
    }

    th {
      background: rgba(0, 0, 0, 0.15);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    tr:hover {
      background: rgba(255, 255, 255, 0.015);
    }

    .system-col {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 0.85rem;
    }

    .action-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      transition: all 0.15s ease;
    }

    .action-btn:hover {
      color: var(--accent);
      background: rgba(255, 255, 255, 0.05);
    }

    .action-btn.delete:hover {
      color: var(--danger);
    }

    /* Modals */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(9, 9, 11, 0.7);
      backdrop-filter: blur(8px);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 200;
    }

    .modal {
      background: #18181b;
      border: 1px solid var(--border-card);
      width: 100%;
      max-width: 550px;
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-title {
      font-size: 1.3rem;
      font-weight: 700;
    }

    .form-grid {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      max-height: 400px;
      overflow-y: auto;
      padding-right: 0.5rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-group label {
      font-size: 0.9rem;
      color: var(--text-muted);
      font-weight: 600;
    }

    .form-control {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border-card);
      padding: 0.65rem 1rem;
      border-radius: 8px;
      color: var(--text-main);
      font-family: var(--font-outfit);
      outline: none;
      width: 100%;
      transition: all 0.2s ease;
    }

    .form-control:focus {
      border-color: var(--accent);
    }

    .form-control[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
    }

    /* Json Editor CSS */
    .json-textarea {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      height: 120px;
      resize: vertical;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-glow"></div>
      <h1>DriveSpread Studio</h1>
      <span class="db-badge">${dbName}</span>
    </div>
  </header>

  <div class="studio-container">
    <div class="sidebar">
      <h2 class="sidebar-title">Collections</h2>
      <div class="collection-list" id="collection-list">
        <!-- Collection buttons dynamic -->
      </div>
    </div>

    <div class="dashboard">
      <div class="stats-grid">
        <div class="stat-card">
          <h3>Collection Selected</h3>
          <p id="stat-col-name">-</p>
        </div>
        <div class="stat-card">
          <h3>Total Records</h3>
          <p id="stat-col-rows">0</p>
        </div>
        <div class="stat-card">
          <h3>Active Shards</h3>
          <p id="stat-col-shards">0</p>
        </div>
      </div>

      <div class="data-card">
        <div class="data-header">
          <div class="data-title" id="data-title">Select a collection</div>
          <div class="action-row" id="action-row" style="display:none;">
            <input type="text" class="search-input" id="search-input" placeholder="Search rows..." oninput="handleSearch()">
            <button class="btn" onclick="openAddModal()">Add Record</button>
          </div>
        </div>

        <div class="table-container">
          <table id="data-table">
            <!-- Headers and rows dynamic -->
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Add/Edit Record Modal -->
  <div class="modal-backdrop" id="record-modal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title" id="modal-title">Add New Record</div>
        <button class="action-btn" onclick="closeRecordModal()">&times;</button>
      </div>
      <div class="form-grid" id="modal-form-grid">
        <!-- Form elements dynamic -->
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeRecordModal()">Cancel</button>
        <button class="btn" onclick="saveRecord()">Save Record</button>
      </div>
    </div>
  </div>

  <script>
    let collections = [];
    let currentCollection = null;
    let collectionRows = [];
    let editingRowId = null;

    window.onload = async () => {
      await fetchCollections();
    };

    async function fetchCollections() {
      const res = await fetch('/api/collections');
      const data = await res.json();
      collections = data.collections;
      
      const listEl = document.getElementById('collection-list');
      listEl.innerHTML = '';
      
      collections.forEach(col => {
        const btn = document.createElement('button');
        btn.className = 'collection-btn';
        btn.id = 'col-btn-' + col.name;
        btn.onclick = () => selectCollection(col.name);
        btn.innerHTML = \`\${col.name} <span class="col-count">\${col.rowCount}</span>\`;
        listEl.appendChild(btn);
      });
    }

    async function selectCollection(name) {
      document.querySelectorAll('.collection-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.getElementById('col-btn-' + name);
      if (activeBtn) activeBtn.classList.add('active');

      currentCollection = collections.find(c => c.name === name);
      
      document.getElementById('stat-col-name').innerText = name;
      document.getElementById('stat-col-rows').innerText = currentCollection.rowCount;
      document.getElementById('stat-col-shards').innerText = currentCollection.shardsCount;
      document.getElementById('data-title').innerText = name;
      document.getElementById('action-row').style.display = 'flex';

      // Fetch rows
      document.getElementById('data-table').innerHTML = '<tr><td style="color:var(--text-muted);">Loading spreadsheet rows from Google Drive...</td></tr>';
      
      const res = await fetch('/api/collections/' + name);
      collectionRows = await res.json();
      renderTable(collectionRows);
    }

    function renderTable(rows) {
      const table = document.getElementById('data-table');
      if (rows.length === 0) {
        table.innerHTML = '<tr><td style="color:var(--text-muted); text-align:center; padding:3rem;">No rows found. Appends are empty or cleared.</td></tr>';
        return;
      }

      // Headers
      const schemaFields = Object.keys(currentCollection.schema);
      const systemFields = ['_id', '_version', '_createdAt', '_updatedAt'];
      const headers = [...systemFields, ...schemaFields];

      let tHead = '<tr>';
      headers.forEach(h => {
        tHead += \`<th>\${h}</th>\`;
      });
      tHead += '<th>Actions</th></tr>';

      let tBody = '';
      rows.forEach(row => {
        tBody += '<tr>';
        headers.forEach(h => {
          let val = row[h];
          if (val === undefined || val === null) val = '';
          else if (typeof val === 'object') val = JSON.stringify(val);
          
          const isSystem = systemFields.includes(h);
          tBody += \`<td class="\${isSystem ? 'system-col' : ''}">\${val}</td>\`;
        });
        tBody += \`<td>
          <button class="action-btn" onclick="openEditModal('\${row._id}')">Edit</button>
          <button class="action-btn delete" onclick="deleteRow('\${row._id}')">Delete</button>
        </td>\`;
        tBody += '</tr>';
      });

      table.innerHTML = tHead + tBody;
    }

    function handleSearch() {
      const query = document.getElementById('search-input').value.toLowerCase();
      if (!query) {
        renderTable(collectionRows);
        return;
      }
      const filtered = collectionRows.filter(row => {
        return Object.values(row).some(val => String(val).toLowerCase().includes(query));
      });
      renderTable(filtered);
    }

    function openAddModal() {
      editingRowId = null;
      document.getElementById('modal-title').innerText = 'Add New Record';
      buildForm();
      document.getElementById('record-modal').style.display = 'flex';
    }

    function openEditModal(id) {
      editingRowId = id;
      document.getElementById('modal-title').innerText = 'Edit Record';
      const row = collectionRows.find(r => r._id === id);
      buildForm(row);
      document.getElementById('record-modal').style.display = 'flex';
    }

    function closeRecordModal() {
      document.getElementById('record-modal').style.display = 'none';
    }

    function buildForm(rowData = null) {
      const grid = document.getElementById('modal-form-grid');
      grid.innerHTML = '';

      const schema = currentCollection.schema;
      for (const [key, def] of Object.entries(schema)) {
        const group = document.createElement('div');
        group.className = 'form-group';

        const label = document.createElement('label');
        label.innerText = key + (def.required ? ' *' : '') + ' (' + def.type + ')';
        group.appendChild(label);

        let input;
        if (def.type === 'array' || def.type === 'object') {
          input = document.createElement('textarea');
          input.className = 'form-control json-textarea';
          input.placeholder = def.type === 'array' ? '[1, 2, 3]' : '{"key": "value"}';
          if (rowData && rowData[key]) {
            input.value = JSON.stringify(rowData[key], null, 2);
          }
        } else if (def.type === 'boolean') {
          input = document.createElement('select');
          input.className = 'form-control';
          input.innerHTML = '<option value="true">True</option><option value="false">False</option>';
          if (rowData && rowData[key] !== undefined) {
            input.value = rowData[key] ? 'true' : 'false';
          }
        } else {
          input = document.createElement('input');
          input.className = 'form-control';
          input.type = def.type === 'number' ? 'number' : 'text';
          if (rowData && rowData[key] !== undefined) {
            input.value = rowData[key];
          }
        }

        input.id = 'field-' + key;
        group.appendChild(input);
        grid.appendChild(group);
      }
    }

    async function saveRecord() {
      const payload = {};
      const schema = currentCollection.schema;

      for (const [key, def] of Object.entries(schema)) {
        const input = document.getElementById('field-' + key);
        if (!input) continue;

        let val = input.value;
        if (def.type === 'number' && val !== '') {
          payload[key] = Number(val);
        } else if (def.type === 'boolean') {
          payload[key] = val === 'true';
        } else if (def.type === 'array' || def.type === 'object') {
          try {
            payload[key] = val ? JSON.parse(val) : (def.type === 'array' ? [] : {});
          } catch {
            alert('Invalid JSON in field: ' + key);
            return;
          }
        } else if (val !== '') {
          payload[key] = val;
        }
      }

      let res;
      if (editingRowId) {
        // Edit update
        res = await fetch(\`/api/collections/\${currentCollection.name}/\${editingRowId}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // Create insert
        res = await fetch(\`/api/collections/\${currentCollection.name}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        closeRecordModal();
        await fetchCollections();
        await selectCollection(currentCollection.name);
      } else {
        const err = await res.json();
        alert('Error: ' + err.error);
      }
    }

    async function deleteRow(id) {
      if (!confirm('Are you sure you want to delete this row? This is irreversible.')) return;
      
      const res = await fetch(\`/api/collections/\${currentCollection.name}/\${id}\`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchCollections();
        await selectCollection(currentCollection.name);
      } else {
        const err = await res.json();
        alert('Error: ' + err.error);
      }
    }
  </script>
</body>
</html>
`;
}
