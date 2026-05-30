param(
    [Parameter(Mandatory = $true)]
    [string]$GitHubOwner,

    [string]$RepositoryName = "job-application-copilot",

    [string]$Branch = "main",

    [string]$HostName = "applypilot.example.com"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$image = "ghcr.io/$GitHubOwner/$RepositoryName"
$repoUrl = "https://github.com/$GitHubOwner/$RepositoryName.git"
$redirectUri = "https://$HostName/api/gmail/oauth/callback"

function Replace-InFile([string]$Path, [hashtable]$Replacements) {
    $fullPath = Join-Path $projectRoot $Path
    $content = Get-Content -LiteralPath $fullPath -Raw

    foreach ($pattern in $Replacements.Keys) {
        $content = $content -replace $pattern, $Replacements[$pattern]
    }

    Set-Content -LiteralPath $fullPath -Value $content -NoNewline
}

Replace-InFile "k8s/base/kustomization.yaml" @{
    "name: ghcr\.io/.+/job-application-copilot" = "name: $image"
    "newName: ghcr\.io/.+/job-application-copilot" = "newName: $image"
}

Replace-InFile "k8s/base/deployment.yaml" @{
    "image: ghcr\.io/.+/job-application-copilot:dev" = "image: ${image}:dev"
}

Replace-InFile "k8s/base/ingress.yaml" @{
    "applypilot\.example\.com" = $HostName
}

Replace-InFile "k8s/base/configmap.yaml" @{
    "https://applypilot\.example\.com/api/gmail/oauth/callback" = $redirectUri
}

Replace-InFile "k8s/argocd/applypilot-application.yaml" @{
    "repoURL: https://github\.com/.+/job-application-copilot\.git" = "repoURL: $repoUrl"
    "targetRevision: main" = "targetRevision: $Branch"
}

Replace-InFile "Dockerfile" @{
    "ARG OCI_SOURCE=https://github\.com/.+/job-application-copilot" = "ARG OCI_SOURCE=$repoUrl"
}

Write-Host "GitOps files configured."
Write-Host "Image: $image"
Write-Host "Repo:  $repoUrl"
Write-Host "Host:  $HostName"
Write-Host "Gmail redirect URI: $redirectUri"
