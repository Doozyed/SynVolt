; The executable name is shared with other Tauri projects. Check its Windows
; product name before stopping it, then wait for Windows to release the file.
!macro StopSynVolt
  nsExec::ExecToStack `"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process -Name 'tauri-app' -ErrorAction SilentlyContinue | Where-Object { $$_.Product -eq 'SynVolt' } | ForEach-Object { try { $$_.Kill(); $$_.WaitForExit() } catch { if (-not $$_.HasExited) { exit 1 } } }; exit 0"`
  Pop $0
  Pop $1
  ${If} $0 != 0
    Abort "Windows could not stop SynVolt."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro StopSynVolt
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro StopSynVolt
!macroend
