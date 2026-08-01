!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Match Session Overlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MatchSessionOverlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Match Session Overlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Match Session Overlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "MatchSessionOverlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.Match Session Overlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SF6 Stream Overlay"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "SF6 Stream Overlay"
    RMDir /r "$LOCALAPPDATA\MatchSessionOverlay"
    RMDir /r "$LOCALAPPDATA\SF6StreamOverlay"
  ${EndIf}
!macroend
