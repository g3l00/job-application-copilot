# ApplyPilot

React web app for daily job application preparation and tracking.

## What It Does

- Tracks daily application target and pipeline status.
- Builds a daily plan from the best pending roles up to your target.
- Scores pasted job descriptions against a Java/Spring/cloud profile.
- Generates resume bullets, cover letter drafts, and recruiter message drafts.
- Stores applications in SQLite locally or Postgres when `DATABASE_URL` is set.
- Exports the application tracker to CSV.
- Imports pasted LinkedIn job alert emails into a daily review queue.
- Scans LinkedIn job alert emails from Gmail, previews detected jobs, and shows which emails were checked.
- Saves profile/resume versions from pasted text or uploaded PDF, `.txt`, or `.md` resumes.
- Shows weekly application and interview charts.
- Supports the review flow: `Saved -> Shortlisted -> Ready to Apply -> Applied`, with `Skipped` for roles you reject.
- Optionally generates AI-tailored resume bullets, cover letters, recruiter messages, and fit notes through a local server.

## Run Locally

```powershell
npm.cmd install
npm.cmd run dev
```

Run the backend server in a second terminal:

```powershell
npm.cmd run server
```

Open the local URL printed by Vite. Without `DATABASE_URL`, the backend stores data in `data/applypilot.sqlite`.

## Persistent Tracker Data

Run the local server to save applications, profile versions, and settings to the backend database:

```powershell
npm.cmd run server
```

Without the server, ApplyPilot still has a browser local storage fallback, but the backend database is the source of truth. Set `DATABASE_URL` to use Postgres; leave it empty to use local SQLite.

## Resume/Profile Versions

Use the `Profile source` panel to:

- Save the current profile text as a named version.
- Upload a PDF, `.txt`, `.md`, or `.markdown` resume.
- Activate a previous profile version before generating drafts.

PDF parsing works best for text-based PDFs. Scanned image PDFs may not contain readable text.

## Gmail Import

Create a Google OAuth client and set these values in `.env`:

```text
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8787/api/gmail/oauth/callback
GMAIL_QUERY=from:(jobalerts-noreply@linkedin.com) newer_than:30d
```

Then run the server and click `Connect Gmail`. After approving read-only Gmail access, adjust the Gmail query if needed, click `Scan Gmail`, review the preview, then click `Import preview`.

You can write the OAuth values into `.env` without pasting secrets into chat by running:

```powershell
.\scripts\configure-gmail-oauth.ps1
```

Use this redirect URI in your Google OAuth client:

```text
http://localhost:8787/api/gmail/oauth/callback
```

## Optional AI Drafts

Create `.env` from `.env.example`:

```powershell
copy .env.example .env
```

Set:

```text
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.4-mini
```

Run the local AI server in a second terminal:

```powershell
npm.cmd run server
```

Keep the React app running in the first terminal:

```powershell
npm.cmd run dev
```

Click `AI draft` in the Application draft panel after filling a role, company, and job description.

## Build

```powershell
npm.cmd run build
```

## Private Deployment

The production server serves both the React build and the API:

```powershell
npm.cmd run build
npm.cmd run start
```

Set `APP_USERNAME` and `APP_PASSWORD` to enable basic auth.

For Render, use `render.yaml`. You do not need your own hostname; Render gives the service a public `*.onrender.com` URL. The blueprint uses a Free web service plus a Free Render Postgres database, so tracker data is not stored on the web service filesystem.

After Render creates the service, add this Google OAuth redirect URI using your actual Render URL:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/gmail/oauth/callback
```

See [docs/deploy-render.md](docs/deploy-render.md) for the full Render checklist.

## Kubernetes, CI/CD, and Argo CD

This repo includes a GitOps deployment path:

- `Dockerfile` builds the private ApplyPilot web app.
- `.github/workflows/ci.yml` runs build checks.
- `.github/workflows/container-gitops.yml` publishes to GitHub Container Registry and updates the Kubernetes image tag.
- `k8s/base` contains Kubernetes manifests for Deployment, Service, Ingress, PVC, and config.
- `k8s/argocd/applypilot-application.yaml` lets Argo CD sync the app.

Start with:

```powershell
.\scripts\configure-gitops.ps1 -GitHubOwner YOUR_GITHUB_USERNAME -RepositoryName job-application-copilot -HostName applypilot.your-domain.com
```

Then follow [docs/deploy-kubernetes-argocd.md](docs/deploy-kubernetes-argocd.md).

## Note

This app does not automate LinkedIn browsing, scraping, form filling, or submissions. It prepares application material and keeps the final submission manual.
