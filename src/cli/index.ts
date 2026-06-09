#!/usr/bin/env node
import { argv } from 'process';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
import * as http from 'http';
import { google } from 'googleapis';
import { DriveSpread } from '../database.js';

// ANSI Terminal Colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
};

const ui = {
  info: (msg: string) => console.log(`${c.cyan}ℹ${c.reset} ${msg}`),
  success: (msg: string) => console.log(`${c.green}✔${c.reset} ${msg}`),
  warn: (msg: string) => console.log(`${c.yellow}⚠${c.reset} ${msg}`),
  error: (msg: string) => console.error(`${c.red}✖ ${c.bold}Error:${c.reset} ${c.red}${msg}${c.reset}`),
  heading: (title: string) => console.log(`\n${c.bold}${c.magenta}🚀 ${title}${c.reset}\n`),
};

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const coloredQuery = `${c.bold}${c.blue}?${c.reset} ${c.bold}${query}${c.reset}`;
  return new Promise((resolve) =>
    rl.question(coloredQuery, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}




function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const resolvedPath = path.resolve(file);
    if (fs.existsSync(resolvedPath)) {
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (!match) continue;
          const key = match[1].trim();
          let val = match[2].trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      } catch (err) {
        // Ignore
      }
    }
  }
}

async function main() {
  loadEnv();
  const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
  if (majorVersion < 24) {
    console.log(`\n${c.yellow}${c.bold}⚠️  Node.js Version Warning${c.reset}`);
    console.log(`DriveSpread requires Node.js version ${c.bold}24.0.0+${c.reset}. Your current version is ${c.red}${process.version}${c.reset}.\n`);
    console.log(`To upgrade Node.js, run one of the following commands:`);
    console.log(`  • ${c.cyan}nvm${c.reset}:  nvm install 24 && nvm use 24`);
    console.log(`  • ${c.cyan}fnm${c.reset}:  fnm install 24 && fnm use 24`);
    console.log(`  • ${c.cyan}brew${c.reset}: brew install node@24 && brew link --overwrite node@24\n`);
  }

  const command = argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'init':
      await runInit();
      break;
    case 'migrate':
      await runMigrate();
      break;
    case 'studio':
      await runStudio();
      break;
    case 'empty-trash':
      await runEmptyTrash();
      break;
    case 'share':
      await runShare();
      break;
    default:
      ui.error(`Unknown command: "${command}". Run ${c.bold}drivespread --help${c.reset} for help.`);
  }
}

function printHelp() {
  console.log(`
${c.bold}${c.magenta}DriveSpread CLI${c.reset} ${c.dim}- Zero-Infrastructure Google Sheets Database Manager${c.reset}

${c.bold}USAGE:${c.reset}
  ${c.cyan}npx drivespread${c.reset} <command>

${c.bold}COMMANDS:${c.reset}
  ${c.green}init${c.reset}        Interactive walkthrough to set up credentials file path & namespace
  ${c.green}migrate${c.reset}     Sync collection rows from Sheets to PostgreSQL or MongoDB
  ${c.green}studio${c.reset}      Launch local premium web console to browse and edit collections
  ${c.green}empty-trash${c.reset} Permanent purge of the Google Drive trash to reclaim quota
  ${c.green}share${c.reset}       Share the database Drive folder with a collaborator/Gmail address
  `);
}

async function runOAuthFlow(clientId: string, clientSecret: string): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:4567/oauth2callback'
  );
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  ui.info(`To authorize DriveSpread, please open the following URL in your browser:\n\n  ${c.bold}${c.cyan}${authUrl}${c.reset}\n`);
  ui.info('Waiting for authentication callback on http://localhost:4567/oauth2callback ...');

  // Best-effort auto-open browser
  try {
    const { exec } = await import('child_process');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${authUrl.replace(/"/g, '\\"')}"`);
  } catch (err) {
    // Ignore
  }

  let server: http.Server | null = null;
  const codePromise = new Promise<string>((resolve, reject) => {
    server = http.createServer((req, res) => {
      if (req.url && req.url.startsWith('/oauth2callback')) {
        const urlObj = new URL(req.url, 'http://localhost:4567');
        const authCode = urlObj.searchParams.get('code');
        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Successful!</h1><p>You can close this tab/window and return to your terminal.</p>');
          resolve(authCode);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Failed</h1><p>No authorization code found in the query parameters.</p>');
          reject(new Error('OAuth callback did not provide an authorization code.'));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error('Port 4567 is already in use. Please close the application using port 4567 and try again.'));
      } else {
        reject(err);
      }
    });

    server.listen(4567);
  });

  try {
    const authCode = await codePromise;
    ui.info('Exchanging authorization code for tokens...');
    const { tokens } = await oauth2Client.getToken(authCode);
    const refreshToken = tokens.refresh_token || '';
    if (!refreshToken) {
      throw new Error('Google did not return a refresh token. Please revoke access to this app in your Google Account settings and try again to get a new refresh token.');
    }
    return refreshToken;
  } finally {
    if (server) {
      (server as http.Server).close();
    }
  }
}

async function runInit() {
  ui.heading('Initialize DriveSpread Database Configuration');

  const dbName = await askQuestion('Enter database name (e.g. my-app-prod): ');
  if (!dbName) {
    ui.error('Database name cannot be empty.');
    return;
  }

  console.log(`\nSelect Authentication Method:`);
  console.log(`  ${c.bold}1)${c.reset} Personal Google Account (OAuth - Recommended for personal/dev/free projects)`);
  console.log(`  ${c.bold}2)${c.reset} Google Cloud Service Account (Key JSON - Recommended for Workspace/production)`);
  const authChoice = await askQuestion('Choose option (1 or 2, default: 1): ');

  const usePersonalOAuth = authChoice !== '2';

  let clientId = '';
  let clientSecret = '';
  let refreshToken = '';
  let useServiceAccount = false;
  let saCredsObj: Record<string, string> = {};
  let formattedPrivateKey = '';
  let dbFolderId = '';

  if (usePersonalOAuth) {
    ui.info('\nStep 1: Personal Account Authentication Setup');
    ui.warn('Important OAuth Pre-requisites:');
    console.log(`  To set up Google Drive & Sheets API OAuth credentials:`);
    console.log(`  1. Open the Google Cloud Console: ${c.cyan}https://console.cloud.google.com/${c.reset}`);
    console.log(`  2. Create a project (or select an existing one).`);
    console.log(`  3. Enable Google Drive API & Google Sheets API:`);
    console.log(`     - Go to: ${c.cyan}https://console.cloud.google.com/apis/library${c.reset}`);
    console.log(`     - Search for and enable ${c.bold}Google Drive API${c.reset} and ${c.bold}Google Sheets API${c.reset}`);
    console.log(`  4. Configure OAuth Consent Screen:`);
    console.log(`     - Go to: ${c.cyan}https://console.cloud.google.com/apis/credentials/consent${c.reset}`);
    console.log(`     - Select User Type: ${c.bold}External${c.reset}, fill in basic app details.`);
    console.log(`     - Under the "Test users" step, add your Gmail address (${c.bold}critical${c.reset} for dev apps).`);
    console.log(`  5. Create OAuth 2.0 Credentials:`);
    console.log(`     - Go to: ${c.cyan}https://console.cloud.google.com/apis/credentials${c.reset}`);
    console.log(`     - Click ${c.bold}+ Create Credentials${c.reset} -> ${c.bold}OAuth client ID${c.reset}`);
    console.log(`     - Select Application type: ${c.bold}Web application${c.reset}`);
    console.log(`     - Under ${c.bold}Authorized redirect URIs${c.reset}, click Add URI and paste:`);
    console.log(`       ${c.green}http://localhost:4567/oauth2callback${c.reset}`);
    console.log(`     - Click Create to retrieve your Client ID and Client Secret.`);
    console.log(`  6. Consent Screen Warning Bypass:`);
    console.log(`     - During login, click ${c.bold}Advanced${c.reset} -> ${c.bold}Go to <App Name> (unsafe)${c.reset} to proceed.\n`);

    clientId = await askQuestion('Enter Google Client ID: ');
    if (!clientId) {
      ui.error('Client ID is required.');
      return;
    }

    clientSecret = await askQuestion('Enter Google Client Secret: ');
    if (!clientSecret) {
      ui.error('Client Secret is required.');
      return;
    }

    try {
      refreshToken = await runOAuthFlow(clientId, clientSecret);
      ui.success('Personal account authorized successfully!');
    } catch (err: any) {
      ui.error(`OAuth authentication failed: ${err.message}`);
      return;
    }

    ui.info('\nStep 2: Database Folder Creation');
    ui.info('Creating database folder and initial configuration on your personal Google Drive...');

    try {
      const personalDb = new DriveSpread({
        db: dbName,
        credentials: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        },
      });

      await personalDb.init();
      dbFolderId = personalDb.getFolderId()!;
      ui.success(`Database created successfully! Folder ID: ${dbFolderId}`);
    } catch (err: any) {
      ui.error(`Failed to initialize database: ${err.message}`);
      return;
    }

    ui.info('\nStep 3: Service Account Collaboration (Optional)');
    ui.info('You can share this folder with a Service Account so your backend can read/write to it.');
    const shareWithSa = await askQuestion('Would you like to share this database folder with a Service Account? (y/N): ');

    if (shareWithSa.toLowerCase() === 'y' || shareWithSa.toLowerCase() === 'yes') {
      const saPath = await askQuestion('Enter path to Google Service Account JSON file (e.g. ./credentials.json): ');
      if (saPath) {
        const resolvedPath = path.resolve(saPath);
        if (!fs.existsSync(resolvedPath)) {
          ui.error(`Credentials file not found at path: ${resolvedPath}`);
        } else {
          try {
            const fileContent = fs.readFileSync(resolvedPath, 'utf8');
            saCredsObj = JSON.parse(fileContent);

            if (!saCredsObj.client_email || !saCredsObj.private_key) {
              ui.error('JSON file is missing "client_email" or "private_key".');
            } else {
              ui.info(`Sharing database folder with ${saCredsObj.client_email}...`);
              // Use personal OAuth to share the folder with the Service Account
              const personalDb = new DriveSpread({
                db: dbName,
                credentials: {
                  client_id: clientId,
                  client_secret: clientSecret,
                  refresh_token: refreshToken,
                },
              });
              await personalDb.init();
              await personalDb.driveService.drive.permissions.create({
                fileId: dbFolderId,
                requestBody: {
                  role: 'writer',
                  type: 'user',
                  emailAddress: saCredsObj.client_email,
                },
              });
              ui.success('Folder shared successfully!');
              useServiceAccount = true;
              formattedPrivateKey = saCredsObj.private_key.replace(/\n/g, '\\n');
            }
          } catch (err: any) {
            ui.error(`Failed to share with Service Account: ${err.message}`);
          }
        }
      }
    }
  } else {
    // Service Account Key Flow
    ui.info('\nStep 1: Service Account Key Input');
    const saPath = await askQuestion('Enter path to Google Service Account JSON file (e.g. ./credentials.json): ');
    if (!saPath) {
      ui.error('Service account key path is required.');
      return;
    }

    const resolvedPath = path.resolve(saPath);
    if (!fs.existsSync(resolvedPath)) {
      ui.error(`Credentials file not found at path: ${resolvedPath}`);
      return;
    }

    try {
      const fileContent = fs.readFileSync(resolvedPath, 'utf8');
      saCredsObj = JSON.parse(fileContent);

      if (!saCredsObj.client_email || !saCredsObj.private_key) {
        ui.error('JSON file is missing "client_email" or "private_key".');
        return;
      }
      useServiceAccount = true;
      formattedPrivateKey = saCredsObj.private_key.replace(/\n/g, '\\n');
    } catch (err: any) {
      ui.error(`Failed to parse Service Account JSON: ${err.message}`);
      return;
    }

    ui.info('\nStep 2: Database Folder Details');
    ui.warn('Note: Because Google Service Accounts typically have a 0-byte storage quota by default:');
    console.log(`  - If the Service Account is in a Workspace / has quota, it can create a folder automatically.`);
    console.log(`  - Otherwise, you should create a folder in your Personal Google Drive, share it with the Service Account's email (${c.cyan}${saCredsObj.client_email}${c.reset}) as a Writer, and input its Folder ID below.\n`);

    dbFolderId = await askQuestion('Enter existing Google Drive Folder ID (leave empty to try auto-creating): ');

    if (!dbFolderId) {
      ui.info('Attempting to create folder as the Service Account...');
      try {
        const saDb = new DriveSpread({
          db: dbName,
          credentials: {
            client_email: saCredsObj.client_email,
            private_key: saCredsObj.private_key,
          },
        });
        await saDb.init();
        dbFolderId = saDb.getFolderId()!;
        ui.success(`Folder created successfully! ID: ${dbFolderId}`);
      } catch (err: any) {
        ui.error(`Failed to auto-create folder: ${err.message}`);
        console.log(`Please create the folder manually, share it with ${c.cyan}${saCredsObj.client_email}${c.reset}, and rerun 'init' supplying the Folder ID.`);
        return;
      }
    }
  }

  // Build the list of env keys
  const envEntries = [
    `DRIVESPREAD_DB="${dbName}"`,
    `DRIVESPREAD_FOLDER_ID="${dbFolderId}"`,
  ];

  if (useServiceAccount) {
    ui.info('\nWriting Service Account credentials to .env...');
    envEntries.push(
      `GOOGLE_TYPE="${saCredsObj.type || 'service_account'}"`,
      `GOOGLE_PROJECT_ID="${saCredsObj.project_id || ''}"`,
      `GOOGLE_PRIVATE_KEY_ID="${saCredsObj.private_key_id || ''}"`,
      `GOOGLE_PRIVATE_KEY="${formattedPrivateKey}"`,
      `GOOGLE_CLIENT_EMAIL="${saCredsObj.client_email}"`,
      `GOOGLE_CLIENT_ID="${saCredsObj.client_id || ''}"`,
      `GOOGLE_AUTH_URI="${saCredsObj.auth_uri || 'https://accounts.google.com/o/oauth2/auth'}"`,
      `GOOGLE_TOKEN_URI="${saCredsObj.token_uri || 'https://oauth2.googleapis.com/token'}"`,
      `GOOGLE_AUTH_PROVIDER_X509_CERT_URL="${saCredsObj.auth_provider_x509_cert_url || 'https://www.googleapis.com/oauth2/v1/certs'}"`,
      `GOOGLE_CLIENT_X509_CERT_URL="${saCredsObj.client_x509_cert_url || ''}"`,
      `GOOGLE_UNIVERSE_DOMAIN="${saCredsObj.universe_domain || 'googleapis.com'}"`
    );
  } else {
    ui.info('\nWriting Personal OAuth credentials to .env...');
    envEntries.push(
      `GOOGLE_CLIENT_ID="${clientId}"`,
      `GOOGLE_CLIENT_SECRET="${clientSecret}"`,
      `GOOGLE_REFRESH_TOKEN="${refreshToken}"`
    );
  }

  const envContent = `\n# DriveSpread Configurations\n${envEntries.join('\n')}\n`;
  fs.appendFileSync(path.resolve('.env'), envContent);

  console.log('');
  ui.success(`DriveSpread configurations successfully extracted & appended to ${c.bold}.env${c.reset}!`);
}

async function runMigrate() {
  ui.heading('Migrate DriveSpread Sheets to SQL/NoSQL DB');

  const dbName = process.env.DRIVESPREAD_DB || await askQuestion('Enter database name: ');
  const hasIndividualEnv = (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) || process.env.GOOGLE_REFRESH_TOKEN;
  let saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey && !hasIndividualEnv) {
    saKey = await askQuestion('Enter service account credentials key path or JSON: ');
  }

  if (!dbName || (!saKey && !hasIndividualEnv)) {
    ui.error('Database name and credentials are required.');
    return;
  }

  const targetType = await askQuestion('Select target database (mongo / postgres): ');
  if (targetType !== 'mongo' && targetType !== 'postgres') {
    ui.error('Invalid target. Please specify "mongo" or "postgres".');
    return;
  }

  const connString = await askQuestion('Enter target connection URL: ');
  if (!connString) {
    ui.error('Connection URL cannot be empty.');
    return;
  }

  try {
    ui.info('Connecting to Google Drive...');
    const db = new DriveSpread({ db: dbName, credentials: saKey || undefined });
    await db.init();
    const meta = db.getMetadata();
    const collections = Object.keys(meta.collections);

    ui.success(`Connected. Found ${c.bold}${collections.length}${c.reset} collections: ${c.cyan}${collections.join(', ')}${c.reset}`);

    if (targetType === 'mongo') {
      const { MongoClient } = await import('mongodb' as any).catch(() => {
        throw new Error('Please install mongodb package locally: npm install mongodb');
      });
      const client = new MongoClient(connString);
      await client.connect();
      const mongoDb = client.db(dbName);

      for (const colName of collections) {
        ui.info(`Migrating collection "${c.bold}${colName}${c.reset}" to MongoDB...`);
        const col = db.collection(colName);
        const rows = await col.getAllRawRows();
        if (rows.length > 0) {
          const cleanRows = rows.map((r) => {
            const { _shardId, _rowNumber, ...rest } = r as any;
            return { ...rest, _id: r._id };
          });
          await mongoDb.collection(colName).insertMany(cleanRows);
        }
      }
      await client.close();
      ui.success('Migration to MongoDB completed successfully!');
    } else {
      // PostgreSQL
      const pg = await import('pg' as any).catch(() => {
        throw new Error('Please install pg package locally: npm install pg');
      });
      const client = new pg.Client({ connectionString: connString });
      await client.connect();

      for (const colName of collections) {
        ui.info(`Migrating table "${c.bold}${colName}${c.reset}" to PostgreSQL...`);
        const col = db.collection(colName);
        const rows = await col.getAllRawRows();
        const schema = meta.collections[colName].schema;

        // Build simple table create query
        const colDefs = ['_id VARCHAR(50) PRIMARY KEY', '_version INT', '_createdAt TIMESTAMP', '_updatedAt TIMESTAMP'];
        for (const [key, field] of Object.entries(schema)) {
          let pgType = 'TEXT';
          if (field.type === 'number') pgType = 'NUMERIC';
          else if (field.type === 'boolean') pgType = 'BOOLEAN';
          else if (field.type === 'date') pgType = 'TIMESTAMP';
          colDefs.push(`"${key}" ${pgType}`);
        }

        await client.query(`DROP TABLE IF EXISTS "${colName}" CASCADE;`);
        await client.query(`CREATE TABLE "${colName}" (${colDefs.join(', ')});`);

        for (const row of rows) {
          const keys = ['_id', '_version', '_createdAt', '_updatedAt', ...Object.keys(schema)];
          const columnsStr = keys.map((k) => `"${k}"`).join(', ');
          const valuesPlaceholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');

          const values = keys.map((k) => {
            const val = (row as any)[k];
            if (val && typeof val === 'object') return JSON.stringify(val);
            return val;
          });

          await client.query(
            `INSERT INTO "${colName}" (${columnsStr}) VALUES (${valuesPlaceholders})`,
            values
          );
        }
      }
      await client.end();
      ui.success('Migration to PostgreSQL completed successfully!');
    }
  } catch (err) {
    ui.error(`Migration failed: ${(err as Error).message}`);
  }
}

async function runStudio() {
  ui.heading('Launch DriveSpread Studio Dashboard');

  const dbName = process.env.DRIVESPREAD_DB || await askQuestion('Enter database name: ');
  const hasIndividualEnv = (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) || process.env.GOOGLE_REFRESH_TOKEN;
  let saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey && !hasIndividualEnv) {
    saKey = await askQuestion('Enter service account credentials key path or JSON: ');
  }

  if (!dbName || (!saKey && !hasIndividualEnv)) {
    ui.error('Database name and credentials are required.');
    return;
  }

  const { startStudio } = await import('./studio.js');
  ui.success(`Initializing DriveSpread Studio for "${c.bold}${dbName}${c.reset}"...`);
  startStudio(dbName, saKey || undefined);
}

async function runEmptyTrash() {
  ui.heading('Empty Google Drive Trash for Service Account');

  const dbName = process.env.DRIVESPREAD_DB || await askQuestion('Enter database name: ');
  const hasIndividualEnv = (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) || process.env.GOOGLE_REFRESH_TOKEN;
  let saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey && !hasIndividualEnv) {
    saKey = await askQuestion('Enter service account credentials key path or JSON: ');
  }

  if (!dbName || (!saKey && !hasIndividualEnv)) {
    ui.error('Database name and credentials are required.');
    return;
  }

  try {
    ui.info('Connecting to Google Drive...');
    // Use driveService directly without db.init() — init tries to create
    // folders/spreadsheets which fails when storage is full (the exact
    // scenario where empty-trash is needed).
    const db = new DriveSpread({ db: dbName, credentials: saKey || undefined });

    ui.info('Emptying Google Drive trash bin...');
    await db.driveService.drive.files.emptyTrash();
    ui.success('Google Drive trash has been permanently emptied!');
  } catch (err: any) {
    ui.error(`Failed to empty trash: ${err.message}`);
  }
}

async function runShare() {
  ui.heading('Share Database Folder with Google Account');

  const dbName = process.env.DRIVESPREAD_DB || await askQuestion('Enter database name: ');
  const hasIndividualEnv = (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) || process.env.GOOGLE_REFRESH_TOKEN;
  let saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey && !hasIndividualEnv) {
    saKey = await askQuestion('Enter service account credentials key path or JSON: ');
  }

  if (!dbName || (!saKey && !hasIndividualEnv)) {
    ui.error('Database name and credentials are required.');
    return;
  }

  const emailAddress = argv[3] || await askQuestion('Enter Gmail/Google email address to share with: ');
  if (!emailAddress) {
    ui.error('Email address is required.');
    return;
  }

  try {
    ui.info('Connecting to Google Drive...');
    const db = new DriveSpread({ db: dbName, credentials: saKey || undefined });
    await db.init();

    const folderId = db.getFolderId();
    if (!folderId) {
      ui.error('Failed to locate database folder ID.');
      return;
    }

    ui.info(`Sharing folder "${dbName}" with ${emailAddress} as writer...`);
    await db.driveService.drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: 'writer',
        type: 'user',
        emailAddress: emailAddress,
      },
      sendNotificationEmail: true,
    });

    ui.success(`Database folder successfully shared with ${c.bold}${emailAddress}${c.reset}!`);
    ui.info('Check the "Shared with me" section in Google Drive for that account.');
  } catch (err: any) {
    ui.error(`Failed to share folder: ${err.message}`);
  }
}

main().catch(console.error);
