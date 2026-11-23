$port = 8080
$folder = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$prefix = "http://*:$port/"
try {
    $listener.Prefixes.Add($prefix)
    $listener.Start()
} catch {
    $prefix = "http://localhost:$port/"
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}

$localIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress -First 1)
if (-not $localIp) {
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.)' } | Select-Object -ExpandProperty IPAddress -First 1)
}
if (-not $localIp) { $localIp = "localhost" }

Clear-Host
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   🏁 APEX VELOCITY 3D - MOBILE SERVER IS RUNNING! 🏁" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "APNE MOBILE KE CHROME YA BROWSER ME YE LINK KHOLIYE:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   👉   http://${localIp}:${port}   👈" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host ""
Write-Host "Note: Aapka Mobile aur PC dono SAME Wi-Fi ya Hotspot se jude hone chahiye." -ForegroundColor Gray
Write-Host "Server band karne ke liye is window ko close kar dein." -ForegroundColor DarkYellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$mimeTypes = @{
    ".html" = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($urlPath)) { $urlPath = "index.html" }

        $filePath = Join-Path $folder $urlPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = $mimeTypes[$ext]
            if (-not $mime) { $mime = "application/octet-stream" }
            $response.ContentType = $mime

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    } catch {
        # continue loop
    }
}
