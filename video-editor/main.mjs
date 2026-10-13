// 영상 편집기 (Windows)
// 창과 WebView2를 띄우고, 화면(ui.html)에 시스템 정보·글꼴 목록·파일 저장 기능을 제공한다.
const T_PROC0 = Date.now() - Math.round(process.uptime() * 1000);   // 프로그램이 켜진 시각 (시작 시간 기록용)
const startMarks = { moduleStart: Date.now() - T_PROC0 };
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import html from './ui.html' with { type: 'text' };
// 얼굴 찾기(face-api)와 모델은 exe 옆 face-model 폴더에서 읽어 app://localhost/vendor/... 로 화면에 줌 (구성 요소 설치 파일이 넣어 줌)
const MODEL_DIR = () => path.join(path.dirname(process.execPath), 'face-model');
const VENDOR = {
  '/vendor/face/face-api.js': [() => path.join(MODEL_DIR(), 'face-api.js'), 'text/javascript; charset=utf-8'],
  '/vendor/face/model/ssd_mobilenetv1_model-weights_manifest.json': [() => path.join(MODEL_DIR(), 'ssd_mobilenetv1_model-weights_manifest.json'), 'application/json'],
  '/vendor/face/model/ssd_mobilenetv1_model.bin': [() => path.join(MODEL_DIR(), 'ssd_mobilenetv1_model.bin'), 'application/octet-stream'],
};
import { Application, getWebviewVersion } from './lib/index.js';
import * as engine from './engine.mjs';

const APP_VERSION = '1.5.1';  // AI 없는 버전
const app = new Application();
startMarks.appCreated = Date.now() - T_PROC0;
const win = app.createBrowserWindow({
  title: `영상 편집기 ${APP_VERSION}`,
  width: 1440,
  height: 900,
  maximized: true,
  windowsDragAndDrop: false, // 화면 안에서 HTML 드래그 앤 드롭으로 파일을 받기 위해 끔
});
startMarks.windowCreated = Date.now() - T_PROC0;

win.registerProtocol('app', async (req) => {
  let pathname = '/';
  try { pathname = new URL(req.url).pathname; } catch { /* 기본 화면 */ }
  const v = VENDOR[pathname];
  if (v) {
    try { return new Response(await Bun.file(v[0]()).arrayBuffer(), { headers: { 'Content-Type': v[1] } }); }
    catch { return new Response('not found', { status: 404 }); }
  }
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

// CPU 사용률: 직전 호출과의 차이로 계산
let prevCpu = null;
function cpuPercent() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  let pct = null;
  if (prevCpu) {
    const dt = total - prevCpu.total;
    const di = idle - prevCpu.idle;
    if (dt > 0) pct = Math.max(0, Math.min(100, 100 * (1 - di / dt)));
  }
  prevCpu = { idle, total };
  return pct;
}
cpuPercent();

let webviewVersion = null;
try { webviewVersion = getWebviewVersion(); } catch { webviewVersion = null; }

// PC에 설치된 글꼴 목록 (윈도우: PowerShell로 한 번만 읽고 저장)
let fontsPromise = null;
// 글꼴 목록은 PowerShell이 느려서(HDD에서 수 초) 저장해 둔 목록을 바로 쓰고, 조금 뒤 조용히 새로 읽어 저장함
function readFontsPS() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const script =
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
      'Add-Type -AssemblyName System.Drawing;' +
      '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const names = [...new Set(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
        resolve(names);
      },
    );
  });
}
function listFonts() {
  if (fontsPromise) return fontsPromise;
  let cached = null;
  try { const c = engine.getSettings().fonts; if (Array.isArray(c) && c.length) cached = c; } catch { /* 없음 */ }
  const fresh = () => readFontsPS().then((names) => { if (names.length) { try { engine.setSettings({ fonts: names }); } catch { /* 무시 */ } } return names; });
  if (cached) {
    fontsPromise = Promise.resolve(cached);
    setTimeout(() => { fresh().catch(() => {}); }, 20000);   // 새 글꼴을 설치했을 수도 있으니 나중에 새로 읽어 둠 (다음 실행부터 반영)
  } else fontsPromise = fresh();
  return fontsPromise;
}
setTimeout(() => listFonts(), 1500); // 화면이 먼저 뜨도록 조금 뒤에 읽기 시작

// 텍스트 파일을 다운로드 폴더에 저장 (같은 이름이 있으면 번호를 붙임)
function saveText(name, text) {
  const safe = String(name || 'subtitle.srt').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  let dir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) dir = os.homedir();
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let target = path.join(dir, safe);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`);
  fs.writeFileSync(target, '﻿' + String(text), 'utf8');
  return target;
}

startMarks.beforeWebview = Date.now() - T_PROC0;
const webview = win.createWebview({
  url: 'app://localhost/index.html',
  enableDevtools: false,
  hotkeysZoom: false,
  autoplay: true,
  clipboard: true,
});

startMarks.webviewCreated = Date.now() - T_PROC0;
// 끝내기: 창을 바로 숨기고, 돌던 ffmpeg 작업을 멈춘 뒤 곧바로 종료 (화면 엔진 정리를 기다리지 않음)
let quitting = false;
function quit() {
  if (quitting) return true;
  quitting = true;
  try { win.setVisible(false); } catch { /* 무시 */ }
  try { engine.shutdownAll(); } catch { /* 무시 */ }
  setTimeout(() => process.exit(0), 30);
  return true;
}

webview.expose('native', {
  isNative: true,
  version: APP_VERSION,
  sysInfo: () => {
    const cpus = os.cpus();
    return {
      cpuModel: cpus[0] ? cpus[0].model.trim() : '',
      cpuThreads: cpus.length,
      cpuPercent: cpuPercent(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      hostRss: process.memoryUsage().rss,
      osRelease: os.release(),
      webviewVersion,
    };
  },
  listFonts: () => listFonts(),
  saveText: (name, text) => saveText(name, text),
  quit: () => quit(),
  // 영상 가져오기: 윈도우 파일 선택 창 → 경로를 로컬 영상 서버에 등록해 재생 주소를 돌려줌
  pickVideos: async (single) => {
    let paths = win.openFileDialog({
      multiple: !single,
      title: single ? '파일 다시 연결' : '영상·브금 가져오기',
      filters: [
        { name: '영상·음악', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'mts', 'm2ts', 'ts', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'] },
        { name: '영상', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'mts', 'm2ts', 'ts'] },
        { name: '음악', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });
    paths = await paths;
    return (paths || []).filter(Boolean).map((p) => engine.registerFile(p));
  },
  ffmpegInfo: () => engine.findFfmpeg(true),
  probeAudio: (p) => engine.probeAudio(p),
  // 프로젝트 파일
  openProjectDialog: async () => {
    const r = await win.openFileDialog({ multiple: false, title: '프로젝트 열기', filters: [{ name: '영상 편집기 프로젝트', extensions: ['vproj', 'aiproj'] }] });
    return (r && r[0]) || null;
  },
  saveProjectDialog: (name, dir) => engine.saveFileDialog({ title: '프로젝트 저장', name, dir: dir || engine.projectDir(), ext: 'vproj', filterName: '영상 편집기 프로젝트' }),
  writeTextFile: (p, text) => engine.writeTextFile(p, text),
  readTextFile: (p) => engine.readTextFile(p),
  statPaths: (list) => engine.statPaths(list),
  registerFile: (p) => engine.registerFile(p),
  setDirty: (v) => { dirty = !!v; return true; },
  forceQuit: () => { dirty = false; return quit(); },
  exportDefaults: () => engine.exportDefaults(),
  pickFolder: (initial) => {
    let hwnd = 0;
    try { hwnd = win.getNativeHandle(); } catch { hwnd = 0; }
    return engine.pickFolder(String(hwnd), initial);
  },
  exportStart: (spec) => engine.exportStart(spec),
  exportStatus: () => engine.exportStatus(),
  exportCancel: () => engine.exportCancel(),
  // 프로젝트 파일(.vproj)을 더블클릭해서 켠 경우 그 경로
  startupInfo: () => ({ ...startMarks, now: Date.now() - T_PROC0, procStart: T_PROC0 }),
  logStartup: (o) => engine.logStartup(o),
  startupProject: () => process.argv.slice(1).find((a) => /\.(vproj|aiproj)$/i.test(a) && fs.existsSync(a)) || null,
  getSettings: () => engine.getSettings(),
  setSettings: (o) => engine.setSettings(o),
  openFolder: (p) => engine.openFolder(p),
  uploadBegin: (name, size) => engine.uploadBegin(name, size),
  uploadChunk: (id, b64) => engine.uploadChunk(id, b64),
  uploadEnd: (id) => engine.uploadEnd(id),
});

// 저장하지 않은 변경이 있으면 창을 바로 닫지 않고 화면에 물어봄
let dirty = false;
win.on('close', (e) => {
  e.preventDefault();
  if (!dirty) { quit(); return; }
  try { webview.evaluateScript('window.__askClose && window.__askClose()'); } catch { /* 무시 */ }
});
app.on('application-close-requested', () => quit());

app.run();
