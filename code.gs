/**
 * Follow-up Desk — Google Apps Script backend
 */

var SS_PROP = 'FUD_SPREADSHEET_ID';
var SEED_VERSION = 3;

// Updated Schema
var TABS = {
  tasks: ['id','type','title','category','department','director','location','attendees','contactId','priority','dueDate','dueTime','recurring','notes','status','createdAt','completedAt','momPresent','momDiscussion','momDecisions','momActions','calEventId','enableMom','momTranscript','momAudioUrl','momAudioId'],
  contacts: ['id','name','role','org','phone','email','notes','createdAt'],
  settings: ['key','value']
};

var DEPARTMENTS = ['HR','Accounts','Insurance','IT','Audit','Infrastructure'];

/* ------------------------------- web app --------------------------------- */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Follow-up Desk')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ------------------------------ spreadsheet ------------------------------- */
function getSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SS_PROP);
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { id = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Follow-up Desk Data');
    props.setProperty(SS_PROP, ss.getId());
  }
  ensureTabs_(ss);
  ensureSeed_(ss);
  return ss;
}
function ensureTabs_(ss) {
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.appendRow(TABS[name]); }
    else if (sh.getLastRow() === 0) { sh.appendRow(TABS[name]); }
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) {} }
}
function objects_(ss, name) {
  var sh = ss.getSheetByName(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values.shift();
  var tz = Session.getScriptTimeZone();
  return values.filter(function (r) { return r[0] !== '' && r[0] != null; })
    .map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = coerce_(h, r[i], tz); }); return o; });
}
function coerce_(head, v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (head === 'dueDate') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (head === 'dueTime') return Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return v;
}
function writeObjects_(ss, name, objs) {
  var sh = ss.getSheetByName(name);
  var head = TABS[name];
  sh.clearContents();
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  if (objs.length) {
    var rows = objs.map(function (o) { return head.map(function (h) { return o[h] == null ? '' : o[h]; }); });
    sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  }
}

/* -------------------------------- settings ------------------------------- */
function getSettingsObj_(ss) {
  var rows = objects_(ss, 'settings');
  var o = {};
  rows.forEach(function (r) { try { o[r.key] = JSON.parse(r.value); } catch (e) { o[r.key] = r.value; } });
  if (!o.directors) o.directors = ['Director 1', 'Director 2', 'Director 3'];
  if (!o.deptEmails) o.deptEmails = {};
  if (o.reminderHour == null) o.reminderHour = 7;
  return o;
}
function writeSettingsObj_(ss, obj) {
  var rows = Object.keys(obj).map(function (k) { return { key: k, value: JSON.stringify(obj[k]) }; });
  writeObjects_(ss, 'settings', rows);
}

/* --------------------------------- seed ---------------------------------- */
function ensureSeed_(ss) {
  var s = getSettingsObj_(ss);
  var v = s.seedVersion || 0;
  if (v >= SEED_VERSION) return;
  var tasks = objects_(ss, 'tasks');
  var add = [];
  if (v < 3) {
    add.push(mkTask_({ title: 'Daily morning meeting', type: 'meeting', department: 'General', category: 'Meetings & Minutes', recurring: 'daily', priority: 'medium', dueDate: todayStr_(), dueTime: '09:30' }));
  }
  writeObjects_(ss, 'tasks', tasks.concat(add));
  s.seedVersion = SEED_VERSION;
  writeSettingsObj_(ss, s);
}
function mkTask_(o) {
  return {
    id: uid_(), type: o.type || 'followup', title: o.title || '', category: o.category || '',
    department: o.department || '', director: o.director || 'All', location: o.location || '',
    attendees: o.attendees || '', contactId: o.contactId || '', priority: o.priority || 'medium',
    dueDate: o.dueDate || '', dueTime: o.dueTime || '', recurring: o.recurring || 'none',
    notes: o.notes || '', status: 'pending', createdAt: new Date().toISOString(), completedAt: '',
    momPresent: '', momDiscussion: '', momDecisions: '', momActions: '', calEventId: '',
    enableMom: o.enableMom || false, momTranscript: o.momTranscript || '', momAudioUrl: o.momAudioUrl || '', momAudioId: o.momAudioId || ''
  };
}

/* ------------------------------- client API ------------------------------ */
function getState() {
  var ss = getSS_();
  return { tasks: objects_(ss, 'tasks'), contacts: objects_(ss, 'contacts'), settings: getSettingsObj_(ss), userEmail: Session.getActiveUser().getEmail(), triggersOn: hasReminderTrigger_() };
}

// Saves Base64 audio to Drive and returns the URL and ID
function uploadAudioToDrive(filename, mimeType, base64Data) {
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
    var folders = DriveApp.getFoldersByName("Follow-up Desk Audio");
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("Follow-up Desk Audio");
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, url: file.getDownloadUrl(), id: file.getId() };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// Fetches Base64 audio back from Drive so Gemini can process it
function getAudioBase64(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    return { ok: true, mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function saveTask(task) {
  var lock = LockService.getScriptLock(); lock.tryLock(20000);
  try {
    var ss = getSS_(); var tasks = objects_(ss, 'tasks');
    if (task.id) {
      var found = false;
      tasks = tasks.map(function (t) { if (t.id === task.id) { found = true; return merge_(t, task); } return t; });
      if (!found) tasks.push(merge_(mkTask_({}), task));
    } else { tasks.push(merge_(mkTask_({}), task)); }
    writeObjects_(ss, 'tasks', tasks);
    return objects_(ss, 'tasks');
  } finally { lock.releaseLock(); }
}
function deleteTask(id) {
  var ss = getSS_(); writeObjects_(ss, 'tasks', objects_(ss, 'tasks').filter(function (t) { return t.id !== id; })); return objects_(ss, 'tasks');
}
function completeTask(id) {
  var ss = getSS_(); var tasks = objects_(ss, 'tasks'); var extra = [];
  tasks = tasks.map(function (t) {
    if (t.id !== id) return t;
    var done = merge_(t, { status: 'done', completedAt: new Date().toISOString() });
    if (t.recurring && t.recurring !== 'none' && t.dueDate) {
      var n = merge_(t, {}); n.id = uid_(); n.status = 'pending'; n.completedAt = '';
      n.dueDate = addInterval_(t.dueDate, t.recurring);
      n.momPresent = ''; n.momDiscussion = ''; n.momDecisions = ''; n.momActions = ''; n.calEventId = '';
      n.momTranscript = ''; n.momAudioUrl = ''; n.momAudioId = '';
      n.createdAt = new Date().toISOString();
      extra.push(n);
    }
    return done;
  });
  writeObjects_(ss, 'tasks', tasks.concat(extra)); return objects_(ss, 'tasks');
}
function reopenTask(id) {
  var ss = getSS_(); writeObjects_(ss, 'tasks', objects_(ss, 'tasks').map(function (t) { return t.id === id ? merge_(t, { status: 'pending', completedAt: '' }) : t; })); return objects_(ss, 'tasks');
}
function saveMom(id, mom) {
  var ss = getSS_();
  writeObjects_(ss, 'tasks', objects_(ss, 'tasks').map(function (t) {
    if (t.id !== id) return t;
    return merge_(t, {
      momPresent: mom.present || '', momDiscussion: mom.discussion || '',
      momDecisions: mom.decisions || '', momActions: JSON.stringify(mom.actions || []),
      momTranscript: mom.transcript || '', momAudioUrl: mom.audioUrl || '', momAudioId: mom.audioId || ''
    });
  }));
  return objects_(ss, 'tasks');
}
function saveContact(c) {
  var ss = getSS_(); var list = objects_(ss, 'contacts');
  if (c.id) { list = list.map(function (x) { return x.id === c.id ? merge_(x, c) : x; }); }
  else { c.id = uid_(); c.createdAt = new Date().toISOString(); list.push(c); }
  writeObjects_(ss, 'contacts', list); return objects_(ss, 'contacts');
}
function deleteContact(id) {
  var ss = getSS_(); writeObjects_(ss, 'contacts', objects_(ss, 'contacts').filter(function (c) { return c.id !== id; })); return objects_(ss, 'contacts');
}
function saveSettings(partial) {
  var ss = getSS_(); var s = getSettingsObj_(ss); Object.keys(partial).forEach(function (k) { s[k] = partial[k]; }); writeSettingsObj_(ss, s); return s;
}

/* ---------------------------- calendar & email --------------------------- */
function taskById_(ss, id) { var f = objects_(ss, 'tasks').filter(function (t) { return t.id === id; }); return f[0]; }
function emails_(t) { return String(t.attendees || '').split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.indexOf('@') > -1; }); }
function meetingStart_(t) { var p = String(t.dueDate).split('-'); var tm = String(t.dueTime || '10:00').split(':'); return new Date(+p[0], +p[1] - 1, +p[2], +tm[0], +tm[1], 0); }
function whenStr_(t) { return Utilities.formatDate(meetingStart_(t), Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy \'at\' h:mm a'); }
function sendInvite(id) {
  var ss = getSS_(); var t = taskById_(ss, id); if (!t || !t.dueDate) return { ok: false, msg: 'Meeting needs a date.' };
  var start = meetingStart_(t); var end = new Date(start.getTime() + 3600000); var guests = emails_(t).join(',');
  var opts = { description: [t.department ? 'Department: ' + t.department : '', t.notes || ''].filter(String).join('\n') };
  if (guests) { opts.guests = guests; opts.sendInvites = true; } if (t.location) opts.location = t.location;
  var ev = CalendarApp.getDefaultCalendar().createEvent(t.title, start, end, opts);
  try { ev.addPopupReminder(30); ev.addEmailReminder(24 * 60); } catch (e) {}
  writeObjects_(ss, 'tasks', objects_(ss, 'tasks').map(function (x) { return x.id === id ? merge_(x, { calEventId: ev.getId() }) : x; }));
  return { ok: true, msg: guests ? 'Invite created and emailed.' : 'Event created on your calendar.' };
}
function emailAttendees(id) {
  var ss = getSS_(); var t = taskById_(ss, id); var to = emails_(t); if (!to.length) return { ok: false, msg: 'No attendee emails on this meeting.' };
  var body = ['Hello,', '', 'This is to confirm the following meeting:', '', 'Subject: ' + t.title, t.department ? 'Department: ' + t.department : '', 'When: ' + whenStr_(t), t.location ? 'Where: ' + t.location : '', t.notes ? '\nAgenda / Notes:\n' + t.notes : '', '', 'Kindly add it to your calendar. Thank you.'].filter(function (x) { return x !== ''; }).join('\n');
  MailApp.sendEmail(to.join(','), 'Meeting confirmed: ' + t.title, body); return { ok: true, msg: 'Confirmation emailed.' };
}
function momText_(t) {
  var acts = []; try { acts = JSON.parse(t.momActions || '[]'); } catch (e) {} acts = acts.filter(function (a) { return a.what && String(a.what).trim(); });
  var lines = ['MINUTES OF MEETING', '', 'Meeting: ' + t.title, t.department ? 'Department: ' + t.department : '', t.dueDate ? 'Date & time: ' + whenStr_(t) : '', t.location ? 'Venue: ' + t.location : '', 'Present: ' + (t.momPresent || emails_(t).join(', ') || '\u2014'), '', 'DISCUSSION', (t.momDiscussion || '\u2014'), '', 'DECISIONS', (t.momDecisions || '\u2014'), '', 'ACTION ITEMS'];
  if (acts.length) acts.forEach(function (a, i) { lines.push((i + 1) + '. ' + a.what + (a.owner ? ' \u2014 Owner: ' + a.owner : '') + (a.due ? ' \u2014 Due: ' + a.due : '')); }); else lines.push('\u2014');
  lines.push('', 'Prepared via Follow-up Desk.'); return lines.filter(function (x) { return x !== undefined; }).join('\n');
}
function circulateMom(id) { var ss = getSS_(); var t = taskById_(ss, id); var to = emails_(t); if (!to.length) return { ok: false, msg: 'Add attendee emails to circulate the MOM.' }; MailApp.sendEmail(to.join(','), 'Minutes of Meeting: ' + t.title, momText_(t)); return { ok: true, msg: 'MOM circulated.' }; }

/* ------------------------------- reminders ------------------------------- */
function hasReminderTrigger_() { return ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'sendDailyReminders'; }); }
function installReminders() { removeReminders(); var s = getSettingsObj_(getSS_()); ScriptApp.newTrigger('sendDailyReminders').timeBased().everyDays(1).atHour(s.reminderHour || 7).create(); return true; }
function removeReminders() { ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sendDailyReminders') ScriptApp.deleteTrigger(tr); }); return true; }
function sendDailyReminders() {
  var ss = getSS_(); var tasks = objects_(ss, 'tasks'); var today = todayStr_(); var open = tasks.filter(function (t) { return t.status === 'pending' && t.dueDate; });
  var overdue = open.filter(function (t) { return t.dueDate < today; }); var due = open.filter(function (t) { return t.dueDate === today; });
  if (!overdue.length && !due.length) return;
  var fmt = function (t) { return '\u2022 ' + t.title + (t.dueTime ? ' (' + t.dueTime + ')' : '') + (t.department ? ' [' + t.department + ']' : ''); };
  var body = ['Good morning,', '', 'Your Follow-up Desk for today:', ''];
  if (overdue.length) { body.push('OVERDUE (' + overdue.length + '):'); overdue.forEach(function (t) { body.push(fmt(t)); }); body.push(''); }
  if (due.length) { body.push('DUE TODAY (' + due.length + '):'); due.forEach(function (t) { body.push(fmt(t)); }); }
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Follow-up Desk — today (' + today + ')', body.join('\n'));
}

/* ------------------------------- utils ------------------------------- */
function parseSms(text) { text = String(text || ''); var amt = (text.match(/(?:rs\.?|inr|\u20b9)\s*([\d,]+(?:\.\d+)?)/i) || [])[1]; var comp = (text.match(/(LIC|HDFC|ICICI|SBI|Bajaj|Max|Tata AIA|Kotak|Reliance|Star|Aditya Birla|PNB|Aviva)/i) || [])[1]; var due = ''; var d1 = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/); if (d1) { var y = d1[3].length === 2 ? '20' + d1[3] : d1[3]; due = y + '-' + pad_(+d1[2]) + '-' + pad_(+d1[1]); } return { type: 'followup', title: 'Payment reminder' + (comp ? ' — ' + comp : '') + (amt ? ' \u20b9' + amt : ''), category: 'Insurance & Policies', priority: 'high', recurring: 'none', dueDate: due, notes: text.trim() }; }
function merge_(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }
function uid_() { return Utilities.getUuid().slice(0, 12); }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function toStr_(d) { return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate()); }
function todayStr_() { return toStr_(new Date()); }
function monthlyOn_(day) { var n = new Date(); var d = new Date(n.getFullYear(), n.getMonth(), day); if (d < new Date(n.getFullYear(), n.getMonth(), n.getDate())) d = new Date(n.getFullYear(), n.getMonth() + 1, day); return toStr_(d); }
function nextFriday_() { var d = new Date(); var add = (5 - d.getDay() + 7) % 7; return toStr_(new Date(d.getFullYear(), d.getMonth(), d.getDate() + add)); }
function addInterval_(dateStr, freq) { var p = dateStr.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); if (freq === 'daily') d.setDate(d.getDate() + 1); else if (freq === 'weekly') d.setDate(d.getDate() + 7); else if (freq === 'monthly') d.setMonth(d.getMonth() + 1); else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3); else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1); return toStr_(d); }

/* ------------------------------- HTTP GATEWAY (NEW) ------------------------------- */
/**
 * HTTP POST handler for Vercel API proxy
 * Routes requests to business logic functions
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var params = payload.params || [];
    var result;
    
    switch (action) {
      case 'getState': result = getState(); break;
      case 'saveTask': result = saveTask(params[0]); break;
      case 'deleteTask': result = deleteTask(params[0]); break;
      case 'completeTask': result = completeTask(params[0]); break;
      case 'reopenTask': result = reopenTask(params[0]); break;
      case 'sendInvite': result = sendInvite(params[0]); break;
      case 'emailAttendees': result = emailAttendees(params[0]); break;
      case 'saveMom': result = saveMom(params[0], params[1]); break;
      case 'circulateMom': result = circulateMom(params[0]); break;
      case 'saveContact': result = saveContact(params[0]); break;
      case 'deleteContact': result = deleteContact(params[0]); break;
      case 'saveSettings': result = saveSettings(params[0]); break;
      case 'installReminders': result = installReminders(); break;
      case 'removeReminders': result = removeReminders(); break;
      case 'uploadAudioToDrive': result = uploadAudioToDrive(params[0], params[1], params[2]); break;
      case 'getAudioBase64': result = getAudioBase64(params[0]); break;
      case 'parseSms': result = parseSms(params[0]); break;
      default: return buildErrorResponse('Unknown action: ' + action);
    }
    
    return buildSuccessResponse(result);
  } catch (error) {
    Logger.log('doPost error: ' + error.toString());
    return buildErrorResponse('Server error: ' + error.toString());
  }
}

/**
 * Build JSON response for success
 */
function buildSuccessResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Build JSON response for error
 */
function buildErrorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({ error: message })).setMimeType(ContentService.MimeType.JSON);
}
