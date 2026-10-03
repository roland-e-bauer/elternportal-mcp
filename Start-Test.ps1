param([switch]$Mcp)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js wurde nicht gefunden.' }
Write-Host 'WHG Elternportal: lokaler Test. Eingaben werden verdeckt und nicht gespeichert.'
Write-Host 'Bitte Zugangsdaten ausschliesslich hier eingeben, nicht im Chat.'
try {
    $secureUser = Read-Host 'Benutzername' -AsSecureString
    $securePassword = Read-Host 'Passwort' -AsSecureString
    $env:ELTERNPORTAL_USER = [System.Net.NetworkCredential]::new('', $secureUser).Password
    $env:ELTERNPORTAL_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
    $entry = if ($Mcp) { 'check-mcp.mjs' } else { 'test-portal.mjs' }
    & $nodePath (Join-Path $PSScriptRoot $entry)
    Write-Host "Test beendet (Code $LASTEXITCODE). Der Statusbericht enthaelt keine Namen oder Briefinhalte."
} finally {
    Remove-Item Env:ELTERNPORTAL_USER -ErrorAction SilentlyContinue
    Remove-Item Env:ELTERNPORTAL_PASSWORD -ErrorAction SilentlyContinue
    if ($secureUser) { $secureUser.Dispose() }
    if ($securePassword) { $securePassword.Dispose() }
}
Read-Host 'Mit Enter schliessen'
