/* eSheep — easter egg overlay for PowerKlock
   Trigger: invisible 24x24 hotspot, bottom-left corner of viewport.
   Click toggles the overlay on/off. When on:
     - 2 floating dots (spawn + wind) appear bottom-right
     - Sheep spawn from the top, fall, walk on platforms, use Mario pipes
     - Lightning strikes random sheep, wind blows them away
   Sheep auto-die after 3 minutes. Lifecycle is fully self-contained.
   Exposes only window.eSheepToggle() globally.
*/
(function () {
  'use strict';

  let active = false;
  let teardownFns = [];
  let allSheep = [];
  let DECOR = [], PLATS = [], PIPES = [], SKY_PIPES = [];
  let decorOn = false;
  let lightTimer = null, windTimer = null, autoWindTimer = null, rafId = null;
  let hotspot = null, dotsBar = null, btnSpawn = null, btnWind = null;

  // ── CONSTANTS ──
  const LIFE = 3 * 60 * 1000;
  const G = 1.1;
  const SZ = 40;
  const WO = '#e8e4d4', DK = '#4a4540', WH = '#fff', HF = '#3a3230';
  const Z_DECOR = 9990;     // platforms, pipes
  const Z_SHEEP = 9991;     // sheep sprites
  const Z_FX    = 9994;     // lightning, wind streaks
  const Z_DOTS  = 9996;     // control dots
  const Z_FLOAT = 9997;     // floating texts
  const Z_HOT   = 2147483647; // hotspot — max int, always on top

  // PowerKlock has a fixed ticker (top, ~28px) + topbar (~50px). We avoid them.
  function topMargin() {
    const tk = document.querySelector('.ticker');
    const tb = document.querySelector('.topbar');
    return (tk?.offsetHeight || 0) + (tb?.offsetHeight || 0) + 4;
  }
  function gnd() { return window.innerHeight - 30; }
  function viewW() { return window.innerWidth; }

  // ── ANIMATION KEYFRAMES + STYLES ──
  const STYLE_TAG_ID = 'esheep-styles';
  const STYLE_CSS = `
.es-sprite{position:fixed;cursor:pointer;user-select:none;pointer-events:all;transform-origin:center bottom;z-index:${Z_SHEEP}}
.es-platform{position:fixed;z-index:${Z_DECOR};pointer-events:none;height:14px;border-radius:3px;background:#7c4f1e;border-top:3px solid #a0632a;border-bottom:2px solid #5a3612;opacity:0;transition:opacity .8s ease;background-image:repeating-linear-gradient(90deg,#a0632a 0,#a0632a 16px,#8b5520 16px,#8b5520 17px)}
.es-pipe{position:fixed;z-index:${Z_DECOR};pointer-events:none;opacity:0;transition:opacity .8s ease;display:flex;flex-direction:column;align-items:center}
.es-pipe-cap{width:54px;height:16px;background:linear-gradient(180deg,#4ade80 0%,#16a34a 100%);border:2px solid #14532d;border-radius:3px 3px 0 0;box-shadow:inset 0 3px 0 rgba(255,255,255,.25),inset -3px 0 0 rgba(0,0,0,.2);flex-shrink:0}
.es-pipe-body{width:44px;background:linear-gradient(90deg,#15803d 0%,#22c55e 40%,#16a34a 70%,#14532d 100%);border-left:2px solid #14532d;border-right:2px solid #4ade80;flex:1}
.es-ft{position:fixed;z-index:${Z_FLOAT};pointer-events:none;font-weight:900;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,.95);animation:esFtUp 1.3s ease forwards;font-family:sans-serif}
.es-bolt{position:fixed;z-index:${Z_FX};pointer-events:none;animation:esBFlash .5s ease forwards}
.es-sflash{position:fixed;inset:0;z-index:${Z_FX};pointer-events:none;background:rgba(255,255,120,.22);animation:esSfOut .4s ease forwards}
.es-wstreak{position:fixed;height:2px;pointer-events:none;z-index:${Z_FX};border-radius:1px;background:linear-gradient(90deg,transparent,rgba(160,220,255,.7),transparent);animation:esWL linear forwards}
.es-burning{animation:esBurn .8s ease forwards;pointer-events:none}
.es-hotspot{position:fixed!important;left:calc(var(--sidebar-w, 220px) + 8px)!important;bottom:8px!important;width:18px!important;height:18px!important;z-index:2147483647!important;cursor:pointer!important;border-radius:50%!important;background:rgba(0,212,168,.18)!important;border:1.5px solid rgba(0,212,168,.55)!important;box-shadow:0 0 8px rgba(0,212,168,.35),inset 0 0 4px rgba(0,212,168,.25)!important;transition:background .2s ease,border-color .2s ease,transform .2s ease,box-shadow .2s ease!important;pointer-events:auto!important;display:block!important;visibility:visible!important;opacity:1!important}
.es-hotspot:hover{background:rgba(0,212,168,.45)!important;border-color:rgba(0,212,168,.9)!important;box-shadow:0 0 14px rgba(0,212,168,.7),inset 0 0 6px rgba(0,212,168,.4)!important;transform:scale(1.25)!important}
.es-hotspot::after{content:'';position:absolute;inset:5px;border-radius:50%;background:rgba(0,212,168,.7);animation:esHotPulse 2.4s ease-in-out infinite}
@keyframes esHotPulse{0%,100%{opacity:.5;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
.es-dotsbar{position:fixed;right:14px;bottom:14px;display:flex;gap:10px;align-items:center;background:rgba(13,21,32,.85);border:1px solid #1e2d3d;border-radius:14px;padding:6px 10px;z-index:${Z_DOTS};backdrop-filter:blur(4px);font-family:monospace}
.es-dot{width:10px;height:10px;border-radius:50%;background:#1e2d3d;cursor:pointer;transition:background .15s}
.es-dot.spawn:hover{background:#38bdf8}
.es-dot.wind:hover{background:#fb923c}
.es-dot.tornado:hover{background:#94a3b8}
.es-dot.close:hover{background:#ef4444}
.es-dotsbar-label{font-size:9px;color:#2a3f54;letter-spacing:.1em;margin-right:2px}
.es-p-in{animation:esPIn .35s ease forwards}.es-p-out{animation:esPOut .35s ease forwards}
@keyframes esFtUp{0%{transform:translateY(0) scale(.7);opacity:0}12%{transform:translateY(-4px) scale(1.05);opacity:1}75%{opacity:1}100%{transform:translateY(-38px) scale(.88);opacity:0}}
@keyframes esPIn{from{opacity:1;transform:scaleY(1)}to{opacity:0;transform:scaleY(.05) translateY(20px)}}
@keyframes esPOut{from{opacity:0;transform:scaleY(.05) translateY(-15px)}to{opacity:1;transform:scaleY(1)}}
@keyframes esBFlash{0%{opacity:0}8%{opacity:1}35%{opacity:.4}55%{opacity:1}100%{opacity:0}}
@keyframes esSfOut{0%{opacity:1}100%{opacity:0}}
@keyframes esBurn{0%{filter:brightness(1)}20%{filter:brightness(7) sepia(1) saturate(6)}100%{filter:brightness(1) sepia(1);opacity:0}}
@keyframes esWL{0%{opacity:0;transform:translateX(0)}10%{opacity:.9}85%{opacity:.5}100%{opacity:0;transform:translateX(-130vw)}}
@keyframes esWWalk{0%,100%{transform:translateY(0) scaleY(1)}35%{transform:translateY(-5px) scaleY(1.04)}65%{transform:translateY(-3px)}}
@keyframes esWRun{0%,100%{transform:translateY(0) rotate(0deg)}25%{transform:translateY(-10px) rotate(-4deg)}60%{transform:translateY(-5px) rotate(-2deg)}}
@keyframes esWFall{0%,100%{transform:scaleY(1) scaleX(1)}50%{transform:scaleY(1.16) scaleX(.87)}}
@keyframes esWSleep{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.04) scaleX(.98)}}
@keyframes esWYawn{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-7deg)}55%{transform:rotate(4deg)}}
@keyframes esWNod{0%,100%{transform:translateY(0)}20%{transform:translateY(5px) rotate(8deg)}50%{transform:translateY(-2px) rotate(-3deg)}70%{transform:translateY(4px) rotate(7deg)}}
@keyframes esWScratch{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px) rotate(-1.5deg)}75%{transform:translateX(2px) rotate(1.5deg)}}
@keyframes esWStare{0%,100%{transform:rotate(0deg) translateY(0)}35%{transform:rotate(-4deg) translateY(-3px)}65%{transform:rotate(3deg) translateY(-1px)}}
@keyframes esWDance{0%,100%{transform:rotate(0deg) translateY(0)}22%{transform:rotate(-8deg) translateY(-10px)}50%{transform:rotate(1deg) translateY(-2px)}72%{transform:rotate(8deg) translateY(-10px)}}
@keyframes esWHang{0%,100%{transform:translateX(0)}50%{transform:translateX(4px)}}
@keyframes esWWind{0%{transform:rotate(0deg)}100%{transform:rotate(-360deg)}}
@keyframes esLegA{0%,100%{transform:rotate(0deg)}50%{transform:rotate(16deg)}}
@keyframes esLegB{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-16deg)}}
@keyframes esLegRA{0%,100%{transform:rotate(0deg)}50%{transform:rotate(26deg)}}
@keyframes esLegRB{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-26deg)}}
@keyframes esDanceL{0%,100%{transform:rotate(0deg) translateY(0)}42%{transform:rotate(-22deg) translateY(-7px)}}
@keyframes esDanceR{0%,100%{transform:rotate(0deg) translateY(0)}58%{transform:rotate(22deg) translateY(-7px)}}
@keyframes esHangL{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-14deg)}}
@keyframes esHangR{0%,100%{transform:rotate(0deg)}50%{transform:rotate(14deg)}}
@keyframes esEarFL{0%,60%,100%{transform:rotate(0deg)}68%{transform:rotate(-18deg)}80%{transform:rotate(6deg)}90%{transform:rotate(-8deg)}}
@keyframes esEarFR{0%,30%,100%{transform:rotate(0deg)}36%{transform:rotate(14deg)}46%{transform:rotate(-5deg)}54%{transform:rotate(9deg)}}
@keyframes esEarRun{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-5deg)}}
@keyframes esBlinkD{0%,82%,100%{transform:scaleY(0)}88%{transform:scaleY(1)}}
@keyframes esTWag{0%,100%{transform:rotate(-14deg) scale(1)}50%{transform:rotate(14deg) scale(1.08)}}
@keyframes esZzUp{0%{transform:translateY(0) scale(1);opacity:.9}100%{transform:translateY(-28px) scale(.5);opacity:0}}
@keyframes esPipeFall{0%{transform:translateY(-120px);opacity:0}8%{opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes esPipeHover{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes esTornadoSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes esTornadoDrop{0%{transform:translateY(-200vh) scale(.3);opacity:0}15%{opacity:.4}30%{transform:translateY(0) scale(1);opacity:.85}80%{transform:translateY(0) scale(1);opacity:.85}100%{transform:translateY(0) scale(1.4);opacity:0}}
@keyframes esTornadoWobble{0%,100%{transform:translateX(0)}25%{transform:translateX(-12px)}75%{transform:translateX(12px)}}
@keyframes esSheepSpin{0%{transform:rotate(0deg) translateY(0)}100%{transform:rotate(720deg) translateY(-30px)}}
.es-tornado{position:fixed;z-index:${Z_FX};pointer-events:none;width:140px;height:280px}
.es-tornado-inner{width:100%;height:100%;animation:esTornadoSpin .35s linear infinite,esTornadoWobble 1.2s ease-in-out infinite}
.es-tornado-warning{position:fixed;font-size:20px;font-weight:900;color:#fbbf24;z-index:${Z_FLOAT};pointer-events:none;text-shadow:0 0 18px #fbbf24,0 1px 4px rgba(0,0,0,.95);font-family:monospace;animation:esFtUp 1.6s ease forwards}
.W-walk{animation:esWWalk .5s ease-in-out infinite}.W-run{animation:esWRun .22s ease-in-out infinite}
.W-fall{animation:esWFall .38s ease-in-out infinite}.W-sleep{animation:esWSleep 2.6s ease-in-out infinite}
.W-yawn{animation:esWYawn 2s ease-in-out infinite}.W-nod{animation:esWNod .55s ease-in-out infinite}
.W-scratch{animation:esWScratch .14s ease-in-out infinite}.W-stare{animation:esWStare 2.2s ease-in-out infinite}
.W-dance{animation:esWDance .62s ease-in-out infinite}.W-hang{animation:esWHang 1.1s ease-in-out infinite}
.W-wind{animation:esWWind .65s linear infinite}
.la{animation:esLegA .5s ease-in-out infinite}.lb{animation:esLegB .5s ease-in-out infinite}
.lra{animation:esLegRA .22s ease-in-out infinite}.lrb{animation:esLegRB .22s ease-in-out infinite}
.ls{animation:none}.dl{animation:esDanceL .62s ease-in-out infinite}.dr{animation:esDanceR .62s ease-in-out infinite}
.hla{animation:esHangL .9s ease-in-out infinite}.hlb{animation:esHangR .9s ease-in-out infinite}
.jla{animation:esLegA .4s ease-in-out infinite}.jlb{animation:esLegB .4s ease-in-out infinite}
.dla{animation:esLegA .62s ease-in-out infinite}.dlb{animation:esLegB .62s ease-in-out infinite}
.e-l{animation:esEarFL 4.2s ease-in-out infinite}.e-r{animation:esEarFR 2.8s ease-in-out infinite}
.e-run{animation:esEarRun .22s ease-in-out infinite}
.l-l{animation:esBlinkD 4.5s ease-in-out infinite;transform-origin:center top}
.l-r{animation:esBlinkD 4.5s ease-in-out infinite .07s;transform-origin:center top}
.t-wag{animation:esTWag .9s ease-in-out infinite}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_TAG_ID;
    s.textContent = STYLE_CSS;
    document.head.appendChild(s);
  }
  function removeStyles() {
    const s = document.getElementById(STYLE_TAG_ID);
    if (s) s.remove();
  }

  // ── SVG PARTS (sheep body) ──
  function W_(cx, cy, ry = 62, black = false) {
    const col = black ? '#1c1c1c' : WO;
    const rx = ry * 1.12;
    return `<circle cx="${cx}" cy="${cy}" r="${ry*.9}" fill="${col}"/>
<circle cx="${cx-rx*.58}" cy="${cy-10}" r="${ry*.58}" fill="${col}"/>
<circle cx="${cx+rx*.58}" cy="${cy-10}" r="${ry*.58}" fill="${col}"/>
<circle cx="${cx-rx*.38}" cy="${cy-ry*.68}" r="${ry*.56}" fill="${col}"/>
<circle cx="${cx+rx*.38}" cy="${cy-ry*.68}" r="${ry*.56}" fill="${col}"/>
<circle cx="${cx}" cy="${cy-ry*.78}" r="${ry*.54}" fill="${col}"/>
<circle cx="${cx-rx*.58}" cy="${cy+ry*.22}" r="${ry*.50}" fill="${col}"/>
<circle cx="${cx+rx*.58}" cy="${cy+ry*.22}" r="${ry*.50}" fill="${col}"/>`;
  }
  function E_(cx, cy, mode) {
    const lx = cx - 22, ly = cy - 20, rx = cx + 22, ry = cy - 20;
    if (mode === 'run') return `<g class="e-run" style="transform-origin:${lx}px ${ly}px"><path d="M${lx} ${ly} C${lx+4} ${ly-4} ${lx+46} ${ly+8} ${lx+50} ${ly+16} C${lx+42} ${ly+24} ${lx+4} ${ly+18} ${lx-2} ${ly+9}Z" fill="${DK}"/></g>`;
    return `<g class="e-l" style="transform-origin:${lx}px ${ly}px"><path d="M${lx} ${ly} C${lx-8} ${ly+2} ${lx-46} ${ly+12} ${lx-52} ${ly+22} C${lx-46} ${ly+32} ${lx-8} ${ly+22} ${lx+2} ${ly+10}Z" fill="${DK}"/></g>
<g class="e-r" style="transform-origin:${rx}px ${ry}px"><path d="M${rx} ${ry} C${rx+8} ${ry+2} ${rx+46} ${ry+12} ${rx+52} ${ry+22} C${rx+46} ${ry+32} ${rx+8} ${ry+22} ${rx-2} ${ry+10}Z" fill="${DK}"/></g>`;
  }
  function H_(cx, cy, eye) {
    const c = DK, w = WH, d = DK;
    let ey = '';
    if (eye === 'sleep') ey = `<path d="M${cx-27} ${cy+8} Q${cx-15} ${cy+2} ${cx-3} ${cy+8}" stroke="${w}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M${cx+3} ${cy+8} Q${cx+15} ${cy+2} ${cx+27} ${cy+8}" stroke="${w}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    else if (eye === 'dead') ey = `<text x="${cx-29}" y="${cy+16}" font-size="14" fill="${w}">✕</text><text x="${cx+5}" y="${cy+16}" font-size="14" fill="${w}">✕</text>`;
    else ey = `<circle cx="${cx-15}" cy="${cy+6}" r="14" fill="${w}"/><circle cx="${cx+15}" cy="${cy+6}" r="14" fill="${w}"/><circle cx="${cx-14}" cy="${cy+8}" r="8" fill="${d}"/><circle cx="${cx+16}" cy="${cy+8}" r="8" fill="${d}"/><circle cx="${cx-17}" cy="${cy+3}" r="3.5" fill="${w}"/><circle cx="${cx+13}" cy="${cy+3}" r="3.5" fill="${w}"/><g class="l-l" style="transform-origin:${cx-15}px ${cy-8}px;transform:scaleY(0)"><rect x="${cx-29}" y="${cy-8}" width="28" height="15" rx="4" fill="${d}"/></g><g class="l-r" style="transform-origin:${cx+15}px ${cy-8}px;transform:scaleY(0)"><rect x="${cx+1}" y="${cy-8}" width="28" height="15" rx="4" fill="${d}"/></g>`;
    return `<path d="M${cx} ${cy-36} C${cx+28} ${cy-36} ${cx+44} ${cy-16} ${cx+44} ${cy+10} C${cx+44} ${cy+38} ${cx+26} ${cy+54} ${cx} ${cy+56} C${cx-26} ${cy+54} ${cx-44} ${cy+38} ${cx-44} ${cy+10} C${cx-44} ${cy-16} ${cx-28} ${cy-36} ${cx} ${cy-36}Z" fill="${c}"/>${ey}<ellipse cx="${cx}" cy="${cy+38}" rx="10" ry="6" fill="${HF}" opacity=".55"/>`;
  }
  function T_(cx, cy) {
    return `<g class="t-wag" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="11" fill="${WO}"/><circle cx="${cx-3}" cy="${cy-3}" r="7" fill="${WO}"/></g>`;
  }
  function L_(x, y, cls, h = 50) {
    return `<g class="${cls}" style="transform-origin:${x+7}px ${y}px"><rect x="${x}" y="${y}" width="14" height="${h}" rx="5" fill="${DK}"/><rect x="${x-3}" y="${y+h-12}" width="20" height="12" rx="4" fill="${HF}"/></g>`;
  }
  function LB_(x1, y1, ang, len, cls = '') {
    const r = ang * Math.PI / 180, x2 = x1 + Math.cos(r) * len, y2 = y1 + Math.sin(r) * len;
    return `<g class="${cls}" style="transform-origin:${x1}px ${y1}px"><rect x="${x1}" y="${y1-6}" width="${len}" height="13" rx="5" fill="${DK}" transform="rotate(${ang} ${x1} ${y1})"/><ellipse cx="${x2}" cy="${y2}" rx="9" ry="7" fill="${HF}" transform="rotate(${ang} ${x2} ${y2})"/></g>`;
  }

  // ── POSES ──
  function pStand(la = 'la', lb = 'lb', eye = 'open', black = false) {
    if (eye === 'open' || eye === 'dead') return `${L_(45,138,lb)}${L_(95,138,lb)}${T_(18,115)}${W_(80,105,58,black)}${L_(36,134,la)}${L_(86,134,la)}${E_(80,50)}${H_(80,50,eye)}`;
    return `${L_(45,138,'ls')}${L_(95,138,'ls')}${T_(18,115)}${W_(80,105,58,black)}${L_(36,134,'ls')}${L_(86,134,'ls')}${E_(80,50)}${H_(80,50,'sleep')}`;
  }
  function pRun() {
    return `<g transform="translate(-8,0)">${L_(24,136,'lrb')}${L_(56,140,'lrb')}<ellipse cx="88" cy="100" rx="68" ry="50" fill="${WO}"/><circle cx="34" cy="88" r="36" fill="${WO}"/><circle cx="52" cy="62" r="36" fill="${WO}"/><circle cx="82" cy="54" r="34" fill="${WO}"/><circle cx="112" cy="62" r="34" fill="${WO}"/><circle cx="130" cy="84" r="32" fill="${WO}"/><circle cx="126" cy="108" r="28" fill="${WO}"/>${T_(10,102)}<circle cx="36" cy="108" r="28" fill="${WO}"/><circle cx="14" cy="94" r="20" fill="${WO}"/>${L_(88,136,'lra')}${L_(116,132,'lra')}<g class="e-run" style="transform-origin:148px 58px"><path d="M148 58 C154 56 192 64 196 72 C188 82 154 76 146 68Z" fill="${DK}"/></g><path d="M152 30 C174 30 188 48 188 68 C188 90 174 106 152 108 C130 106 116 90 116 68 C116 48 130 30 152 30Z" fill="${DK}"/><circle cx="162" cy="64" r="12" fill="${WH}"/><circle cx="163" cy="66" r="7" fill="${DK}"/><circle cx="160" cy="61" r="3" fill="${WH}"/><ellipse cx="178" cy="82" rx="8" ry="5" fill="${HF}" opacity=".6"/></g>`;
  }
  function pDance() {
    return `${T_(18,115)}${W_(80,108,58)}${LB_(52,126,-50,42,'dla')}${LB_(108,126,-130,42,'dlb')}${E_(80,54)}${H_(80,54)}${L_(46,136,'dl')}${L_(88,136,'dr')}`;
  }
  function pWindFly() {
    return `${T_(18,115)}${W_(80,108,58)}${E_(80,54)}${H_(80,54)}${LB_(36,90,-120,38,'jla')}${LB_(60,85,-80,38,'jlb')}${LB_(98,85,-60,38,'jla')}${LB_(118,88,-40,38,'jlb')}`;
  }
  function pHang() {
    return `<g transform="translate(0,10) rotate(180 80 90)">${L_(45,136,'hla')}${L_(95,136,'hla')}${T_(18,115)}${W_(80,105,58)}${L_(36,134,'hlb')}${L_(86,134,'hlb')}${E_(80,42)}${H_(80,50)}</g>`;
  }

  // ── DECOR (platforms + pipes) ──
  function buildDecor() {
    const W = viewW(), H = window.innerHeight, top = topMargin();
    const A = H - top - 30; // available height between topbar and ground

    // Platforms — 6 random, scaled to viewport
    // Top platforms are narrower to let sheep fall through to ground or lower platforms
    const layout = [
      { xR: .06, yR: .50, wR: .14 },  // mid-left, smaller
      { xR: .28, yR: .33, wR: .12 },  // upper-mid, much smaller
      { xR: .54, yR: .46, wR: .14 },  // mid, smaller
      { xR: .68, yR: .22, wR: .11 },  // upper-right, much smaller
      { xR: .14, yR: .68, wR: .20 },  // lower-left, wider (bottom is OK)
      { xR: .42, yR: .58, wR: .16 }   // mid-low, normal
    ];
    layout.forEach(d => {
      const x = d.xR * W, y = top + d.yR * A, w = d.wR * W;
      const el = document.createElement('div');
      el.className = 'es-platform';
      el.style.cssText = `left:${x}px;top:${y}px;width:${w}px`;
      document.body.appendChild(el);
      PLATS.push({ x, y, w });
      DECOR.push(el);
    });

    // Pipes
    const GND = gnd();
    function mkPipe(x, anchorY, bodyH = 55) {
      const capH = 16, total = capH + bodyH;
      const el = document.createElement('div');
      el.className = 'es-pipe';
      el.style.cssText = `left:${x}px;top:${anchorY}px;height:${total}px;width:54px`;
      const cap = document.createElement('div'); cap.className = 'es-pipe-cap';
      const body = document.createElement('div'); body.className = 'es-pipe-body';
      body.style.height = bodyH + 'px';
      el.appendChild(cap); el.appendChild(body);
      document.body.appendChild(el);
      DECOR.push(el);
      return { el, x, w: 54, capH, bodyH, total, mouthY: anchorY, midX: x + 27 };
    }
    const bodyGnd = 65;
    const p0in = mkPipe(30, GND - (16 + bodyGnd), bodyGnd);
    const p0out = mkPipe(PLATS[2].x + PLATS[2].w / 2 - 27, PLATS[2].y - (16 + 40), 40);
    PIPES.push({ in: p0in, out: p0out });
    const p1in = mkPipe(W - 30 - 54, GND - (16 + bodyGnd), bodyGnd);
    const p1out = mkPipe(PLATS[3].x + PLATS[3].w / 2 - 27, PLATS[3].y - (16 + 40), 40);
    PIPES.push({ in: p1in, out: p1out });

    // Sky pipes (hanging from top)
    if (PLATS.length >= 5) {
      const targets = [PLATS[4]];
      const xs = [W * 0.5];
      targets.forEach((tgt, i) => {
        const el = document.createElement('div');
        el.className = 'es-pipe';
        const capH = 16, bodyH = 50, total = capH + bodyH;
        el.style.cssText = `left:${xs[i]-27}px;top:${top + 8}px;height:${total}px;width:54px;animation:esPipeFall .8s ease-out forwards, esPipeHover 2.4s ease-in-out infinite ${i*.8}s`;
        const body = document.createElement('div'); body.className = 'es-pipe-body'; body.style.height = bodyH + 'px';
        const cap = document.createElement('div'); cap.className = 'es-pipe-cap';
        el.appendChild(body); el.appendChild(cap);
        document.body.appendChild(el);
        DECOR.push(el);
        const mouthY = top + 8 + total;
        SKY_PIPES.push({ el, x: xs[i] - 27, w: 54, midX: xs[i], mouthY, tgt });
      });
    }
  }

  function showDecor() {
    if (decorOn) return;
    decorOn = true;
    DECOR.forEach(e => e.style.opacity = '1');
  }
  function hideDecor() {
    decorOn = false;
    DECOR.forEach(e => { e.style.transition = 'opacity 1.8s ease'; e.style.opacity = '0'; });
  }
  function checkDecor() {
    if (allSheep.filter(s => s.alive).length === 0 && decorOn) hideDecor();
  }

  // ── STATE / SHEEP LOGIC ──
  const ST = { FALL: 'fall', WALK: 'walk', RUN: 'run', DANCE: 'dance', SCRATCH: 'scratch', HANG: 'hang', YAWN: 'yawn', STARE: 'stare', SLEEP: 'sleep', NOD: 'nod', PIPE: 'pipe', GRAB: 'grab' };
  const BEEHS = ['Beeeh !', 'Bêê !', 'Béé..', 'Bééé !', 'Beeh !!', 'Bêê bêê !', 'Meeeh !', 'BÊÊÊH !'];
  const ZZZES = ['z', 'zz', 'z z z', 'Zzz..', '💤'];
  const WINDTXT = ['BÊÊÊ !!', 'Aaah !', 'Noooon !', 'Beeeh !!', '💨'];
  const POSE_MAP = { [ST.WALK]: 'W-walk', [ST.RUN]: 'W-run', [ST.FALL]: 'W-fall', [ST.SLEEP]: 'W-sleep', [ST.YAWN]: 'W-yawn', [ST.NOD]: 'W-nod', [ST.SCRATCH]: 'W-scratch', [ST.STARE]: 'W-stare', [ST.DANCE]: 'W-dance', [ST.HANG]: 'W-hang' };

  function surfs() { return [{ x: 0, y: gnd(), w: viewW(), isGround: true }, ...PLATS.map(p => ({ x: p.x, y: p.y, w: p.w, isGround: false }))]; }

  function mkSVG(s, state) {
    let inner;
    if (state === ST.RUN) inner = pRun();
    else if (state === ST.DANCE) inner = pDance();
    else if (state === ST.HANG) inner = pHang();
    else if (state === ST.SLEEP) inner = pStand('ls', 'ls', 'sleep', s.black);
    else inner = pStand('la', 'lb', 'open', s.black);
    const cls = POSE_MAP[state] || '';
    if (state === ST.RUN) {
      s.el.style.transform = `scaleX(${s.dir})`;
      return `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" class="${cls}">${inner}</svg>`;
    }
    s.el.style.transform = '';
    return `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" class="${cls}" style="--fx:${s.dir}">${inner}</svg>`;
  }
  function rdr(s, state) { s.el.innerHTML = mkSVG(s, state); }
  function pos(s) { s.el.style.left = s.x + 'px'; s.el.style.top = s.y + 'px'; }
  function xfm(s) {
    if (s.state === ST.RUN) { s.el.style.transform = `scaleX(${s.dir})`; }
    else { s.el.style.transform = ''; s.el.querySelectorAll('svg').forEach(sv => sv.style.setProperty('--fx', s.dir)); }
  }
  function go(s, state) { s.state = state; rdr(s, state); }
  function ft(s, txt, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'es-ft';
    el.textContent = txt;
    el.style.color = color;
    el.style.fontSize = '12px';
    el.style.left = (s.x + 4) + 'px';
    el.style.top = (s.y - 8) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }
  function mkZzz() {
    const z = document.createElement('div');
    z.className = 'es-ft';
    z.textContent = ZZZES[Math.floor(Math.random() * ZZZES.length)];
    z.style.cssText = `color:#93c5fd;font-size:13px;animation:esZzUp 2.5s ease-in-out infinite;z-index:${Z_FLOAT}`;
    document.body.appendChild(z);
    return z;
  }
  function clearZzz(s) { if (s.zzEl) { s.zzEl.remove(); s.zzEl = null; } }
  function updZzz(s) { if (s.zzEl) { s.zzEl.style.left = (s.x + SZ * .6) + 'px'; s.zzEl.style.top = (s.y - 4) + 'px'; } }

  function isCrowded(s) {
    return allSheep.filter(o => o !== s && o.alive && !o.windOut && Math.hypot(o.x - s.x, o.y - s.y) < 200).length > 1;
  }

  function pickState(s) {
    const crowded = isCrowded(s);
    const r = Math.random();
    if (crowded) {
      if (r < .35) { go(s, ST.RUN); s.timer = 40 + Math.floor(Math.random() * 40); }
      else if (r < .70) { tryJump(s); }
      else { s.dir *= -1; xfm(s); go(s, ST.RUN); s.timer = 30 + Math.floor(Math.random() * 30); }
    } else {
      if (r < .20) { go(s, ST.SLEEP); s.timer = 100 + Math.floor(Math.random() * 180); s.zzEl = mkZzz(); }
      else if (r < .35) { go(s, ST.DANCE); s.timer = 80 + Math.floor(Math.random() * 100); }
      else if (r < .45) { go(s, ST.YAWN); s.timer = 50; }
      else if (r < .55) { go(s, ST.STARE); s.timer = 40 + Math.floor(Math.random() * 40); }
      else if (r < .65) { go(s, ST.NOD); s.timer = 30 + Math.floor(Math.random() * 30); }
      else { s.dir *= -1; xfm(s); go(s, ST.WALK); s.timer = 60 + Math.floor(Math.random() * 80); }
    }
  }

  function tryJump(s) {
    const reach = PLATS.filter(p => { const dx = Math.abs((p.x + p.w / 2) - (s.x + SZ)); const dy = s.y - p.y; return dx < 360 && dy > -60 && dy < 320; });
    if (!reach.length) return false;
    const scored = reach.map(p => {
      const occ = allSheep.filter(s2 => s2.alive && s2 !== s && Math.abs((s2.x + SZ) - (p.x + p.w / 2)) < p.w * .6).length;
      return { p, score: occ + (Math.random() * .4) };
    }).sort((a, b) => a.score - b.score);
    const tgt = scored[0].p;
    const tx = tgt.x + tgt.w / 2 - SZ;
    const dy = Math.max(20, s.y - (tgt.y - SZ * 2));
    s.vx = (tx - s.x) / 14;
    s.vy = -(dy * .20 + 8);
    s.dir = s.vx >= 0 ? 1 : -1;
    xfm(s);
    s.state = ST.FALL;
    s.surf = null;
    return true;
  }

  function spawn() {
    const black = Math.random() < .04;
    const el = document.createElement('div');
    el.className = 'es-sprite';
    el.style.cssText = `width:${SZ*2}px;height:${SZ*2}px;z-index:${Z_SHEEP + Math.floor(Math.random()*30)};opacity:0`;
    document.body.appendChild(el);
    const W = viewW();
    // Anti-cluster: try 6 candidate x positions, pick the one farthest from existing sheep
    const margin = SZ * 2;
    const range = W - SZ * 4;
    let bestX = margin + Math.random() * range, bestDist = -1;
    for (let i = 0; i < 6; i++) {
      const cx = margin + Math.random() * range;
      let minDist = Infinity;
      allSheep.forEach(o => {
        if (!o.alive) return;
        const d = Math.abs(o.x - cx);
        if (d < minDist) minDist = d;
      });
      if (minDist === Infinity) { bestX = cx; break; }
      if (minDist > bestDist) { bestDist = minDist; bestX = cx; }
    }
    const sx = bestX;
    const sy = topMargin() + 5;
    // Strong horizontal velocity to push them sideways while falling
    const vx0 = (Math.random() - .5) * 6;
    const s = {
      el, black, x: sx, y: sy, vx: vx0, vy: 0,
      dir: Math.random() < .5 ? 1 : -1,
      state: ST.FALL, tick: 0, timer: 0, alive: true, grabbed: false,
      gox: 0, goy: 0, surf: null, zzEl: null, windOut: false
    };
    rdr(s, ST.FALL); pos(s);
    setTimeout(() => el.style.opacity = '1', 50);
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (!s.alive || s.state === ST.PIPE) return;
      s.grabbed = true; s.state = ST.GRAB; s.surf = null;
      s.gox = e.clientX - s.x; s.goy = e.clientY - s.y;
      s.vx = 0; s.vy = 0; clearZzz(s);
      ft(s, BEEHS[Math.floor(Math.random() * BEEHS.length)]);
      el.style.cursor = 'grabbing';
    });
    allSheep.push(s);
    showDecor();
    setTimeout(() => {
      if (!s.alive) return;
      s.alive = false; clearZzz(s);
      el.style.opacity = '0';
      setTimeout(() => { el.remove(); checkDecor(); }, 1200);
    }, LIFE);
    return s;
  }

  // Drag handlers (registered once at activation, removed at teardown)
  function onMouseMove(e) {
    allSheep.forEach(s => { if (!s.grabbed) return; s.x = e.clientX - s.gox; s.y = e.clientY - s.goy; pos(s); });
  }
  function onMouseUp() {
    allSheep.forEach(s => {
      if (!s.grabbed) return;
      s.grabbed = false; s.el.style.cursor = 'pointer';
      s.state = ST.FALL; s.vy = 1; s.vx = (Math.random() - .5) * 2;
    });
  }

  function enterPipe(s, pairIdx) {
    s.state = ST.PIPE; s.surf = null; s.vx = 0; s.vy = 0; clearZzz(s);
    const sv = s.el.querySelector('svg'); if (sv) sv.classList.add('es-p-in');
    setTimeout(() => {
      if (sv) sv.classList.remove('es-p-in');
      s.el.style.opacity = '0';
      setTimeout(() => {
        const out = PIPES[pairIdx].out;
        s.x = out.midX - SZ;
        s.y = out.mouthY - SZ * 2 - 4;
        pos(s); s.el.style.opacity = '1'; rdr(s, ST.FALL);
        const sv2 = s.el.querySelector('svg'); if (sv2) sv2.classList.add('es-p-out');
        setTimeout(() => {
          if (sv2) sv2.classList.remove('es-p-out');
          s.state = ST.FALL; s.vy = -(5 + Math.random() * 3); s.vx = (Math.random() - .5) * 2;
          s.dir = s.vx >= 0 ? 1 : -1; xfm(s);
        }, 380);
      }, 320);
    }, 350);
  }

  function tick(s) {
    if (!s.alive || s.grabbed || s.state === ST.PIPE) return;
    const W = viewW(), RIGHT = W - SZ * 2;
    const ss = surfs();
    s.tick++; if (s.timer > 0) s.timer--;
    if (s.windOut) {
      s.vx *= .995; s.vy += .15; s.x += s.vx; s.y += s.vy; pos(s);
      if (s.x < -150) { s.alive = false; clearZzz(s); s.el.style.opacity = '0'; setTimeout(() => { s.el.remove(); checkDecor(); }, 300); }
      return;
    }
    switch (s.state) {
      case ST.FALL: {
        s.vy = Math.min(s.vy + G, 18);
        s.x += s.vx; s.y += s.vy; s.vx *= .97;
        if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx) * .5; }
        if (s.x > RIGHT) { s.x = RIGHT; s.vx = -Math.abs(s.vx) * .5; }
        if (s.y < topMargin()) { s.y = topMargin(); s.vy = Math.abs(s.vy) * .3; }
        for (const sf of ss) {
          if (s.vy >= 0 && s.y + SZ * 2 >= sf.y - 4 && s.y + SZ * 2 <= sf.y + 32 && s.x + SZ * 2 > sf.x + 2 && s.x < sf.x + sf.w - 2) {
            s.y = sf.y - SZ * 2; s.vy = 0; s.vx = 0; s.surf = sf;
            go(s, ST.WALK); s.timer = 80 + Math.floor(Math.random() * 120); s.dir = Math.random() < .5 ? 1 : -1; xfm(s); break;
          }
        }
        for (let pi = 0; pi < PIPES.length; pi++) {
          const pin = PIPES[pi].in;
          if (s.x + SZ * 2 > pin.x + 4 && s.x < pin.x + pin.w - 4 && Math.abs(s.y + SZ * 2 - pin.mouthY) < 24) { enterPipe(s, pi); return; }
        }
        if (s.vy < 0) {
          for (const sp of SKY_PIPES) {
            if (s.x + SZ * 2 > sp.x + 4 && s.x < sp.x + sp.w - 4 && Math.abs(s.y + SZ * 2 - sp.mouthY) < 20) {
              s.state = ST.PIPE; s.surf = null; s.vx = 0; s.vy = 0;
              const sv = s.el.querySelector('svg'); if (sv) sv.classList.add('es-p-in');
              const tgt = sp.tgt;
              setTimeout(() => {
                if (sv) sv.classList.remove('es-p-in');
                s.el.style.opacity = '0';
                setTimeout(() => {
                  s.x = tgt.x + Math.random() * Math.max(0, tgt.w - SZ * 2);
                  s.y = tgt.y - SZ * 2 - 4;
                  pos(s); s.el.style.opacity = '1'; rdr(s, ST.FALL);
                  const sv2 = s.el.querySelector('svg'); if (sv2) sv2.classList.add('es-p-out');
                  setTimeout(() => {
                    if (sv2) sv2.classList.remove('es-p-out');
                    s.state = ST.FALL; s.vy = 0; s.vx = (Math.random() - .5) * 2;
                    s.dir = s.vx >= 0 ? 1 : -1; xfm(s);
                  }, 380);
                }, 320);
              }, 350);
              return;
            }
          }
        }
        if (s.vy < 0) {
          for (const p of PLATS) {
            if (s.x + SZ * 2 > p.x + 4 && s.x < p.x + p.w - 4 && s.y >= p.y && s.y <= p.y + 22 && Math.random() < .2) {
              s.state = ST.HANG; s.surf = { ...p }; s.y = p.y; s.vx = 0; s.vy = 0;
              s.timer = 40 + Math.floor(Math.random() * 50);
              go(s, ST.HANG); break;
            }
          }
        }
        break;
      }
      case ST.WALK:
      case ST.RUN: {
        const crowdedNow = isCrowded(s);
        const spd = s.state === ST.RUN ? (crowdedNow ? 4.5 : 2.8) : (crowdedNow ? 1.8 : 0.9);
        if (s.surf && !s.surf.isGround) {
          if (s.x + SZ * 2 < s.surf.x - 2 || s.x > s.surf.x + s.surf.w + 2) { s.surf = null; s.state = ST.FALL; s.vy = .5; break; }
          if (s.x <= s.surf.x) { s.x = s.surf.x; s.dir = 1; xfm(s); }
          if (s.x >= s.surf.x + s.surf.w - SZ * 2) { s.x = s.surf.x + s.surf.w - SZ * 2; s.dir = -1; xfm(s); }
        }
        s.x += s.dir * spd;
        if (s.x < 0) { s.x = 0; s.dir = 1; xfm(s); }
        if (s.x > RIGHT) { s.x = RIGHT; s.dir = -1; xfm(s); }
        for (let pi = 0; pi < PIPES.length; pi++) {
          const pin = PIPES[pi].in;
          if (s.x + SZ * 2 > pin.x + 4 && s.x < pin.x + pin.w - 4 && Math.abs(s.y + SZ * 2 - pin.mouthY) < 24) { enterPipe(s, pi); return; }
        }
        if (s.tick % 20 === 0) {
          const crowdCheck = isCrowded(s);
          if (crowdCheck) {
            const near = allSheep.filter(o => o !== s && o.alive && !o.windOut && Math.hypot(o.x - s.x, o.y - s.y) < 200);
            if (near.length > 0) {
              const cx = near.reduce((a, o) => a + o.x, 0) / near.length;
              s.dir = s.x < cx ? -1 : 1; xfm(s);
            }
            let usedPipe = false;
            for (let pi = 0; pi < PIPES.length; pi++) {
              const pin = PIPES[pi].in;
              if (Math.abs((s.x + SZ) - pin.midX) < 120 && Math.random() < .3) {
                s.dir = s.x + SZ < pin.midX ? 1 : -1; xfm(s); usedPipe = true; break;
              }
            }
            if (!usedPipe && Math.random() < .5) tryJump(s);
            if (s.state !== ST.RUN && s.state !== ST.FALL) { go(s, ST.RUN); s.timer = 40; }
          } else {
            if (s.state === ST.RUN && s.timer <= 0) { pickState(s); }
          }
        }
        if (s.tick % 35 === 0 && isCrowded(s) && Math.random() < .4) tryJump(s);
        if (s.timer <= 0) pickState(s);
        break;
      }
      case ST.HANG: {
        s.x += Math.sin(s.tick * .08) * .4; s.timer--;
        if (s.timer <= 0) { go(s, ST.FALL); s.surf = null; s.vy = 1; s.vx = (Math.random() - .5) * 2; ft(s, 'Bêê !'); }
        break;
      }
      case ST.SLEEP: { if (s.timer <= 0) { clearZzz(s); go(s, ST.WALK); s.timer = 60 + Math.floor(Math.random() * 80); } break; }
      case ST.STARE:
      case ST.YAWN:
      case ST.NOD:
      case ST.DANCE:
      case ST.SCRATCH: {
        if (s.state === ST.DANCE && s.tick % 20 === 0) ft(s, ['🎵', '🎶', '♪'][Math.floor(Math.random() * 3)], '#fbbf24');
        if (s.timer <= 0) { clearZzz(s); go(s, ST.WALK); s.timer = 60 + Math.floor(Math.random() * 80); }
        break;
      }
    }
    pos(s); updZzz(s);
  }

  // ── WIND ──
  let windActive = false;
  function triggerWind() {
    if (windActive) return;
    windActive = true;
    const H = window.innerHeight;
    const top = topMargin();
    for (let i = 0; i < 32; i++) setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'es-wstreak';
      el.style.cssText = `top:${top + Math.random()*(H-top)}px;width:${50+Math.random()*160}px;right:-180px;animation-duration:${.3+Math.random()*.35}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 600);
    }, i * 50);
    allSheep.forEach(s => {
      if (!s.alive || s.grabbed || s.state === ST.PIPE) return;
      clearZzz(s); s.surf = null; s.windOut = true;
      s.vx = -(9 + Math.random() * 7); s.vy = -(1 + Math.random() * 3); s.dir = -1;
      s.el.innerHTML = `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" class="W-wind" style="--fx:-1">${pWindFly()}</svg>`;
      ft(s, WINDTXT[Math.floor(Math.random() * WINDTXT.length)]);
    });
    hideDecor();
    setTimeout(() => windActive = false, 2500);
  }
  function schedAutoWind() {
    autoWindTimer = setTimeout(() => { triggerWind(); schedAutoWind(); }, 18000 + Math.random() * 22000);
  }

  // ── LIGHTNING ──
  function lightning() {
    const tgts = allSheep.filter(s => s.alive && !s.grabbed && s.state !== ST.PIPE && !s.windOut);
    if (!tgts.length) return;
    const s = tgts[Math.floor(Math.random() * tgts.length)];
    const cx = s.x + SZ, top = topMargin(), bH = Math.max(10, s.y - top);
    const cv = document.createElement('canvas');
    cv.className = 'es-bolt';
    cv.width = 30; cv.height = bH;
    cv.style.cssText = `left:${cx-15}px;top:${top}px`;
    document.body.appendChild(cv);
    const c = cv.getContext('2d');
    function bl(col, lw, bl2) {
      c.strokeStyle = col; c.lineWidth = lw; c.shadowColor = '#faff00'; c.shadowBlur = bl2;
      let bx = 15, by = 0; c.beginPath(); c.moveTo(bx, by);
      while (by < bH) { bx += (Math.random() - .5) * 18; bx = Math.max(2, Math.min(28, bx)); by += 10 + Math.random() * 8; c.lineTo(bx, by); }
      c.stroke();
    }
    bl('#fff', 4, 20); bl('#faff00', 2, 8);
    setTimeout(() => cv.remove(), 500);
    const fl = document.createElement('div'); fl.className = 'es-sflash';
    document.body.appendChild(fl); setTimeout(() => fl.remove(), 400);
    const bm = document.createElement('div');
    bm.style.cssText = `position:fixed;top:${top + 10}px;left:50%;transform:translateX(-50%);font-size:22px;font-weight:900;color:#faff00;z-index:${Z_FLOAT};pointer-events:none;text-shadow:0 0 18px #faff00;font-family:monospace;animation:esFtUp .9s ease forwards`;
    bm.textContent = '⚡ BOOOM ⚡';
    document.body.appendChild(bm); setTimeout(() => bm.remove(), 900);
    setTimeout(() => {
      if (!s.alive) return;
      s.alive = false; clearZzz(s); s.el.classList.add('es-burning');
      for (let i = 0; i < 5; i++) {
        const sp = document.createElement('div');
        sp.style.cssText = `position:fixed;z-index:${Z_FLOAT};pointer-events:none;font-size:${10+Math.random()*12}px;left:${s.x+Math.random()*SZ*2}px;top:${s.y+Math.random()*16}px;animation:esFtUp ${.4+Math.random()*.5}s ease forwards`;
        sp.textContent = ['⚡', '✨', '💫', '🔥'][Math.floor(Math.random() * 4)];
        document.body.appendChild(sp);
        setTimeout(() => sp.remove(), 700);
      }
      setTimeout(() => { s.el.remove(); checkDecor(); }, 800);
    }, 280);
  }
  function schedLight() {
    const alive = allSheep.filter(s => s.alive).length;
    const delay = Math.max(3000, 20000 - alive * 1500) + Math.random() * 4000;
    lightTimer = setTimeout(() => { lightning(); schedLight(); }, delay);
  }

  // ── TORNADO (anti-clustering) ──
  // Detects most populated platform/area, lands a tornado there, scatters sheep in all directions
  let tornadoTimer = null, tornadoActive = false;

  function findCrowdedSpot() {
    // Score each platform by # sheep on/near it; ground gets evaluated as 8 zones
    let best = null, bestCount = 0;
    PLATS.forEach(p => {
      const cnt = allSheep.filter(s => s.alive && !s.windOut &&
        s.x + SZ > p.x - 30 && s.x + SZ < p.x + p.w + 30 &&
        Math.abs((s.y + SZ * 2) - p.y) < 60).length;
      if (cnt > bestCount) { bestCount = cnt; best = { x: p.x + p.w / 2, y: p.y, kind: 'platform' }; }
    });
    // Check ground zones too
    const W = viewW(), GND = gnd(), zones = 6;
    for (let i = 0; i < zones; i++) {
      const zx = (i + .5) * W / zones;
      const cnt = allSheep.filter(s => s.alive && !s.windOut &&
        Math.abs(s.x + SZ - zx) < W / zones / 2 &&
        s.y + SZ * 2 > GND - 20).length;
      if (cnt > bestCount) { bestCount = cnt; best = { x: zx, y: GND, kind: 'ground' }; }
    }
    return best && bestCount >= 2 ? best : null;
  }

  function tornado() {
    if (tornadoActive) return;
    const spot = findCrowdedSpot();
    if (!spot) return;
    tornadoActive = true;
    const top = topMargin();

    // Warning text first
    const warn = document.createElement('div');
    warn.className = 'es-tornado-warning';
    warn.textContent = '🌪 TORNADO !';
    warn.style.left = (spot.x - 60) + 'px';
    warn.style.top = (top + 20) + 'px';
    document.body.appendChild(warn);
    setTimeout(() => warn.remove(), 1600);

    // Tornado SVG: layered rotating ellipses forming a vortex shape
    const tornadoEl = document.createElement('div');
    tornadoEl.className = 'es-tornado';
    tornadoEl.style.left = (spot.x - 70) + 'px';
    tornadoEl.style.top = (spot.y - 280) + 'px';
    tornadoEl.style.animation = 'esTornadoDrop 2.8s ease-out forwards';
    tornadoEl.innerHTML = `
      <div class="es-tornado-inner">
        <svg viewBox="0 0 140 280" width="140" height="280" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="es-torG1" cx="50%" cy="50%">
              <stop offset="0%" stop-color="#cbd5e1" stop-opacity=".9"/>
              <stop offset="60%" stop-color="#64748b" stop-opacity=".7"/>
              <stop offset="100%" stop-color="#334155" stop-opacity=".4"/>
            </radialGradient>
          </defs>
          <!-- vortex layers, narrower at bottom -->
          <ellipse cx="70" cy="260" rx="14" ry="10" fill="url(#es-torG1)"/>
          <ellipse cx="70" cy="230" rx="22" ry="14" fill="url(#es-torG1)" opacity=".85"/>
          <ellipse cx="70" cy="195" rx="32" ry="18" fill="url(#es-torG1)" opacity=".8"/>
          <ellipse cx="70" cy="155" rx="42" ry="22" fill="url(#es-torG1)" opacity=".75"/>
          <ellipse cx="70" cy="110" rx="54" ry="26" fill="url(#es-torG1)" opacity=".7"/>
          <ellipse cx="70" cy="60" rx="64" ry="30" fill="url(#es-torG1)" opacity=".65"/>
          <ellipse cx="70" cy="20" rx="68" ry="22" fill="url(#es-torG1)" opacity=".5"/>
          <!-- Debris particles -->
          <circle cx="40" cy="90" r="3" fill="#94a3b8" opacity=".8"/>
          <circle cx="100" cy="140" r="2" fill="#cbd5e1" opacity=".9"/>
          <circle cx="55" cy="180" r="2.5" fill="#94a3b8" opacity=".7"/>
          <circle cx="90" cy="210" r="2" fill="#e2e8f0" opacity=".8"/>
          <circle cx="65" cy="50" r="2" fill="#cbd5e1" opacity=".6"/>
        </svg>
      </div>
    `;
    document.body.appendChild(tornadoEl);

    // Phase 1: tornado landing — pull sheep slightly toward center
    const landDelay = 850;
    setTimeout(() => {
      const radius = 280;
      allSheep.forEach(s => {
        if (!s.alive || s.grabbed || s.state === ST.PIPE || s.windOut) return;
        const dx = s.x + SZ - spot.x;
        const dy = s.y + SZ - spot.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) return;
        // Pull inward briefly
        s.surf = null;
        s.vx = -dx / 30;
        s.vy = -Math.abs(dy) / 40 - 2;
        s.state = ST.FALL;
      });
    }, landDelay);

    // Phase 2: explosion — scatter sheep radially with strong velocities
    const explodeDelay = 1800;
    setTimeout(() => {
      const radius = 340;
      allSheep.forEach(s => {
        if (!s.alive || s.grabbed || s.state === ST.PIPE || s.windOut) return;
        const dx = s.x + SZ - spot.x;
        const dy = s.y + SZ - spot.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) return;
        clearZzz(s);
        s.surf = null;
        // Radial direction (or random if at center)
        const ang = dist < 5 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);
        const force = 14 + Math.random() * 6;
        s.vx = Math.cos(ang) * force;
        s.vy = Math.sin(ang) * force - 8; // upward bias
        s.dir = s.vx >= 0 ? 1 : -1;
        s.state = ST.FALL;
        ft(s, ['BÊÊÊ !', 'AAAH !', 'NOOOON !', '🌪'][Math.floor(Math.random() * 4)], '#fbbf24');
      });
    }, explodeDelay);

    // Cleanup
    setTimeout(() => {
      tornadoEl.remove();
      tornadoActive = false;
    }, 2800);
  }

  function schedTornado() {
    // Triggers when there are enough sheep to cluster (3+)
    const alive = allSheep.filter(s => s.alive).length;
    // Faster if more sheep, but never below 12s
    const delay = Math.max(12000, 35000 - alive * 1500) + Math.random() * 8000;
    tornadoTimer = setTimeout(() => {
      if (alive >= 3) tornado();
      schedTornado();
    }, delay);
  }

  // ── LOOP ──
  function loop() { allSheep.forEach(s => { if (!s.alive) return; tick(s); }); rafId = requestAnimationFrame(loop); }

  // ── ACTIVATE / DEACTIVATE ──
  function buildDots() {
    dotsBar = document.createElement('div');
    dotsBar.className = 'es-dotsbar';
    dotsBar.innerHTML = `
      <span class="es-dotsbar-label">eSheep</span>
      <div class="es-dot spawn" title="Spawn sheep"></div>
      <div class="es-dot wind" title="Wind"></div>
      <div class="es-dot tornado" title="Tornado"></div>
      <div class="es-dot close" title="Close"></div>
    `;
    document.body.appendChild(dotsBar);
    btnSpawn = dotsBar.querySelector('.spawn');
    btnWind = dotsBar.querySelector('.wind');
    const btnTornado = dotsBar.querySelector('.tornado');
    const btnClose = dotsBar.querySelector('.close');
    btnSpawn.addEventListener('click', e => { e.stopPropagation(); spawn(); });
    btnWind.addEventListener('click', e => { e.stopPropagation(); triggerWind(); });
    btnTornado.addEventListener('click', e => { e.stopPropagation(); tornado(); });
    btnClose.addEventListener('click', e => { e.stopPropagation(); deactivate(); });
  }

  function activate() {
    if (active) return;
    active = true;
    injectStyles();
    buildDecor();
    buildDots();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Spawn 3 sheep to kick things off
    for (let i = 0; i < 3; i++) setTimeout(() => spawn(), i * 250);
    schedLight();
    schedTornado();
    autoWindTimer = setTimeout(schedAutoWind, 5 * 60 * 1000);
    if (!rafId) loop();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    if (lightTimer) { clearTimeout(lightTimer); lightTimer = null; }
    if (windTimer) { clearTimeout(windTimer); windTimer = null; }
    if (autoWindTimer) { clearTimeout(autoWindTimer); autoWindTimer = null; }
    if (tornadoTimer) { clearTimeout(tornadoTimer); tornadoTimer = null; }
    tornadoActive = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    allSheep.forEach(s => { s.alive = false; clearZzz(s); if (s.el) s.el.remove(); });
    allSheep = [];
    DECOR.forEach(e => e.remove()); DECOR = [];
    PLATS = []; PIPES = []; SKY_PIPES = [];
    if (dotsBar) { dotsBar.remove(); dotsBar = null; }
    decorOn = false;
    removeStyles();
  }

  function toggle() { if (active) deactivate(); else activate(); }

  // ── HOTSPOT (visible trigger, bottom-left of main area) ──
  function buildHotspot() {
    // Ensure hotspot styles are loaded even when overlay is inactive
    injectHotspotStyles();
    hotspot = document.createElement('div');
    hotspot.className = 'es-hotspot';
    hotspot.title = 'eSheep';
    hotspot.setAttribute('aria-label', 'eSheep toggle');
    hotspot.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    document.body.appendChild(hotspot);
    // Re-append periodically to ensure it stays last child of body (= on top of stacking context)
    keepOnTopInterval = setInterval(() => {
      if (hotspot && hotspot.parentNode === document.body && document.body.lastElementChild !== hotspot) {
        document.body.appendChild(hotspot);
      }
    }, 2000);
  }

  let keepOnTopInterval = null;

  // Lightweight standalone CSS for the hotspot only (loaded permanently, not stripped on deactivate)
  const HOTSPOT_STYLE_ID = 'esheep-hotspot-styles';
  function injectHotspotStyles() {
    if (document.getElementById(HOTSPOT_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = HOTSPOT_STYLE_ID;
    s.textContent = `
.es-hotspot{position:fixed!important;left:calc(var(--sidebar-w, 220px) + 8px)!important;bottom:8px!important;width:18px!important;height:18px!important;z-index:2147483647!important;cursor:pointer!important;border-radius:50%!important;background:rgba(0,212,168,.18)!important;border:1.5px solid rgba(0,212,168,.55)!important;box-shadow:0 0 8px rgba(0,212,168,.35),inset 0 0 4px rgba(0,212,168,.25)!important;transition:background .2s ease,border-color .2s ease,transform .2s ease,box-shadow .2s ease!important;pointer-events:auto!important;display:block!important;visibility:visible!important;opacity:1!important}
.es-hotspot:hover{background:rgba(0,212,168,.45)!important;border-color:rgba(0,212,168,.9)!important;box-shadow:0 0 14px rgba(0,212,168,.7),inset 0 0 6px rgba(0,212,168,.4)!important;transform:scale(1.25)!important}
.es-hotspot::after{content:'';position:absolute;inset:5px;border-radius:50%;background:rgba(0,212,168,.7);animation:esHotPulse 2.4s ease-in-out infinite;pointer-events:none}
@keyframes esHotPulse{0%,100%{opacity:.5;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
`;
    document.head.appendChild(s);
  }

  // Install on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildHotspot);
  } else {
    buildHotspot();
  }

  // Public API
  window.eSheepToggle = toggle;
})();
