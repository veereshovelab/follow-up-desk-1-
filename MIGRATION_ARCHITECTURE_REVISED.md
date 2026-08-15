# Follow-up Desk: Revised Migration Architecture

**Status:** Architecture Review & Correction  
**Date:** 2026-08-15  
**Previous Plan:** ❌ REJECTED (direct browser→Apps Script CORS unfeasible)  
**This Plan:** ✅ CORRECTED (via Vercel server-side proxy)

---

## Executive Summary: Architecture Correction

### Problem with Original Plan
- ❌ Direct browser → Apps Script HTTP communication
- ❌ Assumed CORS headers in ContentService would work
- ❌ Google Apps Script redirects to script.googleusercontent.com domain
- ❌ Preflight requests would fail due to cross-origin restrictions
- ❌ Security risk: credentials sent directly from browser

### Solution: Server-Side Proxy Pattern
- ✅ Browser calls same-origin Vercel API (`/api/backend`)
- ✅ Vercel server-side code calls Apps Script endpoint (server-to-server, no browser involved)
- ✅ CORS issues resolved at server layer, not client layer
- ✅ Secrets stored in Vercel environment, never exposed to browser
- ✅ Authentication enforced server-side before reaching Apps Script
- ✅ Apps Script logic remains unchanged

---

## A. Target Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Vercel Frontend (index.html)                               │ │
│  │ - Static HTML/CSS/JS                                       │ │
│  │ - NO secrets, NO API keys                                  │ │
│  │ - Calls: fetch('/api/backend', {action, params})          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTPS (Same-origin)
                              ↑ JSON response
┌─────────────────────────────────────────────────────────────────┐
│                    VERCEL DEPLOYMENT                            │
│                  (Serverless Functions)                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ /api/backend (Node.js serverless function)                │ │
│  │                                                             │ │
│  │ 1. Receive: POST /api/backend                             │ │
│  │    {                                                        │ │
│  │      action: "saveTask",                                   │ │
│  │      params: [taskObject],                                │ │
│  │      token: "session_token_from_cookie"                   │ │
│  │    }                                                        │ │
│  │                                                             │ │
│  │ 2. Validate: Authenticate user (token → session store)    │ │
│  │ 3. Authorize: Check permissions (is user in whitelist?)   │ │
│  │ 4. Relay: Forward to Apps Script with minimal changes     │ │
│  │ 5. Transform: Parse response, return to frontend          │ │
│  │                                                             │ │
│  │ Env vars:                                                   │ │
│  │ - APPS_SCRIPT_URL = https://script.google.com/...         │ │
│  │ - AUTHORIZED_USERS = ["user1@company.com", "user2@..."]  │ │
│  │ - SESSION_SECRET = "..."                                   │ │
│  │ - GEMINI_API_KEY = "..." (for future audio processing)    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTPS (Cross-origin, but server-side)
                              ↑ JSON response
┌─────────────────────────────────────────────────────────────────┐
│                   GOOGLE APPS SCRIPT                            │
│                  (Published Web App)                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Code.gs (HTTP Gateway - NEW)                              │ │
│  │                                                             │ │
│  │ function doPost(e) {                                       │ │
│  │   var action = e.parameter.action;                         │ │
│  │   var payload = JSON.parse(e.postData.contents);           │ │
│  │                                                             │ │
│  │   // Route to existing business logic functions            │ │
│  │   switch(action) {                                         │ │
│  │     case 'getState': return getState();                    │ │
│  │     case 'saveTask': return saveTask(payload.task);        │ │
│  │     // ... all 19 functions                                │ │
│  │   }                                                         │ │
│  │ }                                                           │ │
│  │                                                             │ │
│  │ Existing Functions (UNCHANGED):                            │ │
│  │ - getState()                                               │ │
│  │ - saveTask(), deleteTask(), completeTask(), reopenTask()  │ │
│  │ - sendInvite(), emailAttendees(), saveMom(), circulateMom()│
│  │ - saveContact(), deleteContact()                           │ │
│  │ - saveSettings(), installReminders(), removeReminders()   │ │
│  │ - uploadAudioToDrive(), getAudioBase64()                   │ │
│  │ - parseSms()                                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ↓                                                               │
│  ├─ Google Sheets (Tasks, Contacts, Settings)                  │
│  ├─ Google Drive (Audio files)                                 │
│  ├─ Google Calendar (Meeting invites)                          │
│  └─ Gmail (Notifications, attendee emails)                     │
└─────────────────────────────────────────────────────────────────┘
```

### Communication Layers

| Layer | Technology | Purpose | Authentication | Secrets |
|-------|-----------|---------|-----------------|---------|
| Browser ↔ Vercel | HTTPS Fetch | Frontend UI calls API | Session cookie/token | None |
| Vercel ↔ Apps Script | HTTPS Fetch | Server-side proxy | Optional (trusted) | APPS_SCRIPT_URL |
| Apps Script ↔ Google | Native APIs | Data/Calendar/Email | OAuth (Apps Script) | None needed |

---

## B. Request/Response Flow: Detailed Example

### Request Flow: Frontend Saves a Task

```
1. BROWSER (index.html)
   ┌──────────────────────────────────────┐
   │ User clicks "Save Task"              │
   │ Frontend calls:                      │
   │                                      │
   │ fetch('/api/backend', {              │
   │   method: 'POST',                    │
   │   headers: {                         │
   │     'Content-Type': 'application/json'│
   │   },                                 │
   │   body: JSON.stringify({             │
   │     action: 'saveTask',              │
   │     params: [{                       │
   │       id: 'task123',                 │
   │       title: 'Follow up with Bob',   │
   │       dueDate: '2026-08-20'          │
   │       // ... other task fields       │
   │     }]                               │
   │   })                                 │
   │ })                                   │
   │ .then(r => r.json())                │
   │ .then(S.tasks = response.tasks)     │
   └──────────────────────────────────────┘
                    ↓
2. VERCEL API (/api/backend)
   ┌──────────────────────────────────────┐
   │ Receives POST request                │
   │                                      │
   │ // Extract request body              │
   │ const { action, params } = req.body  │
   │ // = { 'saveTask', [{...task}] }    │
   │                                      │
   │ // 1. VALIDATE TOKEN                │
   │ const token = req.cookies?.session  │
   │ if (!token) return 401 Unauthorized │
   │                                      │
   │ // 2. CHECK SESSION (decode JWT)    │
   │ const user = verifyToken(token)     │
   │ // = { userId: 'u1', email: '...' }│
   │ if (!user) return 401               │
   │                                      │
   │ // 3. CHECK AUTHORIZATION           │
   │ const AUTHORIZED = process.env.     │
   │   AUTHORIZED_USERS.split(',')       │
   │ if (!AUTHORIZED.includes(user.email))│
   │   return 403 Forbidden              │
   │                                      │
   │ // 4. RELAY TO APPS SCRIPT          │
   │ const appsScriptUrl =               │
   │   process.env.APPS_SCRIPT_URL       │
   │                                      │
   │ const response = await fetch(       │
   │   appsScriptUrl,                    │
   │   {                                 │
   │     method: 'POST',                 │
   │     headers: {                      │
   │       'Content-Type': 'application/json'│
   │     },                              │
   │     body: JSON.stringify({          │
   │       action: 'saveTask',           │
   │       params: params                │
   │     })                              │
   │   }                                 │
   │ )                                   │
   │                                      │
   │ const result = await response.json()│
   │ // = { tasks: [...], status: 'ok' }│
   │                                      │
   │ // 5. RETURN TO FRONTEND            │
   │ res.status(200).json(result)       │
   └──────────────────────────────────────┘
                    ↓
3. GOOGLE APPS SCRIPT (doPost)
   ┌──────────────────────────────────────┐
   │ function doPost(e) {                │
   │   const action = e.parameter        │
   │     .action // = 'saveTask'         │
   │   const payload = JSON.parse(       │
   │     e.postData.contents            │
   │   )                                 │
   │   // = { action: '...', params: ..}│
   │                                      │
   │   // Router - delegates to existing │
   │   // business logic functions       │
   │   if (action === 'saveTask') {     │
   │     const task = payload.params[0] │
   │     const result = saveTask(task)  │
   │     // Calls EXISTING function:    │
   │     // - Validates task            │
   │     // - Writes to Google Sheets   │
   │     // - Returns updated task list │
   │   }                                 │
   │                                      │
   │   return buildResponse(result)     │
   │   // = {                           │
   │   //   tasks: [...],               │
   │   //   status: 'ok'                │
   │   // }                             │
   │ }                                   │
   └──────────────────────────────────────┘
                    ↓
4. GOOGLE SHEETS
   ┌──────────────────────────────────────┐
   │ updateTasksSheet(task)              │
   │ - Add row or update existing row    │
   │ - Increment version                 │
   └──────────────────────────────────────┘
                    ↓
5. Response flows back up:
   Apps Script → Vercel → Browser → UI updates
```

---

## C. Implementation Components

### C1. Vercel Frontend (`/index.html`)

**What Changes:**
- Modify `srv()` function to call `/api/backend` instead of `google.script.run`
- Add session token to requests (from cookie)
- No other changes

**Code Pattern:**
```javascript
// OLD: google.script.run
function srv(fn) {
  var args = [].slice.call(arguments, 1);
  return new Promise(function(res, rej) {
    google.script.run
      .withSuccessHandler(res)
      .withFailureHandler(rej)
      [fn].apply(this, args);
  });
}

// NEW: Vercel API
function srv(fn) {
  var args = [].slice.call(arguments, 1);
  return fetch('/api/backend', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include', // Include cookies (session)
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

**Secrets:** NONE - frontend has no secrets

---

### C2. Vercel API (`/api/backend.js` or similar)

**What It Does:**
- Single endpoint that receives all frontend API calls
- Routes requests to Apps Script
- Manages authentication & authorization
- Handles errors & retries
- Transforms responses if needed

**Key Responsibilities:**

#### 1. Receive Request
```
POST /api/backend
Body: { action: string, params: any[] }
Cookie: session=<token>
```

#### 2. Validate Session
```
- Extract session token from cookie
- Verify JWT signature
- Decode to get user info
- Return 401 if invalid
```

#### 3. Check Authorization
```
- Get AUTHORIZED_USERS from env var
- Check if user.email is in list
- Return 403 if not authorized
```

#### 4. Relay to Apps Script
```
- Fetch APPS_SCRIPT_URL (from env var)
- POST same payload (action + params)
- Wait for response
```

#### 5. Handle Response
```
- If 200: return response to frontend
- If 4xx/5xx: log error, return 500 to frontend
- Transform if needed (e.g., add timestamps)
```

**Secrets Stored Here (Environment Variables):**
- `APPS_SCRIPT_URL` - Published Apps Script web app URL
- `AUTHORIZED_USERS` - Comma-separated email list
- `SESSION_SECRET` - For JWT signing
- `GEMINI_API_KEY` - For future audio processing (backend-only)

**No Secrets in Frontend Code** ✅

---

### C3. Google Apps Script (`Code.gs`)

**What Changes:**
- Add `doPost(e)` handler
- No changes to existing functions

**Key Responsibilities:**

#### 1. Receive HTTP Request
```javascript
function doPost(e) {
  // e.parameter.action = "saveTask"
  // e.postData.contents = JSON.string with params
}
```

#### 2. Parse Payload
```javascript
const payload = JSON.parse(e.postData.contents);
// { action: "saveTask", params: [{task}] }
```

#### 3. Route to Business Logic
```javascript
switch (payload.action) {
  case 'getState': return getState();
  case 'saveTask': return saveTask(payload.params[0]);
  case 'deleteTask': return deleteTask(payload.params[0]);
  // ... all 19 functions
}
```

#### 4. Return JSON Response
```javascript
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**All Existing Functions Remain Unchanged** ✅

---

### C4. Session/Authentication Flow (Future: 2-User Authorization)

**Not Implemented Yet, But Architecture:**

```
1. Initial Login (Frontend)
   Browser → POST /api/login
   Body: { email, password }
   
2. Verify Credentials (Vercel)
   - Check email in AUTHORIZED_USERS list
   - Verify password (hashed comparison)
   - Generate JWT token
   - Set secure HTTP-only cookie
   - Return token to frontend
   
3. Subsequent Requests (Frontend)
   Browser → POST /api/backend
   Cookie: session=<JWT>
   
4. Token Verification (Vercel)
   - Extract token from cookie
   - Verify JWT signature
   - Decode to get user email
   - Check if email in AUTHORIZED_USERS
   - Proceed or reject

5. Logout (Frontend)
   Browser → POST /api/logout
   Vercel → Clear session cookie
```

**Authentication Enforced Server-Side, NOT in Frontend** ✅

---

## D. Error Handling Strategy

### D1. Network Errors

**Scenario:** Browser cannot reach Vercel API
```
Frontend:
  fetch() → timeout or connection error
  → User sees error message
  → Retry button available
  
Recovery: Automatic retry or manual refresh
```

**Scenario:** Vercel cannot reach Apps Script
```
Vercel API:
  fetch(APPS_SCRIPT_URL) → timeout
  → Log error
  → Return 503 Service Unavailable to frontend
  → Frontend shows "Backend unavailable"
  
Recovery: Automatic retry on next request
```

### D2. Authentication Errors

**Scenario:** Session token expired
```
Vercel API:
  verifyToken(cookie) → expiration error
  → Return 401 Unauthorized
  
Frontend:
  res.status === 401
  → Clear session cookie
  → Redirect to login page (future)
  → User logs in again
```

**Scenario:** User not in AUTHORIZED_USERS
```
Vercel API:
  auth check → email not in list
  → Return 403 Forbidden
  → Log security event
  
Frontend:
  res.status === 403
  → Show "Access denied" message
  → Suggest contacting admin
```

### D3. Apps Script Errors

**Scenario:** Task validation fails
```
Apps Script:
  saveTask() → title is empty
  → Return { error: "Title required" }
  
Vercel API:
  Response received
  → Check for error field
  → Pass error to frontend
  
Frontend:
  res.error present
  → show toast("Title required")
```

**Scenario:** Google Sheets quota exceeded
```
Apps Script:
  Google Sheets API call → quota error
  → Catch and return { error: "Please try again later" }
  
Vercel API:
  → Pass error to frontend
  
Frontend:
  → Show error message
  → Suggest retry in a few minutes
```

---

## E. Apps Script CORS & Redirects: Why Server-Side Proxy Solves It

### The Problem with Direct Browser→Apps Script

**Apps Script ContentService Behavior:**
```
1. Browser sends: GET https://script.google.com/macros/d/...
2. Apps Script redirects: 
   - Original response served from: script.googleusercontent.com
   - CORS header: not-set or restricted
   
3. Browser preflight: OPTIONS request
   → No CORS headers in response
   → Browser blocks request
   → Frontend receives CORS error
```

### How Server-Side Proxy Solves It

**Vercel API (Server-Side Code):**
```
1. Node.js/serverless function (server-side code)
2. Can make HTTP requests to any domain
3. No browser involved in the fetch
4. No CORS preflight needed
5. Acts as a trusted relay

Sequence:
- Browser → Vercel API (/api/backend) [same-origin, no CORS issue]
- Vercel API → Apps Script [server-to-server, no browser, no CORS issue]
- Apps Script → Vercel API [HTTP response]
- Vercel API → Browser [HTTP response, same-origin]
```

**Key Benefit:** CORS is NOT a concern because server-side code can make requests to any endpoint. Only browser-side code is restricted by CORS.

---

## F. Secrets Management

### Where Secrets Are Stored

| Secret | Type | Storage | Access | Reason |
|--------|------|---------|--------|--------|
| `APPS_SCRIPT_URL` | Config | Vercel env var | Vercel API only | Backend endpoint URL |
| `AUTHORIZED_USERS` | Config | Vercel env var | Vercel API only | 2-user whitelist |
| `SESSION_SECRET` | Crypto | Vercel env var | Vercel API only | JWT signing key |
| `GEMINI_API_KEY` | Credential | Vercel env var | Vercel API only | Future: audio processing |
| --- | --- | --- | --- | --- |
| Apps Script OAuth | Implicit | Apps Script runtime | Apps Script functions | Native access |
| Google Sheets access | Implicit | Apps Script runtime | Apps Script functions | Native access |
| Google Drive access | Implicit | Apps Script runtime | Apps Script functions | Native access |

### Where Secrets Are NOT Stored

| Secret | ❌ NOT HERE |
|--------|-----------|
| GEMINI_API_KEY | ❌ index.html |
| GEMINI_API_KEY | ❌ Browser localStorage |
| GEMINI_API_KEY | ❌ Git repository |
| SESSION_SECRET | ❌ index.html |
| SESSION_SECRET | ❌ Git repository |
| APPS_SCRIPT_URL | ❌ index.html (kept in frontend for discovery) |

**Principle:** All secrets accessed only by server-side code (Vercel), never by browser.

---

## G. Protecting Apps Script from Direct Abuse

### Current State
- Apps Script web app is publicly accessible
- Anyone with the URL can call `doPost()`
- No authentication on Apps Script side

### Options for Future Hardening

**Option 1: IP Whitelisting (Vercel Proxy Only)**
- Apps Script checks request origin
- Only accepts requests from Vercel deployment's IP
- Requires: Vercel to have static outbound IPs
- Issue: Vercel serverless IPs are dynamic

**Option 2: Shared Secret (Simple)**
- Vercel API sends: `X-API-Key: secret123`
- Apps Script checks: if X-API-Key != expected → reject
- Cons: Not cryptographically secure, only "obfuscation"

**Option 3: JWT Validation (Recommended for future)**
- Vercel API generates JWT
- Apps Script validates JWT signature
- Requires: Apps Script to have access to public key
- Better: Only Vercel's IP range accepted

**Option 4: Apps Script Execution API (Google-native)**
- Use Google Cloud's Apps Script Execution API
- Requires OAuth credentials
- More complex setup
- Better security model

**For Now:** Accept that Apps Script is public endpoint but rate-limited by Google.
**For Future:** Implement Option 2 or 3 if abuse occurs.

**Recommendation:** Use Option 2 (shared secret) as interim; upgrade to Option 3 (JWT) if needed.

---

## H. Handling Existing Google Services Integration

### Google Sheets (Tasks, Contacts, Settings)
- **Current:** Apps Script reads/writes native API
- **After Migration:** No change
- **Protection:** Apps Script handles all validation
- **User Authentication:** Implicit (Apps Script runs as authenticated user)

### Google Drive (Audio Files)
- **Current:** `uploadAudioToDrive()` and `getAudioBase64()`
- **After Migration:** No change
- **Protection:** Base64 audio flows: Browser → Vercel (HTTPS) → Apps Script → Drive
- **Issue:** Large audio files in base64 (inefficient but works)
- **Future:** Direct Drive upload via signed URLs (more complex)

### Google Calendar (Meeting Invites)
- **Current:** `sendInvite()` creates event
- **After Migration:** No change
- **Protection:** Only Apps Script function can create events

### Gmail (Email Notifications)
- **Current:** `sendInvite()`, `emailAttendees()`, `circulateMom()`
- **After Migration:** No change
- **Protection:** Apps Script has email permissions

### Reminders (Time-Based Triggers)
- **Current:** `installReminders()` creates daily trigger
- **After Migration:** No change
- **Protection:** Apps Script can create/delete triggers

**Summary:** All Google service integrations continue unchanged. Vercel proxy is transparent to Apps Script logic.

---

## I. Implementation Sequence (Revised)

### PHASE 0: Setup & Configuration (No Code Changes Yet)

#### Step 0.1: Prepare Vercel Project
- [ ] Create Vercel account (if needed)
- [ ] Link GitHub repository to Vercel
- [ ] Verify deployment works (index.html served)
- [ ] Note Vercel URL (e.g., `https://follow-up-desk.vercel.app`)

#### Step 0.2: Prepare Environment Variables
- [ ] Identify Apps Script published web app URL
  - Format: `https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`
- [ ] Document AUTHORIZED_USERS (2 emails)
- [ ] Generate SESSION_SECRET (32+ character random string)
- [ ] Do NOT commit secrets to git
- [ ] Will use Vercel's env var dashboard

#### Step 0.3: Deploy Initial Test Version
- [ ] Deploy index.html to Vercel as-is (no code changes)
- [ ] Verify it loads at https://follow-up-desk.vercel.app
- [ ] Old index.html still uses google.script.run (will fail without Apps Script)

---

### PHASE 1: Build Vercel Proxy API

#### Step 1.1: Create Vercel API Endpoint
- [ ] Create `/api/backend.js` (Node.js serverless function)
- [ ] Implement request receiver: parse body, extract action + params
- [ ] Add authentication check: validate session token (for now, skip)
- [ ] Add authorization check: validate email in AUTHORIZED_USERS (for now, skip)
- [ ] Implement relay to Apps Script: fetch(APPS_SCRIPT_URL, {...})
- [ ] Implement response return: send JSON back to frontend
- [ ] Add error handling: timeouts, network errors, HTTP errors

#### Step 1.2: Configure Environment Variables in Vercel
- [ ] Set APPS_SCRIPT_URL (Apps Script public endpoint)
- [ ] Set AUTHORIZED_USERS (comma-separated emails)
- [ ] Set SESSION_SECRET (for future JWT validation)
- [ ] Test via Vercel dashboard

#### Step 1.3: Test Vercel API Manually
- [ ] Use curl or Postman to POST to /api/backend
- [ ] Request: `{ action: "getState", params: [] }`
- [ ] Should forward to Apps Script and return response
- [ ] Debug any CORS or network issues

#### Step 1.4: Add Session Token Support (Stub)
- [ ] Create `/api/login.js` endpoint (stub for future)
- [ ] For now: always grant access (no auth)
- [ ] Later: validate against AUTHORIZED_USERS

---

### PHASE 2: Update Frontend to Use Vercel API

#### Step 2.1: Modify `srv()` Function
- [ ] Replace google.script.run with fetch() to /api/backend
- [ ] Update error handling for HTTP errors
- [ ] Add session token to request header/cookie
- [ ] Test in browser: check Network tab for /api/backend calls

#### Step 2.2: Update Error Messages
- [ ] Change error messages from Apps Script-specific to generic
- [ ] Handle HTTP errors (401, 403, 500, etc.)
- [ ] Log errors for debugging

#### Step 2.3: Deploy to Vercel
- [ ] Commit changes to index.html to git
- [ ] Vercel auto-deploys
- [ ] Test: Frontend should now call /api/backend instead of google.script.run

#### Step 2.4: Test All 19 Backend Functions
- [ ] Verify each function works via new proxy
- [ ] Test: getState() → loads data
- [ ] Test: saveTask() → creates/updates
- [ ] Test: deleteTask() → removes
- [ ] Test: completeTask() → marks done
- [ ] Test: All others in sequence

---

### PHASE 3: Add Apps Script HTTP Gateway

#### Step 3.1: Create doPost() Handler in Code.gs
- [ ] Add function `doPost(e)` to Code.gs
- [ ] Parse e.postData.contents as JSON
- [ ] Extract action field
- [ ] Route to existing functions
- [ ] Return JSON response

#### Step 3.2: Add Response Wrapper
- [ ] Create `buildResponse(data)` helper
- [ ] Properly format JSON output
- [ ] Handle errors gracefully

#### Step 3.3: Deploy Apps Script
- [ ] Deploy new Code.gs version as "New Deployment"
- [ ] Copy new public URL
- [ ] Update Vercel env var APPS_SCRIPT_URL with new URL

#### Step 3.4: Test Full Integration
- [ ] Frontend → Vercel API → Apps Script → Google Sheets
- [ ] Verify data consistency
- [ ] Check Google Sheets has correct data

---

### PHASE 4: Implement Authentication (2-User Authorization)

#### Step 4.1: Create Session Management
- [ ] Create `/api/login.js` endpoint
- [ ] Create `/api/logout.js` endpoint
- [ ] Implement JWT generation/validation
- [ ] Store authorized users in Vercel env var

#### Step 4.2: Enforce Server-Side Authentication
- [ ] Modify `/api/backend.js` to require valid session
- [ ] Return 401 if token missing/invalid
- [ ] Return 403 if user not in AUTHORIZED_USERS
- [ ] Log auth attempts for security

#### Step 4.3: Add Frontend Login UI
- [ ] Create login modal/page
- [ ] Capture email + password
- [ ] Call /api/login
- [ ] Store session token in secure cookie
- [ ] Redirect to app on success

#### Step 4.4: Test Authentication
- [ ] Try accessing /api/backend without session → should fail
- [ ] Login with authorized email → should succeed
- [ ] Try with unauthorized email → should fail
- [ ] Session expiration → redirect to login

---

### PHASE 5: Advanced Features (Later)

#### Step 5.1: Microphone Recording
- Not in this phase
- Will require browser Mic API permissions
- Fallback to file upload (already works)

#### Step 5.2: Gemini Audio Processing
- Move Gemini API call to backend (/api/process-audio)
- Store Gemini API key in Vercel env var
- Frontend never sees key
- Process large audio files on server

#### Step 5.3: Monitoring & Observability
- Add error tracking (e.g., Sentry)
- Monitor Vercel function performance
- Monitor Apps Script execution time
- Alert on auth failures

---

## J. Testing Checklist (Revised)

### Pre-Migration
- [ ] Current system works in Apps Script
- [ ] Google Sheets data backed up
- [ ] Existing URLs documented

### Phase 1 (Vercel Proxy API)
- [ ] Vercel project created
- [ ] `/api/backend` endpoint responds
- [ ] Manual curl test works
- [ ] APPS_SCRIPT_URL env var set correctly

### Phase 2 (Frontend Update)
- [ ] index.html modified (srv function)
- [ ] Deployed to Vercel
- [ ] Network tab shows /api/backend calls
- [ ] No more google.script errors

### Phase 3 (Apps Script Gateway)
- [ ] Code.gs doPost() added
- [ ] Apps Script redeployed
- [ ] New deployment URL copied to Vercel env
- [ ] Full integration test: all 19 functions

### Phase 4 (Authentication)
- [ ] Login endpoint works
- [ ] JWT generation/validation works
- [ ] 2-user whitelist enforced
- [ ] Unauthorized users rejected
- [ ] Session timeout works

### Phase 5 (Cleanup)
- [ ] No errors in logs
- [ ] Performance acceptable
- [ ] Security audit passed
- [ ] Documentation updated

---

## K. Architecture Decision Record

### Decision 1: Server-Side Proxy Instead of Direct Browser→Apps Script
**Why:**
- Apps Script redirects to script.googleusercontent.com (CORS issues)
- Server-side code can make unrestricted HTTP requests
- Cleaner separation of concerns
- Easier to add authentication/authorization

**Tradeoffs:**
- One additional network hop (minimal latency impact)
- One additional service to maintain
- But: Worth it for security & reliability

---

### Decision 2: Secrets in Vercel Environment, Never in Frontend
**Why:**
- Browser code is visible to users
- Environment variables are server-only
- Requirement #9 explicitly forbids secrets in frontend
- Security best practice

**Implementation:**
- APPS_SCRIPT_URL in Vercel env
- SESSION_SECRET in Vercel env
- GEMINI_API_KEY in Vercel env
- Frontend has no secrets

---

### Decision 3: Authentication Enforced Server-Side
**Why:**
- Requirement #8: "exactly two authorized users"
- Frontend-only checks are bypassable
- Server-side is the source of truth
- Works even if user modifies local JavaScript

**Implementation:**
- Vercel API validates session token
- Checks user.email against AUTHORIZED_USERS
- Returns 403 if not authorized

---

### Decision 4: Apps Script Logic Unchanged
**Why:**
- Minimize risk of breaking existing functionality
- Only add HTTP gateway (doPost handler)
- All business logic stays in existing functions
- Easier to roll back if needed

**Implementation:**
- New doPost() just routes & marshals data
- All 19 functions remain unchanged
- No changes to Google Sheets, Drive, Calendar, Gmail integration

---

## L. Risk Mitigation Summary

| Risk | Severity | Mitigation | Validation |
|------|----------|-----------|-----------|
| CORS blocks requests | HIGH | Server-side proxy (Vercel) | ✅ Test Phase 1 |
| Secrets exposed | CRITICAL | Environment variables only | ✅ Code review |
| Unauthorized access | HIGH | Server-side auth validation | ✅ Test Phase 4 |
| Data corruption | HIGH | Backup before cutover | ✅ Backup plan |
| Latency increases | MEDIUM | Monitor response times | ✅ Observability |
| Apps Script rate limits | MEDIUM | Implement backoff/retry | ✅ Phase 5 |
| Session loss | MEDIUM | Persistent JWT cookies | ✅ Test Phase 4 |
| Gemini API exposed | HIGH | Move to backend later | ✅ Phase 5 |

---

## M. Files to Create vs. Modify

### Files TO CREATE (New)
1. **Vercel `/api/backend.js`** - Main proxy handler
2. **Vercel `/api/login.js`** - Authentication endpoint (Phase 4)
3. **Vercel `/api/logout.js`** - Session termination (Phase 4)
4. **Vercel `.env.local`** - Development environment variables (gitignored)
5. **Documentation:** Architecture & deployment guide

### Files TO MODIFY (Existing)
1. **`index.html`** - Only modify `srv()` function (Phase 2)
2. **`Code.gs`** - Only add `doPost()` handler (Phase 3)

### Files NOT TO CHANGE
- Google Sheets structure (handled by Apps Script)
- Google Drive folders (handled by Apps Script)
- Google Calendar integrations (handled by Apps Script)
- Gmail settings (handled by Apps Script)

---

## N. Security Checklist

- [ ] No API keys in frontend code
- [ ] No Gemini secrets in browser
- [ ] No session secrets in git repository
- [ ] Environment variables set in Vercel dashboard
- [ ] HTTPS enforced (Vercel default)
- [ ] Session cookies marked HTTP-only
- [ ] CSRF protection (if implementing forms)
- [ ] Rate limiting on login endpoint
- [ ] Audit logging for auth failures
- [ ] Regular security review of Vercel functions

---

## O. Deployment Checklist

- [ ] GitHub repository ready (code committed)
- [ ] Vercel project linked to GitHub
- [ ] Environment variables configured in Vercel
- [ ] Apps Script credentials configured
- [ ] Authorized users list verified (exactly 2)
- [ ] Backup of Google Sheets created
- [ ] Test deployment successful
- [ ] Production rollout plan documented
- [ ] Rollback plan ready
- [ ] Monitoring alerts configured

---

## P. Post-Migration Architecture

### Current (Before Migration)
```
Browser ← → Apps Script Web App ← → Google Services
```

### After Migration
```
Browser ← → Vercel Frontend + API ← → Apps Script ← → Google Services
```

### Key Changes
1. Frontend served from Vercel CDN (faster)
2. API calls go through Vercel proxy (authenticated, logged, monitored)
3. Apps Script remains authoritative backend
4. Google Services unchanged
5. Secrets never exposed to browser

---

**Next Steps:**

1. ✅ Review this revised architecture
2. ⬜ Approval to proceed with Phase 0 (setup)
3. ⬜ Implementation begins with Phase 1 (Vercel API)
4. ⬜ Testing and validation at each phase

---

**End of Revised Architecture Document**

