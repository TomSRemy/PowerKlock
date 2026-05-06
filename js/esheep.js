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
  const FOOT_OFFSET = 10; // pixels: distance from sprite bottom-edge up to actual feet
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
.es-hotspot{position:fixed!important;left:178px!important;top:calc(var(--ticker-h, 36px) + 18px)!important;bottom:auto!important;width:8px!important;height:8px!important;z-index:2147483647!important;cursor:pointer!important;border-radius:50%!important;background:rgba(180,190,200,.25)!important;border:none!important;box-shadow:none!important;transition:background .2s ease,transform .2s ease!important;pointer-events:auto!important;display:block!important;visibility:visible!important;opacity:1!important}
.es-hotspot:hover{background:rgba(180,190,200,.6)!important;transform:scale(1.4)!important}
.es-dotsbar{position:fixed;left:200px;top:calc(var(--ticker-h, 36px) + 12px);display:flex;gap:10px;align-items:center;background:rgba(13,21,32,.85);border:1px solid #1A2D44;border-radius:14px;padding:6px 10px;z-index:${Z_DOTS};backdrop-filter:blur(4px);font-family:monospace}
.es-dot{width:10px;height:10px;border-radius:50%;background:#1A2D44;cursor:pointer;transition:background .15s}
.es-dot.spawn:hover{background:#38bdf8}
.es-dot.wind:hover{background:#fb923c}
.es-dot.tornado:hover{background:#B8C9D9}
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
@keyframes esSerpent{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
.es-tongue{animation:esSerpent .5s ease-in-out infinite}
.es-ear-back{animation:esSerpent .5s ease-in-out infinite}
.es-ear-front{animation:esSerpent .5s ease-in-out infinite -.25s}
@keyframes esGhostRise{0%{transform:translateY(0);opacity:0}15%{opacity:.95}100%{transform:translateY(-90px);opacity:0}}
@keyframes esCloudDrift{0%,100%{transform:translateX(-25px)}50%{transform:translateX(25px)}}
@keyframes esPipeFall{0%{transform:translateY(-120px);opacity:0}8%{opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes esPipeHover{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes esCloudFloat{0%,100%{transform:translateX(0)}50%{transform:translateX(8px)}}
@keyframes esTornFullCycle{
  0%{opacity:0;filter:blur(8px) brightness(.5)}
  20%{opacity:.9;filter:blur(2px) brightness(.85)}
  30%{opacity:1;filter:blur(0) brightness(1)}
  70%{opacity:1;filter:blur(0) brightness(1)}
  100%{opacity:0;filter:blur(14px) brightness(1.5)}
}
@keyframes esTornBandSway{
  0%,100%{transform:translateX(calc(-50% - 18px))}
  50%{transform:translateX(calc(-50% + 18px))}
}
@keyframes esTornDebrisOrb{
  0%{transform:translateX(var(--rx)) scale(1);opacity:1}
  25%{transform:translateX(0) scale(.35);opacity:.25}
  50%{transform:translateX(calc(-1 * var(--rx))) scale(1);opacity:1}
  75%{transform:translateX(0) scale(.35);opacity:.25}
  100%{transform:translateX(var(--rx)) scale(1);opacity:1}
}
.es-tornado-warning{position:fixed;font-size:20px;font-weight:900;color:#fbbf24;z-index:${Z_FLOAT};pointer-events:none;text-shadow:0 0 18px #fbbf24,0 1px 4px rgba(0,0,0,.95);font-family:monospace;animation:esFtUp 1.6s ease forwards}
.W-walk{animation:esWWalk .5s ease-in-out infinite}.W-run{animation:esWRun .32s ease-in-out infinite}
.W-fall{animation:esWFall .38s ease-in-out infinite}.W-sleep{animation:esWSleep 2.6s ease-in-out infinite}
.W-yawn{animation:esWYawn 2s ease-in-out infinite}.W-nod{animation:esWNod .55s ease-in-out infinite}
.W-scratch{animation:esWScratch .14s ease-in-out infinite}.W-stare{animation:esWStare 2.2s ease-in-out infinite}
.W-dance{animation:esWDance .62s ease-in-out infinite}.W-hang{animation:esWHang 1.1s ease-in-out infinite}
.W-wind{animation:esWWind .65s linear infinite}
.la{animation:esLegA .5s ease-in-out infinite}.lb{animation:esLegB .5s ease-in-out infinite}
.lra{animation:esLegRA .32s ease-in-out infinite}.lrb{animation:esLegRB .32s ease-in-out infinite}
.ls{animation:none}.dl{animation:esDanceL .62s ease-in-out infinite}.dr{animation:esDanceR .62s ease-in-out infinite}
.hla{animation:esHangL .9s ease-in-out infinite}.hlb{animation:esHangR .9s ease-in-out infinite}
.jla{animation:esLegA .4s ease-in-out infinite}.jlb{animation:esLegB .4s ease-in-out infinite}
.dla{animation:esLegA .62s ease-in-out infinite}.dlb{animation:esLegB .62s ease-in-out infinite}
.e-l{animation:esEarFL 4.2s ease-in-out infinite}.e-r{animation:esEarFR 2.8s ease-in-out infinite}
.e-run{animation:esEarRun .32s ease-in-out infinite}
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
  function T_(cx, cy, black = false) {
    const col = black ? '#1c1c1c' : WO;
    return `<g class="t-wag" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="11" fill="${col}"/><circle cx="${cx-3}" cy="${cy-3}" r="7" fill="${col}"/></g>`;
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
    if (eye === 'open' || eye === 'dead') return `${L_(45,138,lb)}${L_(95,138,lb)}${T_(18,115,black)}${W_(80,105,58,black)}${L_(36,134,la)}${L_(86,134,la)}${E_(80,50)}${H_(80,50,eye)}`;
    return `${L_(45,138,'ls')}${L_(95,138,'ls')}${T_(18,115,black)}${W_(80,105,58,black)}${L_(36,134,'ls')}${L_(86,134,'ls')}${E_(80,50)}${H_(80,50,'sleep')}`;
  }
  function pRun(black = false) {
    // Body proportions matched to pStand (ratio ~1.78 instead of 2.44 which looked weird).
    // Body width 160px, scallops symmetrical top/bottom for a rounder silhouette.
    const wc = black ? '#1c1c1c' : WO;
    return `<g transform="translate(0,30)">
<g class="lrb" style="transform-origin:36px 110px"><rect x="30" y="100" width="13" height="50" rx="5" fill="${DK}"/><rect x="27" y="146" width="19" height="7" rx="3" fill="${HF}"/></g>
<g class="lrb" style="transform-origin:56px 110px"><rect x="50" y="100" width="13" height="50" rx="5" fill="${DK}"/><rect x="47" y="146" width="19" height="7" rx="3" fill="${HF}"/></g>
<g class="lra" style="transform-origin:110px 110px"><rect x="104" y="100" width="13" height="50" rx="5" fill="${DK}"/><rect x="101" y="146" width="19" height="7" rx="3" fill="${HF}"/></g>
<g class="lra" style="transform-origin:130px 110px"><rect x="124" y="100" width="13" height="50" rx="5" fill="${DK}"/><rect x="121" y="146" width="19" height="7" rx="3" fill="${HF}"/></g>
<ellipse cx="78" cy="74" rx="62" ry="42" fill="${wc}"/>
<circle cx="22" cy="56" r="22" fill="${wc}"/>
<circle cx="46" cy="42" r="24" fill="${wc}"/>
<circle cx="72" cy="34" r="24" fill="${wc}"/>
<circle cx="98" cy="34" r="24" fill="${wc}"/>
<circle cx="120" cy="42" r="24" fill="${wc}"/>
<circle cx="138" cy="56" r="22" fill="${wc}"/>
<circle cx="22" cy="92" r="20" fill="${wc}"/>
<circle cx="46" cy="106" r="22" fill="${wc}"/>
<circle cx="72" cy="112" r="22" fill="${wc}"/>
<circle cx="98" cy="112" r="22" fill="${wc}"/>
<circle cx="120" cy="106" r="22" fill="${wc}"/>
<circle cx="138" cy="92" r="20" fill="${wc}"/>
<g class="t-wag" style="transform-origin:0px 50px"><circle cx="0" cy="50" r="13" fill="${wc}"/></g>
<g transform="translate(154,50)">
<path d="M0 -36 C28 -36 44 -16 44 10 C44 38 26 54 0 56 C-26 54 -44 38 -44 10 C-44 -16 -28 -36 0 -36Z" fill="${DK}"/>
<circle cx="-15" cy="6" r="14" fill="${WH}"/>
<circle cx="15" cy="6" r="14" fill="${WH}"/>
<circle cx="-14" cy="8" r="8" fill="${DK}"/>
<circle cx="16" cy="8" r="8" fill="${DK}"/>
<circle cx="-17" cy="3" r="3.5" fill="${WH}"/>
<circle cx="13" cy="3" r="3.5" fill="${WH}"/>
<ellipse cx="0" cy="30" rx="15" ry="9" fill="${HF}"/>
<g class="es-tongue" style="transform-origin:0px 32px"><rect x="-44" y="28" width="44" height="9" rx="4.5" fill="#ec7194"/></g>
<ellipse cx="3" cy="30" rx="12" ry="9" fill="${HF}"/>
<ellipse cx="3" cy="28" rx="3.5" ry="2.5" fill="${DK}"/>
<g class="es-ear-back" style="transform-origin:-26px -22px"><path d="M-26 -22 C-34 -20 -76 -8 -82 2 C-76 14 -34 4 -24 -10Z" fill="${DK}"/></g>
<g class="es-ear-front" style="transform-origin:26px -22px"><path d="M26 -22 C18 -20 -28 -8 -34 2 C-28 14 18 4 28 -10Z" fill="${DK}" stroke="#1a0e08" stroke-width="1.8"/></g>
</g>
</g>`;
  }
  function pDance(black = false) {
    return `${T_(18,115,black)}${W_(80,108,58,black)}${LB_(52,126,-50,42,'dla')}${LB_(108,126,-130,42,'dlb')}${E_(80,54)}${H_(80,54)}${L_(46,136,'dl')}${L_(88,136,'dr')}`;
  }
  function pWindFly(black = false) {
    return `${T_(18,115,black)}${W_(80,108,58,black)}${E_(80,54)}${H_(80,54)}${LB_(36,90,-120,38,'jla')}${LB_(60,85,-80,38,'jlb')}${LB_(98,85,-60,38,'jla')}${LB_(118,88,-40,38,'jlb')}`;
  }
  function pHang(black = false) {
    return `<g transform="translate(0,10) rotate(180 80 90)">${L_(45,136,'hla')}${L_(95,136,'hla')}${T_(18,115,black)}${W_(80,105,58,black)}${L_(36,134,'hlb')}${L_(86,134,'hlb')}${E_(80,42)}${H_(80,50)}</g>`;
  }

  // List of all pipes — each pipe is bidirectional (entry AND exit)
  // Each entry: {el, x, w, mouthY, midX, mouthDir: 'up'|'down', anchor: {kind, ref}}
  let ALL_PIPES = [];
  let groundEl = null, cloudsEls = [];

  // ── DECOR (platforms + pipes + ground + clouds) ──
  function buildDecor() {
    const W = viewW(), H = window.innerHeight, top = topMargin();
    const A = H - top - 30; // available height between topbar and ground
    const GND = gnd();

    // ── GROUND LINE ──
    groundEl = document.createElement('div');
    groundEl.className = 'es-ground';
    groundEl.style.cssText = `position:fixed;left:0;right:0;top:${GND}px;height:6px;z-index:${Z_DECOR};pointer-events:none;background:linear-gradient(180deg,#5a3612 0%,#7c4f1e 30%,#5a3612 100%);border-top:2px solid #a0632a;opacity:0;transition:opacity .8s ease`;
    // Add some grass tufts
    const tufts = document.createDocumentFragment();
    for (let i = 0; i < Math.floor(W / 60); i++) {
      const t = document.createElement('div');
      const tx = Math.random() * W;
      t.style.cssText = `position:absolute;left:${tx}px;top:-5px;width:6px;height:7px;background:#4a7c1e;clip-path:polygon(0 100%,30% 0,50% 60%,70% 0,100% 100%);opacity:.7`;
      tufts.appendChild(t);
    }
    groundEl.appendChild(tufts);
    document.body.appendChild(groundEl);
    DECOR.push(groundEl);

    // ── PLATFORMS ──
    const layout = [
      { xR: .06, yR: .50, wR: .14 },
      { xR: .28, yR: .33, wR: .12 },
      { xR: .54, yR: .46, wR: .14 },
      { xR: .68, yR: .22, wR: .11 },
      { xR: .14, yR: .68, wR: .20 },
      { xR: .42, yR: .58, wR: .16 }
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

    // ── PIPES ──
    // mkPipe: creates a pipe element. mouthDir = 'up' (sheep enter from top) or 'down' (mouth at bottom — hangs)
    function mkPipe(x, anchorY, bodyH, mouthDir) {
      const capH = 16, total = capH + bodyH;
      const el = document.createElement('div');
      el.className = 'es-pipe';
      el.style.cssText = `left:${x}px;top:${anchorY}px;height:${total}px;width:54px`;
      const cap = document.createElement('div'); cap.className = 'es-pipe-cap';
      const body = document.createElement('div'); body.className = 'es-pipe-body';
      body.style.height = bodyH + 'px';
      if (mouthDir === 'up') {
        // Standing pipe: cap on top, body below
        el.appendChild(cap); el.appendChild(body);
        // mouthY = top of cap (where sheep enter/exit)
        var mouthY = anchorY;
      } else {
        // Hanging pipe: body on top, cap at bottom (mouth faces down)
        el.appendChild(body); el.appendChild(cap);
        var mouthY = anchorY + total; // bottom of cap
      }
      document.body.appendChild(el);
      DECOR.push(el);
      return { el, x, w: 54, capH, bodyH, total, mouthY, midX: x + 27, mouthDir };
    }

    // Ground pipes (mouth up)
    const bodyGnd = 65;
    const p0 = mkPipe(30, GND - (16 + bodyGnd), bodyGnd, 'up');
    ALL_PIPES.push(p0);
    const p1 = mkPipe(W - 30 - 54, GND - (16 + bodyGnd), bodyGnd, 'up');
    ALL_PIPES.push(p1);

    // Plateforme-top pipes (mouth up, sitting on a platform)
    const p2plat = PLATS[2];
    const p2 = mkPipe(p2plat.x + p2plat.w / 2 - 27, p2plat.y - (16 + 40), 40, 'up');
    ALL_PIPES.push(p2);
    const p3plat = PLATS[3];
    const p3 = mkPipe(p3plat.x + p3plat.w / 2 - 27, p3plat.y - (16 + 40), 40, 'up');
    ALL_PIPES.push(p3);

    // Pipes UNDER certain platforms (mouth down)
    // PLATS[1] (upper-mid) and PLATS[5] (mid-low)
    const underPlatforms = [PLATS[1], PLATS[5]];
    underPlatforms.forEach(p => {
      // pipe hangs from underside of platform, body 35px tall
      const pipe = mkPipe(p.x + p.w / 2 - 27, p.y + 14, 35, 'down');
      ALL_PIPES.push(pipe);
    });

    // Sky pipe (hanging from top of viewport, attached to a cloud)
    if (PLATS.length >= 5) {
      const cloudCx = W * 0.5;
      const cloudCy = top + 30;
      // Build cloud — fluffy oval shape with many bumps
      const cloud = document.createElement('div');
      cloud.className = 'es-cloud';
      cloud.style.cssText = `position:fixed;left:${cloudCx - 110}px;top:${cloudCy - 36}px;width:220px;height:80px;z-index:${Z_DECOR};pointer-events:none;opacity:0;transition:opacity 1.2s ease;animation:esCloudDrift 14s ease-in-out infinite`;
      cloud.innerHTML = `
        <svg viewBox="0 0 220 80" width="220" height="80" xmlns="http://www.w3.org/2000/svg" overflow="visible">
          <ellipse cx="110" cy="56" rx="106" ry="11" fill="#B8C9D9" opacity=".55"/>
          <ellipse cx="40" cy="50" rx="30" ry="18" fill="#B8C9D9"/>
          <ellipse cx="180" cy="52" rx="28" ry="17" fill="#B8C9D9"/>
          <ellipse cx="110" cy="40" rx="100" ry="32" fill="#e8eef4"/>
          <circle cx="38" cy="44" r="22" fill="#f5f8fb"/>
          <circle cx="62" cy="32" r="26" fill="#f5f8fb"/>
          <circle cx="88" cy="22" r="24" fill="#fbfdff"/>
          <circle cx="112" cy="18" r="28" fill="#fbfdff"/>
          <circle cx="138" cy="22" r="24" fill="#fbfdff"/>
          <circle cx="160" cy="32" r="26" fill="#f5f8fb"/>
          <circle cx="184" cy="44" r="22" fill="#f5f8fb"/>
          <circle cx="76" cy="48" r="18" fill="#f5f8fb"/>
          <circle cx="100" cy="50" r="20" fill="#f5f8fb"/>
          <circle cx="124" cy="50" r="20" fill="#f5f8fb"/>
          <circle cx="148" cy="48" r="18" fill="#f5f8fb"/>
          <ellipse cx="96" cy="14" rx="14" ry="5" fill="#ffffff" opacity=".75"/>
          <ellipse cx="128" cy="12" rx="10" ry="4" fill="#ffffff" opacity=".65"/>
          <ellipse cx="60" cy="28" rx="8" ry="3" fill="#ffffff" opacity=".55"/>
        </svg>
      `;
      document.body.appendChild(cloud);
      DECOR.push(cloud);
      cloudsEls.push(cloud);

      // Sky pipe: mouth down, body hidden inside cloud
      const skyPipeBodyH = 40;
      const skyPipe = mkPipe(cloudCx - 27, cloudCy + 8, skyPipeBodyH, 'down');
      // Pipe drifts together with the cloud — same animation
      skyPipe.el.style.animation = 'esCloudDrift 14s ease-in-out infinite';
      ALL_PIPES.push(skyPipe);
    }

    // Assign IDs to all pipes for routing
    ALL_PIPES.forEach((p, i) => { p.id = i; });

    // Keep PIPES array for backward compat (entries are pipes that mouth-up on ground/platform)
    PIPES.length = 0;
    ALL_PIPES.forEach(p => {
      if (p.mouthDir === 'up') PIPES.push({ in: p, out: p });
    });
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
    if (allSheep.filter(s => s.alive).length === 0 && decorOn) {
      hideDecor();
      // Auto-stop: cancel timers so no phantom wind/lightning/tornado fires later
      autoStopTimers();
    }
  }
  function autoStopTimers() {
    if (lightTimer) { clearTimeout(lightTimer); lightTimer = null; }
    if (windTimer) { clearTimeout(windTimer); windTimer = null; }
    if (autoWindTimer) { clearTimeout(autoWindTimer); autoWindTimer = null; }
    if (tornadoTimer) { clearTimeout(tornadoTimer); tornadoTimer = null; }
  }

  // ── STATE / SHEEP LOGIC ──
  const ST = { FALL: 'fall', WALK: 'walk', RUN: 'run', DANCE: 'dance', SCRATCH: 'scratch', HANG: 'hang', YAWN: 'yawn', STARE: 'stare', SLEEP: 'sleep', NOD: 'nod', PIPE: 'pipe', GRAB: 'grab' };
  const BEEHS = ['Beeeh !', 'Bêê !', 'Béé..', 'Bééé !', 'Beeh !!', 'Bêê bêê !', 'Meeeh !', 'BÊÊÊH !'];
  const ZZZES = ['z', 'zz', 'z z z', 'Zzz..', '💤'];
  const WINDTXT = ['BÊÊÊ !!', 'Bêêêê !', 'Beeeh !!', 'Béééh !', 'Bêêh !', '💨'];
  const POSE_MAP = { [ST.WALK]: 'W-walk', [ST.RUN]: 'W-run', [ST.FALL]: 'W-fall', [ST.SLEEP]: 'W-sleep', [ST.YAWN]: 'W-yawn', [ST.NOD]: 'W-nod', [ST.SCRATCH]: 'W-scratch', [ST.STARE]: 'W-stare', [ST.DANCE]: 'W-dance', [ST.HANG]: 'W-hang' };

  function surfs() { return [{ x: 0, y: gnd(), w: viewW(), isGround: true }, ...PLATS.map(p => ({ x: p.x, y: p.y, w: p.w, isGround: false }))]; }

  function mkSVG(s, state) {
    let inner;
    if (state === ST.RUN) inner = pRun(s.black);
    else if (state === ST.DANCE) inner = pDance(s.black);
    else if (state === ST.HANG) inner = pHang(s.black);
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
    const top = topMargin();
    const H = window.innerHeight;
    const A = H - top - 30;
    const scored = reach.map(p => {
      const occ = allSheep.filter(s2 => s2.alive && s2 !== s && Math.abs((s2.x + SZ) - (p.x + p.w / 2)) < p.w * .6).length;
      // Height penalty: plateforms higher up (smaller y) are less attractive
      // (p.y - top) / A → 0 at top, 1 at bottom; we want high y → low malus, low y → high malus
      const heightFraction = Math.max(0, Math.min(1, (p.y - top) / A));
      const heightMalus = (1 - heightFraction) * 1.6; // 0 = bottom, 1.6 = top
      return { p, score: occ + heightMalus + (Math.random() * .4) };
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
    // If timers were auto-stopped, restart them
    if (active && !lightTimer) schedLight();
    if (active && !tornadoTimer) schedTornado();
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

  function enterPipe(s, entryPipe) {
    s.state = ST.PIPE; s.surf = null; s.vx = 0; s.vy = 0; clearZzz(s);

    // Force the front-facing standing sprite for the pipe entry.
    s.el.innerHTML = `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" style="--fx:${s.dir}">${pStand('la','lb','open',s.black)}</svg>`;
    s.el.style.transform = '';

    // === MARIO ENTRY: sprite starts ABOVE pipe cap, slides down. ===
    // The clip line is FIXED in document space at the cap top (mouthY).
    // As the sprite translates down by N px, the clip-path "bottom inset" must increase by N
    // so the clip line stays at mouthY in viewport space.
    //
    // Sprite top y in viewport = s.y (initial) + translateY (animation).
    // We want bottom-of-visible region (in viewport) = mouthY.
    // So: visible-height-in-sprite = mouthY - s.y - translateY.
    // Clip inset bottom = SZ*2 - visible-height = SZ*2 - mouthY + s.y + translateY.

    s.x = entryPipe.midX - SZ;
    // Position: feet rest exactly on top of cap (mouthY = top of cap)
    s.y = entryPipe.mouthY - SZ * 2 + FOOT_OFFSET;
    pos(s);

    const sprH = SZ * 2;
    // At translateY=0, bottom inset = sprH - (mouthY - s.y) = sprH - (SZ*2 - FOOT_OFFSET) = FOOT_OFFSET
    // Round value: hide just the FOOT_OFFSET bottom padding (10px) at start
    const initialClip = sprH - (entryPipe.mouthY - s.y);
    // At translateY=sprH, bottom inset = initialClip + sprH = entire sprite hidden
    const finalClip = initialClip + sprH;

    s.el.style.zIndex = Z_DECOR + 1;
    s.el.style.clipPath = `inset(0 0 ${initialClip}px 0)`;
    void s.el.offsetWidth;
    s.el.style.transition = 'transform .55s ease-in, clip-path .55s ease-in';
    s.el.style.transform = `translateY(${sprH}px)`;
    s.el.style.clipPath = `inset(0 0 ${finalClip}px 0)`;

    setTimeout(() => {
      s.el.style.transition = '';
      s.el.style.transform = '';
      s.el.style.clipPath = '';
      s.el.style.zIndex = '';
      s.el.style.opacity = '0';

      const candidates = ALL_PIPES.filter(p => p !== entryPipe);
      if (!candidates.length) candidates.push(entryPipe);
      const out = candidates[Math.floor(Math.random() * candidates.length)];

      // Final position: feet on top of exit pipe cap
      s.x = out.midX - SZ;
      s.y = out.mouthY - SZ * 2 + FOOT_OFFSET;
      pos(s);

      s.el.innerHTML = `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" style="--fx:${s.dir}">${pStand('la','lb','open',s.black)}</svg>`;

      // Start: sprite tucked DOWN (translateY = sprH), entirely clipped (bottom inset = finalClip)
      const initialClip2 = sprH - (out.mouthY - s.y);
      const finalClip2 = initialClip2 + sprH;
      s.el.style.zIndex = Z_DECOR + 1;
      s.el.style.clipPath = `inset(0 0 ${finalClip2}px 0)`;
      s.el.style.transform = `translateY(${sprH}px)`;
      s.el.style.opacity = '1';

      void s.el.offsetWidth;

      // Animate out: slide back up, clip recedes back to initial
      s.el.style.transition = 'transform .55s ease-out, clip-path .55s ease-out';
      s.el.style.transform = '';
      s.el.style.clipPath = `inset(0 0 ${initialClip2}px 0)`;

      setTimeout(() => {
        s.el.style.transition = '';
        s.el.style.clipPath = '';
        s.el.style.zIndex = '';
        s.state = ST.FALL;
        if (out.mouthDir === 'up') {
          // Mario-style: sideways jump out of the pipe
          s.vy = -(8 + Math.random() * 3);
          s.vx = (Math.random() < .5 ? -1 : 1) * (4 + Math.random() * 2);
        } else {
          s.vy = 1 + Math.random() * 2;
          s.vx = (Math.random() < .5 ? -1 : 1) * (3 + Math.random() * 2);
        }
        s.dir = s.vx >= 0 ? 1 : -1; xfm(s);
      }, 550);
    }, 600);
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
          // Foot position is at s.y + SZ*2 - FOOT_OFFSET (closer to bottom of sprite, where feet are drawn)
          const footY = s.y + SZ * 2 - FOOT_OFFSET;
          if (s.vy >= 0 && footY >= sf.y - 4 && footY <= sf.y + 32 && s.x + SZ * 2 > sf.x + 2 && s.x < sf.x + sf.w - 2) {
            s.y = sf.y - SZ * 2 + FOOT_OFFSET; s.vy = 0; s.vx = 0; s.surf = sf;
            go(s, ST.WALK); s.timer = 80 + Math.floor(Math.random() * 120); s.dir = Math.random() < .5 ? 1 : -1; xfm(s); break;
          }
        }
        for (let pi = 0; pi < ALL_PIPES.length; pi++) {
          const p = ALL_PIPES[pi];
          if (s.x + SZ * 2 > p.x + 4 && s.x < p.x + p.w - 4) {
            const footY = s.y + SZ * 2 - FOOT_OFFSET;
            if (p.mouthDir === 'up' && Math.abs(footY - p.mouthY) < 24) {
              enterPipe(s, p); return;
            }
            // mouthDir === 'down': sheep entering from below (must be moving up)
            if (p.mouthDir === 'down' && s.vy < 0 && Math.abs(s.y - p.mouthY) < 20) {
              enterPipe(s, p); return;
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
        const spd = s.state === ST.RUN ? (crowdedNow ? 2.8 : 1.8) : (crowdedNow ? 1.8 : 0.9);
        if (s.surf && !s.surf.isGround) {
          if (s.x + SZ * 2 < s.surf.x - 2 || s.x > s.surf.x + s.surf.w + 2) { s.surf = null; s.state = ST.FALL; s.vy = .5; break; }
          if (s.x <= s.surf.x) { s.x = s.surf.x; s.dir = 1; xfm(s); }
          if (s.x >= s.surf.x + s.surf.w - SZ * 2) { s.x = s.surf.x + s.surf.w - SZ * 2; s.dir = -1; xfm(s); }
        }
        s.x += s.dir * spd;
        if (s.x < 0) { s.x = 0; s.dir = 1; xfm(s); }
        if (s.x > RIGHT) { s.x = RIGHT; s.dir = -1; xfm(s); }
        for (let pi = 0; pi < ALL_PIPES.length; pi++) {
          const p = ALL_PIPES[pi];
          if (p.mouthDir !== 'up') continue;
          const footY = s.y + SZ * 2 - FOOT_OFFSET;
          if (s.x + SZ * 2 > p.x + 4 && s.x < p.x + p.w - 4 && Math.abs(footY - p.mouthY) < 24) { enterPipe(s, p); return; }
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
            for (let pi = 0; pi < ALL_PIPES.length; pi++) {
              const p = ALL_PIPES[pi];
              if (p.mouthDir !== 'up') continue;
              if (Math.abs((s.x + SZ) - p.midX) < 120 && Math.random() < .3) {
                s.dir = s.x + SZ < p.midX ? 1 : -1; xfm(s); usedPipe = true; break;
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
    if (allSheep.filter(s => s.alive).length === 0) return;
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
      // KO sheep also get blown away — render them as flying KO (black + dead eyes)
      const flyBlack = s.black || s.state === 'ko';
      s.el.innerHTML = `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" class="W-wind" style="--fx:-1">${pWindFly(flyBlack)}</svg>`;
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
    const tgts = allSheep.filter(s => s.alive && !s.grabbed && s.state !== ST.PIPE && !s.windOut && s.state !== 'ko');
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
      // === KO PROGRESSIF: 1er coup = stun 2s + noir, 2e coup = fantôme + meurt ===
      s.koCount = (s.koCount || 0) + 1;

      // Brief electric flash
      s.el.style.filter = 'brightness(7) sepia(1) saturate(6)';
      setTimeout(() => { if (s.el) s.el.style.filter = ''; }, 180);
      clearZzz(s);

      // Initial sparks
      for (let i = 0; i < 5; i++) {
        const sp = document.createElement('div');
        sp.style.cssText = `position:fixed;z-index:${Z_FLOAT};pointer-events:none;font-size:${10+Math.random()*12}px;left:${s.x+Math.random()*SZ*2}px;top:${s.y+Math.random()*16}px;animation:esFtUp ${.4+Math.random()*.5}s ease forwards`;
        sp.textContent = ['⚡', '✨', '💫', '🔥'][Math.floor(Math.random() * 4)];
        document.body.appendChild(sp);
        setTimeout(() => sp.remove(), 700);
      }

      if (s.koCount === 1) {
        // ===== 1er COUP: KO 2s, devient noir, puis se relève =====
        s.state = 'ko';
        s.black = true;
        s.surf = null;
        s.vx = 0; s.vy = 0;
        setTimeout(() => {
          if (!s.el || !s.alive) return;
          s.el.innerHTML = `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" style="--fx:${s.dir}">${pStand('la','lb','dead',true)}</svg>`;
        }, 200);
        // Recover after 2s — sheep gets back up but stays black
        setTimeout(() => {
          if (!s.el || !s.alive) return;
          s.state = ST.WALK;
          s.timer = 60 + Math.floor(Math.random() * 60);
          rdr(s, ST.WALK);
        }, 2000);
      } else {
        // ===== 2e COUP: KO 4s + fantôme + disparait =====
        s.alive = false;
        s.state = 'ko';
        s.surf = null;
        s.vx = 0; s.vy = 0;
        setTimeout(() => {
          if (!s.el) return;
          s.el.innerHTML = `<svg viewBox="-10 -5 180 215" width="${SZ*2}" height="${SZ*2}" overflow="visible" style="--fx:${s.dir}">${pStand('la','lb','dead',true)}</svg>`;
        }, 200);

        // Ghost rises from the head — duration matches 3s lifecycle
        setTimeout(() => {
          if (!s.el || !s.el.parentNode) return;
          const ghost = document.createElement('div');
          ghost.style.cssText = `position:fixed;left:${s.x + SZ * .75}px;top:${s.y + 6}px;width:36px;height:42px;z-index:${Z_FLOAT};pointer-events:none;animation:esGhostRise 2.5s ease-out forwards`;
          ghost.innerHTML = `<svg viewBox="-18 -22 36 42" width="36" height="42" overflow="visible">
            <path d="M-14 -8 Q-14 -20 0 -20 Q14 -20 14 -8 L14 12 L9 6 L4 12 L0 6 L-4 12 L-9 6 L-14 12 Z" fill="#fff" stroke="#B8C9D9" stroke-width="1" opacity=".9"/>
            <circle cx="-5" cy="-10" r="2.2" fill="#1c1c1c"/>
            <circle cx="5" cy="-10" r="2.2" fill="#1c1c1c"/>
            <ellipse cx="0" cy="-2" rx="2.5" ry="2" fill="#1c1c1c"/>
          </svg>`;
          document.body.appendChild(ghost);
          setTimeout(() => ghost.remove(), 2700);
        }, 600);

        // Smoke puffs
        for (let i = 0; i < 4; i++) {
          setTimeout(() => {
            if (!s.el || !s.el.parentNode) return;
            const sm = document.createElement('div');
            sm.style.cssText = `position:fixed;z-index:${Z_FLOAT};pointer-events:none;font-size:${12+Math.random()*8}px;left:${s.x+10+Math.random()*(SZ*1.6)}px;top:${s.y+Math.random()*8}px;animation:esFtUp ${1.2+Math.random()*.6}s ease forwards;opacity:.7`;
            sm.textContent = ['💨', '·', '°'][Math.floor(Math.random() * 3)];
            document.body.appendChild(sm);
            setTimeout(() => sm.remove(), 1800);
          }, 200 + i * 450);
        }

        // Stay KO for 3s, then fade out and disappear
        setTimeout(() => {
          if (!s.el) return;
          s.el.style.transition = 'opacity 0.7s ease';
          s.el.style.opacity = '0';
          setTimeout(() => { if (s.el) { s.el.remove(); } checkDecor(); }, 800);
        }, 3000);
      }
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

    // Warning text
    const warn = document.createElement('div');
    warn.className = 'es-tornado-warning';
    warn.textContent = '🌪 TORNADO !';
    warn.style.left = (spot.x - 60) + 'px';
    warn.style.top = (top + 20) + 'px';
    document.body.appendChild(warn);
    setTimeout(() => warn.remove(), 1600);

    // Tornado container — anchored at spot.x, bottom at spot.y
    const tornadoEl = document.createElement('div');
    tornadoEl.className = 'es-tornado-v2';
    const tWidth = 200, tHeight = 300;
    tornadoEl.style.cssText = `position:fixed;left:${spot.x - tWidth/2}px;top:${spot.y - tHeight}px;width:${tWidth}px;height:${tHeight}px;z-index:${Z_FX};pointer-events:none;animation:esTornFullCycle 6s ease-in-out forwards`;

    // Build the serpent body (24 arcs with cascading delay)
    const bandSpec = [
      {y:22,rx:80,col:'#f1f5f9',op:.8,thick:7},
      {y:32,rx:78,col:'#B8C9D9',op:.7,thick:7},
      {y:42,rx:80,col:'#FFFFFF',op:.75,thick:7},
      {y:52,rx:75,col:'#FFFFFF',op:.7,thick:7},
      {y:62,rx:78,col:'#f1f5f9',op:.8,thick:7},
      {y:72,rx:73,col:'#B8C9D9',op:.75,thick:7},
      {y:82,rx:73,col:'#FFFFFF',op:.75,thick:7},
      {y:92,rx:68,col:'#FFFFFF',op:.75,thick:7},
      {y:102,rx:68,col:'#f1f5f9',op:.8,thick:6},
      {y:112,rx:62,col:'#B8C9D9',op:.75,thick:6},
      {y:122,rx:60,col:'#FFFFFF',op:.75,thick:6},
      {y:132,rx:56,col:'#FFFFFF',op:.8,thick:6},
      {y:142,rx:54,col:'#f1f5f9',op:.8,thick:6},
      {y:152,rx:50,col:'#B8C9D9',op:.8,thick:6},
      {y:162,rx:48,col:'#FFFFFF',op:.8,thick:5},
      {y:174,rx:44,col:'#FFFFFF',op:.8,thick:5},
      {y:186,rx:42,col:'#f1f5f9',op:.85,thick:5},
      {y:196,rx:38,col:'#B8C9D9',op:.85,thick:5},
      {y:208,rx:34,col:'#FFFFFF',op:.85,thick:5},
      {y:220,rx:30,col:'#FFFFFF',op:.85,thick:4},
      {y:232,rx:26,col:'#f1f5f9',op:.9,thick:4},
      {y:244,rx:22,col:'#B8C9D9',op:.9,thick:4},
      {y:254,rx:18,col:'#FFFFFF',op:.9,thick:3.5},
      {y:264,rx:14,col:'#FFFFFF',op:.95,thick:3},
      {y:274,rx:10,col:'#B8C9D9',op:.95,thick:2.5},
      {y:282,rx:6,col:'#FFFFFF',op:.95,thick:2}
    ];

    // Halo (subtle background ellipse)
    const halo1 = document.createElement('div');
    halo1.style.cssText = `position:absolute;left:5px;top:35px;width:190px;height:250px;background:#B8C9D9;opacity:.12;border-radius:50%;pointer-events:none`;
    tornadoEl.appendChild(halo1);
    const halo2 = document.createElement('div');
    halo2.style.cssText = `position:absolute;left:40px;top:40px;width:120px;height:240px;background:#FFFFFF;opacity:.08;border-radius:50%;pointer-events:none`;
    tornadoEl.appendChild(halo2);

    bandSpec.forEach((b, i) => {
      const band = document.createElement('div');
      const lineH = b.thick * 4;
      band.style.cssText = `position:absolute;left:50%;top:${b.y}px;width:${b.rx*2}px;height:${lineH}px;border-style:solid;border-color:transparent;border-top-color:${b.col};border-width:${b.thick}px 0 0 0;border-radius:50% 50% 0 0;opacity:${b.op};animation:esTornBandSway .7s ease-in-out infinite;animation-delay:${(-i*.025).toFixed(3)}s;pointer-events:none`;
      tornadoEl.appendChild(band);
    });

    // Debris (42 particles in vertical-axis orbit)
    const cols = ['#FFFFFF', '#B8C9D9', '#64748b', '#FFFFFF', '#475569'];
    for (let i = 0; i < 42; i++) {
      const ty = 20 + Math.random() * 240;
      const dist = Math.abs(ty - 160);
      const rx = Math.max(15, Math.min(130, (160 - dist) * 0.85 + 15 + Math.random() * 55));
      const dur = (.8 + Math.random() * 1.4).toFixed(2);
      const delay = (-Math.random() * 2).toFixed(2);
      const size = 2 + Math.random() * 4;
      const col = cols[Math.floor(Math.random() * cols.length)];
      const isRect = Math.random() < .25;
      const w = isRect ? size * 1.4 : size;
      const h = isRect ? size * .7 : size;
      const p = document.createElement('div');
      p.style.cssText = `position:absolute;left:${tWidth/2}px;top:${ty}px;width:${w}px;height:${h}px;margin-left:${-w/2}px;margin-top:${-h/2}px;background:${col};border-radius:${isRect?'1px':'50%'};animation:esTornDebrisOrb ${dur}s linear infinite;animation-delay:${delay}s;pointer-events:none;--rx:${rx}px`;
      tornadoEl.appendChild(p);
    }

    document.body.appendChild(tornadoEl);

    // Phase 1: pull sheep toward center (after formation, ~1.5s in)
    setTimeout(() => {
      const radius = 480;
      allSheep.forEach(s => {
        if (!s.alive || s.grabbed || s.state === ST.PIPE || s.windOut) return;
        const dx = s.x + SZ - spot.x;
        const dy = s.y + SZ - spot.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) return;
        s.surf = null;
        s.vx = -dx / 30;
        s.vy = -Math.abs(dy) / 40 - 2;
        s.state = ST.FALL;
      });
    }, 1500);

    // Phase 2: explosion — scatter sheep radially (~3s in)
    setTimeout(() => {
      const radius = 560;
      allSheep.forEach(s => {
        if (!s.alive || s.grabbed || s.state === ST.PIPE || s.windOut) return;
        const dx = s.x + SZ - spot.x;
        const dy = s.y + SZ - spot.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) return;
        clearZzz(s);
        s.surf = null;
        const ang = dist < 5 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);
        const force = 14 + Math.random() * 6;
        s.vx = Math.cos(ang) * force;
        s.vy = Math.sin(ang) * force - 8;
        s.dir = s.vx >= 0 ? 1 : -1;
        s.state = ST.FALL;
        ft(s, ['BÊÊÊ !', 'AAAH !', 'NOOOON !', '🌪'][Math.floor(Math.random() * 4)], '#fbbf24');
      });
    }, 3000);

    // Cleanup at end of cycle (6s)
    setTimeout(() => {
      tornadoEl.remove();
      tornadoActive = false;
    }, 6000);
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

  // ── SOCIAL: BEH dialogues + occasional fights ──
  let socialFrame = 0;
  // Variations of "Bêêêh" — only animal sounds, no words
  const BEH_TXT = ['Bêê', 'Bêêêh', 'Bêêh ?', 'Bê !', 'Bêêêêh', 'Mêêh', 'Mêh', 'Bééé', 'Bê bê', 'Bêêêh.', 'Bêh ?'];
  function socialTick() {
    socialFrame++;
    if (socialFrame % 30 !== 0) return; // check every ~0.5s
    const live = allSheep.filter(s => s.alive && !s.grabbed && s.state !== ST.PIPE && !s.windOut && s.state !== 'ko');
    if (live.length < 2) return;

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const dx = (a.x + SZ) - (b.x + SZ);
        const dy = (a.y + SZ) - (b.y + SZ);
        const dist = Math.hypot(dx, dy);

        // === FIGHT: rare (5% chance when conditions met) but violent ===
        if (dist < SZ * 1.3 && Math.abs(dy) < SZ * .8 &&
            (a.state === ST.WALK || a.state === ST.RUN) &&
            (b.state === ST.WALK || b.state === ST.RUN) &&
            ((dx > 0 && a.dir < 0 && b.dir > 0) || (dx < 0 && a.dir > 0 && b.dir < 0)) &&
            Math.random() < .05) {

          const fx = (a.x + b.x) / 2 + SZ;
          const fy = (a.y + b.y) / 2 + SZ;

          // Big yellow flash
          const flash = document.createElement('div');
          flash.style.cssText = `position:fixed;left:${fx-50}px;top:${fy-50}px;width:100px;height:100px;z-index:${Z_FLOAT};pointer-events:none;background:radial-gradient(circle,#fff 0%,#fbbf24 30%,#ef4444 60%,rgba(239,68,68,0) 80%);animation:esBFlash .5s ease forwards;border-radius:50%`;
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 550);

          // Multiple impact stars
          for (let k = 0; k < 12; k++) {
            const angle = (k / 12) * Math.PI * 2;
            const dist2 = 30 + Math.random() * 40;
            const px = fx + Math.cos(angle) * dist2;
            const py = fy + Math.sin(angle) * dist2;
            const star = document.createElement('div');
            star.style.cssText = `position:fixed;left:${px-8}px;top:${py-8}px;font-size:${14+Math.random()*10}px;z-index:${Z_FLOAT};pointer-events:none;animation:esFtUp .7s ease forwards`;
            star.textContent = ['💥', '⭐', '✨', '⚡', '💫'][Math.floor(Math.random() * 5)];
            document.body.appendChild(star);
            setTimeout(() => star.remove(), 800);
          }

          ft({ x: fx - 30, y: fy - 30 }, ['BAM !', 'POW !', 'BOUM !', 'PAF !'][Math.floor(Math.random() * 4)], '#fbbf24');

          // BOTH sheep get violently knocked away
          const aDir = (a.x < b.x) ? -1 : 1;
          const bDir = -aDir;
          a.surf = null; a.state = ST.FALL;
          a.vx = aDir * (14 + Math.random() * 6);
          a.vy = -(9 + Math.random() * 4);
          a.dir = aDir; xfm(a);
          b.surf = null; b.state = ST.FALL;
          b.vx = bDir * (14 + Math.random() * 6);
          b.vy = -(9 + Math.random() * 4);
          b.dir = bDir; xfm(b);

          // Pain BEH (no words)
          ft(a, 'BÊÊÊH !', '#ef4444');
          ft(b, 'BÊÊÊH !', '#ef4444');

          // Screen shake
          if (typeof document !== 'undefined' && document.body) {
            document.body.style.transition = 'transform .08s';
            document.body.style.transform = 'translate(3px, -2px)';
            setTimeout(() => { document.body.style.transform = 'translate(-3px, 2px)'; }, 80);
            setTimeout(() => { document.body.style.transform = ''; document.body.style.transition = ''; }, 160);
          }

          return;
        }

        // === BEH chat: close-ish, both calm, occasional dialogue (BEH only, no words) ===
        if (dist < 180 && dist > SZ * 1.2 && Math.random() < .08 &&
            (a.state === ST.WALK || a.state === ST.STARE) &&
            (b.state === ST.WALK || b.state === ST.STARE)) {
          ft(a, BEH_TXT[Math.floor(Math.random() * BEH_TXT.length)], '#fff');
          setTimeout(() => {
            if (b.alive) ft(b, BEH_TXT[Math.floor(Math.random() * BEH_TXT.length)], '#fff');
          }, 400 + Math.random() * 600);
          return;
        }
      }
    }
  }

  // ── LOOP ──
  function loop() {
    allSheep.forEach(s => { if (!s.alive) return; tick(s); });
    socialTick();
    rafId = requestAnimationFrame(loop);
  }

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
    PLATS = []; PIPES = []; SKY_PIPES = []; ALL_PIPES = [];
    cloudsEls = [];
    groundEl = null;
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
.es-hotspot{position:fixed!important;left:178px!important;top:calc(var(--ticker-h, 36px) + 18px)!important;bottom:auto!important;width:8px!important;height:8px!important;z-index:2147483647!important;cursor:pointer!important;border-radius:50%!important;background:rgba(180,190,200,.25)!important;border:none!important;box-shadow:none!important;transition:background .2s ease,transform .2s ease!important;pointer-events:auto!important;display:block!important;visibility:visible!important;opacity:1!important}
.es-hotspot:hover{background:rgba(180,190,200,.6)!important;transform:scale(1.4)!important}
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
