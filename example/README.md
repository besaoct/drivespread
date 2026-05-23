# DriveSpread HTML Todo Application Example

This directory contains a complete, self-contained demonstration of a **Realtime Todo Application** using **DriveSpread** as an installed dependency from NPM.

It showcases:
1. **Google Sheets Storage**: Saving and updating todos on Google Sheets.
2. **REST CRUD Endpoints**: Creating (`POST /api/todos`), reading (`GET /api/todos`), updating (`PATCH /api/todos/:id`), and deleting (`DELETE /api/todos/:id`).
3. **Realtime WebSocket Synchronization**: Subscribing to database events via `DriveSpreadClient` to instantly update the UI when records are modified.
4. **Vibrant Glassmorphic UI**: Outfitted dark-mode design with smooth animations.

## Prerequisites

1. Set up your Google Cloud Service Account credentials (see the root `README.md` for instructions).
2. Configure environment variables in `.env`.

## How to Setup & Run

### 1. Configure Environment Variables
Inside this `example` directory, copy the example environment file:
```bash
cp .env.example .env
```
Open `.env` and enter your database name and service account credentials path (or raw JSON key string).

### 2. Install Dependencies
Install the package dependencies inside this `example` directory (this fetches the `drivespread` library from the public NPM registry):
```bash
npm install
```

### 3. Launch the Todo server
Run the server using Node's native environment file support:
```bash
node --env-file=.env server.js
```

Open your browser and navigate to:
**[http://localhost:3000](http://localhost:3000)**

You can open multiple browser tabs side-by-side to watch updates sync in **realtime** as you create, update, or delete tasks!
