# 사용한 오픈소스

| 이름 | 쓰는 곳 | 라이선스 |
|---|---|---|
| [Bun](https://bun.sh) 1.4.2 | exe로 묶기·실행 | MIT |
| [@webviewjs/webview](https://www.npmjs.com/package/@webviewjs/webview) 0.4.7 (`lib/`) | 창·WebView2 | MIT |
| [FFmpeg](https://ffmpeg.org) 7.1 (gyan.dev 빌드, imageio-ffmpeg 패키지에서 받음) | 내보내기·소리 추출 (별도 실행 파일로 함께 배포) | GPL v3 |
| [face-api (@vladmandic/face-api)](https://github.com/vladmandic/face-api) 1.7.15 (`vendor/face/`) | 얼굴 찾기 (TensorFlow.js 포함) | MIT |
| SSD MobileNet v1 얼굴 모델 (face-api 포함) | 얼굴 찾기 | MIT |
| [OpenAI Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) | 스파크 서버 자동 자막 | MIT |
| [Hugging Face Transformers](https://github.com/huggingface/transformers) | 스파크 서버 | Apache 2.0 |
| [NSIS](https://nsis.sourceforge.io) | 설치 파일 | zlib/libpng |

FFmpeg는 프로그램과 따로 실행되는 파일로 함께 설치돼요. GPL에 따라 FFmpeg 소스는 https://ffmpeg.org 에서 받을 수 있어요.
