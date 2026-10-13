// 영상 서버 + 내보내기 엔진 (앱 쪽). 화면(ui.html)이 window.native 로 부른다.
// - 가져온 영상 파일을 127.0.0.1 로컬 서버로 내보내 화면에서 재생 (범위 요청 지원)
// - ffmpeg 로 편집 결과를 MP4로 내보내기 (진행률, 취소, Quick Sync 실패 시 x264로 자동 전환)
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import pickerCs from './folderpicker.cs' with { type: 'text' };

const isWin = process.platform === 'win32';

// ───────── 로컬 영상 서버 ─────────
const served = new Map(); // token -> { path, size }
const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/webm', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv', '.mts': 'video/mp2t', '.m2ts': 'video/mp2t', '.ts': 'video/mp2t' };
let server = null;
function startServer() {
  if (server) return server;
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      const tok = u.pathname.split('/')[2] || '';
      const f = served.get(tok);
      const base = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' };
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: base });
      if (!f) return new Response('not found', { status: 404, headers: base });
      let size;
      try { size = fs.statSync(f.path).size; } catch { return new Response('gone', { status: 404, headers: base }); }
      const headers = { ...base, 'Accept-Ranges': 'bytes', 'Content-Type': MIME[path.extname(f.path).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      const file = Bun.file(f.path);
      const range = req.headers.get('range');
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (!m) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
        let start, end;
        if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
        else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
        return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      if (req.method === 'HEAD') return new Response(null, { headers: { ...headers, 'Content-Length': String(size) } });
      return new Response(file, { headers: { ...headers, 'Content-Length': String(size) } });
    },
  });
  return server;
}
export function registerFile(p) {
  startServer();
  const st = fs.statSync(p);
  const token = crypto.randomBytes(12).toString('hex');
  served.set(token, { path: p });
  return { path: p, name: path.basename(p), size: st.size, url: `http://127.0.0.1:${server.port}/m/${token}/${encodeURIComponent(path.basename(p))}` };
}

// ───────── 끌어다 놓은 영상 복사 (화면에 경로가 없을 때, 내보내기 직전에만) ─────────
const uploads = new Map();
function cacheDir() {
  const base = isWin ? (process.env.LOCALAPPDATA || os.tmpdir()) : os.tmpdir();
  const d = path.join(base, 'VideoEditor', 'imported');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function uploadBegin(name, size) {
  const id = crypto.randomBytes(8).toString('hex');
  const safe = String(name || 'video').replace(/[\\/:*?"<>|]/g, '_');
  const target = path.join(cacheDir(), `${id}_${safe}`);
  uploads.set(id, { fd: fs.openSync(target, 'w'), target, size, written: 0 });
  return id;
}
export function uploadChunk(id, b64) {
  const u = uploads.get(id); if (!u) throw new Error('upload not found');
  const buf = Buffer.from(b64, 'base64');
  fs.writeSync(u.fd, buf); u.written += buf.length;
  return u.written;
}
export function uploadEnd(id) {
  const u = uploads.get(id); if (!u) throw new Error('upload not found');
  fs.closeSync(u.fd); uploads.delete(id);
  return u.target;
}

// ───────── ffmpeg 찾기 ─────────
let ffInfo = null;
const run = (bin, args, timeout = 15000) => new Promise((res) => {
  execFile(bin, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => res({ err, out: String(stdout || ''), errOut: String(stderr || '') }));
});
export async function findFfmpeg(force) {
  if (ffInfo && !force) return ffInfo;
  const exe = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const dir = path.dirname(process.execPath);
  const cands = [process.env.AIEDITOR_FFMPEG, path.join(dir, exe), path.join(dir, 'ffmpeg', exe), path.join(dir, 'ffmpeg', 'bin', exe), path.join(process.cwd(), exe), exe].filter(Boolean);
  for (const c of cands) {
    if (c !== exe && !fs.existsSync(c)) continue;
    const v = await run(c, ['-hide_banner', '-version']);
    if (v.err) continue;
    const enc = await run(c, ['-hide_banner', '-encoders']);
    const list = enc.out;
    const flt = await run(c, ['-hide_banner', '-filters']);
    ffInfo = {
      found: true, path: c,
      version: (v.out.split('\n')[0] || '').replace('ffmpeg version ', '').split(' ')[0],
      // AIEDITOR_FORCE_QSV: Quick Sync 실패 → CPU 전환을 시험할 때만 씀
      qsv: /\bh264_qsv\b/.test(list) || !!process.env.AIEDITOR_FORCE_QSV,
      nvenc: /\bh264_nvenc\b/.test(list), amf: /\bh264_amf\b/.test(list), x264: /\blibx264\b/.test(list),
      xfade: /\bxfade\b/.test(flt.out), // 장면 전환 효과 (ffmpeg 4.3 이상)
    };
    return ffInfo;
  }
  ffInfo = { found: false, searched: cands.filter((c) => c !== exe) };
  return ffInfo;
}

// ───────── 내보내기 ─────────
let job = null; // 진행 중이거나 마지막 작업
const fmtTime = (t) => Math.max(0, t).toFixed(3);
function defaultOutDir() {
  const h = os.homedir();
  for (const d of [path.join(h, 'Videos'), path.join(h, 'Downloads'), h]) if (fs.existsSync(d)) return d;
  return h;
}
export function exportDefaults() { return { outDir: defaultOutDir() }; }
function uniquePath(dir, name) {
  const safe = String(name || 'export').replace(/[\\/:*?"<>|]/g, '_').replace(/\.mp4$/i, '').slice(0, 120) || 'export';
  let p = path.join(dir, safe + '.mp4');
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${safe} (${i}).mp4`);
  return p;
}
export async function probeAudio(p) { const ff = await findFfmpeg(); if (!ff.found) return null; try { return await hasAudio(ff.path, p); } catch { return null; } }
async function hasAudio(ff, p) {
  const r = await run(ff, ['-hide_banner', '-i', p], 20000);
  return /Stream #\d+:\d+.*: Audio:/.test(r.errOut);
}
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
// ffmpeg xfade 전환 이름 (화면 쪽 목록과 같아야 함)
export const XFADE = new Set(('fade fadeblack fadewhite fadegrays fadefast fadeslow dissolve distance ' +
  'wipeleft wiperight wipeup wipedown wipetl wipetr wipebl wipebr slideleft slideright slideup slidedown ' +
  'coverleft coverright coverup coverdown revealleft revealright revealup revealdown ' +
  'smoothleft smoothright smoothup smoothdown diagtl diagtr diagbl diagbr hlwind hrwind vuwind vdwind ' +
  'hlslice hrslice vuslice vdslice radial circlecrop rectcrop circleopen circleclose vertopen vertclose horzopen horzclose ' +
  'pixelize hblur squeezeh squeezev zoomin').split(' '));

// job 스펙: { name, outDir, width, height, fps, quality:'high'|'normal'|'small', encoder:'auto'|'cpu',
//            segments:[{path, srcIn, srcOut}], subtitles:[{png(base64), x, y, start, end}] }
export async function exportStart(spec) {
  if (job && job.state === 'running') throw new Error('이미 내보내는 중이에요');
  const ff = await findFfmpeg();
  if (!ff.found) throw new Error('ffmpeg.exe를 찾지 못했어요. 프로그램과 같은 폴더에 넣어 주세요.');
  if (!spec.segments || !spec.segments.length) throw new Error('내보낼 클립이 없어요');
  const usesTr = !!(spec.trIn && spec.trIn.dur > 0) || spec.segments.some((s) => s.tr && s.tr.dur > 0);
  if (usesTr && !ff.xfade) throw new Error(`장면 전환 효과를 내보내려면 새 ffmpeg(7.x)가 필요해요. 지금 ffmpeg는 ${ff.version} 버전이에요.`);
  let outDir = String(spec.outDir || '').trim() || defaultOutDir();
  if (!fs.existsSync(outDir)) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch { throw new Error(`저장 폴더를 만들 수 없어요: ${outDir}`); }
  }
  try { fs.accessSync(outDir, fs.constants.W_OK); } catch { throw new Error(`저장 폴더에 쓸 수 없어요: ${outDir}`); }
  const outPath = uniquePath(outDir, spec.name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aieditor-export-'));
  const W = even(spec.width), H = even(spec.height), F = spec.fps || 30;
  const spdOf = (s) => (Number(s.speed) > 0 ? Number(s.speed) : 1);
  const total = spec.segments.reduce((a, s) => a + (s.srcOut - s.srcIn) / spdOf(s), 0);
  job = { id: crypto.randomBytes(6).toString('hex'), state: 'running', pct: 0, outPath, tmp, total, started: Date.now(), log: [], encoder: null, proc: null, cancelled: false, step: '준비 중' };
  const myJob = job;
  (async () => {
    try {
      // 오디오 유무 확인 (파일마다 한 번)
      const audioMap = new Map();
      for (const s of spec.segments) if (!audioMap.has(s.path)) audioMap.set(s.path, await hasAudio(ff.path, s.path));
      const extra = [];   // 분리된 소리 (A2): 소리가 있는 것만
      for (const x of spec.audios || []) {
        if (!audioMap.has(x.path)) audioMap.set(x.path, await hasAudio(ff.path, x.path));
        if (audioMap.get(x.path) && x.srcOut - x.srcIn > 0.01) extra.push(x);
      }
      // 자막 PNG 저장
      const subs = (spec.subtitles || []).map((s, i) => { const p = path.join(tmp, `sub_${i}.png`); fs.writeFileSync(p, Buffer.from(s.png, 'base64')); return { ...s, file: p }; });
      // 영역 효과: 원형 마스크·스포트라이트 그림 저장, 움직이는 영역은 sendcmd 명령 파일로
      const fxList = (spec.fx || []).map((f, i) => {
        const g = { ...f };
        if (f.mask) { g.maskFile = path.join(tmp, `fxmask_${i}.png`); fs.writeFileSync(g.maskFile, Buffer.from(f.mask, 'base64')); }
        if (f.spot) { g.spotFile = path.join(tmp, `fxspot_${i}.png`); fs.writeFileSync(g.spotFile, Buffer.from(f.spot, 'base64')); }
        return g;
      });
      const cmdLines = [];
      const build = (encoder) => {
        const args = ['-hide_banner', '-y', '-nostdin'];
        // 장면 전환: 앞 클립은 컷 뒤로 d/2, 뒤 클립은 컷 앞으로 d/2만큼 더 필요함.
        // 원본에 여유분이 있으면 그걸 쓰고, 모자라면 첫/끝 프레임을 멈춰서 채움(tpad). 타임라인 길이는 그대로.
        const nS = spec.segments.length;
        const trOf = (i) => { const t = spec.segments[i] && spec.segments[i].tr; return t && t.dur > 0 && XFADE.has(t.type) ? t : null; };
        // 속도: 타임라인 길이 = 원본 길이 / 속도. 전환 여유분도 원본에서는 속도만큼 더 필요함
        // 거꾸로: 메모리를 아끼려고 원본을 2초씩 나눠 각각 뒤집은 뒤 뒤쪽 조각부터 이어 붙임 (전환 여유분은 멈춘 장면으로)
        const ext = spec.segments.map((s, i) => {
          const sp = spdOf(s), srcLen = s.srcOut - s.srcIn, len = srcLen / sp;
          const hn = i > 0 && trOf(i - 1) ? trOf(i - 1).dur / 2 : 0;
          const tn = i < nS - 1 && trOf(i) ? trOf(i).dur / 2 : 0;
          const fileDur = Number(s.dur) > 0 ? Number(s.dur) : s.srcOut;
          const preS = s.rev ? 0 : Math.min(hn * sp, Math.max(0, s.srcIn));
          const postS = s.rev ? 0 : Math.min(tn * sp, Math.max(0, fileDur - s.srcOut));
          const realPre = preS / sp, realPost = postS / sp;
          return { sp, srcLen, len, hn, tn, preS, postS, realPre, realPost, padPre: hn - realPre, padPost: tn - realPost };
        });
        let inCount = 0;
        const segIn = spec.segments.map((s, i) => {
          const e = ext[i];
          if (!s.rev) { args.push('-ss', fmtTime(s.srcIn - e.preS), '-t', fmtTime(e.preS + e.srcLen + e.postS), '-i', s.path); return [{ idx: inCount++ }]; }
          const parts = [];
          for (let c = s.srcOut; c > s.srcIn + 1e-4; c -= 2) {
            const a = Math.max(s.srcIn, c - 2);
            args.push('-ss', fmtTime(a), '-t', fmtTime(c - a), '-i', s.path); parts.push({ idx: inCount++, len: c - a });
          }
          return parts;
        });
        const nSeg = inCount;   // 영상 클립 입력 개수 (거꾸로 클립은 조각 수만큼)
        extra.forEach((x) => { args.push('-ss', fmtTime(x.srcIn), '-t', fmtTime(x.srcOut - x.srcIn), '-i', x.path); });
        const nAud = extra.length;
        subs.forEach((s) => args.push('-i', s.file));
        // 효과용 그림 입력 (영상 길이만큼 반복)
        let nextIn = nSeg + extra.length + subs.length;
        for (const g of fxList) {
          if (g.maskFile) { args.push('-loop', '1', '-framerate', String(F), '-t', fmtTime(total), '-i', g.maskFile); g.maskIn = nextIn++; }
          if (g.spotFile) { args.push('-loop', '1', '-framerate', String(F), '-t', fmtTime(total), '-i', g.spotFile); g.spotIn = nextIn++; }
        }
        const fc = [];
        const vlen = [];
        // 소리 빠르기: 높낮이 유지는 atempo(0.5~100, 더 느리면 여러 번), 아니면 asetrate(테이프처럼)
        const tempo = (sp, pitch) => {
          if (Math.abs(sp - 1) < 1e-6) return '';
          if (pitch === false) return `,asetrate=${Math.round(48000 * sp)},aresample=48000`;
          const f = []; let r = sp; while (r < 0.5) { f.push(0.5); r /= 0.5; } f.push(r);
          return f.map((x) => `,atempo=${x.toFixed(5)}`).join('');
        };
        const scalePad = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
        spec.segments.forEach((s, i) => {
          const e = ext[i];
          const d = fmtTime(e.len);
          const full = e.hn + e.len + e.tn;
          vlen.push(full);
          const sv = s.vol == null ? 1 : Number(s.vol);
          const hasA = audioMap.get(s.path) && !s.muted;
          let vchain, achain = null;
          if (!s.rev) {
            const k = segIn[i][0].idx;
            vchain = `[${k}:v]${scalePad},setpts=(PTS-STARTPTS)/${e.sp.toFixed(6)},fps=${F},trim=duration=${fmtTime(e.realPre + e.len + e.realPost)},setpts=PTS-STARTPTS`;
            if (hasA) achain = `[${k}:a]atrim=start=${fmtTime(e.preS)},asetpts=PTS-STARTPTS,atrim=duration=${fmtTime(e.srcLen)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${tempo(e.sp, s.pitch)}`;
          } else {
            const parts = segIn[i];
            parts.forEach((p, j) => fc.push(`[${p.idx}:v]${scalePad},fps=${F},trim=duration=${fmtTime(p.len)},reverse,setpts=PTS-STARTPTS[rv${i}_${j}]`));
            fc.push(parts.map((_, j) => `[rv${i}_${j}]`).join('') + `concat=n=${parts.length}:v=1:a=0[rvc${i}]`);
            vchain = `[rvc${i}]setpts=(PTS-STARTPTS)/${e.sp.toFixed(6)},fps=${F},trim=duration=${d},setpts=PTS-STARTPTS`;
            if (hasA) {
              parts.forEach((p, j) => fc.push(`[${p.idx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${fmtTime(p.len)},asetpts=PTS-STARTPTS,areverse[ra${i}_${j}]`));
              fc.push(parts.map((_, j) => `[ra${i}_${j}]`).join('') + `concat=n=${parts.length}:v=0:a=1[rac${i}]`);
              achain = `[rac${i}]asetpts=PTS-STARTPTS${tempo(e.sp, s.pitch)}`;
            }
          }
          if (e.hn > 0 || e.tn > 0) vchain += `,fps=${F},tpad=start_mode=clone:start_duration=${fmtTime(e.padPre)}:stop_mode=clone:stop_duration=${fmtTime(e.padPost + 0.25)},trim=duration=${fmtTime(full)},setpts=PTS-STARTPTS`;
          fc.push(`${vchain},format=yuv420p,fps=${F}[v${i}]`);
          if (achain) fc.push(`${achain},apad,atrim=duration=${d},asetpts=PTS-STARTPTS${sv !== 1 ? `,volume=${sv.toFixed(3)}` : ''}[a${i}]`);
          else fc.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${d},aformat=sample_fmts=fltp,asetpts=PTS-STARTPTS[a${i}]`);
        });
        fc.push(spec.segments.map((_, i) => `[a${i}]`).join('') + `concat=n=${spec.segments.length}:v=0:a=1[ac]`);
        // 영상 잇기: 전환이 없는 곳은 concat, 있는 곳은 xfade로 겹침
        const black = (lbl, dur) => fc.push(`color=c=black:s=${W}x${H}:r=${F}:d=${fmtTime(dur + 0.1)},format=yuv420p,setsar=1,trim=duration=${fmtTime(dur)}[${lbl}]`);
        let cur = 'v0', curLen = vlen[0], nLbl = 0;
        const head = spec.trIn && spec.trIn.dur > 0 && XFADE.has(spec.trIn.type) ? spec.trIn : null;
        if (head) {
          const d = Math.min(head.dur, ext[0].len);
          black('bk_in', d);
          const o = `xf${nLbl++}`;
          fc.push(`[bk_in][${cur}]xfade=transition=${head.type}:duration=${fmtTime(d)}:offset=0[${o}]`);
          cur = o;
        }
        let pend = [];
        const flush = () => {
          if (!pend.length) return;
          const o = `cc${nLbl++}`;
          fc.push(`[${cur}]` + pend.map((l) => `[${l}]`).join('') + `concat=n=${pend.length + 1}:v=1:a=0,fps=${F}[${o}]`);
          cur = o; pend = [];
        };
        for (let i = 1; i < nS; i++) {
          const t = trOf(i - 1);
          if (!t) { pend.push(`v${i}`); curLen += vlen[i]; continue; }
          flush();
          const o = `xf${nLbl++}`;
          fc.push(`[${cur}][v${i}]xfade=transition=${t.type}:duration=${fmtTime(t.dur)}:offset=${fmtTime(curLen - t.dur)}[${o}]`);
          cur = o; curLen = curLen - t.dur + vlen[i];
        }
        flush();
        const tail = trOf(nS - 1);
        if (tail) {
          const d = Math.min(tail.dur, ext[nS - 1].len);
          black('bk_out', d);
          const o = `xf${nLbl++}`;
          fc.push(`[${cur}][bk_out]xfade=transition=${tail.type}:duration=${fmtTime(d)}:offset=${fmtTime(curLen - d)}[${o}]`);
          cur = o;
        }
        fc.push(`[${cur}]null[vc]`);
        // 분리된 소리(A2)·브금(A3): 볼륨·페이드를 적용하고 제 위치까지 지연시켜 전체 길이로 맞춘 뒤 섞음
        // (amix가 입력 수로 나눈 만큼 volume으로 되돌림). 브금은 말소리에 맞춰 자동으로 줄임(sidechaincompress)
        let aout = 'ac';
        if (nAud) {
          extra.forEach((x, k) => {
            const ms = Math.max(0, Math.round(x.start * 1000));
            const dur = x.srcOut - x.srcIn, vol = x.vol == null ? 1 : Number(x.vol);
            const fi = Math.min(Number(x.fi) || 0, dur / 2), fo = Math.min(Number(x.fo) || 0, dur / 2);
            let chain = `[${nSeg + k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${fmtTime(dur)},asetpts=PTS-STARTPTS`;
            if (vol !== 1) chain += `,volume=${vol.toFixed(3)}`;
            if (fi > 0) chain += `,afade=t=in:st=0:d=${fmtTime(fi)}`;
            if (fo > 0) chain += `,afade=t=out:st=${fmtTime(dur - fo)}:d=${fmtTime(fo)}`;
            fc.push(`${chain},adelay=${ms}|${ms},apad,atrim=duration=${fmtTime(total)}[x${k}]`);
          });
          const mixOf = (labels, out) => {
            if (labels.length === 1) { fc.push(`[${labels[0]}]anull[${out}]`); return; }
            fc.push(labels.map((l) => `[${l}]`).join('') + `amix=inputs=${labels.length}:duration=first:dropout_transition=0,volume=${labels.length}[${out}]`);
          };
          const voice = ['ac'].concat(extra.map((x, k) => (Number(x.track) === 3 ? null : `x${k}`)).filter(Boolean));
          const bgm = extra.map((x, k) => (Number(x.track) === 3 ? `x${k}` : null)).filter(Boolean);
          const duck = spec.mix && spec.mix.duck && bgm.length;
          if (!duck) mixOf(voice.concat(bgm), 'am');
          else {
            const ratio = { light: 2, normal: 4, strong: 10 }[spec.mix.level] || 4;
            mixOf(voice, 'vbus');
            fc.push(`[vbus]asplit=2[vmain][vsc]`);
            mixOf(bgm, 'bbus');
            fc.push(`[bbus][vsc]sidechaincompress=threshold=0.01:ratio=${ratio}:attack=20:release=400:makeup=1[bduck]`);
            fc.push(`[vmain][bduck]amix=inputs=2:duration=first:dropout_transition=0,volume=2[am]`);
          }
          aout = 'am';
        }
        // ── 영역 효과: 확대(자르기) 먼저, 그다음 모자이크·흐림·흑백·스포트라이트 (자막은 그 위)
        let vcur = 'vc';
        cmdLines.length = 0;
        const between = (g) => `enable='between(t,${fmtTime(g.start)},${fmtTime(Math.max(g.start, g.end - 0.001))})'`;
        fxList.forEach((g, i) => {
          if (g.kind !== 'zoom') return;
          const [bx, by, bw, bh] = g.box, D = g.end - g.start;
          let proc;
          if (g.ease > 0) {
            // perspective: 원본에서 가져올 사각형을 시간에 따라 화면 전체 → 고른 영역으로 (부드럽게)
            const K = `clip(min(((on-1)/${F})/${g.ease}\\,(${fmtTime(D)}-(on-1)/${F})/${g.ease})\\,0\\,1)`;   // on은 1부터 셈
            const S = `(st(0\\,${K})*0+ld(0)*ld(0)*(3-2*ld(0)))`;
            const e = (from, to) => `'${from}+(${to}-${from})*${S}'`;
            proc = `perspective=x0=${e(0, bx)}:y0=${e(0, by)}:x1=${e(W, bx + bw)}:y1=${e(0, by)}:x2=${e(0, bx)}:y2=${e(H, by + bh)}:x3=${e(W, bx + bw)}:y3=${e(H, by + bh)}:sense=source:eval=frame`;
          } else proc = `crop=${bw}:${bh}:${bx}:${by},scale=${W}:${H},setsar=1`;
          fc.push(`[${vcur}]split[z${i}a][z${i}b]`);
          fc.push(`[z${i}b]trim=start=${fmtTime(g.start)}:end=${fmtTime(g.end)},setpts=PTS-STARTPTS,${proc},format=yuv420p,setpts=PTS+${fmtTime(g.start)}/TB[z${i}c]`);
          fc.push(`[z${i}a][z${i}c]overlay=eof_action=pass:${between(g)}[z${i}o]`);
          vcur = `z${i}o`;
        });
        const regions = fxList.filter((g) => g.kind !== 'zoom');
        if (regions.some((g) => g.path && g.path.length)) { fc.push(`[${vcur}]sendcmd=f=fxcmds.txt[fxsc]`); vcur = 'fxsc'; }
        fxList.forEach((g, i) => {
          if (g.kind === 'zoom') return;
          const [bx, by, bw, bh] = g.box;
          if (g.kind === 'spot') {
            // 가운데에 구멍이 뚫린 어두운 그림(화면의 2배 크기)을 영역 중심에 맞춰 덮음
            const ox = Math.round(bx + bw / 2 - W), oy = Math.round(by + bh / 2 - H);
            fc.push(`[${g.spotIn}:v]format=yuva420p[sp${i}]`);
            fc.push(`[${vcur}][sp${i}]overlay@fo${i}=x=${ox}:y=${oy}:${between(g)}[r${i}o]`);
            for (const [t, x, y] of g.path || []) cmdLines.push(`${fmtTime(t)} overlay@fo${i} x ${Math.round(x + bw / 2 - W)},overlay@fo${i} y ${Math.round(y + bh / 2 - H)};`);
            vcur = `r${i}o`; return;
          }
          let proc = g.kind === 'mosaic' ? `scale=${Math.max(1, Math.round(bw / g.amt))}:${Math.max(1, Math.round(bh / g.amt))}:flags=area,scale=${bw}:${bh}:flags=neighbor`
            : g.kind === 'blur' ? `gblur=sigma=${Number(g.amt).toFixed(2)}` : 'hue=s=0';
          fc.push(`[${vcur}]split[r${i}a][r${i}b]`);
          if (g.maskIn != null) {
            fc.push(`[${g.maskIn}:v]format=gray,scale=${bw}:${bh}[mk${i}]`);
            fc.push(`[r${i}b]crop@fc${i}=w=${bw}:h=${bh}:x=${bx}:y=${by},${proc},format=yuva420p[r${i}p]`);
            fc.push(`[r${i}p][mk${i}]alphamerge[r${i}c]`);
          } else fc.push(`[r${i}b]crop@fc${i}=w=${bw}:h=${bh}:x=${bx}:y=${by},${proc}[r${i}c]`);
          fc.push(`[r${i}a][r${i}c]overlay@fo${i}=x=${bx}:y=${by}:${between(g)}[r${i}o]`);
          for (const [t, x, y] of g.path || []) cmdLines.push(`${fmtTime(t)} crop@fc${i} x ${x},crop@fc${i} y ${y},overlay@fo${i} x ${x},overlay@fo${i} y ${y};`);
          vcur = `r${i}o`;
        });
        if (cmdLines.length) fs.writeFileSync(path.join(tmp, 'fxcmds.txt'), cmdLines.join('\n') + '\n');
        if (fxList.length) { fc.push(`[${vcur}]trim=duration=${fmtTime(total)}[fxend]`); vcur = 'fxend'; }
        let last = vcur;
        subs.forEach((s, k) => {
          const out = k === subs.length - 1 ? 'vsub' : `o${k}`;
          fc.push(`[${last}][${nSeg + nAud + k}:v]overlay=x=${Math.round(s.x)}:y=${Math.round(s.y)}:enable='between(t,${fmtTime(s.start)},${fmtTime(Math.max(s.start, s.end - 0.001))})'[${out}]`);
          last = out;
        });
        const vout = last;
        const fcPath = path.join(tmp, 'graph.txt');
        fs.writeFileSync(fcPath, fc.join(';\n'));
        args.push('-filter_complex_script', fcPath, '-map', `[${vout}]`, '-map', `[${aout}]`);
        const q = { high: [18, 20], normal: [22, 24], small: [27, 29] }[spec.quality] || [22, 24];
        if (encoder === 'qsv') args.push('-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', String(q[1]), '-look_ahead', '0', '-pix_fmt', 'nv12');
        else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q[0]), '-pix_fmt', 'yuv420p');
        args.push('-r', String(F), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outPath);
        return args;
      };
      const tryRun = (encoder) => new Promise((resolve) => {
        myJob.encoder = encoder; myJob.step = '내보내는 중'; myJob.log = [];
        const args = build(encoder);
        fs.writeFileSync(path.join(tmp, `args_${encoder}.txt`), JSON.stringify(args, null, 1));
        const p = spawn(ff.path, args, { windowsHide: true, cwd: tmp });
        myJob.proc = p;
        let buf = '';
        p.stdout.on('data', (d) => {
          buf += d.toString();
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            const m = /^out_time_(?:ms|us)=(\d+)/.exec(line);
            if (m && total > 0) myJob.pct = Math.min(99.5, (Number(m[1]) / 1e6 / total) * 100);
          }
        });
        p.stderr.on('data', (d) => { for (const l of d.toString().split(/\r?\n/)) if (l.trim()) { myJob.log.push(l); if (myJob.log.length > 60) myJob.log.shift(); } });
        p.on('error', (e) => { myJob.log.push(String(e)); resolve(-1); });
        p.on('close', (code) => resolve(code));
      });
      let encoder = spec.encoder === 'cpu' || !ff.qsv ? 'x264' : 'qsv';
      if (encoder === 'x264' && !ff.x264) throw new Error('이 ffmpeg에는 사용할 수 있는 H.264 인코더가 없어요');
      let code = await tryRun(encoder);
      if (code !== 0 && !myJob.cancelled && encoder === 'qsv') {
        myJob.fallback = '그래픽 칩 인코딩(Quick Sync)을 쓸 수 없어서 CPU 인코딩으로 다시 내보냈어요';
        myJob.pct = 0;
        encoder = 'x264';
        code = await tryRun(encoder);
      }
      if (myJob.cancelled) { try { fs.unlinkSync(outPath); } catch { /* 무시 */ } myJob.state = 'cancelled'; return; }
      if (code !== 0) { try { fs.unlinkSync(outPath); } catch { /* 무시 */ } myJob.state = 'error'; myJob.error = 'ffmpeg가 오류로 멈췄어요'; return; }
      myJob.state = 'done'; myJob.pct = 100;
      try { myJob.outSize = fs.statSync(outPath).size; } catch { /* 무시 */ }
    } catch (e) {
      myJob.state = 'error'; myJob.error = String(e && e.message || e);
    } finally {
      myJob.proc = null; myJob.ended = Date.now();
      if (!process.env.AIEDITOR_KEEP_TMP) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무시 */ }
    }
  })();
  return { id: job.id, outPath };
}
export function exportStatus() {
  if (!job) return { state: 'idle' };
  const { id, state, pct, outPath, encoder, error, fallback, step, outSize, started, ended } = job;
  const elapsed = ((ended || Date.now()) - started) / 1000;
  const eta = state === 'running' && pct > 1 ? elapsed * (100 - pct) / pct : null;
  return { id, state, pct, outPath, encoder, error, fallback, step, outSize, elapsed, eta, log: state === 'error' ? job.log.slice(-15).join('\n') : '' };
}
export function exportCancel() {
  if (!job || job.state !== 'running') return false;
  job.cancelled = true;
  if (job.proc) { try { job.proc.kill(); } catch { /* 무시 */ } }
  return true;
}
export function openFolder(p) {
  try {
    if (isWin) spawn('explorer.exe', [`/select,"${p}"`], { windowsHide: false, detached: true, windowsVerbatimArguments: true });
    else spawn('xdg-open', [path.dirname(p)], { detached: true });
    return true;
  } catch { return false; }
}

// ───────── 폴더 선택 창 (윈도우) ─────────
// 탐색기 모양의 폴더 선택 창을 앱 창 위에 띄움. 안 되면 예전 모양의 폴더 선택 창으로 대신함. 취소하면 null
const PICKER_PS = `param([string]$Owner = '0')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$initial = $env:AIEDITOR_INITIAL
$p = $null
Add-Type -AssemblyName System.Windows.Forms
# 숨김으로 시작된 프로세스라도 대화상자가 보이도록, 보이지 않는 창을 한 번 열었다 닫음
$f = New-Object System.Windows.Forms.Form
$f.ShowInTaskbar = $false; $f.Opacity = 0; $f.Width = 1; $f.Height = 1
$f.Show(); $f.Hide(); $f.Dispose()
try {
  $src = [IO.File]::ReadAllText($env:AIEDITOR_CS, [Text.Encoding]::UTF8)
  Add-Type -TypeDefinition $src -Language CSharp
  $p = [AIEditorFolderPicker]::Pick([long]$Owner, '저장 폴더 선택', $initial)
} catch {
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = '저장 폴더 선택'
  if ($initial -and (Test-Path -LiteralPath $initial)) { $d.SelectedPath = $initial }
  if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $p = $d.SelectedPath }
}
if ($p) { [Console]::Out.Write($p) }
`;
export function pickFolder(owner, initial) {
  if (!isWin) return Promise.resolve(null);
  const dir = path.join(os.tmpdir(), 'aieditor-picker');
  fs.mkdirSync(dir, { recursive: true });
  const ps1 = path.join(dir, 'pick-folder.ps1'), cs = path.join(dir, 'FolderPicker.cs');
  fs.writeFileSync(ps1, '﻿' + PICKER_PS, 'utf8');   // BOM: 윈도우 PowerShell이 한글을 제대로 읽게
  fs.writeFileSync(cs, pickerCs, 'utf8');
  return new Promise((res) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Owner', String(owner || 0)],
      { windowsHide: true, timeout: 10 * 60 * 1000, encoding: 'utf8', env: { ...process.env, AIEDITOR_INITIAL: initial || '', AIEDITOR_CS: cs } },
      (err, out) => { const p = String(out || '').trim(); res(p || null); });
  });
}

// ───────── 프로젝트 파일 ─────────
// 저장 창 (윈도우): 보이지 않는 맨 위 창을 주인으로 두어 앱 앞에 뜨게 함. 취소하면 null
const SAVE_PS = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.ShowInTaskbar = $false; $f.Opacity = 0; $f.TopMost = $true
$f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(-3000, -3000); $f.Size = New-Object System.Drawing.Size(1, 1)
$f.Show(); $f.Activate()
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = $env:AIEDITOR_TITLE
$d.Filter = $env:AIEDITOR_FILTER
$d.AddExtension = $true; $d.OverwritePrompt = $true
$d.DefaultExt = $env:AIEDITOR_EXT
if ($env:AIEDITOR_DIR -and (Test-Path -LiteralPath $env:AIEDITOR_DIR)) { $d.InitialDirectory = $env:AIEDITOR_DIR }
$d.FileName = $env:AIEDITOR_NAME
$r = $d.ShowDialog($f)
$f.Close()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }
`;
export function saveFileDialog({ title, name, dir, ext, filterName }) {
  if (!isWin) return Promise.resolve(null);
  const tdir = path.join(os.tmpdir(), 'aieditor-picker');
  fs.mkdirSync(tdir, { recursive: true });
  const ps1 = path.join(tdir, 'save-file.ps1');
  fs.writeFileSync(ps1, '﻿' + SAVE_PS, 'utf8');
  return new Promise((res) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { windowsHide: true, timeout: 10 * 60 * 1000, encoding: 'utf8', env: { ...process.env, AIEDITOR_TITLE: title || '저장', AIEDITOR_NAME: name || '', AIEDITOR_DIR: dir || '', AIEDITOR_EXT: ext || '', AIEDITOR_FILTER: `${filterName || '파일'} (*.${ext})|*.${ext}` } },
      (err, out) => { const p = String(out || '').trim(); res(p || null); });
  });
}
// 안전하게 저장: 임시 파일에 쓴 뒤 바꿔치기 (저장 중에 꺼져도 기존 파일이 깨지지 않게)
export function writeTextFile(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.saving';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, p);
  return true;
}
export function readTextFile(p) { return fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); }
export function statPaths(list) {
  return (list || []).map((p) => { try { const st = fs.statSync(p); return { exists: st.isFile(), size: st.size }; } catch { return { exists: false }; } });
}
export function projectDir() {
  const h = os.homedir();
  for (const d of [path.join(h, 'Documents'), path.join(h, 'Videos'), h]) if (fs.existsSync(d)) return d;
  return h;
}

// ───────── 설정 파일 (이 PC) ─────────
function settingsPath() { return path.join(cacheDir(), '..', 'settings.json'); }
export function getSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; } }
export function setSettings(obj) { const cur = { ...getSettings(), ...obj }; fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(cur, null, 1)); return cur; }

// ───────── 끝낼 때 정리 · 시작 시간 기록 ─────────
export function shutdownAll() {
  try { if (job && job.proc) job.proc.kill(); } catch { /* 무시 */ }
}
export function logStartup(o) {
  try {
    const p = path.join(cacheDir(), '..', 'startup.log');
    let old = ''; try { old = fs.readFileSync(p, 'utf8'); } catch { /* 처음 */ }
    const lines = (old + new Date().toISOString() + ' ' + JSON.stringify(o) + '\n').split('\n').filter(Boolean).slice(-30);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  } catch { return null; }
}
