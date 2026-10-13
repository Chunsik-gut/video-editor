#!/usr/bin/env bash
# Windows용 ffmpeg 7.1(QSV·NVENC·AMF·x264·xfade 포함)을 PyPI의 imageio-ffmpeg 패키지에서 꺼내 installer/ffmpeg.exe 로 둠
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
python3 -m pip download imageio-ffmpeg==0.6.0 --no-deps --only-binary=:all: --platform win_amd64 -d "$TMP" -q
python3 - "$TMP" <<'PY'
import sys, zipfile, glob
whl = glob.glob(sys.argv[1] + '/*.whl')[0]
with zipfile.ZipFile(whl) as z:
    name = [n for n in z.namelist() if n.endswith('.exe') and 'ffmpeg-win' in n][0]
    open('installer/ffmpeg.exe', 'wb').write(z.read(name))
    print('▶ ffmpeg:', name)
PY
rm -rf "$TMP"
