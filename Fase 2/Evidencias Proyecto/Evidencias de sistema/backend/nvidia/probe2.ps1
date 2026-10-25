# Reintento controlado de los ASR de NVCF (máx. 2 intentos por modelo, espera entre ellos).
# Guarda stdout/stderr REDACTADOS (cualquier nvapi-... se sustituye) para diagnosticar NO_JSON.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location 'C:\Users\a\Documents\GitHub\VoxReady\Fase 2\Evidencias Proyecto\Evidencias de sistema'
$keyLine = Get-Content 'backend\.env.local' | Where-Object { $_ -match '^NVIDIA_API_KEY=' }
$env:NVIDIA_API_KEY = ($keyLine -split '=', 2)[1].Trim()
$file = 'backend\uploads\sessions\132f9e81-fc1d-4e81-a31f-aa0ff35b1d6b.audio.webm'
$models = @(
  @{ k = 'parakeet-ctc-0_6b-es'; id = 'a9eeee8f-b509-4712-b19d-194361fa5f31'; lang = 'es-US' },
  @{ k = 'parakeet-1_1b-rnnt-multilingual'; id = '71203149-d3b7-4460-8231-1be2543a1fca'; lang = 'es-US' },
  @{ k = 'conformer-ctc-asr'; id = '50124cf2-fb60-4a8c-9d25-d85b85199526'; lang = 'es-US' }
)
function Redact($text) {
  if (-not $text) { return '' }
  return ($text -join "`n") -replace 'nvapi-[A-Za-z0-9_\-]+', 'nvapi-***' -replace 'Bearer\s+\S+', 'Bearer ***'
}
$out = @()
foreach ($m in $models) {
  $attempts = @()
  for ($i = 1; $i -le 2; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $raw = & python 'backend\nvidia\asr_client.py' --function-id $m.id --language $m.lang --input-file $file 2>&1
    $sw.Stop()
    $json = ($raw | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
    $j = $null
    if ($json) { try { $j = $json | ConvertFrom-Json } catch { } }
    $attempts += [pscustomobject]@{
      attempt   = $i
      wallMs    = $sw.ElapsedMilliseconds
      ok        = [bool]($j -and $j.ok)
      code      = if ($j) { $j.code } else { 'NO_JSON' }
      chars     = if ($j -and $j.text) { $j.text.Length } else { 0 }
      elapsedMs = if ($j) { $j.elapsedMs } else { $null }
      text      = if ($j) { $j.text } else { $null }
      message   = Redact $j.message
      rawTail   = Redact ($raw | Select-Object -Last 6)
    }
    if ($j -and $j.ok) { break }
    Start-Sleep -Seconds 20
  }
  $out += [pscustomobject]@{ model = $m.k; attempts = $attempts }
}
$out | ConvertTo-Json -Depth 6 | Set-Content "$env:TEMP\probe2-results.json" -Encoding UTF8
