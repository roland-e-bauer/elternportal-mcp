$ErrorActionPreference = 'Stop'
$secretDir = Join-Path $env:LOCALAPPDATA 'WHGElternportal'
$secretPath = Join-Path $secretDir 'credentials.xml'
$pendingPath = Join-Path $secretDir ('pending-' + [Guid]::NewGuid().ToString() + '.xml')
try {
    Write-Host 'WHG: Zugang fuer Codex einrichten'
    Write-Host 'Beide Eingaben werden mit Windows fuer dein Benutzerkonto verschluesselt gespeichert.'
    Write-Host 'Bitte nur hier eingeben, nicht im Chat.'
    $secureUser = Read-Host 'Benutzername' -AsSecureString
    $securePassword = Read-Host 'Passwort' -AsSecureString
    if ($secureUser.Length -eq 0 -or $securePassword.Length -eq 0) { throw 'Empty input' }
    New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $secretDir -AclObject $acl
    @{ User = $secureUser; Password = $securePassword } | Export-Clixml -LiteralPath $pendingPath
    Write-Host 'Pruefe den gespeicherten Zugang ueber MCP ...'
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    & $nodePath (Join-Path $PSScriptRoot 'secret-launcher.mjs') --secret-path $pendingPath --check
    if ($LASTEXITCODE -ne 0) { throw 'Test failed' }
    Move-Item -LiteralPath $pendingPath -Destination $secretPath -Force
    Write-Host 'ZUGANG GESPEICHERT. Bitte Codex neu starten und WHG-Verbindung pruefen lassen.'
} catch {
    Write-Host 'EINRICHTUNG FEHLGESCHLAGEN. Ein vorhandener Zugang wurde nicht ersetzt.'
    Write-Host 'Bitte nur den Teststatus im Chat teilen, keine Zugangsdaten.'
} finally {
    if (Test-Path -LiteralPath $pendingPath) { Remove-Item -LiteralPath $pendingPath -Force }
    if ($secureUser) { $secureUser.Dispose() }
    if ($securePassword) { $securePassword.Dispose() }
}
Read-Host 'Mit Enter schliessen'

