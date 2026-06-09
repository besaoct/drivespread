# DriveSpread HTML Todo Application Example

This directory contains a complete, self-contained demonstration of a **Real-time Todo Application** using **DriveSpread** as a backend database.

It showcases:
1. **Google Sheets Storage**: Saving and updating todos on Google Sheets.
2. **REST CRUD Endpoints**: Creating (`POST /api/todos`), reading (`GET /api/todos`), updating (`PATCH /api/todos/:id`), and deleting (`DELETE /api/todos/:id`).
3. **Real-time WebSocket Synchronization**: Subscribing to database events via `DriveSpreadClient` to instantly update the UI when records are modified.
4. **Vibrant Glassmorphic UI**: Premium dark-mode design with smooth animations.
5. **Production-Ready UX Patterns**:
   - **Optimistic UI Updates**: Instantly reflects adds, toggles, and deletes in the DOM, reverting automatically with rollbacks on request failure.
   - **Debounced Rendering**: Prevents page blinking/flickering by batching rapid updates.
   - **In-Flight HTTP Loader**: Integrates the client's `onLoadingChange` hook to show a spinner during backend requests.
   - **WebSocket Connection Status Badging**: Drives connection status labels (`Synced`, `Connecting`, `Offline`) using connection callbacks.

## Prerequisites

1. Set up your Google credentials (either a Service Account or Personal Google OAuth - see the root `README.md` for steps).
2. Configure environment variables in `.env`.

## How to Setup & Run

### 1. Configure Environment Variables
Inside this `example` directory, copy the template environment file:
```bash
cp .env.example .env
```
Open `.env` and fill in your configuration:
- If using **Personal OAuth**, enter `DRIVESPREAD_DB`, `DRIVESPREAD_FOLDER_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`.
- If using a **Service Account**, enter `DRIVESPREAD_DB`, `DRIVESPREAD_FOLDER_ID`, and populate all `GOOGLE_` service account parameters.

### 2. Install Dependencies
Install the package dependencies inside this `example` directory (this links the example to the local package version):
```bash
npm install
```

### 3. Launch the Server
Start the Express server using Node's environment file flag:
```bash
node --env-file=.env server.js
```

Open your browser and navigate to:
**[http://localhost:3000](http://localhost:3000)**

Open multiple browser tabs side-by-side to watch updates sync in **real-time** across windows as you interact with the list!

---

## Production-Ready UX Patterns Explained

The frontend implementation in [index.html](file:///Users/besaoct/Desktop/drivesrpead/example/todo-html-express/index.html) demonstrates several key techniques for building a premium user experience when working with a network-backed database:

### 1. Optimistic UI Updates with Rollback
Because network requests to Google Sheets can take time (mitigated on the server side by background queues, but still constrained by internet latency), the application updates the UI **instantly** before sending the request. If the server fails to process the request, the change is rolled back.

**Example: Toggling a Todo**
```javascript
window.toggleCompleted = async (id, checked) => {
  const todoIdx = todos.findIndex(t => t._id === id);
  if (todoIdx === -1) return;
  
  // 1. Save the previous state and apply change optimistically
  const previousState = todos[todoIdx].completed;
  todos[todoIdx].completed = checked;
  todos[todoIdx]._isOptimistic = true;
  renderLists(); // Update UI instantly

  try {
    // 2. Perform the network update
    const realTodo = await wsClient.updateById('todos', id, { completed: checked });
    todos[todoIdx] = realTodo; // Update with true database record
    renderLists();
  } catch (err) {
    // 3. Roll back immediately if the network request fails
    todos[todoIdx].completed = previousState;
    delete todos[todoIdx]._isOptimistic;
    renderLists();
    alert('Failed to update todo');
  }
};
```

### 2. Debounced Rendering
When the client receives rapid updates (such as during bulk inserts, concurrent websocket events, or immediate responses), rendering the DOM synchronously for each event can cause visual blinking (strobing). 

To prevent this, the example uses a **20ms debounce** on the render function to batch multiple DOM rebuilds into a single clean refresh:
```javascript
let renderTimeout = null;
function renderLists() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => actualRenderLists(), 20);
}
```

### 3. Loading State Tracker
The SDK's `onLoadingChange` hook tracks in-flight request cycles. The UI uses this hook to show/hide a subtle header loader spinner:
```javascript
wsClient.onLoadingChange = (isLoading) => {
  const loader = document.getElementById('status-loader');
  if (isLoading) {
    loader.classList.add('active');
  } else {
    loader.classList.remove('active');
  }
};
```

### 4. Resilient Connection Status Badge
Using persistent callbacks on the client, the UI reflects real-time status transitions. If the connection drops, it falls back to a warning state and automatically reconnects in the background:
```javascript
wsClient.onOpen = () => {
  dot.className = 'status-dot connected';
  text.innerText = 'Synced';
};

wsClient.onClose = () => {
  dot.className = 'status-dot';
  text.innerText = 'Offline'; // Automatically attempts reconnection every 3s
};
```

