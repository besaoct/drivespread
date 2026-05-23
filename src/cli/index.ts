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

function askMultiLinePrivateKey(query: string): Promise<string> {
  const coloredQuery = `${c.bold}${c.blue}?${c.reset} ${c.bold}${query}${c.reset} ${c.dim}(Paste the key and press Enter twice, or paste it as a single line):${c.reset}\n`;
  console.log(coloredQuery);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const lines: string[] = [];
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '' && lines.length > 0) {
        rl.close();
        resolve(lines.join('\n'));
        return;
      }
      if (trimmed === '' && lines.length === 0) {
        rl.close();
        resolve('');
        return;
      }

      lines.push(line);

      if (line.includes('-----END PRIVATE KEY-----')) {
        rl.close();
        resolve(lines.join('\n'));
      }
    });
  });
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

  const folderIdInput = await askQuestion('Enter Google Drive Folder ID (if already created on your main Drive) [Optional]: ');

  const authChoice = await askQuestion(
    'Select Google authentication method:\n' +
    '  1) Google Service Account (JSON file or manual keys)\n' +
    '  2) Personal Google Account (OAuth2 Client ID/Secret)\n' +
    'Enter choice (1 or 2, default: 1): '
  );

  const isPersonal = authChoice === '2';
  let credsObj: Record<string, string> = {};
  let clientId = '';
  let clientSecret = '';
  let refreshToken = '';

  if (isPersonal) {
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
  } else {
    const useJson = await askQuestion('Do you want to initialize using a Google Service Account JSON key file? (y/N): ');
    
    if (useJson.toLowerCase() === 'y' || useJson.toLowerCase() === 'yes') {
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
        credsObj = JSON.parse(fileContent);
      } catch (err: any) {
        ui.error(`Failed to parse credentials file: ${err.message}`);
        return;
      }

      const requiredFields = ['project_id', 'private_key', 'client_email'];
      for (const field of requiredFields) {
        if (!credsObj[field]) {
          ui.error(`Credentials JSON is missing required field: "${field}"`);
          return;
        }
      }
    } else {
      // Prompt for individual required keys
      const projectId = await askQuestion('Enter Google Project ID (project_id): ');
      if (!projectId) {
        ui.error('Project ID is required.');
        return;
      }

      const clientEmail = await askQuestion('Enter Google Client Email (client_email): ');
      if (!clientEmail) {
        ui.error('Client Email is required.');
        return;
      }

      const privateKey = await askMultiLinePrivateKey('Enter Google Private Key (private_key): ');
      if (!privateKey) {
        ui.error('Private Key is required.');
        return;
      }

      credsObj = {
        project_id: projectId,
        client_email: clientEmail,
        private_key: privateKey,
      };

      const configureAdvanced = await askQuestion('Would you like to configure advanced/optional Google credentials? (y/N): ');
      if (configureAdvanced.toLowerCase() === 'y' || configureAdvanced.toLowerCase() === 'yes') {
        credsObj.type = await askQuestion('Enter Google Account Type (type) [Optional, default: service_account]: ') || 'service_account';
        credsObj.private_key_id = await askQuestion('Enter Google Private Key ID (private_key_id) [Optional]: ');
        credsObj.client_id = await askQuestion('Enter Google Client ID (client_id) [Optional]: ');
        credsObj.auth_uri = await askQuestion('Enter Google Auth URI [Optional, default: https://accounts.google.com/o/oauth2/auth]: ') || 'https://accounts.google.com/o/oauth2/auth';
        credsObj.token_uri = await askQuestion('Enter Google Token URI [Optional, default: https://oauth2.googleapis.com/token]: ') || 'https://oauth2.googleapis.com/token';
        credsObj.auth_provider_x509_cert_url = await askQuestion('Enter Google Auth Provider X509 Cert URL [Optional, default: https://www.googleapis.com/oauth2/v1/certs]: ') || 'https://www.googleapis.com/oauth2/v1/certs';
        credsObj.client_x509_cert_url = await askQuestion('Enter Google Client X509 Cert URL [Optional]: ');
        credsObj.universe_domain = await askQuestion('Enter Google Universe Domain [Optional, default: googleapis.com]: ') || 'googleapis.com';
      }
    }
  }

  // Format private key correctly with escaped newlines for .env parsing
  const formattedPrivateKey = credsObj.private_key ? credsObj.private_key.replace(/\n/g, '\\n') : '';

  ui.info('Verifying Google Cloud credentials and API access...');
  try {
    const tempDb = new DriveSpread({
      db: dbName,
      credentials: isPersonal ? {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      } : {
        type: credsObj.type || 'service_account',
        project_id: credsObj.project_id,
        private_key_id: credsObj.private_key_id,
        private_key: formattedPrivateKey,
        client_email: credsObj.client_email,
        client_id: credsObj.client_id,
        auth_uri: credsObj.auth_uri,
        token_uri: credsObj.token_uri,
        auth_provider_x509_cert_url: credsObj.auth_provider_x509_cert_url,
        client_x509_cert_url: credsObj.client_x509_cert_url,
        universe_domain: credsObj.universe_domain,
      },
      folderId: folderIdInput || undefined,
    });
    
    // Call list files to verify auth and API enablement
    await tempDb.driveService.drive.files.list({ pageSize: 1 });
    ui.success('Connection verified successfully!');
  } catch (err: any) {
    ui.warn(`Could not verify Google Cloud connection: ${err.message}`);
    const proceed = await askQuestion('Do you want to write these configurations to your .env file anyway? (y/N): ');
    if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
      ui.info('Aborted. Configuration was not written to .env.');
      return;
    }
  }

  // Build the list of env keys
  const envEntries = [
    `DRIVESPREAD_DB="${dbName}"`,
    `DRIVESPREAD_FOLDER_ID="${folderIdInput}"`,
  ];

  if (isPersonal) {
    envEntries.push(
      `GOOGLE_CLIENT_ID="${clientId}"`,
      `GOOGLE_CLIENT_SECRET="${clientSecret}"`,
      `GOOGLE_REFRESH_TOKEN="${refreshToken}"`
    );
  } else {
    envEntries.push(
      `GOOGLE_TYPE="${credsObj.type || 'service_account'}"`,
      `GOOGLE_PROJECT_ID="${credsObj.project_id}"`,
      `GOOGLE_PRIVATE_KEY_ID="${credsObj.private_key_id || ''}"`,
      `GOOGLE_PRIVATE_KEY="${formattedPrivateKey}"`,
      `GOOGLE_CLIENT_EMAIL="${credsObj.client_email}"`,
      `GOOGLE_CLIENT_ID="${credsObj.client_id || ''}"`,
      `GOOGLE_AUTH_URI="${credsObj.auth_uri || 'https://accounts.google.com/o/oauth2/auth'}"`,
      `GOOGLE_TOKEN_URI="${credsObj.token_uri || 'https://oauth2.googleapis.com/token'}"`,
      `GOOGLE_AUTH_PROVIDER_X509_CERT_URL="${credsObj.auth_provider_x509_cert_url || 'https://www.googleapis.com/oauth2/v1/certs'}"`,
      `GOOGLE_CLIENT_X509_CERT_URL="${credsObj.client_x509_cert_url || ''}"`,
      `GOOGLE_UNIVERSE_DOMAIN="${credsObj.universe_domain || 'googleapis.com'}"`
    );
  }

  const envContent = `\n# DriveSpread Configurations\n${envEntries.join('\n')}\n`;
  fs.appendFileSync(path.resolve('.env'), envContent);

  console.log('');
  ui.success(`DriveSpread configurations successfully extracted & appended to ${c.bold}.env${c.reset}!`);
  ui.info(`All ${c.bold}${envEntries.length - 2}${c.reset} individual Google credential keys have been written directly to your environment.`);
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
    const db = new DriveSpread({ db: dbName, credentials: saKey || undefined });
    await db.init();

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
