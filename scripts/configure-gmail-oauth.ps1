param(
    [string]$ClientId,
    [string]$RedirectUri = "http://localhost:8787/api/gmail/oauth/callback",
    [string]$GmailQuery = "from:(jobalerts-noreply@linkedin.com) newer_than:30d",
    [int]$MaxResults = 10
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env"
$examplePath = Join-Path $projectRoot ".env.example"

if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
}

if ([string]::IsNullOrWhiteSpace($ClientId)) {
    $ClientId = Read-Host "Google OAuth Client ID"
}

$secureSecret = Read-Host "Google OAuth Client Secret" -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
    $ClientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}

if ([string]::IsNullOrWhiteSpace($ClientId) -or [string]::IsNullOrWhiteSpace($ClientSecret)) {
    throw "Client ID and Client Secret are required."
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    $lines.Add($line)
}

function Set-EnvValue([string]$Key, [string]$Value) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^$([regex]::Escape($Key))=") {
            $lines[$i] = "$Key=$Value"
            return
        }
    }

    $lines.Add("$Key=$Value")
}

Set-EnvValue "GOOGLE_CLIENT_ID" $ClientId
Set-EnvValue "GOOGLE_CLIENT_SECRET" $ClientSecret
Set-EnvValue "GOOGLE_REDIRECT_URI" $RedirectUri
Set-EnvValue "GMAIL_QUERY" $GmailQuery
Set-EnvValue "GMAIL_MAX_RESULTS" ([string]$MaxResults)

[System.IO.File]::WriteAllLines($envPath, $lines)

Write-Host "Gmail OAuth values saved to .env"
Write-Host "Redirect URI: $RedirectUri"
Write-Host "Restart ApplyPilot, then click Connect Gmail."
