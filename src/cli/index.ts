#!/usr/bin/env node
import { argv } from 'process';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
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

async function main() {
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
  ${c.green}init${c.reset}      Interactive walkthrough to set up credentials file path & namespace
  ${c.green}migrate${c.reset}   Sync collection rows from Sheets to PostgreSQL or MongoDB
  ${c.green}studio${c.reset}    Launch local premium web console to browse and edit collections
  `);
}

async function runInit() {
  ui.heading('Initialize DriveSpread Database Configuration');
  
  const dbName = await askQuestion('Enter database name (e.g. my-app-prod): ');
  if (!dbName) {
    ui.error('Database name cannot be empty.');
    return;
  }

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

  // Create or append to .env
  const envContent = `\nGOOGLE_SA_KEY="${saPath}"\nDRIVESPREAD_DB="${dbName}"\n`;
  fs.appendFileSync(path.resolve('.env'), envContent);

  console.log('');
  ui.success(`DriveSpread configurations appended to ${c.bold}.env${c.reset}:`);
  console.log(`  ${c.dim}GOOGLE_SA_KEY${c.reset}=${c.green}"${saPath}"${c.reset}`);
  console.log(`  ${c.dim}DRIVESPREAD_DB${c.reset}=${c.green}"${dbName}"${c.reset}\n`);
  ui.info(`Make sure to enable ${c.bold}Google Sheets & Google Drive APIs${c.reset} in Google Cloud Console.`);
}

async function runMigrate() {
  ui.heading('Migrate DriveSpread Sheets to SQL/NoSQL DB');
  
  const dbName = process.env.DRIVESPREAD_DB || await askQuestion('Enter database name: ');
  const saKey = process.env.GOOGLE_SA_KEY || await askQuestion('Enter service account key path or JSON: ');

  if (!dbName || !saKey) {
    ui.error('Database name and credentials path are required.');
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
    const db = new DriveSpread({ db: dbName, credentials: saKey });
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
  const saKey = process.env.GOOGLE_SA_KEY || await askQuestion('Enter service account credentials key path or JSON: ');

  if (!dbName || !saKey) {
    ui.error('Database name and credentials path are required.');
    return;
  }

  const { startStudio } = await import('./studio.js');
  ui.success(`Initializing DriveSpread Studio for "${c.bold}${dbName}${c.reset}"...`);
  startStudio(dbName, saKey);
}

main().catch(console.error);
