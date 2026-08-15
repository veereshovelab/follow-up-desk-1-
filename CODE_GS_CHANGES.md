# Code.gs Implementation for Phase 1

**Location:** Google Apps Script project (NOT in git repository)  
**Action:** Add the following function to Code.gs  

## Add to Code.gs (Paste at the end of the file)

```javascript
/* ========== HTTP GATEWAY (NEW) ========== */

/**
 * HTTP request handler for Vercel API proxy
 * 
 * Receives requests from /api/backend and routes them to business logic functions.
 * All existing functions remain unchanged.
 */
function doPost(e) {
  try {
    // Parse request payload
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var params = payload.params || [];

    var result;

    // Route to business logic functions
    switch (action) {
      case 'getState':
        result = getState();
        break;
      case 'saveTask':
        result = saveTask(params[0]);
        break;
      case 'deleteTask':
        result = deleteTask(params[0]);
        break;
      case 'completeTask':
        result = completeTask(params[0]);
        break;
      case 'reopenTask':
        result = reopenTask(params[0]);
        break;
      case 'sendInvite':
        result = sendInvite(params[0]);
        break;
      case 'emailAttendees':
        result = emailAttendees(params[0]);
        break;
      case 'saveMom':
        result = saveMom(params[0], params[1]);
        break;
      case 'circulateMom':
        result = circulateMom(params[0]);
        break;
      case 'saveContact':
        result = saveContact(params[0]);
        break;
      case 'deleteContact':
        result = deleteContact(params[0]);
        break;
      case 'saveSettings':
        result = saveSettings(params[0]);
        break;
      case 'installReminders':
        result = installReminders();
        break;
      case 'removeReminders':
        result = removeReminders();
        break;
      case 'uploadAudioToDrive':
        result = uploadAudioToDrive(params[0], params[1], params[2]);
        break;
      case 'getAudioBase64':
        result = getAudioBase64(params[0]);
        break;
      case 'parseSms':
        result = parseSms(params[0]);
        break;
      default:
        return buildErrorResponse('Unknown action: ' + action, 400);
    }

    return buildSuccessResponse(result);

  } catch (error) {
    Logger.log('doPost error: ' + error.toString());
    return buildErrorResponse('Server error: ' + error.toString(), 500);
  }
}

/**
 * Build successful JSON response for HTTP
 */
function buildSuccessResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Build error JSON response for HTTP
 */
function buildErrorResponse(message, statusCode) {
  statusCode = statusCode || 500;
  return ContentService
    .createTextOutput(JSON.stringify({ error: message, statusCode: statusCode }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ========== END HTTP GATEWAY ========== */
```

## Steps to Deploy

1. **Open Google Apps Script Project**
   - Go to [script.google.com](https://script.google.com)
   - Open your Follow-up Desk project

2. **Copy the Code Above**
   - Select all the code in the "Code.gs Implementation for Phase 1" section (lines with function doPost)
   - Open Code.gs in your project
   - Scroll to the very end of the file
   - Paste the code

3. **Deploy as New Deployment**
   - Click "Deploy" button (top right)
   - Select "New Deployment"
   - Choose type: "Web app"
   - Execute as: [Your email address]
   - Who has access: "Anyone"
   - Click "Deploy"

4. **Copy the New Deployment URL**
   - A new URL will be displayed (format: `https://script.google.com/macros/s/{SCRIPT_ID}/exec`)
   - **Important:** Use the `/exec` URL, NOT `/usercallback`
   - Copy this URL completely

5. **Set Vercel Environment Variable**
   - Go to [Vercel Dashboard](https://vercel.com)
   - Select your follow-up-desk project
   - Go to Settings → Environment Variables
   - Add new variable:
     - Name: `APPS_SCRIPT_URL`
     - Value: [Paste the URL from step 4]
   - Click "Save"

6. **Redeploy Vercel**
   - Vercel should auto-detect the change
   - Or manually: Go to Deployments → click "Redeploy" on the latest

## What Changed

- ✅ Added `doPost(e)` function to handle HTTP requests
- ✅ Routes all 19 actions to existing business logic
- ✅ Added `buildSuccessResponse()` and `buildErrorResponse()` helpers
- ✅ No changes to existing functions (getState, saveTask, etc.)
- ❌ No CORS headers added
- ❌ No authentication added (yet)

## What Did NOT Change

- All existing business logic functions remain identical
- Google Sheets queries and writes unchanged
- Google Drive operations unchanged
- Google Calendar integrations unchanged
- Gmail sending unchanged
- Reminder trigger logic unchanged

