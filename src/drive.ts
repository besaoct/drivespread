import { google, drive_v3, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleCredentials } from './types.js';

export function parseCredentials(creds?: GoogleCredentials): {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  [key: string]: any;
} {
  if (creds) {
    if (typeof creds === 'string') {
      const trimmed = creds.trim();
      if (trimmed.startsWith('{')) {
        try {
          return JSON.parse(trimmed);
        } catch (err) {
          throw new Error(`Failed to parse credentials JSON string: ${(err as Error).message}`);
        }
      } else {
        try {
          const filePath = path.resolve(trimmed);
          const content = fs.readFileSync(filePath, 'utf8');
          return JSON.parse(content);
        } catch (err) {
          throw new Error(`Failed to read/parse credentials file from path "${trimmed}": ${(err as Error).message}`);
        }
      }
    }
    if (typeof creds === 'object' && ((creds.client_email && creds.private_key) || creds.refresh_token)) {
      return creds as any;
    }
  }

  // Fallback to individual environment variables
  if (
    (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) ||
    process.env.GOOGLE_REFRESH_TOKEN
  ) {
    return {
      type: process.env.GOOGLE_TYPE || 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      auth_uri: process.env.GOOGLE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
      token_uri: process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
      universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN || 'googleapis.com',
    };
  }

  throw new Error('Invalid credentials format. Must provide GOOGLE_SA_KEY (JSON string or file path) or individual env variables (GOOGLE_PRIVATE_KEY and GOOGLE_CLIENT_EMAIL, or GOOGLE_REFRESH_TOKEN).');
}

export class GoogleDriveService {
  private authClient: any;
  public drive: drive_v3.Drive;
  public sheets: sheets_v4.Sheets;

  constructor(credentials?: GoogleCredentials) {
    const credsObj = parseCredentials(credentials);
    
    if (credsObj.refresh_token) {
      const oauth2Client = new google.auth.OAuth2(
        credsObj.client_id,
        credsObj.client_secret,
        'http://localhost:4567/oauth2callback'
      );
      oauth2Client.setCredentials({
        refresh_token: credsObj.refresh_token
      });
      this.authClient = oauth2Client;
    } else {
      // Replace literal newlines in private key if it was passed via environment variable
      let privateKey = credsObj.private_key ? credsObj.private_key.replace(/\\n/g, '\n') : undefined;
      if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
      }

      this.authClient = new google.auth.JWT({
        email: credsObj.client_email,
        key: privateKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ],
      });
    }

    this.drive = google.drive({ version: 'v3', auth: this.authClient });
    this.sheets = google.sheets({ version: 'v4', auth: this.authClient });
  }

  private async wrap<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (err: any) {
      const message = err.message || '';
      const dataMessage = err.response?.data?.error?.message || '';
      const isQuota = message.includes("storageQuotaExceeded") || 
                      message.toLowerCase().includes("storage quota") ||
                      dataMessage.includes("storageQuotaExceeded") ||
                      dataMessage.toLowerCase().includes("storage quota") ||
                      (err.errors && err.errors.some((e: any) => e.reason === 'storageQuotaExceeded'));

      if (isQuota) {
        throw new Error(
          "DriveSpreadError: The service account's Google Drive storage is full. Please delete unused DriveSpread folders, run 'npx drivespread empty-trash', or use a new service account."
        );
      }
      throw err;
    }
  }

  /**
   * Get the current OAuth access token.
   */
  async getAccessToken(): Promise<string> {
    const token = await this.wrap<any>(this.authClient.getAccessToken());
    if (!token.token) {
      throw new Error('Failed to generate access token.');
    }
    return token.token;
  }

  /**
   * Finds a file/folder by name and parent folder ID.
   */
  async findByName(name: string, parentId?: string, mimeType?: string): Promise<string | null> {
    let query = `name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }
    if (mimeType) {
      query += ` and mimeType = '${mimeType}'`;
    }

    const res = await this.wrap(this.drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    }));

    const files = res.data.files;
    return files && files.length > 0 ? (files[0].id || null) : null;
  }

  /**
   * Creates a new folder in Google Drive.
   */
  async createFolder(name: string, parentId?: string): Promise<string> {
    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      fileMetadata.parents = [parentId];
    }

    const folder = await this.wrap(this.drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    }));

    if (!folder.data.id) {
      throw new Error(`Failed to create folder "${name}"`);
    }
    return folder.data.id;
  }

  /**
   * Creates a new spreadsheet inside a folder.
   */
  async createSpreadsheet(name: string, parentId: string): Promise<string> {
    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [parentId],
    };

    const spreadsheet = await this.wrap(this.drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    }));

    if (!spreadsheet.data.id) {
      throw new Error(`Failed to create spreadsheet "${name}"`);
    }
    return spreadsheet.data.id;
  }

  /**
   * Writes a JSON file to Google Drive.
   */
  async writeJsonFile(name: string, data: any, parentId: string, fileId?: string): Promise<string> {
    const media = {
      mimeType: 'application/json',
      body: JSON.stringify(data, null, 2),
    };

    if (fileId) {
      await this.wrap(this.drive.files.update({
        fileId,
        media,
      }));
      return fileId;
    } else {
      const fileMetadata = {
        name,
        parents: [parentId],
        mimeType: 'application/json',
      };
      const file = await this.wrap(this.drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id',
      }));
      if (!file.data.id) {
        throw new Error(`Failed to write JSON file "${name}"`);
      }
      return file.data.id;
    }
  }

  /**
   * Reads a JSON file from Google Drive.
   */
  async readJsonFile<T>(fileId: string): Promise<T> {
    const res = await this.wrap(this.drive.files.get({
      fileId,
      alt: 'media',
    }));
    // Res.data should be the JSON object
    if (typeof res.data === 'string') {
      return JSON.parse(res.data) as T;
    }
    return res.data as T;
  }

  /**
   * Upload a file/buffer to Google Drive (Blob Storage).
   */
  async uploadBlob(
    name: string,
    fileContent: Buffer | fs.ReadStream,
    contentType: string,
    parentId: string
  ): Promise<string> {
    const fileMetadata = {
      name,
      parents: [parentId],
    };
    const media = {
      mimeType: contentType,
      body: fileContent,
    };

    const file = await this.wrap(this.drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id',
    }));

    if (!file.data.id) {
      throw new Error(`Failed to upload blob "${name}"`);
    }
    return file.data.id;
  }

  /**
   * Download a blob from Google Drive.
   */
  async downloadBlob(fileId: string): Promise<{ data: Buffer; contentType: string }> {
    const metadata = await this.wrap(this.drive.files.get({
      fileId,
      fields: 'mimeType',
    }));
    
    const res = await this.wrap(this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    ));

    return {
      data: Buffer.from(res.data as ArrayBuffer),
      contentType: metadata.data.mimeType || 'application/octet-stream',
    };
  }

  /**
   * Deletes a file or folder.
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.wrap(this.drive.files.delete({ fileId }));
  }

  /**
   * Share file/folder publicly (read-only) for signed URL link generation.
   */
  async makePublic(fileId: string): Promise<string> {
    await this.wrap(this.drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    }));

    const res = await this.wrap(this.drive.files.get({
      fileId,
      fields: 'webContentLink, webViewLink',
    }));

    return res.data.webContentLink || res.data.webViewLink || '';
  }

  /**
   * Sheets API: Read all rows from a spreadsheet.
   */
  async readSheetValues(spreadsheetId: string, range = 'Sheet1!A:ZZ'): Promise<string[][]> {
    const res = await this.wrap(this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    }));
    return res.data.values || [];
  }

  /**
   * Sheets API: Update spreadsheet values.
   */
  async updateSheetValues(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    await this.wrap(this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    }));
  }

  /**
   * Sheets API: Clear sheet values in a range.
   */
  async clearSheetValues(spreadsheetId: string, range: string): Promise<void> {
    await this.wrap(this.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    }));
  }

  /**
   * Sheets API: Get cell count details for auto-sharding checks.
   */
  async getSheetCellCount(spreadsheetId: string): Promise<number> {
    const res = await this.wrap(this.sheets.spreadsheets.get({
      spreadsheetId,
    }));

    let cellCount = 0;
    const sheets = res.data.sheets || [];
    for (const s of sheets) {
      const props = s.properties?.gridProperties;
      if (props) {
        const rows = props.rowCount || 0;
        const cols = props.columnCount || 0;
        cellCount += rows * cols;
      }
    }
    return cellCount;
  }

  /**
   * Initialize a new collection sheet structure (Header Row setup)
   */
  async initSheetHeaders(spreadsheetId: string, headers: string[]): Promise<void> {
    // Setup Sheet1 headers
    await this.updateSheetValues(spreadsheetId, 'Sheet1!A1', [headers]);
  }

  /**
   * Sheets API: Batch updates (for lock manipulation, inserts, etc.)
   */
  async batchUpdate(spreadsheetId: string, requests: sheets_v4.Schema$Request[]): Promise<void> {
    await this.wrap(this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests,
      },
    }));
  }
}
