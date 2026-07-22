$ErrorActionPreference = "Stop"

$projectRef = "mxrsmuqyesolkxoqvggl"
$raw = npx supabase projects api-keys --project-ref $projectRef --output json
if ($LASTEXITCODE -ne 0) { throw "No se pudieron consultar las claves publicas de staging." }
$keys = $raw | ConvertFrom-Json
$anon = ($keys | Where-Object { $_.name -eq "anon" } | Select-Object -First 1).api_key
if (-not $anon) { throw "No se encontro la clave publica de staging." }

$env:VITE_SUPABASE_URL = "https://$projectRef.supabase.co"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = $anon
$port = 5181
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "El puerto H101 $port ya esta ocupado."
}

$node = (Get-Command node).Source
$root = Split-Path -Parent $PSScriptRoot
$stdout = Join-Path $root "tmp/h101-vite.out.log"
$stderr = Join-Path $root "tmp/h101-vite.err.log"
$process = Start-Process -FilePath $node `
  -ArgumentList @("node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "$port", "--strictPort") `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

Start-Sleep -Seconds 2
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  throw "La interfaz H101 no quedo escuchando."
}

[pscustomobject]@{
  Started = $true
  Pid = $process.Id
  Port = $port
  Target = "Staging"
} | ConvertTo-Json -Compress
