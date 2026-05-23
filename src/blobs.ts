import { GoogleDriveService } from './drive.js';
import * as fs from 'fs';
import * as path from 'path';

export class BlobManager {
  private driveService: GoogleDriveService;
  private databaseFolderId?: string;
  private blobsFolderId?: string;

  constructor(driveService: GoogleDriveService) {
    this.driveService = driveService;
  }

  setDatabaseFolderId(id: string) {
    this.databaseFolderId = id;
    this.blobsFolderId = undefined; // Force reload
  }

  /**
   * Finds or creates the /blobs subfolder.
   */
  async getOrCreateBlobsFolder(): Promise<string> {
    if (this.blobsFolderId) return this.blobsFolderId;
    if (!this.databaseFolderId) {
      throw new Error('Database folder ID not initialized.');
    }

    const folderId = await this.driveService.findByName('blobs', this.databaseFolderId, 'application/vnd.google-apps.folder');
    if (folderId) {
      this.blobsFolderId = folderId;
      return folderId;
    }

    this.blobsFolderId = await this.driveService.createFolder('blobs', this.databaseFolderId);
    return this.blobsFolderId;
  }

  /**
   * Upload a blob from path or Buffer.
   */
  async uploadBlob(
    fileInput: string | Buffer,
    options?: { name?: string; contentType?: string }
  ): Promise<string> {
    const blobsFolderId = await this.getOrCreateBlobsFolder();
    
    let name = options?.name || 'blob';
    let contentType = options?.contentType || 'application/octet-stream';
    let contentStream: Buffer | fs.ReadStream;

    if (typeof fileInput === 'string') {
      // It's a file path
      const filePath = path.resolve(fileInput);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist at path: ${filePath}`);
      }
      name = options?.name || path.basename(filePath);
      contentStream = fs.createReadStream(filePath);
      
      // Attempt to guess content-type by extension if not provided
      if (!options?.contentType) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.png') contentType = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.pdf') contentType = 'application/pdf';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.txt') contentType = 'text/plain';
      }
    } else {
      // It's a Buffer
      contentStream = fileInput;
    }

    return await this.driveService.uploadBlob(name, contentStream, contentType, blobsFolderId);
  }

  /**
   * Download a blob's binary content.
   */
  async downloadBlob(fileId: string): Promise<{ data: Buffer; contentType: string }> {
    return await this.driveService.downloadBlob(fileId);
  }

  /**
   * Get an access URL for a blob.
   * Generates a link containing a temporary OAuth2 token:
   * https://www.googleapis.com/drive/v3/files/{fileId}?alt=media&access_token={token}
   */
  async getBlobUrl(fileId: string): Promise<string> {
    const token = await this.driveService.getAccessToken();
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${token}`;
  }
}
