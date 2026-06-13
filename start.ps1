$ErrorActionPreference = "Stop"

$localNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = Get-Command node -ErrorAction SilentlyContinue

if ($node) {
  & $node.Source server.js
  exit $LASTEXITCODE
}

if (Test-Path $localNode) {
  & $localNode server.js
  exit $LASTEXITCODE
}

Write-Host "Node.js was not found. Install Node.js or run with the Codex bundled node path."
exit 1
