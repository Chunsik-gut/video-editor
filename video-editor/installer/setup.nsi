; 영상 편집기 설치 프로그램 (NSIS)
Unicode true
!define APPNAME "영상 편집기"
!define APPID "VideoEditor"
!ifndef VERSION
  !define VERSION "1.5.1"
!endif
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"

Name "${APPNAME} ${VERSION}"
OutFile "out/VideoEditor-${VERSION}-install.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel user          ; 관리자 권한 없이 설치 (회사 PC에서도 OK)
SetCompressor /SOLID lzma
SetCompressorDictSize 128
BrandingText "${APPNAME} ${VERSION}"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION} 설치"
!define MUI_WELCOMEPAGE_TEXT "영상 편집기를 이 PC에 설치해요.$\r$\n$\r$\n이미 설치돼 있으면 새 버전으로 바꾸고, 프로젝트와 설정은 그대로 둬요.$\r$\n$\r$\n같은 폴더에 ffmpeg.exe와 face-model 폴더가 있으면 함께 설치해요. (구성 요소 설치 파일로 따로 설치해도 돼요)"
!define MUI_FINISHPAGE_RUN "$INSTDIR\VideoEditor.exe"
!define MUI_FINISHPAGE_RUN_TEXT "지금 영상 편집기 실행"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_KOREAN} "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_KOREAN} "FileDescription" "${APPNAME} 설치 프로그램"
VIAddVersionKey /LANG=${LANG_KOREAN} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_KOREAN} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_KOREAN} "CompanyName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_KOREAN} "LegalCopyright" "사내 배포용"

Section "프로그램" SecMain
  SectionIn RO
  ; 켜져 있으면 닫기 (파일을 바꿀 수 있게)
  nsExec::Exec 'taskkill /IM VideoEditor.exe /F'
  Sleep 500
  SetOutPath "$INSTDIR"
  File "../dist/VideoEditor.exe"
  File "icon.ico"
  ; 예전 테스트 버전에서 쓰던 ffmpeg·얼굴 모델이 설치 파일 옆에 있으면 함께 복사
  IfFileExists "$EXEDIR\ffmpeg.exe" 0 +2
    CopyFiles /SILENT "$EXEDIR\ffmpeg.exe" "$INSTDIR\ffmpeg.exe"
  IfFileExists "$EXEDIR\face-model\ssd_mobilenetv1_model.bin" 0 +3
    CreateDirectory "$INSTDIR\face-model"
    CopyFiles /SILENT "$EXEDIR\face-model\*.*" "$INSTDIR\face-model"
  ; AI 영상 편집기가 이미 설치돼 있으면 그 ffmpeg·얼굴 모델을 함께 씀 (구성 요소를 따로 설치하지 않아도 됨)
  IfFileExists "$INSTDIR\ffmpeg.exe" +3 0
  IfFileExists "$LOCALAPPDATA\Programs\AIEditor\ffmpeg.exe" 0 +2
    CopyFiles /SILENT "$LOCALAPPDATA\Programs\AIEditor\ffmpeg.exe" "$INSTDIR\ffmpeg.exe"
  IfFileExists "$INSTDIR\face-model\ssd_mobilenetv1_model.bin" +4 0
  IfFileExists "$LOCALAPPDATA\Programs\AIEditor\face-model\ssd_mobilenetv1_model.bin" 0 +3
    CreateDirectory "$INSTDIR\face-model"
    CopyFiles /SILENT "$LOCALAPPDATA\Programs\AIEditor\face-model\*.*" "$INSTDIR\face-model"

  ; 바로가기
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\VideoEditor.exe" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME} 제거.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\VideoEditor.exe" "" "$INSTDIR\icon.ico" 0

  ; 프로젝트 파일(.vproj) 더블클릭으로 열기
  WriteRegStr HKCU "Software\Classes\.vproj" "" "VideoEditor.Project"
  WriteRegStr HKCU "Software\Classes\VideoEditor.Project" "" "영상 편집기 프로젝트"
  WriteRegStr HKCU "Software\Classes\VideoEditor.Project\DefaultIcon" "" "$INSTDIR\icon.ico,0"
  WriteRegStr HKCU "Software\Classes\VideoEditor.Project\shell\open\command" "" '"$INSTDIR\VideoEditor.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ; [설정 > 앱]에 표시
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 200000

  IfFileExists "$INSTDIR\ffmpeg.exe" +2 0
    MessageBox MB_ICONINFORMATION|MB_OK "영상 내보내기에 필요한 ffmpeg가 아직 없어요.$\r$\n'영상편집기-구성요소-설치.exe'도 실행해 주세요."
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM VideoEditor.exe /F'
  Sleep 500
  Delete "$INSTDIR\VideoEditor.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\ffmpeg.exe"
  RMDir /r "$INSTDIR\face-model"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME} 제거.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKCU "Software\Classes\.vproj"
  DeleteRegKey HKCU "Software\Classes\VideoEditor.Project"
  DeleteRegKey HKCU "${UNINSTKEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
