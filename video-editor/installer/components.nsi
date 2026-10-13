; 영상 편집기 구성 요소 (ffmpeg 7.1 + 얼굴 찾기 모델) — 한 번만 설치하면 돼요
Unicode true
!define APPNAME "영상 편집기"
!define APPID "VideoEditor"
Name "${APPNAME} 구성 요소"
OutFile "out/VideoEditor-components-install.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APPNAME}"
!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} 구성 요소 설치"
!define MUI_WELCOMEPAGE_TEXT "영상 내보내기(ffmpeg 7.1)와 얼굴 찾기(모자이크 따라가기)에 필요한 파일을 설치해요.$\r$\n$\r$\n프로그램을 새 버전으로 바꿀 때는 다시 설치하지 않아도 돼요."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"
VIProductVersion "7.1.0.0"
VIAddVersionKey /LANG=${LANG_KOREAN} "ProductName" "${APPNAME} 구성 요소"
VIAddVersionKey /LANG=${LANG_KOREAN} "FileDescription" "ffmpeg 7.1 + 얼굴 찾기 모델"
VIAddVersionKey /LANG=${LANG_KOREAN} "FileVersion" "7.1"
VIAddVersionKey /LANG=${LANG_KOREAN} "CompanyName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_KOREAN} "LegalCopyright" "FFmpeg: GPL v3 (gyan.dev build), face-api: MIT"
Section "구성 요소"
  nsExec::Exec 'taskkill /IM VideoEditor.exe /F'
  Sleep 300
  SetOutPath "$INSTDIR"
  File "ffmpeg.exe"
  SetOutPath "$INSTDIR\face-model"
  File "../vendor/face/model/ssd_mobilenetv1_model-weights_manifest.json"
  File "../vendor/face/model/ssd_mobilenetv1_model.bin"
  File "../vendor/face/face-api.js"
SectionEnd
