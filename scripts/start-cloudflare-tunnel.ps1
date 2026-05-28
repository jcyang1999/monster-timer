param(
  [Parameter(Mandatory = $true)]
  [string]$TunnelToken,

  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path "$PSScriptRoot\.."

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  throw "cloudflared is not installed. Install it from Cloudflare Zero Trust, then run this script again."
}

$nodeProcess = Start-Process -FilePath node `
  -ArgumentList "server.js" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -PassThru

try {
  Start-Sleep -Seconds 2
  if ($nodeProcess.HasExited) {
    throw "Node server exited during startup."
  }

  Write-Output "Local app is running at http://localhost:$Port"
  Write-Output "Starting Cloudflare Tunnel..."
  cloudflared tunnel run --token $TunnelToken
}
finally {
  if ($nodeProcess -and -not $nodeProcess.HasExited) {
    Stop-Process -Id $nodeProcess.Id -Force
  }
}
