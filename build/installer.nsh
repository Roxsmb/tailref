; TailRef Studio - NSIS metinleri ve sessiz kurulum değişkeni

!macro customInit
  ReadEnvStr $0 "TailRef_INSTALL_DIR"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "TailRef Studio"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Referans tahtası ve 3D poz stüdyosu kurulacak.$\r$\n$\r$\nKurulum birkaç saniye sürer. İstersen kurulum klasörünü değiştirebilirsin."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_FINISHPAGE_TITLE "Kurulum tamamlandı"
  !define MUI_FINISHPAGE_TEXT "TailRef Studio hazır.$\r$\n$\r$\nTahtanı açıp 3D poz paneliyle çalışmaya başlayabilirsin."
  !insertmacro MUI_PAGE_FINISH
!macroend