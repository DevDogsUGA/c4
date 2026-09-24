/**
 * c4-registry Apps Script: form-bound trigger that signs and POSTs each
 * response to the Worker, plus a doGet() JSON backup roster and a manual
 * resyncAll() to recover from dropped webhooks.
 *
 * Script Properties (Project Settings > Script Properties):
 *   WORKER_URL        - e.g. https://REGISTRY_HOST (no trailing slash)
 *   FORM_HMAC_SECRET  - must match the Worker's FORM_HMAC_SECRET secret
 *   ROSTER_TOKEN      - must match the Worker's ROSTER_TOKEN secret (used
 *                       only to authorize this script's own doGet backup)
 *   FORM_ID           - optional; defaults to the bound form
 *                       (FormApp.getActiveForm()) when unset
 *   FORM_ENV          - optional; 'production' (default) or 'staging'. Set
 *                       to 'staging' on the unrestricted staging copy of
 *                       the form so the Worker excludes it from the public
 *                       roster, the 32-team cap, and duplicate-repo checks.
 *
 * The pure logic (payload building, member parsing, hex HMAC signing) lives
 * in plain functions with no Apps Script globals so it can be unit tested
 * under Node/vitest with small shims — see apps-script.test.ts.
 */

// ---------------------------------------------------------------------------
// Pure functions (unit-testable under Node)
// ---------------------------------------------------------------------------

/** Split a "one member per line" textarea answer into trimmed, non-empty names. */
function parseMembers(rawText) {
  if (!rawText) return [];
  return String(rawText)
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });
}

/** Uint8Array/number[]/signed-byte-array -> lowercase hex string. */
function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    // Apps Script's Utilities.computeHmacSha256Signature returns signed
    // bytes (-128..127); mask to an unsigned byte before formatting.
    var b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/**
 * HMAC-SHA256(secret, rawBody) as lowercase hex, matching the Worker's
 * crypto.ts `signHex`. Takes a `computeHmac` function so it's swappable in
 * tests (real: Utilities.computeHmacSha256Signature).
 */
function computeSignatureHex(computeHmac, secret, rawBody) {
  var bytes = computeHmac(rawBody, secret);
  return bytesToHex(bytes);
}

/** Build the exact /api/form body shape from already-extracted field values. */
function buildFormPayload(opts) {
  return {
    response_id: opts.responseId,
    submitter_email: opts.submitterEmail,
    team_name: opts.teamName,
    repo_url: opts.repoUrl,
    members: parseMembers(opts.membersText),
    submitted_at: opts.submittedAt,
    env: opts.env || 'production',
  };
}

/**
 * Find an item response's answer by matching the question title against a
 * list of case-insensitive substrings, so field reordering in the Form
 * editor doesn't break the script.
 */
function findAnswerByTitle(itemResponses, titleContains) {
  for (var i = 0; i < itemResponses.length; i++) {
    var title = itemResponses[i].getItem
      ? itemResponses[i].getItem().getTitle()
      : itemResponses[i].title; // shimmed shape in tests
    if (title && title.toLowerCase().indexOf(titleContains.toLowerCase()) !== -1) {
      return itemResponses[i].getResponse ? itemResponses[i].getResponse() : itemResponses[i].response;
    }
  }
  return null;
}

/** Extract {teamName, repoUrl, membersText} from a FormResponse's item responses. */
function extractAnswers(itemResponses) {
  return {
    teamName: findAnswerByTitle(itemResponses, 'team name'),
    repoUrl: findAnswerByTitle(itemResponses, 'repo'),
    membersText: findAnswerByTitle(itemResponses, 'members'),
  };
}

// ---------------------------------------------------------------------------
// Apps Script entry points (not unit-testable without a live Form/Worker)
// ---------------------------------------------------------------------------

function getProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function getForm_() {
  var formId = getProp_('FORM_ID');
  return formId ? FormApp.openById(formId) : FormApp.getActiveForm();
}

/**
 * The form no longer collects email addresses (everyone registers in
 * person, same room), so getRespondentEmail() is typically unavailable —
 * it throws (collection off) or returns '' depending on the Form's
 * configuration. Either way, fall back to '': email is never team identity
 * (see response_id) and is purely informational when present.
 */
function safeRespondentEmail_(formResponse) {
  try {
    return formResponse.getRespondentEmail() || '';
  } catch (err) {
    return '';
  }
}

function payloadFromFormResponse_(formResponse) {
  var answers = extractAnswers(formResponse.getItemResponses());
  return buildFormPayload({
    responseId: formResponse.getId(),
    submitterEmail: safeRespondentEmail_(formResponse),
    teamName: answers.teamName,
    repoUrl: answers.repoUrl,
    membersText: answers.membersText,
    submittedAt: formResponse.getTimestamp().toISOString(),
    env: getProp_('FORM_ENV') || 'production',
  });
}

function postSignedPayload_(payload) {
  var workerUrl = getProp_('WORKER_URL');
  var secret = getProp_('FORM_HMAC_SECRET');
  var rawBody = JSON.stringify(payload);
  var signature = computeSignatureHex(
    function (body, key) {
      return Utilities.computeHmacSha256Signature(body, key);
    },
    secret,
    rawBody,
  );

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-C4-Signature': signature },
    payload: rawBody,
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(workerUrl + '/api/form', options);
  var code = response.getResponseCode();
  if (code >= 200 && code < 300) return response;

  Logger.log('c4-registry POST failed (attempt 1), status=' + code + ' body=' + response.getContentText());
  // Retry once — the event day network/Worker cold start can be flaky.
  var retryResponse = UrlFetchApp.fetch(workerUrl + '/api/form', options);
  var retryCode = retryResponse.getResponseCode();
  if (retryCode < 200 || retryCode >= 300) {
    Logger.log(
      'c4-registry POST failed (attempt 2), status=' + retryCode + ' body=' + retryResponse.getContentText(),
    );
  }
  return retryResponse;
}

/** Installable trigger target: fires on submit AND on response edit (same response id). */
function onFormSubmit(e) {
  try {
    var payload = payloadFromFormResponse_(e.response);
    postSignedPayload_(payload);
  } catch (err) {
    Logger.log('c4-registry onFormSubmit error: ' + err + (err && err.stack ? '\n' + err.stack : ''));
  }
}

/** Idempotently install the onFormSubmit trigger for the bound/target form. */
function setup() {
  var form = getForm_();
  var existing = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'onFormSubmit' && t.getTriggerSourceId() === form.getId();
  });
  setupResyncTimer();
  if (existing) {
    Logger.log('onFormSubmit trigger already installed for form ' + form.getId());
    return;
  }
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Installed onFormSubmit trigger for form ' + form.getId());
}

/**
 * Idempotently install a 5-minute timer that re-sends every response
 * (resyncAll). This is the backup path for dropped webhooks: UGA's
 * Workspace forbids anonymous web apps, so the arena can't pull a roster
 * from doGet; instead the script keeps pushing. The Worker ignores
 * unchanged re-sends. Run once, after setup().
 */
function setupResyncTimer() {
  var existing = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'resyncAll';
  });
  if (existing) {
    Logger.log('resyncAll timer already installed');
    return;
  }
  ScriptApp.newTrigger('resyncAll').timeBased().everyMinutes(5).create();
  Logger.log('Installed 5-minute resyncAll timer');
}

/**
 * Backup roster, same shape as /api/roster. Only ever reflects THIS form's
 * own responses (production form's doGet only returns production data,
 * staging form's doGet only returns staging data) — there is no
 * cross-environment merge here. Requires ?token=<ROSTER_TOKEN>.
 *
 * One team per form response: form.getResponses() already returns each
 * response's latest edited version (Google Forms overwrites the response
 * in place on "edit your response"), keyed by response id — matching the
 * Worker's identity-by-response_id upsert semantics now that the form
 * doesn't collect email addresses.
 */
function doGet(e) {
  var token = e && e.parameter ? e.parameter.token : null;
  if (token !== getProp_('ROSTER_TOKEN')) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' })).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  var form = getForm_();
  var responses = form.getResponses();

  var teams = [];
  for (var i = 0; i < responses.length; i++) {
    var fr = responses[i];
    var answers = extractAnswers(fr.getItemResponses());
    teams.push({
      id: fr.getId(),
      team_name: answers.teamName,
      repo_url: answers.repoUrl,
      members: parseMembers(answers.membersText),
      submitter_email: safeRespondentEmail_(fr),
      updated_at: fr.getTimestamp().toISOString(),
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ teams: teams })).setMimeType(ContentService.MimeType.JSON);
}

/** Re-POST every current response, to recover from dropped/failed webhooks. */
function resyncAll() {
  var form = getForm_();
  var responses = form.getResponses();
  var okCount = 0;
  var failCount = 0;
  for (var i = 0; i < responses.length; i++) {
    try {
      var payload = payloadFromFormResponse_(responses[i]);
      var response = postSignedPayload_(payload);
      var code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        okCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      failCount++;
      Logger.log('c4-registry resyncAll error for response ' + i + ': ' + err);
    }
    Utilities.sleep(250); // stay well under any rate limit
  }
  Logger.log('c4-registry resyncAll done: ' + okCount + ' ok, ' + failCount + ' failed');
}

// Export pure functions for Node/vitest; no-op under the Apps Script V8
// runtime, where `module` is undefined.
if (typeof module !== 'undefined') {
  module.exports = {
    parseMembers: parseMembers,
    bytesToHex: bytesToHex,
    computeSignatureHex: computeSignatureHex,
    buildFormPayload: buildFormPayload,
    findAnswerByTitle: findAnswerByTitle,
    extractAnswers: extractAnswers,
    safeRespondentEmail_: safeRespondentEmail_,
    payloadFromFormResponse_: payloadFromFormResponse_,
    doGet: doGet,
  };
}
