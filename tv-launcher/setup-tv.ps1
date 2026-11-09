# ตั้งค่าทีวี Xiaomi Google TV ให้เป็นจอคิว LIS ในครั้งเดียว
# ใช้: powershell -File tv-launcher/setup-tv.ps1 -Device 172.16.31.80:5555 [-Startup qc|lab|home] [-PowerOn 08:00] [-PowerOff 17:00]
# ต้องเปิด "การแก้ไขข้อบกพร่องผ่าน USB" ในตัวเลือกสำหรับนักพัฒนาของทีวี และกดอนุญาตบนจอครั้งแรก
param(
    [Parameter(Mandatory = $true)][string]$Device,
    [ValidateSet("qc", "lab", "home")][string]$Startup = "qc",
    [string]$PowerOn = "08:00",
    [string]$PowerOff = "17:00",
    [switch]$NoSchedule
)
$ErrorActionPreference = "Stop"
$Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$Adb = Join-Path $Sdk "platform-tools\adb.exe"
$Apk = Join-Path $PSScriptRoot "out\lis-home.apk"
$Pkg = "com.icpladda.lis.tv"

if (-not (Test-Path $Apk)) { & (Join-Path $PSScriptRoot "build.ps1") }
& $Adb connect $Device | Out-Host
$state = (& $Adb -s $Device get-state 2>&1) -join ""
if ($state -ne "device") { throw "ทีวี $Device ยังไม่พร้อม ($state) - กดอนุญาตการแก้ไขข้อบกพร่องบนจอทีวีแล้วรันใหม่" }

function Shell([string]$cmd) { & $Adb -s $Device shell $cmd }

Write-Host "ติดตั้งแอป"
& $Adb -s $Device install -r $Apk
if ($LASTEXITCODE) { throw "ติดตั้งไม่สำเร็จ" }

Write-Host "ตั้งเป็นหน้า Home หลัก (ปิดหน้า Home ของ Google TV - เปิดคืนได้ด้วย pm enable)"
Shell "cmd role add-role-holder android.app.role.HOME $Pkg 0"
Shell "pm disable-user --user 0 com.google.android.apps.tv.launcherx"
Shell "pm disable-user --user 0 com.google.android.tungsten.setupwraith"

Write-Host "ให้สิทธิ์ปิด/ปลุกจอตามเวลา"
Shell "dpm set-active-admin --user 0 $Pkg/.AdminReceiver"
Shell "appops set $Pkg TURN_SCREEN_ON allow"
Shell "appops set $Pkg SYSTEM_ALERT_WINDOW allow"

Write-Host "ปิดการพักเครื่อง/ภาพพักหน้าจอ ให้จอเปิดค้างจนถึงเวลาปิด"
Shell "settings put system screen_off_timeout 2147483647"
Shell "settings put secure sleep_timeout -1"
Shell "settings put secure attentive_timeout -1"
Shell "settings put secure screensaver_enabled 0"
Shell "settings put secure screensaver_activate_on_sleep 0"
Shell "settings put secure screensaver_activate_on_dock 0"
Shell "settings put global stay_on_while_plugged_in 7"

$schedule = if ($NoSchedule) { "false" } else { "true" }
Write-Host "ตั้งหน้าเปิดเครื่อง=$Startup เวลาเปิด=$PowerOn ปิด=$PowerOff ใช้ตารางเวลา=$schedule"
Shell "am start -n $Pkg/.MainActivity --es startup $Startup --es power_on $PowerOn --es power_off $PowerOff --ez power_schedule $schedule"
Shell "dumpsys alarm | grep -A2 '$Pkg.POWER' | grep origWhen"
Write-Host "เสร็จแล้ว"
