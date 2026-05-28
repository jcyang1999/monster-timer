param(
  [int]$Port = 3000,
  [string]$DataDir = "$PSScriptRoot\..\data"
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path "$PSScriptRoot\.."

Set-Location $projectRoot
$env:PORT = [string]$Port
$env:MONSTER_TIMER_DATA_DIR = (Resolve-Path $DataDir -ErrorAction SilentlyContinue)
if (-not $env:MONSTER_TIMER_DATA_DIR) {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $env:MONSTER_TIMER_DATA_DIR = (Resolve-Path $DataDir)
}

node server.js
