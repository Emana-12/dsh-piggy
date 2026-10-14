param(
  [string]$Output = '',
  [switch]$IncludeNodeModules
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($Output)) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  $Output = Join-Path (Split-Path $repoRoot -Parent) "dsh-piggy-ai-cli-ready-$stamp.zip"
}
$stage = Join-Path ([IO.Path]::GetTempPath()) ("dsh-piggy-ai-cli-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  $destination = Join-Path $stage 'dsh-piggy'
  $exclude = @('.git', 'node_modules', 'dist', 'coverage', '.cache')
  $items = Get-ChildItem -LiteralPath $repoRoot -Force | Where-Object { $exclude -notcontains $_.Name }
  foreach ($item in $items) {
    if ($item.Name -eq 'node_modules' -and $IncludeNodeModules) { Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force; continue }
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
  }
  if (-not $IncludeNodeModules) {
    Get-ChildItem -LiteralPath $destination -Directory -Recurse -Force |
      Where-Object { $_.Name -in @('node_modules', 'dist', 'coverage', '.cache') } |
      Sort-Object FullName -Descending |
      Remove-Item -Recurse -Force
  }
  $instructions = @(
    'dsh-piggy AI CLI adapter package',
    '',
    '1. Give the dsh-piggy directory and docs/AI-CLI-接入指南.md to the target CLI AI.',
    '2. Ask the AI to inspect the CLI Hook/MCP mechanism, generate an adapter, and run acceptance checks.',
    '3. The desktop app and target Agent must use the same pairing directory. Set DSH_PIGGY_HOME for the Agent when its home directory differs. Never copy or edit state.json directly.',
    '4. Require a report with status, generated files, enabled hooks, and acceptance results.'
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath (Join-Path $destination 'AI-CLI-INSTALL.txt') -Value $instructions -Encoding UTF8
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
  Compress-Archive -LiteralPath $destination -DestinationPath $Output -CompressionLevel Optimal
  Write-Output "Created: $Output"
  Write-Output 'Entry point: docs/AI-CLI-接入指南.md'
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
