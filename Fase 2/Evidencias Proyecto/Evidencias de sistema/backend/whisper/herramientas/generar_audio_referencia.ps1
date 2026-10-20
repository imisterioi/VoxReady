# Genera audio de referencia en espanol con la voz instalada en Windows (SAPI) y el
# archivo `referencias.tsv` (archivo<TAB>texto) con el texto exacto de cada muestra.
#
#   Uso:  powershell -ExecutionPolicy Bypass -File backend\whisper\herramientas\generar_audio_referencia.ps1
#         powershell ... -Destino C:\voxready-muestras -Ritmo -1 -SilencioEnBordes
#
# El texto que se sintetiza ES la referencia para calcular WER/CER con eval_whisper.py, asi
# que no hay que inventar ninguna transcripcion. Ojo: es voz sintetica (audio limpio), util
# para comparar configuraciones entre si; para conclusiones sobre voz humana hay que usar
# grabaciones reales de VoxReady y su transcripcion de referencia revisada a mano.
#
# Los textos viven en `referencias_voxready.txt` (UTF-8) para no depender de la codificacion
# del propio script: PowerShell 5.1 lee los .ps1 sin BOM como ANSI y corromperia los acentos.

param(
  [string]$Destino = (Join-Path (Split-Path -Parent $PSScriptRoot) 'muestras'),
  [string]$Voz = 'Microsoft Sabina Desktop',
  [int]$Ritmo = -1,
  [switch]$SilencioEnBordes
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

$origen = Join-Path $PSScriptRoot 'referencias_voxready.txt'
if (-not (Test-Path $origen)) { throw "No se encontro $origen" }
$muestras = Get-Content -Path $origen -Encoding UTF8 | Where-Object { $_.Trim() -and -not $_.StartsWith('#') }

$sintetizador = New-Object System.Speech.Synthesis.SpeechSynthesizer
$disponibles = $sintetizador.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
if ($disponibles -notcontains $Voz) {
  throw "La voz '$Voz' no esta instalada. Voces disponibles: $($disponibles -join ', ')"
}
$sintetizador.SelectVoice($Voz)
$sintetizador.Rate = $Ritmo

$lineas = New-Object System.Collections.Generic.List[string]
foreach ($linea in $muestras) {
  $partes = $linea.Split('|', 2)
  if ($partes.Count -ne 2) { throw "Linea sin formato 'archivo|texto': $linea" }
  $archivo = $partes[0].Trim()
  $texto = $partes[1].Trim()
  $ruta = Join-Path $Destino $archivo

  $sintetizador.SetOutputToWaveFile($ruta)
  if ($SilencioEnBordes) {
    # Con silencio a proposito al inicio y al final: sirve para comprobar que el filtro de
    # voz (VAD) recorta el silencio pero NO las palabras pronunciadas.
    $ssml = "<speak version='1.0' xml:lang='es-MX'><break time='900ms'/>$texto<break time='900ms'/></speak>"
    $sintetizador.SpeakSsml($ssml)
  } else {
    $sintetizador.Speak($texto)
  }
  $sintetizador.SetOutputToNull()
  $lineas.Add("$archivo`t$texto")
  Write-Output "generado: $archivo"
}

$referencias = Join-Path $Destino 'referencias.tsv'
Set-Content -Path $referencias -Value $lineas -Encoding UTF8
Write-Output "referencias: $referencias"