param(port = 8080)
server = Start-Process -FilePath node -ArgumentList 'server.js' -PassThru -NoNewWindow
Start-Sleep 2
try {
  response = Invoke-WebRequest  http://localhost:port/service/sw.js -UseBasicParsing -TimeoutSec 5
  response.Content | Set-Content temp_sw.js
  Get-Content temp_sw.js -TotalCount 5
} catch {
  Write-Error 
} finally {
  if (server -and !server.HasExited) {
    Stop-Process -Id server.Id -Force
  }
  Remove-Item -Force -ErrorAction SilentlyContinue temp_sw.js
}
