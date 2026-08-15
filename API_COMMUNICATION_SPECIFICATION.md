# Follow-up Desk: API Communication Architecture (Focused Revision)

**Date:** 2026-08-15  
**Scope:** Clarifies ONLY the API communication layer  
**Previous Confusion:** REMOVED - No direct browser→Apps Script calls  
**Architecture:** Browser → Vercel Frontend → Vercel API Proxy → Apps Script

---

## I. API Communication Architecture: Request Flow

### Critical Principle
**The browser NEVER calls Apps Script directly.**  
**All communication goes through Vercel's server-side proxy.**

### Request Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                            BROWSER                                   │
│  fetch('/api/backend', {                                             │
│    method: 'POST',                                                   │
│    body: { action: 'saveTask', params: [{...task}] }                │
│  })                                                                   │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
                        HTTPS (same-origin)
                        No CORS issues
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                        VERCEL DEPLOYMENT                             │
│                   (Serverless Node.js Function)                      │
│                                                                       │
│  /api/backend.js receives:                                           │
│  {                                                                    │
│    action: 'saveTask',                                               │
│    params: [{id: '...', title: '...', ...}]                          │
│  }                                                                    │
│                                                                       │
│  Transform to Apps Script format:                                    │
│  {                                                                    │
│    action: 'saveTask',                                               │
│    params: [{...}]                                                   │
│  }                                                                    │
│                                                                       │
│  Relay via: fetch(process.env.APPS_SCRIPT_URL, {...})               │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
                  HTTPS (server-to-server, not browser)
                     NO browser CORS restrictions
                  (Node.js can call any endpoint)
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                     GOOGLE APPS SCRIPT                               │
│                  (Published Web App URL)                             │
│                                                                       │
│  doPost(e) receives POST request                                     │
│  {                                                                    │
│    action: 'saveTask',                                               │
│    params: [{...}]                                                   │
│  }                                                                    │
│                                                                       │
│  Routes to: saveTask(params[0])                                      │
│  (Existing business logic - NO CHANGES)                             │
│                                                                       │
│  Returns: {                                                           │
│    tasks: [...],                                                     │
│    success: true                                                     │
│  }                                                                    │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
                     Response flows back
                   Apps Script → Vercel → Browser
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                            BROWSER                                   │
│  Receives: { tasks: [...], success: true }                          │
│  Updates: S.tasks = response.tasks                                   │
│  Renders UI                                                           │
└──────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture Avoids CORS Problems

**Direct Browser→Apps Script (❌ PROBLEMATIC):**
```
Browser → fetch('https://script.googleusercontent.com/...')
Apps Script responds from script.googleusercontent.com domain
Browser's CORS policy blocks request
Result: "Cross-Origin Request Blocked" error
```

**Via Vercel Proxy (✅ WORKS):**
```
Browser → fetch('/api/backend') [same-origin, no CORS check needed]
Vercel API (Node.js) → fetch('https://script.google.com/...') [server code, not subject to browser CORS policy]
Apps Script responds
Vercel returns to Browser [same-origin, no CORS check]
Result: Works perfectly
```

---

## II. Exact Files to Create & Modify

### Files to CREATE (New)

#### 1. `/api/backend.js` (Vercel Serverless Function)
**Location:** `vercel-repo/api/backend.js`  
**Type:** Node.js serverless function  
**Purpose:** Single proxy endpoint for all frontend→backend calls  

**Responsibilities:**
- Receive POST requests from browser
- Extract: `action` and `params`
- Forward to Apps Script via HTTP
- Return response to browser

**Environment Variables Required:**
- `APPS_SCRIPT_URL` = Published Apps Script web app URL (e.g., `https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`)

**Template:**
```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, params } = req.body;
  
  try {
    // Forward to Apps Script
    const response = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Backend error:', error);
    return res.status(500).json({ error: 'Backend error' });
  }
}
```

---

#### 2. `vercel.json` (Vercel Configuration)
**Location:** `vercel-repo/vercel.json`  
**Purpose:** Configure Vercel environment variables & routing  

**Template:**
```json
{
  "env": {
    "APPS_SCRIPT_URL": "@apps-script-url"
  }
}
```

---

#### 3. `.env.local` (Local Development)
**Location:** `vercel-repo/.env.local`  
**Purpose:** Development environment (NOT committed to git)  
**Git:** Add to `.gitignore`  

**Template:**
```
APPS_SCRIPT_URL=https://script.google.com/macros/d/{SCRIPT_ID}/usercallback
```

---

### Files to MODIFY (Existing)

#### 1. `index.html` (Vercel Frontend)
**Location:** `vercel-repo/index.html`  
**Changes:** Only modify `srv()` function (~15 lines changed)  

**Current (OLD):**
```javascript
function srv(fn) {
  var a = [].slice.call(arguments, 1);
  return new Promise(function(res, rej) {
    var r = google.script.run
      .withSuccessHandler(res)
      .withFailureHandler(rej);
    r[fn].apply(r, a);
  });
}
```

**NEW:**
```javascript
function srv(fn) {
  var args = [].slice.call(arguments, 1);
  return fetch('/api/backend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: fn,
      params: args
    })
  })
  .then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
```

**No other changes to index.html**

---

#### 2. `Code.gs` (Apps Script Backend)
**Location:** Google Apps Script project  
**Changes:** Add ONE new function `doPost()` (~40 lines)  

**Current State:** All existing functions unchanged (getState, saveTask, deleteTask, etc.)

**NEW - Add to Code.gs:**
```javascript
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var params = payload.params || [];

    var result;
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
        return buildResponse({ error: 'Unknown action: ' + action }, 400);
    }

    return buildResponse(result, 200);
  } catch (error) {
    Logger.log('doPost error: ' + error);
    return buildResponse({ error: error.toString() }, 500);
  }
}

function buildResponse(data, statusCode) {
  statusCode = statusCode || 200;
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**All existing functions remain unchanged.**

---

### Files NOT to Change
- Google Sheets (schema, data)
- Google Drive folders (audio storage)
- Google Calendar settings
- Gmail/sending configuration
- Any existing Code.gs business logic functions

---

## III. Detailed Request/Response Examples

### Example 1: Loading Initial State

**Step 1: Browser Request**
```javascript
// Frontend calls
srv('getState').then(function(state) {
  S = state;
  render();
});
```

**Step 2: Browser Fetch**
```
POST /api/backend HTTP/1.1
Content-Type: application/json

{
  "action": "getState",
  "params": []
}
```

**Step 3: Vercel API Proxy**
```javascript
// /api/backend.js receives request
// Reads: action='getState', params=[]
// Calls Apps Script:

fetch('https://script.google.com/macros/d/{SCRIPT_ID}/usercallback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'getState',
    params: []
  })
})
```

**Step 4: Apps Script**
```javascript
// Code.gs doPost(e) receives
// payload.action = 'getState'
// Calls: getState() (existing function)
// Returns: { tasks: [...], contacts: [...], settings: {...} }
```

**Step 5: Response Back**
```
200 OK
Content-Type: application/json

{
  "tasks": [
    { "id": "t1", "title": "Follow up", "dueDate": "2026-08-20", ... },
    ...
  ],
  "contacts": [...],
  "settings": { "directors": [...], "deptEmails": {...} },
  "triggersOn": true
}
```

**Step 6: Browser Receives**
```javascript
.then(function(state) {
  S = state; // Global state updated
  render(); // UI rendered
})
```

---

### Example 2: Saving a Task

**Step 1: Browser**
```javascript
srv('saveTask', {
  id: 'task123',
  title: 'New follow-up',
  dueDate: '2026-08-25',
  dueTime: '14:00',
  category: 'Meetings & Minutes',
  priority: 'high'
}).then(function(response) {
  S.tasks = response.tasks;
  render();
});
```

**Step 2: Browser Fetch**
```
POST /api/backend HTTP/1.1
Content-Type: application/json

{
  "action": "saveTask",
  "params": [
    {
      "id": "task123",
      "title": "New follow-up",
      "dueDate": "2026-08-25",
      "dueTime": "14:00",
      "category": "Meetings & Minutes",
      "priority": "high"
    }
  ]
}
```

**Step 3: Vercel API**
```javascript
// /api/backend.js
const { action, params } = req.body;
// action = 'saveTask'
// params = [{...task}]

// Forward to Apps Script
const response = await fetch(process.env.APPS_SCRIPT_URL, {
  method: 'POST',
  body: JSON.stringify({ action, params })
});
```

**Step 4: Apps Script**
```javascript
// Code.gs doPost(e)
// payload.action = 'saveTask'
// payload.params[0] = {...task}

result = saveTask(params[0]);
// Existing saveTask function:
// - Validates task
// - Writes to Google Sheets
// - Returns updated tasks array
```

**Step 5: Response**
```
200 OK

{
  "tasks": [
    { "id": "task123", "title": "New follow-up", ..., "created": "2026-08-15T14:30:00Z" },
    ...
  ]
}
```

**Step 6: Browser**
```javascript
.then(function(response) {
  S.tasks = response.tasks;
  render(); // UI updates
});
```

---

## IV. Summary: Files Created vs. Modified

### CREATE (Vercel)
1. **`api/backend.js`** - Main proxy handler (30-40 lines)
2. **`vercel.json`** - Config with env vars (5-10 lines)
3. **`.env.local`** - Dev environment (2 lines, gitignored)

### MODIFY (Existing)
1. **`index.html`** - Only `srv()` function (15 line change)
2. **`Code.gs`** - Add `doPost()` handler (40-50 lines, existing functions unchanged)

### TOTAL CHANGES
- ~4 new files/config
- 2 files modified (minimal changes)
- All existing business logic preserved
- Zero changes to Google Sheets/Drive/Calendar/Gmail

---

## V. Communication Architecture: No CORS Anywhere

### Why No CORS Issues Exist

| Step | Caller | Callee | Browser Involved? | CORS Issue? | Why? |
|------|--------|--------|-------------------|-------------|------|
| Browser → Vercel | Browser | `/api/backend` | Yes | ❌ No | Same-origin, browser allows |
| Vercel → Apps Script | Node.js | `script.google.com` | ❌ No | ❌ No | Server-side code, no browser CORS policy |
| Apps Script → Sheets | Apps Script | Google API | ❌ No | ❌ No | Native App Script API |
| Vercel → Browser | Vercel | Browser | Yes | ❌ No | Same-origin response |

**Result:** CORS is completely bypassed because only the browser makes same-origin calls. Server-to-server communication has no CORS restrictions.

---

## VI. Environment Variables

### Vercel Dashboard Setup

**Variable Name:** `APPS_SCRIPT_URL`  
**Value:** `https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`  
**How to Find SCRIPT_ID:**
1. Open Google Apps Script project
2. Go to Deploy → New deployment → Web app
3. Copy the URL
4. Extract the script ID from URL: `https://script.google.com/macros/d/{THIS_IS_SCRIPT_ID}/usercallback`

---

## VII. Testing Request Flow (Using curl)

### Test 1: Verify Vercel API Works

```bash
curl -X POST https://your-vercel-app.vercel.app/api/backend \
  -H "Content-Type: application/json" \
  -d '{"action":"getState","params":[]}'
```

**Expected Response:**
```json
{
  "tasks": [...],
  "contacts": [...],
  "settings": {...}
}
```

### Test 2: Verify Apps Script Endpoint

```bash
curl -X POST https://script.google.com/macros/d/{SCRIPT_ID}/usercallback \
  -H "Content-Type: application/json" \
  -d '{"action":"getState","params":[]}'
```

**Expected Response:**
```json
{
  "tasks": [...],
  "contacts": [...],
  "settings": {...}
}
```

---

## VIII. Deployment Order

### Step 1: Deploy Apps Script Gateway
- Add `doPost()` to Code.gs
- Deploy as "New Deployment"
- Copy URL → Will use for APPS_SCRIPT_URL env var

### Step 2: Deploy Vercel API
- Create `/api/backend.js`
- Create `vercel.json`
- Set environment variable in Vercel dashboard
- Deploy to Vercel (should auto-deploy from GitHub)

### Step 3: Update Frontend
- Modify `srv()` function in `index.html`
- Commit to GitHub
- Vercel auto-deploys

### Step 4: Test End-to-End
- Browser → Vercel Frontend → Vercel API → Apps Script → Sheets
- Verify all 19 functions work

---

## IX. No CORS Configuration Needed Anywhere

### ❌ DO NOT

```javascript
// WRONG - Don't try this
function doPost(e) {
  var result = { ... };
  var output = ContentService
    .createTextOutput(JSON.stringify(result));
  output.addHeader('Access-Control-Allow-Origin', '*'); // ❌ Won't work
  output.addHeader('Access-Control-Allow-Methods', 'GET, POST');
  return output;
}
```

### ✅ Instead

```javascript
// RIGHT - No CORS headers needed
function doPost(e) {
  var result = { ... };
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON); // ✅ That's it
}
```

Why? Because Vercel API is calling Apps Script server-to-server. No browser is involved, so no CORS policy applies.

---

**End of Focused Revision**

Next: Implementation Phase 1 when ready.

