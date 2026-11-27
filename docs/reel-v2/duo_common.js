// ── the two linked reels share this: the 96 quarter-hours as dots, where they sit as a line, and how they fly from one reel to the next ──
addEventListener('message', e => { if (e.data && typeof e.data.pkT === 'number') window.PK_FREEZE = e.data.pkT; });   // a demo page may drive the clock
const DOWN = (window.PK_DIR || (/[?&]dir=down/.test(location.search) ? 'down' : 'right')) === 'down';
const DIRV = DOWN ? [0, 1920] : [1080, 0];           // where the next reel sits: to the right (carousel) or below (Reels feed)
const GX0 = 65, GX1 = 930, GY0 = 620, GY1 = 1100;
const gall = D.q.concat(D.y.q || []), glo = Math.min(...gall) * .92, ghi = Math.max(...gall) * 1.04;
const gx = i => GX0 + (GX1 - GX0) * i / 95, gy = v => GY1 - (GY1 - GY0) * (v - glo) / (ghi - glo);
const HOME = D.q.map((v, i) => [gx(i), gy(v)]);
const mix = (a, b, u) => a + (b - a) * u;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const K = { text: css('--text'), text2: css('--text2'), text3: css('--text3'), line: css('--line'), rise: css('--rise'), fall: css('--fall'), mark: css('--mark'), bg: css('--bg') };
// a dot's colour is its price (grey-blue low, yellow high), the day's peak is red and larger: nothing but the day's own values
const RGB = D.q.map((v, i) => { if (i === iMax) return [237, 105, 101]; const u = (v - D.min) / (D.max - D.min); return [mix(122, 255, u), mix(147, 253, u), mix(171, 130, u)]; });
const RAD = D.q.map((v, i) => i === iMax ? 12 : 6.5);
// where each quarter-hour rests in the price clock (midnight on top, price as radius)
const CX = 500, CY = 940, R0 = 100, R1 = 380, hi30 = Math.max(D.max, ...D.q30.map(q => Math.max(...q)));
const rr = v => R0 + (R1 - R0) * Math.max(0, v) / hi30;
const pol = (i, v) => { const a = i / 96 * Math.PI * 2; return [CX + rr(v) * Math.sin(a), CY - rr(v) * Math.cos(a)]; };
const POL = D.q.map((v, i) => pol(i, v));
// free flight, as the dot cloud of the home page (js/landing.js) but looser: every dot has its own start, its own speed,
// its own arc across the direct path (nil at both ends) and a small drift while it is loose. All of it is a fixed function of
// the dot and of the time (same seed in both reels), so the two files show the same trajectories; at rest a dot is at its exact price.
const rnd = (i, s) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const io3 = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
function fly(i, A, Z, tau, P, s) {
  // the home page's cloud (js/landing.js, cloud): the dots leave in order with a 22 % stagger, cubic in-out, each on a
  // gentle arc across its path (28 % of the distance at most, nil at both ends), the side and depth of the arc its own
  const k = DOWN || s !== 1 ? i : 95 - i, f = seg(tau, 0, P), d = (k / 95) * .22, e = io3(Math.min(1, Math.max(0, (f - d) / (1 - .22))));
  const dx = Z[0] - A[0], dy = Z[1] - A[1], arc = Math.sin(e * Math.PI) * (rnd(i, 0) - .5) * .28;
  return [A[0] + dx * e - dy * arc, A[1] + dy * e + dx * arc, e];
}
// the passage from reel 1 to reel 2 is ONE flight of 2.5 s, from the curve to the clock of the next frame: reel 1 shows it leaving, reel 2 arriving
const PASS = 2500, passage = (i, tau) => fly(i, HOME[i], [POL[i][0] + DIRV[0], POL[i][1] + DIRV[1]], tau, PASS, 1);
const cv = $('cv'), g = cv.getContext('2d');
const MONO = '"JetBrains Mono",ui-monospace,monospace';
const txt = (s, x, y, size, col, al, w, a) => { g.globalAlpha = a == null ? 1 : a; g.font = (w || 500) + ' ' + size + 'px ' + MONO; g.fillStyle = col; g.textAlign = al || 'left'; g.fillText(s, x, y); g.globalAlpha = 1; };
const poly = (P, col, w, a, dash) => { if (P.length < 2 || a <= 0) return; g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash(dash || []);
  g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; };
// a glowing dot: a halo and a core (the home page's 7 and 2.6 px, scaled to the 1080 px frame); white on the line, its price colour once loose
const glow = (x, y, r, i, e) => { if (r <= 0) return; const c = RGB[i].map(v => Math.round(mix(255, v, Math.min(1, e * 2)))).join(',');
  g.fillStyle = 'rgba(' + c + ',.14)'; g.beginPath(); g.arc(x, y, r * 2.7, 0, 7); g.fill(); g.fillStyle = 'rgb(' + c + ')'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
const disc = (x, y, r, col, a) => { if (r <= 0 || a <= 0) return; g.globalAlpha = a == null ? 1 : a; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalAlpha = 1; };
const ringc = (x, y, r, col, w, a) => { if (a <= 0) return; g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.globalAlpha = 1; };
const cut = (P, f) => { const x = f * (P.length - 1), i = Math.min(P.length - 1, Math.floor(x)), u = x - i, j = Math.min(P.length - 1, i + 1);
  return { P: P.slice(0, i + 1).concat([[P[i][0] + (P[j][0] - P[i][0]) * u, P[i][1] + (P[j][1] - P[i][1]) * u]]), i, j, u }; };
