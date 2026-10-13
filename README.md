# 영상 편집기 (AI 없는 버전)

AI 영상 편집기 1.5.1에서 스파크 서버를 쓰는 기능(자동 자막, AI 편집, AI 서버 설정)만 뺀 버전이에요.
나머지 기능(컷 편집, 자막, 브금, 장면 전환 58종, 모자이크·확대·자르기, 얼굴 따라가는 모자이크, 속도 조절, 내보내기)은 그대로예요.

## AI 버전과 다른 점

- 프로그램 이름: 영상 편집기 (VideoEditor.exe)
- 설치 위치: %LOCALAPPDATA%\Programs\VideoEditor — AI 버전과 따로 설치돼서 한 PC에 둘 다 둘 수 있어요.
- 설정 폴더: %LOCALAPPDATA%\VideoEditor
- 프로젝트 파일: .vproj (AI 버전의 .aiproj도 열 수 있어요. 형식은 같아요.)
- 내부 주소(스파크 서버)가 코드에 없어요.

## 빌드

필요한 것: Node.js 18+, NSIS(makensis)

    npm ci
    bash scripts/build.sh

결과: dist/VideoEditor.exe, installer/out/VideoEditor-<버전>-install.exe, installer/out/VideoEditor-components-install.exe

## 폴더

- main.mjs — 앱 시작점 (창, WebView2)
- engine.mjs — 영상 서버, ffmpeg 내보내기, 파일 대화상자
- ui.html — 화면 전체
- lib/ — @webviewjs/webview 0.4.7 (MIT)
- vendor/face/ — face-api (MIT)와 SSD MobileNet 얼굴 모델
- installer/ — NSIS 설치 스크립트
