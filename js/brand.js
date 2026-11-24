// brand.js · the brand as it is written (the owner's charter, 25 Nov. 2026): wherever « PowerKlock » appears in the
// text of the site or of the phone app, it is shown as the wordmark « Power.Klock », the dot and Klock in the accent
// green, as in the logo (assets/logo-header.png, which stands alone where the brand is a heading). Text the page
// writes later (translations, app screens, panels) is caught as it arrives. Left alone: form fields, code, the
// document's title and attributes (aria labels, alt texts), where only plain text can go.
(function () {
  'use strict';
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|TITLE|CODE|PRE|NOSCRIPT|svg|text|tspan)$/i;
  const RX = /PowerKlock/g;
  function mark(node) {
    const t = node.nodeValue; if (!t || t.indexOf('PowerKlock') < 0) return;
    for (let p = node.parentNode; p && p !== document.body; p = p.parentNode) {
      if (p.nodeType !== 1) continue;
      if (SKIP.test(p.nodeName) || p.isContentEditable || p.classList.contains('pk-wm') || p.hasAttribute('data-nobrand')) return;
    }
    const f = document.createDocumentFragment(); let last = 0;
    t.replace(RX, (m, i) => {
      if (i > last) f.appendChild(document.createTextNode(t.slice(last, i)));
      const s = document.createElement('span'); s.className = 'pk-wm'; s.setAttribute('translate', 'no');
      s.innerHTML = 'Power<b>.Klock</b>'; f.appendChild(s); last = i + m.length; return m;
    });
    if (last < t.length) f.appendChild(document.createTextNode(t.slice(last)));
    node.parentNode.replaceChild(f, node);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { mark(root); return; }
    if (root.nodeType !== 1 || SKIP.test(root.nodeName)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.indexOf('PowerKlock') >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
    const list = []; while (w.nextNode()) list.push(w.currentNode); list.forEach(mark);
  }
  let queue = new Set(), sched = false;
  const flush = () => { sched = false; const q = queue; queue = new Set(); q.forEach(n => { if (n.isConnected) walk(n); }); };
  function start() {
    // after the translation layer (js/i18n.js) has written the page: a sentence is translated whole, then marked
    if (document.documentElement.classList.contains('pk-tr')) { setTimeout(start, 120); return; }
    walk(document.body);
    new MutationObserver(ms => { ms.forEach(m => { if (m.type === 'characterData') queue.add(m.target); else m.addedNodes.forEach(n => queue.add(n)); });
      if (!sched) { sched = true; requestAnimationFrame(flush); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
