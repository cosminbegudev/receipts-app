import * as FileSystem from 'expo-file-system';

interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

interface DriveFile {
  id: string;
  name: string;
  parents?: string[];
}

export class GoogleDriveService {
  private config: GoogleDriveConfig;
  private accessToken: string | null = null;

  constructor(config: GoogleDriveConfig) {
    this.config = config;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    try {
      const body = [
        `client_id=${encodeURIComponent(this.config.clientId)}`,
        `client_secret=${encodeURIComponent(this.config.clientSecret)}`,
        `refresh_token=${encodeURIComponent(this.config.refreshToken)}`,
        `grant_type=refresh_token`
      ].join('&');

      console.log('Making token request with body length:', body.length);
      console.log('Client ID starts with:', this.config.clientId.substring(0, 20));
      console.log('Client Secret starts with:', this.config.clientSecret.substring(0, 10));
      console.log('Refresh Token starts with:', this.config.refreshToken.substring(0, 20));

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body,
      });

      const data = await response.json();
      console.log('Token response:', data);
      
      if (data.access_token) {
        this.accessToken = data.access_token;
        return this.accessToken!;
      } else {
        throw new Error('Failed to get access token: ' + JSON.stringify(data));
      }
    } catch (error) {
      console.error('Error getting access token:', error);
      throw error;
    }
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId && { parents: [parentId] }),
    };

    try {
      const response = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      });

      const data = await response.json();
      
      if (data.id) {
        return data.id;
      } else {
        throw new Error('Failed to create folder: ' + JSON.stringify(data));
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  async findFolder(name: string, parentId?: string): Promise<string | null> {
    const accessToken = await this.getAccessToken();
    
    let query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      const data = await response.json();
      
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
      
      return null;
    } catch (error) {
      console.error('Error finding folder:', error);
      throw error;
    }
  }

  async ensureFolderPath(year: string, month: string): Promise<string> {
    try {
      // Find or create 'receipts' folder
      let receiptsId = await this.findFolder('receipts');
      if (!receiptsId) {
        receiptsId = await this.createFolder('receipts');
      }

      // Find or create year folder
      let yearId = await this.findFolder(year, receiptsId);
      if (!yearId) {
        yearId = await this.createFolder(year, receiptsId);
      }

      // Find or create month folder
      let monthId = await this.findFolder(month, yearId);
      if (!monthId) {
        monthId = await this.createFolder(month, yearId);
      }

      return monthId;
    } catch (error) {
      console.error('Error ensuring folder path:', error);
      throw error;
    }
  }

  async uploadFile(
    filePath: string,
    fileName: string,
    parentId: string
  ): Promise<string> {
    const accessToken = await this.getAccessToken();

    try {
      // Read file as base64
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      if (!fileInfo.exists) {
        throw new Error('File does not exist');
      }

      const fileContent = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Create multipart upload
      const boundary = '-------314159265358979323846';
      const delimiter = '\r\n--' + boundary + '\r\n';
      const closeDelimiter = '\r\n--' + boundary + '--';

      const metadata = {
        name: fileName,
        parents: [parentId],
      };

      let multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: image/jpeg\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        fileContent +
        closeDelimiter;

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary="${boundary}"`,
          },
          body: multipartRequestBody,
        }
      );

      const data = await response.json();
      
      if (data.id) {
        return data.id;
      } else {
        throw new Error('Failed to upload file: ' + JSON.stringify(data));
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  async uploadReceipt(
    filePath: string,
    description: string,
    date: Date
  ): Promise<{ fileId: string; folderPath: string }> {
    try {
      const year = date.getFullYear().toString();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      
      // Ensure folder structure exists
      const monthFolderId = await this.ensureFolderPath(year, month);
      
      // Create filename with description and timestamp
      const timestamp = date.toISOString().replace(/[:.]/g, '-');
      const fileName = `${description.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.jpg`;
      
      // Upload file
      const fileId = await this.uploadFile(filePath, fileName, monthFolderId);
      
      return {
        fileId,
        folderPath: `receipts/${year}/${month}`,
      };
    } catch (error) {
      console.error('Error uploading receipt:', error);
      throw error;
    }
  }

  async listReceipts(): Promise<Array<{
    id: string;
    name: string;
    description: string;
    date: string;
    webViewLink: string;
    thumbnailLink?: string;
    imageUrl: string;
    mimeType: string;
    size: number;
  }>> {
    const accessToken = await this.getAccessToken();

    try {
      // Find receipts folder
      const receiptsId = await this.findFolder('receipts');
      if (!receiptsId) {
        return []; // No receipts folder exists yet
      }

      // Get all year folders
      const yearQuery = `'${receiptsId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const yearResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(yearQuery)}&fields=files(id,name)`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      const yearData = await yearResponse.json();

      if (!yearData.files || yearData.files.length === 0) {
        return []; // No year folders exist yet
      }

      const receipts = [];

      // For each year folder, get month folders and their files
      for (const yearFolder of yearData.files) {
        // Get month folders in this year
        const monthQuery = `'${yearFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const monthResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(monthQuery)}&fields=files(id,name)`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );
        const monthData = await monthResponse.json();

        if (monthData.files && monthData.files.length > 0) {
          // For each month folder, get all receipt files
          for (const monthFolder of monthData.files) {
            const filesQuery = `'${monthFolder.id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`;
            const filesResponse = await fetch(
              `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesQuery)}&fields=files(id,name,mimeType,size,webViewLink,thumbnailLink,createdTime)&orderBy=createdTime desc`,
              {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                },
              }
            );
            const filesData = await filesResponse.json();

            console.log(`Found ${filesData.files?.length || 0} files in ${yearFolder.name}/${monthFolder.name}`);

            if (filesData.files && filesData.files.length > 0) {
              for (const file of filesData.files) {
                // Extract description from filename (everything before the first underscore)
                const fileName = file.name;
                const description = fileName.split('_')[0].replace(/[_-]/g, ' ') || 'Receipt';
                
                // Create a direct viewable image URL with access token
                const imageUrl = `https://drive.google.com/uc?id=${file.id}&export=view`;
                // Alternative: Use the thumbnail link if available, or webViewLink
                const previewUrl = file.thumbnailLink || imageUrl;
                
                receipts.push({
                  id: file.id,
                  name: fileName,
                  description: description,
                  date: file.createdTime,
                  webViewLink: file.webViewLink,
                  thumbnailLink: file.thumbnailLink,
                  imageUrl: previewUrl,
                  mimeType: file.mimeType,
                  size: parseInt(file.size) || 0,
                });
              }
            }
          }
        }
      }

      console.log(`Total receipts found: ${receipts.length}`);
      return receipts;
    } catch (error) {
      console.error('Error listing receipts:', error);
      throw error;
    }
  }

  async getImageUrl(fileId: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    
    try {
      // Get file metadata to confirm it exists and get a direct download link
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webContentLink,thumbnailLink`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      const data = await response.json();
      
      // Return the thumbnail link if available, otherwise use a direct access URL
      if (data.thumbnailLink) {
        return data.thumbnailLink;
      }
      
      // Fallback to a public view URL (this might require the file to be publicly viewable)
      return `https://drive.google.com/uc?id=${fileId}&export=view`;
    } catch (error) {
      console.error('Error getting image URL:', error);
      // Fallback URL
      return `https://drive.google.com/uc?id=${fileId}&export=view`;
    }
  }
}
