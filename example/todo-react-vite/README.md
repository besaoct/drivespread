# DriveSpread — Real-time React + Vite Todo Demo

This is a premium, real-time Todo application built with **React**, **Vite**, **TypeScript**, and **DriveSpread** (using Google Sheets and Google Drive as the database backend).

The app features a glassmorphic dark theme and uses **WebSockets** to automatically sync changes in real time across multiple browser tabs/clients.

## Architecture

1. **Backend (`server.js`)**: Runs a light Express server that mounts the `DriveSpread` database and serves the REST and WebSocket endpoints. In production, it also serves the built static frontend assets.
2. **Frontend (`src/App.tsx`)**: A client-side React app built with Vite.
   * During development: Runs on Vite's dev server (`port 5173`) and proxies API and Auth calls to the backend on `port 3000`. It connects to WebSockets directly on `ws://localhost:3000`.
   * During production: Compiled to static files in the `/dist` directory, served directly by the Express backend.

## Prerequisites

You need a Google Cloud service account key. If you don't have one:
1. Create a project in the Google Cloud Console.
2. Enable the **Google Sheets API** and **Google Drive API**.
3. Create a **Service Account** under IAM & Admin, download the key as a **JSON** file.

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and paste your Google Service Account JSON string in `GOOGLE_SA_KEY`, or specify the absolute path to your downloaded JSON file:
   ```env
   GOOGLE_SA_KEY="/absolute/path/to/your/service-account.json"
   ```
   *(Optional)* Configure `DRIVESPREAD_DB` with a custom database folder name.

## Running the Application

### Development Mode

Run the following command to start both the Express backend and the Vite frontend concurrently:

```bash
npm run dev
```

* Frontend dev server: [http://localhost:5173](http://localhost:5173)
* Backend DB server: [http://localhost:3000](http://localhost:3000)

Open multiple browser tabs to watch updates sync in real-time across them when you add, toggle, or delete tasks!

### Production Mode

To build and run the application in a production-ready unified server:

1. Build the static assets:
   ```bash
   npm run build
   ```
2. Start the unified server (automatically loads the `.env` variables using Node 20.6+ native env support):
   ```bash
   node --env-file=.env server.js
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.
