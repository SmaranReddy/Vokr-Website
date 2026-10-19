<#
  Stores one backup credential in Secret Manager from the clipboard, without
  it ever appearing on screen, in history, in a file that outlives the call,
  or in a command-line argument (plan §5 Phase 18; docs/infrastructure/backups.md).

    powershell -File scripts/ops/add-backup-secret.ps1 -Name BACKUP_DATABASE_URL
    powershell -File scripts/ops/add-backup-secret.ps1 -Name R2_BACKUP_ACCESS_KEY_ID
    powershell -File scripts/ops/add-backup-secret.ps1 -Name R2_BACKUP_SECRET_ACCESS_KEY

  1. Copy the value to the clipboard, then run the line for it.
  2. The shape is checked first (so a wrong paste is refused before it is stored);
     only the check's verdict is printed, never the value.
  3. Creates the secret (automatic replication) if it does not exist, adds a
     version with no trailing newline, and clears the clipboard.
  It does not grant anyone access; see the IAM step in backups.md.
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("BACKUP_DATABASE_URL", "R2_BACKUP_ACCESS_KEY_ID", "R2_BACKUP_SECRET_ACCESS_KEY")]
  [string]$Name,
  [string]$Project = "vokr-website"
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
$value = [System.Windows.Forms.Clipboard]::GetText().Trim()
if ([string]::IsNullOrEmpty($value)) { throw "The clipboard is empty. Copy the value first." }

switch ($Name) {
  "BACKUP_DATABASE_URL" {
    if ($value -notmatch '^postgres(ql)?://[^:@/\s]+:[^@\s]+@[^:/\s]+:5432/[^\s?]+(\?\S*)?$') {
      throw "Not a postgresql://USER:PASSWORD@HOST:5432/DB URL (the Supabase session pooler is port 5432; 6543 cannot run pg_dump). Nothing stored."
    }
    if ($value -match 'sslmode=(disable|allow|prefer)') { throw "Use sslmode=require (or leave it out). Nothing stored." }
  }
  "R2_BACKUP_ACCESS_KEY_ID" {
    if ($value -notmatch '^[0-9a-f]{32}$') { throw "An R2 Access Key ID is 32 hex characters. Nothing stored." }
  }
  "R2_BACKUP_SECRET_ACCESS_KEY" {
    if ($value -notmatch '^[0-9a-f]{64}$') { throw "An R2 Secret Access Key is 64 hex characters. Nothing stored." }
  }
}
Write-Host "Shape check passed for $Name."

& gcloud secrets describe $Name --project $Project --format="value(name)" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gcloud secrets create $Name --project $Project --replication-policy=automatic --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create secret $Name." }
  Write-Host "Created secret $Name."
}

# --data-file reads bytes as-is: no trailing newline, and nothing on the command line.
$tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.IO.Path]::GetRandomFileName())
try {
  [System.IO.File]::WriteAllBytes($tmp, [System.Text.Encoding]::UTF8.GetBytes($value))
  $version = & gcloud secrets versions add $Name --project $Project --data-file=$tmp --format="value(name.basename())"
  if ($LASTEXITCODE -ne 0) { throw "gcloud secrets versions add failed for $Name." }
  Write-Host "Stored $Name version $version."
} finally {
  if (Test-Path $tmp) { Remove-Item -Force $tmp }
  [System.Windows.Forms.Clipboard]::Clear()
  $value = $null
}
