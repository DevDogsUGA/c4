# c4-registry Apps Script

Form-bound script: signs and POSTs each response to the Worker (`/api/form`),
serves a JSON backup roster from `doGet`, and can re-POST every response to
recover from dropped webhooks.

You need **two** Forms/scripts on event day:

1. **Production** — UGA-restricted ("Anyone in [your org] can respond"),
   verified email, response editing allowed, one response per person. Its
   script has `FORM_ENV` unset (or `production`).
2. **Staging** — unrestricted ("Anyone with the link"), used only by
   `../scripts/staging-e2e.ts` to dress-rehearse the pipeline without
   touching the real roster. Its script has `FORM_ENV = staging`.

Both scripts are the **same code** (`Code.gs`); only the Script Properties
differ. Deploy this directory to each Form separately with `clasp`.

## One-time setup per Form (production and, separately, staging)

1. Create the Google Form with fields **Team name**, **GitHub repo URL**,
   **Team members** (paragraph, one per line). Enable **Collect email
   addresses > Verified** (production only) and **Allow response editing**.
   For the production form, restrict to your Google Workspace domain.

2. Open the Form, **Extensions > Apps Script**, note the Script ID from
   **Project Settings**, or create the project locally and push with
   [`clasp`](https://github.com/google/clasp):

   ```sh
   cd apps/registry/apps-script
   cp .clasp.json.example .clasp.json
   # edit .clasp.json: set scriptId to this Form's bound script id
   clasp login          # once per machine
   clasp push           # uploads Code.gs + appsscript.json
   ```

3. In the Apps Script editor (or `clasp open`), go to **Project Settings >
   Script Properties** and add:

   | Property            | Production value                     | Staging value          |
   |----------------------|--------------------------------------|-------------------------|
   | `WORKER_URL`         | `https://REGISTRY_HOST`              | same                    |
   | `FORM_HMAC_SECRET`   | matches the Worker's `FORM_HMAC_SECRET` secret | same          |
   | `ROSTER_TOKEN`       | matches the Worker's `ROSTER_TOKEN` secret | same               |
   | `FORM_ID`            | *(leave unset — uses the bound form)* | *(leave unset)*        |
   | `FORM_ENV`           | *(leave unset, defaults to `production`)* | `staging`          |

4. Run `setup` once (select it in the function dropdown, click Run, approve
   the OAuth scopes it asks for). This installs an **installable** trigger
   so `onFormSubmit` fires on submit *and* on response edits (the simple
   trigger does not get edit events or `UrlFetchApp` access). Re-running
   `setup` is safe — it checks for an existing trigger first.

5. **Deploy as a web app** (for the `doGet` backup roster): **Deploy > New
   deployment > Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (production) — this is safe because
     `doGet` requires `?token=<ROSTER_TOKEN>` and otherwise returns
     `{"error":"unauthorized"}`. If your Workspace blocks "Anyone" web-app
     access org-wide, use **Anyone within [org]** instead and note that the
     backup URL then also requires the caller to be logged into a
     Workspace account.
   - Copy the deployment's `/exec` URL — that's the backup roster endpoint:
     `<deployment-url>?token=<ROSTER_TOKEN>`.

6. For the **staging** form specifically, also note its public form URL
   (**Send > Link**, un-shorten it) — the `.../forms/d/e/<ID>/viewform` id
   is `STAGING_FORM_ID` for `../scripts/staging-e2e.ts`. Find each field's
   `entry.<id>` by opening the *live* form, right-click > View Page Source,
   and search for `entry.` — or open Chrome DevTools Network tab, submit a
   test response, and read the form-encoded POST body.

## Recovering from dropped webhooks

- `doGet` (via the web app URL) always reflects the form's current
  responses, independent of whether webhooks succeeded — the last-resort
  read path.
- `resyncAll` (run manually from the Apps Script editor, or via a time
  trigger) re-POSTs every response in the form to `/api/form`. The Worker's
  upsert is idempotent per `response_id`/email, so re-sending is safe.

## Testing

The pure logic (`parseMembers`, `bytesToHex`/`computeSignatureHex`,
`buildFormPayload`, `findAnswerByTitle`/`extractAnswers`) has no Apps
Script dependencies and is unit tested under Node in `Code.test.ts` (run
with `pnpm test` from `apps/registry`, which picks up both the Worker's
and this directory's vitest projects via `vitest.workspace.ts`). The
trigger/web-app entry points (`onFormSubmit`, `setup`, `doGet`, `resyncAll`)
call GAS-only globals (`FormApp`, `PropertiesService`, `UrlFetchApp`,
`ScriptApp`) and can only be exercised against a real Form — that's what
`../scripts/staging-e2e.ts` is for.
