param([Parameter(Mandatory=$true)][string]$SecretPath)
$ErrorActionPreference = 'Stop'
try {
    $secrets = Import-Clixml -LiteralPath $SecretPath
    if ($secrets.User -isnot [Security.SecureString] -or $secrets.Password -isnot [Security.SecureString]) { throw 'Invalid secret' }
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    @{ user = [Net.NetworkCredential]::new('', $secrets.User).Password; password = [Net.NetworkCredential]::new('', $secrets.Password).Password } | ConvertTo-Json -Compress
} catch { exit 1 }
finally {
    if ($secrets.User -is [Security.SecureString]) { $secrets.User.Dispose() }
    if ($secrets.Password -is [Security.SecureString]) { $secrets.Password.Dispose() }
}
