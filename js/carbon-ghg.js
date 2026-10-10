// ════════════════════════════════════════════════════════════════
// carbon-ghg.js — Pont GHG Protocol (Scope 2) + mix résiduel
// ────────────────────────────────────────────────────────────────
// Étend carbon.js. carbon.js = réseau / location-based.
// Ce module = market-based / résiduel / langage GHG Protocol.
//
// GHG Protocol Scope 2 Guidance (2015) — deux méthodes :
//   location-based : facteur moyen du réseau            → carbon.js
//   market-based   : instruments contractuels (GO/PPA)  + mix résiduel pour le reste
//
// ⚠ LICENCE AIB : les facteurs par pays/source des mix résiduels nationaux
//   ne peuvent être redistribués dans un outil dérivé. On ne hardcode donc
//   PAS les facteurs AIB. On calcule notre propre résiduel (production − GO
//   annulés) et on recoupe avec l'officiel AIB à sa publication (~août Y+1).
// ════════════════════════════════════════════════════════════════

// ── 1. Pays en "full disclosure" : pas de mix résiduel applicable
//    (toute la conso y est tracée explicitement par GO).
const FULL_DISCLOSURE = ['AT', 'NL', 'CH'];

function _factors() {
  return (typeof window !== 'undefined' ? window.CARBON_FACTORS
        : require('./carbon.js').CARBON_FACTORS);
}

// ── 2. Stockage du résiduel par zone et par année de reporting.
//    status: 'official'  = adopté AIB / autorité nationale (confirmé)
//            'estimated' = notre estimation provisoire, à confirmer
//    NB: co2 reste vide tant que non rempli par une source autorisée OU
//        par estimateResidual(). Pas de valeurs AIB en dur.
const RESIDUAL_MIX = {
  // exemple de structure (à alimenter par le pipeline) :
  // FR: { 2024: { co2: 58,  status: 'official',  source: 'AIB y2024' },
  //       2025: { co2: null, status: 'estimated', source: 'PowerKlock self-calc' } },
};

// ── 3. Estimation maison du résiduel (sidestep licence AIB).
//    Résiduel = production MOINS attributs verts qui quittent le résiduel,
//    réintensifié sur les filières restantes.
//
//    ⚠ LIMITES vs AIB (à assumer dans l'UI) : modèle 1er ordre. Ne reproduit
//      PAS l'European Attribute Mix dans sa finesse ni le timing "shifted".
//      L'écart avec l'officiel est surtout marqué pour les pays qui tradent
//      beaucoup de GO. À présenter comme estimation provisoire.
//
//    prodMix       : { B01: MWh, ... }  production par code
//    attrsRemoved  : { B16: MWh, ... }  attributs verts SORTIS du résiduel =
//                    GO annulés localement + GO NETS EXPORTÉS. C'est la clé :
//                    si on n'inclut pas les exports, on sous-estime le résiduel
//                    des exportateurs nets de GO (Norvège, etc.).
//    opts.eamCo2   : intensité EAM (g) pour combler un déficit (def. 480, ~niveau EU).
//    Renvoie { co2, residualMix, trackedShare, deficitFilled, method }.
function estimateResidual(prodMix, attrsRemoved, factors, opts) {
  factors = factors || (typeof window !== 'undefined' ? window.CARBON_FACTORS : require('./carbon.js').CARBON_FACTORS);
  opts = opts || {};
  const eamCo2 = opts.eamCo2 != null ? opts.eamCo2 : 480;
  const residual = {};
  let totalProd = 0, totalRemoved = 0, deficit = 0;
  for (const k in prodMix) {
    const p = prodMix[k] || 0;
    const g = (attrsRemoved && attrsRemoved[k]) || 0;
    residual[k] = Math.max(0, p - g);      // attributs restants
    if (g > p) deficit += (g - p);         // sur-claim -> comblé par EAM
    totalProd += p;
    totalRemoved += Math.min(p, g);
  }
  // intensité pondérée : résiduel restant + part EAM pour le déficit
  let num = 0, tot = 0;
  for (const k in residual) {
    const v = residual[k]; if (v <= 0 || !factors[k]) continue;
    num += v * factors[k].co2; tot += v;
  }
  num += deficit * eamCo2; tot += deficit;
  return {
    co2: tot > 0 ? num / tot : 0,
    residualMix: residual,
    trackedShare: totalProd > 0 ? (totalRemoved + deficit) / (totalProd + deficit) * 100 : 0,
    deficitFilled: deficit,
    method: '1er ordre (EAM simplifié, sans timing shifted)',
  };
}

// ── 4. Confirmation à la publication AIB (pattern finalize_yesterday, annuel)
//    Remplace l'estimation par l'officiel et fige le statut.
function confirmResidual(zone, year, officialCo2, source) {
  RESIDUAL_MIX[zone] = RESIDUAL_MIX[zone] || {};
  RESIDUAL_MIX[zone][year] = {
    co2: officialCo2,
    status: 'official',
    source: source || `AIB y${year}`,
  };
  return RESIDUAL_MIX[zone][year];
}

// Lecture : renvoie le résiduel le plus pertinent (officiel > estimé).
function residualFactor(zone, year) {
  if (FULL_DISCLOSURE.includes(zone)) {
    return { co2: null, status: 'n/a', note: 'full disclosure — pas de résiduel' };
  }
  const z = RESIDUAL_MIX[zone];
  if (!z) return { co2: null, status: 'missing' };
  return z[year] || z[Math.max(...Object.keys(z).map(Number))] || { co2: null, status: 'missing' };
}

// Donne LES DEUX côte à côte : estimation live + officiel AIB + écart.
// C'est ce qu'on expose dans l'UI.
function residualBoth(zone, year, prodMix, attrsRemoved, factors, opts) {
  const est = estimateResidual(prodMix, attrsRemoved, factors, opts);
  const off = residualFactor(zone, year);
  const delta = (off.co2 != null) ? +(est.co2 - off.co2).toFixed(1) : null;
  return {
    estimate: { co2: +est.co2.toFixed(1), status: 'estimated', method: est.method },
    official: off,
    deltaVsOfficial: delta,     // null tant que l'officiel n'est pas publié
  };
}

// ════════════════════════════════════════════════════════════════
// EAM ENDOGÈNE + RÉSIDUEL À DEUX PASSES (converge les cas extrêmes)
// ────────────────────────────────────────────────────────────────
// Format d'entrée des flux GO (annuel) :
//   flows = { CC: { consumption: MWh,
//                   fuels: { Bxx: { prod, cancelled, exported, imported } } } }
//   Volumes en MWh (1 MWh produit = 1 attribut).
//
// Principe (issuing-based simplifié, fidèle sur les cas extrêmes) :
//   surplus[c][f] = max(0, prod − cancelled − (exported − imported))
//   EAM           = pool des surplus de tous les pays, intensité pondérée
//   résiduel[c]   = attributs domestiques restants + déficit comblé par l'EAM
// ════════════════════════════════════════════════════════════════

// Passe 1 : European Attribute Mix à partir des surplus de tous les pays.
function buildEAM(flows, factors) {
  factors = factors || _factors();
  let num = 0, vol = 0;
  const mix = {};
  for (const c in flows) {
    const fu = (flows[c] && flows[c].fuels) || {};
    for (const f in fu) {
      const x = fu[f];
      const netExp = (x.exported || 0) - (x.imported || 0);
      const surplus = Math.max(0, (x.prod || 0) - (x.cancelled || 0) - netExp);
      if (surplus <= 0 || !factors[f]) continue;
      mix[f] = (mix[f] || 0) + surplus;
      num += surplus * factors[f].co2;
      vol += surplus;
    }
  }
  return { co2: vol > 0 ? num / vol : 0, volume: vol, mix };
}

// Passe 2 : résiduel d'un pays, déficit comblé par l'EAM endogène.
function residualMixEndogenous(zone, flows, factors, eam) {
  factors = factors || _factors();
  if (FULL_DISCLOSURE.includes(zone)) return { co2: null, status: 'n/a', note: 'full disclosure' };
  const c = flows[zone];
  if (!c) return { co2: null, status: 'missing' };
  eam = eam || buildEAM(flows, factors);
  const fu = c.fuels || {};
  let domNum = 0, domVol = 0, totalCancelled = 0;
  for (const f in fu) {
    const x = fu[f];
    totalCancelled += (x.cancelled || 0);
    const netExp = (x.exported || 0) - (x.imported || 0);
    const surplus = Math.max(0, (x.prod || 0) - (x.cancelled || 0) - netExp);
    if (surplus <= 0 || !factors[f]) continue;
    domNum += surplus * factors[f].co2;
    domVol += surplus;
  }
  const residualVolume = Math.max(0, (c.consumption || 0) - totalCancelled); // conso non tracée
  const gap = Math.max(0, residualVolume - domVol);                          // comblé par EAM
  const num = domNum + gap * eam.co2;
  const vol = domVol + gap;
  return {
    co2: vol > 0 ? num / vol : 0,
    status: 'estimated',
    residualVolume,
    deficitFilledByEAM: Math.round(gap),
    domesticShare: residualVolume > 0 ? +Math.min(100, domVol / residualVolume * 100).toFixed(1) : 0,
    eamCo2: +eam.co2.toFixed(1),
    method: 'EAM endogène (2 passes)',
  };
}

// ── Back-test : recalcule l'estimation sur des années DÉJÀ publiées et mesure
//    l'erreur par pays. La valeur de l'estimation = être à jour (AIB a ~8 mois
//    de retard) ; on la calibre sur le passé pour afficher des bandes de confiance.
//    flowsByYear    : { 2023: flows, 2022: flows }
//    officialByYear : { 2023: { FR: 56, NO: 470 } }
function backtest(flowsByYear, officialByYear) {
  const rows = [];
  for (const y in flowsByYear) {
    const off = officialByYear[y] || {};
    const eam = buildEAM(flowsByYear[y]);
    for (const z in flowsByYear[y]) {
      if (off[z] == null) continue;
      const est = residualMixEndogenous(z, flowsByYear[y], null, eam);
      if (est.co2 == null) continue;
      const err = est.co2 - off[z];
      rows.push({
        year: +y, zone: z, estimate: +est.co2.toFixed(1), official: off[z],
        error: +err.toFixed(1), absError: +Math.abs(err).toFixed(1),
        pctError: off[z] ? +(err / off[z] * 100).toFixed(1) : null,
      });
    }
  }
  const n = rows.length || 1;
  const mae = rows.reduce((s, r) => s + r.absError, 0) / n;
  const bias = rows.reduce((s, r) => s + r.error, 0) / n;
  const byZone = {};
  rows.forEach(r => { (byZone[r.zone] = byZone[r.zone] || []).push(r.absError); });
  const zoneMAE = {};
  for (const z in byZone) zoneMAE[z] = +(byZone[z].reduce((a, b) => a + b, 0) / byZone[z].length).toFixed(1);
  return { rows, mae: +mae.toFixed(1), bias: +bias.toFixed(1), zoneMAE };
}

// ── 5. Briques Scope 2 prêtes pour l'outil 24/7 (pas pour PowerKlock seul).
//    locationBased : facteur réseau (vient de carbon.js, ici juste relayé)
//    marketBased   : facteur effectif = couvert × instrument + reste × résiduel
//
//    coveredFrac   : 0..1 part de la conso couverte par GO/PPA
//    instrumentCo2 : facteur des instruments (souvent ~0 pour GO/PPA EnR)
//    residualCo2   : résiduel de la zone (residualFactor)
function marketBasedFactor(coveredFrac, instrumentCo2, residualCo2) {
  coveredFrac = Math.max(0, Math.min(1, coveredFrac || 0));
  return coveredFrac * (instrumentCo2 || 0) + (1 - coveredFrac) * (residualCo2 || 0);
}

// ── 6. Étiquetage GHG Protocol pour l'UI (ton edge transparence)
const GHG_LABELS = {
  location: 'Location-based (facteur réseau · GHG Protocol Scope 2)',
  market:   'Market-based (instruments + mix résiduel · GHG Protocol Scope 2)',
  residual: 'Mix résiduel (part non tracée par GO · base AIB)',
};

const GHG_SOURCES = [
  { id: 'ghgp',  label: 'GHG Protocol — Scope 2 Guidance (2015)',
    url: 'https://ghgprotocol.org/scope-2-guidance' },
  { id: 'aib',   label: 'AIB — European Residual Mix (publication annuelle, lag ~8 mois)',
    url: 'https://www.aib-net.org/facts/european-residual-mix' },
  { id: 'energytag', label: 'EnergyTag — certificats granulaires horaires (24/7 CFE)',
    url: 'https://energytag.org/' },
];

if (typeof window !== 'undefined') {
  Object.assign(window, {
    FULL_DISCLOSURE, RESIDUAL_MIX, estimateResidual, confirmResidual,
    residualFactor, residualBoth, buildEAM, residualMixEndogenous, backtest,
    marketBasedFactor, GHG_LABELS, GHG_SOURCES,
  });
}
if (typeof module !== 'undefined') module.exports = {
  FULL_DISCLOSURE, RESIDUAL_MIX, estimateResidual, confirmResidual,
  residualFactor, residualBoth, buildEAM, residualMixEndogenous, backtest,
  marketBasedFactor, GHG_LABELS, GHG_SOURCES,
};
