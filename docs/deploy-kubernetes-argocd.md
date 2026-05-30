# Deploy ApplyPilot with Docker, Kubernetes, GitHub Actions, and Argo CD

This setup gives ApplyPilot a GitOps deployment flow:

1. You push code to GitHub.
2. GitHub Actions builds a Docker image.
3. GitHub Actions pushes the image to GitHub Container Registry.
4. GitHub Actions updates `k8s/base/kustomization.yaml` with the new image tag.
5. Argo CD watches the repo and deploys the new tag to Kubernetes.

## 1. Configure Repository Values

Run this locally once:

```powershell
cd C:\Users\user\VSCode\job-application-copilot
.\scripts\configure-gitops.ps1 -GitHubOwner YOUR_GITHUB_USERNAME -RepositoryName job-application-copilot -HostName applypilot.your-domain.com
```

Commit and push the changes to GitHub.

## 2. GitHub Settings

In your GitHub repository:

- Go to `Settings > Actions > General`.
- Allow workflows to read and write repository contents.
- Go to `Settings > Actions > General > Workflow permissions`.
- Select `Read and write permissions`.
- Go to `Settings > Packages` after the first image is published and make sure your Kubernetes cluster can pull the GHCR image.

The workflow uses `GITHUB_TOKEN` to publish to GHCR and commit the new Kubernetes image tag.

## 3. Kubernetes Secrets

Create the namespace and secrets in your cluster:

```powershell
kubectl apply -f k8s/base/namespace.yaml

kubectl -n applypilot create secret generic applypilot-secrets `
  --from-literal=APP_PASSWORD="choose-a-strong-password" `
  --from-literal=OPENAI_API_KEY="" `
  --from-literal=GOOGLE_CLIENT_ID="your-google-client-id" `
  --from-literal=GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

If your GHCR package is private, create an image pull secret:

```powershell
kubectl -n applypilot create secret docker-registry ghcr-pull-secret `
  --docker-server=ghcr.io `
  --docker-username=YOUR_GITHUB_USERNAME `
  --docker-password=YOUR_GITHUB_PAT `
  --docker-email=you@example.com
```

The GitHub PAT needs package read access. If you make the GHCR package public, you can remove `imagePullSecrets` from `k8s/base/deployment.yaml`.

## 4. Gmail OAuth Redirect URI

For the deployed app, add this redirect URI to your Google OAuth client:

```text
https://applypilot.your-domain.com/api/gmail/oauth/callback
```

Also update `k8s/base/configmap.yaml` if your hostname changes.

## 5. Install Argo CD Application

Make sure Argo CD is installed, then apply:

```powershell
kubectl apply -n argocd -f k8s/argocd/applypilot-application.yaml
```

Argo CD will sync the manifests in `k8s/base`.

## 6. Access the App

Point DNS for your hostname to your Kubernetes ingress/load balancer.

Then open:

```text
https://applypilot.your-domain.com
```

Login with:

```text
Username: applypilot
Password: the APP_PASSWORD you set in the Kubernetes secret
```

## Notes

- ApplyPilot uses SQLite, so the Kubernetes deployment intentionally runs one replica and uses a `ReadWriteOnce` persistent volume.
- Keep `.env`, `data/`, and real Kubernetes secrets out of git.
- For a public internet deployment, use HTTPS. cert-manager plus nginx ingress is a common Kubernetes path.
