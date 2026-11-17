# Puts a "Friends Feuuud" icon on your desktop that starts the whole game.
# Run once with:  npm run shortcut

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'Start Friends Feuuud.cmd'
$icon = Join-Path $root 'public\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'Friends Feuuud.lnk'

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
# Going through cmd.exe (rather than pointing at the .cmd directly) lets
# Windows pin the shortcut to the taskbar or Start menu.
$s.TargetPath = $env:ComSpec
$s.Arguments = "/c `"`"$launcher`"`""
$s.WorkingDirectory = $root
$s.IconLocation = "$icon,0"
$s.Description = 'Start Friends Feuuud and open the big screen'
$s.Save()

Write-Host "Shortcut created: $link"
