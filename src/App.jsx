import ListaSpesa from "./ListaSpesa.jsx";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ═══════════════════════════════════════════════════════════════════════════════
// K2 SUITE — v10.0 — Gelateria K2
// Build: 2026-04-10
// Patch v10: Reset factory con doppia conferma e digitazione obbligatoria,
//            Fix updateIngredientPrice (note in history, newCost canonico),
//            SaveStatus pill con background, onResetMovimenti / onResetIncassi
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 1 — DATE UTILITIES (fix UTC/fuso orario)
// ═══════════════════════════════════════════════════════════════════════════════
function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function shiftISODate(iso, days) {
  const dt = parseISODate(iso);
  dt.setDate(dt.getDate() + days);
  return localDateISO(dt);
}
function formatDateIT(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatDayMonthIT(iso, withYear = false) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length < 3) return String(iso);
  const [y, m, d] = parts;
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}
function today() { return localDateISO(); }

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 2 — STORAGE ROBUSTO
// ═══════════════════════════════════════════════════════════════════════════════
async function load(key, fallback) {
  try {
    const r = await window.storage.get(key);
    if (r?.value) return JSON.parse(r.value);
  } catch (_) {
    // fallback silente — errore gestito dal chiamante
  }
  return fallback;
}
async function save(key, val) {
  try {
    await window.storage.set(key, JSON.stringify(val));
    return true;
  } catch (_) {
    // fallback silente — saveStatus="error" segnala il problema all'utente
    return false;
  }
}

// ─── Mappa centralizzata chiavi localStorage ───────────────────────────────
// Unica fonte di verità per LOAD / SAVE / RESET.
// Se aggiungi una nuova chiave, aggiungila QUI e ovunque else il compilatore ti guida.
const STORAGE_KEYS = {
  ingredients:        "k2-ingredients",
  recipes:            "k2-recipes",
  costi:              "k2-costi",
  incassi:            "k2-incassi2",
  cashflow:           "k2-cashflow2",
  listino:            "k2-listino2",
  pricelist:          "k2-pricelist",
  movimenti:          "k2-movimenti",
  productionLog:      "k2-production-log",
  reparto:            "k2-reparto",
  suppliers:          "k2-suppliers",
  supplierDocs:       "k2-supplier-docs",
  goodsReceipts:      "k2-goods-receipts",
  haccpTemps:         "k2-haccp-temps",
  haccpSanifications: "k2-haccp-sanifications",
  haccpNc:            "k2-haccp-nc",
  haccpTraceability:  "k2-haccp-traceability",
  haccpTasks:         "k2-haccp-tasks",
  checklistLogs:      "k2-checklist-logs",
  turniStaff:         "k2-turni-staff",
  staffList:          "k2-staff-list",
  inventoryAudits:    "k2-inventory-audits",
  purchaseOrders:     "k2-purchase-orders",
  authUsers:          "k2-auth-users",
  currentUserId:      "k2-current-user-id",
};

// Helper: carica una chiave con fallback sicuro — non rigetta mai
async function safeLoad(key, fallback, normalize) {
  const raw = await load(key, null);
  if (raw === null || raw === undefined) return fallback;
  try {
    return normalize ? (Array.isArray(raw) ? raw.map(normalize) : fallback) : raw;
  } catch {
    return fallback;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 3 — ALLERGENI
// ═══════════════════════════════════════════════════════════════════════════════
const ALL_ALLERGENI = [
  "latte","uova","glutine","soia","frutta a guscio","nocciole",
  "pistacchio","arachidi","sesamo","senape","sedano","lupini",
  "molluschi","pesce","crostacei","anidride solforosa"
];
const ALLERGENI_LABELS = {
  "latte":"🥛 Latte","uova":"🥚 Uova","glutine":"🌾 Glutine","soia":"🫘 Soia",
  "frutta a guscio":"🌰 Frutta a guscio","nocciole":"🌰 Nocciole",
  "pistacchio":"🟢 Pistacchio","arachidi":"🥜 Arachidi","sesamo":"⚪ Sesamo",
  "senape":"🟡 Senape","sedano":"🌿 Sedano","lupini":"🟡 Lupini",
  "molluschi":"🦑 Molluschi","pesce":"🐟 Pesce","crostacei":"🦐 Crostacei",
  "anidride solforosa":"🍷 Anidride solforosa"
};

function getRecipeAllergens(recipe, ingredients) {
  const set = new Set();
  (recipe?.ingredients || []).forEach(ri => {
    const ing = ingredients.find(i => i.id === ri.id);
    (ing?.allergens || []).forEach(a => set.add(a));
  });
  return [...set];
}

// ─── helper interno: produce i token ordinati per peso decrescente ─────────────
// Ogni token è { name, allergens } così le funzioni pubbliche decidono
// come formattare senza ricalcolare l'ordinamento.
function _buildSortedTokens(recipe, ingredients) {
  return [...(recipe?.ingredients || [])]
    .sort((a, b) => b.q - a.q)
    .map(ri => {
      const ing = ingredients.find(i => i.id === ri.id);
      if (!ing) return null;
      return { name: ing.name, allergens: ing.allergens || [] };
    })
    .filter(Boolean);
}

// ─── VERSIONE BREVE — per listino pubblico e etichetta sintetica ──────────────
// Nomi in ordine decrescente di peso. Gli ingredienti che portano allergeni
// sono scritti in MAIUSCOLO per conformità EU (reg. 1169/2011).
function buildIngredientStatementShort(recipe, ingredients) {
  const tokens = _buildSortedTokens(recipe, ingredients);
  if (tokens.length === 0) return "";
  return tokens
    .map(t => t.allergens.length > 0 ? t.name.toUpperCase() : t.name)
    .join(", ");
}

// ─── VERSIONE ESTESA — per etichetta stampabile completa ──────────────────────
// Come la breve, ma aggiunge tra parentesi la lista allergeni specifici
// di ogni ingrediente allergenico (es. "PASTA PISTACCHIO (pistacchio, frutta a guscio)").
function buildIngredientStatementExtended(recipe, ingredients) {
  const tokens = _buildSortedTokens(recipe, ingredients);
  if (tokens.length === 0) return "";
  return tokens
    .map(t => {
      if (t.allergens.length === 0) return t.name;
      const allergenLabels = t.allergens
        .map(a => {
          const lbl = ALLERGENI_LABELS[a] || a;
          // Rimuove l'emoji se presente per testo pulito
          return lbl.replace(/^[\p{Emoji}\s]+/u, "").trim();
        })
        .join(", ");
      return `${t.name.toUpperCase()} (${allergenLabels})`;
    })
    .join(", ");
}

// ─── LIBRO INGREDIENTI — per scheda tecnica interna ───────────────────────────
// Produce una stringa multi-riga leggibile con nome, peso e allergeni
// per ogni ingrediente della ricetta, ordinata per peso decrescente.
function buildIngredientBookEntry(recipe, ingredients) {
  const tokens = _buildSortedTokens(recipe, ingredients);
  if (tokens.length === 0) return "Nessun ingrediente";
  const totalQ  = (recipe?.ingredients || []).reduce((s, ri) => s + (Number(ri.q) || 0), 0);
  // yield_g usato per la % se disponibile; fallback su totalQ
  const yieldG  = Number(recipe?.yield_g) > 0 ? Number(recipe.yield_g) : totalQ;
  return [...(recipe?.ingredients || [])]
    .sort((a, b) => b.q - a.q)
    .map(ri => {
      const ing = ingredients.find(i => i.id === ri.id);
      if (!ing) return null;
      const q   = Number(ri.q) || 0;
      const pct = yieldG > 0 ? ((q / yieldG) * 100).toFixed(1) : "0.0";
      const qty = q >= 1000 ? `${(q / 1000).toFixed(2)} kg` : `${q} g`;
      const base = `${ing.name} — ${qty} (${pct}% su resa)`;
      if (!ing.allergens || ing.allergens.length === 0) return base;
      const allergenText = ing.allergens
        .map(a => (ALLERGENI_LABELS[a] || a).replace(/^[\p{Emoji}\s]+/u, "").trim())
        .join(", ");
      return `${base} ⚠ ${allergenText}`;
    })
    .filter(Boolean)
    .join("\n");
}

// ─── ALIAS compatibilità — buildIngredientStatement ora usa la versione estesa
// per l'etichetta stampabile (unico consumer esistente nel file).
function buildIngredientStatement(recipe, ingredients, allRecipes = []) {
  if (allRecipes && allRecipes.length > 0) {
    return buildIngredientStatementStrict(recipe, allRecipes, ingredients);
  }
  return buildIngredientStatementExtended(recipe, ingredients);
}

// ─── VERSIONE STRICT — usa allergeni ricorsivi per semilavorati interni ──────
// Necessaria per ricette che usano Pasta Nocciola, Base Fiordilatte, ecc.
function buildIngredientStatementStrict(recipe, allRecipes, ingredients) {
  if (!recipe || !(recipe.ingredients||[]).length) return "";
  // Costruisce la lista ingredienti con allergeni ricorsivi per ciascuno
  return [...(recipe.ingredients || [])]
    .sort((a, b) => b.q - a.q)
    .map(ri => {
      const ing = ingredients.find(i => i.id === ri.id);
      if (!ing) return null;
      // Allergeni ricorsivi per questo ingrediente (include semilavorati)
      const allergenSet = getAllergensRecursiveByName({ ingredients: [ri] }, allRecipes, ingredients);
      if (allergenSet.size === 0) return ing.name;
      const allergenLabels = [...allergenSet]
        .map(a => (ALLERGENI_LABELS[a] || a).replace(/^[\p{Emoji}\s]+/u, "").trim())
        .join(", ");
      return `${ing.name.toUpperCase()} (${allergenLabels})`;
    })
    .filter(Boolean)
    .join(", ");
}

// ─── RIEPILOGO ALLERGENI — versione allineata, senza emoji nel testo corrente ─
function buildAllergenSummary(recipe, ingredients, allRecipes = []) {
  const allergens = allRecipes.length
    ? getRecipeAllergensStrict(recipe, allRecipes, ingredients)
    : getRecipeAllergens(recipe, ingredients);
  if (allergens.length === 0) return "Nessun allergene dichiarato";
  // Testo pulito senza emoji per uso in testo corrente (es. etichetta stampata)
  const labels = allergens
    .map(a => (ALLERGENI_LABELS[a] || a).replace(/^[\p{Emoji}\s]+/u, "").trim());
  return "Contiene: " + labels.join(", ");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 4 — NUTRIZIONE
// ═══════════════════════════════════════════════════════════════════════════════
const EMPTY_NUTRITION = { kcal:0, fat:0, satFat:0, carbs:0, sugars:0, protein:0, salt:0 };

function calcRecipeNutrition(recipe, ingredients) {
  const ris = recipe?.ingredients || [];
  if (ris.length === 0) return { ...EMPTY_NUTRITION };

  // Somma il contributo assoluto di ogni ingrediente:
  // ogni nutritionPer100g è per 100g dell'ingrediente,
  // quindi il contributo di ri.q grammi è (val / 100) * ri.q
  const abs = { ...EMPTY_NUTRITION };
  ris.forEach(ri => {
    const q = Number(ri.q) || 0;
    if (q <= 0) return;
    const ing = ingredients.find(i => i.id === ri.id);
    const n = ing?.nutritionPer100g || {};
    Object.keys(abs).forEach(k => { abs[k] += ((n[k] || 0) / 100) * q; });
  });

  // Denominatore: yield_g se valido, altrimenti totale input (fallback robusto)
  const yieldG = Number(recipe?.yield_g);
  const totalInput = ris.reduce((s, ri) => s + (Number(ri.q) || 0), 0);
  const denom = (yieldG > 0) ? yieldG : (totalInput > 0 ? totalInput : 1);

  // Normalizza a 100g di prodotto finito — GUARDIA: Infinity/NaN → 0
  const per100 = { ...EMPTY_NUTRITION };
  Object.keys(abs).forEach(k => {
    const v = (abs[k] / denom) * 100;
    per100[k] = isFinite(v) ? v : 0;
  });
  return per100;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 5 — NORMALIZZATORI E MIGRAZIONE DATI
// ═══════════════════════════════════════════════════════════════════════════════

// Lookup nutrizionale per migrazione legacy — indicizzato per id e name (lowercase).
// Viene popolato dopo DEFAULT_INGREDIENTS_RAW, quindi qui è definita solo la struttura;
// il contenuto viene iniettato dall'IIFE sotto (evita dipendenza circolare).
const DEFAULT_NUTRITION_LOOKUP = {};
// ← verrà popolato subito dopo DEFAULT_INGREDIENTS_RAW (vedere più in basso)

function isNutritionAllZero(n) {
  if (!n || typeof n !== "object") return true;
  return Object.values(n).every(v => !v || Number(v) === 0);
}

function normalizeIngredient(raw) {
  if (!raw || typeof raw !== "object") raw = {};

  // cost è il campo canonico (€/grammo). Se manca ma c'è netCostPerGram
  // (scrittura alternativa da versioni precedenti) lo usiamo come fallback.
  const cost = (typeof raw.cost === "number" && raw.cost >= 0)
    ? raw.cost
    : (typeof raw.netCostPerGram === "number" && raw.netCostPerGram >= 0)
      ? raw.netCostPerGram
      : 0;

  // allergens: garantisce sempre array di stringhe non vuote
  const allergens = Array.isArray(raw.allergens)
    ? raw.allergens.filter(a => typeof a === "string" && a.length > 0)
    : [];

  // nutritionPer100g: garantisce sempre oggetto con tutte le chiavi numeriche
  const rawN = (raw.nutritionPer100g && typeof raw.nutritionPer100g === "object")
    ? raw.nutritionPer100g
    : {};
  let nutritionPer100g = {
    kcal:    typeof rawN.kcal    === "number" ? rawN.kcal    : 0,
    fat:     typeof rawN.fat     === "number" ? rawN.fat     : 0,
    satFat:  typeof rawN.satFat  === "number" ? rawN.satFat  : 0,
    carbs:   typeof rawN.carbs   === "number" ? rawN.carbs   : 0,
    sugars:  typeof rawN.sugars  === "number" ? rawN.sugars  : 0,
    protein: typeof rawN.protein === "number" ? rawN.protein : 0,
    salt:    typeof rawN.salt    === "number" ? rawN.salt    : 0,
  };

  // ── MIGRAZIONE LEGACY: prova a recuperare i valori mancanti dal lookup
  // dei default (per id o per name, case-insensitive), senza sovrascrivere
  // i campi già valorizzati dall'utente.
  {
    const byId   = raw.id   ? DEFAULT_NUTRITION_LOOKUP[`id:${raw.id}`]   : null;
    const byName = raw.name ? DEFAULT_NUTRITION_LOOKUP[`name:${String(raw.name).toLowerCase().trim()}`] : null;
    const fallback = byId || byName;
    if (fallback && !isNutritionAllZero(fallback)) {
      const merged = { ...nutritionPer100g };
      Object.keys(merged).forEach(k => {
        if ((!merged[k] || Number(merged[k]) === 0) && Number(fallback[k] || 0) > 0) {
          merged[k] = Number(fallback[k] || 0);
        }
      });
      nutritionPer100g = merged;
    }
  }

  // priceHistory: garantisce sempre array
  const priceHistory = Array.isArray(raw.priceHistory) ? raw.priceHistory : [];

  // ── MAGAZZINO per sede ───────────────────────────────────────────────────────
  // stockBySede è l'unica fonte di verità per lo stock.
  // Migrazione legacy: se era presente un campo stock flat (v. precedenti) lo ignoriamo.
  const normalizeStockSede = (raw) => ({
    currentStock_g: typeof raw?.currentStock_g === "number" && raw.currentStock_g >= 0 ? raw.currentStock_g : 0,
    minStock_g:     typeof raw?.minStock_g     === "number" && raw.minStock_g     >= 0 ? raw.minStock_g     : 0,
  });
  const stockBySede = {
    "Sestri Levante": normalizeStockSede(raw.stockBySede?.["Sestri Levante"]),
    "Chiavari":       normalizeStockSede(raw.stockBySede?.["Chiavari"]),
  };

  return {
    id:              raw.id ?? Date.now(),
    name:            typeof raw.name === "string" ? raw.name : "",
    unit:            typeof raw.unit === "string" && raw.unit ? raw.unit : "g",
    category:        typeof raw.category === "string" && raw.category ? raw.category : "Generico",
    supplier:        typeof raw.supplier === "string" ? raw.supplier : "",
    supplierId:      raw.supplierId ?? null,
    secondarySupplierIds: Array.isArray(raw.secondarySupplierIds) ? raw.secondarySupplierIds : [],
    supplierSku:     typeof raw.supplierSku === "string" ? raw.supplierSku : "",
    packageSize:     raw.packageSize ?? null,
    packageUnit:     typeof raw.packageUnit === "string" && raw.packageUnit ? raw.packageUnit : "kg",
    preferredPackSize: raw.preferredPackSize ?? raw.packageSize ?? null,
    preferredPackUnit: typeof raw.preferredPackUnit === "string" && raw.preferredPackUnit ? raw.preferredPackUnit : (raw.packageUnit || "kg"),
    purchasePrice:   raw.purchasePrice ?? null,
    cost,                                      // € per grammo — campo canonico
    netCostPerGram:  cost,                     // sempre allineato a cost
    yieldPercent:    typeof raw.yieldPercent  === "number" ? raw.yieldPercent  : 100,
    wastePercent:    typeof raw.wastePercent  === "number" ? raw.wastePercent  : 0,
    leadTimeDays:    typeof raw.leadTimeDays === "number" ? raw.leadTimeDays : null,
    minOrderQty:     typeof raw.minOrderQty === "number" ? raw.minOrderQty : null,
    lastPriceUpdate: raw.lastPriceUpdate ?? null,
    lastLotCode:     typeof raw.lastLotCode === "string" ? raw.lastLotCode : "",
    lastReceiptDate: raw.lastReceiptDate ?? null,
    priceHistory,
    allergens,
    nutritionPer100g,
    haccpRiskLevel:  typeof raw.haccpRiskLevel === "string" ? raw.haccpRiskLevel : "medio",
    requiresTempCheck: raw.requiresTempCheck === true,
    requiresLotTracking: raw.requiresLotTracking !== false,
    requiresCoA:     raw.requiresCoA === true,
    notes:           typeof raw.notes === "string" ? raw.notes : "",
    active:          raw.active !== false,
    // ── Magazzino ─────────────────────────────────────────────────────────────
    stockEnabled:    raw.stockEnabled !== false,           // default true
    stockBySede,                                           // stock separato per sede
    unitPurchase:    typeof raw.unitPurchase === "string" && raw.unitPurchase ? raw.unitPurchase : "kg",
    stockLastUpdate: raw.stockLastUpdate ?? null,          // ISO date ultima movimentazione
  };
}

function normalizeRecipe(raw) {
  return {
    id: raw.id ?? Date.now(),
    name: raw.name ?? "",
    category: raw.category ?? "Creme classiche",
    yield_g: raw.yield_g ?? 3000,
    notes: raw.notes ?? "",
    ingredients: (raw.ingredients ?? []).map(ri => ({ id: ri.id, q: ri.q })),
    active: raw.active ?? true,
    lastModifiedAt: raw.lastModifiedAt ?? null,
    labelRevision: Number(raw.labelRevision || 1),
    labelApprovedRevision: Number(raw.labelApprovedRevision || 0),
    labelApprovedVersion: raw.labelApprovedVersion ?? null,
    labelApprovedAt: raw.labelApprovedAt ?? null,
    labelApprovedBy: typeof raw.labelApprovedBy === "string" ? raw.labelApprovedBy : "",
    labelNeedsReview: raw.labelNeedsReview !== false,
    isSemiFinished: raw.isSemiFinished === true,
    producedIngredientId: raw.producedIngredientId ?? null,
    semiFinishedShelfLifeDays: typeof raw.semiFinishedShelfLifeDays === "number" ? raw.semiFinishedShelfLifeDays : 3,
    // ── FASE 1: reparto — default gelateria, compatibilità legacy garantita ──
    repartoId: (typeof raw.repartoId === "string" && REPARTI.some(r => r.id === raw.repartoId))
      ? raw.repartoId
      : REPARTO_DEFAULT,
  };
}

function normalizeListinoEntry(raw, recipes) {
  return {
    id: raw.id,
    nome: raw.nome ?? (recipes.find(r => r.id === raw.id)?.name ?? ""),
    disponibile: raw.disponibile ?? true,
  };
}

function normalizeListino(raw, recipes) {
  const result = {};
  SEDI.forEach(sede => {
    const existing = raw[sede] ?? [];
    const normalized = existing.map(e => normalizeListinoEntry(e, recipes));
    result[sede] = normalized;
  });
  return result;
}

function normalizeCosti(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  // GUARDIA: valori negativi clampati; NaN/undefined → default K2 reali
  const safePos = (v, def) => { const n = Number(v); return (isFinite(n) && n >= 0) ? n : def; };
  return {
    manodopera:       safePos(raw.manodopera,       9450),
    energia:          safePos(raw.energia,           1600),
    altro:            safePos(raw.altro,              900),
    packaging:        safePos(raw.packaging,          0.15),
    porzioni_mensili: Math.max(1, safePos(raw.porzioni_mensili, 7900)), // min 1 evita /0
    markup_default:   Math.max(0, safePos(raw.markup_default,   3.5)),
    porzione_default: Math.max(1, safePos(raw.porzione_default, 150)),  // min 1g
  };
}

const DEFAULT_PRICE_LIST = [
  { id:"s80",  label:"Coppetta S (80g)",   price:2.00 },
  { id:"m120", label:"Coppetta M (120g)",  price:2.50 },
  { id:"l150", label:"Coppetta L (150g)",  price:3.00 },
  { id:"cono", label:"Cono (150g)",        price:3.00 },
  { id:"v500", label:"Vaschetta 500g",     price:13.50 },
  { id:"v750", label:"Vaschetta 750g",     price:20.00 },
  { id:"v1kg", label:"Vaschetta 1 kg",     price:27.00 },
];

function normalizePriceList(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_PRICE_LIST.map(p => ({ ...p }));
  return raw.map(p => ({ id: p.id ?? String(Date.now()), label: p.label ?? "", price: Number(p.price ?? 0) }));
}


const PRELOADED_SUPPLIERS_RAW = [
  {
    name: "A.P.I. srl",
    ragioneSociale: "A.P.I. srl",
    piva: "IT03442530618",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Saratoga mufficida antimuffa spray Z10 contro muffe alghe muschi licheni 1000ml Pezzi 2 x",
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "A2ZWORLD SRL",
    ragioneSociale: "A2ZWORLD SRL",
    piva: "IT07212330968",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Interruttore Magnetotermico Trifase, MCB 380V 4P 32A C32, Curva C 6kA, 4 Moduli DIN",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Amazon EU S.a r.l., Succursale Italiana",
    ragioneSociale: "Amazon EU S.a r.l., Succursale Italiana",
    piva: "IT08973230967",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Olcelli Farmaceutici Perossido didrogeno soluzione diluita in acqua depurata 3% - Bottiglia 250 ml",
      "Costi di spedizione",
      "Perlier Bagno Schiuma Muschio Bianco - 3000 ml con dosatore",
      "edihome, Stand Appendiabiti, Doppio, 110 x 150 x 54 cm, Vestitore, Appendiabiti da Terra, Resistente, Metallico, con Supporto per Scarpe (Nero Doppio)",
      "Black+Decker 9045854BND Accessori Compressore d'Aria, 230 V, Nero, BD KIT 6 PCS, Set di 6 Pezzi",
      "VECTRA Felis Antiparassitario per Gatti, 3 Pipette antipulci in soluzione Spot-on per gattini e gatti adulti, Trattamento e prevenzione pulci gatto",
      "Hisense BI64211PX, Forno Multifunzione Termoventilato, Cavita XXL 77L , Auto Pulizia Pirolitica,",
      "funzioni di cottura, Funzione pizza 300oC, Cottura AirFry, Cottura Multifase, Display Led",
      "VASAGLE Mensola da Muro, Mensola da Parete, 20 x",
      "x 3,8 cm, per Portafoto Decorazioni, Soggiorno Studio Cucina, Bianco Classico LWS26WT",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 21 documenti letti.",
  },
  {
    name: "Avis Budget Italia S.p.A.",
    ragioneSociale: "Avis Budget Italia S.p.A.",
    piva: "IT00886991009",
    category: "Acquisti locali",
    leadTimeDays: 1,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Noleggio furgone 1 giorno con 100 km su contratto",
      "CATENE DA NEVE su contratto 24252",
      "COSTI AMMINISTRAT. su contratto 24252",
      "ONERI CIRC.AUTOVEIC/ROAD TAX su contratto",
      "Sconto Web Prepagamento PrenotazioneID 1250383 su contratto",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Banco BPM S.p.A.",
    ragioneSociale: "Banco BPM S.p.A.",
    piva: "IT10537050964",
    category: "Servizi finanziari / POS",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "CANONE MENSILE",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 2 documenti letti.",
  },
  {
    name: "CARTALPLAST SAS DI FRANCO PIATTI E KATIA DOLCINO",
    ragioneSociale: "CARTALPLAST SAS DI FRANCO PIATTI E KATIA DOLCINO",
    piva: "IT01126900107",
    category: "Packaging",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "SUPERPOLO 0 CLASSIC PZ.50 CC.420",
      "SUPERPOLO 1 PZ.50 GR.500",
      "SUPERPOLO 2 PZ.50 GR.750",
      "SUPERPOLO 3 PZ.50 GR.1000",
      "BRIOCHES SICILIANE PZ.10/8",
      "COPPA SARA PZ.420",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 3 documenti letti.",
  },
  {
    name: "Centrale del Latte d'Italia S.p.A.",
    ragioneSociale: "Centrale del Latte d'Italia S.p.A.",
    piva: "IT01934250018",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "PREMIO DI PRODUZIONE ANNO 2024",
      "1-PANNA UHT PASTICCERIA 1L CLT",
      "LUHT INTERO BRK 1L POLENGHI",
      "LATTE UHT TIGUL. INT.1 L",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 2 documenti letti.",
  },
  {
    name: "Enel Energia S.p.A.",
    ragioneSociale: "Enel Energia S.p.A.",
    piva: "IT15844561009",
    category: "Utenze",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Energia fascia F1 - Energia in F1",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Energia fascia F1 - Perdite di rete fascia F1",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Energia fascia F2 - Energia in F2",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Energia fascia F2 - Perdite di rete fascia F2",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Energia fascia F3 - Energia in F3",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Energia fascia F3 - Perdite di rete fascia F3",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Altri importi materia energia - Quota fissa - Commercializzazione vendita",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Altri importi materia energia - Quota consumi",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Altri importi materia energia - Quota consumi - Dispacciamento",
      "SPESA PER LA VENDITA DI ENERGIA ELETTRICA - Altri importi materia energia - Quota consumi - Corrispettivo di Sbilanciamento",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 10 documenti letti.",
  },
  {
    name: "EURO CASH sas di A. Cornacchia",
    ragioneSociale: "EURO CASH sas di A. Cornacchia",
    piva: "IT01120880990",
    category: "Acquisti locali",
    leadTimeDays: 1,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "AGGIORNAMENTO FIRMWARE E SOFTWARE RCH LDP03 RT MATR. 72MU5003892",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "EVERGREENWEB S.R.L.",
    ragioneSociale: "EVERGREENWEB S.R.L.",
    piva: "IT01657830475",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "FASTWEB SpA",
    ragioneSociale: "FASTWEB SpA",
    piva: "IT12878470157",
    category: "Telefonia",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Fastweb Business",
      "Importo per Rata Contributo attivazione rateizzato in 48 mesi (14 di 48)",
      "Sconto contributo attivazione per 48 mesi dal 01/01/2025 al 31/01/2025",
      "7,00 € -7,00 € 22 % - Data inizio: 01/01/2025, Data fine: 31/01/2025",
      "Importo per Rata Contributo attivazione rateizzato in 48 mesi (13 di 48)",
      "Importo per Rata Contributo attivazione rateizzato in 48 mesi (15 di 48)",
      "Sconto contributo attivazione per 48 mesi dal 01/02/2025 al 28/02/2025",
      "7,00 € -7,00 € 22 % - Data inizio: 01/02/2025, Data fine: 28/02/2025",
      "Sconto contributo attivazione per 48 mesi dal 01/03/2025 al 31/03/2025",
      "7,00 € -7,00 € 22 % - Data inizio: 01/03/2025, Data fine: 31/03/2025",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 6 documenti letti.",
  },
  {
    name: "FERRERO COMMERCIALE ITALIA S.r.l.",
    ragioneSociale: "FERRERO COMMERCIALE ITALIA S.r.l.",
    piva: "IT03629090048",
    category: "Bevande / pausa",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "A513-77262120-8000500131329- NUTELLA G3000X2 PLA/BUC F/SER",
      "E201-77264212-8000500399859- ESTATHE BOT LIM DE LT0,25X12 BT KIDS BOT",
      "E202-77264211-8000500399866- ESTATHE BOT P/DET LT0,25X12 BT KIDS BOTT",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "FERRUCCI GROUP S.R.L.",
    ragioneSociale: "FERRUCCI GROUP S.R.L.",
    piva: "IT06984900727",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "FERRUCCI COMFORT Pigiama Sanitario Invernale per Anziani - 9012 F - Unisex - Adatto per l'inverno - Felpato (Donna, L)",
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "GIORGETTI SRL",
    ragioneSociale: "GIORGETTI SRL",
    piva: "IT01442730469",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "ZUCCHERO SEMOLATO KG.25 (2557)",
      "SCIROPPO GLUCOSIO 42DE KG.10 (1820)",
      "TOVAGLIOLINI 17 X 17 X 5.000",
      "TOVAGLIOLI MONOVELO 33x33 BIANCO x 200 (CAR TOVAGL.33)",
      "CIALDE ROTONDE X 1000 art.140 (DISC01)",
      "GIORGETTI NOCCIOLE INTERE KG.2",
      "GIORGETTI LATTE IN POLVERE KG.1 (10)",
      "TECNOPACK CONTEN.POLISTIROLO gr.500 x 40 pz. (TA1) (11TKGTA010N3)",
      "FRAGOLE SENGA SENGANA KG.1",
      "MONTEBIANCO CACAO GERKENS 22/24 GT 78 K.1 (7808020)",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Golfo Genova S.r.l.",
    ragioneSociale: "Golfo Genova S.r.l.",
    piva: "IT02418440992",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "UOVA ZUNINO X10 ALL TERRA",
      "ZUCCHERO 1kg",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "I-COMMERCE SRLS",
    ragioneSociale: "I-COMMERCE SRLS",
    piva: "IT05490620654",
    category: "Bevande / pausa",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "300 Cialda caffe Borbone ESE 44mm miscela NERO",
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "IL CERCHIO E LA BOTTE SRL",
    ragioneSociale: "IL CERCHIO E LA BOTTE SRL",
    piva: "IT01251330997",
    category: "Bevande / pausa",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Bib.FANTA pet cl.45X12, Coca C.",
      "Bib.COCA COLA ZERO pet cl.45x12, Coca Cola",
      "Bib.COCA COLA pet cl.45x24, Coca C.",
      "A.M. CALIZZANO NAT cl.50x24 PET",
      "A.M. CALIZZANO GAS cl.50x24 PET",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "IN'S Mercato S.p.A.",
    ragioneSociale: "IN'S Mercato S.p.A.",
    piva: "IT02896940273",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "Spugne con Fibra",
      "Disinf Tayform Classico",
      "Cioccolato Fondente",
      "Cioccolato Bianco",
      "Form Fresco Classico Spalm",
      "Lavapiatti Concentrato",
      "Sgrassatore Spray",
      "Sgrassatore Spray Universale",
      "Disinfettante Spray Tayform",
      "Zucchero Semolato",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 3 documenti letti.",
  },
  {
    name: "IREN ACQUA TIGULLIO SPA",
    ragioneSociale: "IREN ACQUA TIGULLIO SPA",
    piva: "IT02863660359",
    category: "Utenze",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Importo da precedenti fatture 1 NR -75,72 € -75,72 € 0 % N1",
      "Quote Fisse",
      "Acquedotto Quota Variabile 1 NR -2,94 € -2,94 € 10 %",
      "Fognatura Quota Variabile 1 NR -0,40 € -0,40 € 10 %",
      "Depurazione Quota Variabile 1 NR -1,08 € -1,08 € 10 %",
      "Oneri di Perequazione 1 NR -0,05 € -0,05 € 10 %",
      "Acquedotto Quota Variabile 1 NR -155,32 € -155,32 € 10 %",
      "Fognatura Quota Variabile 1 NR -21,47 € -21,47 € 10 %",
      "Depurazione Quota Variabile 1 NR -54,36 € -54,36 € 10 %",
      "Oneri di Perequazione 1 NR -1,54 € -1,54 € 10 %",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 2 documenti letti.",
  },
  {
    name: "IRETI SPA",
    ragioneSociale: "IRETI SPA",
    piva: "IT02863660359",
    category: "Utenze",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Quote Fisse",
      "Acquedotto Quota Variabile",
      "Fognatura Quota Variabile",
      "Oneri di Perequazione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 2 documenti letti.",
  },
  {
    name: "Just-Eat Italy S.r.l",
    ragioneSociale: "Just-Eat Italy S.r.l",
    piva: "IT07392740960",
    category: "Servizi finanziari / POS",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Posizionamento Premium 16039 (24/02/25 - 02/03/25)",
      "Commissione cancellazione ordine 185210542",
      "Commissione cancellazione ordine 185278664",
      "Commissione cancellazione ordine 185300213",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "LABORATORI BIO LINE SOCIETA' A RESPONSABILITA' LIMITATA",
    ragioneSociale: "LABORATORI BIO LINE SOCIETA' A RESPONSABILITA' LIMITATA",
    piva: "IT01030500290",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "Mono e digliceridi degli acidi grassi (E471) - Additivo alimentare di origine vegetale,",
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Neirotti Group di Neirotti Emanuele",
    ragioneSociale: "Neirotti Group di Neirotti Emanuele",
    piva: "IT12639680011",
    category: "Consulenza",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Supporto al progetto di Transizione 5.0 - Codice Richiesta: TR5-65705",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Nexi Payments SpA",
    ragioneSociale: "Nexi Payments SpA",
    piva: "IT10542790968",
    category: "Servizi finanziari / POS",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "CANONE GATEWAY ECOMMERCE - Comp. dicembre '25",
      "CANONE POS - Comp. ottobre '25 418146",
      "CANONE POS - Comp. novembre '25 418146",
      "CANONE POS - Comp. dicembre '25 418146",
      "CANONE GATEWAY ECOMMERCE - Comp. gennaio '26",
      "CANONE GATEWAY ECOMMERCE - Comp. febbraio '26",
      "CANONE GATEWAY ECOMMERCE - Comp. dicembre '24",
      "CANONE POS - Comp. ottobre '24 418146",
      "CANONE POS - Comp. novembre '24 418146",
      "CANONE POS - Comp. dicembre '24 418146",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 12 documenti letti.",
  },
  {
    name: "OLIVICOLTORI SESTRESI SOC.COOP.AGRIC.",
    ragioneSociale: "OLIVICOLTORI SESTRESI SOC.COOP.AGRIC.",
    piva: "IT00175010990",
    category: "Combustibili",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "POWER15 PELLET Powermaxx Premium 15 Kg. EN Plus - A1-78 Pezzi",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "PROBA PUNTO DOLCE SRL",
    ragioneSociale: "PROBA PUNTO DOLCE SRL",
    piva: "IT03420340105",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "PANNA WHITE CREAM 35% UHT LT.2 12,0 LT",
      "CHOCOVIC QUADOR COPERTURA FONDENTE 53.0% 5 KG PASTIGLIE 5,0 KG",
      "SEDAPLUS 361 KG 10 (GLUCOPLUS) 10,0 KG",
      "COPERTURA BIANCA KG2,5 CALLETS (W2-E5-U71) 2,5 KG",
      "CONO COPPA PICCOLA S.GL. 50X128 270PZ (NC091) 6,0 CT",
      "SEMOLATO SACCO TEREOS BEGHIN SAY 25KG (ZUC0285) 25,0 KG",
      "SPESE BANCA 0,0",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "SELLA LEASING S.p.A.",
    ragioneSociale: "SELLA LEASING S.p.A.",
    piva: "IT02675650028",
    category: "Servizi finanziari / POS",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "CANONE DI LOCAZIONE N. 8",
      "RIMBORSO SPESE DI INCASSO",
      "SERVIZI ASSICURATIVI",
      "QUOTA ASSICURAZIONE CATASTROFALE",
      "CANONE DI LOCAZIONE N. 9",
      "COMUNIC. ANNUALE RIF.ANNO 2025",
      "CANONE DI LOCAZIONE N. 10",
      "CANONE DI LOCAZIONE N. 52",
      "CANONE DI LOCAZIONE N. 53",
      "COMUNIC. ANNUALE RIF.ANNO 2024",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 6 documenti letti.",
  },
  {
    name: "silton2000 srl",
    ragioneSociale: "silton2000 srl",
    piva: "IT02545050128",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Lotto GIUBBOTTO DONNA 110 GRAMMI - PIUMINO DONNA INVERNALE - TRAPUNTATO IMBOTTITO",
      "GRAMMI GIACCA DONNA GIUBBOTTO DONNA CON CAPPUCCIO (M, 149650 BLU)",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "STUDIO SISMONDI-GALVAGNO E ASSOCIATI DOTTORI COMMERCIALISTI S.S.",
    ragioneSociale: "STUDIO SISMONDI-GALVAGNO E ASSOCIATI DOTTORI COMMERCIALISTI S.S.",
    piva: "IT03353760048",
    category: "Consulenza",
    leadTimeDays: 1,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "ONORARI, SPESE ED INDENNITA' SOGGETTE AD I.V.A.",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Tecmarket Servizi Spa",
    ragioneSociale: "Tecmarket Servizi Spa",
    piva: "IT03090380233",
    category: "Servizi finanziari / POS",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "POS Android WiFi-canone mensil;40090778",
      "MANCATA RESTITUZIONE POS;2296251",
      "COMM % TECNICA PAGOBCM;2296251 488,4 pz",
      "SC OP FINO 30E POS CLESS;2296251 449,4 pz -0,0001 € -0,04494 € 22 % - Data inizio: 01/10/2024",
      "COMM % TECNICA PAGOBCM;2296251 609,5 pz",
      "SC OP FINO 30E POS CLESS;2296251 472,5 pz -0,0001 € -0,04725 € 22 % - Data inizio: 01/11/2024",
      "COMM % TECNICA PAGOBCM;2296251 35,0 pz",
      "SC OP FINO 30E POS CLESS;2296251 35,0 pz -0,0001 € -0,00350 € 22 % - Data inizio: 01/12/2024",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 3 documenti letti.",
  },
  {
    name: "Unipiazza S.R.L.",
    ragioneSociale: "Unipiazza S.R.L.",
    piva: "IT05034380286",
    category: "Servizi finanziari / POS",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Abbonamento mensile (Chiosco) // dal 1 Gen 25 al 31 Gen",
      "Abbonamento mensile (Chiosco) // dal 1 Feb 25 al 28 Feb",
      "Abbonamento mensile (Chiosco) // dal 1 Mar 25 al 31 Mar",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 3 documenti letti.",
  },
  {
    name: "Venus",
    ragioneSociale: "Venus",
    piva: "IT02732790999",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Oxxigena Olio di Neem Biologico Vergine Puro al 100% - 250 ml - Spremuto a Freddo - Idratante, Ricostituente, Ideale per Capelli, Pelle - Vegano, senza OGM",
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "VERIDEA S.r.l.",
    ragioneSociale: "VERIDEA S.r.l.",
    piva: "IT00190550996",
    category: "Materie prime",
    leadTimeDays: 3,
    ratingQualita: 4.2,
    approved: true,
    approvedDate: today(),
    products: [
      "MACEDONIA BOSCO 4FRUTTI GELO 2X2.5KG",
      "POLPA MANGO BRICK 6X1KG",
      "SUCCO LIMONE 1° FIORE 12X500GR",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "WE Salus S.r.l.",
    ragioneSociale: "WE Salus S.r.l.",
    piva: "IT05892460873",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Weead di Angelo Mazzocchetti",
    ragioneSociale: "Weead di Angelo Mazzocchetti",
    piva: "IT02024510683",
    category: "Marketplace / manutenzione",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "Costi di spedizione",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 1 documenti letti.",
  },
  {
    name: "Wind Tre S.p.A.",
    ragioneSociale: "Wind Tre S.p.A.",
    piva: "IT13378520152",
    category: "Telefonia",
    leadTimeDays: 0,
    ratingQualita: 3.5,
    approved: true,
    approvedDate: today(),
    products: [
      "SUPER Unlimited dal 01/11/2025 al 30/11/2025",
      "SUPER Unlimited dal 01/12/2025 al 31/12/2025",
      "Opzione Secure Web Mobile dal 01/11/2025 al 30/11/2025",
      "Opzione Secure Web Mobile dal 01/12/2025 al 31/12/2025",
      "Canone Office PLUS Analogica dal 01/11/2025 al 31/12/2025",
      "Canone Office PLUS 200 dal 01/11/2025 al 31/12/2025",
      "Canone Secure Web dal 01/11/2025 al 31/12/2025",
      "Contributo Attivazione Office PLUS Rateizzato Rata 2 di",
      "Contributo Attivazione Office PLUS Rateizzato Rata 3 di",
      "Sconto Gold Canone Office PLUS 200 0 -40,00 € -40,00 € 22 %",
    ],
    note: "Catalogo importato da archivio fatture 2025-2026 · 3 documenti letti.",
  },
];

const DEFAULT_SUPPLIERS = PRELOADED_SUPPLIERS_RAW.map(normalizeSupplier);

function mergePreloadedSuppliers(existing = []) {
  const mergedMap = new Map();
  [...PRELOADED_SUPPLIERS_RAW.map(normalizeSupplier), ...(Array.isArray(existing) ? existing.map(normalizeSupplier) : [])]
    .forEach(s => {
      const key = normalizeCompanyKey(s.name || s.ragioneSociale || s.piva || s.id);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, s);
        return;
      }
      const prev = mergedMap.get(key);
      mergedMap.set(key, normalizeSupplier({
        ...prev,
        ...s,
        id: prev.id || s.id,
        products: [...(prev.products || []), ...(s.products || [])],
        note: [prev.note, s.note].filter(Boolean).join(prev.note && s.note ? " · " : ""),
      }));
    });
  return [...mergedMap.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
const DEFAULT_SUPPLIER_DOCS = [];
const DEFAULT_GOODS_RECEIPTS = [];
const DEFAULT_HACCP_TEMPS = [];
const DEFAULT_HACCP_SANIFICATIONS = [];
const DEFAULT_HACCP_NC = [];
const DEFAULT_HACCP_TRACEABILITY = [];
const DEFAULT_HACCP_TASKS = [];
const DEFAULT_PRODUCTION_LOG = [];
const DEFAULT_CHECKLIST_LOGS = [];
const DEFAULT_TURNI_STAFF = [];
const DEFAULT_STAFF_LIST = [
  { id:"s1", nome:"", sede:"Sestri Levante", attiva:true },
];
const DEFAULT_INVENTORY_AUDITS = [];
const DEFAULT_PURCHASE_ORDERS = [];
const DEFAULT_AUTH_USERS = [
  { id:"admin", name:"Amministratore", role:"admin", pin:"", active:true },
  { id:"lab", name:"Laboratorio", role:"lab", pin:"", active:true },
  { id:"shop", name:"Punto vendita", role:"shop", pin:"", active:true },
];

function normalizeInventoryAudit(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("audit"),
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    date: raw.date ?? today(),
    status: typeof raw.status === "string" ? raw.status : "draft",
    note: typeof raw.note === "string" ? raw.note : "",
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    appliedAt: raw.appliedAt ?? null,
    lines: Array.isArray(raw.lines) ? raw.lines.map(line => ({
      ingredientId: line?.ingredientId ?? null,
      ingredientName: typeof line?.ingredientName === "string" ? line.ingredientName : "",
      theoretical_g: Number(line?.theoretical_g || 0),
      counted_g: Number(line?.counted_g || 0),
      delta_g: Number(line?.delta_g || 0),
    })) : [],
  };
}

function normalizePurchaseOrder(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("po"),
    supplierId: raw.supplierId ?? null,
    supplierName: typeof raw.supplierName === "string" ? raw.supplierName : "",
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    date: raw.date ?? today(),
    status: typeof raw.status === "string" ? raw.status : "draft",
    note: typeof raw.note === "string" ? raw.note : "",
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    lines: Array.isArray(raw.lines) ? raw.lines.map(line => ({
      ingredientId: line?.ingredientId ?? null,
      ingredientName: typeof line?.ingredientName === "string" ? line.ingredientName : "",
      current_g: Number(line?.current_g || 0),
      min_g: Number(line?.min_g || 0),
      shortage_g: Number(line?.shortage_g || 0),
      risk: typeof line?.risk === "string" ? line.risk : "medio",
      estimatedValue: Number(line?.estimatedValue || 0),
      ordered_g: Number(line?.ordered_g || line?.shortage_g || 0),
    })) : [],
  };
}

function normalizeAuthUser(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  const role = ["admin","lab","shop"].includes(raw.role) ? raw.role : "shop";
  return {
    id: raw.id ?? makeK2Id("usr"),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Utente",
    role,
    pin: typeof raw.pin === "string" ? raw.pin : "",
    active: raw.active !== false,
  };
}

const ROLE_LABELS = {
  admin: "Amministratore",
  lab: "Laboratorio",
  shop: "Punto vendita",
};

const ROLE_PERMISSIONS = {
  admin: ["*"],
  lab: ["recordHaccp","manualStockAdjust","runProduction","editRecipes","closeInventory","receiveGoods"],
  shop: [],
};

function canUserPerform(role = "shop", action = "") {
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes("*") || allowed.includes(action);
}

const ROLE_SECTION_ACCESS = {
  admin: ["*"],
  lab: ["dashboard","foodcost","produzione","magazzino","etichette","listino","fornitori","haccp","checklist","turni","ricettario","lista-spesa"],
  shop: ["dashboard","incassi","listino","turni","checklist"],
};

function canAccessSection(role = "shop", section = "dashboard") {
  const allowed = ROLE_SECTION_ACCESS[role] || [];
  return allowed.includes("*") || allowed.includes(section);
}

const DEFAULT_HACCP_AREAS = [
  { id:"cella-latte", name:"Cella latte", minAllowed_c:-2, maxAllowed_c:4 },
  { id:"frigo-laboratorio", name:"Frigo laboratorio", minAllowed_c:0, maxAllowed_c:4 },
  { id:"freezer", name:"Freezer", minAllowed_c:-25, maxAllowed_c:-18 },
  { id:"vetrina-gelato", name:"Vetrina gelato", minAllowed_c:-16, maxAllowed_c:-10 },
  { id:"abbattitore", name:"Abbattitore", minAllowed_c:-35, maxAllowed_c:3 },
];
const MAX_MOVIMENTI = 5000;
const MAX_TRACE_ROWS = 10000; // aumentato: 2 sedi × 15 ricette/giorno × 365gg ≈ 10.950 righe/anno
const MAX_TASKS = 500;
const PRODUCTION_KEY_PREFIX = "prod::";

function makeK2Id(prefix = "id") {
  try {
    const uuid = globalThis?.crypto?.randomUUID?.();
    if (uuid) return `${prefix}-${uuid}`;
  } catch (err) {
    // fallback sotto
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeProductionLogEntry(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("plog"),
    sessionKey: typeof raw.sessionKey === "string" ? raw.sessionKey : "",
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    repartoId: typeof raw.repartoId === "string" ? raw.repartoId : REPARTO_DEFAULT,
    date: raw.date ?? today(),
    lotto: typeof raw.lotto === "string" ? raw.lotto : "",
    timestamp: raw.timestamp ?? new Date().toISOString(),
    totalRecipes: typeof raw.totalRecipes === "number" ? raw.totalRecipes : 0,
    totalIngredients: typeof raw.totalIngredients === "number" ? raw.totalIngredients : 0,
  };
}

function buildProductionSessionKey(sede, dateIso, lotto) {
  return `${PRODUCTION_KEY_PREFIX}${sede}::${dateIso}::${lotto}`;
}

function buildPriceHistoryEntry({ date = today(), oldCost = 0, newCost = 0, purchasePrice = null, supplier = "", note = "" }) {
  return {
    id: makeK2Id("ph"),
    date,
    oldCost: Number(oldCost || 0),
    newCost: Number(newCost || 0),
    purchasePrice: purchasePrice === null ? null : Number(purchasePrice || 0),
    supplier,
    note,
  };
}

function areStringArraysEqual(a = [], b = []) {
  const aa = [...new Set((a || []).map(x => String(x).trim()).filter(Boolean))].sort();
  const bb = [...new Set((b || []).map(x => String(x).trim()).filter(Boolean))].sort();
  if (aa.length !== bb.length) return false;
  return aa.every((x, idx) => x === bb[idx]);
}

async function copyTextToClipboard(text) {
  try {
    if (globalThis?.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (err) {
    return false;
  }
}

function buildSupplierOrderMessage({ group, supplier = null, sede = 'Sestri Levante' }) {
  const lines = [
    `Ordine materiali · ${sede}`,
    `Fornitore: ${group?.supplierName || supplier?.name || '—'}`,
    supplier?.referente ? `Referente: ${supplier.referente}` : null,
    `Data: ${formatDateIT(today())}`,
    '',
    'Richiesta di riordino:',
    ...((group?.rows || []).map((row, idx) => `${idx + 1}. ${row.ingredientName} — da ordinare ${fmtStock(row.shortage_g)} (stock ${fmtStock(row.current_g)} / min ${fmtStock(row.min_g)})`)),
    '',
    `Valore stimato: ${fmtE(group?.totalValue || 0)}`,
    '',
    'Confermare disponibilità, tempi di consegna e lotto/documenti allegati se necessari.',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildSupplierOrderPrintableData({ group, supplier = null, sede = 'Sestri Levante' }) {
  return {
    supplierName: group?.supplierName || supplier?.name || '—',
    referente: supplier?.referente || '',
    contatti: [supplier?.telefono, supplier?.email].filter(Boolean).join(' · '),
    sede,
    date: today(),
    lines: (group?.rows || []).map((row, idx) => ({
      idx: idx + 1,
      ingredientName: row.ingredientName,
      shortage_g: Number(row.shortage_g || 0),
      current_g: Number(row.current_g || 0),
      min_g: Number(row.min_g || 0),
      risk: row.risk || 'medio',
    })),
    totalValue: Number(group?.totalValue || 0),
    leadTimeDays: group?.leadTimeDays ?? supplier?.leadTimeDays ?? null,
  };
}

function formatDateRangeLabel(fromIso, toIso) {
  if (fromIso && toIso) return `${formatDateIT(fromIso)} → ${formatDateIT(toIso)}`;
  if (fromIso) return `dal ${formatDateIT(fromIso)}`;
  if (toIso) return `fino al ${formatDateIT(toIso)}`;
  return 'Tutto il periodo';
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/[\r\n]+/g, ' ');
  if (/[";,]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    return true;
  } catch (err) {
    // console.error('[K2] download failed:', err);
    return false;
  }
}

function openPrintWindow(html, title = 'K2 Suite') {
  try {
    const w = window.open('', '_blank', 'noopener,noreferrer,width=980,height=820');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    const triggerPrint = () => {
      try { w.focus(); w.print(); } catch (_) {}
    };
    if (w.document.readyState === 'complete') {
      setTimeout(triggerPrint, 250);
    } else {
      w.onload = () => setTimeout(triggerPrint, 250);
    }
    return true;
  } catch (err) {
    return false;
  }
}

function exportRowsToCsv(filename, columns, rows) {
  const header = columns.map(col => csvEscape(col.label)).join(';');
  const body = rows.map(row => columns.map(col => csvEscape(typeof col.value === 'function' ? col.value(row) : row?.[col.value])).join(';')).join('\n');
  return downloadTextFile(filename, `${header}\n${body}`, 'text/csv;charset=utf-8');
}

function isWithinDateRange(iso, fromIso, toIso) {
  if (!iso) return true;
  if (fromIso && iso < fromIso) return false;
  if (toIso && iso > toIso) return false;
  return true;
}

function getNextProductionLot({ sede, dateIso = today(), productionLog }) {
  if (!Array.isArray(productionLog)) productionLog = [];
  const base = `PROD-${String(dateIso || today()).replace(/-/g, "")}`;
  const used = new Set(
    (productionLog || [])
      .filter(r => r?.sede === sede && r?.date === dateIso)
      .map(r => String(r?.lotto || ""))
      .filter(Boolean)
  );
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of letters) {
    const candidate = `${base}-${letter}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${(productionLog || []).filter(r => r?.sede === sede && r?.date === dateIso).length + 1}`;
}

function applyIngredientStockChange({
  ingredient,
  sede,
  delta_g,
  movementType,
  causale,
  date,
  note = "",
  repartoId = null,
  unit = "g",
  overrideCostPerGram = null,
  overridePurchasePrice = null,
  supplierName = "",
  lotCode = "",
}) {
  const before_g = ingredient?.stockBySede?.[sede]?.currentStock_g ?? 0;
  const deltaRounded = Math.round(Number(delta_g) || 0);
  const after_g = Math.max(0, before_g + deltaRounded);

  let updatedIngredient = normalizeIngredient({
    ...ingredient,
    stockLastUpdate: date || today(),
    lastLotCode: lotCode || ingredient?.lastLotCode || "",
    lastReceiptDate: deltaRounded > 0 ? (date || ingredient?.lastReceiptDate || today()) : ingredient?.lastReceiptDate || null,
    stockBySede: {
      ...ingredient?.stockBySede,
      [sede]: {
        ...(ingredient?.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 }),
        currentStock_g: after_g,
      },
    },
  });

  if (typeof overrideCostPerGram === "number" && overrideCostPerGram >= 0) {
    updatedIngredient = normalizeIngredient({
      ...updatedIngredient,
      cost: overrideCostPerGram,
      netCostPerGram: overrideCostPerGram,
      purchasePrice: overridePurchasePrice ?? updatedIngredient.purchasePrice,
      supplier: supplierName || updatedIngredient.supplier || "",
      lastPriceUpdate: date || today(),
      priceHistory: [
        buildPriceHistoryEntry({
          date: date || today(),
          oldCost: ingredient?.cost || 0,
          newCost: overrideCostPerGram,
          purchasePrice: overridePurchasePrice,
          supplier: supplierName,
          note: note || (lotCode ? `Aggiornamento lotto ${lotCode}` : "Aggiornamento costo"),
        }),
        ...(Array.isArray(ingredient?.priceHistory) ? ingredient.priceHistory : []),
      ].slice(0, 50),
    });
  }

  const movimento = {
    id: makeK2Id("mov"),
    ingredientId: ingredient?.id,
    ingredientName: ingredient?.name || "",
    sede,
    repartoId,
    tipo: movementType,
    causale,
    quantita_g: Math.abs(deltaRounded),
    before_g,
    after_g,
    unit,
    dataMovimento: date || today(),
    note,
    createdAt: new Date().toISOString(),
  };

  return { updatedIngredient, movimento };
}

function computeDocStatus(dataScadenza) {
  if (!dataScadenza) return "valido";
  const diff = Math.floor((parseISODate(dataScadenza) - parseISODate(today())) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "scaduto";
  if (diff <= 30) return "in_scadenza";
  return "valido";
}

function supplierDocsStatusForSupplier(supplierId, supplierDocs) {
  const docs = supplierDocs.filter(d => d.supplierId === supplierId);
  if (docs.length === 0) return "mancanti";
  if (docs.some(d => d.stato === "scaduto")) return "scaduti";
  if (docs.some(d => d.stato === "in_scadenza")) return "in_scadenza";
  return "ok";
}

function buildCriticalDocTask(doc, suppliers = [], sede = "Sestri Levante") {
  const sup = suppliers.find(s => s.id === doc?.supplierId);
  return normalizeHaccpTask({
    sourceType: "supplierDoc",
    sourceId: doc?.id ?? null,
    priority: doc?.stato === "scaduto" ? "alta" : "media",
    title: `Verifica documento ${doc?.nomeDocumento || doc?.tipo || "fornitore"} · ${sup?.name || "Fornitore"}`,
    category: "fornitori",
    sede,
    dueDate: doc?.dataScadenza || today(),
    status: "open",
    owner: sup?.referente || "",
    note: `${doc?.stato === "scaduto" ? "Documento scaduto" : "Documento in scadenza"}${doc?.dataScadenza ? ` · scadenza ${formatDateIT(doc.dataScadenza)}` : ""}`,
  });
}

function upsertTaskBySource(tasks = [], task) {
  if (!task?.sourceType || !task?.sourceId) return [task, ...tasks].slice(0, MAX_TASKS);
  const idx = tasks.findIndex(t => t.sourceType === task.sourceType && t.sourceId === task.sourceId);
  if (idx === -1) return [task, ...tasks].slice(0, MAX_TASKS);
  return tasks.map((t, i) => i === idx ? normalizeHaccpTask({ ...t, ...task }) : t).slice(0, MAX_TASKS);
}

function removeTasksBySource(tasks = [], sourceType, sourceId) {
  return tasks.filter(t => !(t.sourceType === sourceType && t.sourceId === sourceId));
}

function getTraceabilityConsumedByReceipt(goodsReceiptId, traceRows = []) {
  if (!goodsReceiptId) return 0;
  return (traceRows || []).reduce((sum, row) => {
    const lineSum = (row?.ingredientLots || []).reduce((lineAcc, line) => {
      if (line?.goodsReceiptId !== goodsReceiptId) return lineAcc;
      return lineAcc + (Number(line?.qtyUsed_g) || 0);
    }, 0);
    return sum + lineSum;
  }, 0);
}

function getReceiptRemainingQty(receipt, traceRows = []) {
  const total_g = Number(receipt?.qtyReceived_g) || 0;
  const used_g = getTraceabilityConsumedByReceipt(receipt?.id, traceRows);
  return {
    total_g,
    used_g,
    remaining_g: Math.max(0, total_g - used_g),
  };
}

function allocateIngredientLotsFEFO({
  ingredientId, ingredientName, qtyNeeded_g,
  receipts = [], traceRows = [],
  fallbackLotCode = "DA-VERIFICARE",
  mode = "SAFE", // "STRICT" = blocca produzione | "SAFE" = warning + fallback
  sede = null,
}) {
  let remainingNeed_g = Math.max(0, Math.round(Number(qtyNeeded_g) || 0));
  const ingredientLots = [];
  const issues = [];

  const orderedReceipts = [...receipts]
    .filter(r => {
      if (!r || r.accepted === false) return false;
      if (r.ingredientId !== ingredientId) return false;
      if (sede && r.sede && r.sede !== sede) return false; // FIX: filtro sede
      return true;
    })
    .sort((a, b) => {
      // Valida formato YYYY-MM-DD prima di comparare (FIX: sort stringa sicuro)
      const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "9999-12-31";
      const expCmp = validDate(a.expiryDate).localeCompare(validDate(b.expiryDate));
      if (expCmp !== 0) return expCmp;
      const dateCmp = validDate(a.date).localeCompare(validDate(b.date));
      if (dateCmp !== 0) return dateCmp;
      return String(a.createdAt || a.id || "").localeCompare(String(b.createdAt || b.id || ""));
    });

  for (const receipt of orderedReceipts) {
    if (remainingNeed_g <= 0) break;
    const { remaining_g } = getReceiptRemainingQty(receipt, traceRows);
    if (remaining_g <= 0) continue;

    const alloc_g = Math.min(remainingNeed_g, remaining_g);
    ingredientLots.push({
      ingredientId,
      ingredientName,
      goodsReceiptId: receipt.id,
      lotCode: receipt.lotCode || fallbackLotCode,
      qtyUsed_g: alloc_g,
      sourceType: "receipt_fefo",
      costPerGram: receipt.costPerGram || null,
      sourceDetail: `Lotto ${receipt.lotCode || "—"} · ricevuto ${receipt.date || "—"}${receipt.expiryDate ? ` · scad. ${receipt.expiryDate}` : ""}`,
    });
    remainingNeed_g -= alloc_g;
  }

  const fullyAllocated = remainingNeed_g <= 0;

  if (!fullyAllocated) {
    const issue = {
      type: "STOCK_INSUFFICIENTE",
      ingredientId,
      ingredientName,
      unresolved_g: remainingNeed_g,
      message: `Stock insufficiente: mancano ${remainingNeed_g}g di ${ingredientName} con lotto tracciabile`,
    };
    issues.push(issue);

    if (mode === "STRICT") {
      // STRICT: NON aggiunge fallback — ritorna errore strutturato, produzione bloccata
      return { ingredientLots, unresolved_g: remainingNeed_g, fullyAllocated: false, blocked: true, issues, error: issue.message };
    }
    // SAFE: aggiunge fallback con marcatura chiara
    ingredientLots.push({
      ingredientId,
      ingredientName,
      goodsReceiptId: null,
      lotCode: fallbackLotCode,
      qtyUsed_g: remainingNeed_g,
      sourceType: "manual_check",
      costPerGram: null,
      sourceDetail: `ATTENZIONE: ${remainingNeed_g}g senza lotto certo — verificare fisicamente.`,
    });
  }

  return { ingredientLots, unresolved_g: remainingNeed_g, fullyAllocated, blocked: false, issues };
}


function buildInventoryAdjustmentTraceRow({
  ingredient,
  sede,
  date = today(),
  ingredientLots = [],
  note = "",
  movementType = "scarico",
  adjustmentQty_g = 0,
}) {
  const absQty = Math.max(0, Math.round(Number(adjustmentQty_g) || 0));
  return normalizeTraceability({
    date,
    sede,
    productionLot: `INVADJ-${String(date || today()).replace(/-/g, "")}-${ingredient?.id || "NA"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    recipeId: null,
    recipeName: `${movementType === "rettifica" ? "Rettifica manuale" : "Scarico manuale"} magazzino — ${ingredient?.name || "Ingrediente"}`,
    ingredientLots,
    outputQty_g: 0,
    note: `${movementType === "rettifica" ? "Rettifica inventario" : "Scarico manuale"}${note ? ` · ${note}` : ""}${absQty > 0 ? ` · qty ${absQty}g` : ""}`,
  });
}

function normalizeSupplierName(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCompanyKey(name = "") {
  return normalizeSupplierName(name)
    .replace(/(s p a|spa)/g, "spa")
    .replace(/(s r l|srl)/g, "srl")
    .replace(/(s a s|sas)/g, "sas")
    .replace(/(s n c|snc)/g, "snc")
    .replace(/(coop|cooperativa)/g, "coop")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchLoose(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/35%/g, "35")
    .replace(/70%/g, "70")
    .replace(/100%/g, "100")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUPPLIER_MATCH_STOPWORDS = new Set([
  "kg","g","gr","lt","l","ml","pz","pezzi","piece","pezzo","uht","classico","classic",
  "premium","data","inizio","fine","soluzione","carta","pagamento","documento","importo",
  "servizi","servizio","canone","quota","spesa","energia","fattura","mensile","comp",
  "dal","al","per","con","senza","fresh","fresco","fresca"
]);

function tokenizeLoose(text = "") {
  return normalizeSearchLoose(text)
    .split(" ")
    .map(t => t.trim())
    .filter(t => t.length > 1 && !SUPPLIER_MATCH_STOPWORDS.has(t));
}

const INGREDIENT_SUPPLIER_HINTS = {
  "panna fresca 35": ["proba punto dolce"],
  "cioccolato fondente 70": ["proba punto dolce", "in s mercato"],
  "cioccolato bianco": ["proba punto dolce", "in s mercato"],
  "panna": ["proba punto dolce"],
  "caffe": ["i commerce"],
};

function inferSupplierForIngredient(ingredient, suppliers = []) {
  if (!ingredient || !Array.isArray(suppliers) || suppliers.length === 0) return null;
  const ingredientNorm = normalizeSearchLoose(ingredient.name || "");
  const ingredientTokens = tokenizeLoose(`${ingredient.name || ""} ${ingredient.category || ""}`);
  if (!ingredientNorm || ingredientTokens.length === 0) return null;

  let best = null;
  let secondScore = 0;

  suppliers.forEach(supplier => {
    if (!supplier || supplier.active === false) return;
    const supplierKey = normalizeCompanyKey(supplier.name || supplier.ragioneSociale || "");
    let score = 0;
    let bestProduct = "";
    let bestProductScore = 0;
    let reason = "";

    if (ingredient.supplier && normalizeCompanyKey(ingredient.supplier) === supplierKey) {
      score += 100;
      reason = "legacy-name";
    }

    (INGREDIENT_SUPPLIER_HINTS[ingredientNorm] || []).forEach(hint => {
      const hintKey = normalizeCompanyKey(hint);
      if (supplierKey.includes(hintKey) || hintKey.includes(supplierKey)) {
        score += 35;
        reason = reason || "catalog-hint";
      }
    });

    const categoryNorm = normalizeSearchLoose(supplier.category || "");
    if (["latticini","zuccheri","paste","cioccolato","stabilizzanti"].some(k => normalizeSearchLoose(ingredient.category || "").includes(k)) && categoryNorm.includes("materie prime")) {
      score += 2;
    }

    (supplier.products || []).forEach(product => {
      const productNorm = normalizeSearchLoose(product);
      const productTokens = tokenizeLoose(product);
      const shared = ingredientTokens.filter(t => productTokens.includes(t));
      let productScore = 0;
      if (shared.length >= 2) productScore += shared.length * 6;
      else if (shared.length === 1) productScore += 3;
      if (productNorm.includes(ingredientNorm) || ingredientNorm.includes(productNorm)) productScore += 8;
      if (ingredientNorm.includes("panna") && /(panna|cream)/.test(productNorm)) productScore += 12;
      if (ingredientNorm.includes("cioccolato") && /(cioccolato|chocovic|copertura)/.test(productNorm)) productScore += 10;
      if (ingredientNorm.includes("pistacchio") && productNorm.includes("pistacchio")) productScore += 12;
      if (ingredientNorm.includes("nocciola") && productNorm.includes("nocciol")) productScore += 12;
      if (ingredientNorm.includes("caffe") && /(caffe|borbone)/.test(productNorm)) productScore += 10;
      if (productScore > bestProductScore) {
        bestProductScore = productScore;
        bestProduct = product;
      }
    });

    score += bestProductScore;
    const candidate = {
      supplierId: supplier.id,
      supplierName: supplier.name || "",
      productMatch: bestProduct,
      score,
      reason,
    };

    if (!best || candidate.score > best.score) {
      secondScore = best?.score || secondScore;
      best = candidate;
    } else if (candidate.score > secondScore) {
      secondScore = candidate.score;
    }
  });

  if (!best || best.score < 10) return null;
  if (best.score < (secondScore + 3) && best.reason !== "legacy-name") return null;

  return {
    ...best,
    confidence: best.score >= 40 ? "alta" : best.score >= 20 ? "media" : "bassa",
  };
}

function normalizeSupplierProducts(products = []) {
  return [...new Set(
    (Array.isArray(products) ? products : [])
      .map(p => String(p || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
  )];
}

function normalizeSupplier(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("sup"),
    name: typeof raw.name === "string" ? raw.name : "",
    ragioneSociale: typeof raw.ragioneSociale === "string" ? raw.ragioneSociale : "",
    category: typeof raw.category === "string" ? raw.category : "",
    referente: typeof raw.referente === "string" ? raw.referente : "",
    telefono: typeof raw.telefono === "string" ? raw.telefono : "",
    email: typeof raw.email === "string" ? raw.email : "",
    indirizzo: typeof raw.indirizzo === "string" ? raw.indirizzo : "",
    piva: typeof raw.piva === "string" ? raw.piva : "",
    cf: typeof raw.cf === "string" ? raw.cf : "",
    active: raw.active !== false,
    backup: raw.backup === true,
    giorniConsegna: Array.isArray(raw.giorniConsegna) ? raw.giorniConsegna : [],
    leadTimeDays: typeof raw.leadTimeDays === "number" ? raw.leadTimeDays : null,
    minOrderValue: typeof raw.minOrderValue === "number" ? raw.minOrderValue : 0,
    paymentTerms: typeof raw.paymentTerms === "string" ? raw.paymentTerms : "",
    ratingQualita: typeof raw.ratingQualita === "number" ? raw.ratingQualita : 3,
    note: typeof raw.note === "string" ? raw.note : "",
    approved: raw.approved !== false,
    approvedDate: raw.approvedDate ?? null,
    approvedBy: typeof raw.approvedBy === "string" ? raw.approvedBy : "",
    haccpDocsStatus: typeof raw.haccpDocsStatus === "string" ? raw.haccpDocsStatus : "ok",
    products: normalizeSupplierProducts(raw.products || []),
  };
}

function normalizeSupplierDoc(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("sdoc"),
    supplierId: raw.supplierId ?? null,
    tipo: typeof raw.tipo === "string" ? raw.tipo : "",
    nomeDocumento: typeof raw.nomeDocumento === "string" ? raw.nomeDocumento : "",
    dataEmissione: raw.dataEmissione ?? null,
    dataScadenza: raw.dataScadenza ?? null,
    stato: typeof raw.stato === "string" ? raw.stato : computeDocStatus(raw.dataScadenza ?? null),
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function normalizeGoodsReceipt(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("gr"),
    date: raw.date ?? today(),
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    supplierId: raw.supplierId ?? null,
    ingredientId: raw.ingredientId ?? null,
    ingredientName: typeof raw.ingredientName === "string" ? raw.ingredientName : "",
    lotCode: typeof raw.lotCode === "string" ? raw.lotCode : "",
    supplierLotCode: typeof raw.supplierLotCode === "string" ? raw.supplierLotCode : "",
    qtyReceived_g: typeof raw.qtyReceived_g === "number" ? raw.qtyReceived_g : 0,
    packageQty: typeof raw.packageQty === "number" ? raw.packageQty : 0,
    packageUnit: typeof raw.packageUnit === "string" ? raw.packageUnit : "kg",
    unitPurchasePrice: typeof raw.unitPurchasePrice === "number" ? raw.unitPurchasePrice : 0,
    totalCost: typeof raw.totalCost === "number" ? raw.totalCost : 0,
    expiryDate: raw.expiryDate ?? null,
    tempOnArrival_c: typeof raw.tempOnArrival_c === "number" ? raw.tempOnArrival_c : null,
    packagingOk: raw.packagingOk !== false,
    labelOk: raw.labelOk !== false,
    docsOk: raw.docsOk !== false,
    accepted: raw.accepted !== false,
    rejectionReason: typeof raw.rejectionReason === "string" ? raw.rejectionReason : "",
    operator: typeof raw.operator === "string" ? raw.operator : "",
    note: typeof raw.note === "string" ? raw.note : "",
    linkedMovimentoId: raw.linkedMovimentoId ?? null,
    // costPerGram: costo effettivo €/g calcolato da totalCost/qtyReceived_g al momento del ricevimento
    costPerGram: typeof raw.costPerGram === "number" && raw.costPerGram > 0
      ? raw.costPerGram
      : (typeof raw.totalCost === "number" && typeof raw.qtyReceived_g === "number" && raw.qtyReceived_g > 0
          ? raw.totalCost / raw.qtyReceived_g
          : 0),
  };
}

function normalizeHaccpTemp(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("tmp"),
    date: raw.date ?? today(),
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    area: typeof raw.area === "string" ? raw.area : "",
    equipmentId: typeof raw.equipmentId === "string" ? raw.equipmentId : "",
    temp_c: typeof raw.temp_c === "number" ? raw.temp_c : 0,
    minAllowed_c: typeof raw.minAllowed_c === "number" ? raw.minAllowed_c : null,
    maxAllowed_c: typeof raw.maxAllowed_c === "number" ? raw.maxAllowed_c : null,
    esito: typeof raw.esito === "string" ? raw.esito : "ok",
    operator: typeof raw.operator === "string" ? raw.operator : "",
    correctiveAction: typeof raw.correctiveAction === "string" ? raw.correctiveAction : "",
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function normalizeSanification(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("san"),
    date: raw.date ?? today(),
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    area: typeof raw.area === "string" ? raw.area : "",
    tipo: typeof raw.tipo === "string" ? raw.tipo : "ordinaria",
    prodottoUsato: typeof raw.prodottoUsato === "string" ? raw.prodottoUsato : "",
    lottoProdotto: typeof raw.lottoProdotto === "string" ? raw.lottoProdotto : "",
    operatore: typeof raw.operatore === "string" ? raw.operatore : "",
    esito: typeof raw.esito === "string" ? raw.esito : "ok",
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function normalizeNonConformity(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("nc"),
    date: raw.date ?? today(),
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    categoria: typeof raw.categoria === "string" ? raw.categoria : "",
    gravita: typeof raw.gravita === "string" ? raw.gravita : "media",
    descrizione: typeof raw.descrizione === "string" ? raw.descrizione : "",
    originId: raw.originId ?? null,
    correctiveAction: typeof raw.correctiveAction === "string" ? raw.correctiveAction : "",
    responsible: typeof raw.responsible === "string" ? raw.responsible : "",
    chiusa: raw.chiusa === true,
    closeDate: raw.closeDate ?? null,
    closeNote: typeof raw.closeNote === "string" ? raw.closeNote : "",
  };
}

function normalizeTraceability(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("trace"),
    date: raw.date ?? today(),
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    productionLot: typeof raw.productionLot === "string" ? raw.productionLot : "",
    recipeId: raw.recipeId ?? null,
    recipeName: typeof raw.recipeName === "string" ? raw.recipeName : "",
    ingredientLots: Array.isArray(raw.ingredientLots) ? raw.ingredientLots : [],
    outputQty_g: typeof raw.outputQty_g === "number" ? raw.outputQty_g : 0,
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function normalizeHaccpTask(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id: raw.id ?? makeK2Id("task"),
    title: typeof raw.title === "string" ? raw.title : "",
    category: typeof raw.category === "string" ? raw.category : "",
    sede: SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    dueDate: raw.dueDate ?? null,
    status: typeof raw.status === "string" ? raw.status : "open",
    owner: typeof raw.owner === "string" ? raw.owner : "",
    note: typeof raw.note === "string" ? raw.note : "",
    sourceType: typeof raw.sourceType === "string" ? raw.sourceType : "manual",
    sourceId: raw.sourceId ?? null,
    priority: typeof raw.priority === "string" ? raw.priority : "media",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6 — SYNC LISTINO ↔ RICETTE
// ═══════════════════════════════════════════════════════════════════════════════
function syncListinoWithRecipes(listino, recipes) {
  const result = {};
  SEDI.forEach(sede => {
    const existing = listino[sede] ?? [];
    // Aggiorna nomi e rimuovi orfani
    const synced = existing
      .filter(e => recipes.some(r => r.id === e.id))
      .map(e => {
        const rec = recipes.find(r => r.id === e.id);
        return { ...e, nome: rec?.name ?? e.nome };
      });
    // Aggiungi nuove ricette mancanti
    recipes.forEach(r => {
      if (!synced.some(e => e.id === r.id)) {
        synced.push({ id: r.id, nome: r.name, disponibile: true });
      }
    });
    result[sede] = synced;
  });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 7 — INTEGRITÀ DATI (dipendenze)
// ═══════════════════════════════════════════════════════════════════════════════
function findIngredientDependencies(ingredientId, recipes) {
  return recipes.filter(r => r.ingredients.some(ri => ri.id === ingredientId));
}
function findRecipeDependencies(recipeId, listino) {
  const sedi = [];
  SEDI.forEach(sede => {
    if ((listino[sede] ?? []).some(e => e.id === recipeId)) sedi.push(sede);
  });
  return sedi;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 8 — COSTANTI
// ═══════════════════════════════════════════════════════════════════════════════
const SEDI = ["Sestri Levante", "Chiavari"];
const SEDE_COLORS = { "Sestri Levante": "#c8a96e", "Chiavari": "#60a5fa" };

// ── Reparti — FASE 1 ─────────────────────────────────────────────────────────
const REPARTI = [
  { id: "gelateria",   label: "Gelateria",   icon: "🍦", color: "#c8a96e" },
  { id: "pasticceria", label: "Pasticceria", icon: "🥐", color: "#a78bfa" },
];
const REPARTO_DEFAULT = "gelateria";
const REPARTO_LABELS = Object.fromEntries(REPARTI.map(r => [r.id, r]));
// Badge reparto riutilizzabile
function RepartoBadge({ repartoId, small = false }) {
  const r = REPARTO_LABELS[repartoId] || REPARTO_LABELS[REPARTO_DEFAULT];
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:3,
      fontSize: small ? 9 : 10,
      color: r.color,
      background: r.color + "18",
      border: `1px solid ${r.color}44`,
      borderRadius: 10,
      padding: small ? "1px 6px" : "2px 8px",
      fontWeight: "normal",
      letterSpacing: "0.03em",
      whiteSpace: "nowrap",
    }}>
      {r.icon} {r.label}
    </span>
  );
}
const VOCI_INCASSO = [
  { key:"contante",  label:"Contante",  icon:"💵", color:"#4ade80" },
  { key:"pos",       label:"POS",       icon:"💳", color:"#60a5fa" },
  { key:"delivery",  label:"Delivery",  icon:"🛵", color:"#fbbf24" },
  { key:"rivendita", label:"Rivendita", icon:"🏪", color:"#a78bfa" },
  { key:"extra",     label:"Altro",     icon:"⬜", color:"var(--k2-text-dim)" },
];
const MESI = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const ANNO = new Date().getFullYear();
const ING_CATEGORIES = ["Latticini","Zuccheri","Paste e aromi","Cioccolato","Frutta","Stabilizzanti","Alcol","Altro"];
const NAV = [
  { id:"dashboard",    label:"Dashboard",    icon:"🏠" },
  { id:"incassi",      label:"Incassi",      icon:"💰" },
  { id:"foodcost",     label:"Food Cost",    icon:"🌾" },
  { id:"produzione",   label:"Produzione",   icon:"🏭" },
  { id:"magazzino",    label:"Magazzino",    icon:"📦" },
  { id:"etichette",    label:"Etichette",    icon:"🏷️" },
  { id:"listino",      label:"Listino",      icon:"🍦" },
  { id:"cashflow",     label:"Cashflow",     icon:"📊" },
  { id:"fornitori",    label:"Fornitori",    icon:"🚚" },
  { id:"haccp",        label:"HACCP",        icon:"🧪" },
  { id:"checklist",    label:"Checklist",    icon:"✅" },
  { id:"turni",        label:"Turni",        icon:"📅" },
  { id:"ricettario",   label:"Ricettario",   icon:"📖" },
  { id:"lista-spesa",   label:"Lista Spesa",  icon:"🛒" },
  { id:"impostazioni", label:"Impostazioni", icon:"⚙️" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 9 — DATI DEFAULT
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULT_INGREDIENTS_RAW = [
  { id:1,  name:"Latte intero fresco",       unit:"g", cost:0.00095, category:"Latticini",    allergens:["latte"],
    nutritionPer100g:{ kcal:64,  fat:3.6,  satFat:2.3,  carbs:4.8,  sugars:4.8,  protein:3.2, salt:0.10 } },
  { id:2,  name:"Panna fresca 35%",          unit:"g", cost:0.00380, category:"Latticini",    allergens:["latte"],
    nutritionPer100g:{ kcal:337, fat:35.0, satFat:23.0, carbs:3.0,  sugars:3.0,  protein:2.1, salt:0.08 } },
  { id:3,  name:"Latte scremato in polvere", unit:"g", cost:0.00480, category:"Latticini",    allergens:["latte"],
    nutritionPer100g:{ kcal:353, fat:0.7,  satFat:0.5,  carbs:52.0, sugars:52.0, protein:35.6,salt:1.17 } },
  { id:4,  name:"Tuorli d'uovo freschi",     unit:"g", cost:0.00750, category:"Latticini",    allergens:["uova"],
    nutritionPer100g:{ kcal:322, fat:26.5, satFat:7.5,  carbs:3.6,  sugars:0.4,  protein:16.0,salt:0.18 } },
  { id:6,  name:"Zucchero semolato",         unit:"g", cost:0.00105, category:"Zuccheri",     allergens:[],
    nutritionPer100g:{ kcal:400, fat:0.0,  satFat:0.0,  carbs:100.0,sugars:100.0,protein:0.0, salt:0.0  } },
  { id:7,  name:"Destrosio",                 unit:"g", cost:0.00140, category:"Zuccheri",     allergens:[],
    nutritionPer100g:{ kcal:364, fat:0.0,  satFat:0.0,  carbs:91.0, sugars:91.0, protein:0.0, salt:0.0  } },
  { id:8,  name:"Zucchero invertito",        unit:"g", cost:0.00220, category:"Zuccheri",     allergens:[],
    nutritionPer100g:{ kcal:303, fat:0.0,  satFat:0.0,  carbs:75.6, sugars:75.6, protein:0.0, salt:0.0  } },
  { id:11, name:"Neutro per gelato",         unit:"g", cost:0.00850, category:"Stabilizzanti",allergens:[],
    nutritionPer100g:{ kcal:350, fat:0.0,  satFat:0.0,  carbs:85.0, sugars:5.0,  protein:1.0, salt:0.50 } },
  { id:14, name:"Pasta nocciola 100%",       unit:"g", cost:0.01100, category:"Paste e aromi",allergens:["frutta a guscio","nocciole"],
    nutritionPer100g:{ kcal:648, fat:60.0, satFat:4.5,  carbs:14.0, sugars:4.0,  protein:14.0,salt:0.0  } },
  { id:15, name:"Pasta pistacchio 100%",     unit:"g", cost:0.02600, category:"Paste e aromi",allergens:["frutta a guscio","pistacchio"],
    nutritionPer100g:{ kcal:594, fat:44.0, satFat:5.5,  carbs:26.0, sugars:7.0,  protein:21.0,salt:0.0  } },
  { id:17, name:"Pasta caffè",               unit:"g", cost:0.01800, category:"Paste e aromi",allergens:[],
    nutritionPer100g:{ kcal:290, fat:3.0,  satFat:0.8,  carbs:55.0, sugars:42.0, protein:5.0, salt:0.10 } },
  { id:18, name:"Estratto vaniglia",         unit:"g", cost:0.12000, category:"Paste e aromi",allergens:[],
    nutritionPer100g:{ kcal:288, fat:0.1,  satFat:0.0,  carbs:12.7, sugars:12.7, protein:0.1, salt:0.05 } },
  { id:20, name:"Cioccolato fondente 70%",   unit:"g", cost:0.01600, category:"Cioccolato",   allergens:["soia"],
    nutritionPer100g:{ kcal:560, fat:38.0, satFat:22.0, carbs:46.0, sugars:27.0, protein:6.5, salt:0.05 } },
  { id:22, name:"Cacao amaro in polvere",    unit:"g", cost:0.01300, category:"Cioccolato",   allergens:[],
    nutritionPer100g:{ kcal:320, fat:10.5, satFat:6.5,  carbs:41.0, sugars:1.5,  protein:22.0,salt:0.05 } },
  { id:24, name:"Fragole fresche",           unit:"g", cost:0.00350, category:"Frutta",       allergens:[],
    nutritionPer100g:{ kcal:32,  fat:0.3,  satFat:0.0,  carbs:7.7,  sugars:4.9,  protein:0.7, salt:0.0  } },
  { id:25, name:"Succo di limone",           unit:"g", cost:0.00220, category:"Frutta",       allergens:[],
    nutritionPer100g:{ kcal:22,  fat:0.2,  satFat:0.0,  carbs:6.9,  sugars:2.5,  protein:0.4, salt:0.0  } },
  { id:29, name:"Granella pistacchio",       unit:"g", cost:0.02200, category:"Paste e aromi",allergens:["frutta a guscio","pistacchio"],
    nutritionPer100g:{ kcal:572, fat:44.0, satFat:5.5,  carbs:26.0, sugars:7.5,  protein:20.0,salt:0.0  } },
  { id:30, name:"Acqua",                     unit:"g", cost:0.00001, category:"Altro",        allergens:[],
    nutritionPer100g:{ kcal:0,   fat:0.0,  satFat:0.0,  carbs:0.0,  sugars:0.0,  protein:0.0, salt:0.0  } },
  { id:31, name:"Yogurt intero",             unit:"g", cost:0.00180, category:"Latticini",    allergens:["latte"],
    nutritionPer100g:{ kcal:61,  fat:3.2,  satFat:2.1,  carbs:4.7,  sugars:4.7,  protein:3.5, salt:0.10 } },
];
// Popola il lookup nutrizionale dai raw (fatto dopo la definizione per evitare
// dipendenza circolare — normalizeIngredient è già definita sopra).
DEFAULT_INGREDIENTS_RAW.forEach(r => {
  if (r.nutritionPer100g && !isNutritionAllZero(r.nutritionPer100g)) {
    DEFAULT_NUTRITION_LOOKUP[`id:${r.id}`] = { ...r.nutritionPer100g };
    if (r.name) DEFAULT_NUTRITION_LOOKUP[`name:${r.name.toLowerCase().trim()}`] = { ...r.nutritionPer100g };
  }
});

const DEFAULT_INGREDIENTS = DEFAULT_INGREDIENTS_RAW.map(normalizeIngredient);

const DEFAULT_RECIPES_RAW = [
  { id:1, name:"Fiordilatte",      category:"Creme classiche", yield_g:3000, notes:"Base classica vaniglia", ingredients:[{id:1,q:1600},{id:2,q:500},{id:3,q:100},{id:6,q:380},{id:7,q:120},{id:8,q:80},{id:11,q:18},{id:18,q:4}] },
  { id:2, name:"Cioccolato Fondente",category:"Creme classiche",yield_g:3000, notes:"Fondente 70% Domori",  ingredients:[{id:1,q:1400},{id:2,q:300},{id:3,q:80},{id:6,q:360},{id:7,q:100},{id:8,q:60},{id:20,q:350},{id:22,q:80},{id:11,q:18}] },
  { id:3, name:"Nocciola",         category:"Creme classiche", yield_g:3000, notes:"Pasta nocciola pura",   ingredients:[{id:1,q:1500},{id:2,q:300},{id:3,q:90},{id:6,q:340},{id:7,q:110},{id:8,q:70},{id:14,q:380},{id:11,q:18}] },
  { id:4, name:"Pistacchio",       category:"Creme classiche", yield_g:3000, notes:"Pasta pistacchio 100%", ingredients:[{id:1,q:1450},{id:2,q:300},{id:3,q:90},{id:6,q:330},{id:7,q:100},{id:8,q:60},{id:15,q:320},{id:29,q:50},{id:11,q:18}] },
  { id:5, name:"Crema all'Uovo",   category:"Creme classiche", yield_g:3000, notes:"Tuorli freschi",        ingredients:[{id:1,q:1500},{id:2,q:250},{id:4,q:280},{id:6,q:360},{id:7,q:80},{id:8,q:60},{id:18,q:5},{id:11,q:15}] },
  { id:6, name:"Caffè",            category:"Creme classiche", yield_g:3000, notes:"Pasta caffè arabica",   ingredients:[{id:1,q:1550},{id:2,q:300},{id:3,q:90},{id:6,q:370},{id:7,q:100},{id:8,q:70},{id:17,q:120},{id:11,q:18}] },
  { id:7, name:"Fragola",          category:"Frutta",          yield_g:2500, notes:"Fragole fresche",       ingredients:[{id:30,q:500},{id:24,q:1200},{id:6,q:380},{id:7,q:120}] },
  { id:8, name:"Limone",           category:"Sorbetti",        yield_g:2500, notes:"Sorbetto puro",         ingredients:[{id:30,q:900},{id:25,q:450},{id:6,q:420},{id:7,q:100}] },
  { id:9, name:"Yogurt Val d'Aveto",category:"Yogurt",         yield_g:2800, notes:"Yogurt intero fresco",  ingredients:[{id:31,q:1200},{id:1,q:500},{id:6,q:340},{id:7,q:100},{id:30,q:300}] },
];
const DEFAULT_RECIPES = DEFAULT_RECIPES_RAW.map(normalizeRecipe);

const DEFAULT_COSTI = normalizeCosti({});

function initCashflow() {
  const stagionalita = [0,0,0.3,0.5,0.7,1.0,1.2,1.3,0.9,0.6,0,0];
  const d = {};
  for (let m = 0; m < 12; m++) {
    const mult = stagionalita[m];
    d[m] = {
      entrate: { "Incassi gelato": Math.round(32000*mult), "Rivendita": Math.round(1500*mult), "Altro": 0 },
      uscite:  { "Materie prime": Math.round(32000*mult*0.14), "Personale": mult>0?9450:0, "Affitto": 2000, "Energia": Math.round(1600*(mult>0?1:0.3)), "Packaging": Math.round(32000*mult*0.015), "Commercialista": 750, "Manutenzione": 0, "Altro": 0 }
    };
  }
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 10 — UTILS
// ═══════════════════════════════════════════════════════════════════════════════
function fmt(n, d=2) { const v=Number(n); return (isFinite(v)?v:0).toFixed(d).replace(".",","); }
function fmtE(n) { return "€ "+fmt(n); }

function calcCostMP(recipe, ingredients) {
  let missingIds = [];
  const total = (recipe?.ingredients ?? []).reduce((s, ri) => {
    const ing = ingredients.find(i => i.id === ri.id);
    if (!ing) { missingIds.push(ri.id); return s; } // FIX: traccia mancanti
    return s + (ing.cost * ri.q);
  }, 0);
  // Espone gli ID mancanti per uso nei warning UI
  calcCostMP._lastMissingIds = missingIds;
  return total;
}
// Ritorna { cost, missingIngredientIds } — usare questa nei nuovi consumer
function calcCostMPDetailed(recipe, ingredients) {
  const missingIngredientIds = [];
  const cost = (recipe?.ingredients ?? []).reduce((s, ri) => {
    const ing = ingredients.find(i => i.id === ri.id);
    if (!ing) { missingIngredientIds.push(ri.id); return s; }
    return s + (ing.cost * ri.q);
  }, 0);
  return { cost, missingIngredientIds, isComplete: missingIngredientIds.length === 0 };
}
// Alias centralizzato — usare questa in dashboard, simulatore, impatto rincari
const getRecipeCostMP = calcCostMP;
function costoIndiretto(costiF, grammi) {
  // GUARDIA: porzioni_mensili = 0 non divide per zero; valori negativi clampati
  const manodopera = Math.max(0, Number(costiF?.manodopera) || 0);
  const energia    = Math.max(0, Number(costiF?.energia)    || 0);
  const altro      = Math.max(0, Number(costiF?.altro)      || 0);
  const porzioni   = Math.max(1, Number(costiF?.porzioni_mensili) || 1);
  const packaging  = Math.max(0, Number(costiF?.packaging)  || 0);
  const g          = Math.max(0, Number(grammi) || 0);
  return ((manodopera + energia + altro) / porzioni) * (g / 150) + packaging;
}
function fcColor(pct) {
  if (pct < 25) return { color:"#4ade80", bg:"rgba(74,222,128,0.08)", label:"Ottimo" };
  if (pct < 33) return { color:"#fbbf24", bg:"rgba(251,191,36,0.08)",  label:"Attenzione" };
  return           { color:"#f87171", bg:"rgba(248,113,113,0.08)",  label:"Critico" };
}
function totIncasso(g) { return VOCI_INCASSO.reduce((s, v) => s + Number(g?.[v.key] || 0), 0); }

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 11 — TOOLTIP GRAFICO
// ═══════════════════════════════════════════════════════════════════════════════
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const tot = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:6, padding:"10px 14px", fontFamily:"Georgia,serif" }}>
      <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginBottom:6 }}>{label}</div>
      {payload.map(p => <div key={p.dataKey} style={{ fontSize:11, color:p.fill||p.color, marginBottom:2 }}>{p.name}: {fmtE(p.value)}</div>)}
      {payload.length > 1 && <div style={{ borderTop:"1px solid var(--k2-border)", marginTop:4, paddingTop:4, fontSize:12, fontWeight:"bold", color:"#c8a96e" }}>Tot: {fmtE(tot)}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 11b — SISTEMA TEMA (dark / light / auto)
// ═══════════════════════════════════════════════════════════════════════════════

const K2_THEME_CSS = `
  /* ── TEMA SCURO (default) ── */
  [data-k2-theme="dark"], [data-k2-theme="dark"] * { color-scheme: dark; }
  [data-k2-theme="dark"] {
    --k2-bg:               #0f0e0b;
    --k2-bg-deep:          #0d0c0a;
    --k2-bg-card:          #141310;
    --k2-bg-input:         #1a1916;
    --k2-bg-green-tint:    #0d1a0d;
    --k2-bg-green-card:    #1a2e1a;
    --k2-border:           #2a2820;
    --k2-text:             #e8e0d0;
    --k2-text-secondary:   #d4c9b5;
    --k2-text-muted:       #8a7d6a;
    --k2-text-dim:         #6b6455;
    --k2-text-faint:       #4a4438;
    --k2-sidebar-bg:       #0d0c0a;
    --k2-topbar-bg:        #0f0e0b;
    --k2-scrollbar-thumb:  #2a2820;
    --k2-scrollbar-track:  #141310;
    --k2-shadow:           rgba(0,0,0,0.4);
  }

  /* ── TEMA CHIARO ── */
  [data-k2-theme="light"], [data-k2-theme="light"] * { color-scheme: light; }
  [data-k2-theme="light"] {
    --k2-bg:               #f5f2ed;
    --k2-bg-deep:          #ede9e2;
    --k2-bg-card:          #ffffff;
    --k2-bg-input:         #f9f7f4;
    --k2-bg-green-tint:    #f0faf0;
    --k2-bg-green-card:    #e8f5e9;
    --k2-border:           #ddd8d0;
    --k2-text:             #1a1714;
    --k2-text-secondary:   #2d2820;
    --k2-text-muted:       #5a5248;
    --k2-text-dim:         #7a7060;
    --k2-text-faint:       #a09080;
    --k2-sidebar-bg:       #ede9e2;
    --k2-topbar-bg:        #f5f2ed;
    --k2-scrollbar-thumb:  #c8b89a;
    --k2-scrollbar-track:  #e8e2d8;
    --k2-shadow:           rgba(0,0,0,0.08);
  }

  /* ── SCROLLBAR ── */
  [data-k2-theme] ::-webkit-scrollbar { width:6px; height:6px; }
  [data-k2-theme] ::-webkit-scrollbar-track { background:var(--k2-scrollbar-track); }
  [data-k2-theme] ::-webkit-scrollbar-thumb { background:var(--k2-scrollbar-thumb); border-radius:3px; }

  /* ── TRANSIZIONE TEMA FLUIDA ── */
  [data-k2-theme] {
    transition: background-color 0.25s ease, color 0.25s ease, border-color 0.2s ease;
  }
`;

// Determina il tema effettivo in base alla modalità e alla preferenza di sistema
function resolveTheme(mode) {
  if (mode === "dark")  return "dark";
  if (mode === "light") return "light";
  // auto: legge la preferenza di sistema
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark"; // fallback
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 12 — SHARED STYLES
// ═══════════════════════════════════════════════════════════════════════════════
const card    = { background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:8, padding:"14px 16px", marginBottom:10 };
const inp     = { background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"7px 11px", color:"var(--k2-text)", fontSize:13, fontFamily:"inherit", outline:"none", width:"100%", boxSizing:"border-box" };
const lbl     = { fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:4 };
const btnP    = { background:"#c8a96e", color:"var(--k2-bg)", border:"none", borderRadius:5, padding:"7px 14px", fontSize:12, fontFamily:"inherit", cursor:"pointer", fontWeight:"bold", display:"inline-flex", alignItems:"center", gap:5 };
const btnS    = { background:"transparent", color:"var(--k2-text-muted)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"6px 10px", fontSize:11, fontFamily:"inherit", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 };
const btnD    = { background:"transparent", color:"#f87171", border:"1px solid #3a2020", borderRadius:5, padding:"6px 10px", fontSize:11, fontFamily:"inherit", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 };
const btnWarn = { background:"rgba(251,191,36,0.1)", color:"#fbbf24", border:"1px solid #fbbf2444", borderRadius:5, padding:"6px 10px", fontSize:11, fontFamily:"inherit", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 };
function sliderBg(val, min, max) {
  // GUARDIA: max === min evita divisione per zero
  const range = max - min;
  const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((Number(val)||0) - min) / range * 100));
  return { width:"100%", appearance:"none", WebkitAppearance:"none", height:5, borderRadius:3, background:`linear-gradient(to right,#c8a96e ${pct}%,var(--k2-border) 0%)`, outline:"none", cursor:"pointer" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 12b — PRINT INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

// CSS iniettato nel <style> globale dell'app — regole @media print robuste
const PRINT_CSS = `
@media print {
  /* Azzera sfondo dark e colori non stampabili */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  /* Nascondi tutta la shell UI */
  .k2-sidebar,
  .k2-topbar,
  .k2-no-print,
  button,
  select,
  input,
  nav,
  [role="navigation"] { display: none !important; }

  /* Il main diventa full-width */
  .k2-main { width: 100% !important; padding: 0 !important; }
  .k2-content { padding: 0 !important; overflow: visible !important; }

  /* Wrapper documento stampabile */
  .k2-print-doc {
    display: block !important;
    width: 100%;
    margin: 0;
    padding: 0;
  }

  /* Pagina A4 */
  @page {
    size: A4 portrait;
    margin: 18mm 14mm 16mm 14mm;
  }

  body {
    background: white !important;
    color: #1a1508 !important;
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 11pt !important;
  }

  /* Ogni documento stampabile parte su nuova pagina */
  .k2-print-page-break { page-break-before: always; }
  .k2-print-avoid-break { page-break-inside: avoid; }

  /* Tabelle */
  table { width: 100% !important; border-collapse: collapse !important; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  /* Sezioni interne */
  .k2-print-section {
    border: 1px solid #ccc !important;
    border-radius: 4px !important;
    padding: 10px 12px !important;
    margin-bottom: 12px !important;
    page-break-inside: avoid;
  }

  /* Badge allergeni — pill dorato ben leggibile in stampa */
  .k2-allergen-badge {
    background: #fff8d6 !important;
    border: 1.5px solid #c8a800 !important;
    color: #4a3000 !important;
    padding: 1px 7px !important;
    border-radius: 3px !important;
    font-size: 8pt !important;
    font-weight: bold !important;
    margin-right: 3px !important;
    display: inline-block !important;
  }

  /* Blocco allergeni in stampa */
  .k2-print-allergen-block {
    background: #fffaed !important;
    border: 1.5px solid #c8a800 !important;
    border-left: 5px solid #c8a800 !important;
    border-radius: 3px !important;
    padding: 8px 12px !important;
    page-break-inside: avoid;
  }

  /* Tabella nutrizionale */
  .k2-print-nutr-table td {
    padding: 3px 4px !important;
    border-bottom: 1px solid #e8e0c8 !important;
    font-size: 9.5pt !important;
  }

  /* Blocco lotto/date */
  .k2-print-lot-block {
    border-top: 1.5px solid #c8b882 !important;
    padding-top: 8px !important;
    margin-top: 6px !important;
    font-size: 9pt !important;
  }

  /* Sezione interna generica */
  .k2-print-section {
    border: 1px solid #c8b882 !important;
    border-radius: 3px !important;
    padding: 10px 14px !important;
    margin-bottom: 14px !important;
    page-break-inside: avoid;
  }
}
`;

// Wrapper per contenuto stampabile.
// Quando printMode=true questo wrapper diventa visibile e il resto è nascosto.
function PrintDoc({ children, className = "" }) {
  return (
    <div className={`k2-print-doc ${className}`}>
      {children}
    </div>
  );
}

// Header standard per ogni documento stampato — layout professionale
function PrintDocHeader({ title, subtitle, sede, lotto, dataP, extra }) {
  return (
    <div className="k2-print-avoid-break" style={{ marginBottom:20 }}>
      {/* Banda superiore dorata */}
      <div style={{ background:"#b8860b", height:4, borderRadius:"2px 2px 0 0", marginBottom:0 }}/>
      <div style={{
        display:"flex", justifyContent:"space-between", alignItems:"flex-start",
        padding:"14px 0 14px 0", borderBottom:"2px solid #b8860b",
      }}>
        {/* Sinistra: brand + titolo */}
        <div>
          <div style={{ fontSize:8, color:"#b8860b", letterSpacing:"0.22em", textTransform:"uppercase", fontFamily:"Arial,sans-serif", marginBottom:2 }}>
            GELATERIA K2 · Produzione Artigianale
          </div>
          <div style={{ fontSize:9, color:"#9a8e7e", letterSpacing:"0.16em", textTransform:"uppercase", fontFamily:"Arial,sans-serif", marginBottom:6 }}>
            {subtitle}
          </div>
          <div style={{ fontSize:26, fontWeight:"bold", fontFamily:"Arial,sans-serif", color:"#1a1508", lineHeight:1.1 }}>
            {title}
          </div>
          {sede && (
            <div style={{ fontSize:11, color:"var(--k2-text-dim)", fontFamily:"Arial,sans-serif", marginTop:4 }}>
              Sede: <strong style={{ color:"#1a1508" }}>{sede}</strong>
            </div>
          )}
        </div>
        {/* Destra: metadati */}
        <div style={{ textAlign:"right", fontSize:11, color:"var(--k2-text-dim)", fontFamily:"Arial,sans-serif", minWidth:160 }}>
          {lotto && (
            <div style={{ marginBottom:3 }}>
              <span style={{ fontSize:9, textTransform:"uppercase", letterSpacing:"0.1em" }}>Lotto</span><br/>
              <strong style={{ color:"#1a1508", fontFamily:"monospace", fontSize:13 }}>{lotto}</strong>
            </div>
          )}
          {dataP && (
            <div style={{ marginBottom:3 }}>
              <span style={{ fontSize:9, textTransform:"uppercase", letterSpacing:"0.1em" }}>Data produzione</span><br/>
              <strong style={{ color:"#1a1508" }}>{formatDateIT(dataP)}</strong>
            </div>
          )}
          {extra}
        </div>
      </div>
    </div>
  );
}

// Footer standard per ogni documento stampato
function PrintDocFooter({ sede }) {
  return (
    <div className="k2-print-avoid-break" style={{ marginTop:20 }}>
      <div style={{ borderTop:"2px solid #b8860b", paddingTop:8, display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:8.5, color:"#9a8e7e", fontFamily:"Arial,sans-serif" }}>
        <div>
          <div style={{ fontWeight:"bold", color:"#6b5a2a", fontSize:9 }}>GELATERIA K2 · Produzione Artigianale</div>
          {sede && <div>Sede: {sede}</div>}
        </div>
        <div style={{ textAlign:"center", color:"#b8b0a0" }}>
          Documento generato il {formatDateIT(today())}
        </div>
        <div style={{ textAlign:"right" }}>
          <div>Responsabile di produzione</div>
          <div style={{ marginTop:14, borderTop:"1px solid #c8b882", paddingTop:2, width:140, marginLeft:"auto" }}>Firma e data</div>
        </div>
      </div>
    </div>
  );
}

// Pulsante stampa riutilizzabile — si nasconde in stampa
function PrintButton({ label = "🖨️ Stampa", onClick, style: extraStyle }) {
  function handlePrint() {
    if (onClick) onClick();
    window.print();
  }
  return (
    <button
      onClick={handlePrint}
      className="k2-no-print"
      style={{ ...btnP, ...extraStyle }}
    >
      {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 13 — MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function Modal({ title, children, onClose, maxWidth=520 }) {
  React.useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#161511", border:"1px solid var(--k2-border)", borderRadius:8, width:"100%", maxWidth, maxHeight:"88vh", overflowY:"auto", padding:22 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
          <h3 style={{ margin:0, fontSize:15, color:"#c8a96e", fontWeight:"normal" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--k2-text-dim)", cursor:"pointer", fontSize:18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Badge allergene — usa className k2-allergen-badge per le regole @media print
function AllergenBadge({ allergen }) {
  const label = (ALLERGENI_LABELS[allergen] || allergen)
    .replace(/^[\p{Emoji}\s]+/u, "").trim();
  return (
    <span
      className="k2-allergen-badge"
      style={{
        background:"rgba(251,191,36,0.12)",
        border:"1px solid #fbbf2433",
        borderRadius:12,
        padding:"2px 8px",
        fontSize:10,
        color:"#fbbf24",
        marginRight:4,
        marginBottom:4,
        display:"inline-block",
        fontWeight:"normal",
      }}
    >
      ⚠ {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 14 — MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
// ─── ErrorBoundary — crash isolation per moduli ────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(error) { return { hasError:true, error }; }
  componentDidCatch(error, info) { /* ErrorBoundary: errore silente in produzione */ }
  render() {
    if (!this.state.hasError) return this.props.children;
    const name = this.props.name || "Modulo";
    return (
      <div style={{ margin:"24px auto", maxWidth:520, background:"rgba(248,113,113,0.08)", border:"1px solid #f8717144", borderRadius:10, padding:"28px 24px", fontFamily:"Georgia,serif", color:"var(--k2-text)" }}>
        <div style={{ fontSize:26, marginBottom:10 }}>⚠️</div>
        <div style={{ fontSize:15, fontWeight:"bold", color:"#f87171", marginBottom:8 }}>Errore nel modulo "{name}"</div>
        <div style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:14, lineHeight:1.6 }}>
          Gli altri moduli continuano a funzionare. I dati non sono stati persi.
        </div>
        <details style={{ fontSize:10, color:"var(--k2-text-faint)", marginBottom:14 }}>
          <summary style={{ cursor:"pointer", marginBottom:4 }}>Dettagli tecnici</summary>
          <pre style={{ background:"rgba(0,0,0,0.2)", padding:"8px 10px", borderRadius:5, overflowX:"auto", whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
            {this.state.error?.toString()}
          </pre>
        </details>
        <button onClick={() => this.setState({ hasError:false, error:null })} style={{ background:"#c8a96e", color:"var(--k2-bg)", border:"none", borderRadius:5, padding:"7px 16px", fontSize:12, fontFamily:"inherit", cursor:"pointer", fontWeight:"bold" }}>
          🔄 Riprova
        </button>
      </div>
    );
  }
}

export default function App() {
  const [section, setSection]     = useState("incassi");
  const [sede, setSede]           = useState("Sestri Levante");
  const [reparto, setReparto]     = useState(REPARTO_DEFAULT);
  const [sideOpen, setSideOpen]   = useState(true);
  const [loaded, setLoaded]       = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("k2-theme") || "dark"; } catch { return "dark"; }
  });
  const saveTimer = useRef(null);

  // ── TEMA: risolve il tema effettivo (dark/light/auto→sistema) ───────────────
  const activeTheme = resolveTheme(themeMode);

  useEffect(() => {
    try { localStorage.setItem("k2-theme", themeMode); } catch {}
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "auto") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => setThemeMode("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  const [ingredients, setIngredients] = useState(DEFAULT_INGREDIENTS);
  const [recipes,     setRecipes]     = useState(DEFAULT_RECIPES);
  const [costiF,      setCostiF]      = useState(DEFAULT_COSTI);
  const [incassi,     setIncassi]     = useState({ "Sestri Levante":{}, "Chiavari":{} });
  const [cashflow,    setCashflow]    = useState({ "Sestri Levante":initCashflow(), "Chiavari":initCashflow() });
  const [listino,     setListino]     = useState(() => {
    const lst = {};
    SEDI.forEach(s => { lst[s] = DEFAULT_RECIPES.map(r => ({ id:r.id, nome:r.name, disponibile:true })); });
    return lst;
  });
  const [priceList,   setPriceList]   = useState(DEFAULT_PRICE_LIST.map(p => ({ ...p })));
  // ── Movimenti magazzino persistenti ──────────────────────────────────────────
  // Ogni movimento: { id, ingredientId, ingredientName, sede, tipo, causale,
  //   quantita_g, before_g, after_g, unit, dataMovimento, note, createdAt }
  const [movimenti,   setMovimenti]   = useState([]);
  const [productionLog, setProductionLog] = useState(DEFAULT_PRODUCTION_LOG);
  const [suppliers,   setSuppliers]   = useState(DEFAULT_SUPPLIERS);
  const [supplierDocs,setSupplierDocs]= useState(DEFAULT_SUPPLIER_DOCS);
  const [goodsReceipts, setGoodsReceipts] = useState(DEFAULT_GOODS_RECEIPTS);
  const [haccpTemps, setHaccpTemps] = useState(DEFAULT_HACCP_TEMPS);
  const [haccpSanifications, setHaccpSanifications] = useState(DEFAULT_HACCP_SANIFICATIONS);
  const [haccpNonConformities, setHaccpNonConformities] = useState(DEFAULT_HACCP_NC);
  const [haccpTraceability, setHaccpTraceability] = useState(DEFAULT_HACCP_TRACEABILITY);
  const [haccpTasks, setHaccpTasks] = useState(DEFAULT_HACCP_TASKS);
  const [checklistLogs, setChecklistLogs] = useState(DEFAULT_CHECKLIST_LOGS);
  const [turniStaff, setTurniStaff] = useState(DEFAULT_TURNI_STAFF);
  const [staffList, setStaffList] = useState(DEFAULT_STAFF_LIST);
  const [inventoryAudits, setInventoryAudits] = useState(DEFAULT_INVENTORY_AUDITS);
  const [purchaseOrders, setPurchaseOrders] = useState(DEFAULT_PURCHASE_ORDERS);
  const [authUsers, setAuthUsers] = useState(DEFAULT_AUTH_USERS.map(normalizeAuthUser));
  const [currentUserId, setCurrentUserId] = useState("admin");
  const [userPinUnlocked, setUserPinUnlocked] = useState({ admin:true });

  // ── LOAD ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [
          ing, rec, costi, inc, cf, lst, pl, mov, plog, savedReparto,
          sup, sdocs, gr, ht, hs, nc, tr, tsk, cklogs, turni, staff, invAud, po, authU, curUid
        ] = await Promise.all([
          load("k2-ingredients", null),
          load("k2-recipes",     null),
          load("k2-costi",       null),
          load("k2-incassi2",    null),
          load("k2-cashflow2",   null),
          load("k2-listino2",    null),
          load("k2-pricelist",   null),
          load("k2-movimenti",   null),
          load("k2-production-log", null),
          load("k2-reparto",     null),
          load("k2-suppliers",            null),
          load("k2-supplier-docs",        null),
          load("k2-goods-receipts",       null),
          load("k2-haccp-temps",          null),
          load("k2-haccp-sanifications",  null),
          load("k2-haccp-nc",             null),
          load("k2-haccp-traceability",   null),
          load("k2-haccp-tasks",          null),
          load("k2-checklist-logs",      null),
          load("k2-turni-staff",         null),
          load("k2-staff-list",          null),
          load("k2-inventory-audits",    null),
          load("k2-purchase-orders",     null),
          load("k2-auth-users",          null),
          load("k2-current-user-id",     null),
        ]);
        const loadedRecipes = (rec ?? DEFAULT_RECIPES).map(normalizeRecipe);
        const loadedIng     = (ing ?? DEFAULT_INGREDIENTS).map(normalizeIngredient);
        const loadedCosti   = normalizeCosti(costi ?? {});
        const loadedInc     = inc ?? { "Sestri Levante":{}, "Chiavari":{} };
        const loadedCF      = cf  ?? { "Sestri Levante":initCashflow(), "Chiavari":initCashflow() };
        const loadedLst     = syncListinoWithRecipes(
          lst ? normalizeListino(lst, loadedRecipes) : (() => { const r={}; SEDI.forEach(s=>{r[s]=loadedRecipes.map(x=>({id:x.id,nome:x.name,disponibile:true}));}); return r; })(),
          loadedRecipes
        );
        const loadedPL = normalizePriceList(pl ?? []);
        const loadedMov = Array.isArray(mov) ? mov : [];
        const loadedProductionLog = Array.isArray(plog) ? plog.map(normalizeProductionLogEntry) : DEFAULT_PRODUCTION_LOG;
        const loadedSup = mergePreloadedSuppliers(Array.isArray(sup) ? sup.map(normalizeSupplier) : DEFAULT_SUPPLIERS);
        const loadedSupplierDocs = Array.isArray(sdocs) ? sdocs.map(normalizeSupplierDoc) : DEFAULT_SUPPLIER_DOCS;
        const loadedGoodsReceipts = Array.isArray(gr) ? gr.map(normalizeGoodsReceipt) : DEFAULT_GOODS_RECEIPTS;
        const loadedHaccpTemps = Array.isArray(ht) ? ht.map(normalizeHaccpTemp) : DEFAULT_HACCP_TEMPS;
        const loadedHaccpSanifications = Array.isArray(hs) ? hs.map(normalizeSanification) : DEFAULT_HACCP_SANIFICATIONS;
        const loadedHaccpNc = Array.isArray(nc) ? nc.map(normalizeNonConformity) : DEFAULT_HACCP_NC;
        const loadedHaccpTrace = Array.isArray(tr) ? tr.map(normalizeTraceability) : DEFAULT_HACCP_TRACEABILITY;
        const loadedHaccpTasks = Array.isArray(tsk) ? tsk.map(normalizeHaccpTask) : DEFAULT_HACCP_TASKS;

        setIngredients(loadedIng);
        setRecipes(loadedRecipes);
        setCostiF(loadedCosti);
        setIncassi(loadedInc);
        setCashflow(loadedCF);
        setListino(loadedLst);
        setPriceList(loadedPL);
        setMovimenti(loadedMov);
        setProductionLog(loadedProductionLog);
        setSuppliers(loadedSup);
        setSupplierDocs(loadedSupplierDocs);
        setGoodsReceipts(loadedGoodsReceipts);
        setHaccpTemps(loadedHaccpTemps);
        setHaccpSanifications(loadedHaccpSanifications);
        setHaccpNonConformities(loadedHaccpNc);
        setHaccpTraceability(loadedHaccpTrace);
        setHaccpTasks(loadedHaccpTasks);
        setChecklistLogs(Array.isArray(cklogs) ? cklogs.map(normalizeChecklistLog) : DEFAULT_CHECKLIST_LOGS);
        setTurniStaff(Array.isArray(turni) ? turni.map(normalizeWeekPlan) : DEFAULT_TURNI_STAFF);
        setStaffList(Array.isArray(staff) ? staff.map(normalizeStaffMember) : DEFAULT_STAFF_LIST);
        setInventoryAudits(Array.isArray(invAud) ? invAud.map(normalizeInventoryAudit) : DEFAULT_INVENTORY_AUDITS);
        setPurchaseOrders(Array.isArray(po) ? po.map(normalizePurchaseOrder) : DEFAULT_PURCHASE_ORDERS);
        setAuthUsers(Array.isArray(authU) && authU.length > 0 ? authU.map(normalizeAuthUser) : DEFAULT_AUTH_USERS.map(normalizeAuthUser));
        setCurrentUserId(typeof curUid === "string" && curUid ? curUid : "admin");
        // Ripristina reparto salvato (FASE 1)
        if (savedReparto && REPARTI.some(r => r.id === savedReparto)) {
          setReparto(savedReparto);
        }
      } catch (err) {
        // console.error("[K2] load error:", err);
        setSaveStatus("error");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ── AUTOSAVE ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      const results = await Promise.all([
        save("k2-ingredients", ingredients),
        save("k2-recipes",     recipes),
        save("k2-costi",       costiF),
        save("k2-incassi2",    incassi),
        save("k2-cashflow2",   cashflow),
        save("k2-listino2",    listino),
        save("k2-pricelist",   priceList),
        save("k2-movimenti",   movimenti),
        save("k2-production-log", productionLog),
        save("k2-reparto",     reparto),
        save("k2-suppliers",           suppliers),
        save("k2-supplier-docs",       supplierDocs),
        save("k2-goods-receipts",      goodsReceipts),
        save("k2-haccp-temps",         haccpTemps),
        save("k2-haccp-sanifications", haccpSanifications),
        save("k2-haccp-nc",            haccpNonConformities),
        save("k2-haccp-traceability",  haccpTraceability),
        save("k2-haccp-tasks",         haccpTasks),
        save("k2-checklist-logs",     checklistLogs),
        save("k2-turni-staff",        turniStaff),
        save("k2-staff-list",         staffList),
        save("k2-inventory-audits",   inventoryAudits),
        save("k2-purchase-orders",    purchaseOrders),
        save("k2-auth-users",         authUsers),
        save("k2-current-user-id",    currentUserId),
      ]);
      if (results.every(Boolean)) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 4000);
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [
    ingredients, recipes, costiF, incassi, cashflow, listino, priceList, movimenti, productionLog, reparto,
    suppliers, supplierDocs, goodsReceipts, haccpTemps, haccpSanifications,
    haccpNonConformities, haccpTraceability, haccpTasks, checklistLogs, turniStaff, staffList,
    inventoryAudits, purchaseOrders, authUsers, currentUserId, loaded
  ]);

  // ── SYNC LISTINO quando cambiano le ricette ───────────────────────────────
  const updateRecipesAndSync = useCallback((updater) => {
    setRecipes(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      setListino(lst => syncListinoWithRecipes(lst, next));
      return next;
    });
  }, []);

  // ── RESET FUNCTIONS ────────────────────────────────────────────────────────
  const handleResetMovimenti = useCallback(() => {
    setMovimenti([]);
  }, []);

  const handleResetIncassi = useCallback(() => {
    setIncassi({ "Sestri Levante":{}, "Chiavari":{} });
    setCashflow({ "Sestri Levante":initCashflow(), "Chiavari":initCashflow() });
  }, []);

  const handleFullReset = useCallback(() => {
    setIngredients(DEFAULT_INGREDIENTS);
    updateRecipesAndSync(DEFAULT_RECIPES);
    setCostiF(DEFAULT_COSTI);
    setIncassi({ "Sestri Levante":{}, "Chiavari":{} });
    setCashflow({ "Sestri Levante":initCashflow(), "Chiavari":initCashflow() });
    setPriceList(DEFAULT_PRICE_LIST.map(p => ({ ...p })));
    setListino(() => { const r={}; SEDI.forEach(s=>{r[s]=DEFAULT_RECIPES.map(x=>({id:x.id,nome:x.name,disponibile:true}));}); return r; });
    setMovimenti([]);
    setProductionLog(DEFAULT_PRODUCTION_LOG);
    setSuppliers(DEFAULT_SUPPLIERS);
    setSupplierDocs(DEFAULT_SUPPLIER_DOCS);
    setGoodsReceipts(DEFAULT_GOODS_RECEIPTS);
    setHaccpTemps(DEFAULT_HACCP_TEMPS);
    setHaccpSanifications(DEFAULT_HACCP_SANIFICATIONS);
    setHaccpNonConformities(DEFAULT_HACCP_NC);
    setHaccpTraceability(DEFAULT_HACCP_TRACEABILITY);
    setHaccpTasks(DEFAULT_HACCP_TASKS);
    setChecklistLogs(DEFAULT_CHECKLIST_LOGS);
    setTurniStaff(DEFAULT_TURNI_STAFF);
    setStaffList(DEFAULT_STAFF_LIST);
    setInventoryAudits(DEFAULT_INVENTORY_AUDITS);
    setPurchaseOrders(DEFAULT_PURCHASE_ORDERS);
    setAuthUsers(DEFAULT_AUTH_USERS.map(normalizeAuthUser));
    setCurrentUserId("admin");
    setUserPinUnlocked({ admin:true });
    setReparto(REPARTO_DEFAULT);
    setSection("dashboard");
  }, [updateRecipesAndSync]);

  const totOggiSL = totIncasso(incassi["Sestri Levante"]?.[today()] || {});
  const totOggiCH = totIncasso(incassi["Chiavari"]?.[today()] || {});
  const saveLabel = {
    idle:    null,
    saving:  { t:"💾 Salvataggio…", c:"var(--k2-text-dim)", bg:"transparent" },
    saved:   { t:"✓ Salvato",       c:"#4ade80", bg:"rgba(74,222,128,0.08)" },
    error:   { t:"⚠ Errore salvataggio", c:"#f87171", bg:"rgba(248,113,113,0.10)" },
  }[saveStatus];

  const sideW = sideOpen ? 200 : 56;

  // ── Badge sottoscorta — conta ingredienti sotto scorta minima nella sede attiva ─
  const nSottoscorta = ingredients.filter(i => {
    if (i.active === false || i.stockEnabled === false) return false;
    const s = i.stockBySede?.[sede];
    if (!s) return false;
    return s.minStock_g > 0 && s.currentStock_g < s.minStock_g;
  }).length;
  const activeUsers = authUsers.filter(u => u.active !== false);
  const currentUser = activeUsers.find(u => u.id === currentUserId) || activeUsers[0] || DEFAULT_AUTH_USERS[0];
  const currentUserRole = currentUser?.role || "admin";
  const visibleNav = NAV.filter(n => canAccessSection(currentUserRole, n.id));

  useEffect(() => {
    if (loaded && !canAccessSection(currentUserRole, section)) setSection("dashboard");
  }, [currentUserRole, section, loaded]);

  function handleUserSwitch(nextUserId) {
    const nextUser = activeUsers.find(u => u.id === nextUserId);
    if (!nextUser) return;
    const needsPin = !!String(nextUser.pin || "").trim();
    if (needsPin && !userPinUnlocked[nextUser.id]) {
      const entered = globalThis?.prompt?.(`Inserisci PIN per ${nextUser.name}`) ?? "";
      if (String(entered) !== String(nextUser.pin || "")) {
        globalThis?.alert?.("PIN errato. Cambio utente annullato.");
        return;
      }
      setUserPinUnlocked(prev => ({ ...prev, [nextUser.id]: true }));
    }
    setCurrentUserId(nextUser.id);
  }

  if (!loaded) return (
    <div style={{ minHeight:"100vh", background:"var(--k2-bg)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--k2-text-dim)", fontFamily:"Georgia,serif", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:28, color:"#c8a96e" }}>🍦</div>
      <div>Caricamento K2 Suite…</div>
    </div>
  );

  return (
    <div data-k2-theme={activeTheme} style={{ display:"flex", minHeight:"100vh", background:"var(--k2-bg)", fontFamily:"'Georgia','Times New Roman',serif", color:"var(--k2-text)" }}>
      <style>{`
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#c8a96e;cursor:pointer;border:2px solid var(--k2-bg);box-shadow:0 2px 8px rgba(200,169,110,.4)}
        input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#c8a96e;cursor:pointer;border:2px solid var(--k2-bg)}
        input[type=number]{-moz-appearance:textfield}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
        *{box-sizing:border-box}
        ${PRINT_CSS}
        ${K2_THEME_CSS}
      `}</style>

      {/* SIDEBAR */}
      <div className="k2-sidebar" style={{ width:sideW, minHeight:"100vh", background:"var(--k2-bg-deep)", borderRight:"1px solid var(--k2-border)", display:"flex", flexDirection:"column", transition:"width 0.2s", flexShrink:0, overflow:"hidden" }}>
        <div style={{ padding:"16px 12px", borderBottom:"1px solid var(--k2-border)", display:"flex", alignItems:"center", gap:8, minHeight:56 }}>
          <span style={{ fontSize:22, flexShrink:0 }}>🍦</span>
          {sideOpen && <div><div style={{ fontSize:12, fontWeight:"bold", color:"#c8a96e", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>GELATERIA K2</div><div style={{ fontSize:8, color:"var(--k2-text-faint)", letterSpacing:"0.12em", textTransform:"uppercase" }}>Suite gestionale</div></div>}
        </div>
        {sideOpen && (
          <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--k2-border)" }}>
            <div style={{ fontSize:8, color:"var(--k2-text-faint)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>Sede attiva</div>
            {SEDI.map(sd => (
              <button key={sd} onClick={() => setSede(sd)} style={{ display:"block", width:"100%", padding:"6px 10px", marginBottom:4, fontSize:11, cursor:"pointer", borderRadius:5, fontFamily:"inherit", textAlign:"left", background:sede===sd?"rgba(200,169,110,0.15)":"transparent", color:sede===sd?SEDE_COLORS[sd]:"var(--k2-text-dim)", border:sede===sd?`1px solid ${SEDE_COLORS[sd]}44`:"1px solid transparent", transition:"all 0.15s" }}>
                {sede===sd?"▶ ":""}{sd}
              </button>
            ))}
          </div>
        )}
        <nav style={{ flex:1, padding:"8px 6px" }}>
          {visibleNav.map(n => {
            const isMagazzino = n.id === "magazzino";
            const showBadge   = isMagazzino && nSottoscorta > 0;
            return (
              <button key={n.id} onClick={() => setSection(n.id)} title={showBadge ? `${n.label} — ${nSottoscorta} sottoscorta` : n.label} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 8px", marginBottom:2, fontSize:12, cursor:"pointer", borderRadius:5, fontFamily:"inherit", textAlign:"left", background:section===n.id?"rgba(200,169,110,0.12)":"transparent", color:section===n.id?"#c8a96e":"var(--k2-text-dim)", border:section===n.id?"1px solid var(--k2-border)":"1px solid transparent", transition:"all 0.15s", position:"relative" }}>
                <span style={{ fontSize:15, flexShrink:0 }}>{n.icon}</span>
                {sideOpen && <span style={{ whiteSpace:"nowrap", overflow:"hidden", flex:1 }}>{n.label}</span>}
                {showBadge && (
                  <span style={{
                    background:"#f87171", color:"#fff", borderRadius:10,
                    fontSize:9, fontWeight:"bold", fontFamily:"monospace",
                    padding:"1px 5px", lineHeight:"14px", minWidth:16, textAlign:"center",
                    flexShrink:0,
                    // In sidebar chiusa: posizionato in alto a destra sull'icona
                    ...(sideOpen ? {} : {
                      position:"absolute", top:4, right:4,
                      fontSize:8, padding:"1px 3px",
                    }),
                  }}>{nSottoscorta}</span>
                )}
              </button>
            );
          })}
        </nav>
        <button onClick={() => setSideOpen(o => !o)} style={{ padding:"10px", background:"transparent", border:"none", color:"var(--k2-text-faint)", cursor:"pointer", fontSize:14, borderTop:"1px solid var(--k2-border)" }}>
          {sideOpen?"◀":"▶"}
        </button>
      </div>

      {/* MAIN */}
      <div className="k2-main" style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Topbar */}
        <div className="k2-topbar" style={{ height:50, borderBottom:"1px solid var(--k2-border)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", background:"var(--k2-bg)", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:13, color:SEDE_COLORS[sede], fontWeight:"bold" }}>{sede}</span>
            <span style={{ fontSize:9, color:"var(--k2-text-faint)", letterSpacing:"0.1em", textTransform:"uppercase" }}>· {visibleNav.find(n => n.id===section)?.label || NAV.find(n => n.id===section)?.label}</span>
            {/* Selettore reparto FASE 1 */}
            <div style={{ display:"flex", gap:3, marginLeft:8, borderLeft:"1px solid var(--k2-border)", paddingLeft:10 }}>
              {REPARTI.map(r => (
                <button key={r.id} onClick={() => setReparto(r.id)} style={{
                  padding:"3px 10px", fontSize:11, borderRadius:12, cursor:"pointer",
                  fontFamily:"inherit", border:`1px solid ${reparto===r.id ? r.color+"66" : "var(--k2-border)"}`,
                  background: reparto===r.id ? r.color+"22" : "transparent",
                  color: reparto===r.id ? r.color : "var(--k2-text-dim)",
                  fontWeight: reparto===r.id ? "bold" : "normal",
                  display:"flex", alignItems:"center", gap:4, transition:"all 0.15s",
                }}>{r.icon} {r.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ display:"flex", gap:12, fontSize:11 }}>
              <span style={{ color:"var(--k2-text-dim)" }}>SL: <span style={{ color:"#c8a96e", fontWeight:"bold" }}>{fmtE(totOggiSL)}</span></span>
              <span style={{ color:"var(--k2-text-dim)" }}>CH: <span style={{ color:"#60a5fa", fontWeight:"bold" }}>{fmtE(totOggiCH)}</span></span>
              <span style={{ color:"var(--k2-text-dim)" }}>Tot: <span style={{ color:"#4ade80", fontWeight:"bold" }}>{fmtE(totOggiSL+totOggiCH)}</span></span>
            </div>
            {saveLabel && <span style={{ fontSize:9, color:saveLabel.c, fontFamily:"monospace", background:saveLabel.bg, border:`1px solid ${saveLabel.c}33`, borderRadius:4, padding:"2px 8px", transition:"all 0.3s" }}>{saveLabel.t}</span>}
            <div style={{ display:"flex", alignItems:"center", gap:6, borderLeft:"1px solid var(--k2-border)", paddingLeft:12 }}>
              <span style={{ fontSize:10, color:"var(--k2-text-faint)", letterSpacing:"0.08em", textTransform:"uppercase" }}>Utente</span>
              <select value={currentUser?.id || ""} onChange={e => handleUserSwitch(e.target.value)} style={{ ...inp, width:"auto", minWidth:150, padding:"4px 8px", fontSize:11 }}>
                {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABELS[u.role] || u.role}</option>)}
              </select>
            </div>
            {/* THEME SWITCHER */}
            <div style={{ display:"flex", gap:2, background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:6, padding:2 }}>
              {[["dark","🌙"],["auto","⚙️"],["light","☀️"]].map(([mode, icon]) => (
                <button
                  key={mode}
                  onClick={() => setThemeMode(mode)}
                  title={mode === "dark" ? "Tema scuro" : mode === "light" ? "Tema chiaro" : "Segui sistema"}
                  style={{
                    padding:"3px 7px", fontSize:11, cursor:"pointer", borderRadius:4,
                    fontFamily:"inherit", border:"none",
                    background: themeMode === mode ? "#c8a96e" : "transparent",
                    color:      themeMode === mode ? "var(--k2-bg)" : "var(--k2-text-dim)",
                    transition:"all 0.15s",
                  }}
                >{icon}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Content — ogni modulo è avvolto da ErrorBoundary per crash isolation */}
        <div className="k2-content" style={{ flex:1, overflowY:"auto", padding:"20px" }}>
          {section==="dashboard"    && <ErrorBoundary name="Dashboard"><Dashboard incassi={incassi} cashflow={cashflow} recipes={recipes} ingredients={ingredients} costiF={costiF} sede={sede} goodsReceipts={goodsReceipts} haccpTraceability={haccpTraceability} onGoTo={setSection}/></ErrorBoundary>}
          {section==="incassi"      && <ErrorBoundary name="Incassi"><Incassi incassi={incassi} setIncassi={setIncassi} sede={sede}/></ErrorBoundary>}
          {section==="foodcost"     && <ErrorBoundary name="Food Cost"><FoodCost recipes={recipes} setRecipes={updateRecipesAndSync} ingredients={ingredients} setIngredients={setIngredients} costiF={costiF} listino={listino} reparto={reparto} sede={sede} goodsReceipts={goodsReceipts} haccpTraceability={haccpTraceability} onGoTo={setSection}/></ErrorBoundary>}
          {section==="produzione"   && <ErrorBoundary name="Produzione"><Produzione recipes={recipes} ingredients={ingredients} setIngredients={setIngredients} sede={sede} movimenti={movimenti} setMovimenti={setMovimenti} productionLog={productionLog} setProductionLog={setProductionLog} reparto={reparto} goodsReceipts={goodsReceipts} setGoodsReceipts={setGoodsReceipts} haccpTraceability={haccpTraceability} setHaccpTraceability={setHaccpTraceability} onGoTo={setSection} currentUserRole={currentUserRole} currentUserName={currentUser?.name || ""}/></ErrorBoundary>}
          {section==="magazzino"    && <ErrorBoundary name="Magazzino"><Magazzino ingredients={ingredients} setIngredients={setIngredients} recipes={recipes} sede={sede} movimenti={movimenti} setMovimenti={setMovimenti} goodsReceipts={goodsReceipts} haccpTraceability={haccpTraceability} setHaccpTraceability={setHaccpTraceability} inventoryAudits={inventoryAudits} setInventoryAudits={setInventoryAudits} currentUserRole={currentUserRole} currentUserName={currentUser?.name || ""}/></ErrorBoundary>}
          {section==="etichette"    && <ErrorBoundary name="Etichette"><Etichette recipes={recipes} setRecipes={updateRecipesAndSync} ingredients={ingredients} sede={sede} costiF={costiF} goodsReceipts={goodsReceipts} haccpTraceability={haccpTraceability} reparto={reparto} onGoTo={setSection}/></ErrorBoundary>}
          {section==="listino"      && <ErrorBoundary name="Listino"><Listino listino={listino} setListino={setListino} recipes={recipes} ingredients={ingredients} sede={sede} priceList={priceList} setPriceList={setPriceList} reparto={reparto} onGoTo={setSection}/></ErrorBoundary>}
          {section==="cashflow"     && <ErrorBoundary name="Cashflow"><Cashflow cashflow={cashflow} setCashflow={setCashflow} sede={sede}/></ErrorBoundary>}
          {section==="fornitori"    && <ErrorBoundary name="Fornitori"><Fornitori suppliers={suppliers} setSuppliers={setSuppliers} supplierDocs={supplierDocs} setSupplierDocs={setSupplierDocs} ingredients={ingredients} setIngredients={setIngredients} sede={sede} haccpTasks={haccpTasks} setHaccpTasks={setHaccpTasks} purchaseOrders={purchaseOrders} setPurchaseOrders={setPurchaseOrders} currentUser={currentUser}/></ErrorBoundary>}
          {section==="haccp"        && <ErrorBoundary name="HACCP"><Haccp sede={sede} ingredients={ingredients} setIngredients={setIngredients} suppliers={suppliers} setSuppliers={setSuppliers} supplierDocs={supplierDocs} goodsReceipts={goodsReceipts} setGoodsReceipts={setGoodsReceipts} haccpTemps={haccpTemps} setHaccpTemps={setHaccpTemps} haccpSanifications={haccpSanifications} setHaccpSanifications={setHaccpSanifications} haccpNonConformities={haccpNonConformities} setHaccpNonConformities={setHaccpNonConformities} haccpTraceability={haccpTraceability} setHaccpTraceability={setHaccpTraceability} haccpTasks={haccpTasks} setHaccpTasks={setHaccpTasks} movimenti={movimenti} setMovimenti={setMovimenti} recipes={recipes} currentUserRole={currentUserRole}/></ErrorBoundary>}
          {section==="checklist"    && <ErrorBoundary name="Checklist"><Checklist sede={sede} checklistLogs={checklistLogs} setChecklistLogs={setChecklistLogs}/></ErrorBoundary>}
          {section==="turni"        && <ErrorBoundary name="Turni"><Turni sede={sede} turniStaff={turniStaff} setTurniStaff={setTurniStaff} staffList={staffList} setStaffList={setStaffList}/></ErrorBoundary>}
          {section==="lista-spesa"  && <ErrorBoundary name="Lista Spesa"><ListaSpesa ingredients={ingredients} suppliers={suppliers} sede={sede}/></ErrorBoundary>}
          {section==="ricettario"   && <ErrorBoundary name="Ricettario"><Ricettario recipes={recipes} setRecipes={updateRecipesAndSync} ingredients={ingredients} setIngredients={setIngredients} listino={listino} setListino={setListino} costiF={costiF} reparto={reparto} onGoTo={setSection} currentUserRole={currentUserRole}/></ErrorBoundary>}
          {section==="impostazioni" && <ErrorBoundary name="Impostazioni"><Impostazioni costiF={costiF} setCostiF={setCostiF} ingredients={ingredients} setIngredients={setIngredients} recipes={recipes} goodsReceipts={goodsReceipts} haccpTraceability={haccpTraceability} suppliers={suppliers} checklistLogs={checklistLogs} turniStaff={turniStaff} staffList={staffList} inventoryAudits={inventoryAudits} purchaseOrders={purchaseOrders} authUsers={authUsers} setAuthUsers={setAuthUsers} currentUserId={currentUserId} setCurrentUserId={setCurrentUserId} currentUserRole={currentUserRole} onFullReset={handleFullReset} onResetMovimenti={handleResetMovimenti} onResetIncassi={handleResetIncassi}/></ErrorBoundary>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAGAZZINO — FASE 1 MVP — stock separato per sede
// ═══════════════════════════════════════════════════════════════════════════════

// ─── helper: formatta grammi → g / kg leggibile ──────────────────────────────
function fmtStock(g) {
  if (g === null || g === undefined) return "—";
  if (g >= 1000) return `${(g / 1000).toFixed(2).replace(".", ",")} kg`;
  return `${g} g`;
}

// ─── helper: calcola totale grammi necessari di un ingrediente per produrre
//             il piano di una giornata tipo (usa le ricette attive, 1 vaschetta cad.)
function calcFabbisognoIngrediente(ingId, recipes) {
  return recipes
    .filter(r => r.active !== false)
    .reduce((tot, r) => {
      const ri = r.ingredients.find(x => x.id === ingId);
      return tot + (ri ? ri.q : 0);
    }, 0);
}

// ─── StockBar: barra visuale fill/min ────────────────────────────────────────
function StockBar({ current, min }) {
  if (!min || min <= 0) return null;
  const pct = Math.min(100, (current / min) * 100);
  const color = pct < 25 ? "#f87171" : pct < 75 ? "#fbbf24" : "#4ade80";
  return (
    <div style={{ background:"var(--k2-bg-input)", borderRadius:3, height:5, overflow:"hidden", marginTop:4 }}>
      <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:3, transition:"width 0.3s" }}/>
    </div>
  );
}

// ─── MovimentoModal: carico / scarico / rettifica ───────────────────────────
function MovimentoModal({ ing, sede, onSave, onClose }) {
  const [tipo,  setTipo]  = useState("carico");   // carico | scarico | rettifica
  const [qPkg,  setQPkg]  = useState("");          // quantità in unitPurchase (kg/pz)
  const [nota,  setNota]  = useState("");
  const [err,   setErr]   = useState("");

  const cur = ing.stockBySede?.[sede]?.currentStock_g ?? 0;
  const unitLabel = ing.unitPurchase || "kg";
  // conversione: 1 kg = 1000g, 1 pz = packageSize g (fallback 1000)
  const gramsPerUnit = unitLabel === "kg" ? 1000 : (Number(ing.packageSize) || 1000);

  function handleSave() {
    const qty = parseFloat(qPkg);
    if (isNaN(qty) || qty <= 0) { setErr("Inserisci una quantità valida > 0."); return; }
    const deltaG = tipo === "rettifica"
      ? Math.round(qty * gramsPerUnit) - cur     // rettifica = imposta valore assoluto
      : tipo === "scarico"
        ? -(Math.round(qty * gramsPerUnit))
        : Math.round(qty * gramsPerUnit);
    const isTracked = ing.requiresLotTracking !== false;
    if (isTracked && deltaG < 0 && !nota.trim()) {
      setErr("Inserisci una nota per lo scarico/rettifica di un ingrediente tracciato.");
      return;
    }
    const newStock = Math.max(0, cur + deltaG);
    onSave(newStock, { tipo, qPkg: qty, unit: unitLabel, nota: nota.trim(), date: today() });
  }

  const tipoColor = { carico:"#4ade80", scarico:"#f87171", rettifica:"#60a5fa" };
  const tipoLabel = { carico:"Carico +", scarico:"Scarico −", rettifica:"Rettifica =" };

  return (
    <Modal title={`📦 Movimenta — ${ing.name}`} onClose={onClose} maxWidth={440}>
      <div style={{ display:"grid", gap:12 }}>
        {/* Stato attuale */}
        <div style={{ display:"flex", gap:8, justifyContent:"space-between", background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:6, padding:"10px 14px" }}>
          <div>
            <div style={{ fontSize:9, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.1em" }}>Stock attuale · {sede}</div>
            <div style={{ fontSize:20, fontWeight:"bold", color:"#c8a96e", fontFamily:"monospace" }}>{fmtStock(cur)}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:9, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.1em" }}>Min. scorta</div>
            <div style={{ fontSize:16, color:"var(--k2-text-muted)", fontFamily:"monospace" }}>{fmtStock(ing.stockBySede?.[sede]?.minStock_g ?? 0)}</div>
          </div>
        </div>

        {/* Tipo movimento */}
        <div>
          <div style={{ ...lbl, marginBottom:6 }}>Tipo operazione</div>
          <div style={{ display:"flex", gap:6 }}>
            {["carico","scarico","rettifica"].map(t => (
              <button key={t} onClick={() => setTipo(t)} style={{ flex:1, padding:"7px 0", fontSize:11, fontFamily:"inherit", borderRadius:4, border:`1px solid ${tipo===t ? tipoColor[t]+"66" : "var(--k2-border)"}`, background:tipo===t ? tipoColor[t]+"18" : "transparent", color:tipo===t ? tipoColor[t] : "var(--k2-text-dim)", cursor:"pointer", fontWeight:tipo===t?"bold":"normal" }}>
                {tipoLabel[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Quantità */}
        <div>
          <label style={lbl}>
            {tipo === "rettifica" ? `Nuovo stock totale (${unitLabel})` : `Quantità (${unitLabel})`}
          </label>
          <input
            type="number" min="0" step="0.1"
            value={qPkg}
            onChange={e => { setQPkg(e.target.value); setErr(""); }}
            style={inp}
            autoFocus
            placeholder={tipo === "rettifica" ? fmtStock(cur) : "0"}
          />
          {qPkg && !isNaN(parseFloat(qPkg)) && (
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:4 }}>
              ≈ {fmtStock(Math.round(parseFloat(qPkg) * gramsPerUnit))}
              {tipo !== "rettifica" && (
                <span style={{ marginLeft:8, color: tipo==="carico" ? "#4ade80" : "#f87171" }}>
                  → nuovo stock: {fmtStock(Math.max(0, cur + (tipo==="scarico" ? -1 : 1) * Math.round(parseFloat(qPkg) * gramsPerUnit)))}
                </span>
              )}
            </div>
          )}
        </div>

        {ing.requiresLotTracking !== false && (
          <div style={{ fontSize:10, color:"#b45309", background:"rgba(180,83,9,0.08)", border:"1px solid rgba(180,83,9,0.18)", borderRadius:4, padding:"8px 10px" }}>
            Questo ingrediente richiede tracciabilità lotto. I carichi manuali sono bloccati in Magazzino; per caricare usa HACCP → Ricevimento merce. Gli scarichi manuali consumano i lotti FEFO e vengono registrati in tracciabilità.
          </div>
        )}

        {/* Note */}
        <div>
          <label style={lbl}>Nota {(ing.requiresLotTracking !== false && tipo !== "carico") ? "(consigliata)" : "(opzionale)"}</label>
          <input type="text" value={nota} onChange={e => setNota(e.target.value)} style={inp} placeholder="es. calo inventario, reso interno, scarto qualità…"/>
        </div>

        {err && <div style={{ fontSize:11, color:"#f87171", background:"rgba(248,113,113,0.08)", border:"1px solid #f8717133", borderRadius:4, padding:"7px 10px" }}>⚠ {err}</div>}

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={{ ...btnP, background: tipoColor[tipo], color:"var(--k2-bg)" }}>
            {tipoLabel[tipo]} Conferma
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── MinStockModal: imposta scorta minima per sede ───────────────────────────
function MinStockModal({ ing, sede, onSave, onClose }) {
  const cur   = ing.stockBySede?.[sede]?.minStock_g ?? 0;
  const [val, setVal] = useState(String(cur > 0 ? (cur / 1000).toFixed(2) : ""));

  function handleSave() {
    const v = parseFloat(val);
    if (isNaN(v) || v < 0) return;
    onSave(Math.round(v * 1000));
    onClose();
  }

  return (
    <Modal title={`⚙️ Scorta minima — ${ing.name}`} onClose={onClose} maxWidth={380}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ fontSize:12, color:"var(--k2-text-muted)" }}>
          Imposta la scorta minima per <strong style={{ color:"#c8a96e" }}>{sede}</strong>.<br/>
          Sotto questa soglia l'ingrediente apparirà in rosso.
        </div>
        <div>
          <label style={lbl}>Scorta minima (kg)</label>
          <input type="number" min="0" step="0.1" value={val} onChange={e => setVal(e.target.value)} style={inp} autoFocus placeholder="es. 5"/>
          {val && !isNaN(parseFloat(val)) && (
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:4 }}>≈ {fmtStock(Math.round(parseFloat(val) * 1000))}</div>
          )}
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── MAGAZZINO principale ─────────────────────────────────────────────────────
function Magazzino({ ingredients, setIngredients, recipes, sede, movimenti, setMovimenti, goodsReceipts = [], haccpTraceability = [], setHaccpTraceability = null, inventoryAudits = [], setInventoryAudits = null, currentUserRole = "admin", currentUserName = "" }) {
  const [tab,       setTab]       = useState("stock");     // stock | sottoscorta | log
  const [search,    setSearch]    = useState("");
  const [catF,      setCatF]      = useState("Tutti");
  const [movModal,  setMovModal]  = useState(null);        // ingrediente selezionato per movimento
  const [minModal,  setMinModal]  = useState(null);        // ingrediente per scorta min
  const [showAddIngredient, setShowAddIngredient] = useState(false);
  const [auditDate, setAuditDate] = useState(today());
  const [auditNote, setAuditNote] = useState("");
  const [auditCounts, setAuditCounts] = useState({});
  const [auditMsg, setAuditMsg] = useState(null);

  // ── Ingredienti filtrati (solo stockEnabled) ─────────────────────────────
  const ING_CATS = ["Tutti", ...new Set(ingredients.filter(i => i.active !== false).map(i => i.category))];
  const filtered = ingredients
    .filter(i =>
      i.active !== false &&
      i.stockEnabled !== false &&
      (catF === "Tutti" || i.category === catF) &&
      i.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Ingredienti sottoscorta nella sede attiva ────────────────────────────
  const sottoscorta = ingredients.filter(i => {
    if (i.active === false || i.stockEnabled === false) return false;
    const s = i.stockBySede?.[sede];
    if (!s) return false;
    return s.minStock_g > 0 && s.currentStock_g < s.minStock_g;
  });
  const inventoryLines = filtered.map(ing => {
    const theoretical_g = Number(ing.stockBySede?.[sede]?.currentStock_g || 0);
    const rawCount = auditCounts[String(ing.id)];
    const counted_g = rawCount === "" || rawCount === undefined ? theoretical_g : Math.max(0, Number(rawCount) || 0);
    const delta_g = Math.round(counted_g - theoretical_g);
    return { ing, theoretical_g, counted_g, delta_g };
  });
  const inventoryDiffLines = inventoryLines.filter(line => line.delta_g !== 0);
  const latestAudits = (inventoryAudits || [])
    .filter(a => a.sede === sede)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);

  // ── helper: crea un oggetto movimento normalizzato ───────────────────────────
  function buildMovimento({ ing, newStock_g, before_g, tipo, causale, quantita_g, unit, note }) {
    return {
      id:              `mov-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      ingredientId:    ing.id,
      ingredientName:  ing.name,
      sede,
      tipo,                          // carico | scarico | rettifica | produzione
      causale:         causale || tipo,
      quantita_g,
      before_g,
      after_g:         newStock_g,
      unit:            unit || ing.unitPurchase || "kg",
      dataMovimento:   today(),
      note:            note || "",
      createdAt:       new Date().toISOString(),
    };
  }

  // ── Aggiorna stock dopo un movimento manuale ─────────────────────────────
  function handleMovimento(ing, newStock_g, movimento) {
    if (!canUserPerform(currentUserRole, "manualStockAdjust")) {
      window.alert("Permesso negato: il profilo corrente non può modificare il magazzino.");
      return;
    }
    const before_g = ing.stockBySede?.[sede]?.currentStock_g ?? 0;
    const deltaStock_g = Math.round(Number(newStock_g) || 0) - before_g;
    const quantita_g = Math.abs(deltaStock_g);
    const isTracked = ing.requiresLotTracking !== false;
    const isManualLoad = deltaStock_g > 0;
    const isManualConsumption = deltaStock_g < 0;

    if (isTracked && isManualLoad) {
      window.alert(`Carico manuale bloccato per ${ing.name}.\nUsa HACCP → Ricevimento merce per registrare lotto, scadenza e documenti.`);
      return;
    }

    let traceAdjustmentRow = null;

    if (isTracked && isManualConsumption) {
      const alloc = allocateIngredientLotsFEFO({
        ingredientId: ing.id,
        ingredientName: ing.name,
        qtyNeeded_g: quantita_g,
        receipts: goodsReceipts,
        traceRows: haccpTraceability,
        mode: "STRICT",
        sede,
        fallbackLotCode: "BLOCCATO",
      });

      if (alloc.blocked || !alloc.fullyAllocated) {
        const unresolved = Math.max(0, Number(alloc.unresolved_g) || 0);
        window.alert(`Scarico manuale bloccato per ${ing.name}.\nCopertura lotti insufficiente nella sede ${sede}${unresolved > 0 ? `: mancano ${unresolved}g tracciabili.` : '.'}\nRegistra i ricevimenti corretti o rettifica la tracciabilità prima di scaricare.`);
        return;
      }

      traceAdjustmentRow = buildInventoryAdjustmentTraceRow({
        ingredient: ing,
        sede,
        date: movimento.date || today(),
        ingredientLots: alloc.ingredientLots,
        note: movimento.nota || "",
        movementType: movimento.tipo,
        adjustmentQty_g: quantita_g,
      });
    }

    setIngredients(prev => prev.map(i => {
      if (i.id !== ing.id) return i;
      return {
        ...i,
        stockLastUpdate: today(),
        stockBySede: {
          ...i.stockBySede,
          [sede]: {
            ...(i.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 }),
            currentStock_g: Math.max(0, Math.round(Number(newStock_g) || 0)),
          },
        },
      };
    }));

    const mov = buildMovimento({
      ing, newStock_g: Math.max(0, Math.round(Number(newStock_g) || 0)), before_g,
      tipo:      movimento.tipo,
      causale:   movimento.tipo === "rettifica" ? "Rettifica inventario" : movimento.tipo === "scarico" ? "Scarico manuale" : "Carico manuale",
      quantita_g,
      unit:      movimento.unit,
      note:      movimento.nota || "",
    });
    setMovimenti(prev => [mov, ...prev].slice(0, MAX_MOVIMENTI));

    if (traceAdjustmentRow && typeof setHaccpTraceability === "function") {
      setHaccpTraceability(prev => [traceAdjustmentRow, ...prev].slice(0, MAX_TRACE_ROWS));
    }

    setMovModal(null);
  }

  function saveInventoryAuditDraft(applyRectifications = false) {
    if (!canUserPerform(currentUserRole, "closeInventory")) {
      setAuditMsg({ type:"err", text:"Permesso negato: solo Laboratorio o Amministratore possono chiudere inventario." });
      return;
    }
    const lines = inventoryDiffLines.map(line => ({
      ingredientId: line.ing.id,
      ingredientName: line.ing.name,
      theoretical_g: line.theoretical_g,
      counted_g: line.counted_g,
      delta_g: line.delta_g,
    }));
    const audit = normalizeInventoryAudit({
      sede,
      date: auditDate || today(),
      note: auditNote,
      status: applyRectifications ? "closed" : "draft",
      createdBy: currentUserName,
      appliedAt: applyRectifications ? new Date().toISOString() : null,
      lines,
    });

    if (applyRectifications) {
      for (const line of lines) {
        const ing = ingredients.find(i => i.id === line.ingredientId);
        if (!ing) continue;
        const isTracked = ing.requiresLotTracking !== false;
        if (line.delta_g > 0 && isTracked) {
          setAuditMsg({
            type:"err",
            text:`Inventario bloccato: rettifica positiva non consentita per ${ing.name} perché richiede lotto. Usa Ricevimento merce o Produzione semilavorato per creare uno stock tracciabile.`
          });
          return;
        }
        if (line.delta_g < 0 && isTracked && typeof setHaccpTraceability === "function") {
          const alloc = allocateIngredientLotsFEFO({
            ingredientId: ing.id,
            ingredientName: ing.name,
            qtyNeeded_g: Math.abs(line.delta_g),
            receipts: goodsReceipts,
            traceRows: haccpTraceability,
            mode: "STRICT",
            sede,
            fallbackLotCode: "BLOCCATO",
          });
          if (alloc.blocked || !alloc.fullyAllocated) {
            setAuditMsg({ type:"err", text:`Inventario bloccato: copertura lotti insufficiente per ${ing.name}.` });
            return;
          }
        }
      }
      const newTraceRows = [];
      const newMovs = [];
      setIngredients(prev => prev.map(ing => {
        const line = lines.find(x => x.ingredientId === ing.id);
        if (!line) return ing;

        const isTracked = ing.requiresLotTracking !== false;
        if (line.delta_g < 0 && isTracked && typeof setHaccpTraceability === "function") {
          const alloc = allocateIngredientLotsFEFO({
            ingredientId: ing.id,
            ingredientName: ing.name,
            qtyNeeded_g: Math.abs(line.delta_g),
            receipts: goodsReceipts,
            traceRows: haccpTraceability,
            mode: "STRICT",
            sede,
            fallbackLotCode: "BLOCCATO",
          });
          newTraceRows.push(buildInventoryAdjustmentTraceRow({
            ingredient: ing,
            sede,
            date: audit.date,
            ingredientLots: alloc.ingredientLots,
            note: `Chiusura inventario ${audit.date}${auditNote ? ` · ${auditNote}` : ""}`,
            movementType: "rettifica",
            adjustmentQty_g: Math.abs(line.delta_g),
          }));
        }

        const before_g = Number(ing.stockBySede?.[sede]?.currentStock_g || 0);
        const after_g = Math.max(0, Number(line.counted_g || 0));
        newMovs.push(buildMovimento({
          ing,
          newStock_g: after_g,
          before_g,
          tipo: "rettifica",
          causale: "Chiusura inventario",
          quantita_g: Math.abs(line.delta_g),
          unit: "g",
          note: `${audit.note || "Rettifica inventario"}${line.delta_g > 0 && isTracked ? " · rettifica positiva da verificare lotto" : ""}`,
        }));

        return normalizeIngredient({
          ...ing,
          stockLastUpdate: audit.date,
          stockBySede: {
            ...ing.stockBySede,
            [sede]: {
              ...(ing.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 }),
              currentStock_g: after_g,
            },
          },
        });
      }));
      setMovimenti(prev => [...newMovs, ...prev].slice(0, MAX_MOVIMENTI));
      if (newTraceRows.length > 0 && typeof setHaccpTraceability === "function") {
        setHaccpTraceability(prev => [...newTraceRows, ...prev].slice(0, MAX_TRACE_ROWS));
      }
    }

    if (typeof setInventoryAudits === "function") {
      setInventoryAudits(prev => [audit, ...prev].slice(0, 250));
    }
    setAuditMsg({
      type: "ok",
      text: applyRectifications
        ? `✓ Inventario chiuso: ${lines.length} differenze registrate e rettificate.`
        : `✓ Bozza inventario salvata con ${lines.length} differenze.`
    });
    if (applyRectifications) {
      setAuditCounts({});
      setAuditNote("");
    }
  }

  // ── Aggiorna scorta minima ────────────────────────────────────────────────
  function handleMinStock(ing, newMin_g) {
    setIngredients(prev => prev.map(i => {
      if (i.id !== ing.id) return i;
      return {
        ...i,
        stockBySede: {
          ...i.stockBySede,
          [sede]: {
            ...(i.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 }),
            minStock_g: newMin_g,
          },
        },
      };
    }));
  }

  // ── Colore stock ──────────────────────────────────────────────────────────
  function stockStatus(ing) {
    const s = ing.stockBySede?.[sede];
    if (!s) return "ok";
    if (s.minStock_g > 0 && s.currentStock_g === 0) return "esaurito";
    if (s.minStock_g > 0 && s.currentStock_g < s.minStock_g) return "basso";
    return "ok";
  }
  const STATUS_COLOR = { esaurito:"#f87171", basso:"#fbbf24", ok:"#4ade80" };
  const STATUS_LABEL = { esaurito:"Esaurito", basso:"Basso", ok:"OK" };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div>
          <h2 style={{ margin:0, fontSize:17, fontWeight:"normal" }}>📦 Magazzino — {sede}</h2>
          {sottoscorta.length > 0 && (
            <div style={{ fontSize:11, color:"#f87171", marginTop:3 }}>
              ⚠ {sottoscorta.length} ingrediente{sottoscorta.length !== 1 ? "i" : ""} sotto la scorta minima
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={() => {
            if (!canUserPerform(currentUserRole, "manualStockAdjust")) { window.alert("Permesso negato: il profilo corrente non può creare materie prime."); return; }
            setShowAddIngredient(true);
          }} style={{ padding:"5px 12px", fontSize:11, border:"1px solid #4ade8044", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:"#4ade8011", color:"#4ade80" }}>➕ Materia prima</button>
          {[["stock","📦 Stock"],["sottoscorta","⚠️ Sottoscorta"],["inventario","🧾 Inventario"],["log","📋 Log"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding:"5px 12px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)", fontWeight:tab===id?"bold":"normal", position:"relative" }}>
              {label}
              {id === "sottoscorta" && sottoscorta.length > 0 && (
                <span style={{ position:"absolute", top:-6, right:-6, background:"#f87171", color:"white", borderRadius:"50%", width:16, height:16, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"bold" }}>
                  {sottoscorta.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: STOCK ── */}
      {tab === "stock" && (
        <div>
          {/* KPI sommario */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
            {[
              { label:"Ingredienti monitorati", val:filtered.length, color:"#c8a96e" },
              { label:"Sotto scorta minima",    val:sottoscorta.length, color: sottoscorta.length > 0 ? "#f87171" : "#4ade80" },
              { label:"Valore stock (MP)",
                val: "€ " + fmt(
                  ingredients
                    .filter(i => i.active !== false && i.stockEnabled !== false)
                    .reduce((s, i) => s + (i.stockBySede?.[sede]?.currentStock_g ?? 0) * i.cost, 0)
                ),
                color:"#4ade80" },
            ].map(k => (
              <div key={k.label} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:"bold", color:k.color }}>{k.val}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Filtri */}
          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Cerca ingrediente…"
              style={{ ...inp, maxWidth:220, fontSize:12 }}
            />
            <select value={catF} onChange={e => setCatF(e.target.value)} style={{ ...inp, width:"auto", fontSize:12 }}>
              {ING_CATS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div style={{ fontSize:10, color:"#b45309", marginBottom:8 }}>
            Per ingredienti con lotto obbligatorio: i carichi manuali sono bloccati qui e vanno registrati in HACCP → Ricevimento merce; gli scarichi manuali consumano i lotti FEFO disponibili.
          </div>

          {/* Tabella stock */}
          <div style={card}>
            {filtered.length === 0 && (
              <div style={{ textAlign:"center", color:"var(--k2-text-faint)", padding:"32px", fontSize:13 }}>Nessun ingrediente trovato.</div>
            )}
            {filtered.map(ing => {
              const s      = ing.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 };
              const status = stockStatus(ing);
              const fab    = calcFabbisognoIngrediente(ing.id, recipes);
              const costoStock = s.currentStock_g * ing.cost;
              return (
                <div key={ing.id} style={{ padding:"11px 0", borderBottom:"1px solid var(--k2-border)", display:"grid", gridTemplateColumns:"1fr auto auto", gap:10, alignItems:"center" }}>
                  {/* Info ingrediente */}
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:STATUS_COLOR[status], flexShrink:0, display:"inline-block" }}/>
                      <span style={{ fontSize:13, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{ing.name}</span>
                      <span style={{ fontSize:9, color:"var(--k2-text-dim)", background:"var(--k2-bg-input)", borderRadius:3, padding:"1px 5px" }}>{ing.category}</span>
                    </div>
                    <div style={{ display:"flex", gap:14, fontSize:11, marginLeft:16 }}>
                      <span>
                        Stock: <strong style={{ color:STATUS_COLOR[status], fontFamily:"monospace" }}>{fmtStock(s.currentStock_g)}</strong>
                      </span>
                      {s.minStock_g > 0 && (
                        <span style={{ color:"var(--k2-text-dim)" }}>
                          Min: <span style={{ fontFamily:"monospace" }}>{fmtStock(s.minStock_g)}</span>
                        </span>
                      )}
                      {fab > 0 && (
                        <span style={{ color:"var(--k2-text-muted)" }}>
                          Fabbisogno/vasch: <span style={{ fontFamily:"monospace" }}>{fmtStock(fab)}</span>
                        </span>
                      )}
                      <span style={{ color:"var(--k2-text-dim)" }}>
                        Valore: <span style={{ color:"#c8a96e" }}>{fmtE(costoStock)}</span>
                      </span>
                    </div>
                    {s.minStock_g > 0 && (
                      <div style={{ marginLeft:16, marginTop:4, maxWidth:260 }}>
                        <StockBar current={s.currentStock_g} min={s.minStock_g}/>
                      </div>
                    )}
                  </div>

                  {/* Badge status */}
                  <div style={{ textAlign:"center", minWidth:70 }}>
                    <span style={{ fontSize:9, fontWeight:"bold", color:STATUS_COLOR[status], background:STATUS_COLOR[status]+"18", border:`1px solid ${STATUS_COLOR[status]}44`, borderRadius:10, padding:"2px 8px" }}>
                      {STATUS_LABEL[status]}
                    </span>
                    {ing.stockLastUpdate && (
                      <div style={{ fontSize:8, color:"var(--k2-text-faint)", marginTop:4 }}>
                        {formatDateIT(ing.stockLastUpdate)}
                      </div>
                    )}
                  </div>

                  {/* Azioni */}
                  <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                    <button
                      onClick={() => setMinModal(ing)}
                      title="Imposta scorta minima"
                      style={{ ...btnS, padding:"5px 9px", fontSize:11 }}
                    >⚙️</button>
                    <button
                      onClick={() => setMovModal(ing)}
                      style={{ ...btnP, padding:"5px 12px", fontSize:11 }}
                    >± Movimenta</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: SOTTOSCORTA ── */}
      {tab === "sottoscorta" && (
        <div>
          {sottoscorta.length === 0 ? (
            <div style={{ ...card, textAlign:"center", padding:"40px", color:"#4ade80", fontSize:15 }}>
              ✓ Tutti gli ingredienti sono sopra la scorta minima per {sede}
            </div>
          ) : (
            <div>
              <div style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:12 }}>
                Gli ingredienti seguenti sono sotto la scorta minima impostata per <strong style={{ color:SEDE_COLORS[sede] }}>{sede}</strong>. Effettua un carico o aggiorna lo stock.
              </div>
              <div style={{ display:"grid", gap:8 }}>
                {sottoscorta.map(ing => {
                  const s      = ing.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 };
                  const manca  = s.minStock_g - s.currentStock_g;
                  const status = stockStatus(ing);
                  return (
                    <div key={ing.id} style={{ ...card, marginBottom:0, display:"flex", alignItems:"center", gap:12, borderLeft:`3px solid ${STATUS_COLOR[status]}` }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                          <span style={{ fontSize:14, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{ing.name}</span>
                          <span style={{ fontSize:9, color:STATUS_COLOR[status], background:STATUS_COLOR[status]+"18", border:`1px solid ${STATUS_COLOR[status]}44`, borderRadius:10, padding:"1px 6px", fontWeight:"bold" }}>
                            {STATUS_LABEL[status]}
                          </span>
                        </div>
                        <div style={{ display:"flex", gap:14, fontSize:11 }}>
                          <span>Stock: <strong style={{ color:STATUS_COLOR[status], fontFamily:"monospace" }}>{fmtStock(s.currentStock_g)}</strong></span>
                          <span style={{ color:"var(--k2-text-dim)" }}>Min: <span style={{ fontFamily:"monospace" }}>{fmtStock(s.minStock_g)}</span></span>
                          <span style={{ color:"#f87171" }}>Mancano: <span style={{ fontFamily:"monospace", fontWeight:"bold" }}>{fmtStock(manca)}</span></span>
                        </div>
                        <div style={{ marginTop:5, maxWidth:300 }}>
                          <StockBar current={s.currentStock_g} min={s.minStock_g}/>
                        </div>
                      </div>
                      <button onClick={() => setMovModal(ing)} style={{ ...btnP, fontSize:11, padding:"6px 14px", flexShrink:0 }}>
                        + Carica
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: INVENTARIO ── */}
      {tab === "inventario" && (
        <div>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:10 }}>
              <div>
                <div style={{ fontSize:14, color:"#c8a96e", fontWeight:"bold" }}>Chiusura inventario · {sede}</div>
                <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>Confronta giacenza teorica e giacenza reale. Le differenze possono essere salvate come bozza o applicate con rettifica.</div>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <input type="date" value={auditDate} onChange={e => setAuditDate(e.target.value)} style={{ ...inp, width:"auto" }} />
                <button onClick={() => saveInventoryAuditDraft(false)} style={btnS}>💾 Salva bozza</button>
                <button onClick={() => saveInventoryAuditDraft(true)} style={btnP}>✅ Applica rettifiche</button>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:8, marginBottom:10 }}>
              <div style={{ ...card, marginBottom:0, textAlign:"center" }}><div style={{ fontSize:20, fontWeight:"bold", color:"#c8a96e" }}>{inventoryLines.length}</div><div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Articoli contati</div></div>
              <div style={{ ...card, marginBottom:0, textAlign:"center" }}><div style={{ fontSize:20, fontWeight:"bold", color:inventoryDiffLines.length > 0 ? "#fbbf24" : "#4ade80" }}>{inventoryDiffLines.length}</div><div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Differenze</div></div>
              <div style={{ ...card, marginBottom:0, textAlign:"center" }}><div style={{ fontSize:20, fontWeight:"bold", color:"#60a5fa" }}>{fmtStock(inventoryDiffLines.reduce((s,l)=>s+Math.abs(l.delta_g),0))}</div><div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Delta assoluto</div></div>
              <textarea value={auditNote} onChange={e => setAuditNote(e.target.value)} style={{ ...inp, minHeight:64, resize:"vertical" }} placeholder="Note inventario / motivo rettifiche" />
            </div>
            {auditMsg && <div style={{ fontSize:11, color:auditMsg.type==="ok" ? "#4ade80" : "#f87171", marginBottom:8 }}>{auditMsg.text}</div>}
            <div style={{ maxHeight:420, overflowY:"auto", border:"1px solid var(--k2-border)", borderRadius:6 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1.5fr auto auto auto", gap:8, padding:"8px 10px", fontSize:9, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", borderBottom:"1px solid var(--k2-border)" }}>
                <div>Ingrediente</div><div style={{ textAlign:"right" }}>Teorico</div><div style={{ textAlign:"right" }}>Reale</div><div style={{ textAlign:"right" }}>Delta</div>
              </div>
              {inventoryLines.map(line => (
                <div key={`audit-${line.ing.id}`} style={{ display:"grid", gridTemplateColumns:"1.5fr auto auto auto", gap:8, padding:"8px 10px", borderBottom:"1px solid var(--k2-border)", alignItems:"center" }}>
                  <div style={{ fontSize:12, color:"var(--k2-text-secondary)" }}>{line.ing.name}</div>
                  <div style={{ fontSize:11, textAlign:"right", color:"var(--k2-text-dim)", fontFamily:"monospace" }}>{fmtStock(line.theoretical_g)}</div>
                  <div style={{ textAlign:"right" }}>
                    <input type="number" value={auditCounts[String(line.ing.id)] ?? line.theoretical_g} onChange={e => setAuditCounts(prev => ({ ...prev, [String(line.ing.id)]: e.target.value }))} style={{ ...inp, width:92, textAlign:"right", fontSize:11 }} min="0" />
                  </div>
                  <div style={{ fontSize:11, textAlign:"right", fontFamily:"monospace", fontWeight:"bold", color:line.delta_g === 0 ? "var(--k2-text-dim)" : line.delta_g > 0 ? "#60a5fa" : "#f87171" }}>
                    {line.delta_g > 0 ? "+" : ""}{fmtStock(Math.abs(line.delta_g))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, marginBottom:0 }}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:8 }}>Ultime chiusure inventariali</div>
            {latestAudits.length === 0 ? (
              <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Nessuna chiusura inventariale registrata.</div>
            ) : latestAudits.map(audit => (
              <div key={audit.id} style={{ display:"grid", gridTemplateColumns:"auto auto 1fr auto", gap:10, padding:"8px 0", borderBottom:"1px solid var(--k2-border)", alignItems:"center" }}>
                <div style={{ fontSize:11, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{formatDateIT(audit.date)}</div>
                <div>{statusPill(audit.status === "closed" ? "chiusa" : "bozza")}</div>
                <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>{audit.lines.length} differenze · {audit.createdBy || "utente non indicato"}{audit.note ? ` · ${audit.note}` : ""}</div>
                <div style={{ fontSize:11, color:"#c8a96e", fontFamily:"monospace" }}>{fmtStock(audit.lines.reduce((s,l)=>s+Math.abs(Number(l.delta_g||0)),0))}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: LOG ── */}
      {tab === "log" && (
        <div>
          <div style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:12 }}>
            Ultimi movimenti registrati (persistenti) — tutte le sedi
          </div>
          {(() => {
            // Ultimi 50 movimenti ordinati per createdAt decrescente
            const logItems = [...movimenti]
              .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
              .slice(0, 50);
            if (logItems.length === 0) return (
              <div style={{ ...card, textAlign:"center", padding:"40px", color:"var(--k2-text-faint)" }}>
                Nessun movimento registrato.
              </div>
            );
            return (
              <div style={card}>
                {logItems.map(m => {
                  const delta = (m.after_g ?? 0) - (m.before_g ?? 0);
                  const col   = m.tipo === "rettifica" ? "#60a5fa" : delta >= 0 ? "#4ade80" : "#f87171";
                  const tipoIcon = { carico:"↑", scarico:"↓", rettifica:"=", produzione:"⚙" }[m.tipo] || "·";
                  const sedeColor = m.sede === "Chiavari" ? "#60a5fa" : "#c8a96e";
                  return (
                    <div key={m.id} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:"1px solid var(--k2-border)" }}>
                      <span style={{ fontSize:17, color:col, minWidth:22, textAlign:"center", marginTop:1 }}>{tipoIcon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, color:"var(--k2-text-secondary)" }}>
                          <strong>{m.ingredientName}</strong>
                          <span style={{ fontSize:9, color:sedeColor, marginLeft:8, background:sedeColor+"18", border:`1px solid ${sedeColor}44`, borderRadius:8, padding:"1px 6px" }}>{m.sede}</span>
                          <span style={{ fontSize:9, color:"var(--k2-text-dim)", marginLeft:6 }}>{m.causale}</span>
                        </div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:2 }}>
                          {formatDateIT(m.dataMovimento)}
                          {m.note && <span style={{ marginLeft:8, color:"var(--k2-text-muted)", fontStyle:"italic" }}>"{m.note}"</span>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right", fontFamily:"monospace", fontSize:11, flexShrink:0 }}>
                        <div style={{ color:"var(--k2-text-dim)" }}>{fmtStock(m.before_g)}</div>
                        <div style={{ color:col, fontWeight:"bold" }}>{delta >= 0 ? "+" : ""}{fmtStock(Math.abs(delta))}</div>
                        <div style={{ color:"var(--k2-text-secondary)" }}>→ {fmtStock(m.after_g)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Modali */}
      {movModal && (
        <MovimentoModal
          ing={movModal}
          sede={sede}
          onSave={(newStock, mov) => handleMovimento(movModal, newStock, mov)}
          onClose={() => setMovModal(null)}
        />
      )}
      {minModal && (
        <MinStockModal
          ing={minModal}
          sede={sede}
          onSave={(newMin) => handleMinStock(minModal, newMin)}
          onClose={() => setMinModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD — top 5 ricette ordinate per margine reale
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({ incassi, cashflow, recipes, ingredients, costiF, sede, goodsReceipts = [], haccpTraceability = [], onGoTo }) {
  const ultimi7 = Array.from({ length:7 }, (_, i) => {
    const iso = shiftISODate(today(), -i);
    return { data:iso, label:formatDateIT(iso), totale:totIncasso(incassi[sede]?.[iso] || {}) };
  }).reverse();
  const tot7  = ultimi7.reduce((s, g) => s + g.totale, 0);
  const tot30 = Array.from({ length:30 }, (_, i) => totIncasso(incassi[sede]?.[shiftISODate(today(), -i)] || {})).reduce((s, v) => s + v, 0);
  const mesiCF = Array.from({ length:12 }, (_, m) => {
    const ent = Object.values(cashflow[sede]?.[m]?.entrate || {}).reduce((s, v) => s + Number(v||0), 0);
    const usc = Object.values(cashflow[sede]?.[m]?.uscite  || {}).reduce((s, v) => s + Number(v||0), 0);
    return { label:MESI[m], entrate:ent, uscite:usc, margine:ent-usc };
  });
  const totAnno = mesiCF.reduce((s, m) => s + m.margine, 0);

  // Top 5 per margine operativo reale (ordinato)
  const pD = costiF.porzione_default || 150;
  const top5 = recipes
    .map(r => {
      const costCtx = calcCostMPDetailedForSede(r, ingredients, goodsReceipts, haccpTraceability, sede);
      const costMP = costCtx.cost;
      const cpg    = r.yield_g > 0 ? costMP / r.yield_g : 0;
      const cpp    = cpg * pD;
      const ind    = costoIndiretto(costiF, pD);
      const sp     = (cpp + ind) * (costiF.markup_default || 3.5);
      const marg   = sp - cpp - ind;
      const fcp    = sp > 0 ? (cpp / sp) * 100 : 0;
      return { r, costMP, cpp, ind, sp, marg, fcp, costCtx };
    })
    .sort((a, b) => b.marg - a.marg)
    .slice(0, 5);

  // ── Scorte critiche: ingredienti con minStock impostato, ordinati per % fill asc ──
  const scorteRaw = ingredients
    .filter(i => i.active !== false && i.stockEnabled !== false)
    .map(i => {
      const s = i.stockBySede?.[sede] || { currentStock_g:0, minStock_g:0 };
      if (!s.minStock_g || s.minStock_g <= 0) return null;
      const pct = s.currentStock_g / s.minStock_g;
      return { i, s, pct };
    })
    .filter(Boolean)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:17, fontWeight:"normal" }}>🏠 Dashboard — {sede}</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
        {[
          { label:"Oggi",            val:fmtE(totIncasso(incassi[sede]?.[today()]||{})), color:"#c8a96e" },
          { label:"Ultimi 7 giorni", val:fmtE(tot7),  color:"#4ade80" },
          { label:"Ultimi 30 giorni",val:fmtE(tot30), color:"#60a5fa" },
          { label:"Margine anno",    val:fmtE(totAnno),color:totAnno>=0?"#4ade80":"#f87171" },
        ].map(k => (
          <div key={k.label} style={{ ...card, marginBottom:0, textAlign:"center" }}>
            <div style={{ fontSize:22, fontWeight:"bold", color:k.color }}>{k.val}</div>
            <div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, marginBottom:14 }}>
        <div style={{ fontSize:11, color:"#c8a96e", marginBottom:12 }}>Incassi ultimi 7 giorni</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={ultimi7} margin={{ top:0, right:0, left:-20, bottom:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
            <XAxis dataKey="label" tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false}/>
            <Tooltip content={<ChartTooltip/>}/>
            <Bar dataKey="totale" name="Incasso" fill={SEDE_COLORS[sede]} radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Widget Scorte critiche ── */}
      <div style={{ ...card, marginBottom:14, borderLeft:"3px solid #f87171" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ fontSize:11, color:"#f87171", letterSpacing:"0.08em", textTransform:"uppercase" }}>
            📦 Scorte critiche — {sede}
          </div>
          <button
            onClick={() => typeof onGoTo === "function" && onGoTo("magazzino")}
            style={{ ...btnS, fontSize:10, padding:"4px 10px", color:"#c8a96e", borderColor:"#c8a96e44" }}
          >
            Vai al magazzino →
          </button>
        </div>
        {scorteRaw.length === 0 ? (
          <div style={{ fontSize:12, color:"#4ade80" }}>✓ Nessuna scorta sotto soglia minima</div>
        ) : (
          scorteRaw.map(({ i, s, pct }) => {
            const statusColor = s.currentStock_g === 0 ? "#f87171" : pct < 0.5 ? "#f87171" : "#fbbf24";
            const statusLabel = s.currentStock_g === 0 ? "Esaurito" : pct < 0.5 ? "Basso" : "Attenzione";
            return (
              <div key={i.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid var(--k2-border)" }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:statusColor, flexShrink:0, display:"inline-block" }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{i.name}</div>
                  <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                    Stock: <span style={{ color:statusColor, fontFamily:"monospace" }}>{fmtStock(s.currentStock_g)}</span>
                    <span style={{ marginLeft:8 }}>Min: <span style={{ fontFamily:"monospace" }}>{fmtStock(s.minStock_g)}</span></span>
                  </div>
                  <div style={{ background:"var(--k2-bg-input)", borderRadius:2, height:4, marginTop:4, overflow:"hidden" }}>
                    <div style={{ width:`${Math.min(100, pct*100)}%`, height:"100%", background:statusColor, borderRadius:2 }}/>
                  </div>
                </div>
                <span style={{ fontSize:9, fontWeight:"bold", color:statusColor, background:statusColor+"18", border:`1px solid ${statusColor}44`, borderRadius:8, padding:"1px 7px", whiteSpace:"nowrap" }}>
                  {statusLabel}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize:11, color:"#c8a96e", marginBottom:10 }}>🏆 Top 5 ricette per margine operativo — porzione {pD}g</div>
        {top5.length === 0 && <div style={{ color:"var(--k2-text-faint)", fontSize:13 }}>Nessuna ricetta disponibile</div>}
        {top5.map(({ r, cpp, ind, sp, marg, fcp }) => {
          const fc = fcColor(fcp);
          return (
            <div key={r.id} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto auto", gap:10, alignItems:"center", padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
              <div style={{ fontSize:13, color:"var(--k2-text-secondary)" }}>{r.name}</div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>FC MP</div>
                <div style={{ fontSize:12, fontWeight:"bold", color:fc.color, fontFamily:"monospace" }}>{fmt(fcp,1)}%</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Costo tot.</div>
                <div style={{ fontSize:12, color:"#c8a96e" }}>{fmtE(cpp+ind)}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Prezzo sug.</div>
                <div style={{ fontSize:12, color:"var(--k2-text)" }}>{fmtE(sp)}</div>
              </div>
              <div style={{ textAlign:"right", minWidth:75 }}>
                <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Margine</div>
                <div style={{ fontSize:13, fontWeight:"bold", color:marg>=0?"#4ade80":"#f87171" }}>{marg>=0?"+":""}{fmtE(marg)}</div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INCASSI
// ═══════════════════════════════════════════════════════════════════════════════
function Incassi({ incassi, setIncassi, sede }) {
  const [giorno, setGiorno]   = useState(today());
  const [form, setForm]       = useState({ contante:"", pos:"", delivery:"", rivendita:"", extra:"", note:"" });
  const [saved, setSaved]     = useState(false);
  const [tab, setTab]         = useState("inserisci");
  const [periodo, setPeriodo] = useState("7");

  function carica(iso) {
    setGiorno(iso);
    const g = incassi[sede]?.[iso];
    setForm(g
      ? { contante:g.contante||"", pos:g.pos||"", delivery:g.delivery||"", rivendita:g.rivendita||"", extra:g.extra||"", note:g.note||"" }
      : { contante:"", pos:"", delivery:"", rivendita:"", extra:"", note:"" }
    );
  }

  function salva() {
    setIncassi(prev => ({
      ...prev,
      [sede]: {
        ...prev[sede],
        [giorno]: {
          contante:  Number(form.contante  || 0),
          pos:       Number(form.pos       || 0),
          delivery:  Number(form.delivery  || 0),
          rivendita: Number(form.rivendita || 0),
          extra:     Number(form.extra     || 0),
          note: form.note || "",
        }
      }
    }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const totForm = VOCI_INCASSO.reduce((s, v) => s + Number(form[v.key] || 0), 0);

  const giorni = Array.from({ length: Number(periodo) }, (_, i) => {
    const iso = shiftISODate(today(), -(Number(periodo)-1-i));
    return { data:iso, ...VOCI_INCASSO.reduce((o, v) => ({ ...o, [v.key]: Number(incassi[sede]?.[iso]?.[v.key] || 0) }), {}), totale:totIncasso(incassi[sede]?.[iso] || {}) };
  });
  const totP = giorni.reduce((s, g) => s + g.totale, 0);

  return (
    <div>
      {saved && <div style={{ position:"fixed", top:14, right:14, background:"var(--k2-bg-green-card)", border:"1px solid #4ade80", color:"#4ade80", padding:"7px 14px", borderRadius:5, fontSize:11, fontFamily:"monospace", zIndex:999 }}>✓ Salvato</div>}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <h2 style={{ margin:0, fontSize:17, fontWeight:"normal" }}>💰 Incassi — {sede}</h2>
        <div style={{ display:"flex", gap:4 }}>
          {[["inserisci","Inserisci"],["storico","Storico"],["grafici","Grafici"]].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding:"5px 12px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)" }}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "inserisci" && (
        <div style={{ maxWidth:560 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <button onClick={() => carica(shiftISODate(giorno, -1))} style={{ ...btnS, padding:"5px 10px", fontSize:16 }}>‹</button>
            <div style={{ textAlign:"center", flex:1 }}>
              <div style={{ fontSize:16, fontWeight:"bold" }}>{formatDateIT(giorno)}</div>
              {giorno === today() && <div style={{ fontSize:9, color:"#c8a96e" }}>Oggi</div>}
            </div>
            <button onClick={() => { if (giorno < today()) carica(shiftISODate(giorno, 1)); }} style={{ ...btnS, padding:"5px 10px", fontSize:16 }}>›</button>
            <button onClick={() => carica(today())} style={{ ...btnS, fontSize:10 }}>Oggi</button>
          </div>

          <div style={card}>
            {VOCI_INCASSO.map(v => (
              <div key={v.key} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <span style={{ fontSize:20, width:32 }}>{v.icon}</span>
                <div style={{ flex:1 }}>
                  <label style={{ ...lbl, color:v.color }}>{v.label}</label>
                  <div style={{ position:"relative" }}>
                    <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--k2-text-dim)", fontSize:13 }}>€</span>
                    <input type="number" value={form[v.key]} onChange={e => setForm(f => ({ ...f, [v.key]:e.target.value }))} placeholder="0" style={{ ...inp, paddingLeft:26, textAlign:"right", fontSize:16 }} min="0" step="0.01"/>
                  </div>
                </div>
                <div style={{ minWidth:80, textAlign:"right", fontSize:17, fontWeight:"bold", color:v.color }}>{fmtE(form[v.key]||0)}</div>
              </div>
            ))}
            <div style={{ borderTop:"1px solid var(--k2-border)", paddingTop:12, display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <span style={{ fontSize:12, color:"var(--k2-text-dim)", letterSpacing:"0.08em", textTransform:"uppercase" }}>Totale giorno</span>
              <span style={{ fontSize:26, fontWeight:"bold", color:"#c8a96e", fontFamily:"monospace" }}>{fmtE(totForm)}</span>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={lbl}>Note</label>
              <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} placeholder="es. Giornata piovosa..." style={{ ...inp, fontSize:13 }}/>
            </div>
            <button onClick={salva} style={{ ...btnP, width:"100%", justifyContent:"center", padding:"11px", fontSize:13 }}>💾 Salva {formatDateIT(giorno)}</button>
          </div>

          {/* Confronto ieri */}
          {(() => {
            const isoIeri = shiftISODate(giorno, -1);
            const gI = incassi[sede]?.[isoIeri];
            if (!gI) return null;
            const tI = totIncasso(gI);
            const diff = totForm - tI;
            return (
              <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>Ieri ({formatDateIT(isoIeri)}): <span style={{ color:"var(--k2-text)" }}>{fmtE(tI)}</span></span>
                <span style={{ fontSize:13, fontWeight:"bold", color:diff>=0?"#4ade80":"#f87171" }}>{diff>=0?"+":""}{fmtE(diff)} ({diff>=0?"+":""}{tI>0?fmt((diff/tI)*100,1):"0"}%)</span>
              </div>
            );
          })()}
        </div>
      )}

      {tab === "storico" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
            {[
              ["Ultimi 7 giorni",  Array.from({length:7},  (_,i) => totIncasso(incassi[sede]?.[shiftISODate(today(),-i)]||{})).reduce((s,v)=>s+v,0)],
              ["Ultimi 30 giorni", Array.from({length:30}, (_,i) => totIncasso(incassi[sede]?.[shiftISODate(today(),-i)]||{})).reduce((s,v)=>s+v,0)],
              ["Media/giorno",     Array.from({length:30}, (_,i) => totIncasso(incassi[sede]?.[shiftISODate(today(),-i)]||{})).reduce((s,v)=>s+v,0)/30],
            ].map(([l, v]) => (
              <div key={l} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:19, fontWeight:"bold", color:"#c8a96e" }}>{fmtE(v)}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={card}>
            {Array.from({ length:30 }, (_, i) => {
              const iso = shiftISODate(today(), -i);
              const g = incassi[sede]?.[iso] || {};
              return { data:iso, tot:totIncasso(g), g };
            }).map((item, i) => (
              <div key={item.data} onClick={() => { carica(item.data); setTab("inserisci"); }} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid var(--k2-border)", cursor:"pointer" }}>
                <div style={{ minWidth:80, fontSize:12, color:item.data===today()?"#c8a96e":"var(--k2-text-secondary)", fontWeight:item.data===today()?"bold":"normal" }}>{formatDateIT(item.data)}</div>
                <div style={{ flex:1, display:"flex", gap:4, flexWrap:"wrap" }}>
                  {VOCI_INCASSO.filter(v => Number(item.g[v.key]||0) > 0).map(v => (
                    <span key={v.key} style={{ fontSize:9, color:v.color, background:"rgba(0,0,0,0.3)", borderRadius:3, padding:"1px 5px" }}>{v.icon} {fmtE(item.g[v.key]||0)}</span>
                  ))}
                </div>
                <div style={{ fontSize:15, fontWeight:"bold", color:"#c8a96e", minWidth:75, textAlign:"right" }}>{fmtE(item.tot)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "grafici" && (
        <div>
          <div style={{ display:"flex", gap:4, marginBottom:14 }}>
            {[["7","7 giorni"],["14","14 giorni"],["30","30 giorni"]].map(([v,l]) => (
              <button key={v} onClick={() => setPeriodo(v)} style={{ ...btnS, fontSize:11, background:periodo===v?"#c8a96e":"transparent", color:periodo===v?"var(--k2-bg)":"var(--k2-text-muted)" }}>{l}</button>
            ))}
          </div>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:12 }}>Incassi per voce — {periodo} giorni · Totale: {fmtE(totP)}</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={giorni} margin={{ top:0, right:0, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
                <XAxis dataKey="data" tickFormatter={d => d.slice(5).replace("-","/")} tick={{ fill:"var(--k2-text-dim)", fontSize:9 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:9 }} axisLine={false} tickLine={false} tickFormatter={v => "€"+v}/>
                <Tooltip content={<ChartTooltip/>}/>
                {VOCI_INCASSO.map(v => <Bar key={v.key} dataKey={v.key} name={v.label} stackId="a" fill={v.color} radius={v.key==="extra"?[3,3,0,0]:[0,0,0,0]}/>)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:12 }}>Andamento totale</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={giorni} margin={{ top:0, right:0, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
                <XAxis dataKey="data" tickFormatter={d => d.slice(5).replace("-","/")} tick={{ fill:"var(--k2-text-dim)", fontSize:9 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:9 }} axisLine={false} tickLine={false} tickFormatter={v => "€"+v}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Line type="monotone" dataKey="totale" name="Totale" stroke={SEDE_COLORS[sede]} strokeWidth={2} dot={{ r:3, fill:SEDE_COLORS[sede] }} activeDot={{ r:5 }}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={card}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:12 }}>Ripartizione per voce</div>
            {VOCI_INCASSO.map(v => {
              const vt = giorni.reduce((s, g) => s + g[v.key], 0);
              const pct = totP > 0 ? (vt / totP) * 100 : 0;
              return (
                <div key={v.key} style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:11, color:v.color }}>{v.icon} {v.label}</span>
                    <div style={{ display:"flex", gap:10 }}>
                      <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>{fmt(pct,1)}%</span>
                      <span style={{ fontSize:12, fontWeight:"bold", color:v.color, minWidth:80, textAlign:"right" }}>{fmtE(vt)}</span>
                    </div>
                  </div>
                  <div style={{ background:"var(--k2-bg-input)", height:5, borderRadius:3, overflow:"hidden" }}><div style={{ width:`${pct}%`, height:"100%", background:v.color, borderRadius:3 }}/></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER — fonde recipes app + K2_RICETTARIO in formato unificato
// Le ricette K2 statiche vengono convertite in oggetti compatibili con
// normalizeRecipe. Le ricette app con stesso nome hanno priorità.
// Usato da Produzione, Etichette, Listino per mostrare TUTTI i gusti.
// ═══════════════════════════════════════════════════════════════════════════════

const CAT_MAP_K2 = {
  "Gelati crema":          "Creme classiche",
  "Gelati frutta e vegan": "Frutta",
  "Sorbetti":              "Sorbetti",
  "Basi interne":          "Basi interne",
  "Salse e variegati":     "Salse e variegati",
  "Semifreddi":            "Semifreddi",
  "Granite":               "Granite",
  "Soft serve":            "Soft Serve",
  "Basi pasticceria s.g.": "Pasticceria s.g.",
  "Ricette pasticceria":   "Pasticceria",
  "Creme pasticcere":      "Creme pasticcere",
};

// ID sintetico stabile per ricette K2 statiche (non collide con ID numerici app)
function k2StaticId(k2id) { return `k2static_${k2id}`; }
function isK2StaticId(id)  { return String(id).startsWith("k2static_"); }

function k2RicettarioToAppRecipes(appIngredients = []) {
  return K2_RICETTARIO.map(r => {
    const nome = r.nome.replace(/⭐/g,"").trim();
    // Auto-link ingredienti K2 testuali → ingredienti app
    const linkedIngredients = (appIngredients.length > 0 && (r.ingredienti||[]).length > 0)
      ? autoLinkRecipeIngredients(r.ingredienti, appIngredients)
      : [];
    // Costruisce array ingredients app solo per quelli con match HIGH e dose parsabile
    const appIngredientRefs = linkedIngredients
      .filter(li => li.confidenceLabel === "high" && li.ingredientId !== null)
      .map(li => {
        const doseStr = String(li.dose||"").replace(/[^0-9]/g,"").replace(/[^0-9]/g,"");
        const q = doseStr ? parseInt(doseStr) : 0;
        return { id: li.ingredientId, q };
      })
      .filter(ref => ref.q > 0 && ref.q < 100000);

    return {
      id:          k2StaticId(r.id),
      name:        nome,
      category:    CAT_MAP_K2[r.categoria] || r.categoria,
      yield_g:     (() => {
        const m = String(r.resa || "").replace(/[^0-9.]/g,"");
        return m ? Math.round(parseFloat(m)) || 3000 : 3000;
      })(),
      notes:       r.note?.replace(/⭐/g,"").trim() || "",
      ingredients: appIngredientRefs, // ingredienti app collegati con alta confidenza
      active:      true,
      repartoId:   r.reparto === "pasticceria" ? "pasticceria" : "gelateria",
      labelRevision: 1,
      labelApprovedRevision: 0,
      labelNeedsReview: true,
      _isK2Static: true,
      _k2id:       r.id,
      _k2data:     r,
      _linkedIngredients: linkedIngredients, // tutti i link con confidenza
    };
  });
}

// Ritorna l'insieme unificato: ricette app + k2 statiche che NON hanno
// già una corrispondenza per nome nell'app.
function getMergedRecipes(appRecipes, repartoId = null, appIngredients = []) {
  const appNames = new Set(
    (appRecipes || []).map(r => r.name?.toLowerCase().trim())
  );
  const k2All = k2RicettarioToAppRecipes(appIngredients);
  const k2New = k2All.filter(r => {
    const nameKey = r.name?.toLowerCase().trim();
    // salta se già presente nell'app (stesso nome) oppure se reparto non matcha
    if (appNames.has(nameKey)) return false;
    if (repartoId && r.repartoId !== repartoId) return false;
    return true;
  });
  const appFiltered = repartoId
    ? (appRecipes || []).filter(r => r.repartoId === repartoId)
    : (appRecipes || []);
  return [...appFiltered, ...k2New];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALLERGENI RICORSIVI — esplode semilavorati interni (HACCP Reg. EU 1169/2011)
// Supporta match per nome ricetta ↔ ingrediente (semilavorati interni K2)
// ═══════════════════════════════════════════════════════════════════════════════
function getAllergensRecursiveByName(recipe, allRecipes, ingredients, _visited = new Set(), _depth = 0) {
  const MAX_DEPTH = 5;
  if (!recipe || _depth > MAX_DEPTH) return new Set();
  const allergenSet = new Set();
  (recipe.ingredients || []).forEach(ri => {
    const ingKey = `${ri.id}:${_depth}`;
    if (_visited.has(ingKey)) return;
    _visited.add(ingKey);
    const ing = ingredients.find(i => i.id === ri.id);
    if (!ing) return;
    // Allergeni diretti
    (ing.allergens || []).forEach(a => allergenSet.add(a));
    // Cerca ricetta semilavorato per nome (es. "Pasta Nocciola K2" → ricetta "Nocciola")
    const ingNameNorm = ing.name?.toLowerCase().trim().replace(/\s+k2\s*$/i, "").trim();
    const subRecipe = (allRecipes || []).find(r => {
      if (r.id === recipe.id) return false;
      const rName = r.name?.toLowerCase().trim().replace(/\s+k2\s*$/i, "").trim();
      return rName === ingNameNorm || rName.includes(ingNameNorm) || ingNameNorm.includes(rName);
    });
    if (subRecipe) {
      const subAllergens = getAllergensRecursiveByName(subRecipe, allRecipes, ingredients, _visited, _depth + 1);
      subAllergens.forEach(a => allergenSet.add(a));
    }
  });
  return allergenSet;
}

// Drop-in con fallback sicuro su getRecipeAllergens quando allRecipes non disponibile
function getRecipeAllergensStrict(recipe, allRecipes, ingredients) {
  if (!allRecipes || allRecipes.length === 0) return getRecipeAllergens(recipe, ingredients);
  return [...getAllergensRecursiveByName(recipe, allRecipes, ingredients)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-LINK — associa ingredienti testo K2_RICETTARIO agli ingredienti app
// ═══════════════════════════════════════════════════════════════════════════════
const K2_SINONIMI = {
  "latte intero": ["latte fresco","latte intero fresco","latte 3.5","latte 3,5"],
  "panna":        ["panna fresca","panna 35","panna 35%","panna fresca 35%"],
  "saccarosio":   ["zucchero","zucchero semolato","zucchero di canna"],
  "glucosio":     ["glucosio liquido","glucosio soft","sciroppo glucosio","glucosio disidratato"],
  "destrosio":    ["destrosio in polvere"],
  "cacao":        ["cacao in polvere","cacao amaro","cacao 22","cacao 24","cacao scuro"],
  "cioccolato":   ["cioccolato fondente","copertura cioccolato","cioccolato nero"],
  "nocciola":     ["pasta nocciola","nocciola 100%","pasta di nocciola"],
  "pistacchio":   ["pasta pistacchio","pistacchio 100%","pasta di pistacchio"],
  "acqua":        ["acqua osmotica","acqua microfiltrata","acqua filtrata"],
  "yogurt":       ["yogurt magro","yogurt intero","yogurt bianco"],
};

function _normIngName(str) {
  return (str || "").toLowerCase().trim()
    .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ")
    .replace(/\bk2\b/g, "").replace(/\b(g|kg|ml|lt|l|%|35|70|75)\b/g, "")
    .trim();
}

function _levenshtein(a, b) {
  if (a.length > 30) a = a.slice(0, 30);
  if (b.length > 30) b = b.slice(0, 30);
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function _ingSimScore(a, b) {
  const na = _normIngName(a), nb = _normIngName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  for (const [can, syns] of Object.entries(K2_SINONIMI)) {
    const all = [_normIngName(can), ...syns.map(_normIngName)];
    if (all.includes(na) && all.includes(nb)) return 0.95;
  }
  const maxLen = Math.max(na.length, nb.length);
  return maxLen ? Math.max(0, 1 - _levenshtein(na, nb) / maxLen) : 0;
}

function autoLinkRecipeIngredients(k2IngList, appIngredients) {
  if (!Array.isArray(k2IngList) || k2IngList.length === 0) return [];
  if (!Array.isArray(appIngredients) || appIngredients.length === 0) {
    return k2IngList.map(k => ({
      text:k.nome||"", dose:k.dose||"", note:k.note||"",
      ingredientId:null, ingredientName:null, confidence:0,
      confidenceLabel:"none", requiresReview:true, alternatives:[],
    }));
  }
  const THRESH_HIGH = 0.85, THRESH_MED = 0.60;
  // Pre-filtra ingredienti attivi con nome valido
  const activeIngs = appIngredients.filter(i => i.active !== false && i.name);
  return k2IngList.map(k2ing => {
    const nomeSrc = k2ing?.nome || "";
    if (!nomeSrc.trim()) return {
      text:"", dose:k2ing?.dose||"", note:k2ing?.note||"",
      ingredientId:null, ingredientName:null, confidence:0,
      confidenceLabel:"none", requiresReview:true, alternatives:[],
    };
    const cands = activeIngs
      .map(i => ({
        ingredientId: i.id,
        ingredientName: i.name,
        confidence: _ingSimScore(nomeSrc, i.name),
        costPerGram: i.cost || 0,
        allergens: i.allergens || [],
      }))
      .filter(c => c.confidence >= THRESH_MED)
      .sort((a, b) => b.confidence - a.confidence);
    const best = cands[0] || null;
    return {
      text: nomeSrc,
      dose: k2ing.dose || "",
      note: k2ing.note || "",
      ingredientId: best?.ingredientId || null,
      ingredientName: best?.ingredientName || null,
      confidence: best?.confidence || 0,
      confidenceLabel: !best ? "none" : best.confidence >= THRESH_HIGH ? "high" : "medium",
      requiresReview: !best || best.confidence < THRESH_HIGH,
      alternatives: cands.slice(1, 3),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALCULATE REAL RECIPE COST — usa lotti reali FEFO (non costo statico)
// ═══════════════════════════════════════════════════════════════════════════════
function calculateRealRecipeCost(recipe, ingredients, goodsReceipts, traceRows = [], sede, vaschette = 1) {
  if (!recipe || !(recipe.ingredients||[]).length)
    return { totalCost:0, perKg:0, perVaschetta:0, lines:[], warnings:[], fullyCosted:true, resaTotale_g:0 };
  const warnings = [];
  const yieldG = Number(recipe.yield_g) > 0 ? Number(recipe.yield_g) : 1;
  const resaTotale_g = Math.round(vaschette * yieldG);
  const validReceipts = (goodsReceipts||[])
    .filter(r => r.accepted!==false && (!sede||r.sede===sede) && r.costPerGram>0)
    .sort((a,b) => {
      const vd = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "9999-12-31";
      const e = vd(a.expiryDate).localeCompare(vd(b.expiryDate));
      return e!==0 ? e : vd(a.date).localeCompare(vd(b.date));
    });
  const lines = (recipe.ingredients||[]).map(ri => {
    const ing = ingredients.find(i => i.id===ri.id);
    const qtyNeeded_g = Math.round((ri.q/yieldG)*resaTotale_g);
    let remaining_g = qtyNeeded_g, totalCostLine = 0;
    const lotDetail = [];
    for (const receipt of validReceipts.filter(r=>r.ingredientId===ri.id)) {
      if (remaining_g<=0) break;
      const { remaining_g: lotRem } = getReceiptRemainingQty(receipt, traceRows);
      if (lotRem<=0) continue;
      const alloc_g = Math.min(remaining_g, lotRem);
      totalCostLine += alloc_g * receipt.costPerGram;
      remaining_g -= alloc_g;
      lotDetail.push({ lotCode:receipt.lotCode||"—", qty_g:alloc_g, costPerGram:receipt.costPerGram, expiryDate:receipt.expiryDate||null });
    }
    if (remaining_g>0) {
      const fb = (ing?.cost||0)*remaining_g;
      totalCostLine += fb;
      warnings.push({ ingredientName:ing?.name||`ID ${ri.id}`, unresolved_g:remaining_g, message:`Usato prezzo statico per ${fmtStock(remaining_g)} di ${ing?.name||ri.id}` });
      lotDetail.push({ lotCode:"PREZZO-STATICO", qty_g:remaining_g, costPerGram:ing?.cost||0 });
    }
    return { ingredientId:ri.id, ingredientName:ing?.name||`ID ${ri.id}`, qty_g:qtyNeeded_g, cost:totalCostLine, lotDetail };
  });
  const totalCost = lines.reduce((s,l)=>s+l.cost,0);
  return { totalCost, perKg:resaTotale_g>0?(totalCost/resaTotale_g)*1000:0, perVaschetta:vaschette>0?totalCost/vaschette:totalCost, lines, warnings, fullyCosted:warnings.length===0, resaTotale_g };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATE PRODUCTION — verifica stock prima dello scarico
// ═══════════════════════════════════════════════════════════════════════════════
const PROD_STATUS = { OK:"OK", WARNING:"WARNING", ERROR:"ERROR" };

function getWeightedIngredientCostMetaForSede(ingredientId, ingredients, goodsReceipts = [], traceRows = [], sede) {
  const ing = (ingredients || []).find(i => i.id === ingredientId);
  const receipts = (goodsReceipts || [])
    .filter(r => r.accepted !== false && r.ingredientId === ingredientId && (!sede || r.sede === sede) && Number(r.costPerGram || 0) > 0);

  let totalQty = 0;
  let totalValue = 0;
  const supportingLots = [];

  for (const receipt of receipts) {
    const remaining_g = getReceiptRemainingQty(receipt, traceRows).remaining_g;
    if (remaining_g <= 0) continue;
    totalQty += remaining_g;
    totalValue += remaining_g * Number(receipt.costPerGram || 0);
    supportingLots.push({
      goodsReceiptId: receipt.id,
      lotCode: receipt.lotCode || "—",
      remaining_g,
      costPerGram: Number(receipt.costPerGram || 0),
      expiryDate: receipt.expiryDate || null,
      date: receipt.date || null,
    });
  }

  const weightedCost = totalQty > 0 ? totalValue / totalQty : Number(ing?.cost || 0);
  return {
    ingredientId,
    weightedCost,
    hasLotBackedCost: totalQty > 0,
    fallbackStaticCost: Number(ing?.cost || 0),
    remainingLotQty_g: totalQty,
    supportingLots,
  };
}

function getWeightedIngredientCostForSede(ingredientId, ingredients, goodsReceipts = [], traceRows = [], sede) {
  return getWeightedIngredientCostMetaForSede(ingredientId, ingredients, goodsReceipts, traceRows, sede).weightedCost;
}

function calcCostMPDetailedForSede(recipe, ingredients, goodsReceipts = [], traceRows = [], sede) {
  const missingIngredientIds = [];
  const lotBackedIngredientIds = [];
  const fallbackIngredientIds = [];
  const lines = [];

  const cost = (recipe?.ingredients ?? []).reduce((sum, ri) => {
    const ing = (ingredients || []).find(i => i.id === ri.id);
    if (!ing) {
      missingIngredientIds.push(ri.id);
      lines.push({
        ingredientId: ri.id,
        ingredientName: `ID ${ri.id}`,
        qty_g: Number(ri.q || 0),
        unitCost: 0,
        lineCost: 0,
        source: "missing",
      });
      return sum;
    }

    const meta = getWeightedIngredientCostMetaForSede(ri.id, ingredients, goodsReceipts, traceRows, sede);
    const unitCost = Number(meta.weightedCost || 0);
    const qty_g = Number(ri.q || 0);
    const lineCost = unitCost * qty_g;
    const source = meta.hasLotBackedCost ? "lot_weighted" : "static_fallback";

    if (meta.hasLotBackedCost) lotBackedIngredientIds.push(ri.id);
    else fallbackIngredientIds.push(ri.id);

    lines.push({
      ingredientId: ri.id,
      ingredientName: ing.name || `ID ${ri.id}`,
      qty_g,
      unitCost,
      lineCost,
      source,
      remainingLotQty_g: meta.remainingLotQty_g,
      supportingLots: meta.supportingLots,
    });

    return sum + lineCost;
  }, 0);

  return {
    cost,
    missingIngredientIds,
    lotBackedIngredientIds,
    fallbackIngredientIds,
    isComplete: missingIngredientIds.length === 0,
    lines,
  };
}

function validateProduction(pianoProduzione, allRecipes, ingredients, sede) {
  const errors=[], warnings=[], lines=[];
  const consumo = {};
  for (const [rid, vasch] of Object.entries(pianoProduzione)) {
    const v = Number(vasch)||0;
    if (v<=0) continue;
    const recipe = allRecipes.find(r=>String(r.id)===String(rid));
    if (!recipe) continue;
    if (recipe._isK2Static) {
      errors.push({
        type:"RECIPE_NOT_CONVERTED",
        recipeId: recipe.id,
        recipeName: recipe.name,
        message:`"${recipe.name}" è una ricetta DB/K2 non convertita: importala in Food Cost prima di contabilizzare produzione e magazzino.`,
      });
      continue;
    }
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
      errors.push({
        type:"RECIPE_NO_INGREDIENTS",
        recipeId: recipe.id,
        recipeName: recipe.name,
        message:`"${recipe.name}" non ha ingredienti collegati: impossibile calcolare scarico, costi e tracciabilità.`,
      });
      continue;
    }
    if (!recipe.active) { warnings.push({type:"RECIPE_INACTIVE",recipeName:recipe.name,message:`"${recipe.name}" non attiva.`}); continue; }
    const yieldG = Number(recipe.yield_g)>0?Number(recipe.yield_g):1;
    const resaTotale_g = v*yieldG;
    for (const ri of (recipe.ingredients||[])) {
      const ing = ingredients.find(i=>i.id===ri.id);
      if (!ing) { errors.push({type:"INGREDIENT_NOT_FOUND",recipeName:recipe.name,ingredientId:ri.id,message:`Ingrediente ID ${ri.id} non in anagrafica — "${recipe.name}" incompleta.`}); continue; }
      const needed_g = Math.round((ri.q/yieldG)*resaTotale_g);
      if (!consumo[ing.id]) consumo[ing.id]={ing,needed_g:0,recipes:[]};
      consumo[ing.id].needed_g+=needed_g;
      consumo[ing.id].recipes.push(recipe.name);
    }
  }
  for (const {ing,needed_g,recipes} of Object.values(consumo)) {
    if (ing.stockEnabled===false) continue;
    const available_g = ing.stockBySede?.[sede]?.currentStock_g??0;
    const min_g = ing.stockBySede?.[sede]?.minStock_g??0;
    const afterProd_g = available_g-needed_g;
    const line = {ingredientId:ing.id,ingredientName:ing.name,available_g,needed_g,afterProd_g,min_g,recipes:[...new Set(recipes)],status:PROD_STATUS.OK};
    if (available_g<needed_g) {
      line.status=PROD_STATUS.ERROR;
      errors.push({type:"STOCK_INSUFFICIENTE",ingredientName:ing.name,needed_g,available_g,deficit_g:needed_g-available_g,sede,message:`${ing.name}: serve ${fmtStock(needed_g)}, disponibile ${fmtStock(available_g)} → deficit ${fmtStock(needed_g-available_g)}`});
    } else if (afterProd_g<min_g) {
      line.status=PROD_STATUS.WARNING;
      warnings.push({type:"SOTTO_SCORTA_MINIMA",ingredientName:ing.name,afterProd_g,min_g,message:`${ing.name}: dopo produzione restano ${fmtStock(afterProd_g)}, sotto scorta minima (${fmtStock(min_g)}).`});
    }
    lines.push(line);
  }
  const status = errors.length?PROD_STATUS.ERROR:warnings.length?PROD_STATUS.WARNING:PROD_STATUS.OK;
  return {status,canProceed:!errors.length,errors,warnings,lines,summary:{totalIngredients:lines.length,criticalBlocks:errors.length,warningCount:warnings.length}};
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOOD COST — con allergeni, nutrizione, integrità cancellazione
// ═══════════════════════════════════════════════════════════════════════════════
function FoodCost({ recipes, setRecipes, ingredients, setIngredients, costiF, listino, reparto, sede, goodsReceipts = [], haccpTraceability = [], onGoTo }) {
  const [tab, setTab]         = useState("ricette");
  const [search, setSearch]   = useState("");
  const [catF, setCatF]       = useState("Tutti");
  const [modal, setModal]     = useState(null);
  const [editIng, setEditIng] = useState(null);
  const [editRec, setEditRec] = useState(null);
  const [simId, setSimId]     = useState(null); // inizializzato al primo render in useEffect
  const [simMode, setSimMode] = useState("porzione");
  const [simGrams, setSimGrams] = useState(costiF.porzione_default || 150);
  const [simPrice, setSimPrice] = useState("2.00");
  const [warnModal, setWarnModal] = useState(null); // { type:"ing"|"rec", item, deps }

  // Tutte le ricette: app + K2 statiche — memoizzato per evitare ricalcolo autoLink ad ogni render
  const recipesReparto = React.useMemo(() => {
    try {
      return getMergedRecipes(recipes.filter(r => r.active !== false), reparto, ingredients);
    } catch(e) {
      // fallback sicuro se autoLink crasha — mostra solo ricette app
      return recipes.filter(r => r.active !== false && r.repartoId === reparto);
    }
  }, [recipes, reparto, ingredients]);

  const CATS = React.useMemo(
    () => ["Tutti", ...new Set(recipesReparto.map(r => r.category))].filter(Boolean),
    [recipesReparto]
  );

  // Inizializza simId al primo recipe disponibile (DOPO recipesReparto)
  React.useEffect(() => {
    if (!recipesReparto.length) {
      if (simId !== null) setSimId(null);
      return;
    }
    const exists = recipesReparto.some(r => String(r.id) === String(simId));
    if (!exists) {
      setSimId(String(recipesReparto[0].id));
    }
  }, [recipesReparto, simId]);
  const filtRec = React.useMemo(() => recipesReparto.filter(r =>
    r.active !== false &&
    (catF === "Tutti" || r.category === catF) &&
    (r.name||"").toLowerCase().includes(search.toLowerCase())
  ), [recipesReparto, catF, search]);

  // Sim calcs — simulatore usa tutte le ricette del reparto
  const simRec   = recipesReparto.find(r => String(r.id) === String(simId)) || recipesReparto[0] || recipes[0];
  const simCostCtx = simRec ? calcCostMPDetailedForSede(simRec, ingredients, goodsReceipts, haccpTraceability, sede) : { cost:0, missingIngredientIds:[], fallbackIngredientIds:[], lotBackedIngredientIds:[] };
  const simCostMP = simCostCtx.cost || 0;
  const simCpg   = simRec?.yield_g > 0 ? simCostMP / simRec.yield_g : 0;
  const gSim     = simMode === "kg" ? 1000 : simGrams;
  const cMP      = simCpg * gSim;
  const cInd     = costoIndiretto(costiF, gSim);
  const cTot     = cMP + cInd;
  const price    = Number(simPrice) || 0;
  const mTot     = price - cTot;
  const fcMP_    = price > 0 ? (cMP / price) * 100 : 0;
  const fcC      = fcColor(fcMP_);
  const simUsesMixedCosts = (simCostCtx.fallbackIngredientIds || []).length > 0;

  function tryDeleteIngredient(ing) {
    const deps = findIngredientDependencies(ing.id, recipes);
    if (deps.length > 0) {
      setWarnModal({ type:"ing", item:ing, deps });
    } else {
      setIngredients(p => p.filter(x => x.id !== ing.id));
    }
  }

  function tryDeleteRecipe(rec) {
    if (rec?._isK2Static) return; // ricette DB non eliminabili
    const deps = findRecipeDependencies(rec.id, listino);
    setWarnModal({ type:"rec", item:rec, deps });
  }

  function confirmDeleteRecipe(rec) {
    setRecipes(p => p.filter(r => r.id !== rec.id));
    setWarnModal(null);
  }

  function archiveIngredient(ing) {
    setIngredients(p => p.map(i => i.id === ing.id ? { ...i, active:false } : i));
    setWarnModal(null);
  }

  function markRecipesForLabelReview(recipeIds = []) {
    if (!recipeIds.length) return;
    setRecipes(prev => prev.map(r => recipeIds.includes(r.id)
      ? normalizeRecipe({ ...r, labelNeedsReview:true, labelRevision: Number(r.labelRevision || 1) + 1, lastModifiedAt: new Date().toISOString(), labelApprovedVersion:null })
      : r
    ));
  }

  function handleIngredientSaveWithAlerts(ing) {
    const previous = ing?.id ? ingredients.find(i => i.id === ing.id) : null;
    const changedAllergens = !!previous && !areStringArraysEqual(previous.allergens || [], ing.allergens || []);
    const deps = changedAllergens ? findIngredientDependencies(ing.id, recipes) : [];
    if (ing.id) setIngredients(p => p.map(i => i.id===ing.id ? ing : i));
    else setIngredients(p => [...p, normalizeIngredient({ ...ing, id:Date.now() })]);
    if (deps.length > 0) {
      markRecipesForLabelReview(deps.map(r => r.id));
      window.alert(`Attenzione: hai modificato gli allergeni di ${ing.name}. Verifica e riapprova le etichette di ${deps.length} ricett${deps.length===1?'a':'e'}: ${deps.slice(0,6).map(r => r.name).join(', ')}${deps.length > 6 ? '…' : ''}`);
    }
  }

  // Importa una ricetta K2 statica come ricetta modificabile nell'app
  function importK2RecipeToApp(k2rec) {
    if (!k2rec?._isK2Static) return;
    // Controlla se esiste già una ricetta app con stesso nome
    const existing = recipes.find(r => r.name?.toLowerCase().trim() === k2rec.name?.toLowerCase().trim());
    if (existing) {
      window.alert(`"${k2rec.name}" esiste già in FoodCost. Modificala direttamente.`);
      return;
    }
    // Crea ricetta app partendo dai dati K2 (con ingredienti autoLinkati)
    const yieldG = Number(k2rec.yield_g) > 0 ? Number(k2rec.yield_g) : 3000;
    const newRec = normalizeRecipe({
      id: Date.now(),
      name: k2rec.name,
      category: k2rec.category,
      yield_g: yieldG,
      notes: `Importato dal Ricettario K2 — ${k2rec.notes || ""}`.trim(),
      ingredients: k2rec.ingredients || [],
      repartoId: k2rec.repartoId || reparto,
      labelNeedsReview: true,
    });
    setRecipes(prev => [...prev, newRec]);
    window.alert(`"${k2rec.name}" importata in FoodCost. Ora puoi aggiungere gli ingredienti e modificarla.`);
  }

  function handleRecipeSaveWithLabelReview(rec) {
    const timestamp = new Date().toISOString();
    const previous = rec.id ? recipes.find(r => r.id === rec.id) : null;
    const nextRevision = previous ? Number(previous.labelRevision || 1) + 1 : 1;
    const normalized = normalizeRecipe({ ...rec, lastModifiedAt: timestamp, labelNeedsReview:true, labelApprovedVersion:null, labelRevision: nextRevision });
    if (rec.id) setRecipes(p => p.map(r => r.id===rec.id ? normalized : r));
    else setRecipes(p => [...p, normalizeRecipe({ ...normalized, id:Date.now(), labelRevision:1 })]);
  }

  return (
    <div>
      <div style={{ display:"flex", gap:4, marginBottom:14, justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:4 }}>
          {[["ricette","Ricette"],["ingredienti","Ingredienti"],["simulatore","Simulatore"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding:"6px 14px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)" }}>{label}</button>
          ))}
        </div>
        <button onClick={() => onGoTo && onGoTo("ricettario")} style={{ padding:"5px 12px", fontSize:11, border:"1px solid #c8a96e44", borderRadius:4, background:"#c8a96e11", color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>📖 Ricettario ↗</button>
      </div>

      {/* ── TAB RICETTE ── */}
      {tab === "ricette" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <h2 style={{ margin:0, fontSize:16, fontWeight:"normal" }}>🌾 Archivio Ricette</h2>
              <RepartoBadge repartoId={reparto}/>
            </div>
            <button style={btnP} onClick={() => { setEditRec(null); setModal("newRec"); }}>+ Nuova</button>
          </div>
          <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
            <div style={{ position:"relative", flex:1, minWidth:130 }}>
              <span style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", color:"var(--k2-text-dim)", fontSize:12 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca…" style={{ ...inp, paddingLeft:28 }}/>
            </div>
            <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
              {CATS.map(c => <button key={c} onClick={() => setCatF(c)} style={{ padding:"4px 9px", fontSize:10, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:catF===c?"#c8a96e":"transparent", color:catF===c?"var(--k2-bg)":"var(--k2-text-muted)" }}>{c}</button>)}
            </div>
          </div>

          {filtRec.map(recipe => {
            const staticCostCtx = calcCostMPDetailed(recipe, ingredients);
            const weightedCostCtx = calcCostMPDetailedForSede(recipe, ingredients, goodsReceipts, haccpTraceability, sede);
            const missingIds = weightedCostCtx.missingIngredientIds;
            const costMP = weightedCostCtx.cost;
            const staticCostMP = staticCostCtx.cost;
            const deltaOperational = costMP - staticCostMP;
            const cpg     = recipe.yield_g > 0 ? costMP / recipe.yield_g : 0;
            const pD      = costiF.porzione_default || 150;
            const cpp     = cpg * pD;
            const ind     = costoIndiretto(costiF, pD);
            const cTotR   = cpp + ind;
            const sp      = cTotR * (costiF.markup_default || 3.5);
            const fcMP__  = sp > 0 ? (cpp / sp) * 100 : 0;
            const fcR     = fcColor(fcMP__);
            const allergens = getRecipeAllergensStrict(recipe, recipesReparto, ingredients);
            const nutr    = calcRecipeNutrition(recipe, ingredients);
            const hasIncomplete = missingIds && missingIds.length > 0;
            const fallbackIds = weightedCostCtx.fallbackIngredientIds || [];
            const hasStaticFallback = fallbackIds.length > 0;
            const hasLotBacked = (weightedCostCtx.lotBackedIngredientIds || []).length > 0;

            return (
              <div key={recipe.id} style={card}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2, flexWrap:"wrap" }}>
                      <span style={{ fontSize:15, color:"#c8a96e" }}>{recipe.name}</span>
                      <RepartoBadge repartoId={recipe.repartoId} small/>
                      {recipe._isK2Static && <span style={{ fontSize:9, background:"var(--k2-bg-input)", color:"var(--k2-text-dim)", border:"1px solid var(--k2-border)", borderRadius:8, padding:"2px 7px" }}>DB</span>}
                      {!recipe._isK2Static && recipe.labelNeedsReview && <span style={{ fontSize:9, color:"#fbbf24", background:"rgba(251,191,36,0.12)", border:"1px solid #fbbf2444", borderRadius:10, padding:"2px 8px" }}>Etichetta da rivedere</span>}
                      {hasLotBacked && <span title={`Costo operativo sede ${sede} basato su lotti residui`} style={{ fontSize:9, background:"rgba(96,165,250,0.14)", color:"#60a5fa", border:"1px solid #60a5fa44", borderRadius:10, padding:"2px 8px" }}>Costo reale</span>}
                      {hasStaticFallback && <span title={`Questi ingredienti usano ancora il costo statico: ID ${fallbackIds.join(", ")}`} style={{ fontSize:9, background:"rgba(251,191,36,0.15)", color:"#fbbf24", border:"1px solid #fbbf2444", borderRadius:10, padding:"2px 8px" }}>Fallback statico</span>}
                      {hasIncomplete && <span title={`Ingredienti non in anagrafica: ID ${missingIds.join(", ")}`} style={{ fontSize:9, background:"rgba(248,113,113,0.15)", color:"#f87171", border:"1px solid #f8717144", borderRadius:10, padding:"2px 8px" }}>FC incompleto</span>}
                    </div>
                    <div style={{ fontSize:9, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{recipe.category} · {fmt(recipe.yield_g/1000,1)} kg</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:18, fontWeight:"bold" }}>{fmtE(costMP)}</div>
                    <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>materie prime operative · {sede}</div>
                    {Math.abs(deltaOperational) > 0.001 && (
                      <div style={{ fontSize:9, color: deltaOperational >= 0 ? "#fbbf24" : "#4ade80", marginTop:2 }}>
                        Δ vs statico {deltaOperational >= 0 ? "+" : ""}{fmtE(deltaOperational)}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:5, marginBottom:8 }}>
                  {[
                    ["FC MP "+fmt(fcMP__,1)+"%", fmtE(cpp), fcR.color],
                    ["Costo tot. "+pD+"g",        fmtE(cTotR), "#c8a96e"],
                    ["Margine",                   fmtE(sp-cTotR), sp-cTotR>=0?"#4ade80":"#f87171"],
                    ["kcal/100g resa",                fmt(nutr.kcal,0)+" kcal", "#a78bfa"],
                  ].map(([l, v, c]) => (
                    <div key={l} style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:4, padding:"6px", textAlign:"center" }}>
                      <div style={{ fontSize:12, fontWeight:"bold", color:c }}>{v}</div>
                      <div style={{ fontSize:8, color:"var(--k2-text-dim)", marginTop:1 }}>{l}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:8, color:"var(--k2-text-dim)" }}>🌾 FC MATERIE PRIME</span>
                    <span style={{ fontSize:10, fontWeight:"bold", color:fcR.color, fontFamily:"monospace" }}>{fmt(fcMP__,1)}%</span>
                  </div>
                  <div style={{ background:"var(--k2-bg-input)", height:4, borderRadius:2, overflow:"hidden" }}><div style={{ width:`${Math.min(fcMP__,100)}%`, height:"100%", background:fcR.color }}/></div>
                  <div style={{ fontSize:8, color:fcR.color, marginTop:2 }}>{fcR.label} · benchmark settore</div>
                </div>

                {/* Allergeni */}
                {allergens.length > 0 && (
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:8, color:"var(--k2-text-dim)", letterSpacing:"0.08em", marginBottom:4 }}>ALLERGENI</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                      {allergens.map(a => <AllergenBadge key={a} allergen={a}/>)}
                    </div>
                  </div>
                )}

                {recipe.notes && <div style={{ fontSize:11, color:"var(--k2-text-dim)", fontStyle:"italic", marginBottom:8 }}>{recipe.notes}</div>}

                {/* Warning ingredienti senza costo — non bloccante */}
                {!recipe._isK2Static && (recipe.ingredients||[]).some(ri => { const ing = ingredients.find(i => i.id === ri.id); return ing && ing.cost === 0; }) && (
                  <div style={{ fontSize:10, color:"#fbbf24", background:"rgba(251,191,36,0.07)", border:"1px solid #fbbf2430", borderRadius:4, padding:"5px 8px", marginBottom:8 }}>
                    ⚠ Ingrediente senza costo — food cost non attendibile
                  </div>
                )}
                {!recipe._isK2Static && hasStaticFallback && (
                  <div style={{ fontSize:10, color:"#60a5fa", background:"rgba(96,165,250,0.07)", border:"1px solid #60a5fa30", borderRadius:4, padding:"5px 8px", marginBottom:8 }}>
                    ℹ️ Costo operativo misto: alcuni ingredienti usano i lotti residui della sede {sede}, altri il costo statico anagrafico.
                  </div>
                )}

                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  <button style={btnS} onClick={() => { setSimId(String(recipe.id)); setTab("simulatore"); }}>📊 Simula</button>
                  {!recipe._isK2Static && (
                    <>
                      <button style={btnS} onClick={() => { setEditRec(recipe); setModal("editRec"); }}>✏️ Modifica</button>
                      <button style={btnD} onClick={() => tryDeleteRecipe(recipe)}>🗑️ Elimina</button>
                    </>
                  )}
                  {recipe._isK2Static && (
                    <button style={{ ...btnS, color:"#c8a96e", borderColor:"#c8a96e44" }}
                      onClick={() => importK2RecipeToApp(recipe)}
                      title="Crea copia modificabile in FoodCost">
                      ⬆ Importa e personalizza
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB INGREDIENTI ── */}
      {tab === "ingredienti" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <h2 style={{ margin:0, fontSize:16, fontWeight:"normal" }}>Ingredienti & Prezzi</h2>
            <button style={btnP} onClick={() => { setEditIng(null); setModal("newIng"); }}>+ Aggiungi</button>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:"1px solid var(--k2-border)" }}>
                {["Ingrediente","Categoria","Allergeni","€/100g","Ult. aggiornamento",""].map((h, i) => (
                  <th key={h} style={{ padding:"6px 10px", fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", textAlign:i===5?"right":"left", fontWeight:"normal" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ingredients.filter(i => i.active !== false).map((ing, i) => (
                <tr key={ing.id} style={{ borderBottom:"1px solid var(--k2-border)", background:i%2===0?"transparent":"var(--k2-bg-deep)" }}>
                  <td style={{ padding:"8px 10px", fontSize:13, color:"var(--k2-text-secondary)" }}>{ing.name}</td>
                  <td style={{ padding:"8px 10px", fontSize:11, color:"var(--k2-text-dim)" }}>{ing.category}</td>
                  <td style={{ padding:"8px 10px" }}>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                      {(ing.allergens || []).slice(0,2).map(a => <AllergenBadge key={a} allergen={a}/>)}
                      {(ing.allergens || []).length > 2 && <span style={{ fontSize:9, color:"var(--k2-text-dim)" }}>+{ing.allergens.length-2}</span>}
                    </div>
                  </td>
                  <td style={{ padding:"8px 10px", fontSize:13, color:"#c8a96e", fontWeight:"bold" }}>{fmtE(ing.cost*100)}</td>
                  <td style={{ padding:"8px 10px", fontSize:11, color:"var(--k2-text-dim)" }}>{ing.lastPriceUpdate ? formatDateIT(ing.lastPriceUpdate) : "—"}</td>
                  <td style={{ padding:"8px 10px", textAlign:"right" }}>
                    <button onClick={() => { setEditIng(ing); setModal("editIng"); }} style={{ background:"transparent", border:"none", color:"var(--k2-text-muted)", cursor:"pointer", padding:3 }}>✏️</button>
                    <button onClick={() => tryDeleteIngredient(ing)} style={{ background:"transparent", border:"none", color:"#f87171", cursor:"pointer", padding:3, marginLeft:4 }}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB SIMULATORE ── */}
      {tab === "simulatore" && (
        <div style={{ maxWidth:700 }}>
          <h2 style={{ margin:"0 0 14px", fontSize:16, fontWeight:"normal" }}>Simulatore Prezzi</h2>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:12, marginBottom:14 }}>
              <div><label style={lbl}>Ricetta</label><select value={simId} onChange={e => setSimId(e.target.value)} style={inp}>{recipesReparto.map(r => <option key={r.id} value={r.id}>{r.name}{r._isK2Static?" (DB)":""}</option>)}</select></div>
              <div><label style={lbl}>Modalità</label><div style={{ display:"flex", gap:3, marginTop:4 }}>{[["porzione","Porz."],["kg","Kg"],["custom","Custom"]].map(([m,l]) => <button key={m} onClick={() => setSimMode(m)} style={{ flex:1, padding:"5px 4px", fontSize:10, border:"none", cursor:"pointer", borderRadius:3, fontFamily:"inherit", background:simMode===m?"#c8a96e":"var(--k2-bg-input)", color:simMode===m?"var(--k2-bg)":"var(--k2-text-dim)" }}>{l}</button>)}</div></div>
            </div>
            {simMode !== "kg" && (
              <div style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}><label style={lbl}>Grammi</label><span style={{ fontSize:17, fontWeight:"bold", color:"#c8a96e", fontFamily:"monospace" }}>{simGrams}g</span></div>
                {simMode === "porzione" && <div style={{ display:"flex", gap:4, marginBottom:6 }}>{[100,120,150,180,200].map(g => <button key={g} onClick={() => setSimGrams(g)} style={{ flex:1, padding:"4px 2px", fontSize:10, cursor:"pointer", borderRadius:3, fontFamily:"inherit", background:simGrams===g?"#c8a96e":"var(--k2-bg-input)", color:simGrams===g?"var(--k2-bg)":"var(--k2-text-dim)", border:simGrams===g?"none":"1px solid var(--k2-border)" }}>{g}g</button>)}</div>}
                <input type="range" min={simMode==="porzione"?80:10} max={simMode==="porzione"?300:1000} step={5} value={simGrams} onChange={e => setSimGrams(Number(e.target.value))} style={sliderBg(simGrams, simMode==="porzione"?80:10, simMode==="porzione"?300:1000)}/>
              </div>
            )}
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}><label style={lbl}>Prezzo vendita</label><span style={{ fontSize:17, fontWeight:"bold", color:"#c8a96e", fontFamily:"monospace" }}>€ {fmt(Number(simPrice||0))}</span></div>
              <div style={{ display:"flex", gap:4, marginBottom:6 }}>{(simMode==="kg"?[10,15,20,25,30,40]:[1.5,2.0,2.5,3.0,3.5]).map(p => <button key={p} onClick={() => setSimPrice(String(p))} style={{ flex:1, padding:"4px 2px", fontSize:10, cursor:"pointer", borderRadius:3, fontFamily:"inherit", background:Number(simPrice)===p?"#c8a96e":"var(--k2-bg-input)", color:Number(simPrice)===p?"var(--k2-bg)":"var(--k2-text-dim)", border:Number(simPrice)===p?"none":"1px solid var(--k2-border)" }}>€{p.toFixed(simMode==="kg"?0:2).replace(".",",")}</button>)}</div>
              <input type="range" min={simMode==="kg"?4:0.5} max={simMode==="kg"?40:6} step={0.1} value={simPrice||2} onChange={e => setSimPrice(e.target.value)} style={sliderBg(Number(simPrice||2), simMode==="kg"?4:0.5, simMode==="kg"?40:6)}/>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <div style={{ ...card, marginBottom:0, borderColor:fcC.color+"44", background:fcC.bg, textAlign:"center" }}>
              <div style={{ fontSize:8, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>🌾 FC Materie Prime</div>
              <div style={{ fontSize:28, fontWeight:"bold", color:fcC.color, fontFamily:"monospace" }}>{price>0?fmt(fcMP_,1)+"%":"—"}</div>
              <div style={{ fontSize:9, color:fcC.color, marginBottom:6 }}>{fcC.label}</div>
              <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:4, padding:"5px" }}><div style={{ fontSize:12, color:"var(--k2-text)" }}>{fmtE(cMP)}</div><div style={{ fontSize:8, color:"var(--k2-text-dim)" }}>Costo MP</div></div>
            </div>
            <div style={{ ...card, marginBottom:0, borderColor:"#c8a96e44", background:"rgba(200,169,110,0.05)", textAlign:"center" }}>
              <div style={{ fontSize:8, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>💰 Costo Totale</div>
              <div style={{ fontSize:28, fontWeight:"bold", color:"#c8a96e", fontFamily:"monospace" }}>{fmtE(cTot)}</div>
              <div style={{ fontSize:9, color:"var(--k2-text-muted)", marginBottom:6 }}>MP+fissi+pack</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:4, padding:"4px", textAlign:"center" }}><div style={{ fontSize:10, color:"#c8a96e" }}>{fmtE(cMP)}</div><div style={{ fontSize:7, color:"var(--k2-text-dim)" }}>MP</div></div>
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:4, padding:"4px", textAlign:"center" }}><div style={{ fontSize:10, color:"#c8a96e" }}>{fmtE(cInd)}</div><div style={{ fontSize:7, color:"var(--k2-text-dim)" }}>Fissi</div></div>
              </div>
            </div>
            <div style={{ ...card, marginBottom:0, borderColor:(mTot>=0?"#4ade80":"#f87171")+"44", background:mTot>=0?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)", textAlign:"center" }}>
              <div style={{ fontSize:8, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>📈 Margine Operativo</div>
              <div style={{ fontSize:28, fontWeight:"bold", color:mTot>=0?"#4ade80":"#f87171", fontFamily:"monospace" }}>{price>0?(mTot>=0?"+":"")+fmtE(mTot):"—"}</div>
              <div style={{ fontSize:9, color:mTot>=0?"#4ade80":"#f87171", marginBottom:6 }}>{mTot>=0?"Guadagno":"Sotto costo"}</div>
              <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:4, padding:"5px" }}><div style={{ fontSize:11, color:"var(--k2-text)" }}>{price>0?fmtE(mTot*costiF.porzioni_mensili)+"/mese":"—"}</div><div style={{ fontSize:7, color:"var(--k2-text-dim)" }}>Su {(costiF.porzioni_mensili||0).toLocaleString("it")} porz.</div></div>
            </div>
          </div>
          {/* Allergeni ricetta selezionata */}
          {simRec && (
            <div style={{ ...card, marginBottom:0 }}>
              <div style={{ fontSize:10, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Allergeni — {simRec.name}</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {getRecipeAllergensStrict(simRec, recipesReparto, ingredients).map(a => <AllergenBadge key={a} allergen={a}/>)}
                {getRecipeAllergensStrict(simRec, recipesReparto, ingredients).length === 0 && <span style={{ fontSize:11, color:"#4ade80" }}>✓ Nessun allergene dichiarato</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modali */}
      {(modal === "newIng" || modal === "editIng") && (
        <Modal title={modal==="editIng"?"Modifica ingrediente":"Nuovo ingrediente"} onClose={() => setModal(null)} maxWidth={640}>
          <IngForm
            initial={modal==="editIng" ? editIng : null}
            onSave={ing => {
              handleIngredientSaveWithAlerts(ing);
              setModal(null);
            }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {(modal === "newRec" || modal === "editRec") && (
        <Modal title={modal==="editRec"?"Modifica ricetta":"Nuova ricetta"} onClose={() => setModal(null)} maxWidth={580}>
          <RecipeForm
            initial={modal==="editRec" ? editRec : null}
            ingredients={ingredients}
            allRecipes={recipesReparto}
            defaultReparto={reparto}
            onSave={rec => {
              handleRecipeSaveWithLabelReview(rec);
              setModal(null);
            }}
            onCancel={() => setModal(null)}
            onAddIngredient={newIng => {
              setIngredients(p => [...p, newIng]);
            }}
          />
        </Modal>
      )}

      {/* Modal warning dipendenze */}
      {warnModal && (
        <Modal title="⚠️ Attenzione — dipendenze" onClose={() => setWarnModal(null)}>
          {warnModal.type === "ing" && (
            <div>
              <p style={{ fontSize:13, color:"var(--k2-text)", marginBottom:10 }}>
                L'ingrediente <strong style={{ color:"#c8a96e" }}>{warnModal.item.name}</strong> è usato in {warnModal.deps.length} ricett{warnModal.deps.length===1?"a":"e"}:
              </p>
              <div style={{ marginBottom:14 }}>
                {warnModal.deps.map(r => <div key={r.id} style={{ fontSize:12, color:"#fbbf24", padding:"3px 0" }}>· {r.name}</div>)}
              </div>
              <p style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:14 }}>Non puoi eliminare un ingrediente usato in ricette attive. Puoi archiviarlo: sparisce dalla lista ma le ricette non vengono toccate.</p>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => setWarnModal(null)} style={btnS}>Annulla</button>
                <button onClick={() => archiveIngredient(warnModal.item)} style={btnWarn}>📦 Archivia</button>
              </div>
            </div>
          )}
          {warnModal.type === "rec" && (
            <div>
              <p style={{ fontSize:13, color:"var(--k2-text)", marginBottom:10 }}>
                Stai eliminando <strong style={{ color:"#c8a96e" }}>{warnModal.item.name}</strong>.
              </p>
              {warnModal.deps.length > 0 && (
                <p style={{ fontSize:12, color:"#fbbf24", marginBottom:10 }}>
                  Questa ricetta è presente nel listino di: {warnModal.deps.join(", ")}. Verrà rimossa anche dal listino.
                </p>
              )}
              <p style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:14 }}>L'eliminazione è permanente e non può essere annullata.</p>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => setWarnModal(null)} style={btnS}>Annulla</button>
                <button onClick={() => confirmDeleteRecipe(warnModal.item)} style={btnD}>🗑️ Elimina definitivamente</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUZIONE — con lotto, TMC, etichetta rapida + integrazione magazzino
// ═══════════════════════════════════════════════════════════════════════════════
function Produzione({ recipes, ingredients, setIngredients, sede, movimenti, setMovimenti, productionLog = [], setProductionLog = null, reparto, goodsReceipts = [], setGoodsReceipts = null, haccpTraceability = [], setHaccpTraceability = null, onGoTo, currentUserRole = "admin", currentUserName = "" }) {
  const [dataP, setDataP] = useState(today());
  const [piano, setPiano] = useState({});
  const [tab, setTab]     = useState("piano");
  const [lotto, setLotto] = useState(() => getNextProductionLot({ sede, dateIso: today(), productionLog }));
  const [magMsg, setMagMsg] = useState(null); // null | { type:"ok"|"err"|"warn", text }
  const [productionLock, setProductionLock] = useState(false);
  const [pesoOverrideMap, setPesoOverrideMap] = useState({});

  // Ricette: app + K2 statiche — memoizzato per evitare ricalcolo autoLink ad ogni render
  const recipesReparto = React.useMemo(() => {
    try {
      return getMergedRecipes(recipes.filter(r => r.active !== false), reparto, ingredients);
    } catch(e) {
      return recipes.filter(r => r.active !== false && r.repartoId === reparto);
    }
  }, [recipes, reparto, ingredients]);

  const [overrideModal, setOverrideModal] = useState(null); // null | { insufficienti, consumo, key }

  function getPlannedYieldG(recipe) {
    const overridden = Number(pesoOverrideMap[String(recipe?.id)] || 0);
    if (overridden > 0) return overridden;
    const base = Number(recipe?.yield_g || 0);
    return base > 0 ? base : 1;
  }

  // ── Guard anti-doppio-scarico ─────────────────────────────────────────────
  function prodKey() { return buildProductionSessionKey(sede, dataP, lotto); }
  function isAlreadyContabilizzata() {
    return productionLog.some(r => r.sessionKey === prodKey())
      || movimenti.some(m => m.tipo === "produzione" && (m.note || "").startsWith(prodKey()));
  }

  useEffect(() => {
    if (!isAlreadyContabilizzata()) {
      setLotto(prev => {
        if (prev && !/^PROD-\d{8}(?:-[A-Z0-9]+)?$/.test(prev)) return prev;
        return getNextProductionLot({ sede, dateIso: dataP, productionLog });
      });
    }
  }, [dataP, sede, productionLog]);

  function buildAutoTraceabilityRows(ricettePianificate) {
    if (!Array.isArray(ricettePianificate) || ricettePianificate.length === 0) return [];

    const acceptedReceipts = [...goodsReceipts]
      .filter(r => r.accepted !== false && r.sede === sede)
      .sort((a, b) => {
        const expCmp = String(a.expiryDate || "9999-12-31").localeCompare(String(b.expiryDate || "9999-12-31"));
        if (expCmp !== 0) return expCmp;
        return String(a.date || "9999-12-31").localeCompare(String(b.date || "9999-12-31"));
      });

    const traceRowsExcludingCurrentLot = haccpTraceability.filter(
      row => !(row.productionLot === lotto && row.sede === sede && row.date === dataP)
    );
    const pendingUsageByReceipt = new Map();
    const getRemainingQtyForReceipt = (receipt) => {
      const persistedRemaining = getReceiptRemainingQty(receipt, traceRowsExcludingCurrentLot).remaining_g;
      const pendingUsage = pendingUsageByReceipt.get(receipt.id) || 0;
      return Math.max(0, persistedRemaining - pendingUsage);
    };

    return ricettePianificate.map(({ r, vasch }) => {
      const yieldG = getPlannedYieldG(r);
      const resaTotale_g = Math.round(vasch * yieldG);
      const noteParts = [
        "Auto-generata da Produzione.",
        "Allocazione FEFO rigorosa su lotti ingredienti basata su scadenza/data dei ricevimenti accettati.",
      ];
      const allocationIssues = [];
      const ingredientLots = [];

      for (const ri of (r.ingredients || [])) {
        const ing = ingredients.find(i => i.id === ri.id);
        let qtyRemaining_g = Math.round((ri.q / yieldG) * resaTotale_g);
        const receiptsForIngredient = acceptedReceipts.filter(receipt => receipt.ingredientId === ri.id);

        for (const receipt of receiptsForIngredient) {
          if (qtyRemaining_g <= 0) break;
          const remainingQty_g = getRemainingQtyForReceipt(receipt);
          if (remainingQty_g <= 0) continue;

          const alloc_g = Math.min(qtyRemaining_g, remainingQty_g);
          ingredientLots.push({
            ingredientId: ri.id,
            ingredientName: ing?.name || `Ingrediente ${ri.id}`,
            goodsReceiptId: receipt.id,
            lotCode: receipt.lotCode || ing?.lastLotCode || "DA-VERIFICARE",
            qtyUsed_g: alloc_g,
            sourceType: "receipt_fefo",
            costPerGram: receipt.costPerGram || null,
            sourceDetail: `Lotto ${receipt.lotCode || "—"} · ricevuto ${receipt.date || "—"}${receipt.expiryDate ? ` · scad. ${receipt.expiryDate}` : ""}`,
          });
          pendingUsageByReceipt.set(receipt.id, (pendingUsageByReceipt.get(receipt.id) || 0) + alloc_g);
          qtyRemaining_g -= alloc_g;
        }

        if (qtyRemaining_g > 0) {
          allocationIssues.push({
            type: "LOT_COVERAGE_INSUFFICIENT",
            ingredientId: ri.id,
            ingredientName: ing?.name || `Ingrediente ${ri.id}`,
            unresolved_g: qtyRemaining_g,
            message: `${ing?.name || `Ingrediente ${ri.id}`}: mancano ${fmtStock(qtyRemaining_g)} coperti da lotti FEFO per la sede ${sede}.`,
          });
        }
      }

      if (allocationIssues.length > 0) {
        noteParts.push("Produzione bloccata: copertura lotti insufficiente.");
      }

      return {
        ...normalizeTraceability({
          date: dataP,
          sede,
          productionLot: lotto,
          recipeId: r.id,
          recipeName: r.name,
          ingredientLots,
          outputQty_g: resaTotale_g,
          note: noteParts.join(" "),
        }),
        _allocationIssues: allocationIssues,
      };
    });
  }

  function saveAutoTraceability(ricettePianificate, prebuiltRows = null) {
    if (typeof setHaccpTraceability !== "function") return { saved:false, rows:[], hasManualCheck:false };
    const rows = Array.isArray(prebuiltRows) ? prebuiltRows : buildAutoTraceabilityRows(ricettePianificate);
    if (rows.length === 0) return { saved:false, rows:[], hasManualCheck:false };
    const cleanRows = rows.map(({ _allocationIssues, ...row }) => row);

    setHaccpTraceability(prev => {
      const filteredPrev = prev.filter(row => !(row.productionLot === lotto && row.sede === sede && row.date === dataP));
      return [...cleanRows, ...filteredPrev].slice(0, MAX_TRACE_ROWS);
    });
    return { saved:true, rows:cleanRows, hasManualCheck:false };
  }

  // ── Contabilizza scarico magazzino ────────────────────────────────────────
  function contabilizzaMagazzino() {
    setMagMsg(null);
    if (!canUserPerform(currentUserRole, "runProduction")) {
      setMagMsg({ type:"err", text:"Permesso negato: il profilo corrente non può contabilizzare produzioni." });
      return;
    }
    if (productionLock) return;
    if (!lotto.trim()) {
      setMagMsg({ type:"err", text:"Inserisci un lotto produzione valido prima di contabilizzare." });
      return;
    }

    const ricettePianificate = Object.entries(piano)
      .filter(([, v]) => Number(v) > 0)
      .map(([rid, v]) => ({ r: recipesReparto.find(r => String(r.id) === String(rid)), vasch: Number(v) }))
      .filter(x => x.r);

    if (ricettePianificate.length === 0) {
      setMagMsg({ type:"warn", text:"Nessuna ricetta nel piano di produzione." });
      return;
    }
    const semilavoratiInvalidi = ricettePianificate.filter(({ r }) => r?.isSemiFinished && !ingredients.some(i => i.id === r.producedIngredientId));
    if (semilavoratiInvalidi.length > 0) {
      setMagMsg({ type:"err", text:`Produzione bloccata: collega un ingrediente di stock ai semilavorati ${semilavoratiInvalidi.map(x => x.r.name).join(", ")}.` });
      return;
    }

    if (isAlreadyContabilizzata()) {
      setMagMsg({ type:"warn", text:`Produzione già contabilizzata — Lotto ${lotto} · ${formatDateIT(dataP)} · ${sede}` });
      return;
    }

    // ── Validazione pre-scarico con validateProduction ───────────────────────
    const pianoFiltered = Object.fromEntries(
      ricettePianificate.map(({ r, vasch }) => [String(r.id), vasch])
    );
    const validation = validateProduction(pianoFiltered, recipesReparto, ingredients, sede);
    if (!validation.canProceed) {
      const errMsg = validation.errors.map(e => e.message).join("\n");
      setMagMsg({ type:"err", text:`Produzione bloccata — correggi prima di procedere:
${errMsg}` });
      setOverrideModal(null);
      return;
    }

    // Calcola consumo totale per ingrediente
    const consumo = {}; // ingId → { ing, quantita_g }
    for (const { r, vasch } of ricettePianificate) {
      const yieldG = getPlannedYieldG(r);
      const resaTotale_g = vasch * yieldG;
      for (const ri of r.ingredients) {
        const ing = ingredients.find(i => i.id === ri.id);
        if (!ing) continue;
        if (!consumo[ing.id]) consumo[ing.id] = { ing, quantita_g: 0 };
        consumo[ing.id].quantita_g += (ri.q / yieldG) * resaTotale_g;
      }
    }

    // Warning scorte minime (non bloccante)
    if (validation.warnings.length > 0) {
      const warnMsg = validation.warnings.map(w => w.message).join(" · ");
      setMagMsg({ type:"warn", text:`Attenzione: ${warnMsg}` });
    }

    const tracePreviewRows = buildAutoTraceabilityRows(ricettePianificate);
    const allocationIssues = tracePreviewRows.flatMap(row => row._allocationIssues || []);
    if (allocationIssues.length > 0) {
      const issueMsg = allocationIssues.map(issue => issue.message).join("\n");
      setMagMsg({
        type:"err",
        text:`Produzione bloccata — copertura lotti insufficiente per ${sede}:
${issueMsg}

Registra i ricevimenti mancanti o correggi i lotti prima di scaricare il magazzino.`,
      });
      setOverrideModal(null);
      return;
    }

    _applicaScarico(consumo, prodKey(), ricettePianificate, tracePreviewRows);
  }

  // ── Scarico effettivo — chiamato direttamente o dopo override utente ──────
  function _applicaScarico(consumo, key, ricettePianificate = [], tracePreviewRows = null) {
    if (productionLock) return;
    setProductionLock(true);
    try {
      const nuoviMovimenti = [];
      const semiOutputs = {};
      ricettePianificate.forEach(({ r, vasch }) => {
        if (r?.isSemiFinished && r?.producedIngredientId) {
          const yieldG = getPlannedYieldG(r);
          semiOutputs[r.producedIngredientId] = (semiOutputs[r.producedIngredientId] || 0) + Math.round(vasch * yieldG);
        }
      });
      const nextIngredients = ingredients.map(ing => {
        const c = consumo[ing.id];
        const semiOut_g = semiOutputs[ing.id] || 0;
        let nextIng = ing;
        if (c) {
          const { updatedIngredient, movimento } = applyIngredientStockChange({
            ingredient: nextIng,
            sede,
            delta_g: -Math.round(c.quantita_g),
            movementType: "produzione",
            causale: `Scarico produzione — Lotto ${lotto}`,
            date: dataP,
            note: key,
            repartoId: reparto,
            unit: "g",
          });
          nuoviMovimenti.push(movimento);
          nextIng = updatedIngredient;
        }
        if (semiOut_g > 0) {
          const { updatedIngredient, movimento } = applyIngredientStockChange({
            ingredient: nextIng,
            sede,
            delta_g: semiOut_g,
            movementType: "carico",
            causale: `Produzione semilavorato — Lotto ${lotto}`,
            date: dataP,
            note: `${key} · ${currentUserName || ""}`.trim(),
            repartoId: reparto,
            unit: "g",
            lotCode: lotto,
          });
          nuoviMovimenti.push(movimento);
          nextIng = updatedIngredient;
        }
        return nextIng;
      });

      setIngredients(nextIngredients);
      setMovimenti(prev => [...nuoviMovimenti, ...prev].slice(0, MAX_MOVIMENTI));

      if (typeof setGoodsReceipts === "function" && ricettePianificate.length > 0) {
        const internalReceipts = [];
        ricettePianificate.forEach(({ r, vasch }) => {
          if (!(r?.isSemiFinished && r?.producedIngredientId)) return;
          const outputQty_g = Math.round(vasch * getPlannedYieldG(r));
          if (outputQty_g <= 0) return;
          const costCtx = calcCostMPDetailedForSede(r, ingredients, goodsReceipts, haccpTraceability, sede);
          const totalCost = Number(costCtx?.cost || 0);
          const shelfLifeDays = Math.max(1, Number(r?.semiFinishedShelfLifeDays || 3));
          internalReceipts.push(normalizeGoodsReceipt({
            date: dataP,
            sede,
            supplierId: null,
            ingredientId: r.producedIngredientId,
            ingredientName: ingredients.find(i => i.id === r.producedIngredientId)?.name || r.name,
            lotCode: lotto,
            supplierLotCode: `INT-${lotto}`,
            qtyReceived_g: outputQty_g,
            packageQty: outputQty_g,
            packageUnit: "g",
            unitPurchasePrice: 0,
            totalCost,
            expiryDate: shiftISODate(dataP, shelfLifeDays),
            tempOnArrival_c: null,
            packagingOk: true,
            labelOk: true,
            docsOk: true,
            accepted: true,
            rejectionReason: "",
            operator: currentUserName || "",
            note: `Semilavorato interno da produzione: ${r.name}`,
            linkedMovimentoId: null,
            costPerGram: outputQty_g > 0 ? totalCost / outputQty_g : 0,
          }));
        });
        if (internalReceipts.length > 0) {
          setGoodsReceipts(prev => [...internalReceipts, ...prev].slice(0, MAX_TRACE_ROWS));
        }
      }

      // Warning ingredienti portati a zero dallo scarico (fix: usa stockBySede corretto)
      const azzerati = nextIngredients.filter(ing => {
        const c = consumo[ing.id];
        if (!c) return false;
        return (ing.stockBySede?.[sede]?.currentStock_g ?? 0) === 0;
      });
      if (azzerati.length > 0) {
        const nomi = azzerati.map(i => i.name).join(", ");
        setTimeout(() => window.alert(`⚠ Stock esaurito dopo scarico:\n${nomi}\n\nVerifica le scorte in Magazzino.`), 100);
      }
      if (typeof setProductionLog === "function") {
        setProductionLog(prev => [
          normalizeProductionLogEntry({
            sessionKey: key,
            sede,
            repartoId: reparto,
            date: dataP,
            lotto,
            totalRecipes: ricettePianificate.length,
            totalIngredients: nuoviMovimenti.length,
          }),
          ...prev,
        ].slice(0, MAX_TRACE_ROWS));
      }
      saveAutoTraceability(ricettePianificate, tracePreviewRows);
      setMagMsg({
        type: "ok",
        text: `✓ Magazzino aggiornato — ${nuoviMovimenti.length} movimenti registrati · Lotto ${lotto}`,
      });
      setOverrideModal(null);
    } catch (err) {
      // console.error("[K2] contabilizzazione produzione fallita:", err);
      setMagMsg({ type:"err", text:"Errore durante la contabilizzazione del magazzino. Nessuna ulteriore operazione consigliata finché non verifichi i dati." });
    } finally {
      setProductionLock(false);
    }
  }

  function calcSpesa() {
    // consumo_g = (ri.q / ricetta.yield_g) * (vaschette * r.yield_g)
    const t = {};
    Object.entries(piano).forEach(([rid, v]) => {
      if (!v || v <= 0) return;
      const r = recipesReparto.find(r => String(r.id) === String(rid));
      if (!r) return;
      const yieldG = getPlannedYieldG(r);
      const resaTotale_g = v * yieldG;
      r.ingredients.forEach(ri => {
        const ing = ingredients.find(i => i.id === ri.id);
        if (!ing) return;
        const q = (ri.q / yieldG) * resaTotale_g;
        const unitCost = getWeightedIngredientCostForSede(ri.id, ingredients, goodsReceipts, haccpTraceability, sede);
        if (!t[ri.id]) t[ri.id] = { ing, qty:0, cost:0 };
        t[ri.id].qty  += q;
        t[ri.id].cost += unitCost * q;
      });
    });
    return Object.values(t).sort((a, b) => b.cost - a.cost);
  }

  const CATS      = [...new Set(recipesReparto.map(r => r.category))].filter(Boolean);
  const spesa     = calcSpesa();
  const mancantiSpesa = spesa
    .map(item => {
      const current_g = Number(item?.ing?.stockBySede?.[sede]?.currentStock_g || 0);
      const shortage_g = Math.max(0, Math.round(Number(item?.qty || 0) - current_g));
      return { ...item, current_g, shortage_g };
    })
    .filter(item => item.shortage_g > 0)
    .sort((a, b) => b.shortage_g - a.shortage_g);
  const totSpesa  = spesa.reduce((s, i) => s + i.cost, 0);
  const totVasch  = Object.values(piano).reduce((s, v) => s + Number(v||0), 0);
  const totKg     = Object.entries(piano).reduce((s, [rid, v]) => {
    const r = recipesReparto.find(r => String(r.id) === String(rid));
    return s + (r ? getPlannedYieldG(r) * Number(v||0) : 0);
  }, 0);
  const tmcDate   = shiftISODate(dataP, 3);
  const traceRowsForCurrentLot = haccpTraceability
    .filter(t => t.productionLot === lotto && t.sede === sede && t.date === dataP)
    .sort((a, b) => String(a.recipeName || "").localeCompare(String(b.recipeName || "")));

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ display:"flex", gap:4 }}>
          {[["piano","Piano"],["spesa","Lista Spesa"],["stampa","Stampa"]].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding:"5px 12px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)" }}>{label}</button>
          ))}
          <RepartoBadge repartoId={reparto}/>
          {/* Badge sede visibile nel blocco produzione */}
          <span style={{ fontSize:10, color:SEDE_COLORS[sede], background:SEDE_COLORS[sede]+"18", border:`1px solid ${SEDE_COLORS[sede]}44`, borderRadius:10, padding:"2px 10px", fontWeight:"bold", whiteSpace:"nowrap" }}>
            📍 {sede}
          </span>
          <button onClick={() => onGoTo && onGoTo("ricettario")} style={{ padding:"4px 11px", fontSize:11, border:"1px solid #c8a96e44", borderRadius:4, background:"#c8a96e11", color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>📖 Ricettario ↗</button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <input type="date" value={dataP} onChange={e => setDataP(e.target.value)} style={{ ...inp, width:"auto", background:"transparent", border:"none", color:"#c8a96e", fontSize:13, cursor:"pointer" }}/>
          <div style={{ position:"relative", display:"flex", alignItems:"center", gap:6 }}>
            <input
              type="text"
              value={lotto}
              onChange={e => !isAlreadyContabilizzata() && setLotto(e.target.value)}
              placeholder="N° lotto"
              disabled={isAlreadyContabilizzata() || productionLock}
              title={isAlreadyContabilizzata() ? "Lotto bloccato — produzione già contabilizzata" : ""}
              style={{ ...inp, width:150, fontSize:12, opacity: isAlreadyContabilizzata() ? 0.5 : 1, cursor: isAlreadyContabilizzata() ? "not-allowed" : "text" }}
            />
            {!isAlreadyContabilizzata() && (
              <button type="button" onClick={() => setLotto(getNextProductionLot({ sede, dateIso: dataP, productionLog }))} style={{ ...btnS, padding:"5px 8px", fontSize:10 }} title="Rigenera lotto">↻</button>
            )}
            {isAlreadyContabilizzata() && (
              <span style={{ position:"absolute", right:28, top:"50%", transform:"translateY(-50%)", fontSize:10, color:"#fbbf24" }}>🔒</span>
            )}
          </div>
          {totVasch > 0 && <span style={{ fontSize:11, color:"#4ade80" }}>{totVasch} vasch · {fmt(totKg/1000,1)} kg · {fmtE(totSpesa)}</span>}
          <button onClick={() => { if (window.confirm("Confermi di azzerare il piano di produzione?")) setPiano({}); }} style={{ ...btnS, fontSize:10 }}>Azzera</button>
        </div>
      </div>

      {tab === "piano" && (
        <div>
          {/* Pulsante contabilizzazione magazzino */}
          {totVasch > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"rgba(200,169,110,0.06)", border:"1px solid #c8a96e33", borderRadius:6 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:"#c8a96e", fontWeight:"bold", marginBottom:2 }}>📦 Contabilizza scarico magazzino</div>
                  <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                    Scarica gli ingredienti usati dal magazzino di <strong style={{ color:SEDE_COLORS[sede] }}>{sede}</strong>. La contabilizzazione è bloccata se mancano stock, lotti FEFO o ricette non convertite.
                  </div>
                </div>
                {isAlreadyContabilizzata() ? (
                  <span style={{ fontSize:11, color:"#fbbf24", background:"rgba(251,191,36,0.1)", border:"1px solid #fbbf2440", borderRadius:4, padding:"6px 12px", whiteSpace:"nowrap" }}>
                    ✓ Già contabilizzata
                  </span>
                ) : (
                  <button
                    onClick={() => { setMagMsg(null); contabilizzaMagazzino(); }}
                    style={{ ...btnP, fontSize:11, padding:"7px 14px", whiteSpace:"nowrap", flexShrink:0 }}
                  >
                    📦 Scarica magazzino
                  </button>
                )}
              </div>
              {magMsg && (
                <div style={{
                  marginTop:6, fontSize:11, borderRadius:4, padding:"8px 12px",
                  color: magMsg.type==="ok" ? "#4ade80" : magMsg.type==="err" ? "#f87171" : "#fbbf24",
                  background: magMsg.type==="ok" ? "rgba(74,222,128,0.08)" : magMsg.type==="err" ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.08)",
                  border: `1px solid ${magMsg.type==="ok" ? "#4ade8033" : magMsg.type==="err" ? "#f8717133" : "#fbbf2433"}`,
                }}>
                  {magMsg.text}
                </div>
              )}
            </div>
          )}
          {CATS.map(cat => (
            <div key={cat} style={{ marginBottom:16 }}>
              <div style={{ fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8, paddingBottom:5, borderBottom:"1px solid var(--k2-border)" }}>{cat}</div>
              {recipesReparto.filter(r => r.category===cat).map(r => {
                const rid = String(r.id);
                const v   = Number(piano[rid] || 0);
                const kg  = getPlannedYieldG(r) * v / 1000;
                const _yG = Number(r.yield_g) > 0 ? Number(r.yield_g) : 1;
                const cMP = (r.ingredients||[]).reduce((s, ri) => { const ing = ingredients.find(i => i.id===ri.id); return s + (ing ? ing.cost * (ri.q / _yG) * (v * _yG) : 0); }, 0);
                // Real cost da lotti se disponibile
                const isStatic = r._isK2Static;
                const realCostData = !isStatic && v > 0 ? calculateRealRecipeCost(r, ingredients, goodsReceipts, haccpTraceability, sede, v) : null;
                const allergens = getRecipeAllergensStrict(r, recipesReparto, ingredients);
                return (
                  <div key={rid} style={{ ...card, marginBottom:6, display:"flex", alignItems:"center", gap:10, opacity: isStatic ? 0.85 : 1 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, color:"#c8a96e", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                        {r.name}
                        {isStatic && <span style={{ fontSize:9, color:"var(--k2-text-dim)", background:"var(--k2-bg)", border:"1px solid var(--k2-border)", borderRadius:6, padding:"1px 5px" }}>DB</span>}
                        {r.isSemiFinished && <span style={{ fontSize:9, color:"#60a5fa", background:"#60a5fa22", border:"1px solid #60a5fa44", borderRadius:6, padding:"1px 6px" }}>Semilavorato</span>}
                      </div>
                      <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>
                        {fmt(getPlannedYieldG(r)/1000,1)} kg/vasch
                        {v > 0 && !isStatic && (
                          <span style={{ color:"#4ade80", marginLeft:8 }}>
                            → {fmt(kg,1)} kg ·{" "}
                            {realCostData?.fullyCosted
                              ? <span title="Costo da lotti reali FEFO">{fmtE(realCostData.totalCost)} 🎯</span>
                              : <span title="Costo statico (aggiungi lotti in HACCP per costo reale)">{fmtE(cMP)} ~</span>
                            }
                          </span>
                        )}
                        {v > 0 && isStatic  && <span style={{ color:"#4ade80", marginLeft:8 }}>→ {fmt(kg,1)} kg</span>}
                      </div>
                      {allergens.length > 0 && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:2, marginTop:3 }}>
                          {allergens.slice(0,3).map(a => <AllergenBadge key={a} allergen={a}/>)}
                          {allergens.length > 3 && <span style={{ fontSize:9, color:"var(--k2-text-dim)" }}>+{allergens.length-3}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <button onClick={() => setPiano(p => ({ ...p, [rid]:Math.max(0,(Number(p[rid])||0)-1) }))} style={{ width:30, height:30, background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", color:"#c8a96e", borderRadius:4, cursor:"pointer", fontSize:16 }}>−</button>
                      <input type="number" value={piano[rid]||""} onChange={e => setPiano(p => ({ ...p, [rid]:Math.max(0,Number(e.target.value)||0) }))} placeholder="0" min="0" style={{ ...inp, width:50, textAlign:"center", padding:"5px" }}/>
                      <button onClick={() => setPiano(p => ({ ...p, [rid]:(Number(p[rid])||0)+1 }))} style={{ width:30, height:30, background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", color:"#c8a96e", borderRadius:4, cursor:"pointer", fontSize:16 }}>+</button>
                      <input type="number" value={pesoOverrideMap[rid] ?? r.yield_g} onChange={e => setPesoOverrideMap(p => ({ ...p, [rid]: Math.max(1, Number(e.target.value) || r.yield_g) }))} title="Peso per vasca (g)" min="1" style={{ ...inp, width:82, textAlign:"right", padding:"5px", marginLeft:6 }} />
                      <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>g</span>
                    </div>
                    <div style={{ minWidth:55, textAlign:"center" }}>{v > 0 ? <span style={{ fontSize:13, fontWeight:"bold", color:"#c8a96e" }}>{v} v.</span> : <span style={{ fontSize:10, color:"var(--k2-text-faint)" }}>vasch.</span>}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === "spesa" && (
        <div style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
            <span style={{ fontSize:12, color:"#c8a96e" }}>Lista Spesa · {formatDateIT(dataP)} · Lotto {lotto}</span>
            <span style={{ fontSize:14, fontWeight:"bold", color:"#c8a96e" }}>{fmtE(totSpesa)}</span>
          </div>
          {spesa.length === 0 ? (
            <div style={{ textAlign:"center", color:"var(--k2-text-faint)", padding:"24px" }}>Nessuna ricetta pianificata</div>
          ) : (
            <>
            {mancantiSpesa.length > 0 && (
              <div style={{ marginBottom:14, padding:"12px 14px", borderRadius:8, background:"rgba(248,113,113,0.06)", border:"1px solid #f8717140" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:8 }}>
                  <div style={{ fontSize:12, fontWeight:"bold", color:"#f87171" }}>🛒 Cose mancanti da comprare</div>
                  <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>{mancantiSpesa.length} voci sotto copertura</div>
                </div>
                <div style={{ display:"grid", gap:6 }}>
                  {mancantiSpesa.map(item => (
                    <div key={`miss-${item.ing.id}`} style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:8, fontSize:12 }}>
                      <span style={{ color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{item.ing.name}</span>
                      <span style={{ color:"#fbbf24" }}>Stock {fmtStock(item.current_g)}</span>
                      <span style={{ color:"#f87171", fontWeight:"bold" }}>Mancano {fmtStock(item.shortage_g)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--k2-border)" }}>
                  {["Ingrediente","Quantità","Costo","Allergeni","✓"].map((h, i) => (
                    <th key={h} style={{ padding:"6px 8px", fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", textAlign:i===4?"center":"left", fontWeight:"normal" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spesa.filter(item => item?.ing).map((item, i) => (
                  <tr key={item.ing.id} style={{ borderBottom:"1px solid var(--k2-border)", background:i%2===0?"transparent":"var(--k2-bg-deep)" }}>
                    <td style={{ padding:"8px", fontSize:13, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{item.ing.name}</td>
                    <td style={{ padding:"8px", fontSize:14, color:"#c8a96e", fontWeight:"bold" }}>{item.qty>=1000?fmt(item.qty/1000)+" kg":item.qty+" g"}</td>
                    <td style={{ padding:"8px", fontSize:12, color:"var(--k2-text-muted)" }}>{fmtE(item.cost)}</td>
                    <td style={{ padding:"8px" }}>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                        {(item.ing.allergens||[]).slice(0,2).map(a => <AllergenBadge key={a} allergen={a}/>)}
                      </div>
                    </td>
                    <td style={{ padding:"8px", textAlign:"center" }}><div style={{ width:18, height:18, border:"1.5px solid var(--k2-border)", borderRadius:3, margin:"0 auto" }}/></td>
                  </tr>
                ))}
                <tr style={{ borderTop:"2px solid var(--k2-border)" }}>
                  <td colSpan={2} style={{ padding:"8px", fontSize:12, color:"var(--k2-text-dim)" }}>TOTALE</td>
                  <td style={{ padding:"8px", fontSize:15, fontWeight:"bold", color:"#c8a96e" }}>{fmtE(totSpesa)}</td>
                  <td colSpan={2}/>
                </tr>
              </tbody>
            </table>
            </>
          )}
        </div>
      )}

      {tab === "stampa" && (
        <div>
          <div className="k2-no-print" style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
            <PrintButton label="🖨️ Stampa scheda produzione"/>
          </div>
          <PrintDoc>
          <div style={{ background:"white", color:"#1a1508", padding:24, borderRadius:8, fontFamily:"Arial,sans-serif" }}>
            <PrintDocHeader
              title={`Scheda di Produzione · Lotto ${lotto}`}
              subtitle="Produzione"
              sede={sede}
              lotto={lotto}
              dataP={dataP}
              extra={<div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>TMC: {formatDateIT(tmcDate)}</div>}
            />
            <div style={{ fontSize:9, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", color:"var(--k2-text-dim)", marginBottom:6 }}>Piano di produzione</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:16 }} className="k2-print-avoid-break">
              <thead><tr style={{ background:"#1a1508", color:"white" }}>{["Gusto","Vaschette","Kg","Costo MP","✓"].map(h => <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontWeight:"normal", fontSize:11 }}>{h}</th>)}</tr></thead>
              <tbody>
                {recipesReparto.filter(r => Number(piano[String(r.id)]||0) > 0).map((r, i) => {
                  const rid2 = String(r.id);
                  const v  = Number(piano[rid2]);
                  const kg = getPlannedYieldG(r) * v / 1000;
                  const _yG2 = Number(r.yield_g) > 0 ? Number(r.yield_g) : 1;
                  const c  = (r.ingredients||[]).reduce((s, ri) => {
                    const unitCost = getWeightedIngredientCostForSede(ri.id, ingredients, goodsReceipts, haccpTraceability, sede);
                    return s + (unitCost * (ri.q / _yG2) * (v * _yG2));
                  }, 0);
                  return <tr key={rid2} style={{ background:i%2===0?"white":"#f5f0e8" }}><td style={{ padding:"7px 8px", fontWeight:"bold" }}>{r.name}{r._isK2Static&&<span style={{fontSize:9,marginLeft:4,color:"#9a8e7e"}}>(DB)</span>}</td><td style={{ padding:"7px 8px" }}>{v}</td><td style={{ padding:"7px 8px" }}>{fmt(kg,1)} kg</td><td style={{ padding:"7px 8px" }}>{fmtE(c)}</td><td style={{ padding:"7px 8px", textAlign:"center" }}>☐</td></tr>;
                })}
                <tr style={{ borderTop:"2px solid #1a1508", fontWeight:"bold" }}><td style={{ padding:"7px 8px" }}>TOTALE</td><td style={{ padding:"7px 8px" }}>{totVasch}</td><td style={{ padding:"7px 8px" }}>{fmt(totKg/1000,1)} kg</td><td style={{ padding:"7px 8px" }}>{fmtE(totSpesa)}</td><td/></tr>
              </tbody>
            </table>
            <div style={{ fontSize:9, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", color:"var(--k2-text-dim)", marginBottom:6, marginTop:16 }}>Lista ingredienti da prelevare</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }} className="k2-print-avoid-break">
              <thead><tr style={{ background:"#1a1508", color:"white" }}>{["Ingrediente","Quantità","Prelevato ✓"].map(h => <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontWeight:"normal", fontSize:11 }}>{h}</th>)}</tr></thead>
              <tbody>{spesa.filter(item=>item?.ing).map((item, i) => <tr key={item.ing.id} style={{ background:i%2===0?"white":"#f5f0e8" }}><td style={{ padding:"7px 8px", fontWeight:"bold" }}>{item.ing.name}</td><td style={{ padding:"7px 8px", fontSize:15, fontWeight:"bold", color:"#b8860b" }}>{item.qty>=1000?fmt(item.qty/1000)+" kg":item.qty+" g"}</td><td style={{ padding:"7px 8px", textAlign:"center", fontSize:16 }}>☐</td></tr>)}</tbody>
            </table>

            <div style={{ fontSize:9, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", color:"var(--k2-text-dim)", marginBottom:6, marginTop:16 }}>Tracciabilità lotto</div>
            {traceRowsForCurrentLot.length === 0 ? (
              <div style={{ border:"1px dashed #c8b882", padding:"10px 12px", fontSize:11, color:"var(--k2-text-dim)", marginBottom:16 }} className="k2-print-avoid-break">
                La tracciabilità HACCP verrà generata automaticamente dopo la contabilizzazione del magazzino per questo lotto.
              </div>
            ) : (
              <div style={{ display:"grid", gap:10, marginBottom:16 }} className="k2-print-avoid-break">
                {traceRowsForCurrentLot.map(row => (
                  <div key={row.id} style={{ border:"1px solid #d9cfb5", borderRadius:4, padding:"10px 12px", background:"#fcfaf6" }}>
                    <div style={{ fontSize:12, fontWeight:"bold", color:"#1a1508", marginBottom:4 }}>{row.recipeName} · {fmt(row.outputQty_g/1000, 1)} kg</div>
                    <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginBottom:6 }}>{row.note || "Tracciabilità lotto"}</div>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                      <thead>
                        <tr style={{ background:"#eee7d8" }}>
                          <th style={{ padding:"5px 6px", textAlign:"left" }}>Ingrediente</th>
                          <th style={{ padding:"5px 6px", textAlign:"left" }}>Lotto associato</th>
                          <th style={{ padding:"5px 6px", textAlign:"right" }}>Grammi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.ingredientLots.map((line, i) => (
                          <tr key={`${row.id}-${i}`} style={{ borderBottom:"1px solid #efe7d3" }}>
                            <td style={{ padding:"5px 6px" }}>{line.ingredientName}</td>
                            <td style={{ padding:"5px 6px", fontFamily:"monospace" }}>
                              {line.lotCode || "DA-VERIFICARE"}
                              {line.sourceType === "manual_check" && <div style={{ fontSize:9, color:"#b45309", fontFamily:"Arial,sans-serif" }}>Verifica manuale</div>}
                            </td>
                            <td style={{ padding:"5px 6px", textAlign:"right" }}>{fmtStock(line.qtyUsed_g)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
            <PrintDocFooter sede={sede}/>
          </div>
          </PrintDoc>
        </div>
      )}

      {/* ── MODALE DI BLOCCO PRODUZIONE ── */}
      {overrideModal && (
        <Modal title="⚠️ Produzione bloccata" onClose={() => setOverrideModal(null)} maxWidth={520}>
          <div style={{ display:"grid", gap:12 }}>
            <div style={{ fontSize:12, color:"#f87171", background:"rgba(248,113,113,0.07)", border:"1px solid #f8717133", borderRadius:5, padding:"10px 12px" }}>
              Questa produzione non può essere forzata. Correggi prima stock, lotti o collegamenti ricetta.
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => setOverrideModal(null)} style={btnS}>Chiudi</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════════
function Etichette({ recipes, setRecipes, ingredients, sede, costiF, goodsReceipts = [], haccpTraceability = [], reparto, onGoTo }) {
  const [mode, setMode]   = useState("etichetta"); // etichetta | scheda
  // Tutte le ricette: app + K2 statiche — memoizzato
  const recipesReparto = React.useMemo(() => {
    try {
      return getMergedRecipes(recipes.filter(r => r.active !== false), reparto, ingredients);
    } catch(e) {
      return recipes.filter(r => r.active !== false && r.repartoId === reparto);
    }
  }, [recipes, reparto, ingredients]);
  const [selId, setSelId] = useState(() => recipesReparto[0]?.id || null);
  const [pesoNetto, setPesoNetto] = useState(150);
  const [dataP, setDataP]   = useState(today());
  const [lotto, setLotto]   = useState(() => `L${today().replace(/-/g,"")}`);
  const [scad, setScad]     = useState(shiftISODate(today(), 3));
  const [noteConserv, setNoteConserv] = useState("Conservare a -18°C. Una volta scongelato non ricongelare.");

  const rec      = recipesReparto.find(r => String(r.id) === String(selId));
  const allergens = rec ? getRecipeAllergensStrict(rec, recipesReparto, ingredients) : [];
  const nutr      = rec ? calcRecipeNutrition(rec, ingredients) : { ...EMPTY_NUTRITION };
  // Per ricette K2 statiche senza ingredienti app collegati, usa testo grezzo K2 come fallback
  const ingListStrict = rec ? buildIngredientStatementStrict(rec, recipesReparto, ingredients) : "";
  const ingListK2Fallback = (rec?._isK2Static && !ingListStrict && rec?._k2data?.ingredienti)
    ? rec._k2data.ingredienti.map(i => i.nome).join(", ")
    : "";
  const ingList = ingListStrict || ingListK2Fallback || "";
  const [approver, setApprover] = useState("");
  const labelNeedsReview = !!rec && (
    rec.labelNeedsReview ||
    !rec.labelApprovedVersion ||
    Number(rec.labelApprovedRevision || 0) !== Number(rec.labelRevision || 1) ||
    (!!rec.lastModifiedAt && rec.labelApprovedVersion !== rec.lastModifiedAt)
  );

  function approveCurrentLabel() {
    if (!rec || typeof setRecipes !== "function") return;
    setRecipes(prev => prev.map(r => r.id !== rec.id ? r : normalizeRecipe({
      ...r,
      labelNeedsReview: false,
      labelApprovedRevision: Number(r.labelRevision || 1),
      labelApprovedVersion: r.lastModifiedAt || new Date().toISOString(),
      labelApprovedAt: new Date().toISOString(),
      labelApprovedBy: approver.trim(),
    })));
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <h2 style={{ margin:0, fontSize:17, fontWeight:"normal" }}>🏷️ Etichettatrice & Schede</h2>
          <RepartoBadge repartoId={reparto}/>
        </div>
        <div style={{ display:"flex", gap:4, alignItems:"center" }}>
          {[["etichetta","🏷️ Etichetta prodotto"],["scheda","📋 Scheda tecnica"]].map(([id,label]) => (
            <button key={id} onClick={() => setMode(id)} style={{ padding:"6px 16px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:mode===id?"#c8a96e":"transparent", color:mode===id?"var(--k2-bg)":"var(--k2-text-muted)", fontWeight:mode===id?"bold":"normal" }}>{label}</button>
          ))}
          <button onClick={() => onGoTo && onGoTo("ricettario")} style={{ padding:"5px 12px", fontSize:11, border:"1px solid #c8a96e44", borderRadius:4, background:"#c8a96e11", color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>📖 Ricettario ↗</button>
        </div>
      </div>

      {/* Selezione ricetta comune */}
      <div style={{ ...card, marginBottom:14, borderLeft:"3px solid #c8a96e" }}>
        <div style={{ fontSize:9, color:"#c8a96e", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10, fontWeight:"bold" }}>Parametri documento</div>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Prodotto *</label><select value={selId||""} onChange={e => setSelId(e.target.value)} style={inp}>{recipesReparto.map(r => <option key={r.id} value={r.id}>{r.name}{r._isK2Static?" (DB)":""}</option>)}</select></div>
          <div><label style={lbl}>N° Lotto</label><input type="text" value={lotto} onChange={e => setLotto(e.target.value)} style={inp}/></div>
          <div><label style={lbl}>Data produzione</label><input type="date" value={dataP} onChange={e => { setDataP(e.target.value); setScad(shiftISODate(e.target.value, 3)); }} style={inp}/></div>
        </div>
        {rec && (
          <div style={{ marginTop:12, display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", flexWrap:"wrap", padding:"10px 12px", background:labelNeedsReview?"rgba(251,191,36,0.08)":"rgba(74,222,128,0.08)", border:labelNeedsReview?"1px solid #fbbf2440":"1px solid #4ade8040", borderRadius:6 }}>
            <div>
              <div style={{ fontSize:10, color:labelNeedsReview?"#fbbf24":"#4ade80", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3, fontWeight:"bold" }}>
                {labelNeedsReview ? "⚠ Etichetta da riapprovare" : "✓ Etichetta approvata"}
              </div>
              <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>
                Revisione etichetta: <strong style={{ color:"var(--k2-text-secondary)" }}>R{Number(rec.labelRevision || 1)}</strong><br/>
                {labelNeedsReview
                  ? "La ricetta o gli allergeni collegati sono cambiati. Prima del go-live riapprova l'etichetta."
                  : `Ultima approvazione: ${rec.labelApprovedAt ? formatDateIT(String(rec.labelApprovedAt).slice(0,10)) : '—'}${rec.labelApprovedBy ? ` · ${rec.labelApprovedBy}` : ''} · Revisione approvata R${Number(rec.labelApprovedRevision || rec.labelRevision || 1)}`}
              </div>
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
              <input value={approver} onChange={e => setApprover(e.target.value)} placeholder="Approvato da" style={{ ...inp, width:180, fontSize:11 }} />
              <button type="button" onClick={approveCurrentLabel} style={btnS} disabled={!rec}>✓ Approva versione</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── ETICHETTA ─────────────────────────────────── */}
      {mode === "etichetta" && (
        <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:16 }}>
          {/* Pannello parametri */}
          <div style={card}>
            <div style={{ fontSize:10, color:"#c8a96e", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12, fontWeight:"bold" }}>Parametri etichetta</div>
            <div style={{ display:"grid", gap:10 }}>
              <div>
                <label style={lbl}>Peso netto (g)</label>
                <input type="number" value={pesoNetto} onChange={e => setPesoNetto(Number(e.target.value)||0)} style={inp}/>
              </div>
              <div>
                <label style={lbl}>Da consumarsi entro (TMC)</label>
                <input type="date" value={scad} onChange={e => setScad(e.target.value)} style={inp}/>
              </div>
              <div>
                <label style={lbl}>Note conservazione</label>
                <input type="text" value={noteConserv} onChange={e => setNoteConserv(e.target.value)} style={inp}/>
              </div>
            </div>
            {/* Riepilogo allergeni nel pannello */}
            {allergens.length > 0 && (
              <div style={{ marginTop:14, padding:"8px 10px", background:"rgba(251,191,36,0.06)", border:"1px solid #fbbf2430", borderRadius:5 }}>
                <div style={{ fontSize:8, color:"#fbbf24", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>⚠ Allergeni dichiarati</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                  {allergens.map(a => <AllergenBadge key={a} allergen={a}/>)}
                </div>
              </div>
            )}
            {rec && labelNeedsReview && (
              <div style={{ marginTop:14, padding:"8px 10px", background:"rgba(248,113,113,0.07)", border:"1px solid #f8717140", borderRadius:5, fontSize:11, color:"#f87171" }}>
                ⚠ Questa etichetta va riapprovata prima dell'uso reale.
              </div>
            )}
            <PrintButton label="🖨️ Stampa etichetta" style={{ marginTop:14, width:"100%", justifyContent:"center" }}/>

          </div>

          {/* Preview + documento stampabile */}
          <div>
            <div className="k2-no-print" style={{ fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:8 }}>Anteprima etichetta</div>
            <PrintDoc>
            {/* Etichetta — formato stretto artigianale (max 400px per preview, A4 in stampa) */}
            <div style={{
              background:"white", color:"#1a1508",
              padding:22, borderRadius:6,
              fontFamily:"Arial,sans-serif",
              border:"2px solid #c8b060",
              maxWidth:400,
              boxShadow:"0 2px 12px rgba(0,0,0,0.08)",
            }}>
              {/* Intestazione produttore */}
              <div style={{ background:"#1a1508", margin:"-22px -22px 0 -22px", padding:"10px 16px 10px 16px", borderRadius:"4px 4px 0 0" }}>
                <div style={{ fontSize:16, fontWeight:"bold", color:"#c8a96e", letterSpacing:"0.08em" }}>GELATERIA K2</div>
                <div style={{ fontSize:9, color:"#9a8a6a", letterSpacing:"0.14em", textTransform:"uppercase" }}>Produzione artigianale · {sede}</div>
              </div>

              {/* Nome prodotto e categoria */}
              <div style={{ padding:"14px 0 10px 0", borderBottom:"1.5px solid #e8d8a0" }}>
                <div style={{ fontSize:22, fontWeight:"bold", color:"#1a1508", lineHeight:1.1, marginBottom:2 }}>
                  {rec?.name || "—"}
                </div>
                <div style={{ fontSize:11, color:"#8a7a50", letterSpacing:"0.06em" }}>
                  Gelato artigianale · {rec?.category || ""}
                </div>
              </div>

              {/* Ingredienti */}
              <div style={{ paddingTop:10, paddingBottom:10, borderBottom:"1px solid #e8d8a0" }}>
                <div style={{ fontSize:9, fontWeight:"bold", color:"#6b5a2a", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:5 }}>Ingredienti</div>
                <div style={{ fontSize:9.5, lineHeight:1.65, color:"#1a1508", wordBreak:"break-word" }}>
                  {ingList || "—"}
                </div>
              </div>

              {/* Allergeni */}
              {allergens.length > 0 && (
                <div className="k2-print-allergen-block" style={{ margin:"10px 0", padding:"7px 10px", background:"#fffaed", border:"1.5px solid #c8a800", borderLeft:"5px solid #c8a800", borderRadius:3 }}>
                  <div style={{ fontSize:9, fontWeight:"bold", color:"#7a5000", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:5 }}>⚠ Allergeni</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:5 }}>
                    {allergens.map(a => (
                      <span key={a} className="k2-allergen-badge" style={{ background:"#fff0c0", border:"1.5px solid #c8a800", borderRadius:3, padding:"1px 6px", fontSize:9, color:"#4a3000", fontWeight:"bold", display:"inline-block" }}>
                        ⚠ {(ALLERGENI_LABELS[a]||a).replace(/^[\p{Emoji}\s]+/u,"").trim()}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize:9, color:"#5a4010", fontStyle:"italic" }}>
                    {buildAllergenSummary(rec, ingredients, recipesReparto)}
                  </div>
                </div>
              )}

              {/* Valori nutrizionali */}
              <div style={{ paddingTop:8, paddingBottom:10, borderBottom:"1px solid #e8d8a0" }}>
                <div style={{ fontSize:9, fontWeight:"bold", color:"#6b5a2a", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:6 }}>
                  Valori nutrizionali medi — per 100 g di prodotto finito
                </div>
                <table className="k2-print-nutr-table" style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #c8b060" }}>
                      <th style={{ padding:"3px 4px", textAlign:"left", fontWeight:"bold", fontSize:9, color:"#6b5a2a" }}>Nutriente</th>
                      <th style={{ padding:"3px 4px", textAlign:"right", fontWeight:"bold", fontSize:9, color:"#6b5a2a" }}>Per 100 g</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Energia",          `${fmt(nutr.kcal,0)} kcal / ${fmt(nutr.kcal*4.184,0)} kJ`],
                      ["Grassi",           `${fmt(nutr.fat,1)} g`],
                      ["· di cui acidi grassi saturi", `${fmt(nutr.satFat,1)} g`],
                      ["Carboidrati",      `${fmt(nutr.carbs,1)} g`],
                      ["· di cui zuccheri",`${fmt(nutr.sugars,1)} g`],
                      ["Proteine",         `${fmt(nutr.protein,1)} g`],
                      ["Sale",             `${fmt(nutr.salt,2)} g`],
                    ].map(([l,v], i) => (
                      <tr key={l} style={{ borderBottom:"1px solid #ede8d0", background: l.startsWith("·") ? "#fafaf5" : "white" }}>
                        <td style={{ padding:"3px 4px", color: l.startsWith("·") ? "#8a7a50" : "#1a1508", paddingLeft: l.startsWith("·") ? 14 : 4, fontSize: l.startsWith("·") ? 9 : 10 }}>{l}</td>
                        <td style={{ padding:"3px 4px", textAlign:"right", fontWeight: l.startsWith("·") ? "normal" : "bold", color: l.startsWith("·") ? "#6b5a2a" : "#1a1508", fontSize: l.startsWith("·") ? 9 : 10 }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Lotto / Date / Peso / Produttore */}
              <div className="k2-print-lot-block" style={{ paddingTop:10, marginTop:10, fontSize:10 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px", marginBottom:6 }}>
                  <div><span style={{ color:"#6b5a2a", fontWeight:"bold" }}>Peso netto:</span> {pesoNetto} g</div>
                  <div><span style={{ color:"#6b5a2a", fontWeight:"bold" }}>Lotto:</span> <span style={{ fontFamily:"monospace" }}>{lotto}</span></div>
                  <div><span style={{ color:"#6b5a2a", fontWeight:"bold" }}>Produzione:</span> {formatDateIT(dataP)}</div>
                  <div><span style={{ color:"#6b5a2a", fontWeight:"bold" }}>TMC:</span> {formatDateIT(scad)}</div>
                </div>
                <div style={{ fontSize:9, color:"#5a4010", fontStyle:"italic", marginBottom:4 }}>{noteConserv}</div>
                <div style={{ fontSize:9, color:"#6b5a2a", marginTop:4, paddingTop:4, borderTop:"1px solid #e0d0a0" }}>
                  <strong>Produttore:</strong> Gelateria K2 · {sede === "Chiavari" ? "Corso Valparaiso 108, Chiavari (GE)" : "Via Asilo Maria Teresa 12/14, Sestri Levante (GE)"}
                </div>
              </div>
            </div>
            </PrintDoc>
          </div>
        </div>
      )}

      {/* ─── SCHEDA TECNICA ────────────────────────────── */}
      {mode === "scheda" && rec && (
        <SchedaTecnica recipe={rec} ingredients={ingredients} allRecipes={recipesReparto} sede={sede} lotto={lotto} dataP={dataP} costiF={costiF} goodsReceipts={goodsReceipts} haccpTraceability={haccpTraceability}/>
      )}
      {mode === "scheda" && !rec && (
        <div style={{ color:"var(--k2-text-faint)", textAlign:"center", padding:"40px" }}>Seleziona un prodotto</div>
      )}
    </div>
  );
}

// ─── SCHEDA TECNICA STAMPABILE ────────────────────────────────────────────────
function SchedaTecnica({ recipe, ingredients, allRecipes, sede, lotto, dataP, costiF, goodsReceipts = [], haccpTraceability = [] }) {
  const nutr       = calcRecipeNutrition(recipe, ingredients);
  const allergens  = getRecipeAllergensStrict(recipe, allRecipes || [], ingredients);
  const costCtx    = calcCostMPDetailedForSede(recipe, ingredients, goodsReceipts, haccpTraceability, sede);
  const staticCtx  = calcCostMPDetailed(recipe, ingredients);
  const costMP     = costCtx.cost;
  const missingIngredientIds = costCtx.missingIngredientIds || [];
  const cpg        = recipe.yield_g > 0 ? costMP / recipe.yield_g : 0;
  const totalInput = (recipe.ingredients||[]).reduce((s, ri) => s + ri.q, 0);
  const hasMissingIng = missingIngredientIds && missingIngredientIds.length > 0;

  // Ingredienti ordinati per peso decrescente con dettagli
  const sortedIng = [...recipe.ingredients]
    .sort((a, b) => b.q - a.q)
    .map(ri => {
      const ing = ingredients.find(i => i.id === ri.id);
      return { ...ri, ing };
    })
    .filter(x => x.ing);

  return (
    <div>
      <div className="k2-no-print" style={{ display:"flex", justifyContent:"flex-end", marginBottom:10, gap:8 }}>
        <PrintButton label="🖨️ Stampa scheda tecnica"/>
      </div>

      <PrintDoc>
      <div style={{ background:"white", color:"#1a1508", padding:"28px 32px", borderRadius:8, fontFamily:"Arial,sans-serif", border:"1px solid #ddd", fontSize:11 }}>
      {hasMissingIng && (
        <div style={{ background:"#fff3cd", border:"1.5px solid #ffc107", borderRadius:5, padding:"8px 14px", marginBottom:14, fontSize:11 }}>
          ⚠️ <strong>Ingredienti non in anagrafica:</strong> ID {missingIngredientIds.join(", ")} — il food cost è sottostimato. Aggiungili in FoodCost → Ingredienti.
        </div>
      )}

        {/* Header */}
        <PrintDocHeader
          title={recipe.name}
          subtitle="Scheda Tecnica Ricetta"
          sede={sede}
          lotto={lotto}
          dataP={dataP}
          extra={
            <div style={{ marginTop:6, textAlign:"right" }}>
              <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:"0.1em", color:"#9a8e7e" }}>Resa</div>
              <div style={{ fontSize:15, fontWeight:"bold", color:"#1a1508" }}>{recipe.yield_g} g</div>
              <div style={{ fontSize:9, color:"#9a8e7e" }}>Input: {totalInput} g</div>
            </div>
          }
        />

        {/* Riga metadati categoria + note */}
        <div style={{ display:"flex", gap:16, marginBottom:18, padding:"10px 14px", background:"#f9f5ee", border:"1px solid #e0d5be", borderRadius:4 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:8, color:"#9a8e7e", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:2 }}>Categoria</div>
            <div style={{ fontSize:13, fontWeight:"bold", color:"#b8860b" }}>{recipe.category}</div>
          </div>
          <div style={{ flex:2 }}>
            {recipe.notes && <>
              <div style={{ fontSize:8, color:"#9a8e7e", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:2 }}>Note di produzione</div>
              <div style={{ fontSize:11, color:"#3a3020", fontStyle:"italic" }}>{recipe.notes}</div>
            </>}
          </div>
          <div style={{ textAlign:"right", minWidth:120 }}>
            <div style={{ fontSize:8, color:"#9a8e7e", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:2 }}>Costo MP lotto</div>
            <div style={{ fontSize:16, fontWeight:"bold", color:"#b8860b" }}>{fmtE(costMP)}</div>
            <div style={{ fontSize:9, color:"#9a8e7e" }}>{fmtE(cpg*100)}/100g resa</div>
          </div>
        </div>

        {/* Tabella ingredienti */}
        <div style={{ marginBottom:18 }} className="k2-print-avoid-break">
          <div style={{ fontSize:8, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.14em", color:"#6b5a2a", marginBottom:8, paddingBottom:4, borderBottom:"2px solid #c8b060" }}>
            Composizione ricetta — ingredienti in ordine decrescente di peso
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5 }}>
            <thead>
              <tr style={{ background:"#1a1508", color:"white" }}>
                {["#","Ingrediente","Categoria","g","% input","% resa","Costo","Allergeni"].map((h, i) => (
                  <th key={h} style={{ padding:"6px 8px", textAlign: i > 2 ? "right" : "left", fontWeight:"normal", fontSize:8.5, textTransform:"uppercase", letterSpacing:"0.08em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedIng.map(({ ing, q }, idx) => {
                const pctInput = totalInput > 0 ? (q / totalInput * 100).toFixed(1) : "—";
                const pctResa  = recipe.yield_g > 0 ? (q / recipe.yield_g * 100).toFixed(1) : "—";
                const weightedMeta = getWeightedIngredientCostMetaForSede(ing.id, ingredients, goodsReceipts, haccpTraceability, sede);
                const costoUnit = weightedMeta.weightedCost || ing.cost || 0;
                const costoRiga = costoUnit * q;
                const hasAllerg = (ing.allergens || []).length > 0;
                return (
                  <tr key={ing.id} style={{
                    background: hasAllerg ? "#fffcf0" : idx % 2 === 0 ? "white" : "#faf7f2",
                    borderBottom:"1px solid #ede8df",
                  }}>
                    <td style={{ padding:"5px 8px", color:"#9a8e7e", fontSize:9 }}>{idx + 1}</td>
                    <td style={{ padding:"5px 8px", fontWeight: hasAllerg ? "bold" : "normal", color: hasAllerg ? "#1a1508" : "#2a2018" }}>
                      {hasAllerg ? ing.name.toUpperCase() : ing.name}
                    </td>
                    <td style={{ padding:"5px 8px", color:"var(--k2-text-dim)", fontSize:9.5 }}>{ing.category}</td>
                    <td style={{ padding:"5px 8px", textAlign:"right", fontWeight:"bold", color:"#b8860b" }}>{q}</td>
                    <td style={{ padding:"5px 8px", textAlign:"right", color:"var(--k2-text-dim)" }}>{pctInput}%</td>
                    <td style={{ padding:"5px 8px", textAlign:"right", color:"var(--k2-text-dim)" }}>{pctResa}%</td>
                    <td style={{ padding:"5px 8px", textAlign:"right", color:"var(--k2-text-dim)", fontSize:9.5 }}>{fmtE(costoRiga)}</td>
                    <td style={{ padding:"5px 8px", fontSize:8.5 }}>
                      {(ing.allergens || []).map(a => (
                        <span key={a} className="k2-allergen-badge" style={{ display:"inline-block", background:"#fff0c0", border:"1px solid #c8a800", borderRadius:2, padding:"0 4px", marginRight:2, color:"#5a3800", fontWeight:"bold", fontSize:8 }}>
                          {(ALLERGENI_LABELS[a] || a).replace(/^[\p{Emoji}\s]+/u, "").trim()}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop:"2px solid #1a1508", fontWeight:"bold", background:"#f5f0e8" }}>
                <td colSpan={3} style={{ padding:"6px 8px", color:"#1a1508" }}>TOTALE</td>
                <td style={{ padding:"6px 8px", textAlign:"right", color:"#b8860b" }}>{totalInput}</td>
                <td style={{ padding:"6px 8px", textAlign:"right", color:"var(--k2-text-dim)" }}>100%</td>
                <td style={{ padding:"6px 8px", textAlign:"right", color:"var(--k2-text-dim)" }}>{recipe.yield_g > 0 ? (totalInput / recipe.yield_g * 100).toFixed(1) + "%" : "—"}</td>
                <td style={{ padding:"6px 8px", textAlign:"right", color:"#b8860b" }}>{fmtE(costMP)}</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Dichiarazione ingredienti etichetta */}
        <div style={{ marginBottom:16, padding:"10px 14px", background:"#f0ece2", border:"1px solid #c8b060", borderLeft:"4px solid #c8b060", borderRadius:3 }} className="k2-print-avoid-break">
          <div style={{ fontSize:8, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:5, color:"#6b5a2a" }}>
            Dichiarazione ingredienti (testo per etichetta — Reg. UE 1169/2011)
          </div>
          <div style={{ fontSize:10, lineHeight:1.7, color:"#1a1508", wordBreak:"break-word" }}>
            {buildIngredientStatementStrict(recipe, allRecipes || [], ingredients) || buildIngredientStatement(recipe, ingredients)}
          </div>
        </div>

        {/* Allergeni */}
        <div className="k2-print-allergen-block k2-print-avoid-break" style={{ marginBottom:16, padding:"10px 14px", background:"#fffaed", border:"1.5px solid #c8a800", borderLeft:"5px solid #c8a800", borderRadius:3 }}>
          <div style={{ fontSize:8, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:8, color:"#7a5000" }}>
            ⚠ Allergeni presenti (Reg. UE 1169/2011 — All. II)
          </div>
          {allergens.length > 0 ? (
            <>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:7 }}>
                {allergens.map(a => (
                  <span key={a} className="k2-allergen-badge" style={{ background:"#fff0c0", border:"1.5px solid #c8a800", borderRadius:3, padding:"2px 8px", fontSize:9.5, color:"#4a3000", fontWeight:"bold", display:"inline-block" }}>
                    ⚠ {(ALLERGENI_LABELS[a] || a).replace(/^[\p{Emoji}\s]+/u, "").trim()}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:10, color:"#5a4010", fontWeight:"bold" }}>
                {buildAllergenSummary(recipe, ingredients, allRecipes)}
              </div>
            </>
          ) : (
            <span style={{ fontSize:11, color:"#3a6a3a", fontWeight:"bold" }}>✓ Nessun allergene principale dichiarato</span>
          )}
        </div>

        {/* Griglia: Analisi costi + Valori nutrizionali */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18, marginBottom:16 }} className="k2-print-avoid-break">

          {/* Analisi costi */}
          <div>
            <div style={{ fontSize:8, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:8, color:"#6b5a2a", paddingBottom:4, borderBottom:"1.5px solid #c8b060" }}>
              Analisi costi
            </div>
            <table style={{ borderCollapse:"collapse", fontSize:10.5, width:"100%" }}>
              <tbody>
                {[
                  ["Costo MP operativo",    fmtE(costMP)],
                  ["Costo MP statico",      fmtE(staticCtx.cost || 0)],
                  ["Delta operativo",       fmtE(costMP - (staticCtx.cost || 0))],
                  ["Costo MP / 100g resa",  fmtE(cpg * 100)],
                  ["Costo MP / kg resa",    fmtE(cpg * 1000)],
                ].map(([l, v]) => (
                  <tr key={l} style={{ borderBottom:"1px solid #e0d5be" }}>
                    <td style={{ padding:"5px 0", color:"var(--k2-text-dim)" }}>{l}</td>
                    <td style={{ padding:"5px 0", textAlign:"right", fontWeight:"bold", color:"#b8860b" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Valori nutrizionali */}
          <div>
            <div style={{ fontSize:8, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:8, color:"#6b5a2a", paddingBottom:4, borderBottom:"1.5px solid #c8b060" }}>
              Valori nutrizionali medi — per 100 g prodotto finito
            </div>
            <table className="k2-print-nutr-table" style={{ borderCollapse:"collapse", fontSize:10.5, width:"100%" }}>
              <tbody>
                {[
                  ["Energia",               `${fmt(nutr.kcal,0)} kcal / ${fmt(nutr.kcal*4.184,0)} kJ`],
                  ["Grassi",                `${fmt(nutr.fat,1)} g`],
                  ["· acidi grassi saturi", `${fmt(nutr.satFat,1)} g`],
                  ["Carboidrati",           `${fmt(nutr.carbs,1)} g`],
                  ["· zuccheri",            `${fmt(nutr.sugars,1)} g`],
                  ["Proteine",              `${fmt(nutr.protein,1)} g`],
                  ["Sale",                  `${fmt(nutr.salt,2)} g`],
                ].map(([l, v]) => (
                  <tr key={l} style={{ borderBottom:"1px solid #e0d5be", background: l.startsWith("·") ? "#fafaf5" : "white" }}>
                    <td style={{ padding:"4px 0 4px", color: l.startsWith("·") ? "#8a7a50" : "#3a3020", paddingLeft: l.startsWith("·") ? 12 : 0, fontSize: l.startsWith("·") ? 9.5 : 10.5 }}>{l}</td>
                    <td style={{ padding:"4px 0", textAlign:"right", fontWeight: l.startsWith("·") ? "normal" : "bold", color: l.startsWith("·") ? "#6b5a2a" : "#1a1508", fontSize: l.startsWith("·") ? 9.5 : 10.5 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <PrintDocFooter sede={sede}/>
      </div>
      </PrintDoc>
    </div>
  );
}

// ─── GestisciTab — con ricerca e filtro attivi/tutti ────────────────────────
function GestisciTab({ gListReparto, disponibili, allMergedReparto, toggle }) {
  const [searchG, setSearchG] = useState("");
  const [showAll, setShowAll] = useState(true);

  const filtered = gListReparto.filter(g => {
    const nameMatch = !searchG || g.nome.toLowerCase().includes(searchG.toLowerCase());
    const activeMatch = showAll || g.disponibile;
    return nameMatch && activeMatch;
  });

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <input
          type="text" value={searchG} onChange={e=>setSearchG(e.target.value)}
          placeholder="🔍 Cerca gusto…"
          style={{ flex:1, minWidth:160, padding:"6px 12px", borderRadius:7, border:"1px solid var(--k2-border)", background:"var(--k2-bg-card)", color:"var(--k2-text)", fontFamily:"inherit", fontSize:12 }}
        />
        <button onClick={()=>setShowAll(v=>!v)} style={{ padding:"5px 12px", fontSize:11, borderRadius:7, border:"1px solid var(--k2-border)", background:"transparent", color:"var(--k2-text-dim)", cursor:"pointer", fontFamily:"inherit" }}>
          {showAll ? "Mostra solo attivi" : "Mostra tutti"}
        </button>
        <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>
          <strong style={{ color:"#c8a96e" }}>{gListReparto.length}</strong> totali · <strong style={{ color:"#4ade80" }}>{disponibili.length}</strong> attivi
        </span>
      </div>
      <div style={{ display:"grid", gap:5 }}>
        {filtered.map(g => {
          const rec = allMergedReparto.find(r => String(r.id) === String(g.id));
          return (
            <div key={g.id} style={{
              display:"flex", alignItems:"center", gap:12, padding:"9px 14px",
              background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)",
              borderRadius:8, opacity: g.disponibile ? 1 : 0.6,
            }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:"bold", color:g.disponibile?"#c8a96e":"var(--k2-text-faint)", display:"flex", alignItems:"center", gap:6 }}>
                  {g.nome}
                  {g._isK2Static && <span style={{ fontSize:9, color:"var(--k2-text-dim)", background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"1px 4px" }}>DB</span>}
                </div>
                <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:2 }}>{rec?.category || "—"}</div>
              </div>
              <div onClick={()=>toggle(g.id)} style={{ width:42, height:22, borderRadius:11, cursor:"pointer", transition:"all 0.2s", background:g.disponibile?"#4ade80":"var(--k2-border)", position:"relative", flexShrink:0 }}>
                <div style={{ position:"absolute", top:3, left:g.disponibile?23:3, width:16, height:16, borderRadius:8, background:"white", transition:"left 0.2s" }}/>
              </div>
              <div style={{ fontSize:11, color:g.disponibile?"#4ade80":"var(--k2-text-faint)", minWidth:88, textAlign:"right" }}>
                {g.disponibile?"✓ Disponibile":"✗ Non attivo"}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"24px", color:"var(--k2-text-faint)", fontSize:12 }}>
            Nessun gusto trovato{searchG ? ` per "${searchG}"` : ""}.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LISTINO — con priceList modificabile
// ═══════════════════════════════════════════════════════════════════════════════
function Listino({ listino, setListino, recipes, ingredients, sede, priceList, setPriceList, reparto, onGoTo }) {
  const [tab, setTab]           = useState("listino");
  const [editingPrices, setEditingPrices] = useState(false);
  const gList = listino[sede] || [];

  function toggle(id) {
    const sid = String(id);
    // Se l'entry esiste già nel listino saved, toggle
    if (gList.some(g => String(g.id) === sid)) {
      setListino(prev => ({
        ...prev,
        [sede]: prev[sede].map(g => String(g.id) === sid ? { ...g, disponibile:!g.disponibile } : g)
      }));
    } else {
      // Primo toggle su ricetta K2 statica: aggiungila al listino
      const allMerged = getMergedRecipes(recipes, reparto);
      const rec = allMerged.find(r => String(r.id) === sid);
      if (rec) {
        setListino(prev => ({
          ...prev,
          [sede]: [...(prev[sede] || []), { id: sid, nome: rec.name, disponibile: true }]
        }));
      }
    }
  }

  // Lista unificata: saved listino + tutte le ricette merged del reparto non ancora presenti
  const allMergedReparto = React.useMemo(() => {
    try {
      return getMergedRecipes(recipes.filter(r => r.active !== false), reparto, ingredients || []);
    } catch(e) {
      return recipes.filter(r => r.active !== false && r.repartoId === reparto);
    }
  }, [recipes.length, reparto, (ingredients||[]).length]);
  const savedIds = new Set(gList.map(g => String(g.id)));

  // Costruiamo gListReparto combinando:
  // 1. Voci salvate nel listino che appartengono al reparto
  // 2. Ricette merged non ancora nel listino (default disponibile: false)
  const gListReparto = [
    // voci salvate del reparto
    ...gList
      .filter(g => {
        const rid = String(g.id);
        // è nel reparto? cerca prima in recipes app, poi in merged
        const appRec = recipes.find(r => String(r.id) === rid);
        if (appRec) return appRec.repartoId === reparto;
        const mergedRec = allMergedReparto.find(r => String(r.id) === rid);
        return !!mergedRec; // se è in allMergedReparto è già filtrato per reparto
      })
      .map(g => {
        const rec = allMergedReparto.find(r => String(r.id) === String(g.id));
        return { ...g, id: String(g.id), nome: rec?.name || g.nome, _isK2Static: rec?._isK2Static || false };
      }),
    // ricette merged non ancora nel listino
    ...allMergedReparto
      .filter(r => !savedIds.has(String(r.id)))
      .map(r => ({ id: String(r.id), nome: r.name, disponibile: false, _isK2Static: r._isK2Static || false })),
  ];

  const disponibili = gListReparto.filter(g => g.disponibile);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ display:"flex", gap:4, alignItems:"center" }}>
          {[["listino","Listino"],["gestisci","Gestisci"],["prezzi","Prezzi"],["qr","QR"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding:"5px 12px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)" }}>{label}</button>
          ))}
          <RepartoBadge repartoId={reparto}/>
        </div>
        <span style={{ fontSize:11, color:"var(--k2-text-dim)", display:"flex", alignItems:"center", gap:10 }}>
          <span><strong style={{ color:"#4ade80" }}>{disponibili.length}</strong>/{gListReparto.length} gusti attivi</span>
          <button onClick={() => onGoTo && onGoTo("ricettario")} style={{ padding:"4px 11px", fontSize:11, border:"1px solid #c8a96e44", borderRadius:4, background:"#c8a96e11", color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>📖 Ricettario ↗</button>
        </span>
      </div>

      {tab === "listino" && (
        <div>
          <div style={{ textAlign:"center", marginBottom:20 }}>
            <div style={{ fontSize:24, fontWeight:"bold", color:"#c8a96e" }}>GELATERIA K2</div>
            <div style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:8 }}>{sede}</div>
            <div style={{ display:"inline-flex", gap:12, background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:20, padding:"5px 14px", fontSize:10, color:"var(--k2-text-dim)" }}>
              <span>🌿 100% Senza glutine</span><span>🏭 Produzione artigianale</span>
            </div>
          </div>
          <div style={{ display:"grid", gap:8 }}>
            {disponibili.map(g => {
              const rec = allMergedReparto.find(r => String(r.id) === String(g.id));
              const k2data = rec?._k2data;
              return (
                <div key={g.id} style={{ ...card, display:"flex", alignItems:"flex-start", gap:12 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                      <span style={{ fontSize:15, color:"#c8a96e" }}>{g.nome}</span>
                      {rec && <RepartoBadge repartoId={rec.repartoId} small/>}
                      {g._isK2Static && <span style={{ fontSize:9, color:"var(--k2-text-dim)", background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"1px 5px" }}>DB</span>}
                    </div>
                    {(rec?.notes || k2data?.note) && <div style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:4 }}>{rec?.notes || k2data?.note?.replace(/⭐/g,"").trim()}</div>}
                  </div>
                  <div style={{ background:"var(--k2-bg-input)", borderRadius:5, padding:"5px 10px", textAlign:"center" }}>
                    <div style={{ fontSize:10, color:"#4ade80" }}>✓</div>
                    <div style={{ fontSize:8, color:"var(--k2-text-dim)" }}>Oggi</div>
                  </div>
                </div>
              );
            })}
            {disponibili.length === 0 && <div style={{ textAlign:"center", color:"var(--k2-text-faint)", padding:"32px" }}>Nessun gusto attivo. Attivali dalla scheda Gestisci.</div>}
          </div>
          {/* Prezzi dal priceList */}
          <div style={{ ...card, marginTop:8 }}>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>💰 Prezzi</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {priceList.map(p => (
                <div key={p.id} style={{ display:"flex", justifyContent:"space-between", background:"var(--k2-bg-input)", borderRadius:4, padding:"7px 10px" }}>
                  <span style={{ fontSize:12, color:"var(--k2-text-muted)" }}>{p.label}</span>
                  <span style={{ fontSize:13, fontWeight:"bold", color:"#c8a96e" }}>€ {fmt(p.price)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "gestisci" && (
        <GestisciTab
          gListReparto={gListReparto}
          disponibili={disponibili}
          allMergedReparto={allMergedReparto}
          toggle={toggle}
        />
      )}


      {tab === "prezzi" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <h2 style={{ margin:0, fontSize:16, fontWeight:"normal" }}>💰 Listino Prezzi</h2>
            <button onClick={() => setEditingPrices(e => !e)} style={{ ...btnS, fontSize:11 }}>{editingPrices?"✓ Fine":"✏️ Modifica"}</button>
          </div>
          <div style={card}>
            {priceList.map((p, idx) => (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                {editingPrices ? (
                  <>
                    <input value={p.label} onChange={e => setPriceList(list => list.map((x, i) => i===idx ? { ...x, label:e.target.value } : x))} style={{ ...inp, flex:1, fontSize:12 }}/>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ color:"var(--k2-text-dim)" }}>€</span>
                      <input type="number" value={p.price} onChange={e => setPriceList(list => list.map((x, i) => i===idx ? { ...x, price:Number(e.target.value)||0 } : x))} style={{ ...inp, width:80, textAlign:"right" }} step="0.10" min="0"/>
                    </div>
                    <button onClick={() => setPriceList(list => list.filter((_, i) => i!==idx))} style={{ background:"transparent", border:"none", color:"#f87171", cursor:"pointer", padding:3 }}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex:1, fontSize:13, color:"var(--k2-text-secondary)" }}>{p.label}</span>
                    <span style={{ fontSize:15, fontWeight:"bold", color:"#c8a96e" }}>€ {fmt(p.price)}</span>
                  </>
                )}
              </div>
            ))}
            {editingPrices && (
              <button onClick={() => setPriceList(list => [...list, { id:`pl${Date.now()}`, label:"Nuovo formato", price:0 }])} style={{ ...btnS, marginTop:10, width:"100%", justifyContent:"center" }}>+ Aggiungi formato</button>
            )}
          </div>
        </div>
      )}

      {tab === "qr" && (
        <div style={{ textAlign:"center" }}>
          <div style={{ ...card, display:"inline-block", padding:32, marginBottom:16 }}>
            <div style={{ background:"white", padding:16, borderRadius:8, display:"inline-block" }}>
              <svg width="180" height="180" viewBox="0 0 200 200">
                <rect width="200" height="200" fill="white"/>
                <rect x="10" y="10" width="56" height="56" fill="#1a1508" rx="3"/><rect x="18" y="18" width="40" height="40" fill="white" rx="2"/><rect x="26" y="26" width="24" height="24" fill="#1a1508" rx="2"/>
                <rect x="134" y="10" width="56" height="56" fill="#1a1508" rx="3"/><rect x="142" y="18" width="40" height="40" fill="white" rx="2"/><rect x="150" y="26" width="24" height="24" fill="#1a1508" rx="2"/>
                <rect x="10" y="134" width="56" height="56" fill="#1a1508" rx="3"/><rect x="18" y="142" width="40" height="40" fill="white" rx="2"/><rect x="26" y="150" width="24" height="24" fill="#1a1508" rx="2"/>
                {[80,88,96,104,112,120,128].map(x => [80,88,96,104,112,120,128].map(y => ((x+y)%16<8 && <rect key={`${x}-${y}`} x={x} y={y} width="7" height="7" fill="#1a1508"/>)))}
                <rect x="86" y="86" width="28" height="28" fill="white" rx="3"/>
                <text x="100" y="103" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#b8860b">K2</text>
              </svg>
            </div>
            <div style={{ marginTop:10, fontSize:11, color:"#c8a96e" }}>gelateriак2.it/{sede==="Sestri Levante"?"sestri":"chiavari"}</div>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:3 }}>Scansiona per vedere i gusti del giorno</div>
          </div>
          <PrintButton label="🖨️ Stampa QR" style={{ margin:"12px auto", display:"flex" }}/>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASHFLOW
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Cashflow storage keys separati per sede ─────────────────────────────────
// Giornaliero: { [sede]: { [iso]: { entrate:{cat:val}, uscite:{cat:val} } } }
// Settimanale: derivato aggregando i giornalieri per settimana ISO

function cfGetWeekISO(iso) {
  try {
    const d = parseISODate(iso);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const thu1 = new Date(jan4);
    thu1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3);
    const diff = Math.round((d - thu1) / 86400000);
    const week = Math.floor(diff / 7) + 1;
    return `${d.getFullYear()}-W${String(Math.max(1,week)).padStart(2,"0")}`;
  } catch { return `${new Date().getFullYear()}-W01`; }
}

function cfGetWeekDates(weekISO) {
  try {
    const parts = String(weekISO || "").split("-W");
    if (parts.length !== 2) throw new Error("bad");
    const y = parseInt(parts[0]), w = parseInt(parts[1]);
    if (!y || !w || isNaN(y) || isNaN(w)) throw new Error("bad");
    const jan4 = new Date(y, 0, 4);
    const thu1 = new Date(jan4);
    thu1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3);
    const thursday = new Date(thu1);
    thursday.setDate(thu1.getDate() + (w - 1) * 7);
    const monday = new Date(thursday);
    monday.setDate(thursday.getDate() - 3);
    return Array.from({length:7}, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return localDateISO(d);
    });
  } catch {
    return Array.from({length:7}, (_,i) => shiftISODate(today(), i - 3));
  }
}

const GIORNI_SHORT = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const CF_CATS_ENT = ["Incassi gelato","Rivendita","Delivery","Altro"];
const CF_CATS_USC = ["Materie prime","Personale","Energia","Packaging","Altro uscite"];

function Cashflow({ cashflow, setCashflow, sede }) {
  const [tab, setTab]           = useState("giornaliero");
  const [mese, setMese]         = useState(new Date().getMonth());
  const [editMode, setEditMode] = useState(false);
  const [dayDate, setDayDate]   = useState(today());
  const [weekISO, setWeekISO]   = useState(cfGetWeekISO(today()));

  // ─── storage giornaliero (separato da cashflow mensile) ────────────────────
  const [cfDaily, setCfDaily] = useState({});
  useEffect(() => {
    load("k2-cashflow-daily", {}).then(d => setCfDaily(d || {}));
  }, []);
  useEffect(() => {
    save("k2-cashflow-daily", cfDaily);
  }, [cfDaily]);

  const cf = cashflow[sede] || initCashflow();

  // ─── helpers mensile ───────────────────────────────────────────────────────
  function aggiorna(tipo, cat, val) {
    setCashflow(prev => ({
      ...prev,
      [sede]: {
        ...prev[sede],
        [mese]: {
          ...prev[sede][mese],
          [tipo]: { ...(prev[sede][mese]?.[tipo] || {}), [cat]: Number(val) || 0 }
        }
      }
    }));
  }
  function totEnt(m) { return Object.values(cf[m]?.entrate || {}).reduce((s, v) => s + Number(v||0), 0); }
  function totUsc(m) { return Object.values(cf[m]?.uscite  || {}).reduce((s, v) => s + Number(v||0), 0); }
  function marg(m)   { return totEnt(m) - totUsc(m); }
  const totAE  = Array.from({length:12}, (_, i) => i).reduce((s, m) => s + totEnt(m), 0);
  const totAU  = Array.from({length:12}, (_, i) => i).reduce((s, m) => s + totUsc(m), 0);
  const grafData = Array.from({length:12}, (_, m) => ({ label:MESI[m], entrate:totEnt(m), uscite:totUsc(m), margine:marg(m) }));
  const mM = marg(mese);

  // ─── helpers giornaliero ───────────────────────────────────────────────────
  const dayKey = `${sede}::${dayDate}`;
  const dayData = cfDaily[dayKey] || { entrate:{}, uscite:{} };

  function aggiornaDay(tipo, cat, val) {
    setCfDaily(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [tipo]: { ...(prev[dayKey]?.[tipo] || {}), [cat]: Number(val) || 0 }
      }
    }));
  }

  function totDayEnt(dk) {
    const d = cfDaily[`${sede}::${dk}`];
    return CF_CATS_ENT.reduce((s, c) => s + Number(d?.entrate?.[c] || 0), 0);
  }
  function totDayUsc(dk) {
    const d = cfDaily[`${sede}::${dk}`];
    return CF_CATS_USC.reduce((s, c) => s + Number(d?.uscite?.[c] || 0), 0);
  }
  function dayEnt(cat) { return Number(dayData?.entrate?.[cat] || 0); }
  function dayUsc(cat) { return Number(dayData?.uscite?.[cat] || 0); }
  const totDE = CF_CATS_ENT.reduce((s, c) => s + dayEnt(c), 0);
  const totDU = CF_CATS_USC.reduce((s, c) => s + dayUsc(c), 0);
  const dayMarg = totDE - totDU;

  // ─── helpers settimanale ──────────────────────────────────────────────────
  const weekDates = cfGetWeekDates(weekISO);
  function weekEnt(iso) { return totDayEnt(iso); }
  function weekUsc(iso) { return totDayUsc(iso); }
  const totWE = weekDates.reduce((s, d) => s + weekEnt(d), 0);
  const totWU = weekDates.reduce((s, d) => s + weekUsc(d), 0);
  const weekMarg = totWE - totWU;
  const weekGrafData = weekDates.map((iso, i) => ({
    label: GIORNI_SHORT[i],
    entrate: weekEnt(iso),
    uscite: weekUsc(iso),
    margine: weekEnt(iso) - weekUsc(iso),
    date: formatDateIT(iso),
  }));

  function prevWeek() {
    const dates = cfGetWeekDates(weekISO);
    setWeekISO(cfGetWeekISO(shiftISODate(dates[0], -7)));
  }
  function nextWeek() {
    const dates = cfGetWeekDates(weekISO);
    setWeekISO(cfGetWeekISO(shiftISODate(dates[0], 7)));
  }

  const TABS = [
    ["giornaliero","📅 Giornaliero"],
    ["settimanale","📆 Settimanale"],
    ["mensile","📅 Mensile"],
    ["annuale","📊 Annuale"],
    ["grafici","📈 Grafici"],
  ];

  const tabBtn = (id) => ({
    padding:"5px 12px", fontSize:11, border:"1px solid var(--k2-border)",
    cursor:"pointer", borderRadius:4, fontFamily:"inherit",
    background: tab===id ? "#c8a96e" : "transparent",
    color: tab===id ? "var(--k2-bg)" : "var(--k2-text-muted)",
    whiteSpace:"nowrap",
  });

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display:"flex", gap:4, marginBottom:16, flexWrap:"wrap", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={tabBtn(id)}>{label}</button>
          ))}
        </div>
        {(tab === "mensile" || tab === "giornaliero") && (
          <button onClick={() => setEditMode(e => !e)} style={{ ...btnS, fontSize:11 }}>
            {editMode ? "✓ Fine" : "✏️ Modifica"}
          </button>
        )}
      </div>

      {/* ── TAB GIORNALIERO ─────────────────────────────────────────────── */}
      {tab === "giornaliero" && (
        <div>
          {/* Navigazione data */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <button onClick={() => setDayDate(shiftISODate(dayDate,-1))} style={{ ...btnS, padding:"4px 10px", fontSize:14 }}>‹</button>
            <input
              type="date" value={dayDate}
              onChange={e => setDayDate(e.target.value)}
              style={{ ...inp, width:160, textAlign:"center", fontSize:13 }}
            />
            <button onClick={() => setDayDate(shiftISODate(dayDate,1))} style={{ ...btnS, padding:"4px 10px", fontSize:14 }}>›</button>
            <button onClick={() => setDayDate(today())} style={{ ...btnS, fontSize:10 }}>Oggi</button>
            <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
              {GIORNI_SHORT[parseISODate(dayDate).getDay() === 0 ? 6 : parseISODate(dayDate).getDay()-1]}
            </span>
          </div>

          {/* KPI giorno */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
            {[{l:"Entrate",v:totDE,c:"#4ade80"},{l:"Uscite",v:totDU,c:"#f87171"},{l:"Margine",v:dayMarg,c:dayMarg>=0?"#4ade80":"#f87171"}].map(k => (
              <div key={k.l} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:22, fontWeight:"bold", color:k.c }}>{fmtE(k.v)}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* Entrate giornaliere */}
          <div style={card}>
            <div style={{ fontSize:10, color:"#4ade80", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>↑ Entrate</div>
            {CF_CATS_ENT.map(cat => (
              <div key={cat} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid var(--k2-border)" }}>
                <span style={{ fontSize:13, color:"var(--k2-text-secondary)" }}>{cat}</span>
                {editMode
                  ? <input type="number" value={dayEnt(cat)||""} onChange={e => aggiornaDay("entrate",cat,e.target.value)} style={{ ...inp, width:110, textAlign:"right" }} min="0" placeholder="0"/>
                  : <span style={{ fontSize:14, fontWeight:"bold", color:"#4ade80" }}>{fmtE(dayEnt(cat))}</span>
                }
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:8 }}>
              <span style={{ fontSize:12, color:"var(--k2-text-dim)", fontWeight:"bold" }}>TOTALE ENTRATE</span>
              <span style={{ fontSize:15, color:"#4ade80", fontWeight:"bold" }}>{fmtE(totDE)}</span>
            </div>
          </div>

          {/* Uscite giornaliere */}
          <div style={card}>
            <div style={{ fontSize:10, color:"#f87171", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>↓ Uscite</div>
            {CF_CATS_USC.map(cat => (
              <div key={cat} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid var(--k2-border)" }}>
                <span style={{ fontSize:13, color:"var(--k2-text-secondary)" }}>{cat}</span>
                {editMode
                  ? <input type="number" value={dayUsc(cat)||""} onChange={e => aggiornaDay("uscite",cat,e.target.value)} style={{ ...inp, width:110, textAlign:"right" }} min="0" placeholder="0"/>
                  : <span style={{ fontSize:14, fontWeight:"bold", color:"#f87171" }}>{fmtE(dayUsc(cat))}</span>
                }
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:8 }}>
              <span style={{ fontSize:12, color:"var(--k2-text-dim)", fontWeight:"bold" }}>TOTALE USCITE</span>
              <span style={{ fontSize:15, color:"#f87171", fontWeight:"bold" }}>{fmtE(totDU)}</span>
            </div>
          </div>

          {/* Margine giorno */}
          <div style={{ ...card, borderColor:(dayMarg>=0?"#4ade80":"#f87171")+"44", background:dayMarg>=0?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)", textAlign:"center" }}>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>
              Margine {formatDateIT(dayDate)}
            </div>
            <div style={{ fontSize:36, fontWeight:"bold", color:dayMarg>=0?"#4ade80":"#f87171" }}>
              {dayMarg>=0?"+":""}{fmtE(dayMarg)}
            </div>
            <div style={{ fontSize:11, color:dayMarg>=0?"#4ade80":"#f87171", marginTop:4 }}>
              {dayMarg>=0 ? "Giornata positiva ✓" : "Giornata in perdita ⚠️"}
            </div>
          </div>

          {/* Ultimi 7 giorni — mini riepilogo */}
          <div style={card}>
            <div style={{ fontSize:10, color:"#c8a96e", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>
              Ultimi 7 giorni · {sede}
            </div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--k2-border)" }}>
                  {["Data","Giorno","Entrate","Uscite","Margine"].map((h,i) => (
                    <th key={h} style={{ padding:"4px 6px", fontSize:9, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", textAlign:i<2?"left":"right", fontWeight:"normal" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({length:7}, (_,i) => shiftISODate(today(), -6+i)).map(iso => {
                  const e = totDayEnt(iso), u = totDayUsc(iso), mg = e - u;
                  const isToday = iso === today();
                  const isSel = iso === dayDate;
                  const dow = parseISODate(iso).getDay();
                  const gIdx = dow === 0 ? 6 : dow - 1;
                  return (
                    <tr key={iso}
                      onClick={() => { setDayDate(iso); }}
                      style={{ borderBottom:"1px solid var(--k2-border)44", cursor:"pointer",
                        background: isSel ? "#c8a96e1a" : isToday ? "rgba(200,169,110,0.06)" : "transparent" }}
                    >
                      <td style={{ padding:"7px 6px", fontSize:12, color:isSel?"#c8a96e":isToday?"#c8a96e88":"var(--k2-text-secondary)" }}>{formatDateIT(iso)}</td>
                      <td style={{ padding:"7px 6px", fontSize:11, color:"var(--k2-text-dim)" }}>{GIORNI_SHORT[gIdx]}</td>
                      <td style={{ padding:"7px 6px", fontSize:12, color:"#4ade80", textAlign:"right" }}>{e>0?fmtE(e):"—"}</td>
                      <td style={{ padding:"7px 6px", fontSize:12, color:"#f87171", textAlign:"right" }}>{u>0?fmtE(u):"—"}</td>
                      <td style={{ padding:"7px 6px", fontSize:12, fontWeight:"bold", color:mg>=0?"#4ade80":"#f87171", textAlign:"right" }}>
                        {(e>0||u>0) ? (mg>=0?"+":"")+fmtE(mg) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB SETTIMANALE ─────────────────────────────────────────────── */}
      {tab === "settimanale" && (
        <div>
          {/* Nav settimana */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <button onClick={prevWeek} style={{ ...btnS, padding:"4px 10px", fontSize:14 }}>‹</button>
            <div style={{ flex:1, textAlign:"center" }}>
              <div style={{ fontSize:13, color:"var(--k2-text)", fontWeight:"bold" }}>{weekISO}</div>
              <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                {formatDateIT(weekDates[0])} — {formatDateIT(weekDates[6])}
              </div>
            </div>
            <button onClick={nextWeek} style={{ ...btnS, padding:"4px 10px", fontSize:14 }}>›</button>
            <button onClick={() => setWeekISO(cfGetWeekISO(today()))} style={{ ...btnS, fontSize:10 }}>Questa</button>
          </div>

          {/* KPI settimana */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
            {[{l:"Entrate sett.",v:totWE,c:"#4ade80"},{l:"Uscite sett.",v:totWU,c:"#f87171"},{l:"Margine sett.",v:weekMarg,c:weekMarg>=0?"#4ade80":"#f87171"}].map(k => (
              <div key={k.l} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:21, fontWeight:"bold", color:k.c }}>{fmtE(k.v)}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* Grafico settimana */}
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:10 }}>Entrate vs Uscite — {weekISO}</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weekGrafData} margin={{ top:0, right:0, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
                <XAxis dataKey="label" tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => "€"+v}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Bar dataKey="entrate" name="Entrate" fill="#4ade80" radius={[3,3,0,0]}/>
                <Bar dataKey="uscite"  name="Uscite"  fill="#f87171" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tabella giornaliera della settimana */}
          <div style={card}>
            <div style={{ fontSize:10, color:"#c8a96e", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>
              Dettaglio giorni — {sede}
            </div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--k2-border)" }}>
                  {["Giorno","Data","Entrate","Uscite","Margine",""].map((h,i) => (
                    <th key={i} style={{ padding:"4px 8px", fontSize:9, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", textAlign:i<2?"left":"right", fontWeight:"normal" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekDates.map((iso, i) => {
                  const e = weekEnt(iso), u = weekUsc(iso), mg = e - u;
                  const isToday = iso === today();
                  return (
                    <tr key={iso} style={{ borderBottom:"1px solid var(--k2-border)44", background: isToday ? "rgba(200,169,110,0.07)":"transparent" }}>
                      <td style={{ padding:"8px", fontSize:12, color:isToday?"#c8a96e":"var(--k2-text-secondary)", fontWeight:isToday?"bold":"normal" }}>{GIORNI_SHORT[i]}{isToday?" ◀":""}</td>
                      <td style={{ padding:"8px", fontSize:11, color:"var(--k2-text-dim)" }}>{formatDateIT(iso)}</td>
                      <td style={{ padding:"8px", fontSize:12, color:"#4ade80", textAlign:"right" }}>{e>0?fmtE(e):"—"}</td>
                      <td style={{ padding:"8px", fontSize:12, color:"#f87171", textAlign:"right" }}>{u>0?fmtE(u):"—"}</td>
                      <td style={{ padding:"8px", fontSize:13, fontWeight:"bold", color:mg>=0?"#4ade80":"#f87171", textAlign:"right" }}>
                        {(e>0||u>0) ? (mg>=0?"+":"")+fmtE(mg) : "—"}
                      </td>
                      <td style={{ padding:"8px", textAlign:"right" }}>
                        <button onClick={() => { setDayDate(iso); setTab("giornaliero"); }} style={{ ...btnS, fontSize:9, padding:"2px 7px" }}>↗</button>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop:"2px solid var(--k2-border)", fontWeight:"bold" }}>
                  <td colSpan={2} style={{ padding:"8px", fontSize:12, color:"var(--k2-text-dim)" }}>TOTALE SETTIMANA</td>
                  <td style={{ padding:"8px", fontSize:13, color:"#4ade80", textAlign:"right" }}>{fmtE(totWE)}</td>
                  <td style={{ padding:"8px", fontSize:13, color:"#f87171", textAlign:"right" }}>{fmtE(totWU)}</td>
                  <td style={{ padding:"8px", fontSize:14, color:weekMarg>=0?"#4ade80":"#f87171", textAlign:"right" }}>{weekMarg>=0?"+":""}{fmtE(weekMarg)}</td>
                  <td/>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Media giornaliera settimana */}
          {(totWE > 0 || totWU > 0) && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              {[
                {l:"Media/giorno Entrate", v:totWE/7, c:"#4ade80"},
                {l:"Media/giorno Uscite",  v:totWU/7, c:"#f87171"},
                {l:"Media/giorno Margine", v:weekMarg/7, c:weekMarg>=0?"#4ade80":"#f87171"},
              ].map(k => (
                <div key={k.l} style={{ ...card, marginBottom:0, textAlign:"center" }}>
                  <div style={{ fontSize:17, fontWeight:"bold", color:k.c }}>{fmtE(k.v)}</div>
                  <div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB MENSILE ─────────────────────────────────────────────────── */}
      {tab === "mensile" && (
        <div>
          <div style={{ display:"flex", gap:4, marginBottom:14, flexWrap:"wrap" }}>
            {MESI.map((m, i) => <button key={i} onClick={() => setMese(i)} style={{ padding:"4px 10px", fontSize:10, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:mese===i?"#c8a96e":marg(i)<0?"rgba(248,113,113,0.1)":"transparent", color:mese===i?"var(--k2-bg)":marg(i)<0?"#f87171":"var(--k2-text-muted)" }}>{m}</button>)}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
            {[{l:"Entrate",v:totEnt(mese),c:"#4ade80"},{l:"Uscite",v:totUsc(mese),c:"#f87171"},{l:"Margine",v:mM,c:mM>=0?"#4ade80":"#f87171"}].map(k => (
              <div key={k.l} style={{ ...card, marginBottom:0, textAlign:"center" }}><div style={{ fontSize:21, fontWeight:"bold", color:k.c }}>{fmtE(k.v)}</div><div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.l} {MESI[mese]}</div></div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize:10, color:"#4ade80", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>↑ Entrate</div>
            {Object.entries(cf[mese]?.entrate || {}).map(([cat, val]) => (
              <div key={cat} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid var(--k2-border)" }}>
                <span style={{ fontSize:13, color:"var(--k2-text-secondary)" }}>{cat}</span>
                {editMode ? <input type="number" value={val||""} onChange={e => aggiorna("entrate",cat,e.target.value)} style={{ ...inp, width:110, textAlign:"right" }} min="0"/> : <span style={{ fontSize:14, fontWeight:"bold", color:"#4ade80" }}>{fmtE(val||0)}</span>}
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:8, fontWeight:"bold" }}><span style={{ fontSize:12, color:"var(--k2-text-dim)" }}>TOTALE ENTRATE</span><span style={{ fontSize:15, color:"#4ade80" }}>{fmtE(totEnt(mese))}</span></div>
          </div>
          <div style={card}>
            <div style={{ fontSize:10, color:"#f87171", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>↓ Uscite</div>
            {Object.entries(cf[mese]?.uscite || {}).map(([cat, val]) => (
              <div key={cat} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid var(--k2-border)" }}>
                <span style={{ fontSize:13, color:"var(--k2-text-secondary)" }}>{cat}</span>
                {editMode ? <input type="number" value={val||""} onChange={e => aggiorna("uscite",cat,e.target.value)} style={{ ...inp, width:110, textAlign:"right" }} min="0"/> : <span style={{ fontSize:14, fontWeight:"bold", color:"#f87171" }}>{fmtE(val||0)}</span>}
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:8, fontWeight:"bold" }}><span style={{ fontSize:12, color:"var(--k2-text-dim)" }}>TOTALE USCITE</span><span style={{ fontSize:15, color:"#f87171" }}>{fmtE(totUsc(mese))}</span></div>
          </div>
          <div style={{ ...card, borderColor:(mM>=0?"#4ade80":"#f87171")+"44", background:mM>=0?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)", textAlign:"center" }}>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Margine {MESI[mese]} {ANNO}</div>
            <div style={{ fontSize:38, fontWeight:"bold", color:mM>=0?"#4ade80":"#f87171" }}>{mM>=0?"+":""}{fmtE(mM)}</div>
            <div style={{ fontSize:11, color:mM>=0?"#4ade80":"#f87171", marginTop:4 }}>{mM>=0?"Mese positivo ✓":"Mese in perdita ⚠️"}</div>
          </div>
        </div>
      )}

      {/* ── TAB ANNUALE ─────────────────────────────────────────────────── */}
      {tab === "annuale" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
            {[{l:"Entrate anno",v:totAE,c:"#4ade80"},{l:"Uscite anno",v:totAU,c:"#f87171"},{l:"Margine anno",v:totAE-totAU,c:totAE-totAU>=0?"#4ade80":"#f87171"}].map(k => (
              <div key={k.l} style={{ ...card, marginBottom:0, textAlign:"center" }}><div style={{ fontSize:21, fontWeight:"bold", color:k.c }}>{fmtE(k.v)}</div><div style={{ fontSize:9, color:"var(--k2-text-dim)", marginTop:3 }}>{k.l}</div></div>
            ))}
          </div>
          <div style={card}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr style={{ borderBottom:"1px solid var(--k2-border)" }}>{["Mese","Entrate","Uscite","Margine"].map((h, i) => <th key={h} style={{ padding:"6px 10px", fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", textAlign:i===0?"left":"right", fontWeight:"normal" }}>{h}</th>)}</tr></thead>
              <tbody>
                {Array.from({length:12}, (_, m) => {
                  const e = totEnt(m), u = totUsc(m), mg = marg(m);
                  const isCur = m === new Date().getMonth();
                  return (
                    <tr key={m} onClick={() => { setMese(m); setTab("mensile"); }} style={{ borderBottom:"1px solid var(--k2-border)", cursor:"pointer", background:isCur?"rgba(200,169,110,0.05)":m%2===0?"transparent":"var(--k2-bg-deep)" }}>
                      <td style={{ padding:"8px 10px", fontSize:13, color:isCur?"#c8a96e":"var(--k2-text-secondary)", fontWeight:isCur?"bold":"normal" }}>{MESI[m]}{isCur?" ←":""}</td>
                      <td style={{ padding:"8px 10px", fontSize:13, color:"#4ade80", textAlign:"right" }}>{e>0?fmtE(e):"—"}</td>
                      <td style={{ padding:"8px 10px", fontSize:13, color:"#f87171", textAlign:"right" }}>{u>0?fmtE(u):"—"}</td>
                      <td style={{ padding:"8px 10px", fontSize:14, fontWeight:"bold", color:mg>=0?"#4ade80":"#f87171", textAlign:"right" }}>{(e>0||u>0)?(mg>=0?"+":"")+fmtE(mg):"—"}</td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop:"2px solid var(--k2-border)", fontWeight:"bold" }}>
                  <td style={{ padding:"8px 10px", fontSize:13, color:"var(--k2-text-dim)" }}>TOTALE {ANNO}</td>
                  <td style={{ padding:"8px 10px", fontSize:14, color:"#4ade80", textAlign:"right" }}>{fmtE(totAE)}</td>
                  <td style={{ padding:"8px 10px", fontSize:14, color:"#f87171", textAlign:"right" }}>{fmtE(totAU)}</td>
                  <td style={{ padding:"8px 10px", fontSize:15, color:totAE-totAU>=0?"#4ade80":"#f87171", textAlign:"right" }}>{fmtE(totAE-totAU)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB GRAFICI ─────────────────────────────────────────────────── */}
      {tab === "grafici" && (
        <div>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:12 }}>Entrate vs Uscite — {ANNO}</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={grafData} margin={{ top:0, right:0, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
                <XAxis dataKey="label" tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => "€"+v}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Bar dataKey="entrate" name="Entrate" fill="#4ade80" radius={[3,3,0,0]}/>
                <Bar dataKey="uscite"  name="Uscite"  fill="#f87171" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:10 }}>Settimana corrente — {weekISO}</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weekGrafData} margin={{ top:0, right:0, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
                <XAxis dataKey="label" tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => "€"+v}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Bar dataKey="entrate" name="Entrate" fill="#4ade80" radius={[3,3,0,0]}/>
                <Bar dataKey="uscite"  name="Uscite"  fill="#f87171" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={card}>
            <div style={{ fontSize:11, color:"#c8a96e", marginBottom:12 }}>Margine mensile — {ANNO}</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={grafData} margin={{ top:0, right:0, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--k2-border)"/>
                <XAxis dataKey="label" tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"var(--k2-text-dim)", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => "€"+v}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Line type="monotone" dataKey="margine" name="Margine" stroke="#c8a96e" strokeWidth={2} dot={({ cx, cy, payload }) => <circle key={payload.label} cx={cx} cy={cy} r={4} fill={payload.margine>=0?"#4ade80":"#f87171"} stroke="none"/>} activeDot={{ r:6 }}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPOSTAZIONI — con storico prezzi ingredienti
// ═══════════════════════════════════════════════════════════════════════════════
function Impostazioni({ costiF, setCostiF, ingredients, setIngredients, recipes, goodsReceipts = [], haccpTraceability = [], suppliers = [], checklistLogs = [], turniStaff = [], staffList = [], inventoryAudits = [], purchaseOrders = [], authUsers = [], setAuthUsers = null, currentUserId = "", setCurrentUserId = null, currentUserRole = "admin", onFullReset, onResetMovimenti, onResetIncassi }) {
  const [tab, setTab] = useState("costi");
  const [selIng, setSelIng] = useState(null);
  const [newPrice, setNewPrice] = useState("");
  const [resetConfirm, setResetConfirm] = useState(""); // testo di conferma digitato dall'utente

  function updateIngredientPrice(ing) {
    const p = Number(newPrice);
    if (!p || p <= 0) return;
    const oldCost = ing.cost;
    const newCost = p / 100; // input utente in €/100g → converti in €/g
    const entry   = { date: today(), oldCost, newCost, purchasePrice: p, supplier: ing.supplier || "", note: "Aggiornamento manuale da Impostazioni" };
    setIngredients(prev => prev.map(i => i.id === ing.id
      ? { ...i, cost: newCost, netCostPerGram: newCost, purchasePrice: p, lastPriceUpdate: today(), priceHistory: [...(i.priceHistory||[]), entry] }
      : i
    ));
    setNewPrice("");
    setSelIng(null);
  }

  const [diagRunning, setDiagRunning] = React.useState(false);
  const [diagResult, setDiagResult]   = React.useState(null);
  const [diagFilter, setDiagFilter]   = React.useState("tutti");

  function runAutodiagnosi() {
    setDiagRunning(true);
    setDiagResult(null);
    setTimeout(() => {
      const tests = [];
      const ts = (modulo, nome, ok, severity, dettaglio, fix) =>
        tests.push({ modulo, nome, ok, severity: ok ? "ok" : severity, dettaglio, fix });

      const activeIng  = (ingredients||[]).filter(i => i.active !== false);
      const activeRec  = (recipes||[]).filter(r => r.active !== false);
      const now        = new Date().toISOString();

      // ── STORAGE ──────────────────────────────────────────────────────────
      const hasStorage = !!(window?.storage?.get);
      ts("Sistema", "Storage disponibile", hasStorage, "critico",
        hasStorage ? "window.storage operativo." : "window.storage non trovato — i dati non vengono salvati.",
        hasStorage ? null : "Verifica che il sito sia aperto su Netlify (non da file locale).");

      let lsOk = false;
      try { localStorage.setItem("k2-test", "1"); localStorage.removeItem("k2-test"); lsOk = true; } catch(_) {}
      ts("Sistema", "localStorage disponibile", lsOk, "critico",
        lsOk ? "localStorage operativo." : "localStorage bloccato (modalità privata o cookie disabilitati).",
        lsOk ? null : "Abilita i cookie o esci dalla navigazione privata.");

      // ── PWA ───────────────────────────────────────────────────────────────
      const swOk = "serviceWorker" in navigator;
      ts("PWA", "Service Worker supportato", swOk, "minore",
        swOk ? "Il browser supporta i Service Worker." : "Browser non supporta SW — la PWA non funzionerà offline.",
        swOk ? null : "Usa Chrome o Edge aggiornati.");
      const manifestOk = !!document.querySelector('link[rel="manifest"]');
      ts("PWA", "Manifest collegato", manifestOk, "medio",
        manifestOk ? "manifest.json presente nel documento." : "Nessun manifest trovato.",
        manifestOk ? null : "Ri-deploya su Netlify con il file manifest.json.");
      const httpsOk = location.protocol === "https:" || location.hostname === "localhost";
      ts("PWA", "Connessione HTTPS", httpsOk, "critico",
        httpsOk ? `Connessione sicura: ${location.origin}` : "Il sito non usa HTTPS — PWA e SW non funzioneranno.",
        httpsOk ? null : "Assicurati che Netlify abbia SSL attivo.");

      // ── RICETTE ───────────────────────────────────────────────────────────
      ts("Ricette", "Ricette presenti", activeRec.length > 0, "medio",
        `${activeRec.length} ricette attive.`,
        activeRec.length === 0 ? "Aggiungi almeno una ricetta nel modulo Food Cost." : null);
      const recSenzaIng = activeRec.filter(r => !(r.ingredients||[]).length);
      ts("Ricette", "Ricette con ingredienti", recSenzaIng.length === 0, "medio",
        recSenzaIng.length === 0 ? "Tutte le ricette hanno almeno un ingrediente." : `${recSenzaIng.length} ricette senza ingredienti: ${recSenzaIng.map(r=>r.name).slice(0,3).join(", ")}`,
        recSenzaIng.length > 0 ? "Completa le ricette nel modulo Food Cost." : null);
      const recIng404 = activeRec.filter(r => (r.ingredients||[]).some(ri => !ingredients.find(i=>i.id===ri.id)));
      ts("Ricette", "Nessun ingrediente mancante", recIng404.length === 0, "critico",
        recIng404.length === 0 ? "Tutti i collegamenti ricetta→ingrediente sono validi." : `${recIng404.length} ricette con ingredienti non trovati: ${recIng404.map(r=>r.name).slice(0,3).join(", ")}`,
        recIng404.length > 0 ? "Verifica e ricollega gli ingredienti nelle ricette." : null);
      const recNoYield = activeRec.filter(r => !(r.yield_g > 0));
      ts("Ricette", "Resa impostata", recNoYield.length === 0, "medio",
        recNoYield.length === 0 ? "Tutte le ricette hanno la resa impostata." : `${recNoYield.length} ricette senza resa_g: costo/kg non calcolabile.`,
        recNoYield.length > 0 ? "Imposta la resa in grammi per ogni ricetta." : null);

      // ── INGREDIENTI ───────────────────────────────────────────────────────
      ts("Ingredienti", "Ingredienti presenti", activeIng.length > 0, "critico",
        `${activeIng.length} ingredienti attivi.`,
        activeIng.length === 0 ? "Nessun ingrediente — il sistema non è operativo." : null);
      const ingNoCost = activeIng.filter(i => !(i.cost > 0));
      ts("Ingredienti", "Prezzi impostati", ingNoCost.length === 0, "medio",
        ingNoCost.length === 0 ? "Tutti gli ingredienti hanno un costo." : `${ingNoCost.length} ingredienti senza prezzo: ${ingNoCost.map(i=>i.name).slice(0,4).join(", ")}`,
        ingNoCost.length > 0 ? "Imposta il costo in Impostazioni → Aggiorna Prezzi." : null);
      const ingNoAllerg = activeIng.filter(i => !(i.allergens||[]).length);
      ts("Ingredienti", "Allergeni configurati", ingNoAllerg.length < activeIng.length * 0.5, "minore",
        `${activeIng.length - ingNoAllerg.length}/${activeIng.length} ingredienti con allergeni dichiarati.`,
        ingNoAllerg.length >= activeIng.length * 0.5 ? "Molti ingredienti senza allergeni — etichette EU potrebbero essere incomplete." : null);
      const ingNoNutr = activeIng.filter(i => !i.nutritionPer100g || Object.values(i.nutritionPer100g).every(v=>!v));
      ts("Ingredienti", "Valori nutrizionali", ingNoNutr.length < activeIng.length * 0.7, "minore",
        `${activeIng.length - ingNoNutr.length}/${activeIng.length} ingredienti con dati nutrizionali.`,
        ingNoNutr.length >= activeIng.length * 0.7 ? "Molti ingredienti senza valori nutrizionali — tabella nutrizionale etichette non accurata." : null);

      // ── MAGAZZINO ─────────────────────────────────────────────────────────
      const ingNoStock = activeIng.filter(i => i.stockEnabled !== false && SEDI.every(s => !(i.stockBySede?.[s]?.minStock_g > 0)));
      ts("Magazzino", "Scorte minime impostate", ingNoStock.length < activeIng.length * 0.5, "medio",
        `${activeIng.length - ingNoStock.length}/${activeIng.length} ingredienti con scorta minima.`,
        ingNoStock.length >= activeIng.length * 0.5 ? "Imposta le scorte minime nel Magazzino per ricevere avvisi di riordino." : null);
      const sottoscortaTot = activeIng.filter(i => SEDI.some(s => {
        const st = i.stockBySede?.[s]; return st && st.minStock_g > 0 && st.currentStock_g < st.minStock_g;
      }));
      ts("Magazzino", "Nessun articolo sottoscorta", sottoscortaTot.length === 0, "medio",
        sottoscortaTot.length === 0 ? "Tutti gli stock sono sopra il minimo." : `${sottoscortaTot.length} ingredienti sottoscorta: ${sottoscortaTot.map(i=>i.name).slice(0,4).join(", ")}`,
        sottoscortaTot.length > 0 ? "Riordina tramite Lista della Spesa." : null);

      // ── FORNITORI ─────────────────────────────────────────────────────────
      const activeSup = (suppliers||[]).filter(s => s.active !== false);
      ts("Fornitori", "Fornitori presenti", activeSup.length > 0, "medio",
        `${activeSup.length} fornitori attivi.`,
        activeSup.length === 0 ? "Aggiungi i fornitori nel modulo Fornitori." : null);
      const supNoProd = activeSup.filter(s => !(s.products||[]).length);
      ts("Fornitori", "Catalogo prodotti", supNoProd.length === 0, "minore",
        supNoProd.length === 0 ? "Tutti i fornitori hanno almeno un prodotto nel catalogo." : `${supNoProd.length} fornitori senza prodotti: ${supNoProd.map(s=>s.name).slice(0,3).join(", ")}`,
        supNoProd.length > 0 ? "Aggiungi il catalogo prodotti nelle schede fornitore." : null);
      const supNoRef = activeSup.filter(s => !s.telefono && !s.email);
      ts("Fornitori", "Contatti fornitori", supNoRef.length === 0, "minore",
        supNoRef.length === 0 ? "Tutti i fornitori hanno almeno un contatto." : `${supNoRef.length} fornitori senza telefono né email.`,
        supNoRef.length > 0 ? "Completa i dati di contatto nelle schede fornitore." : null);

      // ── HACCP ─────────────────────────────────────────────────────────────
      ts("HACCP", "Ricevimenti merce presenti", (goodsReceipts||[]).length > 0, "minore",
        `${(goodsReceipts||[]).length} ricevimenti registrati.`,
        (goodsReceipts||[]).length === 0 ? "Registra i ricevimenti merce per la tracciabilità HACCP." : null);
      const traceNoLotti = (haccpTraceability||[]).filter(r => !(r.ingredientLots||[]).length);
      ts("HACCP", "Tracciabilità senza lotti vuota", traceNoLotti.length === 0, "critico",
        traceNoLotti.length === 0 ? "Tutte le righe di tracciabilità hanno lotti associati." : `${traceNoLotti.length} righe senza lotti — non conformità HACCP.`,
        traceNoLotti.length > 0 ? "Verifica e associa i lotti nelle righe di tracciabilità." : null);

      // ── STAFF ─────────────────────────────────────────────────────────────
      ts("Staff", "Staff configurato", (staffList||[]).filter(s=>s.attiva!==false).length > 0, "minore",
        `${(staffList||[]).filter(s=>s.attiva!==false).length} dipendenti attivi.`,
        (staffList||[]).filter(s=>s.attiva!==false).length === 0 ? "Aggiungi almeno un dipendente nel modulo Turni." : null);
      ts("Checklist", "Log checklist presenti", (checklistLogs||[]).length > 0, "minore",
        `${(checklistLogs||[]).length} checklist registrate.`,
        (checklistLogs||[]).length === 0 ? "Nessuna checklist operativa completata." : null);

      // ── COSTI FISSI ───────────────────────────────────────────────────────
      const { manodopera, energia, porzioni_mensili } = costiF || {};
      ts("Food Cost", "Costi fissi impostati", manodopera > 0 && energia > 0, "medio",
        manodopera > 0 && energia > 0 ? `Manodopera €${manodopera} · Energia €${energia} · ${porzioni_mensili} porzioni/mese.` : "Manodopera o energia a zero — il food cost indiretto non è calcolato.",
        !(manodopera > 0 && energia > 0) ? "Imposta i costi fissi in Impostazioni → Costi Fissi." : null);

      // ── INVENTARIO ────────────────────────────────────────────────────────
      ts("Inventario", "Chiusure inventario", (inventoryAudits||[]).length > 0, "minore",
        `${(inventoryAudits||[]).length} chiusure inventario registrate.`,
        (inventoryAudits||[]).length === 0 ? "Effettua almeno una chiusura inventario per tenere traccia delle differenze." : null);

      const critici = tests.filter(t=>!t.ok && t.severity==="critico").length;
      const medi    = tests.filter(t=>!t.ok && t.severity==="medio").length;
      const minori  = tests.filter(t=>!t.ok && t.severity==="minore").length;
      const ok      = tests.filter(t=> t.ok).length;
      const score   = Math.round((ok / tests.length) * 100);

      setDiagResult({ tests, counts:{ ok, critici, medi, minori }, score, runAt:now });
      setDiagRunning(false);
    }, 900);
  }

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:17, fontWeight:"normal" }}>⚙️ Impostazioni</h2>
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {[["costi","Costi Fissi"],["prezzi","Aggiorna Prezzi"],["ingredienti","Ingredienti archiviati"],["diagnostica","🩺 Diagnostica"],["utenti","👥 Utenti"],["reset","🗑️ Reset"]].map(([id,label]) => (
          <button key={id} onClick={() => { setTab(id); setResetConfirm(""); }} style={{ padding:"5px 12px", fontSize:11, border: id==="reset" ? "1px solid #3a2020" : "1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id ? (id==="reset" ? "#3a2020" : "#c8a96e") : "transparent", color:tab===id ? (id==="reset" ? "#f87171" : "var(--k2-bg)") : (id==="reset" ? "#7a3030" : "var(--k2-text-muted)") }}>{label}</button>
        ))}
      </div>

      {tab === "costi" && (
        <>
          <div style={{ ...card, borderColor:"#60a5fa44" }}>
            <div style={{ fontSize:11, color:"#60a5fa", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>💼 Costi Fissi Mensili</div>
            <div style={{ display:"grid", gap:14 }}>
              {[
                { key:"manodopera", label:"Manodopera", icon:"👷", min:0, max:20000, step:100 },
                { key:"energia",    label:"Energia",    icon:"⚡", min:0, max:5000,  step:50  },
                { key:"altro",      label:"Altri fissi (affitto, comm., assicur.)", icon:"🏠", min:0, max:10000, step:50 },
              ].map(({ key, label, icon, min, max, step }) => (
                <div key={key}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <label style={{ ...lbl, marginBottom:0 }}>{icon} {label}</label>
                    <span style={{ fontSize:16, fontWeight:"bold", color:"#60a5fa", fontFamily:"monospace" }}>{fmtE(costiF[key]||0)}</span>
                  </div>
                  <input type="range" min={min} max={max} step={step} value={costiF[key]||0} onChange={e => setCostiF(f => ({ ...f, [key]:Number(e.target.value) }))} style={sliderBg(costiF[key]||0, min, max)}/>
                  <input type="number" value={costiF[key]||""} onChange={e => setCostiF(f => ({ ...f, [key]:Number(e.target.value)||0 }))} style={{ ...inp, marginTop:5, fontSize:12 }}/>
                </div>
              ))}
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <label style={{ ...lbl, marginBottom:0 }}>📦 Packaging per porzione</label>
                  <span style={{ fontSize:16, fontWeight:"bold", color:"#60a5fa", fontFamily:"monospace" }}>{fmtE(costiF.packaging||0)}</span>
                </div>
                <input type="range" min={0} max={0.80} step={0.01} value={costiF.packaging||0} onChange={e => setCostiF(f => ({ ...f, packaging:Number(e.target.value) }))} style={sliderBg(costiF.packaging||0, 0, 0.80)}/>
                <input type="number" value={costiF.packaging||""} onChange={e => setCostiF(f => ({ ...f, packaging:Number(e.target.value)||0 }))} step="0.01" style={{ ...inp, marginTop:5, fontSize:12 }}/>
              </div>
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <label style={{ ...lbl, marginBottom:0 }}>🍦 Porzioni vendute al mese</label>
                  <span style={{ fontSize:16, fontWeight:"bold", color:"#60a5fa", fontFamily:"monospace" }}>{(costiF.porzioni_mensili||0).toLocaleString("it")}</span>
                </div>
                <input type="range" min={100} max={20000} step={100} value={costiF.porzioni_mensili||0} onChange={e => setCostiF(f => ({ ...f, porzioni_mensili:Number(e.target.value) }))} style={sliderBg(costiF.porzioni_mensili||0, 100, 20000)}/>
                <input type="number" value={costiF.porzioni_mensili||""} onChange={e => setCostiF(f => ({ ...f, porzioni_mensili:Number(e.target.value)||0 }))} style={{ ...inp, marginTop:5, fontSize:12 }}/>
              </div>
            </div>
          </div>

          <div style={{ ...card, borderColor:"#4ade8044" }}>
            <div style={{ fontSize:11, color:"#4ade80", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>📊 Default Simulatore</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div><label style={lbl}>Porzione default (g)</label><input type="number" value={costiF.porzione_default||150} onChange={e => setCostiF(f => ({ ...f, porzione_default:Number(e.target.value)||150 }))} style={inp}/></div>
              <div><label style={lbl}>Markup default (×)</label><input type="number" value={costiF.markup_default||3.5} onChange={e => setCostiF(f => ({ ...f, markup_default:Number(e.target.value)||3.5 }))} step="0.1" style={inp}/></div>
            </div>
          </div>

          <div style={{ ...card, background:"var(--k2-bg-green-tint)", border:"1px solid #2a4a2a" }}>
            <div style={{ fontSize:11, color:"#4ade80", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>📊 Riepilogo calcolato</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              {[
                ["Totale fissi/mese",     fmtE((costiF.manodopera||0)+(costiF.energia||0)+(costiF.altro||0))],
                ["Costo indiretto 120g",  fmtE(costoIndiretto(costiF,120))],
                ["Costo indiretto 150g",  fmtE(costoIndiretto(costiF,150))],
                ["Costo indiretto al kg", fmtE(costoIndiretto(costiF,1000))],
              ].map(([l, v]) => (
                <div key={l} style={{ background:"var(--k2-bg-green-card)", border:"1px solid #2a4a2a", borderRadius:5, padding:"9px", textAlign:"center" }}>
                  <div style={{ fontSize:15, fontWeight:"bold", color:"#4ade80" }}>{v}</div>
                  <div style={{ fontSize:8, color:"var(--k2-text-dim)", marginTop:2 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "prezzi" && (
        <div>
          <p style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:14 }}>Aggiorna il prezzo di acquisto di un ingrediente. Il sistema salva lo storico e ricalcola il costo per grammo.</p>
          <div style={card}>
            {ingredients.filter(i => i.active !== false).map(ing => {
              const lastHistory = ing.priceHistory?.[ing.priceHistory.length - 1];
              const impattate = findIngredientDependencies(ing.id, recipes);
              return (
                <div key={ing.id} style={{ padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:13, color:"var(--k2-text-secondary)" }}>{ing.name}</div>
                      <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                        Attuale: <span style={{ color:"#c8a96e", fontWeight:"bold" }}>{fmtE(ing.cost*100)}/100g</span>
                        {ing.lastPriceUpdate && <span style={{ marginLeft:8 }}>· Ult. agg.: {formatDateIT(ing.lastPriceUpdate)}</span>}
                        {impattate.length > 0 && <span style={{ marginLeft:8, color:"#fbbf24" }}>· {impattate.length} ricett{impattate.length===1?"a":"e"}</span>}
                      </div>
                    </div>
                    <button onClick={() => setSelIng(selIng?.id===ing.id?null:ing)} style={{ ...btnS, fontSize:10 }}>{selIng?.id===ing.id?"✕ Annulla":"✏️ Aggiorna"}</button>
                  </div>
                  {selIng?.id === ing.id && (
                    <div style={{ marginTop:10, display:"flex", gap:8, alignItems:"center" }}>
                      <div style={{ flex:1 }}>
                        <label style={lbl}>Nuovo prezzo (€ per 100g)</label>
                        <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} style={inp} step="0.01" placeholder={fmt(ing.cost*100)} autoFocus/>
                      </div>
                      <button onClick={() => updateIngredientPrice(ing)} style={{ ...btnP, alignSelf:"flex-end" }}>Salva</button>
                    </div>
                  )}
                  {/* Storico prezzi */}
                  {(ing.priceHistory||[]).length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ fontSize:9, color:"var(--k2-text-faint)", letterSpacing:"0.08em", marginBottom:4 }}>STORICO PREZZI</div>
                      {[...(ing.priceHistory||[])].reverse().slice(0,3).map((h, idx) => (
                        <div key={idx} style={{ fontSize:10, color:"var(--k2-text-dim)", display:"flex", gap:10 }}>
                          <span>{formatDateIT(h.date)}</span>
                          <span style={{ color:"#f87171" }}>{fmtE(h.oldCost*100)}/100g</span>
                          <span style={{ color:"#4ade80" }}>→ {fmtE(h.newCost*100)}/100g</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "ingredienti" && (
        <div>
          <p style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:14 }}>Ingredienti archiviati (non eliminabili perché usati in ricette storiche).</p>
          {ingredients.filter(i => i.active === false).length === 0 && (
            <div style={{ textAlign:"center", color:"var(--k2-text-faint)", padding:"32px" }}>Nessun ingrediente archiviato.</div>
          )}
          {ingredients.filter(i => i.active === false).map(ing => (
            <div key={ing.id} style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:13, color:"var(--k2-text-dim)" }}>{ing.name}</div>
                <div style={{ fontSize:10, color:"var(--k2-text-faint)" }}>Archiviato</div>
              </div>
              <button onClick={() => setIngredients(p => p.map(i => i.id===ing.id ? { ...i, active:true } : i))} style={{ ...btnS, fontSize:10 }}>♻️ Ripristina</button>
            </div>
          ))}
        </div>
      )}

      {tab === "diagnostica" && (
        <div style={{ display:"grid", gap:16 }}>

          {/* Pulsante avvia */}
          <div style={{ ...card, borderColor:"#60a5fa44", textAlign:"center", padding:28 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🩺</div>
            <div style={{ fontSize:16, fontWeight:"bold", marginBottom:6 }}>Autodiagnosi K2 Suite</div>
            <div style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:20 }}>
              Esegue {30} test su tutti i moduli: ricette, ingredienti, magazzino, fornitori, HACCP, PWA e storage.
            </div>
            <button
              onClick={runAutodiagnosi}
              disabled={diagRunning}
              style={{
                padding:"10px 32px", fontSize:14, fontWeight:"bold", cursor: diagRunning?"not-allowed":"pointer",
                border:"none", borderRadius:8, fontFamily:"inherit",
                background: diagRunning ? "#333" : "#60a5fa",
                color: diagRunning ? "#888" : "#000",
                transition:"all 0.2s",
              }}
            >
              {diagRunning ? "⏳ Analisi in corso…" : diagResult ? "🔄 Riesegui autodiagnosi" : "▶ Avvia autodiagnosi"}
            </button>
          </div>

          {/* Risultati */}
          {diagResult && (() => {
            const { tests, counts, score, runAt } = diagResult;
            const scoreColor = score >= 80 ? "#4ade80" : score >= 50 ? "#fbbf24" : "#f87171";
            const filtered = diagFilter === "tutti" ? tests
              : diagFilter === "ok" ? tests.filter(t=>t.ok)
              : tests.filter(t=>!t.ok && t.severity===diagFilter);

            // Raggruppa per modulo
            const byModule = {};
            filtered.forEach(t => {
              if (!byModule[t.modulo]) byModule[t.modulo] = [];
              byModule[t.modulo].push(t);
            });

            return (
              <>
                {/* Score */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr repeat(4,auto)", gap:10, alignItems:"center" }}>
                  <div style={{ ...card, borderColor:`${scoreColor}44`, padding:"14px 20px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                      <div style={{ fontSize:42, fontWeight:"bold", color:scoreColor, fontFamily:"monospace" }}>{score}%</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:"bold" }}>Punteggio sistema</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                          {counts.ok}/{tests.length} test superati · {new Date(runAt).toLocaleTimeString("it-IT")}
                        </div>
                      </div>
                    </div>
                  </div>
                  {[
                    ["✅ OK", counts.ok, "#4ade80", "ok"],
                    ["🔴 Critici", counts.critici, "#ef4444", "critico"],
                    ["🟡 Medi", counts.medi, "#f59e0b", "medio"],
                    ["🟢 Minori", counts.minori, "#10b981", "minore"],
                  ].map(([label, n, color, id]) => (
                    <div key={id}
                      onClick={()=>setDiagFilter(diagFilter===id?"tutti":id)}
                      style={{
                        ...card, borderColor:`${color}44`, padding:"10px 16px",
                        textAlign:"center", cursor:"pointer",
                        background: diagFilter===id ? `${color}18` : "var(--k2-bg-card)",
                        transition:"all 0.15s",
                      }}
                    >
                      <div style={{ fontSize:22, fontWeight:"bold", color }}>{n}</div>
                      <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Filtro attivo */}
                {diagFilter !== "tutti" && (
                  <div style={{ fontSize:11, color:"var(--k2-text-dim)", display:"flex", alignItems:"center", gap:8 }}>
                    Filtro: <strong style={{ color:"#c8a96e" }}>{diagFilter}</strong>
                    <button onClick={()=>setDiagFilter("tutti")} style={{ background:"transparent", border:"1px solid var(--k2-border)", borderRadius:4, color:"var(--k2-text-dim)", cursor:"pointer", fontSize:10, padding:"2px 8px", fontFamily:"inherit" }}>
                      ✕ Mostra tutti
                    </button>
                  </div>
                )}

                {/* Test per modulo */}
                {Object.entries(byModule).map(([modulo, mTests]) => (
                  <div key={modulo} style={{ ...card, padding:0, overflow:"hidden" }}>
                    <div style={{
                      padding:"8px 16px", display:"flex", alignItems:"center", gap:8,
                      background:"linear-gradient(90deg,rgba(200,169,110,0.1),transparent)",
                      borderBottom:"1px solid var(--k2-border)",
                    }}>
                      <span style={{ fontSize:12, fontWeight:"bold", color:"#c8a96e" }}>{modulo}</span>
                      <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                        {mTests.filter(t=>t.ok).length}/{mTests.length} test OK
                      </span>
                    </div>
                    {mTests.map((t, idx) => {
                      const sColor = t.ok ? "#4ade80" : t.severity==="critico" ? "#ef4444" : t.severity==="medio" ? "#f59e0b" : "#10b981";
                      return (
                        <div key={idx} style={{
                          display:"grid", gridTemplateColumns:"28px 1fr", gap:10,
                          padding:"10px 16px", alignItems:"start",
                          borderBottom: idx<mTests.length-1 ? "1px solid var(--k2-border)" : "none",
                          background: t.ok ? "transparent" : `${sColor}08`,
                        }}>
                          <div style={{
                            width:22, height:22, borderRadius:"50%",
                            background:`${sColor}22`, border:`2px solid ${sColor}66`,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize:11, flexShrink:0, marginTop:1,
                          }}>
                            {t.ok ? "✓" : t.severity==="critico" ? "✕" : t.severity==="medio" ? "!" : "·"}
                          </div>
                          <div>
                            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                              <span style={{ fontSize:12, fontWeight:"bold", color: t.ok ? "var(--k2-text)" : sColor }}>
                                {t.nome}
                              </span>
                              {!t.ok && (
                                <span style={{
                                  fontSize:9, padding:"1px 6px", borderRadius:6,
                                  background:`${sColor}22`, color:sColor, border:`1px solid ${sColor}44`,
                                  fontWeight:"bold", textTransform:"uppercase",
                                }}>
                                  {t.severity}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:2 }}>{t.dettaglio}</div>
                            {t.fix && (
                              <div style={{ fontSize:10, color:"#60a5fa", marginTop:3 }}>
                                💡 {t.fix}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {filtered.length === 0 && (
                  <div style={{ textAlign:"center", padding:"30px 0", color:"var(--k2-text-dim)" }}>
                    Nessun test corrisponde al filtro selezionato.
                  </div>
                )}

                {/* Export report */}
                <div style={{ display:"flex", justifyContent:"flex-end" }}>
                  <button
                    onClick={() => {
                      const lines = [
                        `K2 Suite — Report Autodiagnosi`,
                        `Data: ${new Date(runAt).toLocaleString("it-IT")}`,
                        `Punteggio: ${score}% (${counts.ok}/${tests.length} test superati)`,
                        `Critici: ${counts.critici} · Medi: ${counts.medi} · Minori: ${counts.minori}`,
                        "",
                        ...tests.map(t => `[${t.ok?"OK":t.severity.toUpperCase()}] ${t.modulo} › ${t.nome}: ${t.dettaglio}${t.fix ? ` → ${t.fix}` : ""}`),
                      ];
                      const blob = new Blob([lines.join("\n")], { type:"text/plain;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `k2-diagnosi-${today()}.txt`;
                      document.body.appendChild(a); a.click();
                      document.body.removeChild(a); URL.revokeObjectURL(url);
                    }}
                    style={{ padding:"6px 16px", fontSize:11, background:"transparent", border:"1px solid var(--k2-border)", borderRadius:6, color:"var(--k2-text-dim)", cursor:"pointer", fontFamily:"inherit" }}
                  >
                    📥 Scarica report .txt
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {tab === "utenti" && (
        <div>
          <div style={{ ...card, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
              <div>
                <div style={{ fontSize:14, color:"#c8a96e", fontWeight:"bold" }}>Ruoli e permessi</div>
                <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>Profili semplici per limitare le operazioni critiche in app. I profili possono avere un PIN numerico fino a 6 cifre.</div>
              </div>
              <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Profilo attivo: <strong style={{ color:"#c8a96e" }}>{ROLE_LABELS[currentUserRole] || currentUserRole}</strong></div>
            </div>
            {currentUserRole !== "admin" && (
              <div style={{ fontSize:11, color:"#fbbf24", marginBottom:10 }}>Solo l'amministratore può modificare utenti e permessi.</div>
            )}
            <div style={{ display:"grid", gap:8 }}>
              {(authUsers || []).map(user => (
                <div key={user.id} style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 0.8fr auto auto", gap:8, alignItems:"center", padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                  <input value={user.name} onChange={e => currentUserRole === "admin" && typeof setAuthUsers === "function" && setAuthUsers(prev => prev.map(u => u.id !== user.id ? u : normalizeAuthUser({ ...u, name:e.target.value })))} style={inp} disabled={currentUserRole !== "admin"} />
                  <select value={user.role} onChange={e => currentUserRole === "admin" && typeof setAuthUsers === "function" && setAuthUsers(prev => prev.map(u => u.id !== user.id ? u : normalizeAuthUser({ ...u, role:e.target.value })))} style={inp} disabled={currentUserRole !== "admin"}>
                    <option value="admin">Amministratore</option>
                    <option value="lab">Laboratorio</option>
                    <option value="shop">Punto vendita</option>
                  </select>
                  <input type="password" value={user.pin || ""} placeholder="PIN" onChange={e => currentUserRole === "admin" && typeof setAuthUsers === "function" && setAuthUsers(prev => prev.map(u => u.id !== user.id ? u : normalizeAuthUser({ ...u, pin:e.target.value.replace(/\D/g,"").slice(0,6) })))} style={inp} disabled={currentUserRole !== "admin"} />
                  <label style={{ fontSize:11, color:"var(--k2-text-muted)" }}><input type="checkbox" checked={user.active !== false} onChange={e => currentUserRole === "admin" && typeof setAuthUsers === "function" && setAuthUsers(prev => prev.map(u => u.id !== user.id ? u : normalizeAuthUser({ ...u, active:e.target.checked })))} disabled={currentUserRole !== "admin"} /> attivo</label>
                  <button onClick={() => typeof setCurrentUserId === "function" && setCurrentUserId(user.id)} style={btnS}>Usa</button>
                </div>
              ))}
            </div>
            {currentUserRole === "admin" && (
              <div style={{ marginTop:10 }}>
                <button onClick={() => typeof setAuthUsers === "function" && setAuthUsers(prev => [...prev, normalizeAuthUser({ name:`Utente ${prev.length+1}`, role:"shop", active:true })])} style={btnS}>+ Nuovo profilo</button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "reset" && (
        <div>
          {currentUserRole !== "admin" && (
            <div style={{ ...card, marginBottom:12, borderColor:"#fbbf2444", background:"rgba(251,191,36,0.08)", color:"#fbbf24" }}>
              Permesso negato: solo l'amministratore può usare i reset.
            </div>
          )}
          <div style={{ ...card, borderColor:"#f8717144", background:"#1a0d0d", opacity: currentUserRole === "admin" ? 1 : 0.6 }}>
            <div style={{ fontSize:11, color:"#f87171", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>⚠️ Zona di pericolo — operazioni irreversibili</div>
            <p style={{ fontSize:12, color:"var(--k2-text-muted)", marginBottom:16, lineHeight:1.6 }}>
              Queste operazioni eliminano dati in modo permanente. Il salvataggio automatico è attivo, quindi i dati cancellati <strong style={{ color:"#f87171" }}>non possono essere recuperati</strong>. Usa con estrema cautela.
            </p>

            {/* Reset movimenti magazzino */}
            <div style={{ borderTop:"1px solid #2a1a1a", paddingTop:14, marginBottom:14 }}>
              <div style={{ fontSize:12, color:"var(--k2-text)", fontWeight:"bold", marginBottom:4 }}>🗑️ Azzera log movimenti magazzino</div>
              <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginBottom:10 }}>Cancella tutti i movimenti di carico/scarico. Lo stock attuale rimane invariato. Utile a inizio stagione.</div>
              <button onClick={() => {
                if (!window.confirm("Cancellare tutti i movimenti di magazzino?\nLo stock attuale non viene modificato.")) return;
                if (typeof onResetMovimenti === "function") onResetMovimenti();
              }} style={{ ...btnD }}>🗑️ Azzera movimenti</button>
            </div>

            {/* Reset incassi */}
            <div style={{ borderTop:"1px solid #2a1a1a", paddingTop:14, marginBottom:14 }}>
              <div style={{ fontSize:12, color:"var(--k2-text)", fontWeight:"bold", marginBottom:4 }}>🗑️ Azzera incassi e cashflow</div>
              <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginBottom:10 }}>Cancella tutti i dati di incasso e cashflow di entrambe le sedi. Le ricette e il magazzino restano intatti.</div>
              <button onClick={() => {
                if (!window.confirm("Cancellare tutti gli incassi e il cashflow?\nQuesta operazione è irreversibile.")) return;
                if (typeof onResetIncassi === "function") onResetIncassi();
              }} style={{ ...btnD }}>🗑️ Azzera incassi</button>
            </div>

            {/* Reset totale — richiede digitazione */}
            <div style={{ borderTop:"1px solid #3a1a1a", paddingTop:14, background:"rgba(248,113,113,0.04)", borderRadius:6, padding:14, marginTop:10 }}>
              <div style={{ fontSize:12, color:"#f87171", fontWeight:"bold", marginBottom:4 }}>☢️ RESET COMPLETO — Ripristino dati di fabbrica</div>
              <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginBottom:12, lineHeight:1.6 }}>
                Cancella <strong style={{ color:"#f87171" }}>tutti i dati</strong>: ingredienti, ricette, stock, movimenti, incassi, cashflow, fornitori, HACCP. L'app tornerà allo stato iniziale.<br/>
                Per confermare, digita <code style={{ background:"#2a1010", padding:"1px 6px", borderRadius:3, color:"#fbbf24" }}>RESET K2</code> qui sotto.
              </div>
              <input
                type="text"
                value={resetConfirm}
                onChange={e => setResetConfirm(e.target.value)}
                placeholder='Digita RESET K2 per sbloccare'
                style={{ ...inp, marginBottom:10, borderColor: resetConfirm === "RESET K2" ? "#f87171" : "var(--k2-border)", color: resetConfirm === "RESET K2" ? "#f87171" : "var(--k2-text)" }}
              />
              <button
                disabled={resetConfirm !== "RESET K2"}
                onClick={() => {
                  if (!window.confirm("ULTIMA CONFERMA: cancellare TUTTI i dati dell'app K2 Suite?\nQuesta operazione è completamente irreversibile.")) return;
                  if (typeof onFullReset === "function") onFullReset();
                  setResetConfirm("");
                  setTab("costi");
                }}
                style={{ ...btnD, opacity: resetConfirm === "RESET K2" ? 1 : 0.35, cursor: resetConfirm === "RESET K2" ? "pointer" : "not-allowed", fontWeight:"bold" }}
              >☢️ ESEGUI RESET COMPLETO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM INGREDIENTE — modello economico completo
// ═══════════════════════════════════════════════════════════════════════════════
function IngForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(normalizeIngredient(initial || {}));
  const [tab, setTab]   = useState("base");
  const [err, setErr]   = useState("");

  // Modello economico: purchasePrice (€ per confezione) + packageSize (g) → cost (€/g)
  const [pkgPrice, setPkgPrice] = useState(
    initial?.purchasePrice != null ? String(Number(initial.purchasePrice).toFixed(2)) : ""
  );
  const [pkgSize, setPkgSize] = useState(
    initial?.packageSize != null ? String(initial.packageSize) : ""
  );

  // Calcolo automatico cost (€/g) da prezzo confezione / dimensione confezione
  const computedCostPerG = (() => {
    const p = Number(pkgPrice);
    const s = Number(pkgSize);
    if (p > 0 && s > 0) return p / s;
    return null;
  })();

  // Se non c'è confezione, fallback su inserimento diretto €/100g
  const [c100Manual, setC100Manual] = useState(
    initial?.cost ? Number(initial.cost * 100).toFixed(2) : ""
  );

  const costPerG = computedCostPerG ?? (Number(c100Manual) > 0 ? Number(c100Manual) / 100 : 0);

  function handleSave() {
    setErr("");
    if (!form.name.trim()) { setErr("Il nome è obbligatorio."); return; }
    // Se è stato inserito un prezzo confezione, la dimensione deve essere > 0
    if (Number(pkgPrice) > 0 && !(Number(pkgSize) > 0)) {
      setErr("Dimensione confezione non valida — inserisci i grammi della confezione (> 0).");
      return;
    }
    if (costPerG <= 0) { setErr("Inserisci prezzo confezione + dimensione, oppure €/100g."); return; }

    const finalIngredient = {
      ...form,
      name: form.name.trim(),
      cost: costPerG,
      netCostPerGram: costPerG,
      purchasePrice: Number(pkgPrice) || null,
      packageSize:   Number(pkgSize)  || null,
      lastPriceUpdate: today(),
      // Storico prezzi: aggiungi voce solo se il costo è cambiato
      priceHistory: (() => {
        const hist = Array.isArray(form.priceHistory) ? form.priceHistory : [];
        if (initial && Math.abs((initial.cost || 0) - costPerG) > 0.000001) {
          return [...hist, { date: today(), oldCost: initial.cost || 0, newCost: costPerG }];
        }
        return hist;
      })(),
    };
    onSave(finalIngredient);
  }

  const costPer100 = costPerG * 100;
  const pkgIsValid = Number(pkgPrice) > 0 && Number(pkgSize) > 0;

  return (
    <div style={{ display:"grid", gap:0 }}>
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {[["base","Base"],["costo","Costo"],["allergeni","Allergeni"],["nutrizione","Nutrizione"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding:"4px 10px", fontSize:10, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:3, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)" }}>{label}</button>
        ))}
      </div>

      {tab === "base" && (
        <div style={{ display:"grid", gap:10 }}>
          <div><label style={lbl}>Nome ingrediente *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} style={inp} placeholder="es. Latte intero fresco" autoFocus/></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div><label style={lbl}>Unità</label><select value={form.unit} onChange={e => setForm(f => ({ ...f, unit:e.target.value }))} style={inp}>{["g","kg","L","pz"].map(u => <option key={u}>{u}</option>)}</select></div>
            <div><label style={lbl}>Categoria</label><select value={form.category||"Generico"} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={inp}>{ING_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div><label style={lbl}>Fornitore</label><input value={form.supplier||""} onChange={e => setForm(f => ({ ...f, supplier:e.target.value }))} style={inp} placeholder="es. Agrimontana"/></div>
            <div><label style={lbl}>Note</label><input value={form.notes||""} onChange={e => setForm(f => ({ ...f, notes:e.target.value }))} style={inp} placeholder="opzionale"/></div>
          </div>
        </div>
      )}

      {tab === "costo" && (
        <div style={{ display:"grid", gap:12 }}>
          {/* Metodo principale: da confezione */}
          <div style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:6, padding:12 }}>
            <div style={{ fontSize:10, color:"#c8a96e", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>📦 Da confezione acquistata (consigliato)</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div>
                <label style={lbl}>Prezzo confezione (€)</label>
                <input type="number" value={pkgPrice} onChange={e => setPkgPrice(e.target.value)} style={inp} step="0.01" min="0" placeholder="es. 3,80"/>
              </div>
              <div>
                <label style={lbl}>Dimensione confezione (g)</label>
                <input type="number" value={pkgSize} onChange={e => setPkgSize(e.target.value)} style={inp} step="1" min="0" placeholder="es. 1000"/>
              </div>
            </div>
            {pkgIsValid && (
              <div style={{ marginTop:10, display:"flex", gap:12, padding:"8px 10px", background:"rgba(200,169,110,0.08)", borderRadius:5, border:"1px solid #c8a96e33" }}>
                <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>→ Costo calcolato:</span>
                <span style={{ fontSize:13, fontWeight:"bold", color:"#c8a96e" }}>{fmtE(costPer100)}/100g</span>
                <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>({fmt(costPerG * 1000, 2)} €/kg)</span>
              </div>
            )}
          </div>

          {/* Metodo alternativo: inserimento diretto */}
          <div style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:6, padding:12 }}>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>✏️ Oppure inserisci direttamente €/100g</div>
            <input type="number" value={c100Manual} onChange={e => setC100Manual(e.target.value)} style={{ ...inp, opacity: pkgIsValid ? 0.4 : 1 }} step="0.01" min="0" placeholder="es. 0,95" disabled={pkgIsValid}/>
            {pkgIsValid && <div style={{ fontSize:10, color:"var(--k2-text-faint)", marginTop:5 }}>Disabilitato — viene usato il calcolo da confezione</div>}
          </div>

          {/* Riepilogo costo finale */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
            {[
              ["€/100g", fmtE(costPer100), "#c8a96e"],
              ["€/kg",   fmtE(costPerG * 1000), "#60a5fa"],
              ["€/g",    fmt(costPerG, 4) + " €", "var(--k2-text-muted)"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"8px", textAlign:"center" }}>
                <div style={{ fontSize:14, fontWeight:"bold", color:c }}>{v}</div>
                <div style={{ fontSize:8, color:"var(--k2-text-dim)", marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>

          {/* Storico prezzi */}
          {(form.priceHistory||[]).length > 0 && (
            <div>
              <div style={{ fontSize:9, color:"var(--k2-text-faint)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>Storico prezzi</div>
              {[...(form.priceHistory)].reverse().slice(0, 5).map((h, i) => (
                <div key={i} style={{ display:"flex", gap:10, fontSize:11, color:"var(--k2-text-dim)", padding:"3px 0", borderBottom:"1px solid var(--k2-border)" }}>
                  <span style={{ minWidth:70 }}>{formatDateIT(h.date)}</span>
                  <span style={{ color:"#f87171" }}>{fmtE((h.oldCost||0)*100)}/100g</span>
                  <span>→</span>
                  <span style={{ color:"#4ade80" }}>{fmtE((h.newCost||0)*100)}/100g</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "allergeni" && (
        <div>
          <p style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:10 }}>Seleziona gli allergeni presenti in questo ingrediente.</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {ALL_ALLERGENI.map(a => {
              const sel = (form.allergens||[]).includes(a);
              return (
                <div key={a} onClick={() => setForm(f => ({ ...f, allergens: sel ? f.allergens.filter(x => x!==a) : [...(f.allergens||[]),a] }))} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:5, cursor:"pointer", background:sel?"rgba(251,191,36,0.12)":"var(--k2-bg-input)", border:sel?"1px solid #fbbf2444":"1px solid var(--k2-border)" }}>
                  <div style={{ width:14, height:14, borderRadius:3, border:`2px solid ${sel?"#fbbf24":"var(--k2-text-faint)"}`, background:sel?"#fbbf24":"transparent", flexShrink:0 }}/>
                  <span style={{ fontSize:11, color:sel?"#fbbf24":"var(--k2-text-muted)" }}>{ALLERGENI_LABELS[a]||a}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "nutrizione" && (
        <div>
          <p style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:10 }}>Valori nutrizionali per 100g (opzionale, usato per calcolo ricette).</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[["kcal","Energia (kcal)"],["fat","Grassi (g)"],["satFat","- di cui saturi (g)"],["carbs","Carboidrati (g)"],["sugars","- di cui zuccheri (g)"],["protein","Proteine (g)"],["salt","Sale (g)"]].map(([k,label]) => (
              <div key={k}><label style={lbl}>{label}</label><input type="number" value={form.nutritionPer100g?.[k]||""} onChange={e => setForm(f => ({ ...f, nutritionPer100g:{ ...(f.nutritionPer100g||{}), [k]:Number(e.target.value)||0 } }))} style={inp} step="0.1" placeholder="0" min="0"/></div>
            ))}
          </div>
        </div>
      )}

      {err && <div style={{ marginTop:10, fontSize:11, color:"#f87171", background:"rgba(248,113,113,0.08)", border:"1px solid #f8717133", borderRadius:4, padding:"7px 10px" }}>⚠ {err}</div>}

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
        <button onClick={onCancel} style={btnS}>Annulla</button>
        <button onClick={handleSave} style={btnP}>Salva ingrediente</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM INGREDIENTE RAPIDO — quick-add inline in RecipeForm
// Compatibile con normalizeIngredient; stesso modello economico di IngForm.
// ═══════════════════════════════════════════════════════════════════════════════
function IngFormQuick({ existingIngredients, onSave, onCancel }) {
  const [name, setName]           = useState("");
  const [unit, setUnit]           = useState("g");
  const [category, setCategory]   = useState("Generico");
  const [supplier, setSupplier]   = useState("");
  const [pkgPrice, setPkgPrice]   = useState("");
  const [pkgSize, setPkgSize]     = useState("");
  const [c100Manual, setC100Manual] = useState("");
  const [allergens, setAllergens] = useState([]);
  const [notes, setNotes]         = useState("");
  const [nutrition, setNutrition] = useState({ kcal:0, fat:0, satFat:0, carbs:0, sugars:0, protein:0, salt:0 });
  const [err, setErr]             = useState("");
  const [tab, setTab]             = useState("base");

  // ── modello economico identico a IngForm ────────────────────────────────────
  const computedCostPerG = (() => {
    const p = Number(pkgPrice);
    const s = Number(pkgSize);
    if (p > 0 && s > 0) return p / s;
    return null;
  })();
  const pkgIsValid = Number(pkgPrice) > 0 && Number(pkgSize) > 0;
  const costPerG   = computedCostPerG ?? (Number(c100Manual) > 0 ? Number(c100Manual) / 100 : 0);
  const costPer100 = costPerG * 100;

  // ── controllo duplicati ─────────────────────────────────────────────────────
  const similarDups = name.trim().length >= 2
    ? existingIngredients.filter(i =>
        i.active !== false &&
        i.name.toLowerCase().includes(name.trim().toLowerCase())
      )
    : [];

  function toggleAllergen(a) {
    setAllergens(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  function handleSave() {
    setErr("");
    if (!name.trim()) { setErr("Il nome è obbligatorio."); return; }
    if (costPerG <= 0) { setErr("Inserisci prezzo confezione + dimensione, oppure €/100g."); return; }

    // Warning non bloccante: valori nutrizionali tutti a zero
    if (isNutritionAllZero(nutrition)) {
      setErr("⚠ I valori nutrizionali sono tutti a zero. L'ingrediente verrà salvato, ma i calcoli nutrizionali delle ricette potrebbero risultare non corretti. Puoi aggiungerli ora dalla scheda Nutrizione.");
      // Non blocchiamo — proseguiamo comunque dopo il warning (viene mostrato ma il salvataggio avviene)
    }

    const newIng = normalizeIngredient({
      id:             Date.now(),
      name:           name.trim(),
      unit,
      category,
      supplier,
      packageSize:    Number(pkgSize)  || null,
      packageUnit:    "g",
      purchasePrice:  Number(pkgPrice) || null,
      cost:           costPerG,
      netCostPerGram: costPerG,
      allergens,
      nutritionPer100g: nutrition,
      notes,
      lastPriceUpdate: today(),
      priceHistory:   [],
      active:         true,
    });
    onSave(newIng);
  }

  const tabStyle = (id) => ({
    padding:"4px 10px", fontSize:10, border:"1px solid var(--k2-border)", cursor:"pointer",
    borderRadius:3, fontFamily:"inherit",
    background: tab===id ? "#c8a96e" : "transparent",
    color:      tab===id ? "var(--k2-bg)" : "var(--k2-text-muted)",
  });

  return (
    <div style={{ display:"grid", gap:0 }}>
      {/* warning duplicati */}
      {similarDups.length > 0 && (
        <div style={{ marginBottom:10, padding:"8px 11px", background:"rgba(251,191,36,0.08)", border:"1px solid #fbbf2444", borderRadius:5, fontSize:11, color:"#fbbf24" }}>
          ⚠ Ingredienti simili già presenti:&nbsp;
          <strong>{similarDups.map(i => i.name).join(", ")}</strong>
          <span style={{ color:"var(--k2-text-muted)" }}> — puoi comunque continuare.</span>
        </div>
      )}

      {/* tab bar */}
      <div style={{ display:"flex", gap:4, marginBottom:12 }}>
        {[["base","Base"],["costo","Costo"],["allergeni","Allergeni"],["nutrizione","Nutrizione"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(id)}>{label}</button>
        ))}
      </div>

      {/* ── tab BASE ── */}
      {tab === "base" && (
        <div style={{ display:"grid", gap:10 }}>
          <div>
            <label style={lbl}>Nome ingrediente *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="es. Latte intero fresco" autoFocus/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={lbl}>Unità</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} style={inp}>
                {["g","kg","L","pz"].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Categoria</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={inp}>
                {ING_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={lbl}>Fornitore (opz.)</label>
              <input value={supplier} onChange={e => setSupplier(e.target.value)} style={inp} placeholder="es. Agrimontana"/>
            </div>
            <div>
              <label style={lbl}>Note</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} style={inp} placeholder="opzionale"/>
            </div>
          </div>
        </div>
      )}

      {/* ── tab COSTO ── */}
      {tab === "costo" && (
        <div style={{ display:"grid", gap:12 }}>
          <div style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:6, padding:12 }}>
            <div style={{ fontSize:10, color:"#c8a96e", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>📦 Da confezione acquistata (consigliato)</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div>
                <label style={lbl}>Prezzo confezione (€)</label>
                <input type="number" value={pkgPrice} onChange={e => setPkgPrice(e.target.value)} style={inp} step="0.01" min="0" placeholder="es. 3,80"/>
              </div>
              <div>
                <label style={lbl}>Dimensione confezione (g)</label>
                <input type="number" value={pkgSize} onChange={e => setPkgSize(e.target.value)} style={inp} step="1" min="0" placeholder="es. 1000"/>
              </div>
            </div>
            {pkgIsValid && (
              <div style={{ marginTop:10, display:"flex", gap:12, padding:"8px 10px", background:"rgba(200,169,110,0.08)", borderRadius:5, border:"1px solid #c8a96e33" }}>
                <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>→ Costo calcolato:</span>
                <span style={{ fontSize:13, fontWeight:"bold", color:"#c8a96e" }}>{fmtE(costPer100)}/100g</span>
                <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}>({fmt(costPerG * 1000, 2)} €/kg)</span>
              </div>
            )}
          </div>
          <div style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:6, padding:12 }}>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>✏️ Oppure inserisci direttamente €/100g</div>
            <input type="number" value={c100Manual} onChange={e => setC100Manual(e.target.value)} style={{ ...inp, opacity: pkgIsValid ? 0.4 : 1 }} step="0.01" min="0" placeholder="es. 0,95" disabled={pkgIsValid}/>
            {pkgIsValid && <div style={{ fontSize:10, color:"var(--k2-text-faint)", marginTop:5 }}>Disabilitato — viene usato il calcolo da confezione</div>}
          </div>
          {costPerG > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              {[["€/100g", fmtE(costPer100), "#c8a96e"],["€/kg", fmtE(costPerG * 1000), "#60a5fa"],["€/g", fmt(costPerG, 4) + " €", "var(--k2-text-muted)"]].map(([l, v, c]) => (
                <div key={l} style={{ background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"8px", textAlign:"center" }}>
                  <div style={{ fontSize:14, fontWeight:"bold", color:c }}>{v}</div>
                  <div style={{ fontSize:8, color:"var(--k2-text-dim)", marginTop:2 }}>{l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── tab ALLERGENI ── */}
      {tab === "allergeni" && (
        <div>
          <p style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:10 }}>Seleziona gli allergeni presenti in questo ingrediente.</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {ALL_ALLERGENI.map(a => {
              const sel = allergens.includes(a);
              return (
                <div key={a} onClick={() => toggleAllergen(a)} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:5, cursor:"pointer", background:sel?"rgba(251,191,36,0.12)":"var(--k2-bg-input)", border:sel?"1px solid #fbbf2444":"1px solid var(--k2-border)" }}>
                  <div style={{ width:14, height:14, borderRadius:3, border:`2px solid ${sel?"#fbbf24":"var(--k2-text-faint)"}`, background:sel?"#fbbf24":"transparent", flexShrink:0 }}/>
                  <span style={{ fontSize:11, color:sel?"#fbbf24":"var(--k2-text-muted)" }}>{ALLERGENI_LABELS[a]||a}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── tab NUTRIZIONE ── */}
      {tab === "nutrizione" && (
        <div>
          <p style={{ fontSize:12, color:"var(--k2-text-dim)", marginBottom:10 }}>Valori nutrizionali per 100g (opzionale).</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[["kcal","Energia (kcal)"],["fat","Grassi (g)"],["satFat","- di cui saturi (g)"],["carbs","Carboidrati (g)"],["sugars","- di cui zuccheri (g)"],["protein","Proteine (g)"],["salt","Sale (g)"]].map(([k,label]) => (
              <div key={k}>
                <label style={lbl}>{label}</label>
                <input type="number" value={nutrition[k]||""} onChange={e => setNutrition(n => ({ ...n, [k]:Number(e.target.value)||0 }))} style={inp} step="0.1" placeholder="0" min="0"/>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && (
        <div style={{ marginTop:10, fontSize:11, borderRadius:4, padding:"7px 10px",
          color:       err.startsWith("⚠ I valori nutrizionali") ? "#fbbf24" : "#f87171",
          background:  err.startsWith("⚠ I valori nutrizionali") ? "rgba(251,191,36,0.08)" : "rgba(248,113,113,0.08)",
          border:      err.startsWith("⚠ I valori nutrizionali") ? "1px solid #fbbf2433"   : "1px solid #f8717133",
        }}>{err}</div>
      )}

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
        <button onClick={onCancel} style={btnS}>Annulla</button>
        <button onClick={handleSave} style={btnP}>Crea e aggiungi</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM RICETTA — con ricerca live, preview costo/allergeni, validazione
// ═══════════════════════════════════════════════════════════════════════════════
function RecipeForm({ initial, ingredients, allRecipes, onSave, onCancel, onAddIngredient, defaultReparto }) {
  const [form, setForm] = useState(() => {
    const base = normalizeRecipe(initial || {});
    // Se è una nuova ricetta (no id) e defaultReparto è fornito, usalo
    if (!initial && defaultReparto) {
      return { ...base, repartoId: defaultReparto };
    }
    return base;
  });
  const [search, setSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [pendingQ, setPendingQ] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [err, setErr] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const searchRef = useRef(null);
  const CATS = ["Creme classiche","Creme speciali","Frutta","Sorbetti","Yogurt","Semilavorati","Altro"];

  const activeIng = ingredients.filter(i => i.active !== false);
  const filtered  = search.trim().length > 0
    ? activeIng.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : activeIng;

  // Costo totale MP live
  const costMP = form.ingredients.reduce((s, ri) => {
    const ing = ingredients.find(i => i.id === ri.id);
    return s + (ing ? ing.cost * ri.q : 0);
  }, 0);
  const totalInput = form.ingredients.reduce((s, ri) => s + ri.q, 0);
  const costPer100g = form.yield_g > 0 ? (costMP / form.yield_g) * 100 : 0;

  // Allergeni live (ricorsivi — include semilavorati)
  const allergens = getRecipeAllergensStrict(form, allRecipes || [], ingredients);

  function selectIngredient(ing) {
    setPendingId(ing.id);
    setSearch(ing.name);
    setShowDrop(false);
    setPendingQ("");
    setTimeout(() => document.getElementById("recipe-qty-input")?.focus(), 50);
  }

  function addIngredient() {
    const q = Number(pendingQ);
    if (!pendingId || q <= 0) return;
    setForm(f => {
      const existing = f.ingredients.findIndex(ri => ri.id === pendingId);
      if (existing >= 0) {
        return { ...f, ingredients: f.ingredients.map((ri, i) => i === existing ? { ...ri, q: ri.q + q } : ri) };
      }
      return { ...f, ingredients: [...f.ingredients, { id: pendingId, q }] };
    });
    setSearch("");
    setPendingId(null);
    setPendingQ("");
    searchRef.current?.focus();
  }

  function handleSave() {
    setErr("");
    if (!form.name.trim()) { setErr("Il nome è obbligatorio."); return; }
    if (!form.yield_g || form.yield_g <= 0) { setErr("La resa deve essere > 0 g."); return; }
    if (form.ingredients.length === 0) { setErr("Aggiungi almeno un ingrediente."); return; }
    // Controllo grammi zero in ogni ingrediente
    const zeroQ = form.ingredients.find(ri => !(ri.q > 0));
    if (zeroQ) { const n = ingredients.find(i => i.id === zeroQ.id)?.name || "?"; setErr(`Grammatura zero per: ${n} — inserisci un valore > 0.`); return; }
    // Controllo resa realistica: non può superare l'input di oltre il 10%
    if (form.yield_g > totalInput * 1.10 && totalInput > 0) {
      setErr(`⚠ Resa superiore agli ingredienti (${form.yield_g}g > ${Math.round(totalInput*1.10)}g) — verifica errore di inserimento.`);
      return;
    }
    if (form.isSemiFinished && !form.producedIngredientId) {
      setErr("Collega un ingrediente di stock al semilavorato prima di salvare.");
      return;
    }
    onSave({ ...form, name: form.name.trim() });
  }

  return (
    <div style={{ display:"grid", gap:12 }}>
      {/* Intestazione ricetta */}
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:10 }}>
        <div><label style={lbl}>Nome ricetta *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} style={inp} placeholder="es. Nocciola"/></div>
        <div><label style={lbl}>Resa (g) *</label><input type="number" value={form.yield_g} onChange={e => setForm(f => ({ ...f, yield_g:Number(e.target.value)||0 }))} style={inp} min="1"/></div>
      </div>
      {/* Reparto + Categoria + Note */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
        <div>
          <label style={lbl}>Reparto</label>
          <div style={{ display:"flex", gap:4 }}>
            {REPARTI.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setForm(f => ({ ...f, repartoId: r.id }))}
                style={{
                  flex:1, padding:"7px 4px", fontSize:11, fontFamily:"inherit", borderRadius:4,
                  border:`1px solid ${form.repartoId===r.id ? r.color+"66" : "var(--k2-border)"}`,
                  background: form.repartoId===r.id ? r.color+"22" : "transparent",
                  color: form.repartoId===r.id ? r.color : "var(--k2-text-dim)",
                  cursor:"pointer", fontWeight: form.repartoId===r.id ? "bold" : "normal",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:3,
                }}
              >
                {r.icon} {r.label}
              </button>
            ))}
          </div>
        </div>
        <div><label style={lbl}>Categoria</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={inp}>{CATS.map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label style={lbl}>Note</label><input value={form.notes||""} onChange={e => setForm(f => ({ ...f, notes:e.target.value }))} style={inp} placeholder="opzionale"/></div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 120px", gap:10, alignItems:"end" }}>
        <label style={{ fontSize:11, color:"var(--k2-text-muted)", display:"flex", gap:6, alignItems:"center" }}>
          <input type="checkbox" checked={form.isSemiFinished === true} onChange={e => setForm(f => ({ ...f, isSemiFinished:e.target.checked, category:e.target.checked ? "Semilavorati" : f.category }))} />
          Ricetta semilavorato interno
        </label>
        <div>
          <label style={lbl}>Ingrediente di stock prodotto</label>
          <select value={form.producedIngredientId || ""} onChange={e => setForm(f => ({ ...f, producedIngredientId:e.target.value ? Number(e.target.value) : null }))} style={inp} disabled={!form.isSemiFinished}>
            <option value="">— Nessuno —</option>
            {ingredients.filter(i => i.active !== false).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Shelf life gg</label>
          <input type="number" min="1" value={form.semiFinishedShelfLifeDays || 3} onChange={e => setForm(f => ({ ...f, semiFinishedShelfLifeDays:Number(e.target.value)||3 }))} style={inp} disabled={!form.isSemiFinished}/>
        </div>
      </div>

      {/* Lista ingredienti attuale */}
      <div style={{ borderTop:"1px solid var(--k2-border)", paddingTop:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <label style={lbl}>Ingredienti</label>
          {form.ingredients.length > 0 && (
            <span style={{ fontSize:9, color:"var(--k2-text-dim)" }}>
              Input: {totalInput}g · Resa: {form.yield_g}g
            </span>
          )}
        </div>
        {form.ingredients.length === 0 && (
          <div style={{ fontSize:11, color:"var(--k2-text-faint)", padding:"8px 0" }}>Nessun ingrediente aggiunto</div>
        )}
        {form.ingredients.map((ri, idx) => {
          const ing = ingredients.find(i => i.id === ri.id);
          const pct = totalInput > 0 ? ((ri.q / totalInput) * 100).toFixed(1) : 0;
          return (
            <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid var(--k2-border)" }}>
              <span style={{ flex:1, fontSize:12, color: ing?.allergens?.length > 0 ? "#fbbf24" : "var(--k2-text-secondary)" }}>{ing?.name || "?"}</span>
              <span style={{ fontSize:9, color:"var(--k2-text-dim)", minWidth:36 }}>{pct}%</span>
              <input
                type="number" min="1" value={ri.q}
                onChange={e => setForm(f => ({ ...f, ingredients: f.ingredients.map((x, i) => i===idx ? { ...x, q:Number(e.target.value)||0 } : x) }))}
                style={{ ...inp, width:70, padding:"3px 7px", fontSize:12, textAlign:"right" }}
              />
              <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>g</span>
              <button onClick={() => setForm(f => ({ ...f, ingredients:f.ingredients.filter((_,i) => i!==idx) }))} style={{ background:"none", border:"none", color:"#f87171", cursor:"pointer", padding:"0 2px", fontSize:14 }}>✕</button>
            </div>
          );
        })}
      </div>

      {/* Aggiungi ingrediente con ricerca live */}
      <div style={{ background:"var(--k2-bg-input)", border:"1px solid var(--k2-border)", borderRadius:6, padding:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)", letterSpacing:"0.1em", textTransform:"uppercase" }}>Aggiungi ingrediente</div>
          {!showQuickAdd && (
            <button
              onClick={() => { setShowQuickAdd(true); setSearch(""); setPendingId(null); }}
              style={{ ...btnS, fontSize:10, padding:"3px 9px", color:"#c8a96e", borderColor:"#c8a96e44" }}
            >
              + Nuovo ingrediente
            </button>
          )}
        </div>

        {/* pannello quick-add inline */}
        {showQuickAdd && (
          <div style={{ background:"var(--k2-bg)", border:"1px solid #c8a96e33", borderRadius:6, padding:14, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#c8a96e", fontWeight:"bold" }}>✦ Nuovo ingrediente rapido</div>
              <button onClick={() => setShowQuickAdd(false)} style={{ background:"none", border:"none", color:"var(--k2-text-dim)", cursor:"pointer", fontSize:16 }}>✕</button>
            </div>
            <IngFormQuick
              existingIngredients={ingredients}
              onSave={newIng => {
                // aggiunge all'anagrafica globale tramite callback
                if (typeof onAddIngredient === "function") onAddIngredient(newIng);
                // seleziona subito nella ricetta corrente
                setPendingId(newIng.id);
                setSearch(newIng.name);
                setShowQuickAdd(false);
                setTimeout(() => document.getElementById("recipe-qty-input")?.focus(), 60);
              }}
              onCancel={() => setShowQuickAdd(false)}
            />
          </div>
        )}

        {!showQuickAdd && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px auto", gap:6 }}>
            <div style={{ position:"relative" }}>
              <input
                ref={searchRef}
                value={search}
                onChange={e => { setSearch(e.target.value); setShowDrop(true); setPendingId(null); }}
                onFocus={() => setShowDrop(true)}
                onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                placeholder="Cerca ingrediente…"
                style={inp}
              />
              {showDrop && filtered.length > 0 && (
                <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#161511", border:"1px solid var(--k2-border)", borderRadius:5, zIndex:50, maxHeight:180, overflowY:"auto", marginTop:2 }}>
                  {filtered.slice(0,10).map(i => (
                    <div key={i.id} onMouseDown={() => selectIngredient(i)} style={{ padding:"7px 11px", fontSize:12, color:"var(--k2-text-secondary)", cursor:"pointer", borderBottom:"1px solid var(--k2-border)", display:"flex", justifyContent:"space-between" }}>
                      <span>{i.name}</span>
                      <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{fmtE(i.cost*100)}/100g</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input
              id="recipe-qty-input"
              type="number" min="1" placeholder="g"
              value={pendingQ}
              onChange={e => setPendingQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addIngredient()}
              style={{ ...inp, textAlign:"center" }}
            />
            <button onClick={addIngredient} style={{ ...btnP, padding:"7px 12px" }}>+</button>
          </div>
        )}

        {pendingId && !showQuickAdd && (
          <div style={{ marginTop:6, fontSize:10, color:"#c8a96e" }}>
            {ingredients.find(i => i.id === pendingId)?.name} selezionato — inserisci i grammi e premi +
          </div>
        )}
      </div>

      {/* Preview costo e allergeni */}
      {form.ingredients.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <div style={{ background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"8px 10px" }}>
            <div style={{ fontSize:8, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Costo MP stimato</div>
            <div style={{ fontSize:15, fontWeight:"bold", color:"#c8a96e" }}>{fmtE(costMP)}</div>
            <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{fmtE(costPer100g)}/100g resa</div>
          </div>
          <div style={{ background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:5, padding:"8px 10px" }}>
            <div style={{ fontSize:8, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Allergeni</div>
            {allergens.length > 0
              ? <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                  {allergens.map(a => <AllergenBadge key={a} allergen={a}/>)}
                </div>
              : <div style={{ fontSize:11, color:"#4ade80" }}>✓ Nessuno</div>
            }
          </div>
        </div>
      )}

      {/* Warning ingredienti senza costo — non bloccante, solo avviso */}
      {(() => {
        const zeroCost = form.ingredients.filter(ri => {
          const ing = ingredients.find(i => i.id === ri.id);
          return ing && ing.cost === 0;
        });
        if (zeroCost.length === 0) return null;
        const nomi = zeroCost.map(ri => ingredients.find(i => i.id === ri.id)?.name || "?").join(", ");
        return (
          <div style={{ fontSize:11, color:"#fbbf24", background:"rgba(251,191,36,0.07)", border:"1px solid #fbbf2433", borderRadius:4, padding:"7px 10px" }}>
            ⚠ Ingrediente senza costo — food cost non attendibile: <strong>{nomi}</strong>
          </div>
        );
      })()}

      {err && <div style={{ fontSize:11, color:"#f87171", background:"rgba(248,113,113,0.08)", border:"1px solid #f8717133", borderRadius:4, padding:"7px 10px" }}>⚠ {err}</div>}

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
        <button onClick={onCancel} style={btnS}>Annulla</button>
        <button onClick={handleSave} style={btnP}>Salva ricetta</button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// FORNITORI + HACCP — FASE DEMO INTEGRATA
// ═══════════════════════════════════════════════════════════════════════════════

function statusPill(status) {
  const map = {
    ok: { color:"#4ade80", bg:"rgba(74,222,128,0.12)", border:"#4ade8044", label:"OK" },
    valido: { color:"#4ade80", bg:"rgba(74,222,128,0.12)", border:"#4ade8044", label:"Valido" },
    in_scadenza: { color:"#fbbf24", bg:"rgba(251,191,36,0.12)", border:"#fbbf2444", label:"In scadenza" },
    scaduto: { color:"#f87171", bg:"rgba(248,113,113,0.12)", border:"#f8717144", label:"Scaduto" },
    scaduti: { color:"#f87171", bg:"rgba(248,113,113,0.12)", border:"#f8717144", label:"Scaduti" },
    mancanti: { color:"var(--k2-text-muted)", bg:"rgba(107,100,85,0.12)", border:"var(--k2-text-faint)", label:"Mancanti" },
    warning: { color:"#fbbf24", bg:"rgba(251,191,36,0.12)", border:"#fbbf2444", label:"Warning" },
    nc: { color:"#f87171", bg:"rgba(248,113,113,0.12)", border:"#f8717144", label:"NC" },
    aperta: { color:"#f87171", bg:"rgba(248,113,113,0.12)", border:"#f8717144", label:"Aperta" },
    chiusa: { color:"#4ade80", bg:"rgba(74,222,128,0.12)", border:"#4ade8044", label:"Chiusa" },
    attenzione: { color:"#fbbf24", bg:"rgba(251,191,36,0.12)", border:"#fbbf2444", label:"Attenzione" },
    critico: { color:"#f87171", bg:"rgba(248,113,113,0.12)", border:"#f8717144", label:"Critico" },
    alta: { color:"#f87171", bg:"rgba(248,113,113,0.12)", border:"#f8717144", label:"Priorità alta" },
    media: { color:"#fbbf24", bg:"rgba(251,191,36,0.12)", border:"#fbbf2444", label:"Priorità media" },
    bassa: { color:"#60a5fa", bg:"rgba(96,165,250,0.12)", border:"#60a5fa44", label:"Priorità bassa" },
  };
  const s = map[status] || { color:"var(--k2-text-muted)", bg:"rgba(107,100,85,0.12)", border:"var(--k2-text-faint)", label:String(status || "—") };
  return (
    <span style={{ fontSize:10, color:s.color, background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:"2px 8px", whiteSpace:"nowrap" }}>
      {s.label}
    </span>
  );
}

function Fornitori({ suppliers, setSuppliers, supplierDocs, setSupplierDocs, ingredients, setIngredients, sede, haccpTasks = [], setHaccpTasks = null, purchaseOrders = [], setPurchaseOrders = null, currentUser = null }) {
  const [fornMsg, setFornMsg] = useState(null); // { type: "ok"|"err", text }
  const [tab, setTab] = useState("anagrafica");
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [showDocModal, setShowDocModal] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedOrderGroupKey, setSelectedOrderGroupKey] = useState(null);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState(null);

  const filteredSuppliers = suppliers
    .filter(s => {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.referente.toLowerCase().includes(q) ||
        (s.piva || "").toLowerCase().includes(q) ||
        (s.products || []).some(p => String(p || "").toLowerCase().includes(q))
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const ingredientSuggestions = React.useMemo(
    () => Object.fromEntries(
      ingredients.map(ing => [ing.id, inferSupplierForIngredient(ing, suppliers)])
    ),
    [ingredients, suppliers]
  );

  function handleSaveSupplier(data) {
    const normalized = normalizeSupplier(data);
    setSuppliers(prev => {
      const exists = prev.some(s => s.id === normalized.id);
      return exists
        ? prev.map(s => s.id === normalized.id ? normalized : s)
        : [normalized, ...prev];
    });
    setShowSupplierModal(false);
    setEditingSupplier(null);
  }

  function handleDeleteSupplier(id) {
    if (!window.confirm("Eliminare questo fornitore?")) return;
    setSuppliers(prev => prev.filter(s => s.id !== id));
    setSupplierDocs(prev => prev.filter(d => d.supplierId !== id));
    setIngredients(prev => prev.map(ing => ing.supplierId === id
      ? normalizeIngredient({ ...ing, supplierId:null, supplier:"" })
      : ing
    ));
  }

  function handleImportLegacySuppliers() {
    const legacyNames = [...new Set(
      ingredients
        .map(i => (i.supplier || "").trim())
        .filter(Boolean)
    )];
    if (legacyNames.length === 0) return;
    setSuppliers(prev => {
      const existingNames = new Set(prev.map(s => normalizeCompanyKey(s.name || s.ragioneSociale || "")));
      const toAdd = legacyNames
        .filter(name => !existingNames.has(normalizeCompanyKey(name)))
        .map(name => normalizeSupplier({ name, category:"Legacy", approved:true, approvedDate:today() }));
      return mergePreloadedSuppliers([...prev, ...toAdd]);
    });
    setFornMsg({ type:"ok", text:"✓ Fornitori legacy importati e unificati con il catalogo base." });
  }

  function handleImportPreloadedSuppliers() {
    setSuppliers(prev => mergePreloadedSuppliers(prev));
    setFornMsg({ type:"ok", text:`✓ Catalogo fornitori caricato: ${PRELOADED_SUPPLIERS_RAW.length} anagrafiche base da archivio fatture 2025-2026 con prodotti.` });
  }

  function handleSaveDoc(doc) {
    const normalized = normalizeSupplierDoc(doc);
    setSupplierDocs(prev => {
      const exists = prev.some(d => d.id === normalized.id);
      return exists ? prev.map(d => d.id === normalized.id ? normalized : d) : [normalized, ...prev];
    });
    if (typeof setHaccpTasks === "function") {
      if (normalized.stato === "scaduto" || normalized.stato === "in_scadenza") {
        const docTask = buildCriticalDocTask(normalized, suppliers, sede);
        setHaccpTasks(prev => upsertTaskBySource(prev, docTask));
      } else {
        setHaccpTasks(prev => removeTasksBySource(prev, "supplierDoc", normalized.id));
      }
    }
    setShowDocModal(false);
  }

  function handleDeleteDoc(id) {
    if (!window.confirm("Eliminare questo documento?")) return;
    setSupplierDocs(prev => prev.filter(d => d.id !== id));
    if (typeof setHaccpTasks === "function") {
      setHaccpTasks(prev => removeTasksBySource(prev, "supplierDoc", id));
    }
  }

  function handleIngredientSupplier(ingredientId, supplierId) {
    const supplier = suppliers.find(s => s.id === supplierId);
    setIngredients(prev => prev.map(ing => ing.id !== ingredientId ? ing : normalizeIngredient({
      ...ing,
      supplierId: supplierId || null,
      supplier: supplier?.name || "",
    })));
  }

  function handleIngredientField(ingredientId, key, value) {
    setIngredients(prev => prev.map(ing => ing.id !== ingredientId ? ing : normalizeIngredient({
      ...ing,
      [key]: value,
    })));
  }


  function handleAutoLinkIngredients() {
    let linked = 0;
    setIngredients(prev => prev.map(ing => {
      if (ing.supplierId) return ing;
      const suggestion = inferSupplierForIngredient(ing, suppliers);
      if (!suggestion?.supplierId) return ing;
      linked += 1;
      return normalizeIngredient({
        ...ing,
        supplierId: suggestion.supplierId,
        supplier: suggestion.supplierName || "",
      });
    }));
    setFornMsg(
      linked > 0
        ? { type:"ok", text:`✓ Collegati automaticamente ${linked} ingredienti ai fornitori suggeriti dal catalogo prodotti.` }
        : { type:"err", text:"Nessun ingrediente collegato automaticamente: confidenza troppo bassa o ingredienti già assegnati." }
    );
  }

  const linkedCount = ingredients.filter(i => i.supplierId || i.supplier).length;
  const docsExpiring = supplierDocs.filter(d => d.stato === "in_scadenza" || d.stato === "scaduto").length;
  const reorderRows = ingredients
    .map(ing => {
      const current_g = Number(ing.stockBySede?.[sede]?.currentStock_g || 0);
      const min_g = Number(ing.stockBySede?.[sede]?.minStock_g || 0);
      const shortage_g = Math.max(0, min_g - current_g);
      const supplierId = ing.supplierId || null;
      const supplier = suppliers.find(s => s.id === supplierId) || null;
      return {
        ingredientId: ing.id,
        ingredientName: ing.name,
        supplierId,
        supplierName: supplier?.name || ing.supplier || "Non assegnato",
        leadTimeDays: supplier?.leadTimeDays ?? ing.leadTimeDays ?? null,
        current_g,
        min_g,
        shortage_g,
        estimatedValue: shortage_g * Number(ing.cost || 0),
        risk: ing.haccpRiskLevel || "medio",
      };
    })
    .filter(r => r.shortage_g > 0)
    .sort((a, b) => {
      const sCmp = String(a.supplierName).localeCompare(String(b.supplierName));
      if (sCmp !== 0) return sCmp;
      return b.shortage_g - a.shortage_g;
    });
  const reorderBySupplier = reorderRows.reduce((acc, row) => {
    const key = row.supplierId || `missing:${row.supplierName}`;
    if (!acc[key]) acc[key] = { supplierId: row.supplierId, supplierName: row.supplierName, leadTimeDays: row.leadTimeDays, rows: [], totalValue: 0 };
    acc[key].rows.push(row);
    acc[key].totalValue += row.estimatedValue;
    return acc;
  }, {});
  const selectedOrderGroup = selectedOrderGroupKey ? reorderBySupplier[selectedOrderGroupKey] || null : null;

  function generateReorderTasks() {
    if (typeof setHaccpTasks !== "function") return;
    setHaccpTasks(prev => {
      let next = [...prev];
      reorderRows.forEach(row => {
        const task = normalizeHaccpTask({
          sourceType: "supplierReorder",
          sourceId: `${sede}:${row.ingredientId}`,
          priority: row.risk === "alto" ? "alta" : row.risk === "basso" ? "bassa" : "media",
          title: `Riordino ${row.ingredientName}`,
          category: "riordino",
          sede,
          dueDate: today(),
          status: "open",
          owner: suppliers.find(s => s.id === row.supplierId)?.referente || "",
          note: `Sotto scorta di ${fmtStock(row.shortage_g)} · fornitore ${row.supplierName}`,
        });
        next = upsertTaskBySource(next, task);
      });
      return next.slice(0, MAX_TASKS);
    });
  }

  async function handleCopyOrderMessage(group) {
    const supplier = suppliers.find(s => s.id === group.supplierId);
    const ok = await copyTextToClipboard(buildSupplierOrderMessage({ group, supplier, sede }));
    if (ok) setFornMsg({ type:"ok",  text:`✓ Testo ordine copiato per ${group.supplierName}.` });
    else    setFornMsg({ type:"err", text:"Impossibile copiare il testo ordine automaticamente." });
    setTimeout(() => setFornMsg(null), 3000);
  }

  function handleExportReorderCsv(group) {
    exportRowsToCsv(
      `k2-riordino-${(group?.supplierName || 'fornitore').replace(/\s+/g, '-').toLowerCase()}-${today()}.csv`,
      [
        { label:'Fornitore', value:() => group.supplierName },
        { label:'Ingrediente', value:'ingredientName' },
        { label:'Stock attuale g', value:'current_g' },
        { label:'Scorta minima g', value:'min_g' },
        { label:'Da ordinare g', value:'shortage_g' },
        { label:'Rischio HACCP', value:'risk' },
      ],
      group?.rows || []
    );
  }

  function createPurchaseOrdersFromReorder() {
    if (typeof setPurchaseOrders !== "function") return;
    if (!canUserPerform(currentUser?.role || "shop", "manageSuppliers")) {
      setFornMsg({ type:"err", text:"Permesso negato: solo Amministratore può generare ordini fornitore." });
      return;
    }
    const orders = Object.values(reorderBySupplier).map(group => normalizePurchaseOrder({
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      sede,
      date: today(),
      status: "draft",
      createdBy: currentUser?.name || "",
      lines: group.rows.map(row => ({
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        current_g: row.current_g,
        min_g: row.min_g,
        shortage_g: row.shortage_g,
        risk: row.risk,
        estimatedValue: row.estimatedValue,
        ordered_g: row.shortage_g,
      })),
    }));
    setPurchaseOrders(prev => {
      const dedupeKey = new Set(prev.map(o => `${o.supplierId || o.supplierName}|${o.sede}|${o.date}|${o.status}`));
      const fresh = orders.filter(o => !dedupeKey.has(`${o.supplierId || o.supplierName}|${o.sede}|${o.date}|${o.status}`));
      return [...fresh, ...prev].slice(0, 300);
    });
    setFornMsg({ type:"ok", text:`✓ Creati ${orders.length} ordini fornitore in bozza.` });
  }

  function updatePurchaseOrderStatus(orderId, status) {
    if (typeof setPurchaseOrders !== "function") return;
    setPurchaseOrders(prev => prev.map(order => order.id !== orderId ? order : normalizePurchaseOrder({ ...order, status })));
  }

  const visiblePurchaseOrders = (purchaseOrders || [])
    .filter(order => !order.sede || order.sede === sede)
    .sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));
  const selectedPurchaseOrder = visiblePurchaseOrders.find(order => order.id === selectedPurchaseOrderId) || null;

  const currentTabTitle = {
    anagrafica: "Anagrafica fornitori",
    documenti: "Documenti e scadenze fornitori",
    ingredienti: "Mappa ingredienti e fornitori",
    riordino: "Piano riordino fornitori",
    ordini: "Ordini fornitori",
  }[tab];

  return (
    <div>
      <PrintDoc>
        <PrintDocHeader
          title="Fornitori"
          subtitle={currentTabTitle}
          sede={sede}
          extra={<div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>Fornitori attivi: {suppliers.filter(s => s.active !== false).length}</div>}
        />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:10, flexWrap:"wrap" }}>
        <div>
          <h2 style={{ margin:0, fontSize:17, fontWeight:"normal" }}>🚚 Fornitori — {sede}</h2>
          <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:3 }}>Anagrafica, documenti, collegamento ingredienti e storico fornitori.</div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <PrintButton label="🖨️ Stampa" />
          <button onClick={handleImportPreloadedSuppliers} style={btnS}>📥 Catalogo fatture</button>
          <button onClick={handleImportLegacySuppliers} style={btnS}>⇅ Importa legacy</button>
          <button onClick={() => { setEditingSupplier(null); setShowSupplierModal(true); }} style={btnP}>+ Nuovo fornitore</button>
        </div>
      </div>
      {fornMsg && (
        <div style={{ marginBottom:12, padding:"10px 16px", borderRadius:9,
          background: fornMsg.type==="ok" ? "#10b98118" : "#ef444418",
          border: `1px solid ${fornMsg.type==="ok" ? "#10b98155" : "#ef444455"}`,
          color: fornMsg.type==="ok" ? "#10b981" : "#ef4444",
          fontSize:13, fontWeight:600 }}>
          {fornMsg.text}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:12 }}>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#c8a96e" }}>{suppliers.length}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Fornitori</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#60a5fa" }}>{supplierDocs.length}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Documenti</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#4ade80" }}>{linkedCount}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Ingredienti collegati</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:docsExpiring > 0 ? "#fbbf24" : "#4ade80" }}>{docsExpiring}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Doc critici</div>
        </div>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:12, flexWrap:"wrap" }}>
        {[["anagrafica","📇 Anagrafica"],["documenti","📄 Documenti"],["ingredienti","🥛 Ingredienti"],["riordino","📦 Riordino"],["ordini","🧾 Ordini"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding:"6px 12px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)", fontWeight:tab===id?"bold":"normal" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "anagrafica" && (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Cerca fornitore o prodotto..." style={{ ...inp, maxWidth:320 }} />
            <button type="button" onClick={handleImportPreloadedSuppliers} style={btnS}>📥 Carica catalogo fornitori</button>
            <button type="button" onClick={handleImportLegacySuppliers} style={btnS}>🧩 Importa legacy da ingredienti</button>
          </div>
          {filteredSuppliers.length === 0 ? (
            <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessun fornitore presente.</div>
          ) : (
            <div style={{ display:"grid", gap:8 }}>
              {filteredSuppliers.map(s => {
                const docStatus = supplierDocsStatusForSupplier(s.id, supplierDocs);
                return (
                  <div key={s.id} style={{ ...card, marginBottom:0 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
                          <span style={{ fontSize:15, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{s.name || "Fornitore senza nome"}</span>
                          {statusPill(docStatus)}
                          {s.backup && <span style={{ fontSize:10, color:"#a78bfa", background:"rgba(167,139,250,0.12)", border:"1px solid #a78bfa44", borderRadius:10, padding:"2px 8px" }}>Backup</span>}
                          {!s.active && <span style={{ fontSize:10, color:"#f87171", background:"rgba(248,113,113,0.12)", border:"1px solid #f8717144", borderRadius:10, padding:"2px 8px" }}>Inattivo</span>}
                        </div>
                        <div style={{ fontSize:11, color:"var(--k2-text-muted)", marginBottom:4 }}>
                          {s.category || "Categoria non definita"} · Lead time: <strong>{s.leadTimeDays ?? "—"}</strong> gg · Rating qualità: <strong>{fmt(s.ratingQualita, 1)}</strong>/5
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, fontSize:11 }}>
                          <div style={{ color:"var(--k2-text-dim)" }}>Referente<br/><strong style={{ color:"var(--k2-text-secondary)" }}>{s.referente || "—"}</strong></div>
                          <div style={{ color:"var(--k2-text-dim)" }}>Contatti<br/><strong style={{ color:"var(--k2-text-secondary)" }}>{s.telefono || s.email || "—"}</strong></div>
                          <div style={{ color:"var(--k2-text-dim)" }}>Consegne<br/><strong style={{ color:"var(--k2-text-secondary)" }}>{s.giorniConsegna.length > 0 ? s.giorniConsegna.join(", ") : "—"}</strong></div>
                        </div>
                        <div style={{ marginTop:8, fontSize:10, color:"var(--k2-text-dim)" }}>
                          P.IVA: <strong style={{ color:"var(--k2-text-secondary)" }}>{s.piva || "—"}</strong> · Prodotti censiti: <strong style={{ color:"var(--k2-text-secondary)" }}>{(s.products || []).length}</strong>
                        </div>
                        {(s.products || []).length > 0 && (
                          <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
                            {(s.products || []).slice(0, 8).map((prod, idx) => (
                              <span key={`${s.id}-prod-${idx}`} style={{ fontSize:10, color:"#c8a96e", background:"rgba(200,169,110,0.12)", border:"1px solid #c8a96e33", borderRadius:999, padding:"3px 8px" }}>
                                {prod}
                              </span>
                            ))}
                            {(s.products || []).length > 8 && (
                              <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>+{(s.products || []).length - 8} altri</span>
                            )}
                          </div>
                        )}
                        {s.note && <div style={{ marginTop:8, fontSize:11, color:"var(--k2-text-muted)", fontStyle:"italic" }}>{s.note}</div>}
                      </div>
                      <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                        <button onClick={() => { setEditingSupplier(s); setShowSupplierModal(true); }} style={btnS}>✏️ Modifica</button>
                        <button onClick={() => handleDeleteSupplier(s.id)} style={btnD}>🗑️</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "documenti" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:12, color:"var(--k2-text-muted)" }}>Monitora schede tecniche, certificati, allergeni, MOCA e listini.</div>
            <button onClick={() => setShowDocModal(true)} style={btnP}>+ Nuovo documento</button>
          </div>
          {supplierDocs.length === 0 ? (
            <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessun documento registrato.</div>
          ) : (
            <div style={card}>
              {supplierDocs
                .slice()
                .sort((a, b) => String(b.dataScadenza || "").localeCompare(String(a.dataScadenza || "")))
                .map(doc => {
                  const sup = suppliers.find(s => s.id === doc.supplierId);
                  return (
                    <div key={doc.id} style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr auto auto", gap:10, alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                      <div>
                        <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{doc.nomeDocumento || "Documento"}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{sup?.name || "Fornitore non assegnato"} · {doc.tipo || "—"}</div>
                      </div>
                      <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>
                        Emissione: {doc.dataEmissione ? formatDateIT(doc.dataEmissione) : "—"}<br/>
                        Scadenza: {doc.dataScadenza ? formatDateIT(doc.dataScadenza) : "—"}
                      </div>
                      <div>{statusPill(doc.stato)}</div>
                      <button onClick={() => handleDeleteDoc(doc.id)} style={btnD}>🗑️</button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {tab === "ingredienti" && (
        <div style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
            <div style={{ fontSize:12, color:"var(--k2-text-muted)" }}>
              Collega ogni ingrediente al fornitore principale e imposta il livello di rischio HACCP.
            </div>
            <button type="button" onClick={handleAutoLinkIngredients} style={btnS}>🪄 Auto-collega ingredienti</button>
          </div>
          {ingredients
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ing => {
              const suggestion = ingredientSuggestions[ing.id];
              return (
                <div key={ing.id} style={{ display:"grid", gridTemplateColumns:"1.3fr 1fr 120px 110px", gap:10, alignItems:"center", padding:"9px 0", borderBottom:"1px solid var(--k2-border)" }}>
                  <div>
                    <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{ing.name}</div>
                    <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{ing.category}</div>
                    {!ing.supplierId && suggestion?.supplierId && (
                      <div style={{ fontSize:10, color:"#c8a96e", marginTop:4 }}>
                        Suggerito: <strong>{suggestion.supplierName}</strong>
                        {suggestion.productMatch ? ` · match: ${suggestion.productMatch}` : ""}
                      </div>
                    )}
                  </div>
                  <select value={ing.supplierId || ""} onChange={e => handleIngredientSupplier(ing.id, e.target.value)} style={{ ...inp, width:"100%", fontSize:11 }}>
                    <option value="">— Nessun fornitore —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select value={ing.haccpRiskLevel || "medio"} onChange={e => handleIngredientField(ing.id, "haccpRiskLevel", e.target.value)} style={{ ...inp, width:"100%", fontSize:11 }}>
                    <option value="basso">Rischio basso</option>
                    <option value="medio">Rischio medio</option>
                    <option value="alto">Rischio alto</option>
                  </select>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--k2-text-muted)" }}>
                    <input type="checkbox" checked={!!ing.requiresTempCheck} onChange={e => handleIngredientField(ing.id, "requiresTempCheck", e.target.checked)} />
                    Temp.
                  </label>
                </div>
              );
            })}
        </div>
      )}

      {tab === "riordino" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12, flexWrap:"wrap" }}>
            <div style={{ fontSize:12, color:"var(--k2-text-muted)" }}>
              Suggerimenti di riordino costruiti dalle scorte minime della sede attiva.
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {typeof setHaccpTasks === "function" && <button onClick={generateReorderTasks} style={btnS}>⚡ Genera task riordino</button>}
              {typeof setPurchaseOrders === "function" && <button onClick={createPurchaseOrdersFromReorder} style={btnS}>🧾 Crea ordini</button>}
            </div>
          </div>
          {reorderRows.length === 0 ? (
            <div style={{ ...card, textAlign:"center", color:"#4ade80", padding:"36px" }}>✓ Nessun ingrediente sotto scorta minima per {sede}</div>
          ) : (
            <div style={{ display:"grid", gap:10 }}>
              {Object.values(reorderBySupplier).map(group => {
                const supplier = suppliers.find(s => s.id === group.supplierId);
                return (
                  <div key={group.supplierId || group.supplierName} style={card}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", marginBottom:10, flexWrap:"wrap" }}>
                      <div>
                        <div style={{ fontSize:13, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{group.supplierName}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Lead time: {group.leadTimeDays ?? supplier?.leadTimeDays ?? "—"} gg · Minimo ordine: {fmtE(supplier?.minOrderValue || 0)}</div>
                      </div>
                      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                        <div style={{ fontSize:11, color:"#c8a96e", fontWeight:"bold" }}>Valore stimato: {fmtE(group.totalValue)}</div>
                        <button type="button" onClick={() => handleCopyOrderMessage(group)} style={{ ...btnS, fontSize:10 }}>📋 Copia ordine</button>
                        <button type="button" onClick={() => setSelectedOrderGroupKey((group.supplierId || `missing:${group.supplierName}`))} style={{ ...btnS, fontSize:10 }}>🧾 Documento ordine</button>
                        <button type="button" onClick={() => handleExportReorderCsv(group)} style={{ ...btnS, fontSize:10 }}>⬇️ CSV</button>
                      </div>
                    </div>
                    {group.rows.map(row => (
                      <div key={`reorder-${row.ingredientId}`} style={{ display:"grid", gridTemplateColumns:"1.3fr auto auto auto auto", gap:10, alignItems:"center", padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                        <div>
                          <div style={{ fontSize:12, color:"var(--k2-text-secondary)" }}>{row.ingredientName}</div>
                          <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Rischio HACCP: {row.risk}</div>
                        </div>
                        <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>Stock: {fmtStock(row.current_g)}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>Min: {fmtStock(row.min_g)}</div>
                        <div style={{ fontSize:11, color:"#f87171", fontWeight:"bold" }}>Manca: {fmtStock(row.shortage_g)}</div>
                        <div>{statusPill(row.risk === "alto" ? "critico" : "attenzione")}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {selectedOrderGroup && (() => {
            const selectedSupplier = suppliers.find(s => s.id === selectedOrderGroup.supplierId) || null;
            const orderDoc = buildSupplierOrderPrintableData({ group:selectedOrderGroup, supplier:selectedSupplier, sede });
            return (
              <div style={{ ...card, marginTop:12, borderLeft:'3px solid #c8a96e' }}>
                <div className="k2-no-print" style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontSize:11, color:'#c8a96e', letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:'bold' }}>Documento ordine fornitore</div>
                    <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Anteprima stampabile / copiabile per {orderDoc.supplierName}</div>
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    <button onClick={() => setSelectedOrderGroupKey(null)} style={btnS}>Chiudi</button>
                    <PrintButton label="🖨️ Stampa ordine" />
                  </div>
                </div>
                <PrintDoc>
                  <div className="k2-print-section k2-print-avoid-break" style={{ background:'white', color:'#1a1508', padding:18, borderRadius:6 }}>
                    <div style={{ fontSize:9, color:'#9a8e7e', letterSpacing:'0.18em', textTransform:'uppercase', marginBottom:6 }}>Ordine fornitore</div>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', marginBottom:14, flexWrap:'wrap' }}>
                      <div>
                        <div style={{ fontSize:22, fontWeight:'bold' }}>{orderDoc.supplierName}</div>
                        <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:4 }}>{orderDoc.referente || 'Referente non indicato'}{orderDoc.contatti ? ` · ${orderDoc.contatti}` : ''}</div>
                      </div>
                      <div style={{ textAlign:'right', fontSize:11, color:"var(--k2-text-dim)" }}>
                        <div>Data: <strong style={{ color:'#1a1508' }}>{formatDateIT(orderDoc.date)}</strong></div>
                        <div>Sede: <strong style={{ color:'#1a1508' }}>{orderDoc.sede}</strong></div>
                        <div>Lead time: <strong style={{ color:'#1a1508' }}>{orderDoc.leadTimeDays ?? '—'} gg</strong></div>
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr style={{ background:'#f6f1e7' }}>
                          <th style={{ textAlign:'left', padding:'7px 8px', borderBottom:'1px solid #d8cda8', fontSize:11 }}>Ingrediente</th>
                          <th style={{ textAlign:'right', padding:'7px 8px', borderBottom:'1px solid #d8cda8', fontSize:11 }}>Stock</th>
                          <th style={{ textAlign:'right', padding:'7px 8px', borderBottom:'1px solid #d8cda8', fontSize:11 }}>Min</th>
                          <th style={{ textAlign:'right', padding:'7px 8px', borderBottom:'1px solid #d8cda8', fontSize:11 }}>Da ordinare</th>
                          <th style={{ textAlign:'left', padding:'7px 8px', borderBottom:'1px solid #d8cda8', fontSize:11 }}>Rischio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderDoc.lines.map(line => (
                          <tr key={`ord-${line.idx}`}>
                            <td style={{ padding:'7px 8px', borderBottom:'1px solid #efe7d0', fontSize:11 }}>{line.ingredientName}</td>
                            <td style={{ padding:'7px 8px', borderBottom:'1px solid #efe7d0', fontSize:11, textAlign:'right' }}>{fmtStock(line.current_g)}</td>
                            <td style={{ padding:'7px 8px', borderBottom:'1px solid #efe7d0', fontSize:11, textAlign:'right' }}>{fmtStock(line.min_g)}</td>
                            <td style={{ padding:'7px 8px', borderBottom:'1px solid #efe7d0', fontSize:11, textAlign:'right', fontWeight:'bold' }}>{fmtStock(line.shortage_g)}</td>
                            <td style={{ padding:'7px 8px', borderBottom:'1px solid #efe7d0', fontSize:11 }}>{line.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop:14, display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                      <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>Richiesta di conferma disponibilità, tempi di consegna e documenti/lotti ove necessari.</div>
                      <div style={{ fontSize:13, fontWeight:'bold', color:'#1a1508' }}>Valore stimato: {fmtE(orderDoc.totalValue)}</div>
                    </div>
                  </div>
                </PrintDoc>
              </div>
            );
          })()}
        </div>
      )}

      {tab === "ordini" && (
        <div>
          {visiblePurchaseOrders.length === 0 ? (
            <div style={{ ...card, textAlign:"center", color:"var(--k2-text-muted)", padding:"38px" }}>
              Nessun ordine fornitore registrato. Generali dal tab Riordino.
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1.1fr", gap:12 }}>
              <div style={card}>
                <div style={{ fontSize:11, color:"#c8a96e", marginBottom:8 }}>Storico ordini</div>
                {visiblePurchaseOrders.map(order => (
                  <div key={order.id} onClick={() => setSelectedPurchaseOrderId(order.id)} style={{ padding:"10px 0", borderBottom:"1px solid var(--k2-border)", cursor:"pointer", background:selectedPurchaseOrderId===order.id ? "rgba(200,169,110,0.06)" : "transparent" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{order.supplierName || "Fornitore"}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(order.date)} · {order.lines.length} righe · {order.createdBy || "utente non indicato"}</div>
                      </div>
                      <div>{statusPill(order.status)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={card}>
                {!selectedPurchaseOrder ? (
                  <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Seleziona un ordine.</div>
                ) : (
                  <>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", marginBottom:10, flexWrap:"wrap" }}>
                      <div>
                        <div style={{ fontSize:15, color:"#c8a96e", fontWeight:"bold" }}>{selectedPurchaseOrder.supplierName}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(selectedPurchaseOrder.date)} · {selectedPurchaseOrder.sede}</div>
                      </div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {["draft","sent","partial","received","cancelled"].map(st => (
                          <button key={st} onClick={() => updatePurchaseOrderStatus(selectedPurchaseOrder.id, st)} style={{ ...btnS, fontSize:10, padding:"4px 8px", borderColor:selectedPurchaseOrder.status===st ? "#c8a96e66" : "var(--k2-border)", color:selectedPurchaseOrder.status===st ? "#c8a96e" : "var(--k2-text-dim)" }}>{st}</button>
                        ))}
                      </div>
                    </div>
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead><tr style={{ borderBottom:"1px solid var(--k2-border)" }}><th style={{ padding:"6px 8px", textAlign:"left", fontSize:10 }}>Ingrediente</th><th style={{ padding:"6px 8px", textAlign:"right", fontSize:10 }}>Da ordinare</th><th style={{ padding:"6px 8px", textAlign:"left", fontSize:10 }}>Rischio</th></tr></thead>
                      <tbody>
                        {selectedPurchaseOrder.lines.map((line, idx) => (
                          <tr key={`po-${idx}`} style={{ borderBottom:"1px solid var(--k2-border)" }}>
                            <td style={{ padding:"7px 8px", fontSize:11 }}>{line.ingredientName}</td>
                            <td style={{ padding:"7px 8px", fontSize:11, textAlign:"right", fontWeight:"bold" }}>{fmtStock(line.ordered_g || line.shortage_g || 0)}</td>
                            <td style={{ padding:"7px 8px", fontSize:11 }}>{line.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                      <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>{selectedPurchaseOrder.note || "Ricezione merce da registrare in HACCP quando arriva la consegna."}</div>
                      <PrintButton label="🖨️ Stampa ordine" />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <PrintDocFooter sede={sede} />
      </PrintDoc>

      {showSupplierModal && (
        <SupplierModal
          initial={editingSupplier}
          onSave={handleSaveSupplier}
          onClose={() => { setShowSupplierModal(false); setEditingSupplier(null); }}
        />
      )}

      {showDocModal && (
        <SupplierDocModal
          suppliers={suppliers}
          onSave={handleSaveDoc}
          onClose={() => setShowDocModal(false)}
        />
      )}
    </div>
  );
}

function SupplierModal({ initial, onSave, onClose }) {
  const base = normalizeSupplier(initial || {});
  const [form, setForm] = useState(base);
  const [giorniText, setGiorniText] = useState((base.giorniConsegna || []).join(", "));
  const [productsText, setProductsText] = useState((base.products || []).join("\n"));
  const [err, setErr] = useState("");

  function update(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.name.trim()) {
      setErr("Inserisci il nome del fornitore.");
      return;
    }
    onSave({
      ...form,
      name: form.name.trim(),
      giorniConsegna: giorniText.split(",").map(s => s.trim()).filter(Boolean),
      products: productsText.split(/\n|,/).map(s => s.trim()).filter(Boolean),
      haccpDocsStatus: "ok",
      approvedDate: form.approved ? (form.approvedDate || today()) : null,
    });
  }

  return (
    <Modal title={initial ? "✏️ Modifica fornitore" : "🚚 Nuovo fornitore"} onClose={onClose} maxWidth={620}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Nome commerciale</label><input value={form.name} onChange={e => { update("name", e.target.value); setErr(""); }} style={inp} /></div>
          <div><label style={lbl}>Categoria</label><input value={form.category} onChange={e => update("category", e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Referente</label><input value={form.referente} onChange={e => update("referente", e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Telefono</label><input value={form.telefono} onChange={e => update("telefono", e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Email</label><input value={form.email} onChange={e => update("email", e.target.value)} style={inp} /></div>
          <div><label style={lbl}>P.IVA</label><input value={form.piva} onChange={e => update("piva", e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Lead time (giorni)</label><input type="number" value={form.leadTimeDays ?? ""} onChange={e => update("leadTimeDays", e.target.value === "" ? null : Number(e.target.value))} style={inp} /></div>
          <div><label style={lbl}>Minimo ordine (€)</label><input type="number" value={form.minOrderValue ?? 0} onChange={e => update("minOrderValue", Number(e.target.value || 0))} style={inp} /></div>
          <div><label style={lbl}>Pagamento</label><input value={form.paymentTerms} onChange={e => update("paymentTerms", e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Ragione sociale</label><input value={form.ragioneSociale} onChange={e => update("ragioneSociale", e.target.value)} style={inp} /></div>
        </div>
        <div><label style={lbl}>Giorni consegna (separati da virgola)</label><input value={giorniText} onChange={e => setGiorniText(e.target.value)} style={inp} placeholder="lun, gio" /></div>
        <div><label style={lbl}>Prodotti / servizi del fornitore</label><textarea value={productsText} onChange={e => setProductsText(e.target.value)} style={{ ...inp, minHeight:100, resize:"vertical" }} placeholder="Un prodotto per riga oppure separati da virgola" /></div>
        <div><label style={lbl}>Note</label><textarea value={form.note} onChange={e => update("note", e.target.value)} style={{ ...inp, minHeight:80, resize:"vertical" }} /></div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:11, color:"var(--k2-text-muted)" }}>
          <label><input type="checkbox" checked={form.active !== false} onChange={e => update("active", e.target.checked)} /> Attivo</label>
          <label><input type="checkbox" checked={form.backup === true} onChange={e => update("backup", e.target.checked)} /> Fornitore backup</label>
          <label><input type="checkbox" checked={form.approved !== false} onChange={e => update("approved", e.target.checked)} /> Approvato HACCP</label>
        </div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva</button>
        </div>
      </div>
    </Modal>
  );
}

function SupplierDocModal({ suppliers, onSave, onClose }) {
  const [form, setForm] = useState({
    supplierId: suppliers[0]?.id || "",
    tipo: "Scheda tecnica",
    nomeDocumento: "",
    dataEmissione: today(),
    dataScadenza: "",
    note: "",
  });
  const [err, setErr] = useState("");

  function handleSave() {
    if (!form.supplierId) { setErr("Seleziona un fornitore."); return; }
    if (!form.nomeDocumento.trim()) { setErr("Inserisci il nome del documento."); return; }
    onSave({
      ...form,
      stato: computeDocStatus(form.dataScadenza || null),
    });
  }

  return (
    <Modal title="📄 Nuovo documento fornitore" onClose={onClose} maxWidth={520}>
      <div style={{ display:"grid", gap:12 }}>
        <div><label style={lbl}>Fornitore</label><select value={form.supplierId} onChange={e => { setForm(f => ({ ...f, supplierId:e.target.value })); setErr(""); }} style={inp}>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label style={lbl}>Tipo documento</label><input value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo:e.target.value }))} style={inp} /></div>
        <div><label style={lbl}>Nome documento</label><input value={form.nomeDocumento} onChange={e => { setForm(f => ({ ...f, nomeDocumento:e.target.value })); setErr(""); }} style={inp} /></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Data emissione</label><input type="date" value={form.dataEmissione} onChange={e => setForm(f => ({ ...f, dataEmissione:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Data scadenza</label><input type="date" value={form.dataScadenza} onChange={e => setForm(f => ({ ...f, dataScadenza:e.target.value }))} style={inp} /></div>
        </div>
        <div><label style={lbl}>Note</label><textarea value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} style={{ ...inp, minHeight:70, resize:"vertical" }} /></div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva documento</button>
        </div>
      </div>
    </Modal>
  );
}


function Haccp({
  sede, ingredients, setIngredients, suppliers, setSuppliers, supplierDocs,
  goodsReceipts, setGoodsReceipts,
  haccpTemps, setHaccpTemps,
  haccpSanifications, setHaccpSanifications,
  haccpNonConformities, setHaccpNonConformities,
  haccpTraceability, setHaccpTraceability,
  haccpTasks, setHaccpTasks,
  movimenti, setMovimenti, recipes,
  currentUserRole = "admin",
}) {
  const [tab, setTab] = useState("accettazione");
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showTempModal, setShowTempModal] = useState(false);
  const [showSanModal, setShowSanModal] = useState(false);
  const [showNcModal, setShowNcModal] = useState(false);
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [recallQuery, setRecallQuery] = useState("");

  function saveReceipt(data) {
    if (!canUserPerform(currentUserRole, "receiveGoods")) {
      window.alert("Permesso negato: il profilo corrente non può registrare ricevimenti merce.");
      return;
    }
    const normalized = normalizeGoodsReceipt(data);
    const ingredient = ingredients.find(i => i.id === normalized.ingredientId);
    const supplier = suppliers.find(s => s.id === normalized.supplierId);
    const qtyReceived_g = Number(normalized.qtyReceived_g || 0);
    const totalCost = Number(normalized.totalCost || 0);
    let movimentoId = null;

    if (normalized.accepted && ingredient && qtyReceived_g > 0) {
      const { updatedIngredient, movimento } = applyIngredientStockChange({
        ingredient,
        sede,
        delta_g: qtyReceived_g,
        movementType: "carico",
        causale: "Accettazione merce HACCP",
        date: normalized.date,
        note: normalized.note || normalized.lotCode || "",
        unit: "g",
        overrideCostPerGram: null,
        overridePurchasePrice: null,
        supplierName: supplier?.name || ingredient.supplier || "",
        lotCode: normalized.lotCode || ingredient.lastLotCode || "",
      });
      movimentoId = movimento.id;
      setIngredients(prev => prev.map(i => i.id === ingredient.id ? updatedIngredient : i));
      setMovimenti(prev => [movimento, ...prev].slice(0, MAX_MOVIMENTI));
    }

    if (!normalized.accepted || normalized.packagingOk === false || normalized.labelOk === false || normalized.docsOk === false) {
      setHaccpNonConformities(prev => [
        normalizeNonConformity({
          date: normalized.date,
          sede,
          categoria: "merce",
          gravita: normalized.accepted ? "media" : "alta",
          descrizione: `Accettazione merce critica: ${normalized.ingredientName || "ingrediente"} · lotto ${normalized.lotCode || "—"} · motivo ${normalized.rejectionReason || "verifica negativa"}`,
          correctiveAction: normalized.accepted ? "Verificare fornitore / documenti e registrare follow-up." : "Merce respinta e segnalazione al fornitore.",
          responsible: normalized.operator || "",
          originId: normalized.id,
        }),
        ...prev,
      ].slice(0, MAX_MOVIMENTI));
    }

    const costPerGramCalc = (totalCost > 0 && qtyReceived_g > 0) ? totalCost / qtyReceived_g : (ingredient?.cost || 0);
    setGoodsReceipts(prev => [{ ...normalized, linkedMovimentoId: movimentoId, costPerGram: costPerGramCalc }, ...prev].slice(0, MAX_MOVIMENTI));

    if (typeof setSuppliers === "function" && normalized.supplierId) {
      setSuppliers(prev => prev.map(s => s.id !== normalized.supplierId ? s : normalizeSupplier({
        ...s,
        products: [...(s.products || []), normalized.ingredientName || ingredient?.name || ""],
      })));
    }

    setShowReceiptModal(false);
  }

  function saveTemp(data) {
    const temp = normalizeHaccpTemp(data);
    setHaccpTemps(prev => [temp, ...prev].slice(0, MAX_MOVIMENTI));
    if (temp.esito === "nc") {
      setHaccpNonConformities(prev => [
        normalizeNonConformity({
          date: temp.date,
          sede,
          categoria: "temperatura",
          gravita: "media",
          descrizione: `Temperatura fuori soglia: ${temp.area || "area non specificata"} (${fmt(temp.temp_c, 1)}°C).`,
          correctiveAction: temp.correctiveAction || "Ripristinare la temperatura e verificare l'impianto.",
          responsible: temp.operator || "",
          originId: temp.id,
        }),
        ...prev,
      ].slice(0, MAX_MOVIMENTI));
    }
    setShowTempModal(false);
  }

  function saveSanification(data) {
    const san = normalizeSanification(data);
    setHaccpSanifications(prev => [san, ...prev].slice(0, MAX_MOVIMENTI));
    setShowSanModal(false);
  }

  function saveNc(data) {
    const nc = normalizeNonConformity(data);
    setHaccpNonConformities(prev => [nc, ...prev].slice(0, MAX_MOVIMENTI));
    setShowNcModal(false);
  }

  function saveTrace(data) {
    const trace = normalizeTraceability(data);
    setHaccpTraceability(prev => [trace, ...prev].slice(0, MAX_TRACE_ROWS));
    setShowTraceModal(false);
  }

  function saveTask(data) {
    const task = normalizeHaccpTask(data);
    setHaccpTasks(prev => [task, ...prev].slice(0, MAX_TRACE_ROWS));
    setShowTaskModal(false);
  }

  function toggleNcClosed(id) {
    setHaccpNonConformities(prev => prev.map(nc => nc.id !== id ? nc : normalizeNonConformity({
      ...nc,
      chiusa: !nc.chiusa,
      closeDate: !nc.chiusa ? today() : null,
    })));
  }

  function toggleTaskClosed(id) {
    setHaccpTasks(prev => prev.map(task => task.id !== id ? task : normalizeHaccpTask({
      ...task,
      status: task.status === "done" ? "open" : "done",
    })));
  }

  function generateTasksFromCriticalDocs() {
    const criticalDocs = supplierDocs.filter(d => d.stato === "scaduto" || d.stato === "in_scadenza");
    if (criticalDocs.length === 0) return;
    setHaccpTasks(prev => {
      let next = [...prev];
      criticalDocs.forEach(doc => {
        next = upsertTaskBySource(next, buildCriticalDocTask(doc, suppliers, sede));
      });
      return next.slice(0, MAX_TASKS);
    });
  }

  const visibleGoodsReceipts = goodsReceipts.filter(r => isWithinDateRange(r.date, filterFrom, filterTo));
  const visibleTemps = haccpTemps.filter(t => isWithinDateRange(t.date, filterFrom, filterTo));
  const visibleSanifications = haccpSanifications.filter(s => isWithinDateRange(s.date, filterFrom, filterTo));
  const visibleNc = haccpNonConformities.filter(nc => isWithinDateRange(nc.date, filterFrom, filterTo));
  const visibleTraceability = haccpTraceability.filter(tr => isWithinDateRange(tr.date, filterFrom, filterTo));
  const visibleTasks = haccpTasks.filter(task => isWithinDateRange(task.dueDate, filterFrom, filterTo));
  const visibleSupplierDocs = supplierDocs.filter(doc => isWithinDateRange(doc.dataScadenza || doc.dataEmissione, filterFrom, filterTo));
  const recentMovLinks = visibleGoodsReceipts.filter(r => r.linkedMovimentoId).length;

  const ncAperte = visibleNc.filter(nc => !nc.chiusa).length;
  const tasksAperti = visibleTasks.filter(t => t.status !== "done").length;
  const tasksScaduti = visibleTasks.filter(t => t.status !== "done" && t.dueDate && parseISODate(t.dueDate) < parseISODate(today())).length;
  const docsCritici = visibleSupplierDocs.filter(d => d.stato === "scaduto" || d.stato === "in_scadenza").length;
  const lotAlerts = visibleGoodsReceipts
    .filter(r => r.accepted !== false && (!r.sede || r.sede === sede))
    .map(r => ({ receipt:r, rem:getReceiptRemainingQty(r, haccpTraceability) }))
    .filter(({ rem }) => rem.remaining_g > 0 && !!rem)
    .map(({ receipt, rem }) => {
      const exp = receipt.expiryDate || "";
      const diffDays = exp ? Math.floor((parseISODate(exp) - parseISODate(today())) / 86400000) : null;
      return { receipt, rem, diffDays };
    })
    .filter(x => x.diffDays !== null && x.diffDays <= 30)
    .sort((a,b) => Number(a.diffDays || 9999) - Number(b.diffDays || 9999));
  const recallRows = recallQuery.trim()
    ? visibleTraceability.filter(tr => (tr.ingredientLots || []).some(line => {
        const q = recallQuery.toLowerCase().trim();
        return String(line.lotCode || "").toLowerCase().includes(q)
          || String(line.ingredientName || "").toLowerCase().includes(q);
      }))
    : [];
  const currentTabTitle = {
    accettazione: "Registro accettazione merce",
    temperature: "Registro temperature",
    sanificazioni: "Registro sanificazioni",
    nc: "Registro non conformità",
    tracciabilita: "Registro tracciabilità",
    scadenze: "Scadenze e task HACCP",
  }[tab];
  const currentRangeLabel = formatDateRangeLabel(filterFrom, filterTo);

  function exportCurrentHaccpCsv() {
    if (tab === 'accettazione') {
      exportRowsToCsv(`k2-haccp-accettazione-${today()}.csv`, [
        { label:'Data', value:'date' },
        { label:'Sede', value:'sede' },
        { label:'Ingrediente', value:'ingredientName' },
        { label:'Fornitore lotto', value:'supplierLotCode' },
        { label:'Lotto', value:'lotCode' },
        { label:'Quantità g', value:'qtyReceived_g' },
        { label:'Costo totale', value:'totalCost' },
        { label:'Temperatura arrivo', value:'tempOnArrival_c' },
        { label:'Accettata', value:r => r.accepted ? 'si' : 'no' },
      ], visibleGoodsReceipts);
      return;
    }
    if (tab === 'temperature') {
      exportRowsToCsv(`k2-haccp-temperature-${today()}.csv`, [
        { label:'Data', value:'date' },
        { label:'Sede', value:'sede' },
        { label:'Area', value:'area' },
        { label:'Temperatura', value:'temp_c' },
        { label:'Min', value:'minAllowed_c' },
        { label:'Max', value:'maxAllowed_c' },
        { label:'Esito', value:'esito' },
        { label:'Operatore', value:'operator' },
      ], visibleTemps);
      return;
    }
    if (tab === 'sanificazioni') {
      exportRowsToCsv(`k2-haccp-sanificazioni-${today()}.csv`, [
        { label:'Data', value:'date' },
        { label:'Sede', value:'sede' },
        { label:'Area', value:'area' },
        { label:'Tipo', value:'tipo' },
        { label:'Prodotto', value:'prodottoUsato' },
        { label:'Lotto prodotto', value:'lottoProdotto' },
        { label:'Operatore', value:'operatore' },
        { label:'Esito', value:'esito' },
      ], visibleSanifications);
      return;
    }
    if (tab === 'nc') {
      exportRowsToCsv(`k2-haccp-nc-${today()}.csv`, [
        { label:'Data', value:'date' },
        { label:'Sede', value:'sede' },
        { label:'Categoria', value:'categoria' },
        { label:'Gravità', value:'gravita' },
        { label:'Descrizione', value:'descrizione' },
        { label:'Azione correttiva', value:'correctiveAction' },
        { label:'Responsabile', value:'responsible' },
        { label:'Chiusa', value:nc => nc.chiusa ? 'si' : 'no' },
      ], visibleNc);
      return;
    }
    if (tab === 'tracciabilita') {
      exportRowsToCsv(`k2-haccp-tracciabilita-${today()}.csv`, [
        { label:'Data', value:'date' },
        { label:'Sede', value:'sede' },
        { label:'Ricetta', value:'recipeName' },
        { label:'Lotto produzione', value:'productionLot' },
        { label:'Resa g', value:'outputQty_g' },
        { label:'Dettaglio lotti', value:tr => (tr.ingredientLots || []).map(l => `${l.ingredientName}:${l.lotCode}:${l.qtyUsed_g}`).join(' | ') },
      ], visibleTraceability);
      return;
    }
    exportRowsToCsv(`k2-haccp-scadenze-task-${today()}.csv`, [
      { label:'Tipo', value:row => row.__kind },
      { label:'Data', value:row => row.__kind === 'task' ? row.dueDate : (row.dataScadenza || row.dataEmissione || '') },
      { label:'Titolo', value:row => row.__kind === 'task' ? row.title : row.nomeDocumento },
      { label:'Stato', value:row => row.__kind === 'task' ? row.status : row.stato },
      { label:'Note', value:'note' },
    ], [
      ...visibleSupplierDocs.map(doc => ({ ...doc, __kind:'documento' })),
      ...visibleTasks.map(task => ({ ...task, __kind:'task' })),
    ]);
  }

  const priorityWeight = { alta:0, media:1, bassa:2 };
  const sortedTasks = [...visibleTasks].sort((a, b) => {
    const dueCmp = String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
    if (dueCmp !== 0) return dueCmp;
    return (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9);
  });

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:10, flexWrap:"wrap" }}>
        <div>
          <h2 style={{ margin:0, fontSize:17, fontWeight:"normal" }}>🧪 HACCP — {sede}</h2>
          <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:3 }}>Accettazione merce, temperature, sanificazioni, non conformità, tracciabilità e scadenze.</div>
          <div style={{ fontSize:10, color:"var(--k2-text-muted)", marginTop:4 }}>Periodo attivo: {currentRangeLabel}</div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <button onClick={exportCurrentHaccpCsv} style={btnS}>⬇️ Export CSV</button>
          <PrintButton label="🖨️ Stampa registro" />
          {tab === "accettazione" && <button onClick={() => setShowReceiptModal(true)} style={btnP}>+ Accettazione merce</button>}
          {tab === "temperature" && <button onClick={() => setShowTempModal(true)} style={btnP}>+ Temperatura</button>}
          {tab === "sanificazioni" && <button onClick={() => setShowSanModal(true)} style={btnP}>+ Sanificazione</button>}
          {tab === "nc" && <button onClick={() => setShowNcModal(true)} style={btnP}>+ Non conformità</button>}
          {tab === "tracciabilita" && <button onClick={() => setShowTraceModal(true)} style={btnP}>+ Tracciabilità</button>}
          {tab === "scadenze" && <>
            <button onClick={generateTasksFromCriticalDocs} style={btnS}>⚡ Genera task da doc critici</button>
            <button onClick={() => setShowTaskModal(true)} style={btnP}>+ Task HACCP</button>
          </>}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:12 }}>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#c8a96e" }}>{visibleGoodsReceipts.length}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Accettazioni</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#60a5fa" }}>{visibleTemps.length}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Temperature</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#4ade80" }}>{visibleSanifications.length}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Sanificazioni</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:ncAperte > 0 ? "#f87171" : "#4ade80" }}>{ncAperte}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>NC aperte</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:"#a78bfa" }}>{visibleTraceability.length}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Tracciabilità</div>
        </div>
        <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:"bold", color:(tasksScaduti + docsCritici) > 0 ? "#fbbf24" : "#4ade80" }}>{tasksScaduti + docsCritici}</div>
          <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Scadenze critiche</div>
        </div>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:12, flexWrap:"wrap" }}>
        {[["accettazione","📦 Accettazione"],["temperature","🌡️ Temperature"],["sanificazioni","🧼 Sanificazioni"],["nc","⚠️ NC"],["tracciabilita","🧾 Tracciabilità"],["scadenze","⏰ Scadenze"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding:"6px 12px", fontSize:11, border:"1px solid var(--k2-border)", cursor:"pointer", borderRadius:4, fontFamily:"inherit", background:tab===id?"#c8a96e":"transparent", color:tab===id?"var(--k2-bg)":"var(--k2-text-muted)", fontWeight:tab===id?"bold":"normal" }}>
            {label}
          </button>
        ))}
      </div>

      <div className="k2-no-print" style={{ ...card, marginBottom:12, display:"flex", gap:8, alignItems:"end", flexWrap:"wrap" }}>
        <div><label style={lbl}>Da data</label><input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ ...inp, width:170 }} /></div>
        <div><label style={lbl}>A data</label><input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ ...inp, width:170 }} /></div>
        <button type="button" onClick={() => { setFilterFrom(""); setFilterTo(""); }} style={btnS}>↺ Reset filtro</button>
        <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginLeft:"auto" }}>
          Il registro stampato usa il filtro data corrente.
        </div>
      </div>

      <PrintDoc>
        <PrintDocHeader
          title={currentTabTitle}
          subtitle="HACCP · K2 Suite Demo"
          sede={sede}
          extra={<div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Movimenti collegati: <strong style={{ color:"#1a1508" }}>{recentMovLinks}</strong>{(filterFrom || filterTo) && <><br/>Filtro: <strong style={{ color:"#1a1508" }}>{filterFrom ? formatDateIT(filterFrom) : "inizio"}</strong> → <strong style={{ color:"#1a1508" }}>{filterTo ? formatDateIT(filterTo) : "oggi"}</strong></>}</div>}
        />

        {tab === "accettazione" && (
          <div>
            <div className="k2-print-avoid-break" style={{ ...card, marginBottom:10, fontSize:12, color:"var(--k2-text-muted)" }}>
              Ricevimenti registrati: <strong style={{ color:"var(--k2-text-secondary)" }}>{visibleGoodsReceipts.length}</strong> · Movimenti magazzino collegati: <strong style={{ color:"var(--k2-text-secondary)" }}>{recentMovLinks}</strong>
            </div>
            {visibleGoodsReceipts.length === 0 ? (
              <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessuna accettazione merce registrata.</div>
            ) : (
              <div style={card}>
                {visibleGoodsReceipts.map(r => {
                  const sup = suppliers.find(s => s.id === r.supplierId);
                  return (
                    <div key={r.id} style={{ display:"grid", gridTemplateColumns:"1.3fr 1fr auto", gap:10, alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                      <div>
                        <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{r.ingredientName || "Ingrediente"} · {fmtStock(r.qtyReceived_g)}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
                          {formatDateIT(r.date)} · {sup?.name || "Fornitore"} · lotto {r.lotCode || "—"} {r.supplierLotCode ? `· lotto fornitore ${r.supplierLotCode}` : ""}
                        </div>
                        <div style={{ fontSize:10, color:"var(--k2-text-muted)", marginTop:2 }}>
                          Costo: {fmtE(r.totalCost)} · Temp arrivo: {r.tempOnArrival_c ?? "—"}°C
                        </div>
                      </div>
                      <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>
                        Scadenza: {r.expiryDate ? formatDateIT(r.expiryDate) : "—"}<br/>
                        Operatore: {r.operator || "—"}
                      </div>
                      <div>{statusPill(r.accepted ? "ok" : "nc")}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "temperature" && (
          <div>
            {visibleTemps.length === 0 ? (
              <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessuna temperatura registrata.</div>
            ) : (
              <div style={card}>
                {visibleTemps.map(t => (
                  <div key={t.id} style={{ display:"grid", gridTemplateColumns:"1fr 120px 120px auto", gap:10, alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                    <div>
                      <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{t.area || "Area"}</div>
                      <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(t.date)} · {t.operator || "—"}</div>
                    </div>
                    <div style={{ fontSize:12, color:"#c8a96e", fontWeight:"bold" }}>{fmt(t.temp_c, 1)}°C</div>
                    <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>
                      Min {t.minAllowed_c ?? "—"} · Max {t.maxAllowed_c ?? "—"}
                    </div>
                    <div>{statusPill(t.esito)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "sanificazioni" && (
          <div>
            {visibleSanifications.length === 0 ? (
              <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessuna sanificazione registrata.</div>
            ) : (
              <div style={card}>
                {visibleSanifications.map(s => (
                  <div key={s.id} style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:10, alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                    <div>
                      <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{s.area || "Area"}</div>
                      <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(s.date)} · {s.operatore || "—"}</div>
                    </div>
                    <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>
                      {s.tipo} · {s.prodottoUsato || "Prodotto non indicato"} {s.lottoProdotto ? `· lotto ${s.lottoProdotto}` : ""}
                    </div>
                    <div>{statusPill(s.esito)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "nc" && (
          <div>
            {visibleNc.length === 0 ? (
              <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessuna non conformità registrata.</div>
            ) : (
              <div style={card}>
                {visibleNc.map(nc => (
                  <div key={nc.id} style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr auto auto", gap:10, alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                    <div>
                      <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{nc.categoria || "NC"} · gravità {nc.gravita}</div>
                      <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(nc.date)} · {nc.responsible || "Responsabile non indicato"}</div>
                      <div style={{ fontSize:11, color:"var(--k2-text-muted)", marginTop:3 }}>{nc.descrizione}</div>
                      {nc.correctiveAction && <div style={{ fontSize:10, color:"#c8a96e", marginTop:3 }}>Azione: {nc.correctiveAction}</div>}
                    </div>
                    <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>
                      {nc.closeDate ? `Chiusa il ${formatDateIT(nc.closeDate)}` : "Aperta"}
                    </div>
                    <div>{statusPill(nc.chiusa ? "chiusa" : "aperta")}</div>
                    <button onClick={() => toggleNcClosed(nc.id)} style={btnS}>{nc.chiusa ? "↩ Riapri" : "✓ Chiudi"}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "tracciabilita" && (
          <div>
            <div style={{ ...card, marginBottom:10, fontSize:12, color:"var(--k2-text-muted)" }}>
              Ricette disponibili: <strong style={{ color:"var(--k2-text-secondary)" }}>{recipes?.length || 0}</strong> · Ricevimenti disponibili: <strong style={{ color:"var(--k2-text-secondary)" }}>{visibleGoodsReceipts.length}</strong>
            </div>
            <div style={{ ...card, marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#c8a96e", marginBottom:8 }}>Lotti aperti stimati (FEFO)</div>
              {visibleGoodsReceipts.filter(r => r.accepted !== false && r.sede === sede).length === 0 ? (
                <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Nessun ricevimento accettato disponibile.</div>
              ) : (
                visibleGoodsReceipts
                  .filter(r => r.accepted !== false && r.sede === sede)
                  .map(r => ({ r, rem: getReceiptRemainingQty(r, haccpTraceability) }))
                  .filter(({ rem }) => rem.remaining_g > 0)
                  .sort((a, b) => {
                    const expCmp = String(a.r.expiryDate || "9999-12-31").localeCompare(String(b.r.expiryDate || "9999-12-31"));
                    if (expCmp !== 0) return expCmp;
                    return String(a.r.date || "9999-12-31").localeCompare(String(b.r.date || "9999-12-31"));
                  })
                  .slice(0, 12)
                  .map(({ r, rem }) => (
                    <div key={`open-${r.id}`} style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr auto", gap:10, padding:"7px 0", borderBottom:"1px solid var(--k2-border)" }}>
                      <div style={{ fontSize:11, color:"var(--k2-text-secondary)" }}>{r.ingredientName || "Ingrediente"} · lotto <span style={{ fontFamily:"monospace" }}>{r.lotCode || "—"}</span></div>
                      <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>Ricev. {formatDateIT(r.date)}{r.expiryDate ? ` · Scad. ${formatDateIT(r.expiryDate)}` : ""}</div>
                      <div style={{ fontSize:11, color:"#4ade80", fontWeight:"bold" }}>{fmtStock(rem.remaining_g)}</div>
                    </div>
                  ))
              )}
            </div>
            {visibleTraceability.length === 0 ? (
              <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessuna tracciabilità registrata.</div>
            ) : (
              <div style={card}>
                {visibleTraceability.map(tr => (
                  <div key={tr.id} style={{ padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                      <div>
                        <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{tr.recipeName || "Ricetta"} · lotto {tr.productionLot || "—"}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(tr.date)} · resa {fmtStock(tr.outputQty_g)}</div>
                      </div>
                      <div>{statusPill("ok")}</div>
                    </div>
                    <div style={{ marginTop:8, display:"grid", gap:4 }}>
                      {(tr.ingredientLots || []).length === 0 ? (
                        <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>Nessun lotto ingrediente collegato.</div>
                      ) : (
                        tr.ingredientLots.map((lot, idx) => (
                          <div key={`${tr.id}-${idx}`} style={{ fontSize:10, color:"var(--k2-text-muted)", display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
                            <span>
                              {lot.ingredientName || "Ingrediente"} · lotto {lot.lotCode || "—"}
                              {lot.sourceDetail && <div style={{ fontSize:9, color: lot.sourceType === "manual_check" ? "#b45309" : "var(--k2-text-dim)", marginTop:2 }}>{lot.sourceDetail}</div>}
                            </span>
                            <span>{fmtStock(lot.qtyUsed_g || 0)}</span>
                          </div>
                        ))
                      )}
                    </div>
                    {tr.note && <div style={{ fontSize:10, color:"#c8a96e", marginTop:6 }}>{tr.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "scadenze" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:10 }}>
              <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:"bold", color:"#c8a96e" }}>{tasksAperti}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Task aperti</div>
              </div>
              <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:"bold", color:tasksScaduti > 0 ? "#f87171" : "#4ade80" }}>{tasksScaduti}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Task scaduti</div>
              </div>
              <div style={{ ...card, marginBottom:0, textAlign:"center" }}>
                <div style={{ fontSize:20, fontWeight:"bold", color:docsCritici > 0 ? "#fbbf24" : "#4ade80" }}>{docsCritici}</div>
                <div style={{ fontSize:9, color:"var(--k2-text-dim)" }}>Documenti critici</div>
              </div>
            </div>

            <div style={{ ...card, marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#c8a96e", marginBottom:8 }}>Documenti fornitore da controllare</div>
              {visibleSupplierDocs.filter(d => d.stato === "scaduto" || d.stato === "in_scadenza").length === 0 ? (
                <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Nessun documento critico.</div>
              ) : (
                visibleSupplierDocs
                  .filter(d => d.stato === "scaduto" || d.stato === "in_scadenza")
                  .sort((a, b) => String(a.dataScadenza || "").localeCompare(String(b.dataScadenza || "")))
                  .map(doc => {
                    const sup = suppliers.find(s => s.id === doc.supplierId);
                    return (
                      <div key={doc.id} style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr auto", gap:10, padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                        <div style={{ fontSize:11, color:"var(--k2-text-secondary)" }}>{doc.nomeDocumento || doc.tipo || "Documento"} · {sup?.name || "Fornitore"}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>Scadenza: {doc.dataScadenza ? formatDateIT(doc.dataScadenza) : "—"}</div>
                        <div>{statusPill(doc.stato)}</div>
                      </div>
                    );
                  })
              )}
            </div>

            <div style={{ ...card, marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#c8a96e", marginBottom:8 }}>Lotti in scadenza / scaduti con residuo</div>
              {lotAlerts.length === 0 ? (
                <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Nessun lotto con residuo in scadenza nei prossimi 30 giorni.</div>
              ) : lotAlerts.map(({ receipt, rem, diffDays }) => (
                <div key={`alert-${receipt.id}`} style={{ display:"grid", gridTemplateColumns:"1.3fr 1fr auto auto", gap:10, padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                  <div style={{ fontSize:11, color:"var(--k2-text-secondary)" }}>{receipt.ingredientName} · lotto <span style={{ fontFamily:"monospace" }}>{receipt.lotCode || "—"}</span></div>
                  <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>Scadenza {receipt.expiryDate ? formatDateIT(receipt.expiryDate) : "—"}</div>
                  <div style={{ fontSize:11, color:diffDays < 0 ? "#f87171" : "#fbbf24", fontWeight:"bold" }}>{diffDays < 0 ? "Scaduto" : `${diffDays} gg`}</div>
                  <div style={{ fontSize:11, color:"#4ade80", fontWeight:"bold" }}>{fmtStock(rem.remaining_g)}</div>
                </div>
              ))}
            </div>

            <div style={{ ...card, marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
                <div style={{ fontSize:11, color:"#c8a96e" }}>Richiamo lotto / ricerca retroattiva</div>
                <input value={recallQuery} onChange={e => setRecallQuery(e.target.value)} style={{ ...inp, width:220 }} placeholder="Cerca lotto o ingrediente" />
              </div>
              {!recallQuery.trim() ? (
                <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Inserisci un lotto per vedere tutte le produzioni coinvolte.</div>
              ) : recallRows.length === 0 ? (
                <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>Nessuna produzione trovata per "{recallQuery}".</div>
              ) : recallRows.map(row => (
                <div key={`recall-${row.id}`} style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr auto", gap:10, padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                  <div>
                    <div style={{ fontSize:11, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{row.recipeName || "Ricetta"} · lotto prod. {row.productionLot || "—"}</div>
                    <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{formatDateIT(row.date)} · {row.sede}</div>
                  </div>
                  <div style={{ fontSize:10, color:"var(--k2-text-muted)" }}>{(row.ingredientLots || []).filter(line => String(line.lotCode || "").toLowerCase().includes(recallQuery.toLowerCase().trim()) || String(line.ingredientName || "").toLowerCase().includes(recallQuery.toLowerCase().trim())).map(line => `${line.ingredientName} / ${line.lotCode}`).join(" · ")}</div>
                  <div style={{ fontSize:11, color:"#c8a96e", fontWeight:"bold" }}>{fmtStock(row.outputQty_g || 0)}</div>
                </div>
              ))}
            </div>

            {sortedTasks.length === 0 ? (
              <div style={{ ...card, textAlign:"center", color:"var(--k2-text-dim)", padding:"36px" }}>Nessun task HACCP registrato.</div>
            ) : (
              <div style={card}>
                {sortedTasks.map(task => {
                  const overdue = task.status !== "done" && task.dueDate && parseISODate(task.dueDate) < parseISODate(today());
                  return (
                    <div key={task.id} style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr auto auto", gap:10, alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--k2-border)" }}>
                      <div>
                        <div style={{ fontSize:12, color:"var(--k2-text-secondary)", fontWeight:"bold" }}>{task.title || "Task HACCP"}</div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{task.category || "Categoria"} · {task.owner || "Responsabile non indicato"}</div>
                        {task.note && <div style={{ fontSize:10, color:"var(--k2-text-muted)", marginTop:3 }}>{task.note}</div>}
                      </div>
                      <div style={{ fontSize:11, color:"var(--k2-text-muted)" }}>
                        Scadenza: {task.dueDate ? formatDateIT(task.dueDate) : "—"}
                      </div>
                      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>{statusPill(task.status === "done" ? "chiusa" : overdue ? "scaduto" : "ok")}{task.priority ? statusPill(task.priority) : null}</div>
                      <button onClick={() => toggleTaskClosed(task.id)} style={btnS}>{task.status === "done" ? "↩ Riapri" : "✓ Chiudi"}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <PrintDocFooter sede={sede} />
      </PrintDoc>

      {showReceiptModal && (
        <GoodsReceiptModal
          sede={sede}
          suppliers={suppliers}
          ingredients={ingredients}
          goodsReceipts={goodsReceipts}
          onSave={saveReceipt}
          onClose={() => setShowReceiptModal(false)}
        />
      )}
      {showTempModal && <HaccpTempModal sede={sede} areas={DEFAULT_HACCP_AREAS} onSave={saveTemp} onClose={() => setShowTempModal(false)} />}
      {showSanModal && <SanificationModal sede={sede} onSave={saveSanification} onClose={() => setShowSanModal(false)} />}
      {showNcModal && <NonConformityModal sede={sede} onSave={saveNc} onClose={() => setShowNcModal(false)} />}
      {showTraceModal && <TraceabilityModal sede={sede} recipes={recipes || []} goodsReceipts={goodsReceipts} onSave={saveTrace} onClose={() => setShowTraceModal(false)} />}
      {showTaskModal && <HaccpTaskModal sede={sede} onSave={saveTask} onClose={() => setShowTaskModal(false)} />}
    </div>
  );
}

function GoodsReceiptModal({ sede, suppliers, ingredients, goodsReceipts = [], onSave, onClose }) {
  const [form, setForm] = useState({
    date: today(),
    sede,
    supplierId: suppliers[0]?.id || "",
    ingredientId: ingredients[0]?.id || "",
    lotCode: "",
    supplierLotCode: "",
    qtyKg: "",
    totalCost: "",
    expiryDate: "",
    tempOnArrival_c: "",
    operator: "",
    note: "",
    accepted: true,
    packagingOk: true,
    labelOk: true,
    docsOk: true,
    rejectionReason: "",
  });
  const [err, setErr] = useState("");

  function handleSave() {
    const ingredient = ingredients.find(i => String(i.id) === String(form.ingredientId));
    const qtyKg = Number(form.qtyKg || 0);
    const totalCost = Number(form.totalCost || 0);
    const lotCode = String(form.lotCode || "").trim();
    if (!ingredient) { setErr("Seleziona un ingrediente."); return; }
    if (qtyKg <= 0) { setErr("Inserisci la quantità ricevuta in kg."); return; }
    if (!lotCode) { setErr("Inserisci il lotto ricevuto."); return; }
    if (form.expiryDate && form.date && String(form.expiryDate) < String(form.date)) { setErr("La scadenza non può essere precedente alla data di ricevimento."); return; }
    const duplicateLot = goodsReceipts.some(r =>
      r.sede === sede &&
      String(r.ingredientId) === String(ingredient.id) &&
      String(r.lotCode || "").trim().toLowerCase() === lotCode.toLowerCase() &&
      String(r.date || "") === String(form.date || "")
    );
    if (duplicateLot) { setErr("Esiste già un ricevimento con questo lotto per lo stesso ingrediente e data."); return; }

    onSave({
      date: form.date,
      sede,
      supplierId: form.supplierId || null,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      lotCode,
      supplierLotCode: form.supplierLotCode.trim(),
      qtyReceived_g: Math.round(qtyKg * 1000),
      packageQty: qtyKg,
      packageUnit: "kg",
      unitPurchasePrice: qtyKg > 0 ? totalCost / qtyKg : 0,
      totalCost,
      expiryDate: form.expiryDate || null,
      tempOnArrival_c: form.tempOnArrival_c === "" ? null : Number(form.tempOnArrival_c),
      packagingOk: form.packagingOk,
      labelOk: form.labelOk,
      docsOk: form.docsOk,
      accepted: form.accepted,
      rejectionReason: form.rejectionReason,
      operator: form.operator,
      note: form.note,
    });
  }

  return (
    <Modal title="📦 Accettazione merce" onClose={onClose} maxWidth={620}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Data</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Operatore</label><input value={form.operator} onChange={e => setForm(f => ({ ...f, operator:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Fornitore</label><select value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId:e.target.value }))} style={inp}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label style={lbl}>Ingrediente</label><select value={form.ingredientId} onChange={e => { setForm(f => ({ ...f, ingredientId:e.target.value })); setErr(""); }} style={inp}>{ingredients.filter(i => i.active !== false).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
          <div><label style={lbl}>Lotto ricevuto *</label><input value={form.lotCode} onChange={e => { setForm(f => ({ ...f, lotCode:e.target.value })); setErr(""); }} style={inp} placeholder="es. LAT-080426-A" /></div>
          <div><label style={lbl}>Lotto fornitore / DDT</label><input value={form.supplierLotCode} onChange={e => setForm(f => ({ ...f, supplierLotCode:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Quantità ricevuta (kg)</label><input type="number" min="0" step="0.1" value={form.qtyKg} onChange={e => { setForm(f => ({ ...f, qtyKg:e.target.value })); setErr(""); }} style={inp} /></div>
          <div><label style={lbl}>Costo totale (€)</label><input type="number" min="0" step="0.01" value={form.totalCost} onChange={e => setForm(f => ({ ...f, totalCost:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Scadenza</label><input type="date" value={form.expiryDate} onChange={e => { setForm(f => ({ ...f, expiryDate:e.target.value })); setErr(""); }} style={inp} /></div>
          <div><label style={lbl}>Temperatura arrivo (°C)</label><input type="number" step="0.1" value={form.tempOnArrival_c} onChange={e => setForm(f => ({ ...f, tempOnArrival_c:e.target.value }))} style={inp} /></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
          <label style={{ ...card, marginBottom:0, display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}><input type="checkbox" checked={form.accepted} onChange={e => setForm(f => ({ ...f, accepted:e.target.checked }))} />Accettata</label>
          <label style={{ ...card, marginBottom:0, display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}><input type="checkbox" checked={form.packagingOk} onChange={e => setForm(f => ({ ...f, packagingOk:e.target.checked }))} />Imballo OK</label>
          <label style={{ ...card, marginBottom:0, display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}><input type="checkbox" checked={form.labelOk} onChange={e => setForm(f => ({ ...f, labelOk:e.target.checked }))} />Etichetta OK</label>
          <label style={{ ...card, marginBottom:0, display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}><input type="checkbox" checked={form.docsOk} onChange={e => setForm(f => ({ ...f, docsOk:e.target.checked }))} />Documenti OK</label>
        </div>
        {!form.accepted && <div><label style={lbl}>Motivo respinta</label><textarea value={form.rejectionReason} onChange={e => setForm(f => ({ ...f, rejectionReason:e.target.value }))} style={{ ...inp, minHeight:70, resize:"vertical" }} /></div>}
        <div><label style={lbl}>Note</label><textarea value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} style={{ ...inp, minHeight:80, resize:"vertical" }} /></div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva ricevimento</button>
        </div>
      </div>
    </Modal>
  );
}

function HaccpTempModal({ sede, areas = DEFAULT_HACCP_AREAS, onSave, onClose }) {
  const [form, setForm] = useState({
    date: today(),
    sede,
    area: areas[0]?.name || "",
    temp_c: "",
    minAllowed_c: areas[0]?.minAllowed_c ?? "",
    maxAllowed_c: areas[0]?.maxAllowed_c ?? "",
    operator: "",
    correctiveAction: "",
    note: "",
  });
  const [manualArea, setManualArea] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState(areas[0]?.id || "__other__");
  const [err, setErr] = useState("");

  function handleAreaChange(value) {
    setSelectedAreaId(value);
    if (value === "__other__") {
      setForm(f => ({ ...f, area: manualArea, minAllowed_c:"", maxAllowed_c:"" }));
      return;
    }
    const areaCfg = areas.find(a => a.id === value);
    setForm(f => ({
      ...f,
      area: areaCfg?.name || "",
      minAllowed_c: areaCfg?.minAllowed_c ?? "",
      maxAllowed_c: areaCfg?.maxAllowed_c ?? "",
    }));
    setErr("");
  }

  function handleSave() {
    const resolvedArea = selectedAreaId === "__other__" ? manualArea.trim() : form.area.trim();
    if (!resolvedArea) { setErr("Inserisci l'area controllata."); return; }
    if (form.temp_c === "") { setErr("Inserisci la temperatura."); return; }
    const temp = Number(form.temp_c);
    const minA = form.minAllowed_c === "" ? null : Number(form.minAllowed_c);
    const maxA = form.maxAllowed_c === "" ? null : Number(form.maxAllowed_c);
    let esito = "ok";
    if ((minA !== null && temp < minA) || (maxA !== null && temp > maxA)) esito = "nc";
    onSave({
      ...form,
      area: resolvedArea,
      temp_c: temp,
      minAllowed_c: minA,
      maxAllowed_c: maxA,
      esito,
    });
  }

  return (
    <Modal title="🌡️ Registro temperature" onClose={onClose} maxWidth={560}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Data</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Operatore</label><input value={form.operator} onChange={e => setForm(f => ({ ...f, operator:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Area / attrezzatura</label><select value={selectedAreaId} onChange={e => handleAreaChange(e.target.value)} style={inp}>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="__other__">Altra area…</option></select></div>
          <div><label style={lbl}>Temperatura (°C)</label><input type="number" value={form.temp_c} onChange={e => setForm(f => ({ ...f, temp_c:e.target.value }))} style={inp} /></div>
          {selectedAreaId === "__other__" && <div style={{ gridColumn:"1 / span 2" }}><label style={lbl}>Nome area personalizzata</label><input value={manualArea} onChange={e => { const v = e.target.value; setManualArea(v); setForm(f => ({ ...f, area:v })); setErr(""); }} style={inp} placeholder="es. Mantecatore" /></div>}
          <div><label style={lbl}>Min ammesso</label><input type="number" value={form.minAllowed_c} onChange={e => setForm(f => ({ ...f, minAllowed_c:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Max ammesso</label><input type="number" value={form.maxAllowed_c} onChange={e => setForm(f => ({ ...f, maxAllowed_c:e.target.value }))} style={inp} /></div>
        </div>
        <div><label style={lbl}>Azione correttiva</label><input value={form.correctiveAction} onChange={e => setForm(f => ({ ...f, correctiveAction:e.target.value }))} style={inp} /></div>
        <div><label style={lbl}>Note</label><textarea value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} style={{ ...inp, minHeight:70, resize:"vertical" }} /></div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
          Le aree predefinite compilano automaticamente i limiti HACCP. Puoi comunque modificarli prima del salvataggio.
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva temperatura</button>
        </div>
      </div>
    </Modal>
  );
}

function SanificationModal({ sede, onSave, onClose }) {
  const [form, setForm] = useState({
    date: today(),
    sede,
    area: "",
    tipo: "ordinaria",
    prodottoUsato: "",
    lottoProdotto: "",
    operatore: "",
    esito: "ok",
    note: "",
  });
  const [err, setErr] = useState("");

  function handleSave() {
    if (!form.area.trim()) { setErr("Inserisci l'area sanificata."); return; }
    if (!form.operatore.trim()) { setErr("Inserisci l'operatore."); return; }
    onSave(form);
  }

  return (
    <Modal title="🧼 Registro sanificazione" onClose={onClose} maxWidth={520}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Data</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Operatore</label><input value={form.operatore} onChange={e => { setForm(f => ({ ...f, operatore:e.target.value })); setErr(""); }} style={inp} /></div>
          <div><label style={lbl}>Area</label><input value={form.area} onChange={e => { setForm(f => ({ ...f, area:e.target.value })); setErr(""); }} style={inp} /></div>
          <div><label style={lbl}>Tipo</label><select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo:e.target.value }))} style={inp}><option value="ordinaria">Ordinaria</option><option value="straordinaria">Straordinaria</option></select></div>
          <div><label style={lbl}>Prodotto usato</label><input value={form.prodottoUsato} onChange={e => setForm(f => ({ ...f, prodottoUsato:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Lotto prodotto</label><input value={form.lottoProdotto} onChange={e => setForm(f => ({ ...f, lottoProdotto:e.target.value }))} style={inp} /></div>
        </div>
        <div><label style={lbl}>Note</label><textarea value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} style={{ ...inp, minHeight:70, resize:"vertical" }} /></div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva sanificazione</button>
        </div>
      </div>
    </Modal>
  );
}

function NonConformityModal({ sede, onSave, onClose }) {
  const [form, setForm] = useState({
    date: today(),
    sede,
    categoria: "merce",
    gravita: "media",
    descrizione: "",
    correctiveAction: "",
    responsible: "",
    chiusa: false,
  });
  const [err, setErr] = useState("");

  function handleSave() {
    if (!form.descrizione.trim()) { setErr("Descrivi la non conformità."); return; }
    onSave(form);
  }

  return (
    <Modal title="⚠️ Nuova non conformità" onClose={onClose} maxWidth={520}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Data</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Responsabile</label><input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Categoria</label><select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria:e.target.value }))} style={inp}><option value="merce">Merce</option><option value="temperatura">Temperatura</option><option value="sanificazione">Sanificazione</option><option value="etichetta">Etichetta</option><option value="lotto">Lotto</option></select></div>
          <div><label style={lbl}>Gravità</label><select value={form.gravita} onChange={e => setForm(f => ({ ...f, gravita:e.target.value }))} style={inp}><option value="bassa">Bassa</option><option value="media">Media</option><option value="alta">Alta</option></select></div>
        </div>
        <div><label style={lbl}>Descrizione</label><textarea value={form.descrizione} onChange={e => { setForm(f => ({ ...f, descrizione:e.target.value })); setErr(""); }} style={{ ...inp, minHeight:90, resize:"vertical" }} /></div>
        <div><label style={lbl}>Azione correttiva</label><textarea value={form.correctiveAction} onChange={e => setForm(f => ({ ...f, correctiveAction:e.target.value }))} style={{ ...inp, minHeight:80, resize:"vertical" }} /></div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva NC</button>
        </div>
      </div>
    </Modal>
  );
}


function TraceabilityModal({ sede, recipes, goodsReceipts, onSave, onClose }) {
  const initialRecipeId = recipes[0]?.id ?? "";
  const [form, setForm] = useState({
    date: today(),
    sede,
    recipeId: initialRecipeId,
    productionLot: "",
    outputQtyKg: "",
    note: "",
  });
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  const currentRecipe = recipes.find(r => String(r.id) === String(form.recipeId));
  const recipeIngredientIds = new Set((currentRecipe?.ingredients || []).map(ri => String(ri.id)));
  const recipeReceipts = goodsReceipts
    .filter(r => r.accepted !== false && r.sede === sede && (!currentRecipe || recipeIngredientIds.has(String(r.ingredientId))))
    .sort((a, b) => String(a.expiryDate || "9999-12-31").localeCompare(String(b.expiryDate || "9999-12-31")) || String(a.date || "9999-12-31").localeCompare(String(b.date || "9999-12-31")));

  useEffect(() => {
    if (!currentRecipe) {
      setRows([]);
      return;
    }
    setRows(prev => {
      if (prev.length > 0 && prev.some(r => r.recipeId === currentRecipe.id)) return prev;
      return (currentRecipe.ingredients || []).slice(0, 3).map(ri => {
        const receipt = recipeReceipts.find(r => String(r.ingredientId) === String(ri.id));
        return {
          rowId: makeK2Id("trace-line"),
          recipeId: currentRecipe.id,
          ingredientId: ri.id,
          goodsReceiptId: receipt?.id || "manual",
          qtyUsed_g: "",
        };
      });
    });
  }, [form.recipeId]);

  function addRow() {
    setRows(prev => ([...prev, { rowId: makeK2Id("trace-line"), recipeId: currentRecipe?.id ?? null, ingredientId: currentRecipe?.ingredients?.[0]?.id ?? "", goodsReceiptId: "manual", qtyUsed_g: "" }]));
  }

  function updateRow(rowId, patch) {
    setRows(prev => prev.map(row => row.rowId === rowId ? { ...row, ...patch } : row));
    setErr("");
  }

  function removeRow(rowId) {
    setRows(prev => prev.filter(row => row.rowId !== rowId));
  }

  function handleSave() {
    const recipe = recipes.find(r => String(r.id) === String(form.recipeId));
    if (!recipe) { setErr("Seleziona una ricetta."); return; }
    if (!form.productionLot.trim()) { setErr("Inserisci il lotto di produzione."); return; }
    if (rows.length === 0) { setErr("Aggiungi almeno una riga lotto ingrediente."); return; }

    const ingredientLots = [];
    for (const row of rows) {
      const ingredient = (recipe.ingredients||[]).find(ri => String(ri.id) === String(row.ingredientId));
      if (!ingredient) { setErr("Ogni riga deve avere un ingrediente valido della ricetta selezionata."); return; }
      const qtyUsed_g = Math.round(Number(row.qtyUsed_g || 0));
      if (!(qtyUsed_g > 0)) { setErr("Ogni riga deve avere grammi utilizzati maggiori di zero."); return; }
      const receipt = recipeReceipts.find(r => String(r.id) === String(row.goodsReceiptId));
      ingredientLots.push({
        ingredientId: ingredient.id,
        ingredientName: goodsReceipts.find(g => String(g.ingredientId) === String(ingredient.id))?.ingredientName || `Ingrediente ${ingredient.id}`,
        goodsReceiptId: receipt?.id ?? null,
        lotCode: receipt?.lotCode || "DA-VERIFICARE",
        qtyUsed_g,
        sourceType: receipt ? "manual_receipt_select" : "manual_check",
        sourceDetail: receipt ? `Selezionato manualmente da ricevimento ${receipt.date || "—"}` : "Lotto non selezionato: verificare manualmente.",
      });
    }

    onSave({
      date: form.date,
      sede,
      productionLot: form.productionLot.trim(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      ingredientLots,
      outputQty_g: Math.round(Number(form.outputQtyKg || 0) * 1000),
      note: form.note.trim(),
    });
  }

  return (
    <Modal title="🧾 Nuova tracciabilità lotto" onClose={onClose} maxWidth={760}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Data</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Ricetta</label><select value={form.recipeId} onChange={e => { setForm(f => ({ ...f, recipeId:e.target.value })); setRows([]); }} style={inp}><option value="">—</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div><label style={lbl}>Lotto produzione</label><input value={form.productionLot} onChange={e => { setForm(f => ({ ...f, productionLot:e.target.value })); setErr(""); }} style={inp} placeholder="es. PROD-080426-A" /></div>
          <div><label style={lbl}>Resa prodotta (kg)</label><input type="number" value={form.outputQtyKg} onChange={e => setForm(f => ({ ...f, outputQtyKg:e.target.value }))} style={inp} /></div>
        </div>

        <div style={{ ...card, marginBottom:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontSize:11, color:"#c8a96e" }}>Lotti ingrediente guidati</div>
            <button type="button" onClick={addRow} style={{ ...btnS, fontSize:10 }}>+ Riga lotto</button>
          </div>
          {rows.length === 0 ? (
            <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>Seleziona una ricetta per proporre le prime righe lotto.</div>
          ) : rows.map((row, idx) => {
            const ingredientOptions = (currentRecipe?.ingredients || []).map(ri => ({ ri, receiptName: goodsReceipts.find(g => String(g.ingredientId) === String(ri.id))?.ingredientName || `Ingrediente ${ri.id}` }));
            const rowReceipts = recipeReceipts.filter(r => String(r.ingredientId) === String(row.ingredientId));
            return (
              <div key={row.rowId} style={{ display:"grid", gridTemplateColumns:"1.2fr 1.4fr 0.8fr auto", gap:8, alignItems:"end", padding:"8px 0", borderBottom:"1px solid var(--k2-border)" }}>
                <div>
                  <label style={lbl}>Ingrediente</label>
                  <select value={row.ingredientId} onChange={e => updateRow(row.rowId, { ingredientId:e.target.value, goodsReceiptId:"manual" })} style={inp}>
                    <option value="">—</option>
                    {ingredientOptions.map(opt => <option key={opt.ri.id} value={opt.ri.id}>{opt.receiptName}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Lotto sorgente</label>
                  <select value={row.goodsReceiptId} onChange={e => updateRow(row.rowId, { goodsReceiptId:e.target.value })} style={inp}>
                    <option value="manual">Da verificare manualmente</option>
                    {rowReceipts.map(r => <option key={r.id} value={r.id}>{r.lotCode || "—"} · {formatDateIT(r.date)}{r.expiryDate ? ` · scad. ${formatDateIT(r.expiryDate)}` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Grammi</label>
                  <input type="number" min="1" value={row.qtyUsed_g} onChange={e => updateRow(row.rowId, { qtyUsed_g:e.target.value })} style={inp} />
                </div>
                <button type="button" onClick={() => removeRow(row.rowId)} style={{ ...btnD, padding:"6px 10px" }}>✕</button>
              </div>
            );
          })}
        </div>

        <div>
          <label style={lbl}>Note</label>
          <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} style={{ ...inp, minHeight:80, resize:"vertical" }} />
        </div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>
          Se un lotto non è disponibile nell'elenco, seleziona “Da verificare manualmente”. La riga resterà tracciata come controllo manuale.
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP} disabled={!recipes.length}>Salva tracciabilità</button>
        </div>
      </div>
    </Modal>
  );
}

function HaccpTaskModal({ sede, onSave, onClose }) {
  const [form, setForm] = useState({
    title: "",
    category: "documenti",
    sede,
    dueDate: today(),
    status: "open",
    owner: "",
    note: "",
  });
  const [err, setErr] = useState("");

  function handleSave() {
    if (!form.title.trim()) { setErr("Inserisci il titolo del task."); return; }
    onSave(form);
  }

  return (
    <Modal title="⏰ Nuovo task HACCP" onClose={onClose} maxWidth={540}>
      <div style={{ display:"grid", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={lbl}>Titolo</label><input value={form.title} onChange={e => { setForm(f => ({ ...f, title:e.target.value })); setErr(""); }} style={inp} /></div>
          <div><label style={lbl}>Categoria</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={inp}><option value="documenti">Documenti</option><option value="audit">Audit</option><option value="fornitori">Fornitori</option><option value="riordino">Riordino</option><option value="manutenzione">Manutenzione</option><option value="sanificazione">Sanificazione</option></select></div>
          <div><label style={lbl}>Scadenza</label><input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate:e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Responsabile</label><input value={form.owner} onChange={e => setForm(f => ({ ...f, owner:e.target.value }))} style={inp} /></div>
        </div>
        <div><label style={lbl}>Note</label><textarea value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} style={{ ...inp, minHeight:90, resize:"vertical" }} /></div>
        {err && <div style={{ fontSize:11, color:"#f87171" }}>⚠ {err}</div>}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={btnS}>Annulla</button>
          <button onClick={handleSave} style={btnP}>Salva task</button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULO CHECKLIST — Apertura/Chiusura Giornaliera e Stagionale
// ═══════════════════════════════════════════════════════════════════════════════

const CHECKLIST_ITEMS = {
  giornaliera_apertura: [
    { id: "ga_01", label: "Verifica temperature frigoriferi (registrare valori)" },
    { id: "ga_02", label: "Controllo visivo gelati in vetrina (aspetto, cristallizzazione)" },
    { id: "ga_03", label: "Verifica livelli vasetti e contenitori in esposizione" },
    { id: "ga_04", label: "Controllo acqua osmotizzata (filtri, pressione)" },
    { id: "ga_05", label: "Sanificazione banchi e superfici di lavoro" },
    { id: "ga_06", label: "Verifica pulizia spatole, coppette, cucchiaini" },
    { id: "ga_07", label: "Controllo data e integrità materie prime in uso" },
    { id: "ga_08", label: "Impostazione cassa e verifica fondo cassa" },
    { id: "ga_09", label: "Verifica scorte coni, coppette, tovaglioli" },
    { id: "ga_10", label: "Accensione e verifica funzionamento mantecatori" },
    { id: "ga_11", label: "Controllo etichette allergeni in vetrina (aggiornate)" },
    { id: "ga_12", label: "Verifica presenza registro HACCP e penna" },
  ],
  giornaliera_chiusura: [
    { id: "gc_01", label: "Copertura e protezione gelati in vetrina" },
    { id: "gc_02", label: "Registrazione temperature frigoriferi a chiusura" },
    { id: "gc_03", label: "Sanificazione completa banchi, vetrine, superfici" },
    { id: "gc_04", label: "Lavaggio e sanificazione spatole, strumenti" },
    { id: "gc_05", label: "Svuotamento e pulizia pozzetti se necessario" },
    { id: "gc_06", label: "Smaltimento corretto rifiuti (organico, plastica, vetro)" },
    { id: "gc_07", label: "Chiusura registratore di cassa e stampa Z" },
    { id: "gc_08", label: "Controllo e conteggio incasso del giorno" },
    { id: "gc_09", label: "Verifica chiusura frigoriferi e abbattitore" },
    { id: "gc_10", label: "Spegnimento mantecatori e pastorizzatori" },
    { id: "gc_11", label: "Verifica chiusura porte, finestre, allarme" },
    { id: "gc_12", label: "Registrazione eventuali anomalie sul registro HACCP" },
  ],
  stagionale_apertura: [
    { id: "sa_01", label: "Verifica e rinnovo licenze e permessi (SCIA, NCC, ecc.)" },
    { id: "sa_02", label: "Controllo certificato prevenzione incendi (aggiornato)" },
    { id: "sa_03", label: "Verifica scadenze libretti sanitari personale" },
    { id: "sa_04", label: "Sanificazione straordinaria laboratorio e vetrine" },
    { id: "sa_05", label: "Manutenzione e revisione mantecatori / pastorizzatori" },
    { id: "sa_06", label: "Controllo e sostituzione filtri acqua osmotizzata" },
    { id: "sa_07", label: "Verifica scorte materie prime — inventario completo" },
    { id: "sa_08", label: "Aggiornamento schede tecniche e allergeni" },
    { id: "sa_09", label: "Verifica POS e registratori di cassa (RT aggiornati)" },
    { id: "sa_10", label: "Formazione/briefing personale su procedure HACCP" },
    { id: "sa_11", label: "Verifica contratti fornitori e listini aggiornati" },
    { id: "sa_12", label: "Controllo assicurazioni attività (scadenze)" },
    { id: "sa_13", label: "Verifica piano di autocontrollo HACCP (revisione annuale)" },
    { id: "sa_14", label: "Riattivazione utenze (gas, corrente, acqua) se stagionale" },
    { id: "sa_15", label: "Test funzionamento sistema allarme e videosorveglianza" },
    { id: "sa_16", label: "Riassortimento materiale da imballaggio e packaging" },
  ],
  stagionale_chiusura: [
    { id: "sc_01", label: "Smaltimento o conservazione materie prime rimanenti" },
    { id: "sc_02", label: "Pulizia straordinaria e sanificazione profonda laboratorio" },
    { id: "sc_03", label: "Svuotamento, pulizia e protezione mantecatori" },
    { id: "sc_04", label: "Svuotamento e pulizia completa frigoriferi e celle" },
    { id: "sc_05", label: "Verifica e archiviazione registri HACCP stagione chiusa" },
    { id: "sc_06", label: "Chiusura registratori di cassa — stampa report stagione" },
    { id: "sc_07", label: "Backup dati gestionali (K2 Suite — export CSV)" },
    { id: "sc_08", label: "Comunicazione chiusura su canali social e Google Maps" },
    { id: "sc_09", label: "Verifica e archiviazione documentazione fiscale" },
    { id: "sc_10", label: "Pianificazione manutenzioni invernali attrezzature" },
    { id: "sc_11", label: "Chiusura utenze non necessarie (riduzione consumi)" },
    { id: "sc_12", label: "Inventario finale magazzino — valorizzazione rimanenze" },
    { id: "sc_13", label: "Colloquio fine stagione con dipendenti (valutazione)" },
    { id: "sc_14", label: "Programmazione apertura stagione successiva" },
  ],
};

const CHECKLIST_TYPE_LABELS = {
  giornaliera_apertura: { label: "Apertura Giornaliera", icon: "🌅", color: "#10b981" },
  giornaliera_chiusura: { label: "Chiusura Giornaliera", icon: "🌙", color: "#6366f1" },
  stagionale_apertura:  { label: "Apertura Stagione",    icon: "🌸", color: "#f59e0b" },
  stagionale_chiusura:  { label: "Chiusura Stagione",    icon: "❄️", color: "#64748b" },
};

function makeChecklistLog(raw = {}) {
  return {
    id:        raw.id        ?? makeK2Id("ck"),
    type:      raw.type      ?? "giornaliera_apertura",
    sede:      SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    date:      raw.date      ?? today(),
    operator:  raw.operator  ?? "",
    note:      raw.note      ?? "",
    items:     Array.isArray(raw.items) ? raw.items : [],
    completedAt: raw.completedAt ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

// Normalizzatore difensivo per dati caricati da localStorage
// Gestisce null, undefined, tipi errati, campi mancanti
function normalizeChecklistLog(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  const VALID_TYPES = Object.keys(CHECKLIST_ITEMS);
  return {
    id:          typeof raw.id === "string" && raw.id ? raw.id : makeK2Id("ck"),
    type:        VALID_TYPES.includes(raw.type) ? raw.type : "giornaliera_apertura",
    sede:        SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    date:        typeof raw.date === "string" && raw.date ? raw.date : today(),
    operator:    typeof raw.operator === "string" ? raw.operator : "",
    note:        typeof raw.note === "string" ? raw.note : "",
    items:       Array.isArray(raw.items)
                   ? raw.items.map(it => ({
                       id:      typeof it?.id === "string" ? it.id : "",
                       checked: it?.checked === true,
                     }))
                   : [],
    completedAt: raw.completedAt ?? null,
    createdAt:   typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

function ChecklistSummaryBadge({ log, itemsMap = CHECKLIST_ITEMS }) {
  const total = itemsMap[log.type]?.length ?? 0;
  const done  = log.items.filter(i => i.checked).length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  const col   = pct === 100 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: col + "22", color: col, borderRadius: 999,
      fontSize: 11, fontWeight: 700, padding: "2px 8px",
    }}>
      {pct === 100 ? "✓ Completa" : `${done}/${total}`}
    </span>
  );
}

function ChecklistRunModal({ sede, type, onSave, onClose, itemsMap = CHECKLIST_ITEMS }) {
  const items = itemsMap[type] ?? [];
  const meta  = CHECKLIST_TYPE_LABELS[type];
  const [checks, setChecks]     = useState(() => items.map(i => ({ id: i.id, checked: false })));
  const [operator, setOperator] = useState("");
  const [note, setNote]         = useState("");

  const done  = checks.filter(c => c.checked).length;
  const total = items.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  function toggle(id) {
    setChecks(prev => prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c));
  }
  function checkAll() { setChecks(prev => prev.map(c => ({ ...c, checked: true }))); }

  function handleSave() {
    onSave(makeChecklistLog({
      type, sede,
      date: today(),
      operator: operator.trim(),
      note: note.trim(),
      items: checks,
      completedAt: pct === 100 ? new Date().toISOString() : null,
    }));
  }

  const inp  = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--k2-border)", background: "var(--k2-input-bg)", color: "var(--k2-text)", fontSize: 13, boxSizing: "border-box" };
  const lbl  = { display: "block", fontSize: 11, color: "var(--k2-text-dim)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };

  return (
    <Modal title={`${meta.icon} ${meta.label} — ${sede}`} onClose={onClose} maxWidth={620}>
      <div style={{ display: "grid", gap: 14 }}>
        {/* Barra progresso */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--k2-text-dim)", marginBottom: 5 }}>
            <span>Avanzamento</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? "#10b981" : "var(--k2-text)" }}>{done}/{total} — {pct}%</span>
          </div>
          <div style={{ height: 8, background: "var(--k2-border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#10b981" : meta.color, borderRadius: 4, transition: "width 0.3s" }} />
          </div>
        </div>

        {/* Lista voci */}
        <div style={{ maxHeight: 360, overflowY: "auto", display: "grid", gap: 6 }}>
          {items.map((item, idx) => {
            const checked = checks.find(c => c.id === item.id)?.checked ?? false;
            return (
              <div key={item.id} onClick={() => toggle(item.id)} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px",
                borderRadius: 8, cursor: "pointer",
                background: checked ? (meta.color + "18") : "var(--k2-card)",
                border: `1px solid ${checked ? meta.color + "55" : "var(--k2-border)"}`,
                transition: "all 0.15s",
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5, border: `2px solid ${checked ? meta.color : "var(--k2-border)"}`,
                  background: checked ? meta.color : "transparent", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1,
                }}>
                  {checked && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13, color: checked ? "var(--k2-text-dim)" : "var(--k2-text)", textDecoration: checked ? "line-through" : "none", lineHeight: 1.4 }}>
                  <span style={{ color: "var(--k2-text-dim)", fontSize: 11, marginRight: 5 }}>{String(idx + 1).padStart(2, "0")}.</span>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Seleziona tutto */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={checkAll} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--k2-border)", background: "var(--k2-card)", color: "var(--k2-text)", cursor: "pointer" }}>
            ✓ Seleziona tutto
          </button>
          <button onClick={() => setChecks(prev => prev.map(c => ({ ...c, checked: false })))} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--k2-border)", background: "var(--k2-card)", color: "var(--k2-text-dim)", cursor: "pointer" }}>
            ✕ Deseleziona tutto
          </button>
        </div>

        {/* Operatore + note */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={lbl}>Operatore</label>
            <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Nome o iniziali" style={inp} />
          </div>
          <div>
            <label style={lbl}>Note (facoltative)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Eventuali osservazioni…" style={inp} />
          </div>
        </div>

        {pct < 100 && (
          <div style={{ fontSize: 12, color: "#f59e0b", padding: "8px 12px", background: "#f59e0b18", borderRadius: 8, border: "1px solid #f59e0b44" }}>
            ⚠ Checklist incompleta: {total - done} voci mancanti. Puoi salvare ugualmente.
          </div>
        )}
        {pct === 100 && (
          <div style={{ fontSize: 12, color: "#10b981", padding: "8px 12px", background: "#10b98118", borderRadius: 8, border: "1px solid #10b98144" }}>
            ✓ Tutte le voci completate.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => {
            const hasSel = checks.some(c => c.checked);
            if (hasSel && !window.confirm("Hai selezionato alcune voci. Chiudere senza salvare?")) return;
            onClose();
          }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--k2-border)", background: "transparent", color: "var(--k2-text-dim)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
          <button onClick={handleSave} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: meta.color, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
            Salva registro
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ChecklistDetailModal({ log, onClose, itemsMap = CHECKLIST_ITEMS }) {
  const items = itemsMap[log.type] ?? [];
  const meta  = CHECKLIST_TYPE_LABELS[log.type];
  const done  = log.items.filter(i => i.checked).length;
  const total = items.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Modal title={`${meta.icon} Dettaglio — ${meta.label}`} onClose={onClose} maxWidth={600}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: "var(--k2-text-dim)" }}>
          <span>📅 {log.date}</span>
          <span>📍 {log.sede}</span>
          {log.operator && <span>👤 {log.operator}</span>}
          <span style={{ fontWeight: 700, color: pct === 100 ? "#10b981" : "#f59e0b" }}>{done}/{total} ({pct}%)</span>
        </div>
        {log.note && <div style={{ fontSize: 13, color: "var(--k2-text-dim)", fontStyle: "italic" }}>📝 {log.note}</div>}
        <div style={{ maxHeight: 400, overflowY: "auto", display: "grid", gap: 5 }}>
          {items.map((item, idx) => {
            const checked = log.items.find(c => c.id === item.id)?.checked ?? false;
            return (
              <div key={item.id} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px",
                borderRadius: 7, background: checked ? (meta.color + "12") : "var(--k2-card)",
                border: `1px solid ${checked ? meta.color + "44" : "var(--k2-border)"}`,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{checked ? "✅" : "⬜"}</span>
                <span style={{ fontSize: 13, color: checked ? "var(--k2-text-dim)" : "var(--k2-text)", textDecoration: checked ? "line-through" : "none" }}>
                  <span style={{ color: "var(--k2-text-dim)", fontSize: 11, marginRight: 5 }}>{String(idx + 1).padStart(2, "0")}.</span>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--k2-border)", background: "transparent", color: "var(--k2-text-dim)", cursor: "pointer", fontSize: 13 }}>Chiudi</button>
        </div>
      </div>
    </Modal>
  );
}

function mergeChecklistItemsMap(customItemsByType = {}) {
  const merged = { ...CHECKLIST_ITEMS };
  Object.keys(customItemsByType || {}).forEach(type => {
    const base = CHECKLIST_ITEMS[type] || [];
    const extra = Array.isArray(customItemsByType[type]) ? customItemsByType[type] : [];
    merged[type] = [...base, ...extra.filter(x => x && x.id && x.label)];
  });
  return merged;
}

function Checklist({ sede, checklistLogs, setChecklistLogs }) {
  const [mode, setMode]             = useState("giornaliera"); // "giornaliera" | "stagionale"
  const [showRunModal, setShowRunModal] = useState(null);       // tipo stringa o null
  const [showDetail, setShowDetail] = useState(null);          // log o null
  const [filterSede, setFilterSede] = useState("tutte");
  const [customItemsMap, setCustomItemsMap] = useState({});

  React.useEffect(() => {
    let mounted = true;
    load("k2-checklist-custom-items", null).then(raw => {
      if (!mounted) return;
      if (!raw || typeof raw !== "object") { setCustomItemsMap({}); return; }
      const normalized = {};
      Object.entries(raw).forEach(([type, rows]) => {
        normalized[type] = Array.isArray(rows)
          ? rows.map(r => ({ id: typeof r?.id === "string" ? r.id : makeK2Id("ckextra"), label: typeof r?.label === "string" ? r.label.trim() : "" })).filter(r => r.label)
          : [];
      });
      setCustomItemsMap(normalized);
    }).catch(() => setCustomItemsMap({}));
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    save("k2-checklist-custom-items", customItemsMap || {});
  }, [customItemsMap]);

  const itemsMap = React.useMemo(() => mergeChecklistItemsMap(customItemsMap), [customItemsMap]);

  function addCustomCheck(type) {
    const label = window.prompt("Nuovo controllo checklist", "");
    const cleaned = String(label || "").trim();
    if (!cleaned) return;
    setCustomItemsMap(prev => ({
      ...prev,
      [type]: [...(prev[type] || []), { id: makeK2Id("ckextra"), label: cleaned }],
    }));
  }

  function removeCustomCheck(type, itemId) {
    if (!window.confirm("Rimuovere questo controllo personalizzato?")) return;
    setCustomItemsMap(prev => ({
      ...prev,
      [type]: (prev[type] || []).filter(x => x.id !== itemId),
    }));
  }

  function handleSave(log) {
    setChecklistLogs(prev => [log, ...prev].slice(0, 500));
    setShowRunModal(null);
  }

  function handleDelete(id) {
    if (!window.confirm("Eliminare questo registro? L'operazione non può essere annullata.")) return;
    setChecklistLogs(prev => prev.filter(l => l.id !== id));
  }

  const tipiGiornalieri  = ["giornaliera_apertura", "giornaliera_chiusura"];
  const tipiStagionali   = ["stagionale_apertura",  "stagionale_chiusura"];
  const tipiCorrenti     = mode === "giornaliera" ? tipiGiornalieri : tipiStagionali;

  const logsFiltered = checklistLogs
    .filter(l => tipiCorrenti.includes(l.type))
    .filter(l => filterSede === "tutte" || l.sede === filterSede)
    .slice(0, 120);

  // Ultima sessione per tipo + sede
  function lastLog(type) {
    return checklistLogs.find(l => l.type === type && l.sede === sede);
  }

  const sty = {
    card: { background: "var(--k2-card)", border: "1px solid var(--k2-border)", borderRadius: 12, padding: 20 },
    btnP: { padding: "9px 18px", borderRadius: 8, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 },
    btnS: { padding: "7px 14px", borderRadius: 8, border: "1px solid var(--k2-border)", background: "transparent", color: "var(--k2-text-dim)", cursor: "pointer", fontSize: 12 },
  };

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>✅ Checklist Operative</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--k2-text-dim)" }}>Controlli apertura e chiusura — {sede}</p>
        </div>
        {/* Toggle Giornaliera / Stagionale */}
        <div style={{ display: "flex", background: "var(--k2-card)", border: "1px solid var(--k2-border)", borderRadius: 10, overflow: "hidden" }}>
          {["giornaliera", "stagionale"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "8px 20px", border: "none", cursor: "pointer", fontWeight: mode === m ? 700 : 400,
              background: mode === m ? "var(--k2-accent)" : "transparent",
              color: mode === m ? "#fff" : "var(--k2-text-dim)", fontSize: 13, transition: "all 0.15s",
            }}>
              {m === "giornaliera" ? "🌅 Giornaliera" : "🌸 Stagionale"}
            </button>
          ))}
        </div>
      </div>

      {/* Schede di avvio rapido */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        {tipiCorrenti.map(tipo => {
          const meta = CHECKLIST_TYPE_LABELS[tipo];
          const last = lastLog(tipo);
          const items = itemsMap[tipo];
          return (
            <div key={tipo} style={{ ...RICETTARIO_STY.card, borderLeft: `4px solid ${meta.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{meta.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{meta.label}</div>
                  <div style={{ fontSize: 12, color: "var(--k2-text-dim)" }}>{items.length} voci di controllo</div>
                </div>
                {last && <ChecklistSummaryBadge log={last} itemsMap={itemsMap} />}
              </div>
              {last && (
                <div style={{ fontSize: 12, color: "var(--k2-text-dim)", marginBottom: 12 }}>
                  Ultima sessione: <strong>{last.date}</strong>{last.operator ? ` — ${last.operator}` : ""}
                </div>
              )}
              <button onClick={() => setShowRunModal(tipo)} style={{
                ...RICETTARIO_STY.btnP, background: meta.color, color: "#fff", width: "100%",
              }}>
                {meta.icon} Avvia checklist
              </button>
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <div style={{ fontSize: 11, color: "var(--k2-text-dim)" }}>Controlli extra: {(customItemsMap[tipo] || []).length}</div>
                  <button onClick={() => addCustomCheck(tipo)} style={{ ...RICETTARIO_STY.btnS, padding:"5px 10px" }}>➕ Aggiungi controllo</button>
                </div>
                {(customItemsMap[tipo] || []).length > 0 && (
                  <div style={{ display:"grid", gap:4 }}>
                    {(customItemsMap[tipo] || []).map(item => (
                      <div key={item.id} style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", fontSize:11, color:"var(--k2-text-dim)", background:"var(--k2-bg)", border:"1px solid var(--k2-border)", borderRadius:6, padding:"5px 8px" }}>
                        <span>{item.label}</span>
                        <button onClick={() => removeCustomCheck(tipo, item.id)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:12 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Registro storico */}
      <div style={RICETTARIO_STY.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📋 Registro storico</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={filterSede} onChange={e => setFilterSede(e.target.value)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--k2-border)", background: "var(--k2-input-bg)", color: "var(--k2-text)", fontSize: 12 }}>
              <option value="tutte">Tutte le sedi</option>
              {SEDI.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {logsFiltered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--k2-text-dim)", fontSize: 14 }}>
            Nessun registro {mode === "giornaliera" ? "giornaliero" : "stagionale"} ancora salvato.<br />
            <span style={{ fontSize: 12 }}>Avvia una checklist per iniziare.</span>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {logsFiltered.map(log => {
              const meta = CHECKLIST_TYPE_LABELS[log.type];
              const total = itemsMap[log.type]?.length ?? 0;
              const done  = log.items.filter(i => i.checked).length;
              const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div key={log.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  borderRadius: 9, background: "var(--k2-bg)", border: "1px solid var(--k2-border)",
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</div>
                    <div style={{ fontSize: 12, color: "var(--k2-text-dim)" }}>
                      {log.date} · {log.sede}{log.operator ? ` · ${log.operator}` : ""}
                    </div>
                  </div>
                  {/* Mini progress bar */}
                  <div style={{ width: 80, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, textAlign: "right", color: "var(--k2-text-dim)", marginBottom: 3 }}>{done}/{total}</div>
                    <div style={{ height: 5, background: "var(--k2-border)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#10b981" : meta.color, borderRadius: 3 }} />
                    </div>
                  </div>
                  <ChecklistSummaryBadge log={log} itemsMap={itemsMap} />
                  {log.note && <span title={log.note} style={{ fontSize: 14, color: "var(--k2-text-dim)", cursor: "help" }}>📝</span>}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => setShowDetail(log)} style={{ ...RICETTARIO_STY.btnS, padding: "5px 10px" }}>Vedi</button>
                    <button onClick={() => handleDelete(log.id)} style={{ ...RICETTARIO_STY.btnS, padding: "5px 10px", color: "#ef4444" }}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modali */}
      {showRunModal && (
        <ChecklistRunModal
          sede={sede}
          type={showRunModal}
          onSave={handleSave}
          onClose={() => setShowRunModal(null)}
          itemsMap={itemsMap}
        />
      )}
      {showDetail && (
        <ChecklistDetailModal
          log={showDetail}
          onClose={() => setShowDetail(null)}
          itemsMap={itemsMap}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULO TURNI STAFF — Pianificazione settimanale Mattina/Pomeriggio/Giornata
// ═══════════════════════════════════════════════════════════════════════════════

const TURNO_TIPI = [
  { id: "M",  label: "Mattina (½ giornata)", short: "M",  color: "#f59e0b", bg: "#fef3c7", slots: 1 },
  { id: "P",  label: "Pomeriggio (½ giornata)", short: "P",  color: "#6366f1", bg: "#ede9fe", slots: 1 },
  { id: "S",  label: "Sera", short: "S", color: "#ef4444", bg: "#fee2e2", slots: 1 },
  { id: "MP", label: "Mattina + Pomeriggio", short: "MP", color: "#0ea5e9", bg: "#e0f2fe", slots: 2 },
  { id: "PS", label: "Pomeriggio + Sera", short: "PS", color: "#8b5cf6", bg: "#ede9fe", slots: 2 },
  { id: "G",  label: "Giornata intera", short: "G",  color: "#10b981", bg: "#d1fae5", slots: 3 },
  { id: "R",  label: "Riposo", short: "R", color: "#94a3b8", bg: "#f1f5f9", slots: 0 },
  { id: "F",  label: "Ferie", short: "F", color: "#ec4899", bg: "#fce7f3", slots: 0 },
  { id: "-",  label: "—", short: "—", color: "#cbd5e1", bg: "transparent", slots: 0 },
];

const GIORNI_SETTIMANA = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const GIORNI_FULL      = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];

// Ritorna la data ISO del lunedì della settimana che contiene `dateISO`
function getMondayISO(dateISO) {
  const d = parseISODate(dateISO);
  if (!d) return dateISO;
  const day = d.getDay(); // 0=dom,1=lun,...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getWeekDates(mondayISO) {
  const dates = [];
  const base = parseISODate(mondayISO);
  if (!base) return dates;
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function formatWeekLabel(mondayISO) {
  const dates = getWeekDates(mondayISO);
  if (dates.length < 7) return mondayISO;
  const fmt = (iso) => {
    const d = parseISODate(iso);
    return d ? `${d.getDate()} ${["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][d.getMonth()]}` : iso;
  };
  return `${fmt(dates[0])} – ${fmt(dates[6])}`;
}

function shiftWeek(mondayISO, delta) {
  const d = parseISODate(mondayISO);
  if (!d) return mondayISO;
  d.setDate(d.getDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

// Struttura turno settimana: { id, weekStart(lunedì ISO), sede, turni: { staffId: ["M","P","G","R","F","-",...] x7 } }
function makeWeekPlan(raw = {}) {
  return {
    id:        raw.id        ?? makeK2Id("turni"),
    weekStart: raw.weekStart ?? getMondayISO(today()),
    sede:      SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    turni:     typeof raw.turni === "object" && raw.turni !== null ? raw.turni : {},
    note:      raw.note ?? "",
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

// Normalizzatore difensivo per piani settimanali da localStorage
function normalizeWeekPlan(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  // Sanifica i turni: ogni valore deve essere uno degli stati validi
  const VALID_TURNO = TURNO_TIPI.map(t => t.id);
  const rawTurni = typeof raw.turni === "object" && raw.turni !== null ? raw.turni : {};
  const turniSanificati = {};
  for (const [staffId, days] of Object.entries(rawTurni)) {
    if (typeof staffId !== "string") continue;
    turniSanificati[staffId] = Array.isArray(days)
      ? days.slice(0, 7).map(v => VALID_TURNO.includes(v) ? v : "-")
      : Array(7).fill("-");
  }
  return {
    id:        typeof raw.id === "string" && raw.id ? raw.id : makeK2Id("turni"),
    weekStart: typeof raw.weekStart === "string" && raw.weekStart ? raw.weekStart : getMondayISO(today()),
    sede:      SEDI.includes(raw.sede) ? raw.sede : "Sestri Levante",
    turni:     turniSanificati,
    note:      typeof raw.note === "string" ? raw.note : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

// Normalizzatore difensivo per l'anagrafica staff
function normalizeStaffMember(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    id:     typeof raw.id === "string" && raw.id ? raw.id : makeK2Id("staff"),
    nome:   typeof raw.nome === "string" ? raw.nome.trim().slice(0, 60) : "",
    sede:   (SEDI.includes(raw.sede) || raw.sede === "Entrambe") ? raw.sede : "Sestri Levante",
    attiva: raw.attiva !== false,
  };
}

function getTurnoBg(tipoId) {
  return TURNO_TIPI.find(t => t.id === tipoId)?.bg ?? "transparent";
}
function getTurnoColor(tipoId) {
  return TURNO_TIPI.find(t => t.id === tipoId)?.color ?? "#cbd5e1";
}

// ── Gestione staff ────────────────────────────────────────────────────────────
function StaffModal({ initial, onSave, onClose }) {
  const [nome, setNome]   = useState(initial?.nome ?? "");
  const [sede, setSede]   = useState(initial?.sede ?? "Sestri Levante");
  const [err, setErr]     = useState("");

  function handleSave() {
    const nomeTrimmed = nome.trim();
    if (!nomeTrimmed) { setErr("Inserisci il nome"); return; }
    if (nomeTrimmed.length > 60) { setErr("Nome troppo lungo (max 60 caratteri)"); return; }
    onSave({ id: initial?.id ?? makeK2Id("staff"), nome: nomeTrimmed, sede, attiva: initial?.attiva ?? true });
  }

  const inp = { width:"100%", padding:"7px 10px", borderRadius:6, border:"1px solid var(--k2-border)", background:"var(--k2-input-bg)", color:"var(--k2-text)", fontSize:13, boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:11, color:"var(--k2-text-dim)", marginBottom:4, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" };

  return (
    <Modal title={initial ? "✏️ Modifica dipendente" : "➕ Nuovo dipendente"} onClose={onClose} maxWidth={420}>
      <div style={{ display:"grid", gap:12 }}>
        <div><label style={lbl}>Nome</label><input value={nome} onChange={e=>{setNome(e.target.value);setErr("");}} style={inp} placeholder="Nome o cognome" /></div>
        <div>
          <label style={lbl}>Sede principale</label>
          <select value={sede} onChange={e=>setSede(e.target.value)} style={inp}>
            {SEDI.map(s=><option key={s} value={s}>{s}</option>)}
            <option value="Entrambe">Entrambe</option>
          </select>
        </div>
        {err && <div style={{fontSize:11,color:"#f87171"}}>⚠ {err}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
          <button onClick={onClose} style={{padding:"8px 14px",borderRadius:8,border:"1px solid var(--k2-border)",background:"transparent",color:"var(--k2-text-dim)",cursor:"pointer",fontSize:13}}>Annulla</button>
          <button onClick={handleSave} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"var(--k2-accent)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>Salva</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Cella turno (click-to-cycle) ──────────────────────────────────────────────
function TurnoCell({ value, onChange, readOnly }) {
  const tipo = TURNO_TIPI.find(t => t.id === value) ?? TURNO_TIPI[TURNO_TIPI.length - 1];
  const CYCLE = TURNO_TIPI.map(t => t.id);

  function handleClick() {
    if (readOnly) return;
    const idx = CYCLE.indexOf(value);
    onChange(CYCLE[(idx + 1) % CYCLE.length]);
  }

  return (
    <div
      onClick={handleClick}
      title={tipo.label + (readOnly ? "" : " — clicca per cambiare")}
      style={{
        width: 42, height: 36, borderRadius: 7, cursor: readOnly ? "default" : "pointer",
        background: tipo.id === "-" ? "transparent" : tipo.bg,
        border: `1px solid ${tipo.id === "-" ? "var(--k2-border)" : tipo.color + "66"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: tipo.short.length > 1 ? 11 : 13, color: tipo.color,
        transition: "all 0.12s", userSelect: "none", padding: "0 4px",
      }}
    >
      {tipo.short}
    </div>
  );
}

// ── Componente principale Turni ───────────────────────────────────────────────
function Turni({ sede, turniStaff, setTurniStaff, staffList, setStaffList }) {
  const [toastMsg, setToastMsg]           = useState(null); // { type, text }
  const [currentSede, setCurrentSede]     = useState(sede);
  const [weekStart, setWeekStart]         = useState(() => getMondayISO(today()));
  const [showStaffModal, setShowStaffModal] = useState(null); // null | "new" | staff object
  const [tab, setTab]                     = useState("piano"); // "piano" | "staff" | "storico"
  const [noteWeek, setNoteWeek]           = useState("");
  const [editingNote, setEditingNote]     = useState(false);

  const weekDates = getWeekDates(weekStart);

  // Trova o crea il piano per la settimana+sede corrente
  const currentPlan = turniStaff.find(p => p.weekStart === weekStart && p.sede === currentSede);

  function ensurePlan() {
    if (currentPlan) return currentPlan;
    const np = makeWeekPlan({ weekStart, sede: currentSede });
    setTurniStaff(prev => [...prev, np]);
    return np;
  }

  function setTurno(staffId, dayIdx, valore) {
    setTurniStaff(prev => {
      const existing = prev.find(p => p.weekStart === weekStart && p.sede === currentSede);
      if (existing) {
        return prev.map(p => {
          if (p.weekStart !== weekStart || p.sede !== currentSede) return p;
          const turni = { ...p.turni };
          if (!turni[staffId]) turni[staffId] = Array(7).fill("-");
          const row = [...turni[staffId]];
          row[dayIdx] = valore;
          turni[staffId] = row;
          return { ...p, turni };
        });
      } else {
        const np = makeWeekPlan({ weekStart, sede: currentSede });
        if (!np.turni[staffId]) np.turni[staffId] = Array(7).fill("-");
        np.turni[staffId][dayIdx] = valore;
        return [...prev, np];
      }
    });
  }

  function saveNote() {
    setTurniStaff(prev => {
      const existing = prev.find(p => p.weekStart === weekStart && p.sede === currentSede);
      if (existing) {
        return prev.map(p => p.weekStart === weekStart && p.sede === currentSede ? { ...p, note: noteWeek } : p);
      } else {
        return [...prev, makeWeekPlan({ weekStart, sede: currentSede, note: noteWeek })];
      }
    });
    setEditingNote(false);
  }

  // Sincronizzo la nota quando cambia settimana/sede
  React.useEffect(() => {
    setNoteWeek(currentPlan?.note ?? "");
    setEditingNote(false);
  }, [weekStart, currentSede]);

  // Staff attive per la sede corrente
  const staffFiltered = staffList.filter(s =>
    s.attiva !== false && (s.sede === currentSede || s.sede === "Entrambe")
  );

  // Statistiche settimana per persona
  function getStats(staffId) {
    const row = currentPlan?.turni?.[staffId] ?? Array(7).fill("-");
    const counts = TURNO_TIPI.reduce((acc, t) => ({ ...acc, [t.id]: row.filter(v => v === t.id).length }), {});
    const totalSlots = row.reduce((acc, v) => acc + (TURNO_TIPI.find(t => t.id === v)?.slots || 0), 0);
    return {
      ...counts,
      lavorati: row.filter(v => !["-", "R", "F"].includes(v)).length,
      totalSlots,
    };
  }

  // Copertura per giorno (slot coperti)
  function getCopertura(dayIdx) {
    if (!currentPlan) return 0;
    return staffFiltered.reduce((acc, s) => {
      const v = currentPlan.turni?.[s.id]?.[dayIdx] ?? "-";
      return acc + (TURNO_TIPI.find(t => t.id === v)?.slots || 0);
    }, 0);
  }

  function handleDeletePlan() {
    if (!currentPlan) return;
    if (!window.confirm("Eliminare il piano di questa settimana?")) return;
    setTurniStaff(prev => prev.filter(p => !(p.weekStart === weekStart && p.sede === currentSede)));
    setNoteWeek("");
  }

  function copyFromPrevWeek() {
    const prevWeek = shiftWeek(weekStart, -1);
    const prevPlan = turniStaff.find(p => p.weekStart === prevWeek && p.sede === currentSede);
    if (!prevPlan) { setToastMsg({ type:"warn", text:"Nessun piano trovato per la settimana precedente." }); setTimeout(()=>setToastMsg(null),3500); return; }
    const cloneTurni = (typeof structuredClone === "function" ? structuredClone : (x => JSON.parse(JSON.stringify(x))))(prevPlan.turni);
    // Copia anche le note se presenti
    const noteToCarry = prevPlan.note || "";
    setTurniStaff(prev => {
      const exists = prev.find(p => p.weekStart === weekStart && p.sede === currentSede);
      const newPlan = makeWeekPlan({ weekStart, sede: currentSede, turni: cloneTurni, note: noteToCarry });
      if (exists) return prev.map(p => p.weekStart === weekStart && p.sede === currentSede ? newPlan : p);
      return [...prev, newPlan];
    });
    if (noteToCarry) setNoteWeek(noteToCarry);
    setToastMsg({ type:"ok", text:"Piano copiato dalla settimana precedente." });
    setTimeout(() => setToastMsg(null), 2500);
  }

  function addStaff(data) {
    const normalized = normalizeStaffMember(data);
    if (showStaffModal === "new") {
      setStaffList(prev => [...prev, normalized]);
    } else {
      setStaffList(prev => prev.map(s => s.id === normalized.id ? normalized : s));
    }
    setShowStaffModal(null);
  }

  function toggleAttiva(id) {
    setStaffList(prev => prev.map(s => s.id === id ? { ...s, attiva: !s.attiva } : s));
  }

  function deleteStaff(id) {
    if (!window.confirm("Rimuovere il dipendente dalla lista?")) return;
    setStaffList(prev => prev.filter(s => s.id !== id));
  }

  const sty = {
    card: { background:"var(--k2-card)", border:"1px solid var(--k2-border)", borderRadius:12, padding:20 },
    btnP: { padding:"8px 16px", borderRadius:8, border:"none", background:"var(--k2-accent)", color:"#fff", fontWeight:700, cursor:"pointer", fontSize:13 },
    btnS: { padding:"7px 12px", borderRadius:7, border:"1px solid var(--k2-border)", background:"transparent", color:"var(--k2-text-dim)", cursor:"pointer", fontSize:12 },
    tab:  (active) => ({ padding:"8px 18px", border:"none", cursor:"pointer", fontWeight: active ? 700 : 400, background: active ? "var(--k2-accent)" : "transparent", color: active ? "#fff" : "var(--k2-text-dim)", fontSize:13, transition:"all 0.15s" }),
  };

  // ── STORICO ────────────────────────────────────────────────────────────────
  const storico = [...turniStaff]
    .filter(p => p.sede === currentSede)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, 52);

  function exportTurniPrintableFile() {
    const rows = staffFiltered.map(staff => {
      const row = currentPlan?.turni?.[staff.id] ?? Array(7).fill("-");
      const stats = getStats(staff.id);
      const cells = weekDates.map((iso, idx) => `<td style="padding:8px 6px;border:1px solid #d7cfbf;text-align:center;font-weight:bold;">${row[idx] || "-"}</td>`).join("");
      return `<tr><td style="padding:8px 10px;border:1px solid #d7cfbf;font-weight:bold;">${staff.nome}</td>${cells}<td style="padding:8px 10px;border:1px solid #d7cfbf;text-align:center;">${stats.totalSlots}</td></tr>`;
    }).join("");
    const headCols = weekDates.map((iso, idx) => `<th style="padding:8px 6px;border:1px solid #d7cfbf;">${GIORNI_SETTIMANA[idx]}<br/><span style="font-size:10px;color:#6b7280;">${formatDayMonthIT(iso)}</span></th>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Turni ${currentSede} ${formatWeekLabel(weekStart)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#1a1508}table{width:100%;border-collapse:collapse}h1{margin:0 0 4px 0;color:#8b6b2a}.muted{color:#6b7280;font-size:12px}</style></head><body><h1>Turni Staff · ${currentSede}</h1><div class="muted">Settimana ${formatWeekLabel(weekStart)} · Formato giorno/mese</div><table style="margin-top:16px"><thead><tr><th style="padding:8px 10px;border:1px solid #d7cfbf;text-align:left">Dipendente</th>${headCols}<th style="padding:8px 10px;border:1px solid #d7cfbf;">Slot</th></tr></thead><tbody>${rows || `<tr><td colspan="9" style="padding:20px;text-align:center;border:1px solid #d7cfbf;color:#6b7280">Nessun dipendente</td></tr>`}</tbody></table><div style="margin-top:18px;font-size:11px;color:#6b7280">Legenda: ${TURNO_TIPI.filter(t => t.id !== "-").map(t => `${t.short}=${t.label}`).join(" · ")}</div></body></html>`;
    const ok = downloadTextFile(`k2-turni-${currentSede.toLowerCase().replace(/\s+/g,'-')}-${weekStart}.html`, html, 'text/html;charset=utf-8');
    setToastMsg({ type: ok ? "ok" : "err", text: ok ? "File turni stampabile esportato." : "Esportazione turni non riuscita." });
    setTimeout(() => setToastMsg(null), 3000);
  }

  function printTurniNow() {
    const rows = staffFiltered.map(staff => {
      const row = currentPlan?.turni?.[staff.id] ?? Array(7).fill("-");
      const stats = getStats(staff.id);
      const cells = weekDates.map((iso, idx) => `<td style="padding:8px 6px;border:1px solid #d7cfbf;text-align:center;font-weight:bold;">${row[idx] || "-"}</td>`).join("");
      return `<tr><td style="padding:8px 10px;border:1px solid #d7cfbf;font-weight:bold;">${staff.nome}</td>${cells}<td style="padding:8px 10px;border:1px solid #d7cfbf;text-align:center;">${stats.totalSlots}</td></tr>`;
    }).join("");
    const headCols = weekDates.map((iso, idx) => `<th style="padding:8px 6px;border:1px solid #d7cfbf;">${GIORNI_SETTIMANA[idx]}<br/><span style="font-size:10px;color:#6b7280;">${formatDayMonthIT(iso)}</span></th>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Turni</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#1a1508}table{width:100%;border-collapse:collapse}h1{margin:0 0 4px 0;color:#8b6b2a}.muted{color:#6b7280;font-size:12px}</style></head><body><h1>Turni Staff · ${currentSede}</h1><div class="muted">Settimana ${formatWeekLabel(weekStart)}</div><table style="margin-top:16px"><thead><tr><th style="padding:8px 10px;border:1px solid #d7cfbf;text-align:left">Dipendente</th>${headCols}<th style="padding:8px 10px;border:1px solid #d7cfbf;">Slot</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    if (!openPrintWindow(html, 'Turni Staff')) exportTurniPrintableFile();
  }

  return (
    <div style={{ padding:20, maxWidth:1000, margin:"0 auto" }}>
      {/* Toast messaggi */}
      {toastMsg && (
        <div style={{ marginBottom:12, padding:"10px 16px", borderRadius:9,
          background: toastMsg.type==="ok" ? "#10b98118" : toastMsg.type==="err" ? "#ef444418" : "#f59e0b18",
          border: `1px solid ${toastMsg.type==="ok" ? "#10b98155" : toastMsg.type==="err" ? "#ef444455" : "#f59e0b55"}`,
          color: toastMsg.type==="ok" ? "#10b981" : toastMsg.type==="err" ? "#ef4444" : "#f59e0b",
          fontSize:13, fontWeight:600 }}>
          {toastMsg.text}
        </div>
      )}
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:22, fontWeight:700 }}>📅 Turni Staff</h2>
          <p style={{ margin:"4px 0 0", fontSize:13, color:"var(--k2-text-dim)" }}>Pianificazione settimanale — {currentSede}</p>
        </div>
        {/* Sede toggle */}
        <div style={{ display:"flex", background:"var(--k2-card)", border:"1px solid var(--k2-border)", borderRadius:10, overflow:"hidden" }}>
          {SEDI.map(s => (
            <button key={s} onClick={() => setCurrentSede(s)} style={{
              padding:"7px 16px", border:"none", cursor:"pointer", fontWeight: currentSede===s ? 700 : 400,
              background: currentSede===s ? "var(--k2-accent)" : "transparent",
              color: currentSede===s ? "#fff" : "var(--k2-text-dim)", fontSize:13,
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Tab */}
      <div style={{ display:"flex", background:"var(--k2-card)", border:"1px solid var(--k2-border)", borderRadius:10, overflow:"hidden", marginBottom:20, width:"fit-content" }}>
        {[["piano","📋 Piano settimanale"],["staff","👤 Gestione staff"],["storico","📂 Storico"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={RICETTARIO_STY.tab(tab===id)}>{label}</button>
        ))}
      </div>

      {/* ── TAB PIANO ─────────────────────────────────────────────────────── */}
      {tab === "piano" && (
        <div style={{ display:"grid", gap:16 }}>
          {/* Navigazione settimana */}
          <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <button onClick={() => setWeekStart(s => shiftWeek(s, -1))} style={RICETTARIO_STY.btnS}>‹ Settimana prec.</button>
            <div style={{ fontWeight:700, fontSize:15, flex:1, textAlign:"center" }}>
              {formatWeekLabel(weekStart)}
              {weekStart === getMondayISO(today()) && (
                <span style={{ marginLeft:8, fontSize:11, background:"#10b98122", color:"#10b981", borderRadius:999, padding:"2px 8px", fontWeight:700 }}>questa settimana</span>
              )}
            </div>
            <button onClick={() => setWeekStart(s => shiftWeek(s, 1))} style={RICETTARIO_STY.btnS}>Settimana succ. ›</button>
            <button onClick={() => setWeekStart(getMondayISO(today()))} style={RICETTARIO_STY.btnS}>Oggi</button>
          </div>

          {/* Toolbar */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button onClick={copyFromPrevWeek} style={RICETTARIO_STY.btnS}>📋 Copia da settimana prec.</button>
            <button onClick={printTurniNow} style={RICETTARIO_STY.btnS}>🖨️ Stampa</button>
            <button onClick={exportTurniPrintableFile} style={RICETTARIO_STY.btnS}>📄 File stampabile</button>
            {currentPlan && <button onClick={handleDeletePlan} style={{ ...RICETTARIO_STY.btnS, color:"#ef4444" }}>🗑 Elimina piano</button>}
          </div>

          {/* Griglia turni */}
          {staffFiltered.length === 0 ? (
            <div style={{ ...RICETTARIO_STY.card, textAlign:"center", padding:"40px 0", color:"var(--k2-text-dim)" }}>
              Nessun dipendente assegnato a {currentSede}.<br />
              <button onClick={() => setTab("staff")} style={{ marginTop:12, ...RICETTARIO_STY.btnP }}>Aggiungi staff</button>
            </div>
          ) : (
            <div style={RICETTARIO_STY.card}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", minWidth:600 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign:"left", padding:"8px 10px", fontSize:12, color:"var(--k2-text-dim)", fontWeight:600, width:130 }}>Dipendente</th>
                      {GIORNI_SETTIMANA.map((g, idx) => {
                        const coper = getCopertura(idx);
                        const isToday = weekDates[idx] === today();
                        return (
                          <th key={g} style={{ textAlign:"center", padding:"6px 4px", fontSize:12, color: isToday ? "var(--k2-accent)" : "var(--k2-text-dim)", fontWeight: isToday ? 700 : 600, minWidth:46 }}>
                            <div>{g}</div>
                            <div style={{ fontSize:10, color:"var(--k2-text-dim)", fontWeight:400 }}>{formatDayMonthIT(weekDates[idx])}</div>
                            <div style={{ fontSize:10, marginTop:2, color: coper === 0 ? "#ef4444" : "#10b981", fontWeight:700 }} title={`${coper} in turno`}>
                              {coper > 0 ? `●`.repeat(Math.min(coper, 5)) : "○"}
                            </div>
                          </th>
                        );
                      })}
                      <th style={{ textAlign:"center", padding:"8px 4px", fontSize:11, color:"var(--k2-text-dim)", fontWeight:600, width:110 }}>Turni/sett.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffFiltered.map(staff => {
                      const stats = getStats(staff.id);
                      return (
                        <tr key={staff.id} style={{ borderTop:"1px solid var(--k2-border)" }}>
                          <td style={{ padding:"8px 10px", fontSize:13, fontWeight:600 }}>
                            <div>{staff.nome}</div>
                            {staff.sede === "Entrambe" && <div style={{ fontSize:10, color:"var(--k2-text-dim)" }}>Entrambe le sedi</div>}
                          </td>
                          {GIORNI_SETTIMANA.map((_, dayIdx) => {
                            const val = currentPlan?.turni?.[staff.id]?.[dayIdx] ?? "-";
                            return (
                              <td key={dayIdx} style={{ textAlign:"center", padding:"6px 4px" }}>
                                <TurnoCell
                                  value={val}
                                  onChange={v => setTurno(staff.id, dayIdx, v)}
                                />
                              </td>
                            );
                          })}
                          <td style={{ textAlign:"center", padding:"6px 8px" }}>
                            <div style={{ fontSize:12, color:"var(--k2-text-dim)" }}>
                              {stats.G > 0 && <span title="Giornate intere" style={{ marginRight:4 }}>G×{stats.G}</span>}
                              {stats.MP > 0 && <span title="Mattina + pomeriggio" style={{ marginRight:4 }}>MP×{stats.MP}</span>}
                              {stats.PS > 0 && <span title="Pomeriggio + sera" style={{ marginRight:4 }}>PS×{stats.PS}</span>}
                              {stats.M > 0 && <span title="Mattine" style={{ marginRight:4 }}>M×{stats.M}</span>}
                              {stats.P > 0 && <span title="Pomeriggi" style={{ marginRight:4 }}>P×{stats.P}</span>}
                              {stats.S > 0 && <span title="Sere" style={{ marginRight:4 }}>S×{stats.S}</span>}
                              {stats.F > 0 && <span style={{ color:"#ec4899", marginRight:4 }}>F×{stats.F}</span>}
                              {stats.R > 0 && <span style={{ color:"#94a3b8" }}>R×{stats.R}</span>}
                            </div>
                            <div style={{ fontSize:11, color:"var(--k2-text-dim)" }}>
                              {stats.totalSlots} slot · {stats.lavorati} gg lav.
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legenda */}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop:16, paddingTop:12, borderTop:"1px solid var(--k2-border)" }}>
                {TURNO_TIPI.filter(t => t.id !== "-").map(t => (
                  <div key={t.id} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12 }}>
                    <div style={{ width:24, height:24, borderRadius:5, background:t.bg, border:`1px solid ${t.color}66`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:t.color, fontSize:12 }}>{t.short}</div>
                    <span style={{ color:"var(--k2-text-dim)" }}>{t.label}</span>
                  </div>
                ))}
                <span style={{ fontSize:11, color:"var(--k2-text-dim)", marginLeft:"auto", alignSelf:"center" }}>Clicca su una cella per cambiare turno</span>
              </div>
            </div>
          )}

          {/* Note settimana */}
          <div style={RICETTARIO_STY.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontWeight:700, fontSize:13 }}>📝 Note settimana</span>
              {!editingNote
                ? <button onClick={() => setEditingNote(true)} style={RICETTARIO_STY.btnS}>Modifica</button>
                : <div style={{ display:"flex", gap:6 }}>
                    <button onClick={() => setEditingNote(false)} style={RICETTARIO_STY.btnS}>Annulla</button>
                    <button onClick={saveNote} style={{ ...RICETTARIO_STY.btnS, color:"var(--k2-accent)", fontWeight:700 }}>Salva</button>
                  </div>
              }
            </div>
            {editingNote
              ? <textarea value={noteWeek} onChange={e => setNoteWeek(e.target.value)} style={{ width:"100%", minHeight:80, padding:"8px 10px", borderRadius:7, border:"1px solid var(--k2-border)", background:"var(--k2-input-bg)", color:"var(--k2-text)", fontSize:13, resize:"vertical", boxSizing:"border-box" }} placeholder="Annotazioni per questa settimana…" />
              : <div style={{ fontSize:13, color: noteWeek ? "var(--k2-text)" : "var(--k2-text-dim)", fontStyle: noteWeek ? "normal" : "italic", minHeight:32 }}>
                  {noteWeek || "Nessuna nota per questa settimana."}
                </div>
            }
          </div>
        </div>
      )}

      {/* ── TAB STAFF ─────────────────────────────────────────────────────── */}
      {tab === "staff" && (
        <div style={RICETTARIO_STY.card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <h3 style={{ margin:0, fontSize:15, fontWeight:700 }}>👤 Dipendenti</h3>
            <button onClick={() => setShowStaffModal("new")} style={RICETTARIO_STY.btnP}>➕ Aggiungi</button>
          </div>
          {staffList.length === 0 ? (
            <div style={{ textAlign:"center", padding:"30px 0", color:"var(--k2-text-dim)" }}>Nessun dipendente ancora aggiunto.</div>
          ) : (
            <div style={{ display:"grid", gap:8 }}>
              {staffList.map(s => (
                <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:9, background:"var(--k2-bg)", border:"1px solid var(--k2-border)", opacity: s.attiva===false ? 0.5 : 1 }}>
                  <div style={{ width:36, height:36, borderRadius:999, background:"var(--k2-accent)22", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"var(--k2-accent)", fontSize:15, flexShrink:0 }}>
                    {s.nome?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:14 }}>{s.nome || <em style={{ color:"var(--k2-text-dim)" }}>Senza nome</em>}</div>
                    <div style={{ fontSize:12, color:"var(--k2-text-dim)" }}>📍 {s.sede} · {s.attiva===false ? "Non attiva" : "Attiva"}</div>
                  </div>
                  <button onClick={() => setShowStaffModal(s)} style={RICETTARIO_STY.btnS}>✏️</button>
                  <button onClick={() => toggleAttiva(s.id)} style={RICETTARIO_STY.btnS}>{s.attiva===false ? "Riattiva" : "Disattiva"}</button>
                  <button onClick={() => deleteStaff(s.id)} style={{ ...RICETTARIO_STY.btnS, color:"#ef4444" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB STORICO ───────────────────────────────────────────────────── */}
      {tab === "storico" && (
        <div style={RICETTARIO_STY.card}>
          <h3 style={{ margin:"0 0 16px", fontSize:15, fontWeight:700 }}>📂 Storico piani — {currentSede}</h3>
          {storico.length === 0 ? (
            <div style={{ textAlign:"center", padding:"30px 0", color:"var(--k2-text-dim)" }}>Nessun piano salvato per {currentSede}.</div>
          ) : (
            <div style={{ display:"grid", gap:8 }}>
              {storico.map(p => {
                const staff = staffList.filter(s => s.attiva !== false && (s.sede === p.sede || s.sede === "Entrambe"));
                const totCopertura = staff.reduce((acc, s) => acc + (p.turni?.[s.id] ?? []).filter(v => v !== "-" && v !== "R" && v !== "F").length, 0);
                const isCurrent = p.weekStart === weekStart;
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:9, background: isCurrent ? "var(--k2-accent)0a" : "var(--k2-bg)", border:`1px solid ${isCurrent ? "var(--k2-accent)55" : "var(--k2-border)"}` }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14 }}>{formatWeekLabel(p.weekStart)}</div>
                      <div style={{ fontSize:12, color:"var(--k2-text-dim)" }}>{staff.length} dipendenti · {totCopertura} turni totali</div>
                      {p.note && <div style={{ fontSize:11, color:"var(--k2-text-dim)", fontStyle:"italic", marginTop:2 }}>📝 {p.note}</div>}
                    </div>
                    {isCurrent && <span style={{ fontSize:11, background:"var(--k2-accent)22", color:"var(--k2-accent)", borderRadius:999, padding:"2px 8px", fontWeight:700 }}>corrente</span>}
                    <button onClick={() => { setWeekStart(p.weekStart); setTab("piano"); }} style={RICETTARIO_STY.btnS}>Vai a questa settimana</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modale staff */}
      {showStaffModal && (
        <StaffModal
          initial={showStaffModal === "new" ? null : showStaffModal}
          onSave={addStaff}
          onClose={() => setShowStaffModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULO RICETTARIO — K2 Suite v17
// Database completo ricette Gelateria K2 + Pasticceria
// Diviso per reparto: Gelateria | Pasticceria
// ═══════════════════════════════════════════════════════════════════════════════

const K2_RICETTARIO = [
  // ─── SEZIONE A — BASI INTERNE ────────────────────────────────────────────────
  { id:"A1", reparto:"gelateria", categoria:"Basi interne", nome:"Base Fiordilatte K2",
    note:"Base bianca/gialla · T° vetrina -11°C · Costo/kg €0,78 · 1 kg (denominatore)",
    resa:"60 kg", kcal:"159", ingredienti:[
      {nome:"Latte intero 3,5%", dose:"16.000 g", note:"266 g per 1 kg"},
      {nome:"Panna 35% m.g.", dose:"6.000 g", note:"100 g per 1 kg"},
      {nome:"Latte in polvere scremato", dose:"3.000 g", note:"50 g per 1 kg"},
      {nome:"Latte concentrato intero", dose:"3.000 g", note:"50 g per 1 kg"},
      {nome:"Glucosio liquido", dose:"1.000 g", note:"17 g per 1 kg"},
      {nome:"Zucchero invertito 70%", dose:"1.000 g", note:"17 g per 1 kg"},
      {nome:"Miele", dose:"50 g", note:"1 g per 1 kg"},
      {nome:"Caramello", dose:"50 g", note:"1 g per 1 kg"},
      {nome:"Vaniglia", dose:"50 g", note:"tracce"},
      {nome:"Neutro creme GNA", dose:"500 g", note:"8 g per 1 kg"},
    ],
    procedimento:"Pastorizzare a 85°C, omogeneizzare, raffreddare a +4°C. Maturare minimo 4-6h.",
  },
  { id:"A2", reparto:"gelateria", categoria:"Basi interne", nome:"Base Frutta K2 (23 kg)",
    note:"Gelati di frutta · T° vetrina -28°C · Costo/kg €0,98",
    resa:"23.070 g", kcal:"241", ingredienti:[
      {nome:"Acqua", dose:"10.500 g"},
      {nome:"Glucosio liquido", dose:"1.750 g"},
      {nome:"Saccarosio", dose:"6.000 g"},
      {nome:"Glucosio disidratato", dose:"1.750 g"},
      {nome:"Destrosio", dose:"2.000 g"},
      {nome:"Saccarosio (2a aggiunta)", dose:"750 g"},
      {nome:"Neutro frutta GNA 15g", dose:"320 g"},
    ],
    procedimento:"Miscelare a freddo. Solidi totali 44,2% · Acqua 55,8%.",
  },
  { id:"A3", reparto:"gelateria", categoria:"Basi interne", nome:"Base Frutta K2 (46 lt) – Sorbetti",
    note:"Sorbetti di frutta · T° vetrina -23°C · Costo/kg €0,98",
    resa:"46.150 g", kcal:"241", ingredienti:[
      {nome:"Acqua", dose:"21.000 g"},
      {nome:"Glucosio liquido", dose:"3.500 g"},
      {nome:"Saccarosio", dose:"12.000 g"},
      {nome:"Glucosio disidratato", dose:"3.500 g"},
      {nome:"Saccarosio (2a aggiunta)", dose:"1.500 g"},
      {nome:"Destrosio", dose:"4.000 g"},
      {nome:"Neutro frutta GNA 15g", dose:"650 g"},
    ],
    procedimento:"Miscelare a freddo. Solidi totali 44,2% · Acqua 55,8%.",
  },
  { id:"A4", reparto:"gelateria", categoria:"Basi interne", nome:"Base Cioccolato K2",
    note:"T° vetrina -12°C · Costo/kg €0,88",
    resa:"~3.635 g", kcal:"", ingredienti:[
      {nome:"Cacao in polvere 12% m.g.", dose:"1.000 g"},
      {nome:"Acqua", dose:"1.700 g"},
      {nome:"Saccarosio", dose:"560 g"},
      {nome:"Zucchero invertito 70%", dose:"140 g"},
      {nome:"Vaniglia", dose:"20 g"},
      {nome:"Cioccolato fondente 70%", dose:"215 g", note:"in fasi diverse"},
    ],
    procedimento:"Mescolare e cuocere. Solidi tot. 20% grassi, 6,1% altri.",
  },
  { id:"A5", reparto:"gelateria", categoria:"Basi interne", nome:"Zucchero Invertito K2",
    note:"Produzione interna · Dose 36 kg · Costo/kg €0,60-0,64 · Kcal 277",
    resa:"36 kg", kcal:"277", ingredienti:[
      {nome:"Acqua", dose:"11.000 g"},
      {nome:"Zucchero", dose:"25.000 g"},
      {nome:"Acido lattico", dose:"75 g"},
      {nome:"Bicarbonato", dose:"65 g"},
    ],
    procedimento:"Mettere tutti gli ingredienti nel pastorizzatore con programma apposito. Solidi totali 69,4%.",
  },
  { id:"A6", reparto:"gelateria", categoria:"Basi interne", nome:"Latte Condensato K2",
    note:"Produzione interna · Dose 12,8 kg · Costo/kg €0,56 · Kcal 257",
    resa:"12.800 g", kcal:"257", ingredienti:[
      {nome:"Latte intero", dose:"6.000 g"},
      {nome:"Saccarosio", dose:"5.000 g"},
      {nome:"Burro", dose:"500 g"},
      {nome:"Glucosio disidratato", dose:"500 g"},
      {nome:"Destrosio", dose:"500 g"},
      {nome:"Neutro creme GNA 15g", dose:"125 g"},
      {nome:"Neutro frutta GNA 15g", dose:"125 g"},
      {nome:"Maizena", dose:"125 g"},
    ],
    procedimento:"Cuocere nel pastorizzatore.",
  },
  { id:"A7", reparto:"gelateria", categoria:"Basi interne", nome:"Dulce de Leche K2",
    note:"Produzione interna · Dose 3,1 kg · Costo/kg €2,24 · Kcal 189 · T° -15°C",
    resa:"3.100 g", kcal:"189", ingredienti:[
      {nome:"Glucosio liquido", dose:"500 g"},
      {nome:"Latte concentrato intero", dose:"2.500 g"},
      {nome:"Caramello", dose:"125 g"},
    ],
    procedimento:"Cuocicrema a 120°C per 1 ora. Etichettare. Durata: 30 giorni in frigo.",
  },
  { id:"A8", reparto:"gelateria", categoria:"Basi interne", nome:"Pasta Nocciola K2",
    note:"Produzione interna · Costo/kg €12,33 · Kcal 660 · ⚠ Frutta a guscio",
    resa:"1.500 g", kcal:"660", ingredienti:[
      {nome:"Nocciole tostate", dose:"500 g"},
      {nome:"Pasta di nocciola", dose:"1.000 g"},
    ],
    procedimento:"Tostare nocciole, passare nel cutter, poi nel Wet Grinder. Unire la pasta di nocciola.",
  },
  // ─── SEZIONE B — GELATI CREMA ────────────────────────────────────────────────
  { id:"B1", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Fiordilatte K2",
    note:"Crema bianca · Dose 4,30 kg · Costo/kg €0,91 · Kcal 172 · ⚠ Latte",
    resa:"4.300 g", kcal:"172", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"4.000 g"},
      {nome:"Latte intero 3,5%", dose:"300 g"},
    ],
    procedimento:"Mettere il tutto in una carapina, miscelare. Mantecare.",
  },
  { id:"B2", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Crema K2",
    note:"Crema classica · Dose 4 kg · Costo/kg €1,22 · Kcal 157",
    resa:"4.000 g", kcal:"157", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.800 g"},
      {nome:"Salsa uovo K2", dose:"280 g"},
      {nome:"Vaniglia", dose:"40 g"},
      {nome:"Latte intero 3,5%", dose:"350 g"},
    ],
    procedimento:"Mettere il tutto in carapina e miscelare. Mantecare.",
  },
  { id:"B3", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Nocciola K2",
    note:"Crema nocciola · Dose 4 kg · Costo/kg €1,92 · Kcal 206 · ⚠ Frutta a guscio",
    resa:"4.000 g", kcal:"206", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"4.000 g"},
      {nome:"Pasta Nocciola K2", dose:"300 g"},
      {nome:"Nocciole tostate", dose:"150 g", note:"aggiungere a fine mantecazione"},
    ],
    procedimento:"Unire tutti gli ingredienti tranne le nocciole. Mantecare. A fine ciclo aggiungere le nocciole tostate.",
  },
  { id:"B4", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Pistacchio K2",
    note:"Crema pistacchio · Dose 4 kg · Costo/kg €1,33 · Kcal 216 · ⚠ Frutta a guscio",
    resa:"4.000 g", kcal:"216", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.000 g"},
      {nome:"Pasta Pistacchio K2", dose:"300 g"},
      {nome:"Zucchero invertito 70%", dose:"100 g"},
      {nome:"Pistacchi", dose:"100 g", note:"aggiungere a fine mantecazione"},
    ],
    procedimento:"Unire tutti gli ingredienti tranne i pistacchi. Mantecare. Unire i pistacchi a fine ciclo.",
  },
  { id:"B5", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Bacio K2",
    note:"Crema cioccolato nocciola · Dose 4 kg · Costo/kg €1,70 · Kcal 219 · ⚠ Frutta a guscio",
    resa:"4.000 g", kcal:"219", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Base Cioccolato K2", dose:"1.850 g"},
      {nome:"Pasta di nocciola", dose:"150 g"},
      {nome:"Zucchero invertito 70%", dose:"75 g"},
      {nome:"Nocciole tostate", dose:"150 g", note:"a fine mantecazione"},
    ],
    procedimento:"Unire tutti gli ingredienti tranne le nocciole. Mantecare. Aggiungere le nocciole a fine ciclo.",
  },
  { id:"B6", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Dulce de Leche K2",
    note:"Crema caramello · Dose 3 kg · Costo/kg €0,91 · Kcal 144",
    resa:"3.000 g", kcal:"144", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Dulce de Leche K2", dose:"300 g"},
      {nome:"Latte intero 3,5%", dose:"500 g"},
      {nome:"Variegato dulce de leche K2", dose:"q.b.", note:"a fine mantecazione"},
    ],
    procedimento:"Unire i tre ingredienti nella planetaria. A fine mantecazione aggiungere il variegato dulce de leche.",
  },
  { id:"B7", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Cocco K2",
    note:"Crema cocco · Dose 4 kg · Costo/kg €1,08 · Kcal 184",
    resa:"4.000 g", kcal:"184", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.000 g"},
      {nome:"Salsa Cocco K2", dose:"500 g"},
      {nome:"Latte intero 3,5%", dose:"500 g"},
      {nome:"Aroma cocco", dose:"2 g"},
    ],
    procedimento:"Mettere tutto in carapina, miscelare. Mantecare.",
  },
  { id:"B8", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Cremino K2",
    note:"Crema cremino · Dose 4 kg · Costo/kg €0,85 · Kcal 230",
    resa:"4.000 g", kcal:"230", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.000 g"},
      {nome:"Salsa Cremino K2", dose:"800 g"},
      {nome:"Crema di nocciole e cacao", dose:"100 g"},
    ],
    procedimento:"Mettere tutto nel mantecatore.",
  },
  { id:"B9", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Spagnola K2",
    note:"Crema bianca + variegatura amarene · Dose 3 kg · Costo/kg €0,86",
    resa:"3.000 g", kcal:"", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.200 g"},
      {nome:"Salsa Amarene K2", dose:"100 g", note:"variegatura a fine ciclo"},
    ],
    procedimento:"Mettere il gelato nel mantecatore. A fine ciclo variegare con un mestolo alla volta di amarene.",
  },
  { id:"B10", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Malaga K2",
    note:"Crema uva passa marsala · Dose 3 kg · Costo/kg €0,75 · Kcal 121",
    resa:"3.000 g", kcal:"121", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"1.300 g"},
      {nome:"Latte intero 3,5%", dose:"1.000 g"},
      {nome:"Salsa Zabajone K2", dose:"200 g"},
      {nome:"Salsa Malaga K2", dose:"100 g", note:"variegatura a fine ciclo"},
    ],
    procedimento:"Unire tutti gli ingredienti nel mantecatore. A fine mantecatura aggiungere 200g di salsa Malaga.",
  },
  { id:"B11", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Liquirizia K2",
    note:"Crema liquirizia · Dose 2 kg · Costo/kg €1,34 · Kcal 156",
    resa:"2.000 g", kcal:"156", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Latte intero 3,5%", dose:"200 g"},
      {nome:"Liquirizia", dose:"100 g"},
    ],
    procedimento:"Mettere tutto in carapina, miscelare. Mantecare.",
  },
  { id:"B12", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Noci Fichi e Miele K2",
    note:"Crema frutta secca · Dose 4 kg · Costo/kg €1,13 · Kcal 167 · ⚠ Frutta a guscio",
    resa:"4.000 g", kcal:"167", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.000 g"},
      {nome:"Salsa Noci K2", dose:"160 g"},
      {nome:"Marmellata di fichi", dose:"160 g"},
      {nome:"Latte intero 3,5%", dose:"300 g"},
    ],
    procedimento:"Unire in carapina base, salsa di noci, marmellata e latte. Mantecare.",
  },
  { id:"B13", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Caramello Salato K2",
    note:"Crema caramello · Dose 2 kg · Costo/kg €0,82 · Kcal 127",
    resa:"2.000 g", kcal:"127", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"1.300 g"},
      {nome:"Latte intero 3,5%", dose:"800 g"},
      {nome:"Salsa Caramello K2", dose:"q.b.", note:"variegatura"},
    ],
    procedimento:"Miscelare base e latte. Mantecare. Variegare con salsa caramello.",
  },
  { id:"B14", reparto:"gelateria", categoria:"Gelati crema", nome:"After Camatti K2",
    note:"Gusto firma K2 · Menta + cioccolato + Amaro Camatti · Kcal 154 ⭐",
    resa:"~2.300 g", kcal:"154", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Latte intero 3,5%", dose:"200 g"},
      {nome:"Menta concentrata", dose:"100 g", note:"no coloranti artificiali"},
      {nome:"Olio essenziale menta", dose:"q.b."},
      {nome:"Variegato Camatti K2", dose:"q.b.", note:"a fine mantecazione"},
    ],
    procedimento:"Unire base, latte e menta. Mantecare. A fine ciclo variegare con il Variegato Camatti K2.",
  },
  // ─── SEZIONE C — GELATI FRUTTA E VEGAN ──────────────────────────────────────
  { id:"C1", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Limone K2",
    note:"Frutta · Dose 5 kg · Costo/kg €1,36 · Kcal 132",
    resa:"5.000 g", kcal:"132", ingredienti:[
      {nome:"Limone (polpa)", dose:"1.000 g"},
      {nome:"Base Frutta K2 23 kg", dose:"2.600 g"},
      {nome:"Acqua", dose:"1.200 g"},
    ],
    procedimento:"Unire i tre ingredienti, frullare e mantecare.",
  },
  { id:"C2", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Melone K2",
    note:"Frutta · Dose 3 kg · Costo/kg €1,66 · Kcal 115",
    resa:"3.000 g", kcal:"115", ingredienti:[
      {nome:"Melone", dose:"800 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.000 g"},
      {nome:"Acqua", dose:"700 g"},
      {nome:"Zucchero invertito 70%", dose:"70 g"},
    ],
    procedimento:"Pulire il melone, unire gli ingredienti, frullare e mantecare.",
  },
  { id:"C3", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Maracuja K2",
    note:"Frutta tropicale · Dose 4 kg · Costo/kg €1,81 · Kcal 118",
    resa:"4.000 g", kcal:"118", ingredienti:[
      {nome:"Maracuja", dose:"1.000 g"},
      {nome:"Base Frutta K2 23 kg", dose:"2.000 g"},
      {nome:"Acqua", dose:"1.400 g"},
    ],
    procedimento:"Mettere tutto in carapina, miscelare. Mantecare.",
  },
  { id:"C4", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Anguria K2",
    note:"Frutta · Dose 3,60 kg · Costo/kg €1,24 · Kcal 118",
    resa:"3.600 g", kcal:"118", ingredienti:[
      {nome:"Anguria", dose:"q.b."},
      {nome:"Base Frutta K2 23 kg", dose:"2.000 g"},
      {nome:"Acqua", dose:"q.b."},
    ],
    procedimento:"Frullare tutto e mantecare.",
  },
  { id:"C5", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Frutti di Bosco K2",
    note:"Frutta · Dose 4 kg · Costo/kg €1,94 · Kcal 125",
    resa:"4.000 g", kcal:"125", ingredienti:[
      {nome:"Frutti di bosco", dose:"1.200 g"},
      {nome:"Base Frutta K2 23 kg", dose:"2.000 g"},
      {nome:"Acqua", dose:"900 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare e mantecare.",
  },
  { id:"C6", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Uva K2",
    note:"Frutta · Dose 2,60 kg · Costo/kg €1,53 · Kcal 93",
    resa:"2.600 g", kcal:"93", ingredienti:[
      {nome:"Uva", dose:"800 g"},
      {nome:"Base Frutta K2 23 kg", dose:"800 g"},
      {nome:"Acqua", dose:"q.b."},
    ],
    procedimento:"Frullare e mantecare.",
  },
  { id:"C7", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Mela Zenzero Cannella K2",
    note:"Frutta speziata · Dose 3 kg · Costo/kg €0,54 · Kcal 129",
    resa:"3.000 g", kcal:"129", ingredienti:[
      {nome:"Salsa Mela Zenzero e Cannella K2", dose:"900 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.000 g"},
      {nome:"Acqua", dose:"1.000 g"},
      {nome:"Zucchero invertito 70%", dose:"100 g"},
    ],
    procedimento:"Mettere tutto in una caraffa, frullare e mantecare.",
  },
  { id:"C8", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Corbezzolo K2",
    note:"Frutto del territorio · Stagionale ott-nov · Raccolta personale · Costo/kg €0,37 ⭐",
    resa:"variabile", kcal:"", ingredienti:[
      {nome:"Corbezzolo (bacche fresche)", dose:"1.636 g", note:"raccolte sulle colline sopra Sestri L."},
      {nome:"Base Frutta K2 23 kg", dose:"q.b."},
      {nome:"Acqua", dose:"q.b."},
    ],
    procedimento:"Frullare le bacche di corbezzolo, passare al setaccio fine. Unire alla base frutta. Mantecare. Disponibile solo ottobre-novembre.",
  },
  { id:"C9", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Fragola K2",
    note:"Frutta · Stagionale",
    resa:"variabile", kcal:"", ingredienti:[
      {nome:"Fragola fresca", dose:"q.b."},
      {nome:"Base Frutta K2 23 kg", dose:"q.b."},
      {nome:"Latte intero 3,5%", dose:"300 g"},
    ],
    procedimento:"Frullare le fragole. Unire alla base. Mantecare.",
  },
  { id:"C10", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Birra K2",
    note:"Speciale · Dose 3 kg · Costo/kg €2,72 · Kcal 77 · ⚠ Diossido di zolfo",
    resa:"3.000 g", kcal:"77", ingredienti:[
      {nome:"Birra doppio malto", dose:"1.320 g (=2 lt)", note:"aggiunta a fine mantecazione"},
      {nome:"Base Frutta K2 23 kg", dose:"1.000 g"},
      {nome:"Acqua", dose:"1.000 g"},
    ],
    procedimento:"Mettere nel mantecatore acqua e sciroppo di frutta. A fine mantecazione unire la birra doppio malto.",
  },
  { id:"C11", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Cioccolato Nero Vegan K2",
    note:"Vegan · Dose 4 kg · Costo/kg €1,70 · Kcal 168",
    resa:"4.000 g", kcal:"168", ingredienti:[
      {nome:"Salsa Cioccolato Vegan K2", dose:"1.350 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.350 g"},
      {nome:"Acqua", dose:"900 g"},
    ],
    procedimento:"Mettere tutto in carapina, miscelare. Mantecare.",
  },
  { id:"C12", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Pistacchio Salato Vegan K2",
    note:"Vegan · Dose 5 kg · Costo/kg €0,44 · Kcal 160 · ⚠ Frutta a guscio",
    resa:"5.000 g", kcal:"160", ingredienti:[
      {nome:"Acqua", dose:"2.100 g"},
      {nome:"Base Frutta K2 23 kg", dose:"2.000 g"},
      {nome:"Sale marino", dose:"20 g"},
      {nome:"Pasta Pistacchio K2", dose:"400 g"},
    ],
    procedimento:"Unire tutti gli ingredienti e mantecare.",
  },
  { id:"C13", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Yogurt K2",
    note:"Crema yogurt · Dose 3 kg · Costo/kg €2,49 · Kcal 157 · ⚠ Latte",
    resa:"3.000 g", kcal:"157", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Yogurt magro", dose:"1.000 g"},
      {nome:"Zucchero invertito 70%", dose:"400 g"},
      {nome:"Yogurt in polvere", dose:"200 g"},
      {nome:"Acido ascorbico", dose:"10 g"},
      {nome:"Acido citrico", dose:"10 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare bene. Mantecare.",
  },
  // ─── Gelati frutta completamento (sezione W) ─────────────────────────────────
  { id:"W1", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Banana K2",
    note:"Frutta · Dose ~2,4 kg · Costo/kg €1,08 · Kcal 93 · T° -6°C",
    resa:"2.400 g", kcal:"93", ingredienti:[
      {nome:"Banana", dose:"800 g"},
      {nome:"Sciroppo frutta K2", dose:"1.000 g"},
      {nome:"Acqua", dose:"600 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare e mantecare.",
  },
  { id:"W2", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Arancia K2",
    note:"Sorbetto · Dose ~3 kg · Costo/kg €1,09 · Kcal 69 · T° -4°C",
    resa:"3.000 g", kcal:"69", ingredienti:[
      {nome:"Arancia (polpa/succo)", dose:"1.000 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.000 g"},
      {nome:"Acqua", dose:"1.000 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare e mantecare.",
  },
  { id:"W3", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Mandarino K2",
    note:"Frutta · Dose ~2,45 kg · Costo/kg €1,49 · Kcal 99 · T° -4°C",
    resa:"2.450 g", kcal:"99", ingredienti:[
      {nome:"Mandarino", dose:"750 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.100 g"},
      {nome:"Acqua", dose:"600 g"},
    ],
    procedimento:"Frullare e mantecare.",
  },
  { id:"W4", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Pesca K2",
    note:"Sorbetto · Dose ~2,7 kg · Costo/kg €1,18 · Kcal 99 · T° -3°C",
    resa:"2.700 g", kcal:"99", ingredienti:[
      {nome:"Pesca", dose:"800 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.200 g"},
      {nome:"Acqua", dose:"600 g"},
      {nome:"Zucchero invertito K2", dose:"100 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare e mantecare.",
  },
  { id:"W5", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Ananas K2",
    note:"Sorbetto · Dose ~2,55 kg · Costo/kg €1,43 · Kcal 97 · T° -4°C",
    resa:"2.550 g", kcal:"97", ingredienti:[
      {nome:"Ananas", dose:"700 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.200 g"},
      {nome:"Acqua", dose:"600 g"},
      {nome:"Zucchero invertito K2", dose:"50 g"},
    ],
    procedimento:"Frullare e mantecare.",
  },
  { id:"W6", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Fico d'India K2",
    note:"Sorbetto · Dose ~2,7 kg · Costo/kg €1,80 · Kcal 95 · T° -3°C",
    resa:"2.700 g", kcal:"95", ingredienti:[
      {nome:"Fichi d'India", dose:"800 g"},
      {nome:"Base Frutta K2 46 lt", dose:"1.300 g"},
      {nome:"Acqua", dose:"600 g"},
    ],
    procedimento:"Frullare e mantecare.",
  },
  { id:"W7", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Mora di Gelso K2",
    note:"Sorbetto · Dose ~2,75 kg · Costo/kg €1,78 · Kcal 99 · T° -3°C",
    resa:"2.750 g", kcal:"99", ingredienti:[
      {nome:"More di gelso", dose:"800 g"},
      {nome:"Base Frutta K2 46 lt", dose:"1.300 g"},
      {nome:"Acqua", dose:"600 g"},
      {nome:"Zucchero invertito K2", dose:"50 g"},
    ],
    procedimento:"Frullare e mantecare.",
  },
  { id:"W8", reparto:"gelateria", categoria:"Gelati frutta e vegan", nome:"Gelato Ciliegia K2",
    note:"Sorbetto · Dose ~2,6 kg · Costo/kg €2,43 · Kcal 91 · T° -4°C",
    resa:"2.600 g", kcal:"91", ingredienti:[
      {nome:"Ciliegie (estrattore a freddo)", dose:"800 g"},
      {nome:"Base Frutta K2 23 kg", dose:"1.200 g"},
      {nome:"Acqua", dose:"600 g"},
    ],
    procedimento:"Passare le ciliegie nell'estrattore a freddo. Unire tutti gli ingredienti nella carapina, frullare e mantecare.",
  },
  // ─── SEZIONE D — SALSE E VARIEGATI ──────────────────────────────────────────
  { id:"D1", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Amarene K2",
    note:"Variegato frutta · Dose ~4 kg · Costo/kg €6,16-7,15 · Kcal 452 · T° -37°C",
    resa:"~4.000 g", kcal:"452", ingredienti:[
      {nome:"Amarene fresche", dose:"5.000 g"},
      {nome:"Saccarosio", dose:"3.000 g"},
      {nome:"Glucosio disidratato", dose:"500 g"},
      {nome:"Acido citrico", dose:"80 g"},
      {nome:"Neutro frutta GNA 15g", dose:"200 g"},
      {nome:"Acido ascorbico", dose:"100 g"},
      {nome:"Maraschino", dose:"200 g"},
    ],
    procedimento:"Mettere in un cuocicrema. Cuocere a 85°C.",
  },
  { id:"D2", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Cannella K2",
    note:"Variegato speziato · Dose ~3,2 kg · Costo/kg €2,26 · Kcal 400 · T° -70°C",
    resa:"~3.200 g", kcal:"400", ingredienti:[
      {nome:"Zucchero invertito 70%", dose:"2.500 g"},
      {nome:"Glucosio liquido", dose:"500 g"},
      {nome:"Cannella", dose:"200 g"},
      {nome:"Neutro frutta GNA 15g", dose:"50 g"},
    ],
    procedimento:"Cuocere in macchina a 85°C per 30 min a velocità 5 (Moulinex o Bimby).",
  },
  { id:"D3", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Cioccolato Vegan K2",
    note:"Base cioccolato vegan · Dose ~3,6 kg · Costo/kg €3,54-3,82 · Kcal 208 · T° -12°C",
    resa:"~3.600 g", kcal:"208", ingredienti:[
      {nome:"Cacao in polvere 24%", dose:"1.000 g"},
      {nome:"Acqua", dose:"1.700 g"},
      {nome:"Zucchero", dose:"560 g"},
      {nome:"Zucchero invertito 70%", dose:"140 g"},
      {nome:"Cioccolato fondente 70%", dose:"220 g"},
      {nome:"Vaniglia", dose:"20 g"},
    ],
    procedimento:"Mescolare e cuocere.",
  },
  { id:"D4", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Cocco K2",
    note:"Variegato cocco · Dose ~4 kg · Costo/kg €1,50-3,25 · Kcal 463 · T° -56°C",
    resa:"~4.000 g", kcal:"463", ingredienti:[
      {nome:"Zucchero invertito 70%", dose:"3.000 g"},
      {nome:"Cocco secco rapé", dose:"1.000 g"},
      {nome:"Aroma cocco", dose:"2 g"},
    ],
    procedimento:"Mettere in un cuocicrema, riscaldare fino a 80°C per 30 min. Riporre in frigo con etichetta. Durata: 30 giorni.",
  },
  { id:"D5", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Uovo K2",
    note:"Base gialla · Dose ~3,1 kg · Costo/kg €0,38-6,79 · Kcal 241 · T° -16°C · ⚠ Uova",
    resa:"~3.100 g", kcal:"241", ingredienti:[
      {nome:"Uovo fresco intero", dose:"1.700 g"},
      {nome:"Zucchero", dose:"1.000 g"},
      {nome:"Neutro frutta GNA 15g", dose:"50 g"},
      {nome:"Colorante rosso K2", dose:"5 g"},
      {nome:"Marsala", dose:"150 g"},
      {nome:"Limoncino", dose:"150 g"},
      {nome:"Vaniglia", dose:"100 g"},
    ],
    procedimento:"Mettere in un cuocicrema a velocità moderata.",
  },
  { id:"D6", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Noci K2",
    note:"Variegato frutta secca · Dose ~2 kg · Costo/kg €8,22 · Kcal 549 · T° -31°C · ⚠ Frutta a guscio",
    resa:"~2.000 g", kcal:"549", ingredienti:[
      {nome:"Noci", dose:"1.000 g"},
      {nome:"Zucchero", dose:"500 g"},
      {nome:"Zucchero invertito 70%", dose:"500 g"},
    ],
    procedimento:"Macinare le noci con lo zucchero, poi unire lo zucchero invertito. Etichettare. Frigo 30 giorni.",
  },
  { id:"D7", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Noci e Miele K2",
    note:"Variegato · Dose ~1,5 kg · Costo/kg €12,33 · Kcal 470 · T° -50°C · ⚠ Frutta a guscio",
    resa:"~1.500 g", kcal:"470", ingredienti:[
      {nome:"Noci", dose:"500 g"},
      {nome:"Miele", dose:"500 g"},
      {nome:"Zucchero invertito 70%", dose:"500 g"},
    ],
    procedimento:"Tritare le noci, aggiungere miele e zucchero invertito. Frigo 30 giorni.",
  },
  { id:"D8", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Zabajone K2",
    note:"Variegato zabajone · Dose ~1,8 kg · Costo/kg €7,29 · Kcal 229 · T° -17°C · ⚠ Uova",
    resa:"~1.800 g", kcal:"229", ingredienti:[
      {nome:"Uova pastorizzate", dose:"600 g"},
      {nome:"Zucchero", dose:"600 g"},
      {nome:"Marsala", dose:"600 g"},
    ],
    procedimento:"Montare le uova con le fruste, aggiungere zucchero e marsala.",
  },
  { id:"D9", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Malaga K2",
    note:"Variegato uva passa · Dose ~2 kg · Costo/kg €6,72 · Kcal 333 · T° -21°C",
    resa:"~2.000 g", kcal:"333", ingredienti:[
      {nome:"Uva passa", dose:"500 g"},
      {nome:"Marsala", dose:"500 g"},
      {nome:"Sciroppo glucosio disidratato 38DE", dose:"500 g"},
      {nome:"Zucchero", dose:"500 g"},
    ],
    procedimento:"Mettere in ammollo. Etichettare.",
  },
  { id:"D10", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Caramello K2",
    note:"Variegato caramello · Dose ~2,5 kg · Costo/kg €1,32 · Kcal 323 · T° -46°C",
    resa:"~2.500 g", kcal:"323", ingredienti:[
      {nome:"Glucosio liquido", dose:"500 g"},
      {nome:"Zucchero", dose:"1.500 g"},
      {nome:"Acqua", dose:"500 g"},
    ],
    procedimento:"Mettere in pentola glucosio sotto e zucchero sopra. Scaldare a 120°C finché non diventa scuro. Far bollire l'acqua a parte, poi unire usando un mixer. Raffreddare.",
  },
  { id:"D11", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Cremino K2",
    note:"Variegato cremino · Dose ~800 g · Costo/kg €4,88 · Kcal 437 · T° -26°C · ⚠ Latte",
    resa:"~800 g", kcal:"437", ingredienti:[
      {nome:"Latte intero 3,5%", dose:"200 g"},
      {nome:"Cioccolato bianco", dose:"200 g"},
      {nome:"Pasta di nocciola", dose:"100 g"},
      {nome:"Crema di nocciole e cacao", dose:"100 g"},
      {nome:"Zucchero invertito 70%", dose:"200 g"},
    ],
    procedimento:"Sciogliere il cioccolato bianco con il latte. Unire tutti gli ingredienti.",
  },
  { id:"D12", reparto:"gelateria", categoria:"Salse e variegati", nome:"Variegato Camatti K2",
    note:"Gusto firma · Amaro Camatti + cioccolato · Costo/kg €13,50 · T° -8°C ⭐",
    resa:"~1.000 g", kcal:"", ingredienti:[
      {nome:"Amaro Camatti", dose:"500 g", note:"ingrediente identitario K2"},
      {nome:"Cioccolato fondente 70%", dose:"500 g"},
    ],
    procedimento:"Versare il Camatti e la Base Stracciatella K2 in egual misura, mescolare fino ad assorbimento completo. Etichettare e conservare.",
  },
  { id:"D13", reparto:"gelateria", categoria:"Salse e variegati", nome:"Variegato Dulce de Leche K2",
    note:"Variegato · Dose ~1 kg · Costo/kg €2,12 · Kcal 129 · T° -1°C",
    resa:"~1.000 g", kcal:"129", ingredienti:[
      {nome:"Latte concentrato intero", dose:"500 g"},
      {nome:"Dulce de Leche K2", dose:"500 g"},
    ],
    procedimento:"Mescolare i due ingredienti. Etichettare e riporre in frigo. Durata 30 giorni.",
  },
  { id:"D14", reparto:"gelateria", categoria:"Salse e variegati", nome:"Base Stracciatella K2 (bagno maria)",
    note:"Variegato cioccolato · Costo/kg €11,00 · Kcal 558 · T° -9°C",
    resa:"~850 g", kcal:"558", ingredienti:[
      {nome:"Cioccolato fondente 70%", dose:"500 g"},
      {nome:"Cioccolato monorigine Dominicana 75% ICAM", dose:"200 g"},
      {nome:"Massa di cacao K2", dose:"50 g"},
      {nome:"Olio di arachidi", dose:"100 g"},
    ],
    procedimento:"Sciogliere a bagno maria. Versare filando sul gelato durante la mantecazione.",
  },
  { id:"D15", reparto:"gelateria", categoria:"Salse e variegati", nome:"Salsa Mela Zenzero e Cannella K2",
    note:"Frutta speziata · Dose ~3,6 kg · Costo/kg €2,36 · Kcal 115 · T° -18°C",
    resa:"~3.600 g", kcal:"115", ingredienti:[
      {nome:"Mela", dose:"3.000 g"},
      {nome:"Zucchero invertito 70%", dose:"500 g"},
      {nome:"Zenzero", dose:"50 g"},
      {nome:"Cannella", dose:"50 g"},
    ],
    procedimento:"Mettere tutto in una pentola e cuocere a fuoco medio finché le mele sono morbide. Frullare.",
  },
  { id:"D16", reparto:"gelateria", categoria:"Salse e variegati", nome:"Pasta Pistacchio K2",
    note:"Produzione interna · Costo/kg €26,00 · Kcal 607 · ⚠ Frutta a guscio, Pistacchio",
    resa:"~1.500 g", kcal:"607", ingredienti:[
      {nome:"Pasta di pistacchio K2", dose:"1.000 g"},
      {nome:"Pistacchi", dose:"500 g", note:"tostati a 135°C per 30 min"},
    ],
    procedimento:"Tostare i pistacchi in forno a 135°C per 30 min. Passare nel cutter, poi nel Wet Grinder. Unire pasta di pistacchio stesso peso.",
  },
  // ─── SEZIONE E — SEMIFREDDI ──────────────────────────────────────────────────
  { id:"E1", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Fiordilatte K2",
    note:"Dose 1 kg · Costo/kg €3,55-3,61 · Kcal 308 · T° -9°C",
    resa:"1.000 g", kcal:"308", ingredienti:[
      {nome:"Panna 35%", dose:"1.000 g"},
      {nome:"Zucchero", dose:"250 g"},
      {nome:"Maraschino", dose:"20 g"},
      {nome:"Base Fiordilatte K2", dose:"300 g"},
    ],
    procedimento:"Mettere nella planetaria precedentemente raffreddata panna, zucchero, destrosio, mascarpone e salsa zabajone. Montare a velocità media aumentando fino a consistenza desiderata.",
  },
  { id:"E2", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Pistacchio K2",
    note:"Dose 6 kg · Costo/kg €5,70 · Kcal 369 · T° -13°C · ⚠ Frutta a guscio",
    resa:"6.000 g", kcal:"369", ingredienti:[
      {nome:"Panna 35%", dose:"1.000 g"},
      {nome:"Zucchero", dose:"250 g"},
      {nome:"Destrosio", dose:"50 g"},
      {nome:"Pasta Pistacchio K2", dose:"100 g"},
    ],
    procedimento:"Mettere nella planetaria precedentemente raffreddata. Montare fino a consistenza desiderata.",
  },
  { id:"E3", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Zabajone K2",
    note:"Dose 6 kg · Costo/kg €3,54 · Kcal 344 · T° -13°C · ⚠ Uova",
    resa:"6.000 g", kcal:"344", ingredienti:[
      {nome:"Panna 35%", dose:"1.000 g"},
      {nome:"Zucchero", dose:"250 g"},
      {nome:"Destrosio", dose:"50 g"},
      {nome:"Salsa Zabajone K2", dose:"100 g"},
      {nome:"Mascarpone fresco", dose:"100 g"},
    ],
    procedimento:"Montare in planetaria fredda.",
  },
  { id:"E4", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Croccantino K2",
    note:"Dose 6 kg · Costo/kg €4,31 · Kcal 357 · T° -11°C · ⚠ Frutta a guscio",
    resa:"6.000 g", kcal:"357", ingredienti:[
      {nome:"Panna 35%", dose:"1.000 g"},
      {nome:"Zucchero", dose:"250 g"},
      {nome:"Maraschino", dose:"20 g"},
      {nome:"Croccante K2", dose:"100 g"},
    ],
    procedimento:"Mettere nella planetaria precedentemente raffreddata. Montare. Abbattere.",
  },
  { id:"E5", reparto:"gelateria", categoria:"Semifreddi", nome:"Panera K2",
    note:"Semifreddo caffè · Dose 6 kg · Costo/kg €3,98 · Kcal 327 · T° -13°C",
    resa:"6.000 g", kcal:"327", ingredienti:[
      {nome:"Panna 35%", dose:"1.000 g"},
      {nome:"Zucchero", dose:"250 g"},
      {nome:"Destrosio", dose:"50 g"},
      {nome:"Caffè espresso", dose:"100 g"},
    ],
    procedimento:"Mettere nella planetaria precedentemente raffreddata. Montare.",
  },
  { id:"E6", reparto:"gelateria", categoria:"Semifreddi", nome:"Croccante K2",
    note:"Base croccantino · Costo/kg €6,83 · Kcal 520 · T° -25°C · ⚠ Frutta a guscio",
    resa:"~2.000 g", kcal:"520", ingredienti:[
      {nome:"Zucchero", dose:"1.000 g"},
      {nome:"Nocciole tostate", dose:"1.000 g"},
      {nome:"Acqua", dose:"30 g"},
    ],
    procedimento:"Metti lo zucchero e acqua in padella antiaderente a fuoco medio-basso. Lascia che lo zucchero si sciolga e diventi ambrato. Aggiungi le nocciole, mescola velocemente e stendi su carta forno. Raffreddare.",
  },
  // ─── Semifreddi operativi laboratorio (sezione R) ─────────────────────────────
  { id:"R1", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Nutella K2",
    note:"",
    resa:"~730 g", kcal:"", ingredienti:[
      {nome:"Panna", dose:"500 g"},
      {nome:"Nutella", dose:"180 g"},
      {nome:"Zucchero invertito", dose:"50 g"},
    ],
    procedimento:"Montare panna. Incorporare Nutella e invertito a fine montatura.",
  },
  { id:"R4", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Crema K2",
    note:"",
    resa:"~875 g", kcal:"", ingredienti:[
      {nome:"Panna", dose:"500 g"},
      {nome:"Zucchero", dose:"125 g"},
      {nome:"Base uovo K2", dose:"250 g"},
    ],
    procedimento:"Montare panna con zucchero. Incorporare base uovo a fine montatura.",
  },
  { id:"R7", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Fior di Latte K2",
    note:"",
    resa:"~750 g", kcal:"", ingredienti:[
      {nome:"Panna", dose:"500 g"},
      {nome:"Zucchero", dose:"125 g"},
      {nome:"Maraschino", dose:"2 cucchiai"},
    ],
    procedimento:"Montare panna con zucchero. Aggiungere maraschino.",
  },
  { id:"R8", reparto:"gelateria", categoria:"Semifreddi", nome:"Semifreddo Marron Glacé K2",
    note:"⚠ Frutta a guscio",
    resa:"~740 g", kcal:"", ingredienti:[
      {nome:"Panna", dose:"500 g"},
      {nome:"Pasta marron glacé", dose:"100 g"},
      {nome:"Zucchero", dose:"3 cucchiai"},
      {nome:"Destrosio", dose:"40 g"},
    ],
    procedimento:"Montare panna. Incorporare pasta marron glacé, zucchero e destrosio.",
  },
  // ─── SEZIONE G — GRANITE ─────────────────────────────────────────────────────
  { id:"G1", reparto:"gelateria", categoria:"Granite", nome:"Granita Limone K2",
    note:"Base: Zucchero Invertito K2 · Gluten Free · Vegan",
    resa:"5.000 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.700 g"},
      {nome:"Acqua", dose:"2.300 g"},
      {nome:"Succo limone", dose:"1.000 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare fino a composto omogeneo. Versare nel mantecatore con programma granite. Abbattere rapidamente.",
  },
  { id:"G2", reparto:"gelateria", categoria:"Granite", nome:"Granita Menta K2",
    note:"Base: Zucchero Invertito K2 · Gluten Free · Vegan",
    resa:"~4.610 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.400 g"},
      {nome:"Acqua", dose:"3.000 g"},
      {nome:"Concentrato di menta", dose:"200 g"},
      {nome:"Essenza di menta", dose:"10 gocce"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  { id:"G3", reparto:"gelateria", categoria:"Granite", nome:"Granita Anguria K2",
    note:"Base: Zucchero Invertito K2 · Gluten Free · Vegan",
    resa:"~6.000 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.500 g"},
      {nome:"Acqua", dose:"2.500 g"},
      {nome:"Anguria passata con estrattore", dose:"2.000 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  { id:"G4", reparto:"gelateria", categoria:"Granite", nome:"Granita Mandorla K2",
    note:"Base: Zucchero Invertito K2 · ⚠ Frutta a guscio",
    resa:"~4.500 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.500 g"},
      {nome:"Acqua", dose:"2.500 g"},
      {nome:"Latte/pasta mandorla", dose:"500 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  { id:"G5", reparto:"gelateria", categoria:"Granite", nome:"Granita Mojito K2",
    note:"Base: Zucchero Invertito K2 · Contiene alcol",
    resa:"~4.350 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.000 g"},
      {nome:"Acqua", dose:"2.500 g"},
      {nome:"Succo limone", dose:"500 g"},
      {nome:"Rum", dose:"350 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  { id:"G6", reparto:"gelateria", categoria:"Granite", nome:"Granita Frutti di Bosco K2",
    note:"Base: Zucchero Invertito K2 · Gluten Free · Vegan",
    resa:"variabile", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.600 g"},
      {nome:"Acqua", dose:"2.300 g"},
      {nome:"Frutti di bosco", dose:"q.b."},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  { id:"G7", reparto:"gelateria", categoria:"Granite", nome:"Granita Vodka e Pesca K2",
    note:"Base: Zucchero Invertito K2 · Contiene alcol",
    resa:"~4.450 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.000 g"},
      {nome:"Acqua", dose:"1.200 g"},
      {nome:"Pesca", dose:"1.500 g"},
      {nome:"Vodka", dose:"750 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  { id:"G8", reparto:"gelateria", categoria:"Granite", nome:"Granita Agrumi K2",
    note:"Base: Zucchero Invertito K2 · Gluten Free · Vegan",
    resa:"~5.100 g", kcal:"", ingredienti:[
      {nome:"Zucchero Invertito K2", dose:"1.600 g"},
      {nome:"Acqua", dose:"2.300 g"},
      {nome:"Succo agrumi misti", dose:"1.200 g"},
    ],
    procedimento:"Unire tutti gli ingredienti, frullare, mantecare con programma granite.",
  },
  // ─── Gelati crema speciali (sezione X) ───────────────────────────────────────
  { id:"X1", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Menta K2",
    note:"Crema · Dose ~2,3 kg · Costo/kg €2,30 · Kcal 144 · T° -1°C",
    resa:"~2.300 g", kcal:"144", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Latte fresco intero", dose:"200 g"},
      {nome:"Menta concentrata", dose:"100 g"},
      {nome:"Olio essenziale menta piperita", dose:"5 g"},
    ],
    procedimento:"Mettere tutti gli ingredienti in una carapina e miscelare. Mantecare.",
  },
  { id:"X2", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato After Eight K2",
    note:"Crema menta + stracciatella · Dose ~2,4 kg · Costo/kg €2,67 · Kcal 156 · T° -1°C",
    resa:"~2.400 g", kcal:"156", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Latte fresco intero", dose:"200 g"},
      {nome:"Menta concentrata", dose:"100 g"},
      {nome:"Base Stracciatella K2", dose:"100 g", note:"variegatura"},
      {nome:"Olio essenziale menta piperita", dose:"5 g"},
    ],
    procedimento:"Mescolare base, latte e menta. Mantecare. A fine ciclo variegare con la base stracciatella.",
  },
  { id:"X4", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Monte Bianco K2",
    note:"Crema · Dose ~3,6 kg · Costo/kg €4,04 · Kcal 117 · T° -1°C · ⚠ Frutta a guscio",
    resa:"~3.600 g", kcal:"117", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Marron glacé", dose:"500 g"},
      {nome:"Latte intero 3,5%", dose:"800 g"},
      {nome:"Meringhe K2", dose:"300 g", note:"sbriciolate — aggiungere a fine mantecazione"},
    ],
    procedimento:"Mescolare base, marron glacé e latte. Mantecare. Aggiungere meringhe sbriciolate a fine ciclo.",
  },
  { id:"X5", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Tiramisù K2",
    note:"Crema · Dose ~3,5 kg · Costo/kg €2,44 · Kcal 159 · T° -1°C · ⚠ Uova",
    resa:"~3.500 g", kcal:"159", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"3.000 g"},
      {nome:"Salsa Zabajone K2", dose:"300 g"},
      {nome:"Base Pan di Spagna Tiramisù K2", dose:"200 g", note:"variegatura con caffè"},
    ],
    procedimento:"Mettere tutto in carapina e miscelare. Mantecare. Variegare con pan di spagna imbevuto al caffè.",
  },
  { id:"X6", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Meringata K2",
    note:"Crema · Dose ~3,15 kg · Costo/kg €1,96 · Kcal 172 · T° -1°C",
    resa:"~3.150 g", kcal:"172", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Latte intero", dose:"400 g"},
      {nome:"Panna 35%", dose:"400 g"},
      {nome:"Meringhe K2", dose:"350 g", note:"sbriciolate — aggiungere a fine mantecazione"},
    ],
    procedimento:"Mescolare base, latte e panna. Mantecare. Prima di estrarre aggiungere le meringhe sbriciolate.",
  },
  { id:"X7", reparto:"gelateria", categoria:"Gelati crema", nome:"Gelato Torrone K2",
    note:"Crema · Dose ~2,64 kg · Costo/kg €3,02 · Kcal 194 · T° -1°C · ⚠ Frutta a guscio",
    resa:"~2.640 g", kcal:"194", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"2.000 g"},
      {nome:"Latte concentrato intero", dose:"400 g"},
      {nome:"Torrone alla mandorla", dose:"240 g", note:"sbriciolato — aggiungere a fine mantecazione"},
    ],
    procedimento:"Mettere nel mantecatore base e latte concentrato. Mantecare. A fine ciclo aggiungere il torrone sbriciolato.",
  },
  // ─── SEZIONE H — SOFT SERVE ──────────────────────────────────────────────────
  { id:"H1", reparto:"gelateria", categoria:"Soft serve", nome:"Yogurt Soft K2",
    note:"Soft serve · Dose 1 kg (base) · Produzione 5 kg · Costo/kg €4,79 · Kcal 166 · Durata 5 giorni · ⚠ Latte",
    resa:"5.000 g", kcal:"166", ingredienti:[
      {nome:"Base Fiordilatte K2", dose:"1.000 g"},
      {nome:"Yogurt magro", dose:"1.000 g"},
      {nome:"Latte intero", dose:"600 g"},
      {nome:"Yogurt in polvere K2", dose:"100 g"},
      {nome:"Acido citrico", dose:"20 g"},
      {nome:"Zucchero invertito 70%", dose:"600 g"},
    ],
    procedimento:"Mettere tutti gli ingredienti in una carapina di plastica. Mixare il tutto, lasciare riposare e mettere nella macchina soft. Il rimanente etichettare. Durata 5 giorni.",
  },
  // ─── SEZIONE F + P + Q — PASTICCERIA ─────────────────────────────────────────
  { id:"F1", reparto:"pasticceria", categoria:"Basi pasticceria s.g.", nome:"Pan di Spagna S.G. K2",
    note:"Senza glutine · Dose 6 kg · Costo/kg €3,27-6,91 · Kcal 81",
    resa:"6.000 g", kcal:"81", ingredienti:[
      {nome:"Mix Stella Pan di Spagna e Rollé S.G.", dose:"500 g"},
      {nome:"Uovo fresco intero", dose:"600 g"},
    ],
    procedimento:"Inserire nella planetaria il mix e le uova. Azionare a velocità massima. Una volta montato, stendere e cuocere.",
  },
  { id:"F2", reparto:"pasticceria", categoria:"Basi pasticceria s.g.", nome:"Pan Rollé S.G. K2",
    note:"Senza glutine · Dose 6 kg · Costo/kg €5,00 · Kcal 152",
    resa:"6.000 g", kcal:"152", ingredienti:[
      {nome:"Mix Pan di Spagna e Rollé Stella S.G.", dose:"500 g"},
      {nome:"Uovo fresco intero", dose:"500 g"},
      {nome:"Acqua", dose:"100 g"},
    ],
    procedimento:"Inserire nella planetaria il mix, acqua e le uova. Azionare a velocità massima. Stendere in placca da forno in strato sottile. Infornare a 230°C per 5-6 min. Arrotolare ancora caldo.",
  },
  { id:"F3", reparto:"pasticceria", categoria:"Basi pasticceria s.g.", nome:"Pasta Frolla S.G. K2",
    note:"Senza glutine · Costo/kg €5,67 · Kcal 376 · ⚠ Latte, Uova",
    resa:"variabile", kcal:"376", ingredienti:[
      {nome:"Mix Pan di Spagna e Rollé Stella S.G.", dose:"500 g"},
      {nome:"Burro", dose:"250 g", note:"a temperatura ambiente"},
      {nome:"Uovo fresco intero", dose:"2 g"},
    ],
    procedimento:"Inserire nella planetaria il mix e il burro a temperatura ambiente. Lavorare con gancio finché amalgamato.",
  },
  { id:"F4", reparto:"pasticceria", categoria:"Basi pasticceria s.g.", nome:"Meringhe K2",
    note:"Senza glutine · Dose 6 kg · Costo/kg €0,57 · Kcal 282 · ⚠ Uova",
    resa:"6.000 g", kcal:"282", ingredienti:[
      {nome:"Zucchero", dose:"1.000 g"},
      {nome:"Albume d'uovo fresco", dose:"500 g"},
      {nome:"Sale", dose:"5 g"},
    ],
    procedimento:"Inserire nella planetaria tutti gli ingredienti e montare a neve ferma fino a quando si ottiene un composto lucido. Rivestire placche e cuocere in forno a bassa temperatura.",
  },
  { id:"F5", reparto:"pasticceria", categoria:"Basi pasticceria s.g.", nome:"Pasta di Mandorle K2",
    note:"Produzione interna · Dose ~2,3 kg · Costo/kg €13,81 · Kcal 479 · ⚠ Frutta a guscio",
    resa:"~2.300 g", kcal:"479", ingredienti:[
      {nome:"Mandorle", dose:"1.200 g"},
      {nome:"Zucchero", dose:"1.000 g"},
      {nome:"Acqua", dose:"120 g"},
      {nome:"Cannella", dose:"5 g"},
      {nome:"Vaniglia", dose:"5 g"},
      {nome:"Limone", dose:"20 g"},
    ],
    procedimento:"Lavorare le mandorle con zucchero e acqua finché si forma una pasta omogenea. Aggiungere aromi.",
  },
  { id:"P1", reparto:"pasticceria", categoria:"Ricette pasticceria", nome:"Mandorle Salate K2",
    note:"Produzione interna · Ingrediente per Mielata di Mandorle Salate ⭐ · ⚠ Frutta a guscio",
    resa:"~250 g (o 1,250 kg)", kcal:"", ingredienti:[
      {nome:"Mandorle pelate", dose:"200 g (o 1 kg)"},
      {nome:"Albume", dose:"1 (o 200 g per 1 kg)"},
      {nome:"Sale marino", dose:"q.b. abbondante (o 50 g per 1 kg)"},
    ],
    procedimento:"Forno ventilato a 180°C. Sbattere leggermente l'albume, versare le mandorle e mescolare bene. Distribuire su teglia con carta forno senza sovrapporle. Salare abbondantemente. Infornare 12-15 min finché colore dorato (non scuro). Raffreddare e separare.",
  },
  { id:"P2", reparto:"pasticceria", categoria:"Ricette pasticceria", nome:"Sablé Noire K2",
    note:"Biscotto con Domori 75% Rep. Dominicana · Gusto firma K2 ⭐ · ⚠ Glutine, Latte, Uova",
    resa:"~30 biscotti", kcal:"", ingredienti:[
      {nome:"Cioccolato fondente Dominicana 75% Domori", dose:"300 g"},
      {nome:"Farina debole", dose:"360 g"},
      {nome:"Cacao scuro 22-24%", dose:"60 g"},
      {nome:"Bicarbonato di sodio", dose:"10 g"},
      {nome:"Zucchero a velo", dose:"100 g"},
      {nome:"Sale himalayano", dose:"10 g"},
      {nome:"Vaniglia", dose:"q.b."},
      {nome:"Zucchero di canna", dose:"240 g"},
      {nome:"Burro", dose:"250 g", note:"morbido"},
    ],
    procedimento:"Miscelare burro morbido con zucchero a velo, zucchero di canna, sale e aromi. Setacciare le polveri e aggiungerle. Aggiungere il cioccolato fondente frullato. Dressare con bocchetta 12mm. Cuocere a 170°C VA per 12-14 min. Raffreddare e conservare a temperatura e umidità controllata.",
  },
  { id:"Q3", reparto:"pasticceria", categoria:"Ricette pasticceria", nome:"Panna Cotta K2",
    note:"Dessert classico · Per stampi o in vasetti · ⚠ Latte",
    resa:"~970 g", kcal:"", ingredienti:[
      {nome:"Latte intero", dose:"400 g"},
      {nome:"Panna 35%", dose:"400 g"},
      {nome:"Zucchero", dose:"140 g"},
      {nome:"Gelatina in fogli 220 bloom", dose:"12 g", note:"idratare in 48 g acqua"},
    ],
    procedimento:"Introdurre latte+panna+zucchero, riscaldare a 90°C. Introdurre gelatina idratata. Termostatare 1'. Raffreddare a 25°C. Estrarre negli stampi. Per panna cotta più densa usare fino a 22g/kg gelatina.",
  },
  { id:"Q7", reparto:"pasticceria", categoria:"Ricette pasticceria", nome:"Biscotti al Cocco K2",
    note:"~18 pezzi · 3 ingredienti · Per accompagnamento gelato o riuso albumi · ⚠ Uova",
    resa:"~360 g (18 pz)", kcal:"", ingredienti:[
      {nome:"Cocco rapé", dose:"150 g"},
      {nome:"Zucchero", dose:"120 g"},
      {nome:"Albumi", dose:"90 g (~3 albumi)"},
    ],
    procedimento:"Unire tutti gli ingredienti. Formare dei ciuffetti su carta forno. Cuocere a 180°C finché dorati in superficie. Ottimo riutilizzo albumi avanzati da crema/zabaione.",
  },
  { id:"Q8", reparto:"pasticceria", categoria:"Ricette pasticceria", nome:"Cheesecake ai Frutti di Bosco K2",
    note:"Per 12 persone · Tempo totale 6h · No cottura · ⚠ Latte, Glutine, Uova",
    resa:"1 torta ø22cm", kcal:"", ingredienti:[
      {nome:"Biscotti al cioccolato", dose:"180 g", note:"base"},
      {nome:"Burro fuso", dose:"100 g"},
      {nome:"Philadelphia classico", dose:"500 g"},
      {nome:"Panna fresca da montare", dose:"200 ml"},
      {nome:"Zucchero a velo", dose:"120 g"},
      {nome:"Colla di pesce", dose:"10 g"},
      {nome:"Bacello di vaniglia", dose:"1"},
      {nome:"Lamponi freschi", dose:"200 g", note:"copertura"},
      {nome:"Frutti di bosco misti", dose:"200 g", note:"decorazione"},
      {nome:"Limone", dose:"1", note:"facoltativo"},
    ],
    procedimento:"Frullare biscotti con burro fuso, stendere in tortiera 22cm, mettere in freezer. Sbattere Philadelphia con 50g zucchero a velo e vaniglia. Ammollare colla di pesce 10 min in acqua fredda, scioglierla in 2 cucchiai panna calda, raffreddare. Montare panna con restante zucchero, unire Philadelphia e colla di pesce. Stendere sulla base, coprire con frutti di bosco. Frigo minimo 4h.",
  },
  { id:"Q9", reparto:"pasticceria", categoria:"Ricette pasticceria", nome:"Zucchero a Velo fatto in Casa K2",
    note:"Produzione interna · Rapporto fisso: 3g amido per 100g zucchero",
    resa:"variabile", kcal:"", ingredienti:[
      {nome:"Zucchero semolato o di canna", dose:"400 g"},
      {nome:"Amido di mais (maizena)", dose:"12 g", note:"3% del peso zucchero"},
      {nome:"Vanillina", dose:"1/2 bustina", note:"facoltativo"},
    ],
    procedimento:"Inserire tutto in frullatore. Tritare 1 min alla massima potenza. Recuperare dai bordi, riprendere a velocità ridotta finché polvere fine. Conservare in vaso di vetro ben chiuso al riparo da luce e umidità.",
  },
  // Creme pasticcere (sezione O)
  { id:"O1", reparto:"pasticceria", categoria:"Creme pasticcere", nome:"Crema Bavarese K2",
    note:"Crema base neutra · da personalizzare con paste gelato · Ciclo Bavarese · ⚠ Latte, Uova",
    resa:"~1.130 g", kcal:"", ingredienti:[
      {nome:"Latte intero", dose:"450 g"},
      {nome:"Zucchero", dose:"450 g"},
      {nome:"Tuorlo", dose:"100 g"},
      {nome:"Gelatina in fogli", dose:"30 g", note:"idratare in 120g acqua fredda"},
    ],
    procedimento:"Introdurre tuorli+zucchero, agitare 3'. Aggiungere latte, riscaldare a 82°C. Aggiungere gelatina. Raffreddare a 25°C. Unire 1 kg crema bavarese a 1 kg panna montata + gusto.",
  },
  { id:"O2", reparto:"pasticceria", categoria:"Creme pasticcere", nome:"Crema Excellent K2",
    note:"Crema pasticcera pastorizzata con amido di riso · Per pasticceria mignon · ⚠ Latte, Uova",
    resa:"~1.000 g", kcal:"", ingredienti:[
      {nome:"Latte intero", dose:"600 g"},
      {nome:"Zucchero", dose:"150 g"},
      {nome:"Tuorlo", dose:"140 g"},
      {nome:"Amido di riso", dose:"60 g"},
      {nome:"Panna 35%", dose:"50 g"},
    ],
    procedimento:"Introdurre tuorli+zucchero, riscaldare a 40°C. Aggiungere amido+latte, riscaldare a 85°C. Aggiungere panna. Raffreddare a 25°C poi a 4°C. Estrarre.",
  },
  { id:"O3", reparto:"pasticceria", categoria:"Creme pasticcere", nome:"Crema Speed K2",
    note:"Crema classica · Per bignè, tartellette, cannoli, torte · Ciclo Speed · ⚠ Latte, Uova",
    resa:"~1.000 g", kcal:"", ingredienti:[
      {nome:"Latte intero", dose:"630 g"},
      {nome:"Zucchero", dose:"170 g"},
      {nome:"Tuorlo", dose:"90 g"},
      {nome:"Panna", dose:"50 g"},
      {nome:"Amido di mais", dose:"60 g"},
    ],
    procedimento:"Introdurre tuorli+zucchero, agitare 3'. Aggiungere amido+latte, riscaldare a 85°C, mantenere 1'. Raffreddare a 80°C, aggiungere panna. Raffreddare a 15°C poi a 4°C.",
  },
  { id:"O4", reparto:"pasticceria", categoria:"Creme pasticcere", nome:"Crema Zabaione K2",
    note:"Zabaione pastorizzato · Per torte, semifreddi, con biscotti e amaretti · ⚠ Uova",
    resa:"~1.000 g", kcal:"", ingredienti:[
      {nome:"Marsala", dose:"650 g"},
      {nome:"Zucchero", dose:"150 g"},
      {nome:"Tuorlo", dose:"130 g"},
      {nome:"Amido di mais", dose:"60 g"},
      {nome:"Gelatina in fogli", dose:"10 g", note:"idratare in 40g acqua"},
    ],
    procedimento:"Tuorli+zucchero, agitare 3'. Aggiungere amido+marsala, riscaldare a 83°C. Aggiungere gelatina idratata. Raffreddare a 60°C poi a 15°C poi a 4°C. Estrarre.",
  },
  { id:"O5", reparto:"pasticceria", categoria:"Creme pasticcere", nome:"Crema Spalmabile K2",
    note:"Crema spalmabile tipo Nutella · ⚠ Latte, Soia, Frutta a guscio",
    resa:"~1.000 g", kcal:"", ingredienti:[
      {nome:"Cioccolato fondente 65%", dose:"95 g"},
      {nome:"Cioccolato al latte 33%", dose:"400 g"},
      {nome:"Pasta gelato grassa (nocciola/pistacchio)", dose:"455 g"},
      {nome:"Olio (riso/soia/oliva)", dose:"50 g"},
    ],
    procedimento:"Ciclo asciugatura prima. Introdurre cioccolata+pasta gel, riscaldare a 45°C. Aggiungere olio. Termostatare 7'. Aggiungere pasta gelato. Raffreddare a 26°C. Estrarre.",
  },
  // Salse speciali
  { id:"Y1", reparto:"pasticceria", categoria:"Creme pasticcere", nome:"Salsa Panna Cotta K2",
    note:"Dose ~4,6 kg · Costo/kg €3,58 · Kcal 383 · T° -11°C · ⚠ Latte",
    resa:"~4.600 g", kcal:"383", ingredienti:[
      {nome:"Panna liquida 37%", dose:"2.000 g"},
      {nome:"Base Latte condensato K2", dose:"1.000 g"},
      {nome:"Zucchero", dose:"1.000 g"},
      {nome:"Caffè espresso", dose:"20 g"},
      {nome:"Vaniglia", dose:"50 g"},
      {nome:"Glucosio disidratato", dose:"500 g"},
      {nome:"Neutro creme GNA 15g", dose:"30 g"},
    ],
    procedimento:"Miscelare tutti gli ingredienti e cuocere. Raffreddare e conservare.",
  },
];

// ─── LISTA INGREDIENTI COMPLETA K2 ───────────────────────────────────────────
// Per visualizzazione separata "Lista Ingredienti" nel ricettario

const K2_LISTA_INGREDIENTI_GELATERIA = [
  "Acqua osmotica microfiltrata","Acido ascorbico","Acido citrico","Acido lattico",
  "Aroma cocco","Amaro Camatti","Bicarbonato di sodio","Birra doppio malto",
  "Caramello (produzione interna)","Cioccolato fondente 70%","Cioccolato monorigine Dominicana 75% ICAM",
  "Cocco secco rapé","Corbezzolo bacche fresche (stagionale ott-nov)",
  "Destrosio","Fragole fresche","Frutti di bosco","Glucosio disidratato",
  "Glucosio liquido","Latte concentrato intero","Latte fresco intero 3,5% (di montagna)",
  "Latte in polvere scremato","Liquirizia","Maraschino","Marsala",
  "Massa di cacao","Mele","Menta concentrata","Miele","Nocciole (frutta a guscio)",
  "Neutro frutta GNA","Neutro creme GNA","Olio essenziale menta piperita",
  "Pasta di nocciola 100%","Pasta di pistacchio 100%","Panna fresca 35% (di montagna)",
  "Pistacchi (frutta a guscio)","Rum","Sale marino","Saccarosio",
  "Uova fresche intere","Uva passa","Vaniglia","Vodka","Yogurt magro",
  "Zenzero","Zucchero di canna","Zucchero invertito 70% (produzione interna)",
];

const K2_LISTA_INGREDIENTI_PASTICCERIA = [
  "Acido citrico","Albume d'uovo fresco","Amido di mais (maizena)","Amido di riso",
  "Burro","Caffè espresso","Cannella","Cacao scuro 22-24%","Cioccolato al latte 33%",
  "Cioccolato fondente 65%","Cioccolato fondente Dominicana 75% Domori","Colla di pesce",
  "Cream cheese (Philadelphia)","Farina debole","Frutti di bosco misti",
  "Gelatina in fogli 220 bloom","Glucosio disidratato","Lamponi freschi",
  "Latte intero","Limone","Mandorle pelate","Marsala","Mascarpone fresco",
  "Mix Stella Pan di Spagna e Rollé S.G.","Nocciole tostate (frutta a guscio)",
  "Olio di riso/soia/oliva","Panna fresca 35%","Pasta gelato grassa nocciola/pistacchio",
  "Rum","Sale himalayano","Tuorlo d'uovo fresco","Uovo fresco intero","Vaniglia/vanillina",
  "Zucchero a velo","Zucchero di canna","Zucchero semolato",
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE RICETTARIO
// ═══════════════════════════════════════════════════════════════════════════════
const RICETTARIO_CATS_GEL = ["Tutti","Basi interne","Gelati crema","Gelati frutta e vegan","Salse e variegati","Semifreddi","Granite","Soft serve"];
const RICETTARIO_CATS_PAS = ["Tutti","Basi pasticceria s.g.","Ricette pasticceria","Creme pasticcere"];
const RICETTARIO_STY = {
  tab: (active) => ({
    padding:"8px 18px", fontSize:13, cursor:"pointer", border:"none",
    background:"transparent", fontFamily:"inherit",
    color: active ? "#c8a96e" : "var(--k2-text-dim)",
    borderBottom: active ? "2px solid #c8a96e" : "2px solid transparent",
    fontWeight: active ? "bold" : "normal", transition:"all 0.15s",
  }),
  catBtn: (active) => ({
    padding:"4px 12px", fontSize:11, cursor:"pointer", borderRadius:14,
    border:`1px solid ${active ? "#c8a96e66" : "var(--k2-border)"}`,
    background: active ? "#c8a96e22" : "var(--k2-bg-card)",
    color: active ? "#c8a96e" : "var(--k2-text-dim)",
    fontFamily:"inherit", fontWeight: active ? "bold" : "normal", transition:"all 0.15s",
  }),
  card: {
    background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)",
    borderRadius:10, padding:"14px 16px", cursor:"pointer",
    transition:"border-color 0.15s",
  },
  overlay: {
    position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:500,
    display:"flex", alignItems:"center", justifyContent:"center", padding:16,
  },
  box: (w=620) => ({
    background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)",
    borderRadius:12, width:"100%", maxWidth:w, maxHeight:"92vh",
    overflowY:"auto", padding:24,
  }),
};
const RICETTARIO_CAT_COLORS = {
  "Basi interne":"#f59e0b","Gelati crema":"#c8a96e","Gelati frutta e vegan":"#4ade80",
  "Salse e variegati":"#a78bfa","Semifreddi":"#60a5fa","Granite":"#34d399",
  "Soft serve":"#fb7185","Basi pasticceria s.g.":"#fbbf24",
  "Ricette pasticceria":"#e879f9","Creme pasticcere":"#f472b6",
};

function CatBadge({ cat }) {
  const c = RICETTARIO_CAT_COLORS[cat] || "#c8a96e";
  return <span style={{ fontSize:9, padding:"2px 7px", borderRadius:8, background:`${c}22`, color:c, border:`1px solid ${c}44`, fontWeight:"bold", textTransform:"uppercase", letterSpacing:"0.06em" }}>{cat}</span>;
}

function CardRicetta({ r, findLinkedRecipe, setRicSel }) {
  const [hov, setHov] = useState(false);
  const linked = findLinkedRecipe(r.nome);
  const isSig  = r.note?.includes("⭐");
  return (
    <div
      style={{ ...RICETTARIO_STY.card, ...(hov ? {borderColor:"#c8a96e66"} : {}),
        borderLeft: isSig ? "3px solid #c8a96e" : undefined }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => setRicSel(r)}
    >
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
        <div style={{ fontSize:13, fontWeight:"bold", flex:1, paddingRight:8, lineHeight:1.3 }}>
          {r.nome.replace("⭐","").trim()}
          {isSig && <span style={{ marginLeft:5, fontSize:10 }}>⭐</span>}
        </div>
        <CatBadge cat={r.categoria}/>
      </div>
      {r.note && <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginBottom:8, lineHeight:1.4 }}>{r.note.replace("⭐","").trim()}</div>}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop:4, justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:10 }}>
          {r.resa && r.resa !== "variabile" && <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>⚖️ {r.resa}</span>}
          {r.kcal && <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>🔥 {r.kcal}</span>}
          <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>🧪 {r.ingredienti.length}</span>
        </div>
        {linked && (
          <span style={{ fontSize:9, background:"#4ade8022", color:"#4ade80", border:"1px solid #4ade8044", borderRadius:8, padding:"2px 7px" }}>
            ✓ In FoodCost
          </span>
        )}
        {r._linkedIngredients && r._linkedIngredients.filter(l=>l.confidenceLabel==="high").length > 0 && !linked && (
          <span style={{ fontSize:9, background:"#60a5fa22", color:"#60a5fa", border:"1px solid #60a5fa44", borderRadius:8, padding:"2px 7px" }}>
            🔗 {r._linkedIngredients.filter(l=>l.confidenceLabel==="high").length} ingr.
          </span>
        )}
      </div>
    </div>
  );
}

function RigaLista({ r, findLinkedRecipe, setRicSel }) {
  const [hov, setHov] = useState(false);
  const linked = findLinkedRecipe(r.nome);
  return (
    <div
      style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", gap:12, alignItems:"start",
        padding:"10px 14px", background:"var(--k2-bg-card)", border:`1px solid ${hov?"#c8a96e44":"var(--k2-border)"}`,
        borderRadius:8, cursor:"pointer", transition:"border-color 0.15s" }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => setRicSel(r)}
    >
      <div style={{ fontSize:10, color:"var(--k2-text-dim)", fontFamily:"monospace", paddingTop:2 }}>{r.id}</div>
      <div>
        <div style={{ fontSize:13, fontWeight:"bold" }}>{r.nome.replace("⭐","").trim()}</div>
        {r.note && <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:2 }}>{r.note.replace("⭐","").trim()}</div>}
      </div>
      <div style={{ textAlign:"right", display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
        <CatBadge cat={r.categoria}/>
        {linked && <span style={{ fontSize:9, background:"#4ade8022", color:"#4ade80", border:"1px solid #4ade8044", borderRadius:8, padding:"2px 6px" }}>✓ FC</span>}
      </div>
    </div>
  );
}

function DettaglioRicetta({ r, onClose, findLinkedRecipe, setModalGusto, onGoTo }) {
  const linked = findLinkedRecipe(r.nome);
  React.useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Calcola food cost se collegata — usa calcCostMPDetailed
  const fcDetailed = linked ? calcCostMPDetailed(linked, ingredients) : null;
  const fcCosto = fcDetailed?.cost ?? null;
  const fcPerKg = (linked && linked.yield_g > 0 && fcCosto !== null) ? (fcCosto / linked.yield_g * 1000) : null;
  const fcMissing = fcDetailed?.missingIngredientIds || [];

  const recipeShareText = [
    `*${r.nome.replace(/⭐/g,"").trim()}*`,
    r.categoria ? `Categoria: ${r.categoria}` : null,
    r.resa ? `Resa: ${r.resa}` : null,
    r.kcal ? `Kcal: ${r.kcal}/100g` : null,
    "",
    "Ingredienti:",
    ...(r.ingredienti || []).map(i => `• ${i.nome}${i.dose ? ` — ${i.dose}` : ""}${i.note ? ` (${i.note})` : ""}`),
    r.procedimento ? `\nProcedimento: ${r.procedimento}` : null,
    linked ? `\nFood cost collegato: ${linked.name}${fcCosto !== null ? ` · ${fmtE(fcCosto)}` : ""}` : null,
  ].filter(Boolean).join("\n");

  function exportRecipePrintableFile() {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${r.nome}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#1a1508}h1{margin:0 0 4px;color:#8b6b2a}.muted{color:#6b7280;font-size:12px}ul{padding-left:18px}li{margin:4px 0}</style></head><body><h1>${r.nome.replace(/⭐/g,'').trim()}</h1><div class="muted">${r.categoria || ''}${r.resa ? ` · ${r.resa}` : ''}${r.kcal ? ` · ${r.kcal}/100g` : ''}</div><h3>Ingredienti</h3><ul>${(r.ingredienti || []).map(i => `<li>${i.nome}${i.dose ? ` — ${i.dose}` : ''}${i.note ? ` (${i.note})` : ''}</li>`).join('')}</ul>${r.procedimento ? `<h3>Procedimento</h3><p>${r.procedimento}</p>` : ''}</body></html>`;
    const ok = downloadTextFile(`ricetta-${String(r.nome || 'k2').toLowerCase().replace(/[^a-z0-9]+/gi,'-')}.html`, html, 'text/html;charset=utf-8');
    if (!ok) openPrintWindow(html, r.nome || 'Ricetta');
  }

  async function handleShareRecipe() {
    try {
      if (navigator.share) {
        await navigator.share({ title: r.nome, text: recipeShareText });
        return;
      }
    } catch (_) {}
    await copyTextToClipboard(recipeShareText);
    window.alert('Testo ricetta copiato. Puoi incollarlo su WhatsApp o altrove.');
  }

  function handleShareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(recipeShareText)}`;
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
  }

  return (
    <div style={RICETTARIO_STY.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={RICETTARIO_STY.box(640)}>
        {/* Header */}
        <div style={{ borderBottom:"1px solid var(--k2-border)", paddingBottom:14, marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:8, color:"#c8a96e", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:4 }}>
                GELATERIA K2 · {r.reparto.toUpperCase()}
              </div>
              <h2 style={{ margin:"0 0 6px", fontSize:20, color:"#c8a96e", fontWeight:"bold" }}>
                {r.nome.replace("⭐","").trim()}
              </h2>
              <CatBadge cat={r.categoria}/>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--k2-text-dim)", cursor:"pointer", fontSize:20 }}>✕</button>
          </div>
          {r.note && <div style={{ fontSize:11, color:"var(--k2-text-muted)", marginTop:10, lineHeight:1.5 }}>{r.note.replace("⭐","").trim()}</div>}
          <div style={{ display:"flex", gap:14, marginTop:10, flexWrap:"wrap", alignItems:"center" }}>
            {r.resa && <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}><strong>Resa:</strong> {r.resa}</span>}
            {r.kcal && <span style={{ fontSize:11, color:"var(--k2-text-dim)" }}><strong>Kcal:</strong> {r.kcal}/100g</span>}
            <span style={{ fontSize:11, color:"var(--k2-text-dim)", fontFamily:"monospace" }}>Cod. {r.id}</span>
          </div>
        </div>

        {/* Stato collegamento ingredienti */}
        {(() => {
          if (!r._linkedIngredients) return null;
          const total = r._linkedIngredients.length;
          const high = r._linkedIngredients.filter(l=>l.confidenceLabel==="high").length;
          const med  = r._linkedIngredients.filter(l=>l.confidenceLabel==="medium").length;
          const none = r._linkedIngredients.filter(l=>l.confidenceLabel==="none").length;
          return (
            <div style={{ background:"rgba(96,165,250,0.07)", border:"1px solid #60a5fa33", borderRadius:8, padding:"8px 14px", marginBottom:10, display:"flex", gap:14, flexWrap:"wrap", alignItems:"center" }}>
              <div style={{ fontSize:10, color:"#60a5fa", letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:"bold" }}>🔗 Ingredienti collegati</div>
              <span style={{ fontSize:11, color:"#4ade80" }}>✓ {high} confermati</span>
              {med>0 && <span style={{ fontSize:11, color:"#fbbf24" }}>⚠ {med} da verificare</span>}
              {none>0 && <span style={{ fontSize:11, color:"#f87171" }}>✗ {none} non trovati</span>}
              <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>{total} ingredienti totali</span>
            </div>
          );
        })()}
        {/* Collegamento FoodCost */}
        {linked ? (
          <div style={{ background:"rgba(74,222,128,0.07)", border:"1px solid #4ade8033", borderRadius:8, padding:"10px 14px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div>
              <div style={{ fontSize:10, color:"#4ade80", letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:"bold" }}>✓ Collegata a FoodCost</div>
              <div style={{ fontSize:12, color:"var(--k2-text-muted)", marginTop:2 }}>
                Ricetta: <strong>{linked.name}</strong>
                {fcCosto !== null && <span style={{ marginLeft:10 }}>Costo MP: <strong style={{ color:"#c8a96e" }}>{fmtE(fcCosto)}</strong></span>}
                {fcPerKg !== null && <span style={{ marginLeft:10 }}>→ <strong style={{ color:"#c8a96e" }}>{fmtE(fcPerKg)}/kg</strong></span>}
                {fcMissing.length > 0 && <span style={{ marginLeft:10, color:"#fbbf24", fontSize:11 }}>⚠ {fcMissing.length} ingr. mancanti (FC sottostimato)</span>}
              </div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => { onGoTo && onGoTo("foodcost"); onClose(); }}
                style={{ padding:"5px 12px", fontSize:11, background:"#4ade8022", border:"1px solid #4ade8044", borderRadius:6, color:"#4ade80", cursor:"pointer", fontFamily:"inherit" }}>
                🌾 Food Cost
              </button>
              <button onClick={() => { onGoTo && onGoTo("etichette"); onClose(); }}
                style={{ padding:"5px 12px", fontSize:11, background:"#c8a96e22", border:"1px solid #c8a96e44", borderRadius:6, color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>
                🏷️ Etichetta
              </button>
              <button onClick={() => { onGoTo && onGoTo("listino"); onClose(); }}
                style={{ padding:"5px 12px", fontSize:11, background:"#60a5fa22", border:"1px solid #60a5fa44", borderRadius:6, color:"#60a5fa", cursor:"pointer", fontFamily:"inherit" }}>
                🍦 Listino
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background:"rgba(251,191,36,0.07)", border:"1px solid #fbbf2433", borderRadius:8, padding:"10px 14px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div>
              <div style={{ fontSize:10, color:"#fbbf24", letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:"bold" }}>⚠ Non collegata al FoodCost</div>
              <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:2 }}>Aggiungi questa ricetta in FoodCost per calcolare costi e margini.</div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <button onClick={() => { onGoTo && onGoTo("foodcost"); onClose(); }}
                style={{ padding:"5px 12px", fontSize:11, background:"#fbbf2422", border:"1px solid #fbbf2444", borderRadius:6, color:"#fbbf24", cursor:"pointer", fontFamily:"inherit" }}>
                🌾 Vai a FoodCost per aggiungerla
              </button>
              <button onClick={() => { setRicSel(null); setModalGusto(r); }}
                style={{ padding:"5px 12px", fontSize:11, background:"#c8a96e22", border:"1px solid #c8a96e44", borderRadius:6, color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>
                ✏️ Modifica ricetta
              </button>
            </div>
          </div>
        )}

        {/* Ingredienti */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#c8a96e", letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:"bold", marginBottom:10 }}>
            🧪 Ingredienti ({r.ingredienti.length})
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:"1px solid var(--k2-border)" }}>
                <th style={{ textAlign:"left", padding:"4px 8px 6px 0", color:"var(--k2-text-dim)", fontWeight:"normal", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em" }}>Ingrediente</th>
                <th style={{ textAlign:"right", padding:"4px 0 6px 8px", color:"var(--k2-text-dim)", fontWeight:"normal", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em" }}>Dose</th>
                <th style={{ textAlign:"left", padding:"4px 0 6px 8px", color:"var(--k2-text-dim)", fontWeight:"normal", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em" }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {r.ingredienti.map((ing, idx) => {
                // Usa autoLink se disponibile, altrimenti fallback su ricerca per nome
                const linked = r._linkedIngredients?.[idx];
                const ingApp = linked?.ingredientId
                  ? ingredients.find(i => i.id === linked.ingredientId)
                  : ingredients.find(i => i.name?.toLowerCase().includes(ing.nome.toLowerCase().split(" ")[0]));
                const conf = linked?.confidenceLabel;
                const confColor = conf==="high"?"#4ade80":conf==="medium"?"#fbbf24":null;
                const confIcon  = conf==="high"?"✓":conf==="medium"?"≈":null;
                return (
                  <tr key={idx} style={{ borderBottom:"1px solid var(--k2-border)22" }}>
                    <td style={{ padding:"6px 8px 6px 0", fontSize:12, color:"var(--k2-text)" }}>
                      {ing.nome}
                      {confIcon && <span style={{ marginLeft:6, fontSize:9, color:confColor, background:confColor+"11", borderRadius:6, padding:"1px 5px" }}>{confIcon} {ingApp?.name||""}</span>}
                    </td>
                    <td style={{ padding:"6px 0 6px 8px", textAlign:"right", fontSize:12, color:"#c8a96e", fontFamily:"monospace", whiteSpace:"nowrap", fontWeight:"bold" }}>{ing.dose}</td>
                    <td style={{ padding:"6px 0 6px 8px", fontSize:10, color:"var(--k2-text-dim)", fontStyle:"italic" }}>{ing.note||""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Procedimento */}
        {r.procedimento && (
          <div style={{ background:"var(--k2-bg)", border:"1px solid var(--k2-border)", borderRadius:8, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ fontSize:10, color:"#c8a96e", letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:"bold", marginBottom:8 }}>📋 Procedimento</div>
            <div style={{ fontSize:12, color:"var(--k2-text-muted)", lineHeight:1.7 }}>{r.procedimento}</div>
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button onClick={() => { setRicSel(null); setModalGusto(r); }}
              style={{ padding:"7px 16px", background:"#c8a96e22", border:"1px solid #c8a96e44", borderRadius:6, color:"#c8a96e", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
              ✏️ Modifica ricetta
            </button>
            <button onClick={exportRecipePrintableFile}
              style={{ padding:"7px 16px", background:"#60a5fa22", border:"1px solid #60a5fa44", borderRadius:6, color:"#60a5fa", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
              🖨️/📄 Stampa
            </button>
            <button onClick={handleShareRecipe}
              style={{ padding:"7px 16px", background:"#4ade8022", border:"1px solid #4ade8044", borderRadius:6, color:"#4ade80", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
              📤 Condividi
            </button>
            <button onClick={handleShareWhatsApp}
              style={{ padding:"7px 16px", background:"#25D36622", border:"1px solid #25D36644", borderRadius:6, color:"#25D366", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
              WhatsApp
            </button>
          </div>
          <button onClick={onClose}
            style={{ padding:"7px 20px", background:"transparent", border:"1px solid var(--k2-border)", borderRadius:6, color:"var(--k2-text-dim)", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalGusto({ ricetta, onClose, setRecipes, ingredients, setListino, reparto }) {
  const isNew = !ricetta || ricetta === "new";
  const CATS_ALL = [...RICETTARIO_CATS_GEL.filter(c=>c!=="Tutti"), ...RICETTARIO_CATS_PAS.filter(c=>c!=="Tutti")];
  const [form, setForm] = useState(() => isNew ? {
    id: `Z${Date.now()}`, reparto:"gelateria", categoria:"Gelati crema",
    nome:"", note:"", resa:"", kcal:"", procedimento:"",
    ingredienti:[{nome:"",dose:"",note:""}],
  } : {
    ...ricetta,
    ingredienti: ricetta.ingredienti.map(i => ({...i})),
  });

  function setField(k, v) { setForm(f => ({...f, [k]:v})); }
  function setIng(idx, k, v) {
    setForm(f => { const ings = [...f.ingredienti]; ings[idx] = {...ings[idx],[k]:v}; return {...f,ingredienti:ings}; });
  }
  function addIng()    { setForm(f => ({...f, ingredienti:[...f.ingredienti,{nome:"",dose:"",note:""}]})); }
  function removeIng(idx) { setForm(f => ({...f, ingredienti:f.ingredienti.filter((_,i)=>i!==idx)})); }
  function moveIng(idx, dir) {
    setForm(f => {
      const ings = [...f.ingredienti];
      const to = idx + dir;
      if (to < 0 || to >= ings.length) return f;
      [ings[idx], ings[to]] = [ings[to], ings[idx]];
      return {...f, ingredienti:ings};
    });
  }

  function handleSave() {
    if (!form.nome.trim()) { alert("Inserisci il nome del gusto."); return; }
    if (form.ingredienti.filter(i=>i.nome.trim()).length === 0) { alert("Aggiungi almeno un ingrediente."); return; }
    const clean = { ...form, ingredienti: form.ingredienti.filter(i=>i.nome.trim()) };

    // 1. Aggiorna K2_RICETTARIO (vista Ricettario)
    if (isNew) {
      K2_RICETTARIO.push(clean);
    } else {
      const idx = K2_RICETTARIO.findIndex(r => r.id === ricetta.id);
      if (idx !== -1) K2_RICETTARIO[idx] = clean;
    }

    // 2. Salva in recipes (FoodCost, Produzione, Etichette, Listino)
    if (typeof setRecipes === "function") {
      // Stima yield_g dal campo resa testuale
      const resaStr = String(clean.resa || "").replace(/[^0-9]/g,"").replace(/[^0-9]/g,"");
      const yieldG = resaStr ? Math.min(50000, parseInt(resaStr)) || 3000 : 3000;
      // Costruisci array ingredienti app linkati con autoLink
      const linkedIngs = (ingredients && ingredients.length > 0)
        ? autoLinkRecipeIngredients(clean.ingredienti, ingredients)
            .filter(li => li.confidenceLabel === "high" && li.ingredientId !== null)
            .map(li => {
              const doseStr = String(li.dose||"").replace(/\./g,"").replace(/[^0-9]/g,"");
              const q = doseStr ? Math.min(50000, parseInt(doseStr)) : 0;
              return q > 0 ? { id: li.ingredientId, q } : null;
            })
            .filter(Boolean)
        : [];

      const repartoId = clean.reparto === "pasticceria" ? "pasticceria" : "gelateria";
      const catMapped = CAT_MAP_K2[clean.categoria] || clean.categoria;

      if (isNew) {
        // Controlla se esiste già in recipes con lo stesso nome
        const existingId = `k2user_${clean.id}`;
        const newRec = normalizeRecipe({
          id: existingId,
          name: clean.nome.replace(/⭐/g,"").trim(),
          category: catMapped,
          yield_g: yieldG,
          notes: (clean.note||"").replace(/⭐/g,"").trim(),
          ingredients: linkedIngs,
          repartoId,
          labelNeedsReview: true,
        });
        setRecipes(prev => {
          // evita duplicati per nome
          if (prev.some(r => r.name?.toLowerCase().trim() === newRec.name.toLowerCase().trim())) return prev;
          return [...prev, newRec];
        });
        // 3. Aggiorna listino — aggiunge il gusto come disponibile in entrambe le sedi
        if (typeof setListino === "function") {
          setListino(prev => {
            const next = { ...prev };
            SEDI.forEach(sede => {
              const list = next[sede] || [];
              if (!list.some(g => String(g.id) === existingId)) {
                next[sede] = [...list, { id: existingId, nome: newRec.name, disponibile: false }];
              }
            });
            return next;
          });
        }
      } else {
        // Modifica: aggiorna la ricetta app corrispondente (per id k2user_ o per nome)
        setRecipes(prev => prev.map(r => {
          const matchById  = r.id === `k2user_${ricetta.id}`;
          const matchNome  = r.name?.toLowerCase().trim() === (ricetta.nome||"").replace(/⭐/g,"").trim().toLowerCase();
          if (!matchById && !matchNome) return r;
          return normalizeRecipe({
            ...r,
            name: clean.nome.replace(/⭐/g,"").trim(),
            category: catMapped,
            yield_g: yieldG,
            notes: (clean.note||"").replace(/⭐/g,"").trim(),
            ingredients: linkedIngs.length > 0 ? linkedIngs : r.ingredients,
            repartoId,
            labelNeedsReview: true,
            lastModifiedAt: new Date().toISOString(),
          });
        }));
      }
    }

    onClose();
    setRicSel(null);
  }

  const inp2 = { padding:"6px 10px", borderRadius:6, border:"1px solid var(--k2-border)", background:"var(--k2-bg)", color:"var(--k2-text)", fontFamily:"inherit", fontSize:12, width:"100%", boxSizing:"border-box" };
  const lbl2 = { fontSize:10, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", display:"block", marginBottom:4 };

  return (
    <div style={RICETTARIO_STY.overlay} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={RICETTARIO_STY.box(660)}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:16, color:"#c8a96e" }}>{isNew ? "➕ Nuovo gusto" : `✏️ Modifica — ${ricetta.nome}`}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--k2-text-dim)", cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        {/* Info base */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={lbl2}>Nome gusto *</label>
            <input style={inp2} value={form.nome} onChange={e=>setField("nome",e.target.value)} placeholder="es. Gelato Corbezzolo K2"/>
          </div>
          <div>
            <label style={lbl2}>Reparto</label>
            <select style={inp2} value={form.reparto} onChange={e=>setField("reparto",e.target.value)}>
              <option value="gelateria">🍦 Gelateria</option>
              <option value="pasticceria">🎂 Pasticceria</option>
            </select>
          </div>
          <div>
            <label style={lbl2}>Categoria</label>
            <select style={inp2} value={form.categoria} onChange={e=>setField("categoria",e.target.value)}>
              {CATS_ALL.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl2}>Resa / Dose</label>
            <input style={inp2} value={form.resa} onChange={e=>setField("resa",e.target.value)} placeholder="es. 3.000 g"/>
          </div>
          <div>
            <label style={lbl2}>Kcal / 100g</label>
            <input style={inp2} value={form.kcal} onChange={e=>setField("kcal",e.target.value)} placeholder="es. 172"/>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={lbl2}>Note / descrizione</label>
            <input style={inp2} value={form.note} onChange={e=>setField("note",e.target.value)} placeholder="es. Crema bianca · T° vetrina -11°C"/>
          </div>
        </div>

        {/* Ingredienti */}
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <label style={{ ...lbl2, marginBottom:0 }}>Ingredienti *</label>
            <button onClick={addIng} style={{ padding:"3px 10px", fontSize:11, background:"#c8a96e22", border:"1px solid #c8a96e44", borderRadius:6, color:"#c8a96e", cursor:"pointer", fontFamily:"inherit" }}>+ Aggiungi</button>
          </div>
          <div style={{ display:"grid", gap:6 }}>
            {form.ingredienti.map((ing, idx) => (
              <div key={idx} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1.5fr auto", gap:6, alignItems:"center" }}>
                <input style={inp2} value={ing.nome} onChange={e=>setIng(idx,"nome",e.target.value)} placeholder="Nome ingrediente"/>
                <input style={inp2} value={ing.dose} onChange={e=>setIng(idx,"dose",e.target.value)} placeholder="Dose"/>
                <input style={inp2} value={ing.note||""} onChange={e=>setIng(idx,"note",e.target.value)} placeholder="Note (opz.)"/>
                <div style={{ display:"flex", gap:3 }}>
                  <button onClick={()=>moveIng(idx,-1)} style={{ ...inp2, width:24, padding:"2px", textAlign:"center", cursor:"pointer" }}>↑</button>
                  <button onClick={()=>moveIng(idx,1)}  style={{ ...inp2, width:24, padding:"2px", textAlign:"center", cursor:"pointer" }}>↓</button>
                  <button onClick={()=>removeIng(idx)}  style={{ ...inp2, width:24, padding:"2px", textAlign:"center", cursor:"pointer", color:"#f87171" }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Procedimento */}
        <div style={{ marginBottom:16 }}>
          <label style={lbl2}>Procedimento</label>
          <textarea style={{ ...inp2, minHeight:80, resize:"vertical" }} value={form.procedimento} onChange={e=>setField("procedimento",e.target.value)} placeholder="Descrivi il procedimento di produzione…"/>
        </div>

        <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
          <button onClick={onClose} style={{ padding:"8px 20px", background:"transparent", border:"1px solid var(--k2-border)", borderRadius:6, color:"var(--k2-text-dim)", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>Annulla</button>
          <button onClick={handleSave} style={{ padding:"8px 24px", background:"#c8a96e", border:"none", borderRadius:6, color:"var(--k2-bg)", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:"bold" }}>
            {isNew ? "➕ Aggiungi gusto" : "💾 Salva modifiche"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalIngrediente({ ingApp, onClose }) {
  const [form, setForm] = useState(() => ({ ...ingApp }));

  function setF(k, v) { setForm(f => ({...f, [k]:v})); }
  function toggleAllergen(a) {
    setForm(f => {
      const cur = f.allergens || [];
      return { ...f, allergens: cur.includes(a) ? cur.filter(x=>x!==a) : [...cur, a] };
    });
  }

  function handleSave() {
    if (!form.name?.trim()) { alert("Nome obbligatorio"); return; }
    const normalized = normalizeIngredient(form);
    setIngredients(prev => prev.map(i => i.id === ingApp.id ? normalized : i));
    onClose();
  }

  const inp2 = { padding:"6px 10px", borderRadius:6, border:"1px solid var(--k2-border)", background:"var(--k2-bg)", color:"var(--k2-text)", fontFamily:"inherit", fontSize:12, width:"100%", boxSizing:"border-box" };
  const lbl2 = { fontSize:10, color:"var(--k2-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", display:"block", marginBottom:4 };

  return (
    <div style={RICETTARIO_STY.overlay} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={RICETTARIO_STY.box(560)}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:15, color:"#c8a96e" }}>✏️ Modifica Ingrediente</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--k2-text-dim)", cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={lbl2}>Nome *</label>
            <input style={inp2} value={form.name||""} onChange={e=>setF("name",e.target.value)}/>
          </div>
          <div>
            <label style={lbl2}>Categoria</label>
            <select style={inp2} value={form.category||"Generico"} onChange={e=>setF("category",e.target.value)}>
              {ING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl2}>Costo €/100g</label>
            <input style={inp2} type="number" step="0.001" value={((form.cost||0)*100).toFixed(4)} onChange={e=>setF("cost",Number(e.target.value)/100)}/>
          </div>
          <div>
            <label style={lbl2}>Fornitore</label>
            <input style={inp2} value={form.supplier||""} onChange={e=>setF("supplier",e.target.value)} placeholder="es. Ponti, ICAM…"/>
          </div>
          <div>
            <label style={lbl2}>Resa % (default 100)</label>
            <input style={inp2} type="number" min={0} max={100} value={form.yieldPercent||100} onChange={e=>setF("yieldPercent",Number(e.target.value))}/>
          </div>
        </div>

        {/* Nutrizione */}
        <div style={{ marginBottom:12 }}>
          <label style={lbl2}>Valori nutrizionali / 100g</label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
            {["kcal","fat","satFat","carbs","sugars","protein","salt"].map(k => (
              <div key={k}>
                <label style={{ fontSize:9, color:"var(--k2-text-dim)", display:"block", marginBottom:2 }}>{k}</label>
                <input style={inp2} type="number" step="0.1" min={0}
                  value={form.nutritionPer100g?.[k]||0}
                  onChange={e=>setF("nutritionPer100g",{...form.nutritionPer100g,[k]:Number(e.target.value)})}/>
              </div>
            ))}
          </div>
        </div>

        {/* Allergeni */}
        <div style={{ marginBottom:16 }}>
          <label style={lbl2}>Allergeni</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {ALL_ALLERGENI.map(a => {
              const active = (form.allergens||[]).includes(a);
              return (
                <button key={a} onClick={()=>toggleAllergen(a)} style={{
                  padding:"3px 9px", fontSize:10, cursor:"pointer", borderRadius:10, fontFamily:"inherit",
                  border:`1px solid ${active?"#fbbf2466":"var(--k2-border)"}`,
                  background: active ? "#fbbf2422" : "transparent",
                  color: active ? "#fbbf24" : "var(--k2-text-dim)",
                  fontWeight: active ? "bold" : "normal",
                }}>{(ALLERGENI_LABELS[a]||a).replace(/^[\p{Emoji}\s]+/u,"").trim()}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <button onClick={onClose} style={{ padding:"8px 20px", background:"transparent", border:"1px solid var(--k2-border)", borderRadius:6, color:"var(--k2-text-dim)", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>Annulla</button>
          <button onClick={handleSave} style={{ padding:"8px 24px", background:"#c8a96e", border:"none", borderRadius:6, color:"var(--k2-bg)", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:"bold" }}>💾 Salva</button>
        </div>
      </div>
    </div>
  );
}

function VistaIngredienti({ ingredients, setModalIng }) {
  const [search2, setSearch2] = useState("");
  const [catF2, setCatF2]     = useState("Tutti");
  const cats = ["Tutti", ...ING_CATEGORIES];
  const filtered = (ingredients||[]).filter(i =>
    i.active !== false &&
    (catF2 === "Tutti" || i.category === catF2) &&
    i.name.toLowerCase().includes(search2.toLowerCase())
  ).sort((a,b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <input type="text" value={search2} onChange={e=>setSearch2(e.target.value)} placeholder="🔍 Cerca ingrediente…"
          style={{ flex:1, minWidth:160, padding:"6px 12px", borderRadius:7, border:"1px solid var(--k2-border)", background:"var(--k2-bg-card)", color:"var(--k2-text)", fontFamily:"inherit", fontSize:12 }}/>
      </div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
        {cats.map(c => (
          <button key={c} style={RICETTARIO_STY.catBtn(catF2===c)} onClick={()=>setCatF2(c)}>{c==="Tutti"?`Tutti (${(ingredients||[]).filter(i=>i.active!==false).length})`:c}</button>
        ))}
      </div>
      <div style={{ display:"grid", gap:6 }}>
        {filtered.map(ing => (
          <div key={ing.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"var(--k2-bg-card)", border:"1px solid var(--k2-border)", borderRadius:8 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:"bold" }}>{ing.name}</div>
              <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:2 }}>
                {ing.category} · {fmtE((ing.cost||0)*100)}/100g
                {(ing.allergens||[]).length > 0 && <span style={{ marginLeft:8, color:"#fbbf24" }}>⚠ {(ing.allergens||[]).join(", ")}</span>}
              </div>
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              {(ing.allergens||[]).length > 0 && (
                <span style={{ fontSize:9, background:"rgba(251,191,36,0.12)", color:"#fbbf24", border:"1px solid #fbbf2433", borderRadius:8, padding:"2px 7px" }}>
                  ⚠ {(ing.allergens||[]).length} allerg.
                </span>
              )}
              <button onClick={() => setModalIng(ing)}
                style={{ padding:"4px 12px", fontSize:11, background:"transparent", border:"1px solid var(--k2-border)", borderRadius:6, color:"var(--k2-text-dim)", cursor:"pointer", fontFamily:"inherit" }}>
                ✏️ Modifica
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ricettario({ recipes, setRecipes, ingredients, setIngredients, listino, setListino, costiF, reparto, onGoTo }) {
  const [sezione, setSezione] = useState("gelateria");
  const [catSel, setCatSel]   = useState("Tutti");
  const [search, setSearch]   = useState("");
  const [ricSel, setRicSel]   = useState(null);
  const [vista, setVista]     = useState("griglia");
  // modali
  const [modalGusto, setModalGusto]     = useState(null); // null | "new" | ricetta_k2
  const [modalIng, setModalIng]         = useState(null); // null | ingrediente_app
  const [modalIngSel, setModalIngSel]   = useState(null); // ricetta k2 per cui si mostra la lista ing app

  // ─── dati ricette app (da recipes prop) per collegamento ─────────────────
  // Mappa nome → ricetta app per collegamento rapido
  const recipesByName = React.useMemo(() => {
    const m = {};
    (recipes || []).forEach(r => { m[r.name?.toLowerCase()?.trim()] = r; });
    return m;
  }, [recipes]);

  // Trova ricetta app collegata a una ricetta k2 (per nome simile)
  function findLinkedRecipe(k2Nome) {
    const key = k2Nome.toLowerCase().trim().replace(/\s*k2\s*$/i,"").trim();
    // exact match
    if (recipesByName[key]) return recipesByName[key];
    // partial match
    for (const [rname, r] of Object.entries(recipesByName)) {
      if (rname.includes(key) || key.includes(rname)) return r;
    }
    return null;
  }

  const CATS_GEL = RICETTARIO_CATS_GEL;
  const CATS_PAS = RICETTARIO_CATS_PAS;

  const repartoRicette = React.useMemo(
    () => K2_RICETTARIO.filter(r => r.reparto === sezione),
    [sezione]
  );
  const catsAttive = sezione === "gelateria" ? CATS_GEL : CATS_PAS;
  const conteggioPerCat = React.useMemo(() => {
    const m = {};
    repartoRicette.forEach(r => { m[r.categoria] = (m[r.categoria] || 0) + 1; });
    return m;
  }, [repartoRicette]);

  const filtrate = React.useMemo(() => repartoRicette.filter(r => {
    const catOk    = catSel === "Tutti" || r.categoria === catSel;
    const searchOk = !search || r.nome.toLowerCase().includes(search.toLowerCase()) ||
      (r.ingredienti||[]).some(i => (i.nome||"").toLowerCase().includes(search.toLowerCase()));
    return catOk && searchOk;
  }), [repartoRicette, catSel, search]);

  // ─── stili ─────────────────────────────────────────────────────────────────
  const sty = RICETTARIO_STY;

  const catColors = RICETTARIO_CAT_COLORS;


  // ─── CARD ricetta ─────────────────────────────────────────────────────────

  // ─── RIGA lista ───────────────────────────────────────────────────────────

  // ─── MODALE DETTAGLIO ricetta k2 ─────────────────────────────────────────

  // ─── MODALE AGGIUNGI/MODIFICA GUSTO K2 ────────────────────────────────────

  // ─── MODALE MODIFICA INGREDIENTE APP ─────────────────────────────────────

  // ─── VISTA INGREDIENTI APP ────────────────────────────────────────────────

  // ─── RENDER PRINCIPALE ────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"Georgia,serif", color:"var(--k2-text)", paddingBottom:40 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:8, color:"#c8a96e", letterSpacing:"0.22em", textTransform:"uppercase", marginBottom:4 }}>GELATERIA K2 · DATABASE RICETTE</div>
          <h2 style={{ margin:0, fontSize:22, color:"var(--k2-text)", fontWeight:"bold" }}>📖 Ricettario K2</h2>
          <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:4 }}>
            {K2_RICETTARIO.filter(r=>r.reparto==="gelateria").length} gelateria ·{" "}
            {K2_RICETTARIO.filter(r=>r.reparto==="pasticceria").length} pasticceria · {K2_RICETTARIO.length} totale
          </div>
        </div>
        <button onClick={() => setModalGusto("new")}
          style={{ padding:"8px 16px", background:"#c8a96e", border:"none", borderRadius:8, color:"var(--k2-bg)", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:"bold", flexShrink:0 }}>
          ➕ Nuovo gusto
        </button>
      </div>

      {/* Tab principali */}
      <div style={{ display:"flex", gap:0, marginBottom:16, borderBottom:"1px solid var(--k2-border)" }}>
        {[
          {id:"gelateria",    label:"🍦 Gelateria"},
          {id:"pasticceria",  label:"🎂 Pasticceria"},
          {id:"ingredienti_app", label:"🧪 Ingredienti"},
        ].map(t => (
          <button key={t.id} style={sty.tab(sezione===t.id)} onClick={() => { setSezione(t.id); setCatSel("Tutti"); setSearch(""); }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Collegamento moduli */}
      {sezione !== "ingredienti_app" && (
        <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
          {[
            {id:"foodcost",   label:"🌾 Food Cost",  color:"#4ade80"},
            {id:"produzione", label:"🏭 Produzione",  color:"#60a5fa"},
            {id:"etichette",  label:"🏷️ Etichette",  color:"#c8a96e"},
            {id:"listino",    label:"🍦 Listino",     color:"#a78bfa"},
          ].map(m => (
            <button key={m.id} onClick={() => onGoTo && onGoTo(m.id)} style={{
              padding:"4px 12px", fontSize:11, cursor:"pointer", borderRadius:14, fontFamily:"inherit",
              border:`1px solid ${m.color}44`, background:`${m.color}11`, color:m.color,
            }}>{m.label} ↗</button>
          ))}
        </div>
      )}

      {/* SEZIONE INGREDIENTI APP */}
      {sezione === "ingredienti_app" && <VistaIngredienti ingredients={ingredients} setModalIng={setModalIng}/>}

      {/* SEZIONE RICETTE */}
      {sezione !== "ingredienti_app" && (
        <>
          {/* Barra filtri */}
          <div style={{ display:"flex", gap:10, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Cerca ricetta o ingrediente…"
              style={{ flex:1, minWidth:180, padding:"6px 12px", borderRadius:7, border:"1px solid var(--k2-border)", background:"var(--k2-bg-card)", color:"var(--k2-text)", fontFamily:"inherit", fontSize:12 }}/>
            <div style={{ display:"flex", gap:3 }}>
              <button onClick={()=>setVista("griglia")} style={{ ...sty.catBtn(vista==="griglia"), borderRadius:6, padding:"5px 10px" }}>⊞</button>
              <button onClick={()=>setVista("lista")}   style={{ ...sty.catBtn(vista==="lista"),   borderRadius:6, padding:"5px 10px" }}>☰</button>
            </div>
          </div>

          {/* Categorie */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:16 }}>
            {catsAttive.map(c => (
              <button key={c} style={sty.catBtn(catSel===c)} onClick={()=>setCatSel(c)}>
                {c==="Tutti" ? `Tutti (${repartoRicette.length})` : `${c} (${conteggioPerCat[c]||0})`}
              </button>
            ))}
          </div>

          {filtrate.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:"var(--k2-text-dim)", fontSize:13 }}>Nessuna ricetta trovata</div>
          ) : vista === "griglia" ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
              {filtrate.map(r => <CardRicetta key={r.id} r={r} findLinkedRecipe={findLinkedRecipe} setRicSel={setRicSel}/>)}
            </div>
          ) : (
            <div style={{ display:"grid", gap:6 }}>
              {filtrate.map(r => <RigaLista key={r.id} r={r} findLinkedRecipe={findLinkedRecipe} setRicSel={setRicSel}/>)}
            </div>
          )}
        </>
      )}

      {/* Modali */}
      {ricSel          && <DettaglioRicetta r={ricSel} onClose={()=>setRicSel(null)} findLinkedRecipe={findLinkedRecipe} setModalGusto={setModalGusto} onGoTo={onGoTo}/>}
      {modalGusto      && <ModalGusto ricetta={modalGusto} onClose={()=>setModalGusto(null)} setRecipes={setRecipes} ingredients={ingredients} setListino={setListino} reparto={reparto}/>}
      {modalIng        && <ModalIngrediente ingApp={modalIng} onClose={()=>setModalIng(null)}/>}
    </div>
  );
}

