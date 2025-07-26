# Google Drive API Setup Guide

This guide will walk you through setting up the Google Drive API for the Receipt Manager app.

## Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: "Receipt Manager App"
4. Click "Create"

## Step 2: Enable Google Drive API

1. In the Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Google Drive API"
3. Click on "Google Drive API" and click "Enable"

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" (unless you have a Google Workspace account)
3. Fill in the required fields:
   - **App name**: Receipt Manager App
   - **User support email**: Your email
   - **Developer contact information**: Your email
4. Click "Save and Continue"
5. On the "Scopes" page, click "Add or Remove Scopes"
6. Add these scopes:
   - `https://www.googleapis.com/auth/drive.file` (Create, read, update, and delete its own configuration data in your Google Drive)
7. Click "Save and Continue"
8. Add your email as a test user
9. Click "Save and Continue"

## Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client ID"
3. Choose "Application type": **Desktop application**
   - Note: We use "Desktop" instead of "Mobile" because mobile apps don't provide a client secret, which we need for server-side token refresh
4. Enter name: "Receipt Manager Desktop App"
5. Click "Create"
6. **Save the Client ID and Client Secret** - you'll need these for the app

## Step 5: Set Up Redirect URI

For desktop applications, you can use the standard OAuth redirect URI:
```
http://localhost
```
Or use the special "out-of-band" URI:
```
urn:ietf:wg:oauth:2.0:oob
```

## Step 6: Generate Refresh Token

Since this is a mobile app for personal use, you'll need to generate a refresh token manually:

### Option A: Using OAuth 2.0 Playground (Recommended)

1. Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in the top right
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. In the left panel, find "Drive API v3"
6. Select: `https://www.googleapis.com/auth/drive.file`
7. Click "Authorize APIs"
8. Sign in with your Google account
9. Click "Exchange authorization code for tokens"
10. **Copy the refresh_token** - you'll need this for the app

### Option B: Using curl (Advanced)

1. Get authorization code by visiting this URL in your browser:
   ```
   https://accounts.google.com/o/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https://www.googleapis.com/auth/drive.file&response_type=code&access_type=offline&prompt=consent
   ```
   - Replace `YOUR_CLIENT_ID` with your actual Client ID
   - After authorization, you'll get a code on the page

2. Exchange authorization code for refresh token:
   ```bash
   curl -X POST https://oauth2.googleapis.com/token \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=AUTHORIZATION_CODE_FROM_STEP_1" \
     -d "grant_type=authorization_code" \
     -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
   ```

## Step 7: Configure the App

Open the Receipt Manager app and go to Settings. Enter:

1. **Client ID**: From Step 4 (the desktop application Client ID)
2. **Client Secret**: From Step 4 (the desktop application Client Secret)
3. **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob` (or `http://localhost` if you prefer)
4. **Refresh Token**: From Step 6

**Note**: Even though we're building a mobile app, we use desktop OAuth credentials because:
- Desktop apps provide both Client ID and Client Secret
- Mobile apps only provide Client ID (no secret)
- We need the Client Secret for secure server-side token refresh
- This is a common pattern for mobile apps that need offline access

## Step 8: Test the Integration

1. Take a test photo in the app
2. Enter a description (e.g., "Test Receipt")
3. Save the receipt
4. Check your Google Drive - you should see a new folder structure:
   ```
   receipts/
   ├── 2025/
   │   └── 01/
   │       └── Test_Receipt_2025-01-26T12-00-00-000Z.jpg
   ```

## Security Notes

- **Never commit API keys to version control**
- The refresh token allows permanent access to your Google Drive
- Only share these credentials with trusted devices/users
- Consider rotating credentials periodically
- The app only requests `drive.file` scope, which limits access to files created by the app
- **Desktop OAuth Pattern**: We use desktop OAuth credentials for a mobile app because mobile OAuth doesn't provide client secrets, which are required for secure token refresh

## Troubleshooting

### "Invalid client" error
- Verify Client ID and Client Secret are correct
- Make sure the OAuth consent screen is configured

### "Invalid scope" error  
- Ensure you've added the correct scope: `https://www.googleapis.com/auth/drive.file`

### "Refresh token expired" error
- Generate a new refresh token using the OAuth playground
- Make sure to include `access_type=offline` and `prompt=consent`

### Upload failures
- Check internet connection
- Verify all API credentials are entered correctly
- Check Google Cloud Console for API usage and errors

## Folder Structure

The app will automatically create this structure in your Google Drive:
```
receipts/
├── 2025/
│   ├── 01/           # January receipts
│   ├── 02/           # February receipts
│   └── ...
├── 2024/
│   └── ...
```

Each receipt is named: `{description}_{timestamp}.jpg`

For example: `Gas_2025-01-26T15-30-45-123Z.jpg`
