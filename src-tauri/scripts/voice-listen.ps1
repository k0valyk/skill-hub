param(
  [string]$Culture = "en-US",
  [int]$TimeoutMs = 10000,
  [switch]$List
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

$recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()

if ($List) {
  $recognizers | ForEach-Object { Write-Output $_.Culture.Name }
  exit 0
}

$recognizer = $recognizers | Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1
if (-not $recognizer) {
  if ($recognizers.Count -eq 0) {
    [Console]::Error.WriteLine("Windows не має жодного розпізнавача мовлення. Додай мовний пакет у Налаштуваннях Windows.")
  } else {
    $available = ($recognizers | ForEach-Object { $_.Culture.Name }) -join ", "
    [Console]::Error.WriteLine("Немає розпізнавача для '$Culture'. Доступні: $available.")
  }
  exit 2
}

$engine = $null
try {
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizer)
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $engine.LoadGrammar($grammar)
  $engine.SetInputToDefaultAudioDevice()
  $engine.InitialSilenceTimeout = [TimeSpan]::FromMilliseconds([Math]::Min($TimeoutMs, 15000))
  $engine.BabbleTimeout = [TimeSpan]::FromMilliseconds(3000)
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(800)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1000)
  $result = $engine.Recognize([TimeSpan]::FromMilliseconds($TimeoutMs))
  if ($null -eq $result -or [string]::IsNullOrWhiteSpace($result.Text)) {
    [Console]::Error.WriteLine("Мовлення не розпізнано. Спробуй ще раз ближче до мікрофона.")
    exit 3
  }
  Write-Output $result.Text
  exit 0
} catch {
  [Console]::Error.WriteLine("Помилка розпізнавання: " + $_.Exception.Message)
  exit 4
} finally {
  if ($null -ne $engine) { $engine.Dispose() }
}
