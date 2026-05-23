# DriveSpread — Next.js TypeScript Tailwind CSS Demo

This is a premium, server-side rendered (SSR) Todo application built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS v4**, and **DriveSpread** (Google Sheets and Google Drive database).

## Features

1. **Server-Side Fetching (SSR)**: The home page (`src/app/page.tsx`) queries the Google Sheets database directly on the server, ensuring instant initial load times and great SEO.
2. **Next.js Catch-All Route Handlers**: Uses DriveSpread's built-in `nextHandler()` in a catch-all route (`src/app/api/[...route]/route.ts`) to handle all database operations over HTTP.
3. **Tailwind CSS v4**: Beautiful, dark glassmorphic styling powered by Tailwind CSS v4.

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

Run the Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Mode

Build and run the production server:

1. Build the Next.js bundle:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   npm run start
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.
