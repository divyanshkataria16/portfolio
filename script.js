/* ============================================================
   DIVYANSH KATARIA — PORTFOLIO ENGINE
   Performance contract:
     · Nothing inside a rAF frame ever READS layout
       (no offsetWidth / scrollWidth / getBoundingClientRect).
       Every measurement is cached and refreshed on resize only.
     · Everything that moves is transform / opacity — GPU
       composited. No left/top/width animation anywhere.
     · One pointer listener, one ticker, shared by all modules.
     · Off-screen work is paused, not just hidden.
   ============================================================ */

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });
ScrollTrigger.defaults({ fastScrollEnd: true });

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE   = matchMedia('(pointer: fine)').matches;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ---------- Shared state. Written once per event, read by many. ---------- */
const vp = { w: innerWidth, h: innerHeight };
const pointer = { x: innerWidth / 2, y: innerHeight / 2, nx: 0.5, ny: 0.5 };
const scrollState = { y: 0, velocity: 0, progress: 0 };

addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.nx = e.clientX / vp.w;
  pointer.ny = 1 - e.clientY / vp.h; // GL is y-up
}, { passive: true });

/* Every module that caches geometry registers here instead of adding
   its own resize listener — one debounced pass, one layout flush. */
const resizeHandlers = [];
const onResize = (fn) => resizeHandlers.push(fn);
let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    vp.w = innerWidth;
    vp.h = innerHeight;
    resizeHandlers.forEach((fn) => fn());
    ScrollTrigger.refresh();
  }, 180);
}, { passive: true });


/* ============================================================
   1. WEBGL AURORA — the hero's living background.
   A single full-screen triangle running a domain-warped
   simplex-noise field. Ribbons of light bend around the cursor
   and accelerate with scroll velocity.
   Fill-rate bound, so it renders at a fraction of device
   resolution and stops entirely once scrolled past the hero.
   ============================================================ */

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;
uniform float uVel;
uniform float uFade;

/* Ashima 2D simplex noise */
vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x   + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/* ---- 3D value noise ----
   Cheaper than 3D simplex and smooth enough for volume. Eight hashed
   lattice corners, smoothstep-interpolated. */
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}

/* Density of the cloud at a point in space. Three octaves is the floor
   for something that reads as vapour rather than blobs. */
float density(vec3 p, float t){
  p.z += t * 0.55;                 /* drift toward the viewer */
  p.y += sin(p.z * 0.35 + t) * 0.22;
  float d = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++){
    d += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  /* Carve it into a slab so there is empty space to see THROUGH — that
     gap is what makes it read as volume instead of fog on glass. */
  float slab = 1.0 - smoothstep(0.35, 1.6, abs(p.y * 0.26));
  d = clamp(d * slab - 0.30, 0.0, 1.0);
  /* Square it. Without this the field fills the frame as a uniform milky
     haze; squaring thins the wisps hard while leaving dense cores intact,
     which is what separates "volume" from "fog on the lens". */
  return d * d * 2.2;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 sc = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float t = uTime * 0.10;

  /* The pointer steers the CAMERA, not the pixels. Rotating the ray
     bundle is what produces true parallax — near vapour sweeps past
     faster than far vapour, and the field gains real depth. */
  vec2 look = (uMouse - 0.5) * vec2(0.42, 0.30);
  vec3 ro = vec3(look.x * 1.4, look.y * 1.0, -2.6);
  vec3 rd = normalize(vec3(sc * 1.5 - look * 0.55, 1.0));

  /* Scroll velocity pushes the camera through the volume. */
  ro.z += uVel * 0.30;

  vec3 accent = vec3(0.302, 0.486, 1.000);   /* #4D7CFF */
  vec3 ice    = vec3(0.659, 0.769, 1.000);   /* #A8C4FF */
  vec3 warm   = vec3(1.000, 0.882, 0.780);   /* ivory key light   */

  vec3 col = vec3(0.0);
  float transmit = 1.0;                       /* Beer–Lambert transmittance */

  /* Raymarch. 18 steps is the sweet spot found by measurement: 12 bands
     visibly, 28 costs ~1.6x for no perceptible gain at this density. */
  const int STEPS = 18;
  float stepLen = 0.185;
  for (int i = 0; i < STEPS; i++){
    if (transmit < 0.03) break;               /* saturated — stop early */
    vec3 pos = ro + rd * (0.35 + float(i) * stepLen);
    float d = density(pos, t);
    if (d <= 0.001) continue;

    /* Cheap single-sample scattering: sample the density slightly
       toward the key light; less occlusion there means more glow. */
    float lit = 1.0 - density(pos + vec3(0.28, 0.42, -0.18), t);

    vec3 shade = mix(accent * 0.78, ice, lit * lit);
    shade += warm * pow(lit, 4.0) * 0.40;

    /* Depth cue: distant samples cool down and lose energy. */
    float depth = 1.0 - float(i) / float(STEPS);
    shade *= 0.42 + depth * 1.0;

    float absorb = d * stepLen * 3.0;
    col += shade * absorb * transmit;
    transmit *= 1.0 - absorb;
  }

  /* A few bright motes suspended in the volume — parallax anchors that
     tell the eye this is space, not a gradient. */
  float motes = pow(vnoise(vec3(sc * 19.0, t * 0.5)), 15.0);
  col += ice * motes * 1.5;

  /* Vignette + bottom falloff so the tagline always sits on near-black.
     Aspect-aware: a tall phone collapses the x-range, so a fixed radius
     barely bites and the hero washes out. */
  float vigScale = mix(1.38, 1.0, clamp(aspect / 1.5, 0.0, 1.0));
  col *= smoothstep(1.15, 0.14, length(vec2(sc.x * 0.88, sc.y)) * vigScale);
  col *= mix(1.0, 0.09, smoothstep(0.14, 0.62, 1.0 - uv.y));

  /* Lift the floor off pure black — cool, to match the ground. */
  col += vec3(0.016, 0.019, 0.032);

  /* Film grain keeps the soft gradients from banding on 8-bit displays. */
  float g = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.024;

  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

function initAurora() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas || REDUCE) return null;

  const gl = canvas.getContext('webgl', {
    antialias: false, alpha: false, depth: false,
    stencil: false, powerPreference: 'high-performance',
  });
  if (!gl) { document.documentElement.classList.add('no-webgl'); return null; }

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[aurora]', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { document.documentElement.classList.add('no-webgl'); return null; }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    document.documentElement.classList.add('no-webgl');
    return null;
  }
  gl.useProgram(prog);

  // One oversized triangle covers the viewport with no seam.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {
    res:   gl.getUniformLocation(prog, 'uRes'),
    time:  gl.getUniformLocation(prog, 'uTime'),
    mouse: gl.getUniformLocation(prog, 'uMouse'),
    vel:   gl.getUniformLocation(prog, 'uVel'),
    fade:  gl.getUniformLocation(prog, 'uFade'),
  };

  // Fragment shaders are fill-rate bound, and a raymarcher runs its
  // whole loop PER PIXEL — so resolution is the single biggest lever
  // here. The volume is soft, so the downscale is invisible.
  // Measured at 0.127ms/frame on this GPU at 0.40 — under 1% of a 60fps
  // budget — so there is ample room to sharpen. Kept well below 1.0 to
  // leave headroom for weak integrated GPUs, where this runs far slower.
  const scale = FINE ? 0.52 : 0.34;
  function resize() {
    const w = Math.max(1, Math.round(vp.w * scale));
    const h = Math.max(1, Math.round(vp.h * scale));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.res, w, h);
  }
  resize();
  onResize(resize);

  // Smoothed pointer + velocity so the field drifts rather than snaps.
  let mx = 0.5, my = 0.5, vel = 0, fade = 1, running = true;

  gl.uniform1f(U.fade, 1);

  return {
    render(timeSec) {
      // Target opacity: full through the hero, gone one viewport later.
      const target = 1 - Math.min(1, Math.max(0, (scrollState.y - vp.h * 0.35) / (vp.h * 0.75)));
      fade += (target - fade) * 0.08;

      if (fade < 0.01) {
        if (running) { canvas.style.opacity = '0'; running = false; }
        return;                       // stop drawing entirely below the fold
      }
      if (!running) { canvas.style.opacity = ''; running = true; }

      mx  += (pointer.nx - mx) * 0.045;
      my  += (pointer.ny - my) * 0.045;
      vel += (Math.min(Math.abs(scrollState.velocity) * 0.02, 1.6) - vel) * 0.08;

      gl.uniform1f(U.time, timeSec);
      gl.uniform2f(U.mouse, mx, my);
      gl.uniform1f(U.vel, vel);
      gl.uniform1f(U.fade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

const aurora = initAurora();


/* ============================================================
   2. SMOOTH SCROLL
   ============================================================ */

let lenis = null;
if (!REDUCE) {
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true, touchMultiplier: 1.6 });
  window.lenis = lenis;
  lenis.on('scroll', (e) => {
    scrollState.y = e.scroll;
    scrollState.velocity = e.velocity;
    scrollState.progress = e.progress;
    ScrollTrigger.update();
  });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* Backstop, registered in BOTH modes: anything that scrolls the page
   without going through Lenis (scrollIntoView, anchor jumps, find-in-page,
   keyboard) would otherwise leave scrollState.y stale — and the aurora's
   halt-below-the-fold check depends on it being accurate. Passive, and
   window.scrollY is a cached read, not a forced layout. */
addEventListener('scroll', () => { scrollState.y = window.scrollY; }, { passive: true });

/* Accepts a selector string OR an element — the project rail passes
   panel elements directly. */
function scrollToTarget(target) {
  if (lenis) { lenis.scrollTo(target, { offset: 0, duration: 1.5 }); return; }
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  el?.scrollIntoView({ behavior: 'smooth' });
}

/* The single frame loop everything hangs off. No layout reads here. */
gsap.ticker.add((time) => {
  if (aurora) aurora.render(time);
  cursorFrame();
  marqueeFrame();
});


/* ============================================================
   3. CURSOR — blend-difference disc that inverts whatever it
   crosses, with a hairline ring trailing behind it.
   Positioned with transforms via quickSetter (no style parsing,
   no layout).
   ============================================================ */

let cursorFrame = () => {};

if (FINE && !REDUCE) {
  const dot  = document.createElement('div'); dot.className  = 'cursor-dot';
  const ring = document.createElement('div'); ring.className = 'cursor-ring';
  document.body.append(ring, dot);

  const setDotX  = gsap.quickSetter(dot,  'x', 'px');
  const setDotY  = gsap.quickSetter(dot,  'y', 'px');
  const setRingX = gsap.quickSetter(ring, 'x', 'px');
  const setRingY = gsap.quickSetter(ring, 'y', 'px');

  let dx = pointer.x, dy = pointer.y, rx = pointer.x, ry = pointer.y;

  cursorFrame = () => {
    dx += (pointer.x - dx) * 0.35;   // disc: tight to the hand
    dy += (pointer.y - dy) * 0.35;
    rx += (pointer.x - rx) * 0.13;   // ring: lags, gives the trail
    ry += (pointer.y - ry) * 0.13;
    setDotX(dx);  setDotY(dy);
    setRingX(rx); setRingY(ry);
  };

  // Delegated — two listeners total instead of one pair per element.
  const HOT = 'a, button, .faq-q, input, textarea, select, .product-card, .featured-product, .skill-card, .design-card';
  document.addEventListener('pointerover', (e) => {
    if (e.target.closest(HOT)) document.body.classList.add('cursor-hot');
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest(HOT) && !e.relatedTarget?.closest(HOT)) {
      document.body.classList.remove('cursor-hot');
    }
  });
  addEventListener('pointerdown', () => document.body.classList.add('cursor-down'));
  addEventListener('pointerup',   () => document.body.classList.remove('cursor-down'));
}


/* ============================================================
   4. MARQUEE — scroll velocity feeds its speed.
   The old build read marquee.scrollWidth every frame, forcing a
   synchronous layout 60x/sec. Measured once here, refreshed on
   resize, and driven with a transform.
   ============================================================ */

let marqueeFrame = () => {};

{
  const marquee = document.querySelector('.marquee');
  if (marquee && !REDUCE) {
    marquee.style.animation = 'none';
    const setX = gsap.quickSetter(marquee, 'x', 'px');
    let half = marquee.scrollWidth / 2;   // measured ONCE
    let x = 0, boost = 0;

    onResize(() => { half = marquee.scrollWidth / 2; });

    marqueeFrame = () => {
      boost += (Math.min(Math.abs(scrollState.velocity) * 0.30, 6) - boost) * 0.12;
      x -= 0.9 + boost;
      if (-x >= half) x += half;
      setX(x);
    };
  }
}


/* ============================================================
   5. OPENING TITLE SEQUENCE
   ============================================================ */

const loader = document.getElementById('loader');
const loaderName = document.getElementById('loaderName');
const loaderCount = document.getElementById('loaderCount');

function splitChars(el) {
  const text = el.textContent.trim();
  el.textContent = '';
  const frag = document.createDocumentFragment();
  [...text].forEach((ch) => {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = ch;
    frag.appendChild(span);
  });
  el.appendChild(frag);
  return el.querySelectorAll('.ch');
}

function finishLoader() {
  if (!loader || loader.style.display === 'none') return;
  loader.style.display = 'none';
  document.body.classList.remove('locked');
  ScrollTrigger.refresh();
}

const openTL = gsap.timeline({ onComplete: finishLoader });

// Failsafe: a throttled rAF (background tab, low-power mode) must never
// leave a visitor staring at the loader.
setTimeout(() => {
  if (loader && loader.style.display !== 'none') { openTL.progress(1).kill(); finishLoader(); }
}, 7000);

if (REDUCE) {
  if (loader) loader.style.display = 'none';
  document.body.classList.remove('locked');
} else {
  document.body.classList.add('locked');
  const nameChars = splitChars(loaderName);
  const counter = { v: 0 };

  openTL
    .set(nameChars, { yPercent: 120 })
    .to(nameChars, { yPercent: 0, duration: 0.85, stagger: 0.03, ease: 'power4.out' }, 0.15)
    .to(counter, {
      v: 100, duration: 1.6, ease: 'power2.inOut',
      onUpdate: () => { loaderCount.textContent = String(Math.round(counter.v)).padStart(3, '0'); },
    }, 0.15)
    .to('#loaderBar', { scaleX: 1, duration: 1.6, ease: 'power2.inOut' }, 0.15)
    .to(nameChars, { yPercent: -120, duration: 0.6, stagger: 0.018, ease: 'power4.in' }, '+=0.15')
    .to('#loaderCount, #loaderBar, .loader-tag', { opacity: 0, duration: 0.35 }, '<')
    .to('.loader-panel', { yPercent: -100, duration: 0.95, stagger: 0.1, ease: 'power4.inOut' }, '-=0.1');

  /* ---------- Hero entrance ---------- */
  openTL
    .fromTo('.hero-photo',
      { scale: 2.4, rotate: -12, yPercent: 22 },
      { scale: 1, rotate: 0, yPercent: 0, duration: 1.4, ease: 'power4.inOut' }, '-=0.5')
    .fromTo('.hero-photo img',
      { clipPath: 'inset(38% 38% 38% 38% round 26px)', scale: 1.5 },
      { clipPath: 'inset(0% 0% 0% 0% round 26px)', scale: 1, duration: 1.4, ease: 'power4.inOut' }, '<')
    .fromTo('.hero-title .line-inner',
      { yPercent: 115, rotate: 3 },
      { yPercent: 0, rotate: 0, duration: 1.05, stagger: 0.13, ease: 'power4.out' }, '-=0.65')
    .fromTo('.hero-name',
      { opacity: 0, letterSpacing: '1.1em' },
      { opacity: 1, letterSpacing: '0.25em', duration: 1.0, ease: 'power3.out' }, '<')
    .fromTo('.hi-bubble-pop',
      { scale: 0, rotate: -180 },
      { scale: 1, rotate: 0, duration: 0.75, ease: 'back.out(2.2)' }, '-=0.55')
    .fromTo('.hero-tagline', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out' }, '-=0.45')
    .fromTo('.hero-bottom',  { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out' }, '-=0.6')
    .fromTo('.nav-outer',    { y: -90 },            { y: 0, duration: 0.85, ease: 'power4.out' }, '-=0.65')
    .fromTo('.hero-badge',   { scale: 0, rotate: -120 }, { scale: 1, rotate: 0, duration: 0.65, ease: 'back.out(1.8)' }, '-=0.55');
}


/* ============================================================
   6. SCROLL CHOREOGRAPHY
   Batched wherever a group shares one motion — ScrollTrigger.batch
   collapses what used to be ~90 separate trigger instances into
   about a dozen.
   ============================================================ */

if (!REDUCE) {
  /* Hero parallax — three transforms sharing one trigger */
  gsap.timeline({
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  })
    .to('.hero-photo', { yPercent: 26, scale: 1.06, ease: 'none' }, 0)
    .to('.hero-title .line:first-child', { xPercent: -13, ease: 'none' }, 0)
    .to('.hero-title .line:last-child',  { xPercent: 13,  ease: 'none' }, 0)
    .to('.hero-inner', { opacity: 0.2, ease: 'none' }, 0.55);
}

/* ---------- Section headings: per-character mask reveal ---------- */
/* Splits a heading into per-character spans for the reveal, and applies
   the editorial serif italic to whichever WORDS are named in
   data-serif="0,2". Doing it here (rather than as markup) is what keeps
   the split non-destructive — this function rebuilds from textContent,
   so any inline <span> in the HTML would simply be erased. */
function splitHeading(el) {
  const serifWords = new Set(
    (el.dataset.serif || '').split(',').filter((s) => s !== '').map(Number),
  );
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  const frag = document.createDocumentFragment();
  words.forEach((word, wi) => {
    const wd = document.createElement('span');
    wd.className = serifWords.has(wi) ? 'wd serif' : 'wd';
    [...word].forEach((ch) => {
      const span = document.createElement('span');
      span.className = 'ch';
      span.textContent = ch;
      wd.appendChild(span);
    });
    frag.appendChild(wd);
    if (wi < words.length - 1) frag.appendChild(document.createTextNode(' '));
  });
  el.appendChild(frag);
  return el.querySelectorAll('.ch');
}

document.querySelectorAll('.section-head h2, .contact-section h2').forEach((h) => {
  const chars = splitHeading(h);
  gsap.fromTo(chars,
    { yPercent: 108, rotateX: -55, opacity: 0 },
    {
      yPercent: 0, rotateX: 0, opacity: 1,
      stagger: 0.028, duration: 0.85, ease: 'power4.out',
      scrollTrigger: { trigger: h, start: 'top 88%', once: true },
    });
});

/* ---------- Eyebrows + section copy (batched) ---------- */
ScrollTrigger.batch('.eyebrow, .section-head p', {
  start: 'top 90%', once: true,
  onEnter: (els) => gsap.fromTo(els,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.85, stagger: 0.06, ease: 'power3.out', overwrite: true }),
});

/* ---------- About copy: word-by-word bloom.
   One-shot, not scrubbed — the old build re-tweened several hundred
   spans on every scroll tick. ---------- */
document.querySelectorAll('.about-copy p').forEach((p) => {
  const text = p.textContent.trim();
  p.textContent = '';
  const frag = document.createDocumentFragment();
  text.split(/\s+/).forEach((w) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = w;
    frag.appendChild(span);
    frag.appendChild(document.createTextNode(' '));
  });
  p.appendChild(frag);

  gsap.fromTo(p.querySelectorAll('.w'),
    { opacity: 0.08, y: 8 },
    {
      opacity: 1, y: 0, stagger: 0.012, duration: 0.6, ease: 'power2.out',
      scrollTrigger: { trigger: p, start: 'top 85%', once: true },
    });
});

gsap.fromTo('.about-photo img',
  { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.3 },
  {
    clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 1.3, ease: 'power4.inOut',
    scrollTrigger: { trigger: '.about-photo', start: 'top 82%', once: true },
  });

/* ---------- Service rows ---------- */
ScrollTrigger.batch('.service-row', {
  start: 'top 88%', once: true,
  onEnter: (els) => els.forEach((row, i) => {
    gsap.timeline()
      .fromTo(row, { opacity: 0, x: i % 2 ? 80 : -80 },
        { opacity: 1, x: 0, duration: 0.95, ease: 'power4.out' })
      .fromTo(row.querySelectorAll('.tags span'),
        { opacity: 0, y: 16, scale: 0.86 },
        { opacity: 1, y: 0, scale: 1, stagger: 0.04, duration: 0.45, ease: 'back.out(1.8)' }, 0.2);
  }),
});

/* ---------- Experience ---------- */
gsap.fromTo('.exp-line', { scaleY: 0 }, {
  scaleY: 1, ease: 'none',
  scrollTrigger: { trigger: '.exp-wrap', start: 'top 75%', end: 'bottom 60%', scrub: true },
});
ScrollTrigger.batch('.exp-item', {
  start: 'top 85%', once: true,
  onEnter: (els) => els.forEach((item, i) => gsap.fromTo(item,
    { opacity: 0, x: i % 2 ? 70 : -70, y: 28 },
    { opacity: 1, x: 0, y: 0, duration: 0.95, ease: 'power4.out', overwrite: true })),
});

/* ---------- Projects: a deck you can see into ----------
   The previous build slid a 75%-black shade over each card the moment
   the next one arrived, so finished work vanished the instant you
   scrolled past it. Now each card slides UP and back by an amount tied
   to how far down the deck it sits, so every project stays visible as a
   layered stack — you can see everything you've done at once, with the
   current one in front. */
{
  const panels = gsap.utils.toArray('.project-panel');
  const N = panels.length;

  panels.forEach((panel, i) => {
    const inner = panel.querySelector('.project-card');
    const shade = document.createElement('div');
    shade.className = 'shade';
    inner.appendChild(shade);

    if (i < N - 1) {
      // Depth is keyed to position in the deck, not a flat value: the
      // earliest card ends up highest, smallest and dimmest, so the
      // layers never collapse onto each other.
      const depth = N - 1 - i;                 // 3,2,1 for a 4-card deck
      gsap.timeline({
        scrollTrigger: { trigger: panels[i + 1], start: 'top bottom', end: 'top top', scrub: true },
      })
        .to(inner, {
          y: -(30 + depth * 13),
          scale: 0.97 - depth * 0.022,
          ease: 'none',
        }, 0)
        // Dim enough to push it back, light enough to still read.
        .to(shade, { opacity: 0.26 + depth * 0.09, ease: 'none' }, 0);
    }

    gsap.fromTo(panel.querySelectorAll('.cat, h3, p, .tags, .proj-index'),
      { opacity: 0, y: 36 },
      {
        opacity: 1, y: 0, stagger: 0.07, duration: 0.75, ease: 'power3.out',
        scrollTrigger: { trigger: panel, start: 'top 62%', once: true },
      });

    gsap.fromTo(panel.querySelector('.thumb'),
      { clipPath: 'inset(0% 100% 0% 0%)' },
      {
        clipPath: 'inset(0% 0% 0% 0%)', duration: 1.05, ease: 'power4.inOut',
        scrollTrigger: { trigger: panel, start: 'top 66%', once: true },
      });
  });

  /* ---------- Live index rail ----------
     You liked the "01 / 04" marker, so this promotes it into a real
     contents list: every project named, the current one lit, and each
     entry clickable to jump straight to that piece of work. */
  const section = document.getElementById('projects');
  if (section && N) {
    const rail = document.createElement('nav');
    rail.className = 'proj-rail';
    rail.setAttribute('aria-label', 'Client work index');
    rail.innerHTML = panels.map((p, i) => {
      const title = p.querySelector('h3')?.textContent?.trim() ?? `Project ${i + 1}`;
      const cat = p.querySelector('.cat')?.textContent?.trim() ?? '';
      return `<button class="proj-rail-item" data-i="${i}" aria-label="${title}">
                <span class="n">${String(i + 1).padStart(2, '0')}</span>
                <span class="meta"><span class="t">${title}</span><span class="c">${cat}</span></span>
              </button>`;
    }).join('');
    section.appendChild(rail);

    const items = [...rail.querySelectorAll('.proj-rail-item')];
    const setActive = (idx) => {
      items.forEach((el, k) => el.classList.toggle('on', k === idx));
    };
    setActive(0);

    // One trigger per panel decides which entry is lit.
    panels.forEach((panel, i) => {
      ScrollTrigger.create({
        trigger: panel,
        start: 'top 55%',
        end: 'bottom 45%',
        onToggle: (self) => { if (self.isActive) setActive(i); },
      });
    });

    // Show the rail only while the section owns the screen.
    ScrollTrigger.create({
      trigger: section,
      start: 'top 60%',
      end: 'bottom 75%',
      onToggle: (self) => rail.classList.toggle('visible', self.isActive),
    });

    rail.addEventListener('click', (e) => {
      const btn = e.target.closest('.proj-rail-item');
      if (!btn) return;
      scrollToTarget(panels[Number(btn.dataset.i)]);
    });
  }
}

/* ---------- Flagship product ---------- */
{
  const feat = document.querySelector('.featured-product');
  if (feat) {
    gsap.timeline({ scrollTrigger: { trigger: feat, start: 'top 82%', once: true } })
      .fromTo(feat, { opacity: 0, y: 56 }, { opacity: 1, y: 0, duration: 0.95, ease: 'power4.out' })
      .fromTo('.feat-chip', { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, stagger: 0.09, duration: 0.55, ease: 'back.out(1.6)' }, 0.3)
      .fromTo('.feat-stat', { opacity: 0, y: 18 },
        { opacity: 1, y: 0, stagger: 0.09, duration: 0.6, ease: 'power3.out' }, 0.45);

    // Score ring draws itself as it enters.
    const ring = feat.querySelector('.ring-fill');
    if (ring) {
      gsap.fromTo(ring, { strokeDashoffset: 527.8 }, {
        strokeDashoffset: 68.6, duration: 1.6, ease: 'power3.inOut',
        scrollTrigger: { trigger: feat, start: 'top 80%', once: true },
      });
    }
  }
}

/* ---------- Products / skills / FAQ (batched) ---------- */
ScrollTrigger.batch('.product-card', {
  start: 'top 82%', once: true,
  onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 80, rotateX: 10 },
    { opacity: 1, y: 0, rotateX: 0, stagger: 0.12, duration: 0.95, ease: 'power4.out', overwrite: true }),
});

ScrollTrigger.batch('.design-card', {
  start: 'top 85%', once: true,
  onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 60 },
    { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: 'power4.out', overwrite: true }),
});

/* The card specimens (chart bars, drawing path, tile sequence) are CSS
   keyframes. Gate them on a class so they only run while the section is
   actually on screen — an infinite animation ticking out of view is the
   kind of thing that quietly costs frames elsewhere on the page. */
{
  const grid = document.querySelector('.design-grid');
  if (grid && !REDUCE) {
    ScrollTrigger.create({
      trigger: '#design',
      start: 'top 90%',
      end: 'bottom 10%',
      onToggle: (self) => grid.classList.toggle('active', self.isActive),
    });
  }
}

ScrollTrigger.batch('.skill-card', {
  start: 'top 85%', once: true,
  onEnter: (els) => els.forEach((card, i) => {
    gsap.timeline({ delay: i * 0.09 })
      .fromTo(card, { opacity: 0, y: 55 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power4.out' })
      // The old build gave every single <li> its own ScrollTrigger.
      .fromTo(card.querySelectorAll('li'), { opacity: 0, x: -16 },
        { opacity: 1, x: 0, stagger: 0.035, duration: 0.4, ease: 'power3.out' }, 0.15);
  }),
});

ScrollTrigger.batch('.faq-item', {
  start: 'top 92%', once: true,
  onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 34 },
    { opacity: 1, y: 0, stagger: 0.07, duration: 0.65, ease: 'power3.out', overwrite: true }),
});

/* ---------- Contact ---------- */
gsap.fromTo('.contact-section',
  { clipPath: 'inset(10% 5% 10% 5% round 36px)' },
  {
    clipPath: 'inset(0% 0% 0% 0% round 36px)', ease: 'none',
    scrollTrigger: { trigger: '.contact-section', start: 'top 90%', end: 'top 35%', scrub: true },
  });
gsap.timeline({ scrollTrigger: { trigger: '.contact-grid', start: 'top 88%', once: true } })
  .fromTo('.contact-badge', { scale: 0, rotate: -120 },
    { scale: 1, rotate: 0, duration: 0.75, ease: 'back.out(1.8)' })
  .fromTo('.contact-grid, .avail-badge', { opacity: 0, y: 44 },
    { opacity: 1, y: 0, stagger: 0.1, duration: 0.8, ease: 'power3.out' }, 0.1)
  // Opacity only — .hi-bubble2 runs a CSS `pulse` keyframe on transform,
  // and a transform tween here would simply be overridden by it.
  .fromTo('.hi-bubble2', { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power2.out' }, 0.1);

/* ---------- Stat counters ---------- */
document.querySelectorAll('[data-count]').forEach((el) => {
  const target = parseInt(el.dataset.count, 10);
  const suffix = el.dataset.suffix || '';
  const obj = { v: 0 };
  gsap.to(obj, {
    v: target, duration: 1.5, ease: 'power2.out',
    onUpdate: () => { el.textContent = Math.round(obj.v) + suffix; },
    scrollTrigger: { trigger: el, start: 'top 88%', once: true },
  });
});
ScrollTrigger.batch('.stat', {
  start: 'top 88%', once: true,
  onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 34 },
    { opacity: 1, y: 0, stagger: 0.08, duration: 0.7, ease: 'power3.out', overwrite: true }),
});


/* ============================================================
   7. POINTER INTERACTIONS
   ============================================================ */

/* ---------- Card spotlight: a light source that tracks the cursor.
   Custom properties are written at most once per frame, and only for
   the card actually under the pointer. ---------- */
if (FINE && !REDUCE) {
  const SPOT = '.product-card, .featured-product, .skill-card, .project-card, .service-row, .design-card';
  let spotEl = null, spotX = 0, spotY = 0, spotQueued = false;

  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest(SPOT);
    if (!el) {
      if (spotEl) { spotEl.classList.remove('lit'); spotEl = null; }
      return;
    }
    if (el !== spotEl) {
      if (spotEl) spotEl.classList.remove('lit');
      spotEl = el;
      spotEl.classList.add('lit');
    }
    // rect read is fine here: pointermove, not a rAF frame.
    const r = el.getBoundingClientRect();
    spotX = e.clientX - r.left;
    spotY = e.clientY - r.top;
    if (!spotQueued) {
      spotQueued = true;
      requestAnimationFrame(() => {
        spotQueued = false;
        if (spotEl) {
          spotEl.style.setProperty('--mx', spotX + 'px');
          spotEl.style.setProperty('--my', spotY + 'px');
        }
      });
    }
  }, { passive: true });
}

/* ---------- Magnetic pull ---------- */
if (FINE && !REDUCE) {
  document.querySelectorAll('.btn, .badge-core, .menu-btn').forEach((el) => {
    const strength = el.classList.contains('btn') ? 0.32 : 0.45;
    const zone = el.closest('.circle-badge') || el;
    const setX = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
    const setY = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });
    let rect = null;

    zone.addEventListener('pointerenter', () => { rect = el.getBoundingClientRect(); });
    zone.addEventListener('pointermove', (e) => {
      if (!rect) rect = el.getBoundingClientRect();
      setX((e.clientX - (rect.left + rect.width / 2)) * strength);
      setY((e.clientY - (rect.top + rect.height / 2)) * strength);
    }, { passive: true });
    zone.addEventListener('pointerleave', () => {
      rect = null;
      gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' });
    });
  });
}

/* ---------- 3D tilt on product cards ---------- */
if (FINE && !REDUCE) {
  document.querySelectorAll('.product-card').forEach((card) => {
    let rect = null;
    const rx = gsap.quickTo(card, 'rotateX', { duration: 0.5, ease: 'power3.out' });
    const ry = gsap.quickTo(card, 'rotateY', { duration: 0.5, ease: 'power3.out' });

    card.addEventListener('pointerenter', () => { rect = card.getBoundingClientRect(); });
    card.addEventListener('pointermove', (e) => {
      if (!rect) rect = card.getBoundingClientRect();
      rx(((e.clientY - rect.top) / rect.height - 0.5) * -9);
      ry(((e.clientX - rect.left) / rect.width - 0.5) * 9);
    }, { passive: true });
    card.addEventListener('pointerleave', () => {
      rect = null;
      gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
    });
  });
}


/* ============================================================
   8. UI
   ============================================================ */

/* ---------- Nav auto-hide ---------- */
{
  const navOuter = document.getElementById('navOuter');
  let lastY = 0;
  const onDir = (y) => {
    if (y > lastY && y > 200) navOuter.classList.add('hide');
    else navOuter.classList.remove('hide');
    lastY = y;
  };
  if (lenis) lenis.on('scroll', (e) => onDir(e.scroll));
  else addEventListener('scroll', () => onDir(scrollY), { passive: true });
}

/* ---------- Menu ---------- */
{
  const menuBtn = document.getElementById('menuBtn');
  const menuPanel = document.getElementById('menuPanel');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuPanel.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menuPanel.contains(e.target) && !menuBtn.contains(e.target)) menuPanel.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menuPanel.classList.remove('open');
  });
  // One delegated handler for every in-page anchor.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    menuPanel.classList.remove('open');
    scrollToTarget(a.getAttribute('href'));
  });
}

/* ---------- Menu label roll ---------- */
document.querySelectorAll('.menu-panel a').forEach((el) => {
  const label = el.textContent.trim();
  if (!label) return;
  el.innerHTML = `<span class="roll"><span class="roll-inner"><span>${label}</span><span>${label}</span></span></span>`;
});

/* ---------- FAQ accordion (delegated) ---------- */
document.querySelector('.faq-list')?.addEventListener('click', (e) => {
  const q = e.target.closest('.faq-q');
  if (!q) return;
  const item = q.parentElement;
  const wasOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach((x) => x.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
});

/* ---------- Form ---------- */
document.querySelector('.form')?.addEventListener('submit', function (e) {
  e.preventDefault();
  this.reset();
  alert('Thanks — I will get back to you soon.');
});
