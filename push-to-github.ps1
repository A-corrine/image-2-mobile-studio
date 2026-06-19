param(
  [string]$Owner = "A-corrine",
  [string]$Repository = "image-2-mobile-studio",
  [string]$Branch = "main",
  [string]$Message = "Add paid credits, billing, and account recovery"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Target repository: $Owner/$Repository ($Branch)"
Write-Host "The token is used in memory only and is never written to disk."
$secureToken = Read-Host "Paste Fine-grained GitHub Token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Token cannot be empty."
  }

  $headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "Image-2-Studio-Uploader"
  }
  $api = "https://api.github.com/repos/$Owner/$Repository"

  Write-Host "Reading remote branch..."
  $reference = Invoke-RestMethod -Method Get -Uri "$api/git/ref/heads/$Branch" -Headers $headers
  $headSha = $reference.object.sha
  $commit = Invoke-RestMethod -Method Get -Uri "$api/git/commits/$headSha" -Headers $headers

  $excluded = '^(\.git/|\.tools/|node_modules/|outputs/|data/)|(^|/)\.env$|\.log$|^paid-test|^push-to-github\.ps1$'
  $files = Get-ChildItem -LiteralPath $root -File -Recurse | Where-Object {
    $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    $relative -notmatch $excluded
  }

  if (-not $files) {
    throw "No project files were found."
  }

  $treeEntries = @()
  $index = 0
  foreach ($file in $files) {
    $index++
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    Write-Progress -Activity "Uploading project files" -Status "$index / $($files.Count): $relative" -PercentComplete (($index / $files.Count) * 100)
    $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
    $blobBody = @{ content = $content; encoding = "base64" } | ConvertTo-Json -Compress
    $blob = Invoke-RestMethod -Method Post -Uri "$api/git/blobs" -Headers $headers -ContentType "application/json" -Body $blobBody
    $treeEntries += @{
      path = $relative
      mode = "100644"
      type = "blob"
      sha = $blob.sha
    }
  }
  Write-Progress -Activity "Uploading project files" -Completed

  Write-Host "Creating one atomic commit..."
  $treeBody = @{
    base_tree = $commit.tree.sha
    tree = $treeEntries
  } | ConvertTo-Json -Depth 6 -Compress
  $tree = Invoke-RestMethod -Method Post -Uri "$api/git/trees" -Headers $headers -ContentType "application/json" -Body $treeBody

  $commitBody = @{
    message = $Message
    tree = $tree.sha
    parents = @($headSha)
  } | ConvertTo-Json -Depth 4 -Compress
  $newCommit = Invoke-RestMethod -Method Post -Uri "$api/git/commits" -Headers $headers -ContentType "application/json" -Body $commitBody

  $updateBody = @{ sha = $newCommit.sha; force = $false } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Patch -Uri "$api/git/refs/heads/$Branch" -Headers $headers -ContentType "application/json" -Body $updateBody | Out-Null

  Write-Host "Upload complete. Commit: $($newCommit.sha)" -ForegroundColor Green
  Write-Host "Render can now deploy this update from GitHub."
} finally {
  if ($tokenPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  }
  Remove-Variable token -ErrorAction SilentlyContinue
}
