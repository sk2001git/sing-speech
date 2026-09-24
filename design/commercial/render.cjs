// Renders commercial.html to suara-film.mp4: 10 s, 1920x1080, 30 fps, H.264 + AAC.
// Each frame is set exactly on the film's timeline (seek), captured, and piped to ffmpeg, so
// the video is smooth however slow the capture is.
//   node render.cjs            full film
//   node render.cjs --stills   five stills only, for checking
const path = require('path');
const { spawn, execSync } = require('child_process');
const { chromium } = require('C:/Users/Admin/Desktop/sean_web_new/trip/node_modules/playwright');

const FPS = 30, SECONDS = 10, W = 1920, H = 1080;
const here = __dirname;
const page = 'file:///' + path.join(here, 'commercial.html').split(path.sep).join('/');
const ffmpeg = execSync('python -c "import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())"').toString().trim();

// A quiet pad (A major, lifting to D major when the answer lands at 5.6 s) and two chimes:
// the answer (5.72 s) and the last step (8.0 s). Fades in and out.
const pad1 = '(sin(2*PI*220*t)+0.7*sin(2*PI*277.18*t)+0.6*sin(2*PI*329.63*t)+0.35*sin(2*PI*440*t))';
const pad2 = '(sin(2*PI*146.83*t)+0.7*sin(2*PI*293.66*t)+0.6*sin(2*PI*369.99*t)+0.45*sin(2*PI*440*t)+0.3*sin(2*PI*587.33*t))';
const mix = `0.055*(${pad1}*(1-min(max((t-5.4)/0.5,0),1))+${pad2}*min(max((t-5.4)/0.5,0),1))`;
const chime = (at, f, g) => `${g}*sin(2*PI*${f}*t)*exp(-5*(t-${at}))*gte(t,${at})+${g * 0.5}*sin(2*PI*${f * 1.5}*t)*exp(-7*(t-${at}))*gte(t,${at})`;
const env = `min(t/1.6,1)*min((${SECONDS}-t)/1.4,1)`;
const audio = `aevalsrc='(${mix}+${chime(5.72, 1318.51, 0.16)}+${chime(8.0, 1760, 0.14)})*${env}':s=48000:d=${SECONDS},lowpass=f=5200,aecho=0.8:0.6:120:0.25,volume=2.5`;

(async () => {
  const stills = process.argv.includes('--stills');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.goto(page + '?frame=0');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);

  if (stills) {
    for (const s of [1.2, 3.2, 5.0, 6.2, 7.7, 8.5, 9.8]) {
      await p.evaluate((ms) => window.seek(ms), s * 1000);
      await p.screenshot({ path: path.join(here, `still-${s.toFixed(1)}s.jpg`), type: 'jpeg', quality: 90 });
    }
    await b.close(); console.log('stills written'); return;
  }

  const out = path.join(here, 'suara-film.mp4');
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-f', 'lavfi', '-i', audio,
    // JPEG frames are full-range BT.601; phones and QuickTime expect limited-range BT.709.
    '-vf', 'scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
  const total = FPS * SECONDS, t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await p.evaluate((ms) => window.seek(ms), (f * 1000) / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await done;
  await b.close();
  console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
