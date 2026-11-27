const D = JSON.parse(document.getElementById('data').textContent);
const EN = window.PK_LANG ? window.PK_LANG === 'en' : location.hash === '#en';
addEventListener('hashchange', () => location.reload());
document.documentElement.lang = EN ? 'en' : 'fr';
const T = (fr, en) => EN ? en : fr;
const NB = ' ';
const fmt = (v, dec) => { const s = Math.abs(v).toFixed(dec || 0); return (v < 0 ? '−' : '') + (EN ? s : s.replace('.', ',')); };
const sgn = (v, dec) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), dec);
const hm = i => { const h = Math.floor(i / 4), m = (i % 4) * 15; return EN ? String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') : h + NB + 'h' + (m ? NB + String(m).padStart(2, '0') : ''); };
const dt = (iso, o) => new Intl.DateTimeFormat(EN ? 'en-GB' : 'fr-FR', Object.assign({ timeZone: 'UTC' }, o)).format(new Date(iso + 'T12:00:00Z'));
const dShort = iso => dt(iso, { day: 'numeric', month: 'short' });
const dLong = iso => dt(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const clamp = x => Math.max(0, Math.min(1, x)), seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = x => 1 - Math.pow(1 - x, 3), io = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const $ = id => document.getElementById(id);
const iMax = D.q.indexOf(Math.max(...D.q)), iMin = D.q.indexOf(Math.min(...D.q));
const SRC = T('Source : ENTSO-E (day-ahead EPEX Spot) · France · pas 15 min', 'Source: ENTSO-E (EPEX Spot day-ahead) · France · 15-min steps');
// the stage is 1080 x 1920 and scales to the window
const stage = $('stage');
const fit = () => stage.style.setProperty('--s', Math.min(innerWidth / 1080, innerHeight / 1920));
addEventListener('resize', fit); fit();
if (window.PK_SAFE || /[?&]safe/.test(location.search)) stage.classList.add('showsafe');
stage.insertAdjacentHTML('beforeend', '<div class="safe"><i style="left:0;top:0;width:1080px;height:269px"></i><i style="left:0;top:1536px;width:1080px;height:384px"></i><i style="left:950px;top:269px;width:130px;height:1267px"></i></div>');
stage.insertAdjacentHTML('beforeend', '<div class="foot"><b translate="no">Power<i>Klock</i></b><span>' + SRC + '</span></div>');
// one clock for the whole reel: render(t) is a pure function of the time in the loop, so the last frame meets the first
function loop(DUR, render) {
  window.REEL_MS = DUR; window.REEL_SCENES = 3;
  const t0 = performance.now();
  const f = now => { const e = now - t0; if (e >= DUR) window.REEL_DONE = true;
    render(window.PK_FREEZE != null ? window.PK_FREEZE : e % DUR); requestAnimationFrame(f); };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(f));
}
// the part of a polyline reached at fraction f of its points (straight segments, the tip interpolated)
function part(P, f) { const x = f * (P.length - 1), i = Math.min(P.length - 1, Math.floor(x)), u = x - i, j = Math.min(P.length - 1, i + 1);
  const tip = [P[i][0] + (P[j][0] - P[i][0]) * u, P[i][1] + (P[j][1] - P[i][1]) * u];
  return { pts: P.slice(0, i + 1).concat([tip]).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '), tip, i, u, j }; }
