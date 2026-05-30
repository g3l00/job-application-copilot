# Deploy ApplyPilot on Render

You do not need to buy a hostname. Render gives the service a public URL such as:

```text
https://applypilot-private.onrender.com
```

## Important Storage Note

ApplyPilot uses SQLite at `/app/data/applypilot.sqlite`.

Render Free web services have an ephemeral filesystem, so your local SQLite database can disappear after redeploys or restarts. Use the `starter` plan with the persistent disk in `render.yaml` if you want the tracker data and Gmail refresh token to persist.

## 1. Push to GitHub

Create a GitHub repository and push this project.

Do not commit `.env` or the `data/` folder.

## 2. Create the Render Blueprint

1. Go to Render Dashboard.
2. Click `New +`.
3. Choose `Blueprint`.
4. Connect your GitHub repository.
5. Render will detect `render.yaml`.
6. Create the service.

Render will ask you to provide secret environment variables:

```text
APP_PASSWORD
OPENAI_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

`OPENAI_API_KEY` can be empty if you do not want AI drafts yet.

## 3. Copy Your Render URL

After the deploy succeeds, open the service in Render and copy the public URL.

It will look like:

```text
https://applypilot-private.onrender.com
```

## 4. Update Google OAuth

In Google Cloud Console, add this Authorized redirect URI:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/gmail/oauth/callback
```

Replace `YOUR-RENDER-SERVICE` with the actual Render service subdomain.

You do not need to set `GOOGLE_REDIRECT_URI` on Render. ApplyPilot detects the current Render URL automatically.

## 5. Use ApplyPilot

Open the Render URL and login:

```text
Username: applypilot
Password: the APP_PASSWORD you set in Render
```

Then click `Connect Gmail` again from the Render-hosted app so Google stores the production callback.

## Optional Free Mode

You can remove the `disk` section from `render.yaml` and change `plan: starter` to `plan: free`, but SQLite data will not be reliable because the filesystem is ephemeral.
