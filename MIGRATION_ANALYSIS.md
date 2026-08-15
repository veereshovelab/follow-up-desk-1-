# Follow-up Desk: Vercel Frontend Migration Analysis

**Status:** Analysis Complete - No Code Changes Made Yet  
**Date:** 2026-08-15  
**Scope:** Frontend-only migration; Apps Script backend remains unchanged

---

## A. Frontend Structure Analysis

### Architecture Overview
- **Single Page Application (SPA):** All code in `index.html`
- **CSS:** Fully inline in `<style>` block (~200 lines)
- **JavaScript:** Fully inline in `<script>` block (~600 lines)
- **Dependencies:** None (pure vanilla JavaScript)
- **Build System:** None required
- **Deployment:** Static file deployment (perfect for Vercel)

### Key Frontend Components

#### 1. **State Management (`S` object)**
```javascript
var S = {
  tasks: [],
  contacts: [],
  settings: { directors: [], deptEmails: {} },
  triggersOn: false
};
```
- Loaded once on startup via `srv('getState')`
- Re-fetched after every mutation
- Contains all display data

#### 2. **Views**
- **Dashboard:** Overview, overdue items, routine tasks
- **Meetings:** Departmental meetings organized by HR, Accounts, IT, etc.
- **All Follow-ups:** Full task list with filters
- **Contacts:** Contact management for follow-up people
- **Settings:** Director names, dept emails, reminder toggle

#### 3. **UI Framework**
- CSS Grid and Flexbox for layout
- Modal system for task/contact/MOM forms
- Toast notifications
- No build process needed

#### 4. **Date & Time Helpers**
- All date logic in JavaScript (no server-side dependency)
- Formats: `YYYY-MM-DD` (dates), `HH:MM` (times)
- Functions: `toStr()`, `fromStr()`, `dayDiff()`, `niceDate()`, etc.

---

## B. Apps Script Dependencies Table

| Line | Frontend Function | Backend Function Called | Parameters Sent | Response/Success Handler | HTTP API Replacement |
|------|------------------|------------------------|-----------------|--------------------------|----------------------|
| 133 | `window.onload` | `getState()` | None | Full state object `{tasks, contacts, settings, triggersOn}` | ✅ POST `/api/getState` |
| 159 | `handle('done')` | `completeTask(id)` | Task ID | Updated tasks array | ✅ PATCH `/api/tasks/{id}/complete` |
| 160 | `handle('reopen')` | `reopenTask(id)` | Task ID | Updated tasks array | ✅ PATCH `/api/tasks/{id}/reopen` |
| 161 | `handle('del')` | `deleteTask(id)` | Task ID | Updated tasks array | ✅ DELETE `/api/tasks/{id}` |
| 162 | `handle('snooze')` | `saveTask(task)` | Full task object | Updated tasks array | ✅ POST `/api/tasks` |
| 353 | `__saveTask()` | `saveTask(task)` | Full task object | Updated tasks array | ✅ POST `/api/tasks` |
| 355 | `__delTask()` | `deleteTask(id)` | Task ID | Updated tasks array | ✅ DELETE `/api/tasks/{id}` |
| 165 | `handle('invite')` | `sendInvite(taskId)` | Task ID | `{msg: "..."}` | ✅ POST `/api/tasks/{id}/send-invite` |
| 166 | `handle('emailatt')` | `emailAttendees(taskId)` | Task ID | `{msg: "..."}` | ✅ POST `/api/tasks/{id}/email-attendees` |
| 575 | `__saveMom()` | `saveMom(taskId, momData)` | Task ID, MOM object | Updated tasks array | ✅ PATCH `/api/tasks/{id}/mom` |
| 576 | `__circulate()` | `saveMom()` + `circulateMom()` | Task ID, MOM object; Task ID | Tasks array, then `{msg: "..."}` | ✅ POST `/api/tasks/{id}/circulate-mom` |
| 172 | `handle('delcontact')` | `deleteContact(id)` | Contact ID | Updated contacts array | ✅ DELETE `/api/contacts/{id}` |
| 598 | `__saveContact()` | `saveContact(contact)` | Contact object | Updated contacts array | ✅ POST `/api/contacts` |
| 176 | `handle('savedir')` | `saveSettings({directors})` | Directors array | Settings object | ✅ PATCH `/api/settings` |
| 177 | `handle('savedept')` | `saveSettings({deptEmails})` | Dept email map | Settings object | ✅ PATCH `/api/settings` |
| 174 | `handle('installrem')` | `installReminders()` | None | None (just updates state) | ✅ POST `/api/reminders/install` |
| 175 | `handle('removerem')` | `removeReminders()` | None | None (just updates state) | ✅ DELETE `/api/reminders` |
| 253 | `doSms()` | `parseSms(smsText)` | SMS text string | Task-like data object | ✅ POST `/api/parse-sms` |
| 384 | `__startRecording()` | `uploadAudioToDrive(name, type, base64)` | Filename, MIME type, base64 audio | `{ok, url, id}` | ✅ POST `/api/upload-audio` |
| 433 | `__handleManualUpload()` | `uploadAudioToDrive(name, type, base64)` | Filename, MIME type, base64 audio | `{ok, url, id}` | ✅ POST `/api/upload-audio` |
| 502 | `__processWithGemini()` | `getAudioBase64(fileId)` | Drive file ID | `{ok, mimeType, base64}` | ✅ POST `/api/get-audio-base64` |

**Total Frontend-to-Backend Calls: 19 unique function calls**

---

## C. Backend Function Mapping

### Task Operations
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `getState()` | Code.gs | Fetches full app state on load | - | `{tasks[], contacts[], settings{}, triggersOn}` |
| `saveTask(task)` | Code.gs | Creates or updates task | Google Sheets | Updated tasks array |
| `deleteTask(id)` | Code.gs | Deletes task by ID | Google Sheets | Updated tasks array |
| `completeTask(id)` | Code.gs | Marks task as done, sets completedAt timestamp | Google Sheets | Updated tasks array |
| `reopenTask(id)` | Code.gs | Marks task as pending again | Google Sheets | Updated tasks array |

### Meeting/MOM Operations
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `sendInvite(taskId)` | Code.gs | Creates Calendar event + emails attendees | Google Calendar, Gmail | `{msg}` |
| `emailAttendees(taskId)` | Code.gs | Sends meeting info email to attendees | Gmail | `{msg}` |
| `saveMom(taskId, momData)` | Code.gs | Saves Minutes of Meeting to task | Google Sheets | Updated tasks array |
| `circulateMom(taskId)` | Code.gs | Emails MOM to all attendees | Gmail | `{msg}` |

### Contact Operations
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `saveContact(contact)` | Code.gs | Creates/updates contact | Google Sheets | Updated contacts array |
| `deleteContact(id)` | Code.gs | Deletes contact | Google Sheets | Updated contacts array |

### Settings Operations
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `saveSettings(settingsObj)` | Code.gs | Saves directors or dept emails | Google Sheets | Updated settings object |

### Reminder Operations
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `installReminders()` | Code.gs | Creates daily time-based trigger for email reminders | Apps Script triggers | None (UI state updated) |
| `removeReminders()` | Code.gs | Removes the trigger | Apps Script triggers | None (UI state updated) |

### Audio & AI Operations
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `uploadAudioToDrive(name, type, base64)` | Code.gs | Uploads base64 audio to Google Drive | Google Drive | `{ok, url, id}` |
| `getAudioBase64(fileId)` | Code.gs | Retrieves base64 audio from Drive | - | `{ok, mimeType, base64}` |

### Helper Functions
| Function | Location | Purpose | Modifies | Returns |
|----------|----------|---------|----------|---------|
| `parseSms(text)` | Code.gs | Parses SMS text into task fields | - | Task data object |

---

## D. Migration Design: New Architecture

### Current Architecture (Apps Script Hosted)
```
Browser
  ↓
Google Apps Script Web App (HTMLService)
  ↓
Apps Script Code.gs
  ├→ Google Sheets (data)
  ├→ Google Drive (audio files)
  ├→ Google Calendar (meetings)
  └→ Gmail (notifications)
```

### Target Architecture (Vercel Frontend)
```
Browser (Vercel frontend)
  ↓
Vercel Frontend Server (index.html)
  ↓
[HTTP API Layer - NEW]
  ↓
Google Apps Script (as HTTP endpoint)
  ├→ Google Sheets (data)
  ├→ Google Drive (audio files)
  ├→ Google Calendar (meetings)
  └→ Gmail (notifications)
```

### Migration Strategy: Two Phases

#### Phase 1: API Wrapper Layer (No Logic Changes)
- Keep `Code.gs` unchanged
- Deploy Apps Script as web app (it already is)
- Create a proxy/relay layer in Apps Script OR
- Update frontend to call Apps Script via HTTP instead of `google.script.run`

#### Phase 2: Optional - Move API Layer Elsewhere
- Future: Move data layer to actual backend (Node.js, Python, etc.)
- For now: Keep Apps Script as the single source of truth

### HTTP Communication Pattern

**Current (google.script.run):**
```javascript
srv('saveTask', taskObj).then(successHandler).catch(errorHandler);
```

**Target (HTTP Fetch):**
```javascript
fetch('/api/tasks', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(taskObj)
}).then(r => r.json()).then(successHandler).catch(errorHandler);
```

### Required Middleware/Relay

Since Apps Script doesn't expose HTTP endpoints for individual functions by default, we need one of:

**Option A: Apps Script Web App Gateway**
- Deploy Apps Script as public web app
- Add a URL dispatcher that routes HTTP requests to backend functions
- Example: `POST /api/tasks` → calls `saveTask()`

**Option B: Serverless Wrapper (e.g., Vercel Functions)**
- Create Vercel `/api/` functions
- Functions authenticate and call Apps Script web app
- Vercel acts as proxy

**Option C: Apps Script Executor API**
- Use Google Cloud's Apps Script Execution API
- Requires authentication setup

**Recommendation: Option A** - simplest, no additional infrastructure

---

## E. Risk Assessment

### 1. **CORS Issues** ⚠️ HIGH RISK
- **Current:** No CORS because same origin (Apps Script hosts both)
- **After:** Vercel domain calling Apps Script web app domain → CORS failure
- **Impact:** Frontend cannot reach backend
- **Solution:** 
  - Configure Apps Script web app to accept requests from Vercel domain
  - Use `doPost()` with proper CORS headers in Apps Script

### 2. **Apps Script Security Model** ⚠️ HIGH RISK
- **Current:** google.script.run inherits user session
- **After:** HTTP calls need authentication
- **Impact:** Anyone could call APIs without authorization
- **Solution:**
  - Use session tokens or OAuth
  - Or add API key validation (NOT SECURE - requirement #4 forbids exposing secrets)
  - **Recommended:** Google OAuth → sign user in → send JWT token
  - Apps Script validates token before executing functions

### 3. **Microphone Recording** ⚠️ CRITICAL RISK
- **Current Issue:** Code has placeholder for recording but states "Google Apps Script blocks the microphone inside its web apps on most desktop browsers"
- **After Migration:** Vercel frontend hosted on HTTPS will have better browser mic access
- **Still Required:** User grants permission in browser
- **Action:** Test mic recording on Vercel; document browser requirements

### 4. **Audio Upload & Drive Access** ⚠️ HIGH RISK
- **Current:** Apps Script has implicit Google Drive access (user's account)
- **After:** Frontend cannot directly access Drive (security sandbox)
- **Impact:** Audio upload must go through backend
- **Solution:** Already handled by `uploadAudioToDrive()` - backend receives base64 from frontend
- **Exposed Secret Risk:** Frontend sends LARGE base64 payloads over HTTP
  - **Mitigation:** Use HTTPS only (Vercel enforces this) + rate limiting on backend

### 5. **Google Apps Script Execution Permissions** ⚠️ MEDIUM RISK
- **Current:** Apps Script runs as authenticated user
- **After:** Each HTTP call must verify user identity
- **Solution:** 
  - Keep user session from Google OAuth
  - Pass session token in HTTP headers
  - Apps Script validates before executing

### 6. **Exposed Secrets** ⚠️ CRITICAL - REQUIREMENT #4
- **Current Code Issue:** Line 459 had hardcoded GCP API key (FIXED ✅)
- **Gemini API Call:** Frontend tries to call Gemini directly with empty API key
  - Currently broken (no key)
  - MUST NOT add API key to frontend code
  - **Solution:** Move to backend; frontend calls `/api/process-audio` → backend calls Gemini
  - This is NOT included in the migration plan yet (out of scope)

### 7. **Data Modification Permissions** ⚠️ MEDIUM RISK
- **Current:** All modifications go through verified Apps Script functions
- **After:** Frontend sends HTTP requests; backend must validate
- **Impact:** Who can delete/edit whose tasks?
- **Action Items:**
  - Apps Script must validate user identity before each write
  - Implement authorization checks (already done in Apps Script probably)

### 8. **Email/Calendar Invitations** ⚠️ MEDIUM RISK
- **Current:** `sendInvite()` and `emailAttendees()` use Apps Script's Gmail/Calendar APIs
- **After:** Still works - backend calls are unchanged
- **Consideration:** Email headers will show "via Apps Script" not "via Vercel"

### 9. **Session State Loss** ⚠️ MEDIUM RISK
- **Current:** Global `S` object holds state
- **After:** Vercel frontend can be refreshed; must reload state
- **Solution:** Already handled - `getState()` call on load
- **Improvement:** Add periodic sync to handle server-side changes

### 10. **Missing Functions in Frontend** ⚠️ INFO
- **Issue:** `parseSms()` and `installReminders()` are called but their implementations unknown
- **Action:** Verify these exist in Code.gs before migration

---

## F. Migration Implementation Order (Safe & Reversible)

### **PHASE 1: Setup & Testing (NO PRODUCTION IMPACT)**

#### Step 1.1: Create Apps Script HTTP Gateway
- **File:** Code.gs (NEW: add HTTP handler)
- **Action:** Add `doPost()` function that routes HTTP requests
- **Keep:** All existing functions unchanged
- **Testing:** Call via HTTP while production still uses google.script.run

```javascript
// NEW CODE - add to Code.gs
function doPost(e) {
  var action = e.parameter.action;
  var data = JSON.parse(e.postData.contents);
  
  switch(action) {
    case 'getState': return response(getState());
    case 'saveTask': return response(saveTask(data));
    // ... route all 19 functions
  }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

#### Step 1.2: Add CORS Headers to Apps Script
- **File:** Code.gs
- **Action:** Update `doPost()` to include CORS headers
- **Test:** Call from Vercel staging domain

#### Step 1.3: Create Vercel Frontend (Separate Deployment)
- **Action:** Deploy current index.html to Vercel/staging
- **Keep:** index.html unchanged from GitHub (no code changes yet)
- **Test:** Frontend loads, but still tries to call google.script.run (will fail)

#### Step 1.4: Create API Abstraction Layer
- **File:** index.html (NEW: create `apiClient.js` wrapper OR modify `srv()`)
- **Action:** Create HTTP-based version of `srv()` function
- **Options:**
  - Option A: Create new function `http_srv()`, keep old `srv()`, switch in code
  - Option B: Modify `srv()` to check environment and route accordingly
  - **Recommended:** Option A for easy rollback

**Code Change:**
```javascript
// NEW: HTTP-based API client
function http_srv(fn) {
  var args = [].slice.call(arguments, 1);
  var apiUrl = '/api/endpoint'; // Points to Apps Script web app
  return fetch(apiUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action: fn, params: args})
  }).then(r => r.json());
}

// Keep old google.script.run version as fallback
function srv(fn) {
  var a = [].slice.call(arguments, 1);
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    // OLD: Apps Script hosted
    return new Promise(...);
  } else {
    // NEW: HTTP API
    return http_srv.apply(null, arguments);
  }
}
```

#### Step 1.5: Deploy & Test Staging
- **Vercel:** Deploy index.html with new `http_srv()` function
- **Apps Script:** Deploy new `doPost()` HTTP handler
- **Test:** Frontend on Vercel calls Apps Script backend via HTTP
- **Keep:** Original google.script.run version in production (unchanged)

---

### **PHASE 2: Cutover (PRODUCTION READY)**

#### Step 2.1: Verify All 19 Backend Functions Work via HTTP
- Test each API endpoint:
  - `getState()`
  - `saveTask()`, `deleteTask()`, `completeTask()`, `reopenTask()`
  - `sendInvite()`, `emailAttendees()`, `saveMom()`, `circulateMom()`
  - `saveContact()`, `deleteContact()`
  - `saveSettings()`, `installReminders()`, `removeReminders()`
  - `uploadAudioToDrive()`, `getAudioBase64()`
  - `parseSms()`

#### Step 2.2: User Authentication & Authorization
- **Action:** Implement JWT or session token validation in Apps Script
- **Backend:** Apps Script `doPost()` extracts user ID from request headers/cookies
- **Frontend:** Frontend sends authentication token with each request
- **Requirement:** Two authorized users only (will add in later phase)

#### Step 2.3: Performance & Reliability Testing
- Load test: Can Vercel handle concurrent users?
- Latency: HTTP overhead vs. google.script.run
- Fallback: If backend unreachable, show error (already handled)

#### Step 2.4: Data Integrity Verification
- Backup Google Sheets before cutover
- Run production data through HTTP endpoints
- Verify task counts, contact counts, MOM data unchanged

#### Step 2.5: Gradual Rollout
- Deploy Vercel frontend to canary users (e.g., 10%)
- Monitor error logs
- Gradual increase to 100%

#### Step 2.6: Monitor & Rollback Plan
- If issues: Users revert to old google.script.run version
- Keep old Apps Script version live as fallback

---

### **PHASE 3: Cleanup (OPTIONAL)**

#### Step 3.1: Remove google.script.run Fallback
- Once production stable: Remove old `srv()` function
- Keep only HTTP-based API calls

#### Step 3.2: Clean Up Code
- Remove `window.__` global variables (bad practice but works for now)
- Consider refactoring into class-based architecture
- Add proper error handling

---

## G. Files to Modify Summary

### Files TO CHANGE:
1. **index.html** 
   - Add/modify `srv()` function to use HTTP
   - Add new `http_srv()` wrapper (alternative: embed logic in `srv()`)
   - No changes to UI, state management, or business logic
   - **Lines affected:** ~110, +new code (~20 lines)

2. **Code.gs** (Apps Script backend)
   - Add `doPost()` HTTP request handler
   - Add CORS headers
   - Keep all existing functions unchanged
   - **Lines affected:** +50 new lines minimum

### Files NOT TO CHANGE (YET):
- Existing `getState()`, `saveTask()`, etc. - keep as-is
- No data migrations
- No new features
- No microphone recording implementation (Phase 2)
- No authentication implementation (Phase 2)

---

## H. Critical Dependencies & Assumptions

### Assumed Apps Script Functions (Must Verify Exist)
- [ ] `getState()` - must return complete app state
- [ ] `saveTask(task)` - must handle both create and update
- [ ] `deleteTask(id)` - must update sheets
- [ ] `completeTask(id)` - must set status='done' and completedAt
- [ ] `reopenTask(id)` - must set status='pending'
- [ ] `sendInvite(taskId)` - must create Calendar event
- [ ] `emailAttendees(taskId)` - must send email
- [ ] `saveMom(taskId, momData)` - must save MOM fields
- [ ] `circulateMom(taskId)` - must email attendees
- [ ] `saveContact(contact)` - must handle create/update
- [ ] `deleteContact(id)` - must delete
- [ ] `saveSettings(obj)` - must accept {directors} and {deptEmails}
- [ ] `installReminders()` - must create trigger
- [ ] `removeReminders()` - must delete trigger
- [ ] `uploadAudioToDrive(name, type, base64)` - must save to Drive
- [ ] `getAudioBase64(fileId)` - must retrieve from Drive
- [ ] `parseSms(text)` - must parse SMS into task

### Assumed Frontend Behavior
- Single Page App - no page reloads during normal use
- Global state object `S` - loaded on startup, refreshed after mutations
- No offline capability - always requires backend
- Browser local storage - not used (no persistence)
- No real-time updates - polling via `getState()` only

---

## I. Testing Checklist for Migration

### Pre-Migration (Current System)
- [ ] All 19 functions work in production
- [ ] Google Sheets data is backed up
- [ ] Existing test deployment URL works

### Post-Migration Phase 1
- [ ] Apps Script `doPost()` deploys successfully
- [ ] Staging Vercel frontend loads
- [ ] HTTP calls reach Apps Script backend
- [ ] CORS headers prevent errors
- [ ] All 19 API endpoints return correct responses

### Post-Migration Phase 2
- [ ] Production users can access Vercel frontend
- [ ] All task operations (create, read, update, delete) work
- [ ] All meeting operations work (calendar, email, MOM)
- [ ] All contact operations work
- [ ] Settings save correctly
- [ ] Audio upload/download works
- [ ] SMS parsing works
- [ ] Email reminders trigger correctly
- [ ] Data in Google Sheets matches expectations

### Security & Performance
- [ ] HTTPS enforced (Vercel default)
- [ ] No secrets in frontend code
- [ ] CORS restricted to authorized domains
- [ ] HTTP response times < 2 seconds
- [ ] No memory leaks during extended use
- [ ] Error messages don't leak sensitive info

---

## J. Risks Summary Table

| Risk | Severity | Mitigation | Owner | Phase |
|------|----------|-----------|-------|-------|
| CORS blocks requests | HIGH | Configure Apps Script CORS headers | Backend | 1 |
| No auth = open API | HIGH | Add user validation + JWT | Backend | 2 |
| Microphone blocked | MEDIUM | Test on Vercel; use upload fallback | Frontend | 2 |
| Large audio payloads | MEDIUM | HTTPS + rate limiting | Backend | 1 |
| Secret exposure | CRITICAL | Never add API keys to frontend | Both | All |
| Session loss on refresh | LOW | Call getState() on load | Frontend | 1 |
| Email headers changed | LOW | Document to users | Comms | 2 |
| Data corruption | HIGH | Backup Sheets + gradual rollout | Ops | 2 |

---

## K. Post-Migration Features (Out of Scope)

- **Microphone recording** - requires browser Mic access, fallback to upload
- **Authentication** - OAuth + JWT, restrict to 2 users
- **Real-time sync** - WebSocket or polling improvements
- **Offline mode** - IndexedDB + Service Worker
- **Gemini AI integration** - Move to backend, fix API key handling
- **Mobile app** - React Native wrapper

---

## Notes for Implementation

1. **Do not touch Code.gs beyond adding HTTP handler**
2. **Do not modify the UI, CSS, or business logic**
3. **Keep google.script.run code path as fallback during Phase 1**
4. **Test thoroughly in staging before production**
5. **Have rollback plan ready**
6. **Monitor error logs for first 48 hours post-launch**
7. **Inform users about new URL before cutover**

---

**End of Analysis**

Next steps: Wait for approval to begin Phase 1 implementation.
