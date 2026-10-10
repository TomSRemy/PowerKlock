// ════════════════════════════════════════════════════════════════
// carbon.js — Facteurs d'émission, couverture & intensité conso
// ────────────────────────────────────────────────────────────────
// Source unique de vérité pour le carbone dans PowerKlock.
// Remplace / unifie GM_FUEL_META (genmix.js:19) et le FUEL local
// (genmix.js:2594) qui divergeaient.
//
// Backbone : IPCC AR5 (2014) WG3 Annex III, médianes cycle de vie
//            (gCO2eq/kWh). Granularité fossile alignée electricityMaps-contrib.
// Cross-check : IEA Life Cycle Upstream EF 2024, ADEME Base Empreinte (FR).
//
// Convention couleurs = palette PowerKlock existante.
// ════════════════════════════════════════════════════════════════

// ── 1. Table granulaire, clé = code ENTSO-E "Production Type" (B-codes)
//    co2  : facteur cycle de vie gCO2eq/kWh
//    cat  : 'ren' (renouvelable) | 'nuc' | 'fos' (fossile) | 'sto' (stockage) | 'unk'
//    src  : référence (IPCC = solide ; * = estimation littérature/eMaps, incertitude large)
const CARBON_FACTORS = {
  B01: { label: 'Biomasse',            fr: 'Biomasse',           co2: 230,  cat: 'ren', color: '#94D2BD', src: 'IPCC AR5' },
  B02: { label: 'Lignite',             fr: 'Lignite',            co2: 1050, cat: 'fos', color: '#8B5A2B', src: 'eMaps/lit *' },
  B03: { label: 'Coal-derived gas',    fr: 'Gaz de houille',     co2: 820,  cat: 'fos', color: '#A0522D', src: 'eMaps *' },
  B04: { label: 'Fossil Gas',          fr: 'Gaz',                co2: 490,  cat: 'fos', color: '#ED6965', src: 'IPCC AR5 (CCGT)' },
  B05: { label: 'Hard coal',           fr: 'Charbon',            co2: 820,  cat: 'fos', color: '#6B4423', src: 'IPCC AR5' },
  B06: { label: 'Fossil Oil',          fr: 'Fioul',              co2: 650,  cat: 'fos', color: '#B5651D', src: 'IPCC/lit *' },
  B07: { label: 'Oil shale',           fr: 'Schiste bitumineux', co2: 900,  cat: 'fos', color: '#7A4A1E', src: 'lit *' },
  B08: { label: 'Peat',                fr: 'Tourbe',             co2: 1000, cat: 'fos', color: '#5C4326', src: 'lit *' },
  B09: { label: 'Geothermal',          fr: 'Géothermie',         co2: 38,   cat: 'ren', color: '#C1666B', src: 'IPCC AR5' },
  B10: { label: 'Hydro Pumped Storage',fr: 'STEP (pompage)',     co2: 24,   cat: 'sto', color: '#2C7DA0', src: 'IPCC (flag stockage)' },
  B11: { label: 'Hydro Run-of-river',  fr: 'Hydro fil de l\'eau',co2: 24,   cat: 'ren', color: '#3FA6B4', src: 'IPCC AR5' },
  B12: { label: 'Hydro Reservoir',     fr: 'Hydro réservoir',    co2: 24,   cat: 'ren', color: '#3FA6B4', src: 'IPCC AR5 (méthane: variable)' },
  B13: { label: 'Marine',              fr: 'Énergies marines',   co2: 17,   cat: 'ren', color: '#468FAF', src: 'IPCC AR5 (ocean)' },
  B14: { label: 'Nuclear',             fr: 'Nucléaire',          co2: 12,   cat: 'nuc', color: '#7B4B9C', src: 'IPCC AR5' },
  B15: { label: 'Other renewable',     fr: 'Autre renouvelable', co2: 26,   cat: 'ren', color: '#76C893', src: 'IPCC (blend) *' },
  B16: { label: 'Solar',               fr: 'Solaire',            co2: 45,   cat: 'ren', color: '#FBBF24', src: 'eMaps (IPCC 48 utility)' },
  B17: { label: 'Waste',               fr: 'Déchets',            co2: 580,  cat: 'fos', color: '#9C6644', src: 'eMaps (~50% fossile) *' },
  B18: { label: 'Wind Offshore',       fr: 'Éolien offshore',    co2: 12,   cat: 'ren', color: '#14D3A9', src: 'UNECE 2022' },
  B19: { label: 'Wind Onshore',        fr: 'Éolien onshore',     co2: 11,   cat: 'ren', color: '#14D3A9', src: 'UNECE 2022 / IPCC' },
  B20: { label: 'Other',               fr: 'Autre',              co2: 700,  cat: 'unk', color: '#7A93AB', src: 'fallback unknown *' },
};

// ── 2. Catégories de couverture
//    renouvelable = ren ; bas-carbone = ren + nucléaire ; fossile = fos
//    STEP (B10) exclue du primaire (stockage) ; déchets comptés fossile par défaut.
const COVERAGE_CATS = {
  renewable: ['B01','B09','B11','B12','B13','B15','B16','B18','B19'],
  lowcarbon: ['B01','B09','B11','B12','B13','B14','B15','B16','B18','B19'],
  fossil:    ['B02','B03','B04','B05','B06','B07','B08','B17'],
};

// ── 3. Pont avec le genmix.json ACTUEL (agrégé) — usage intérimaire
//    AVANT de passer le fetch en granulaire, les facteurs fins ne servent
//    pas (fossile reste un bloc). Ce mapping garde un comportement correct
//    en attendant. Le vrai gain pays-par-pays exige la granularité ENTSO-E.
const LEGACY_BUCKET = {
  nuclear: { co2: 12,  cat: 'nuc' },
  wind:    { co2: 11,  cat: 'ren' },
  solar:   { co2: 45,  cat: 'ren' },
  hydro:   { co2: 24,  cat: 'ren' },
  biomass: { co2: 230, cat: 'ren' },
  fossil:  { co2: 650, cat: 'fos' },  // blend gaz/charbon ; remplacer par B02..B08 dès que dispo
  other:   { co2: 400, cat: 'unk' },
};

// ════════════════════════════════════════════════════════════════
// CALCULS
// ════════════════════════════════════════════════════════════════

// Intensité de PRODUCTION d'une zone (gCO2eq/kWh).
// mix : { B04: MW, B05: MW, ... }  (ou buckets legacy si granular=false)
function productionIntensity(mix, granular = true) {
  const T = granular ? CARBON_FACTORS : LEGACY_BUCKET;
  let num = 0, tot = 0;
  for (const k in mix) {
    const v = mix[k] || 0; if (v <= 0) continue;
    const f = T[k]; if (!f) continue;
    num += v * f.co2; tot += v;
  }
  return tot > 0 ? num / tot : 0;
}

// Taux de couverture d'une zone (%).
function coverage(mix, granular = true) {
  const T = granular ? CARBON_FACTORS : LEGACY_BUCKET;
  let tot = 0, ren = 0, low = 0, fos = 0;
  for (const k in mix) {
    const v = mix[k] || 0; if (v <= 0) continue;
    if (!T[k]) continue;
    tot += v;
    if (granular) {
      if (COVERAGE_CATS.renewable.includes(k)) ren += v;
      if (COVERAGE_CATS.lowcarbon.includes(k)) low += v;
      if (COVERAGE_CATS.fossil.includes(k))    fos += v;
    } else {
      const c = T[k].cat;
      if (c === 'ren') { ren += v; low += v; }
      else if (c === 'nuc') { low += v; }
      else if (c === 'fos') { fos += v; }
    }
  }
  const pct = x => tot > 0 ? x / tot * 100 : 0;
  return { total: tot, renPct: pct(ren), lowCPct: pct(low), fosPct: pct(fos) };
}

// Intensité de CONSOMMATION (niveau 2 : import × intensité prod de l'origine).
// Formule sans flow-tracing : émissions conso = prod locale + imports pondérés
//   par l'origine, exports retirés à l'intensité locale.
//   zone           : code zone (ex 'FR')
//   genTotalByZone : { FR: MW, DE_LU: MW, ... }  production totale par zone
//   prodIntByZone  : { FR: g, DE_LU: g, ... }    productionIntensity() par zone
//   crossborder    : crossborder.json.countries  ({ FR: [{partner,imports,exports,net}], ... })
function consumptionIntensity(zone, genTotalByZone, prodIntByZone, crossborder) {
  const G  = genTotalByZone[zone] || 0;
  const ci = prodIntByZone[zone]  || 0;
  let emis = G * ci;            // émissions de la prod locale
  let cons = G;                 // conso = prod + imports - exports
  const flows = (crossborder[zone] || []);
  for (const fl of flows) {
    const code = (fl.partner || '').split(' ')[0];   // "DE_LU · Germany" -> "DE_LU"
    const imp = fl.imports || 0, exp = fl.exports || 0;
    const ciN = prodIntByZone[code];                 // intensité de prod du voisin
    if (imp > 0 && ciN != null) { emis += imp * ciN; cons += imp; }
    if (exp > 0)                { emis -= exp * ci;  cons -= exp; }
  }
  return cons > 0 ? emis / cons : ci;
}

// ── 4. Sources (à exposer dans l'UI = ton edge "transparence" vs eMaps)
const CARBON_SOURCES = [
  { id: 'ipcc',   label: 'IPCC AR5 (2014) WG3 Annex III — médianes cycle de vie',
    url: 'https://www.ipcc.ch/report/ar5/wg3/' },
  { id: 'emaps',  label: 'electricityMaps-contrib — EU emission factors (open source)',
    url: 'https://github.com/electricitymaps/electricitymaps-contrib/wiki/EU-emission-factors' },
  { id: 'iea',    label: 'IEA Life Cycle Upstream Emission Factors 2024 (par pays)',
    url: 'https://www.iea.org/data-and-statistics/data-product/emissions-factors-2024' },
  { id: 'unece',  label: 'UNECE 2022 — Integrated LCA of Electricity Sources (éolien on/offshore)',
    url: 'https://unece.org/sed/documents/2021/10/reports/life-cycle-assessment-electricity-generation-options' },
  { id: 'ademe',  label: 'ADEME Base Empreinte — référence nationale FR',
    url: 'https://base-empreinte.ademe.fr/' },
];

// Exports (browser global, cohérent avec ton chargement de modules)
if (typeof window !== 'undefined') {
  window.CARBON_FACTORS = CARBON_FACTORS;
  window.COVERAGE_CATS = COVERAGE_CATS;
  window.LEGACY_BUCKET = LEGACY_BUCKET;
  window.productionIntensity = productionIntensity;
  window.coverage = coverage;
  window.consumptionIntensity = consumptionIntensity;
  window.CARBON_SOURCES = CARBON_SOURCES;
}
if (typeof module !== 'undefined') module.exports = {
  CARBON_FACTORS, COVERAGE_CATS, LEGACY_BUCKET,
  productionIntensity, coverage, consumptionIntensity, CARBON_SOURCES,
};
