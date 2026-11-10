# Build LIS Home (Android TV launcher) เป็น APK ด้วย Android SDK โดยตรง ไม่ต้องใช้ Gradle
# ใช้: powershell -File tv-launcher/build.ps1 [-Install 172.16.31.80:5555]
param([string]$Install = "")
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$BuildTools = Get-ChildItem (Join-Path $Sdk "build-tools") | Sort-Object { [version]($_.Name -replace '[^0-9.]', '') } | Select-Object -Last 1
$Bt = $BuildTools.FullName
$AndroidJar = Get-ChildItem (Join-Path $Sdk "platforms") -Filter android.jar -Recurse | Sort-Object FullName | Select-Object -Last 1
$Adb = Join-Path $Sdk "platform-tools\adb.exe"
$Jdk = @("C:\Program Files\Android\Android Studio\jbr", $env:JAVA_HOME) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\javac.exe")) } | Select-Object -First 1
$Javac = if ($Jdk) { Join-Path $Jdk "bin\javac.exe" } else { "javac" }
$Keytool = if ($Jdk) { Join-Path $Jdk "bin\keytool.exe" } else { "keytool" }
if ($Jdk) { $env:JAVA_HOME = $Jdk; $env:PATH = (Join-Path $Jdk "bin") + ";" + $env:PATH }

$Out = Join-Path $Root "out"
if (Test-Path $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
New-Item -ItemType Directory -Path "$Out\gen", "$Out\classes", "$Out\dex" | Out-Null

& "$Bt\aapt2.exe" compile --dir "$Root\res" -o "$Out\res.zip"
if ($LASTEXITCODE) { throw "aapt2 compile failed" }
& "$Bt\aapt2.exe" link -o "$Out\unsigned.apk" -I $AndroidJar.FullName --manifest "$Root\AndroidManifest.xml" --java "$Out\gen" --auto-add-overlay "$Out\res.zip"
if ($LASTEXITCODE) { throw "aapt2 link failed" }

$Sources = @(Get-ChildItem "$Root\src", "$Out\gen" -Recurse -Filter *.java | ForEach-Object FullName)
& $Javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -classpath $AndroidJar.FullName -d "$Out\classes" @Sources
if ($LASTEXITCODE) { throw "javac failed" }
$Classes = @(Get-ChildItem "$Out\classes" -Recurse -Filter *.class | ForEach-Object FullName)
& "$Bt\d8.bat" --min-api 21 --lib $AndroidJar.FullName --output "$Out\dex" @Classes
if ($LASTEXITCODE) { throw "d8 failed" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$Zip = [System.IO.Compression.ZipFile]::Open("$Out\unsigned.apk", "Update")
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Zip, "$Out\dex\classes.dex", "classes.dex") | Out-Null
$Zip.Dispose()

& "$Bt\zipalign.exe" -f -p 4 "$Out\unsigned.apk" "$Out\aligned.apk"
if ($LASTEXITCODE) { throw "zipalign failed" }

# ใช้ debug keystore เดิมของเครื่องเพื่อให้ติดตั้งทับเวอร์ชันเก่าได้
$KeyStore = Join-Path $env:USERPROFILE ".android\debug.keystore"
if (-not (Test-Path $KeyStore)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $KeyStore) | Out-Null
    & $Keytool -genkeypair -keystore $KeyStore -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
}
$Apk = Join-Path $Out "lis-home.apk"
& "$Bt\apksigner.bat" sign --ks $KeyStore --ks-pass pass:android --key-pass pass:android --out $Apk "$Out\aligned.apk"
if ($LASTEXITCODE) { throw "apksigner failed" }
Write-Host "APK: $Apk"

if ($Install) {
    & $Adb connect $Install | Out-Host
    & $Adb -s $Install install -r $Apk
    if ($LASTEXITCODE) { throw "adb install failed" }
}
