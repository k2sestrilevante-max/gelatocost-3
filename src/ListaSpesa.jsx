import React, { useState, useMemo, useCallback } from "react";

function fmtStock(g) {
  if (g === null || g === undefined) return "—";
  if (g >= 1000) return `${(g / 1000).toFixed(2).replace(".", ",")} kg`;
  return `${g} g`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function formatDateIT(iso) {
  if (!iso) return "";
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const btn = (color="#c8a96e") => ({
  background:`${color}22`, border:`1px solid ${color}44`, color,
  borderRadius:6, padding:"6px 14px", fontSize:11, fontFamily:"inherit",
  cursor:"pointer", fontWeight:"bold", whiteSpace:"nowrap",
});
const inp = {
  padding:"5px 9px", borderRadius:5, border:"1px solid var(--k2-border)",
  background:"var(--k2-bg-input)", color:"var(--k2-text)",
  fontFamily:"inherit", fontSize:12,
};
const badgeSty = (color) => ({
  fontSize:9, padding:"2px 7px", borderRadius:8,
  background:`${color}22`, color, border:`1px solid ${color}44`,
  fontWeight:"bold", display:"inline-block", whiteSpace:"nowrap",
});

// ─── stampa ───────────────────────────────────────────────────────────────────
function buildPrintHtml({ title, subtitle, categories, extraItems, date }) {
  const catBlocks = categories.map(cat => {
    if (!cat.items.length) return "";
    const rows = cat.items.map(i => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;">
          ${i.checked ? "☑" : "☐"} ${i.name}${i.sottoscorta ? " ⚠" : ""}
        </td>
        <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;color:#6b7280;">${i.supplier||""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;text-align:right;font-family:monospace;">${i.qty||""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;color:#6b7280;">${i.note||""}</td>
      </tr>`).join("");
    return `
      <div style="margin-bottom:18px;page-break-inside:avoid;">
        <div style="background:#f5f0e8;padding:5px 10px;font-weight:bold;font-size:12px;color:#8b6b2a;border-left:4px solid #c8a96e;">
          ${cat.label}
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#faf7f0;">
            <th style="padding:5px 8px;text-align:left;font-size:11px;border-bottom:1px solid #c8b882;">Prodotto</th>
            <th style="padding:5px 8px;text-align:left;font-size:11px;border-bottom:1px solid #c8b882;">Fornitore</th>
            <th style="padding:5px 8px;text-align:right;font-size:11px;border-bottom:1px solid #c8b882;">Qtà</th>
            <th style="padding:5px 8px;text-align:left;font-size:11px;border-bottom:1px solid #c8b882;">Note</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  const extraRows = extraItems.length ? `
    <div style="margin-top:12px;page-break-inside:avoid;">
      <div style="background:#f0eafa;padding:5px 10px;font-weight:bold;font-size:12px;color:#7c3aed;border-left:4px solid #a78bfa;">Aggiunte manuali</div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${extraItems.map(e=>`
          <tr>
            <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;">☐ ${e.name}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;color:#6b7280;">${e.supplier||""}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;text-align:right;">${e.qty||""}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e8e0c8;color:#6b7280;">${e.note||""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:20px;color:#1a1508;font-size:11pt}
    h1{margin:0 0 2px;color:#8b6b2a;font-size:18px}
    .sub{color:#6b7280;font-size:11px;margin-bottom:18px;padding-bottom:8px;border-bottom:2px solid #c8a96e}
    @media print{body{padding:8px}@page{margin:12mm 10mm}}
  </style></head><body>
  <h1>🛒 ${title}</h1>
  <div class="sub">${subtitle} · ${formatDateIT(date)}</div>
  ${catBlocks}${extraRows}
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
  </body></html>`;
}

function openPrint(html) {
  const w = window.open("","_blank","noopener,noreferrer,width=960,height=760");
  if (!w) { alert("Abilita i popup per stampare."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function ListaSpesa({ ingredients, suppliers, sede }) {
  const [tab, setTab]           = useState("generale");
  const [search, setSearch]     = useState("");
  const [onlySotto, setOnlySotto] = useState(false);
  const [itemState, setItemState] = useState({});   // { id: { checked, qty, note } }
  const [extraItems, setExtraItems] = useState([]);
  const [newExtra, setNewExtra]   = useState({ name:"", supplier:"", qty:"", note:"" });

  // fornitore
  const [selSupplier, setSelSupplier]         = useState(null);
  const [supplierChecked, setSupplierChecked] = useState({});
  const [qtyMap, setQtyMap]                   = useState({});
  const [noteMap, setNoteMap]                 = useState({});
  const [supplierExtra, setSupplierExtra]     = useState({});
  const [newSupExtra, setNewSupExtra]         = useState({ name:"", qty:"", note:"" });

  // helper fornitore associato a un ingrediente
  const findSupplier = useCallback((ing) =>
    (suppliers||[]).find(s =>
      (ing.supplier && s.name?.toLowerCase().includes(ing.supplier?.toLowerCase())) ||
      (s.products||[]).some(p => p.toLowerCase().includes(ing.name.toLowerCase().split(" ")[0]))
    ), [suppliers]);

  const setItemField = useCallback((id, field, val) =>
    setItemState(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } })), []);

  const toggleCheck = useCallback((id) =>
    setItemState(prev => ({ ...prev, [id]: { ...prev[id], checked: !prev[id]?.checked } })), []);

  // ─── costruisce categorie ─────────────────────────────────────────────────
  const categories = useMemo(() => {
    const active = (ingredients||[]).filter(i => i.active !== false);
    const catMap = {};

    active.forEach(ing => {
      const cat = ing.category || "Altro";
      if (!catMap[cat]) catMap[cat] = [];

      const s    = ing.stockBySede?.[sede];
      const sotto = s ? (s.minStock_g > 0 && s.currentStock_g < s.minStock_g) : false;
      const manca_g = sotto ? Math.max(0, s.minStock_g - s.currentStock_g) : 0;
      const sup  = findSupplier(ing);
      const id   = `ing-${ing.id}`;
      const st   = itemState[id] || {};

      // filtri
      const nameOk  = !search   || ing.name.toLowerCase().includes(search.toLowerCase());
      const sottoOk = !onlySotto || sotto;

      if (!nameOk || !sottoOk) return; // non includo questa riga

      catMap[cat].push({
        id,
        name:     ing.name,
        supplier: sup?.name || ing.supplier || "",
        sottoscorta: sotto,
        manca:    manca_g > 0 ? fmtStock(manca_g) : "",
        current:  s ? fmtStock(s.currentStock_g) : "—",
        min:      s ? fmtStock(s.minStock_g) : "—",
        checked:  !!st.checked,
        qty:      st.qty !== undefined ? st.qty : (manca_g > 0 ? fmtStock(manca_g) : ""),
        note:     st.note || "",
      });
    });

    return Object.entries(catMap)
      .filter(([, items]) => items.length > 0)
      .sort(([a],[b]) => a === "Altro" ? 1 : b === "Altro" ? -1 : a.localeCompare(b))
      .map(([label, items]) => ({
        label,
        items: items.sort((a,b) =>
          a.sottoscorta !== b.sottoscorta ? (a.sottoscorta ? -1 : 1) : a.name.localeCompare(b.name)
        ),
      }));
  }, [ingredients, suppliers, sede, search, onlySotto, itemState, findSupplier]);

  const totSotto   = useMemo(() => (ingredients||[]).filter(i => {
    if (i.active===false) return false;
    const s = i.stockBySede?.[sede];
    return s && s.minStock_g > 0 && s.currentStock_g < s.minStock_g;
  }).length, [ingredients, sede]);

  const totChecked = Object.values(itemState).filter(s => s?.checked).length;
  const totProdotti = categories.reduce((s, c) => s + c.items.length, 0);

  function toggleCategory(items) {
    const allChecked = items.every(i => itemState[i.id]?.checked);
    const updates = {};
    items.forEach(i => { updates[i.id] = { ...itemState[i.id], checked: !allChecked }; });
    setItemState(prev => ({ ...prev, ...updates }));
  }

  function resetAll() {
    const updates = {};
    (ingredients||[]).filter(i=>i.active!==false).forEach(i => {
      const id = `ing-${i.id}`;
      updates[id] = { ...itemState[id], checked: false };
    });
    setItemState(prev => ({ ...prev, ...updates }));
  }

  function addExtra() {
    if (!newExtra.name.trim()) return;
    setExtraItems(prev => [...prev, { id:`ex-${Date.now()}`, ...newExtra }]);
    setNewExtra({ name:"", supplier:"", qty:"", note:"" });
  }

  function printLista() {
    const catsForPrint = categories.map(cat => ({
      label: cat.label,
      items: cat.items.map(i => ({
        checked:i.checked, name:i.name, supplier:i.supplier,
        qty:i.qty, note:i.note, sottoscorta:i.sottoscorta,
      })),
    }));
    openPrint(buildPrintHtml({
      title:"Lista della Spesa K2",
      subtitle:sede,
      categories:catsForPrint,
      extraItems,
      date:today(),
    }));
  }

  // ─── Tab fornitore ─────────────────────────────────────────────────────────
  const suppliersWithProducts = useMemo(() =>
    (suppliers||[])
      .filter(s => s.active!==false && (s.products||[]).length > 0)
      .sort((a,b)=>(a.name||"").localeCompare(b.name||"")),
    [suppliers]);

  const currentSupplier = suppliersWithProducts.find(s => s.id === selSupplier);

  const supplierProducts = useMemo(() => {
    if (!currentSupplier) return [];
    return (currentSupplier.products||[]).map((p, idx) => {
      const key = `${currentSupplier.id}_${idx}`;
      const ingMatch = (ingredients||[]).find(i => {
        const s = i.stockBySede?.[sede];
        if (!s || !(s.minStock_g > 0 && s.currentStock_g < s.minStock_g)) return false;
        return p.toLowerCase().includes(i.name.toLowerCase().split(" ")[0]) ||
               i.name.toLowerCase().includes(p.toLowerCase().split(" ")[0]);
      });
      const manca = ingMatch ? (() => {
        const s = ingMatch.stockBySede[sede];
        return fmtStock(Math.max(0, s.minStock_g - s.currentStock_g));
      })() : "";
      return { key, name:p, inSottoscorta:!!ingMatch, manca };
    });
  }, [currentSupplier, ingredients, sede]);

  function addSupExtra() {
    if (!newSupExtra.name.trim() || !selSupplier) return;
    setSupplierExtra(prev => ({
      ...prev,
      [selSupplier]: [...(prev[selSupplier]||[]), { key:`se-${Date.now()}`, ...newSupExtra }]
    }));
    setNewSupExtra({ name:"", qty:"", note:"" });
  }

  function removeSupExtra(sid, key) {
    setSupplierExtra(prev => ({
      ...prev, [sid]: (prev[sid]||[]).filter(e=>e.key!==key)
    }));
  }

  function printFornitore() {
    if (!currentSupplier) return;
    const rows = [
      ...supplierProducts.filter(p=>supplierChecked[p.key]).map(p=>({
        checked:true, name:p.name+(p.inSottoscorta?" ⚠":""),
        supplier:currentSupplier.name,
        qty:qtyMap[p.key]||p.manca, note:noteMap[p.key]||"",
        sottoscorta:p.inSottoscorta,
      })),
      ...(supplierExtra[selSupplier]||[]).filter(e=>supplierChecked[e.key]).map(e=>({
        checked:true, name:e.name, supplier:currentSupplier.name,
        qty:e.qty, note:e.note, sottoscorta:false,
      })),
    ];
    if (!rows.length) { alert("Seleziona almeno un prodotto."); return; }
    openPrint(buildPrintHtml({
      title:`Ordine — ${currentSupplier.name}`,
      subtitle:sede,
      categories:[{ label:"Prodotti selezionati", items:rows }],
      extraItems:[],
      date:today(),
    }));
  }

  const tabSty = (active) => ({
    padding:"8px 20px", fontSize:13, cursor:"pointer", border:"none",
    background:"transparent", fontFamily:"inherit",
    color: active?"#c8a96e":"var(--k2-text-dim)",
    borderBottom: active?"2px solid #c8a96e":"2px solid transparent",
    fontWeight: active?"bold":"normal",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ fontFamily:"Georgia,serif", color:"var(--k2-text)", paddingBottom:40 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
        <div>
          <div style={{ fontSize:8, color:"#c8a96e", letterSpacing:"0.22em", textTransform:"uppercase", marginBottom:4 }}>GELATERIA K2 · ACQUISTI</div>
          <h2 style={{ margin:0, fontSize:22, fontWeight:"bold" }}>🛒 Lista della Spesa</h2>
          <div style={{ fontSize:11, color:"var(--k2-text-dim)", marginTop:4 }}>
            Sede: <strong style={{ color:"#c8a96e" }}>{sede}</strong>
            <span style={{ marginLeft:10 }}>{totProdotti} prodotti</span>
            {totSotto > 0 && <span style={{ marginLeft:10, color:"#f87171", fontWeight:"bold" }}>⚠ {totSotto} sottoscorta</span>}
            {totChecked > 0 && <span style={{ marginLeft:10, color:"#4ade80" }}>✓ {totChecked} spuntati</span>}
          </div>
        </div>
        {tab==="generale" && (
          <button onClick={printLista} style={btn("#60a5fa")}>🖨️ Stampa lista</button>
        )}
        {tab==="fornitore" && currentSupplier && (
          <button onClick={printFornitore} style={btn("#60a5fa")}>🖨️ Stampa ordine</button>
        )}
      </div>

      {/* Tab */}
      <div style={{ display:"flex", borderBottom:"1px solid var(--k2-border)", marginBottom:20 }}>
        <button style={tabSty(tab==="generale")} onClick={()=>setTab("generale")}>📋 Lista ingredienti</button>
        <button style={tabSty(tab==="fornitore")} onClick={()=>setTab("fornitore")}>🚚 Per fornitore</button>
      </div>

      {/* ══ TAB LISTA GENERALE ══════════════════════════════════════════════ */}
      {tab==="generale" && (
        <div>
          {/* Filtri */}
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
            <input
              type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="🔍 Cerca ingrediente…"
              style={{ ...inp, flex:1, minWidth:200 }}
            />
            <button onClick={()=>setOnlySotto(v=>!v)} style={btn(onlySotto?"#f87171":"#6b7280")}>
              {onlySotto ? "⚠ Solo sottoscorta ✓" : "⚠ Solo sottoscorta"}
            </button>
            <button onClick={resetAll} style={btn("#6b7280")}>↺ Reset spunte</button>
          </div>

          {/* Nessun prodotto */}
          {categories.length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:"var(--k2-text-dim)", fontSize:14 }}>
              {onlySotto
                ? "✅ Nessun articolo sottoscorta"
                : "Nessun ingrediente in magazzino. Aggiungili dal modulo Impostazioni."}
            </div>
          )}

          {/* Categorie */}
          {categories.map(cat => {
            const allChecked = cat.items.length > 0 && cat.items.every(i=>i.checked);
            const nSotto = cat.items.filter(i=>i.sottoscorta).length;
            return (
              <div key={cat.label} style={{ marginBottom:20 }}>
                {/* Header categoria */}
                <div style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"8px 14px",
                  background:"linear-gradient(90deg,rgba(200,169,110,0.15),transparent)",
                  borderBottom:"2px solid #c8a96e44",
                  borderRadius:"8px 8px 0 0",
                }}>
                  <div style={{ flex:1, fontSize:13, fontWeight:"bold", color:"#c8a96e" }}>
                    {cat.label}
                    <span style={{ fontSize:11, fontWeight:"normal", color:"var(--k2-text-dim)", marginLeft:8 }}>
                      ({cat.items.length})
                    </span>
                    {nSotto > 0 && (
                      <span style={{ ...badgeSty("#f87171"), marginLeft:8 }}>⚠ {nSotto} sottoscorta</span>
                    )}
                  </div>
                  <button
                    onClick={()=>toggleCategory(cat.items)}
                    style={{ ...btn(allChecked?"#4ade80":"#6b7280"), fontSize:10, padding:"3px 10px" }}
                  >
                    {allChecked ? "✓ Tutti" : "Seleziona tutti"}
                  </button>
                </div>

                {/* Righe */}
                <div style={{ border:"1px solid var(--k2-border)", borderTop:"none", borderRadius:"0 0 8px 8px", overflow:"hidden" }}>
                  {cat.items.map((item, idx) => (
                    <div key={item.id} style={{
                      display:"grid",
                      gridTemplateColumns:"34px 1fr 130px 160px",
                      gap:8, alignItems:"center",
                      padding:"8px 12px",
                      background: item.checked
                        ? "rgba(74,222,128,0.06)"
                        : item.sottoscorta
                        ? "rgba(248,113,113,0.06)"
                        : idx%2===0 ? "var(--k2-bg-card)" : "var(--k2-bg)",
                      borderBottom: idx<cat.items.length-1 ? "1px solid var(--k2-border)" : "none",
                      transition:"background 0.12s",
                    }}>
                      {/* Checkbox */}
                      <div
                        onClick={()=>toggleCheck(item.id)}
                        style={{
                          width:22, height:22, borderRadius:5, cursor:"pointer", flexShrink:0,
                          border:`2px solid ${item.checked?"#4ade80":item.sottoscorta?"#f87171":"var(--k2-border)"}`,
                          background:item.checked?"#4ade80":"transparent",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}
                      >
                        {item.checked && <span style={{ fontSize:12, color:"#000", fontWeight:"bold" }}>✓</span>}
                      </div>

                      {/* Nome */}
                      <div onClick={()=>toggleCheck(item.id)} style={{ cursor:"pointer", minWidth:0 }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                          <span style={{
                            fontSize:13,
                            fontWeight:item.sottoscorta?"bold":"normal",
                            textDecoration:item.checked?"line-through":"none",
                            color:item.checked?"var(--k2-text-dim)":"var(--k2-text)",
                          }}>
                            {item.name}
                          </span>
                          {item.sottoscorta && (
                            <span style={badgeSty("#f87171")}>⚠ mancano {item.manca}</span>
                          )}
                          {item.supplier && (
                            <span style={{ fontSize:10, color:"var(--k2-text-dim)" }}>· {item.supplier}</span>
                          )}
                        </div>
                        <div style={{ fontSize:10, color:"var(--k2-text-dim)", marginTop:1 }}>
                          Stock: {item.current}
                          {item.min && item.min!=="0 g" && <span> · Min: {item.min}</span>}
                        </div>
                      </div>

                      {/* Qtà */}
                      <input
                        type="text"
                        placeholder="Qtà da ordinare"
                        value={item.qty}
                        onChange={e=>setItemField(item.id,"qty",e.target.value)}
                        style={{ ...inp, textAlign:"right" }}
                      />

                      {/* Nota */}
                      <input
                        type="text"
                        placeholder="Nota"
                        value={item.note}
                        onChange={e=>setItemField(item.id,"note",e.target.value)}
                        style={inp}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Aggiungi prodotto extra */}
          <div style={{ border:"1px dashed var(--k2-border)", borderRadius:8, padding:14, marginTop:4 }}>
            <div style={{ fontSize:11, color:"#a78bfa", fontWeight:"bold", marginBottom:10 }}>
              ➕ Aggiungi prodotto non in magazzino
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 90px 1fr auto", gap:8, alignItems:"center" }}>
              <input placeholder="Nome prodotto *" value={newExtra.name} onChange={e=>setNewExtra(p=>({...p,name:e.target.value}))} style={inp}/>
              <input placeholder="Fornitore" value={newExtra.supplier} onChange={e=>setNewExtra(p=>({...p,supplier:e.target.value}))} style={inp}/>
              <input placeholder="Qtà" value={newExtra.qty} onChange={e=>setNewExtra(p=>({...p,qty:e.target.value}))} style={inp}/>
              <input placeholder="Nota" value={newExtra.note} onChange={e=>setNewExtra(p=>({...p,note:e.target.value}))} style={inp}/>
              <button onClick={addExtra} style={btn("#a78bfa")}>Aggiungi</button>
            </div>
            {extraItems.length > 0 && (
              <div style={{ marginTop:10, display:"grid", gap:4 }}>
                {extraItems.map(e=>(
                  <div key={e.id} style={{
                    display:"flex", gap:8, alignItems:"center", padding:"6px 10px",
                    background:"rgba(167,139,250,0.07)", borderRadius:6,
                    border:"1px solid rgba(167,139,250,0.2)",
                  }}>
                    <span style={badgeSty("#a78bfa")}>extra</span>
                    <span style={{ flex:1, fontSize:12 }}>{e.name}</span>
                    {e.supplier&&<span style={{ fontSize:11,color:"var(--k2-text-dim)" }}>{e.supplier}</span>}
                    {e.qty&&<span style={{ fontSize:11,color:"var(--k2-text-dim)",fontFamily:"monospace" }}>{e.qty}</span>}
                    {e.note&&<span style={{ fontSize:11,color:"var(--k2-text-dim)" }}>{e.note}</span>}
                    <button onClick={()=>setExtraItems(p=>p.filter(x=>x.id!==e.id))}
                      style={{ background:"transparent",border:"none",color:"#f87171",cursor:"pointer",fontSize:14 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB PER FORNITORE ═══════════════════════════════════════════════ */}
      {tab==="fornitore" && (
        <div style={{ display:"grid", gridTemplateColumns:"250px 1fr", gap:20, alignItems:"start" }}>

          {/* Sidebar */}
          <div>
            <div style={{ fontSize:10,color:"var(--k2-text-dim)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8 }}>Fornitori</div>
            {suppliersWithProducts.length===0 && (
              <div style={{ fontSize:12,color:"var(--k2-text-dim)" }}>Nessun fornitore con prodotti configurati.</div>
            )}
            {suppliersWithProducts.map(s=>{
              const hasSotto = (ingredients||[]).some(i=>{
                const st=i.stockBySede?.[sede];
                if(!st||!(st.minStock_g>0&&st.currentStock_g<st.minStock_g)) return false;
                return (s.products||[]).some(p=>
                  p.toLowerCase().includes(i.name.toLowerCase().split(" ")[0])||
                  i.name.toLowerCase().includes(p.toLowerCase().split(" ")[0])
                );
              });
              const nSel=(s.products||[]).filter((_,idx)=>supplierChecked[`${s.id}_${idx}`]).length
                +(supplierExtra[s.id]||[]).filter(e=>supplierChecked[e.key]).length;
              return (
                <div key={s.id} onClick={()=>setSelSupplier(s.id)} style={{
                  padding:"9px 12px",borderRadius:8,cursor:"pointer",marginBottom:4,
                  background:selSupplier===s.id?"rgba(200,169,110,0.12)":"var(--k2-bg-card)",
                  border:`1px solid ${selSupplier===s.id?"#c8a96e66":"var(--k2-border)"}`,
                  transition:"all 0.15s",
                }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div style={{ fontSize:12,fontWeight:"bold",color:selSupplier===s.id?"#c8a96e":"var(--k2-text)" }}>
                      {s.name}
                    </div>
                    <div style={{ display:"flex",gap:4 }}>
                      {hasSotto&&<span style={badgeSty("#f87171")}>⚠</span>}
                      {nSel>0&&<span style={badgeSty("#4ade80")}>{nSel}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize:10,color:"var(--k2-text-dim)",marginTop:2 }}>
                    {(s.products||[]).length} prodotti
                    {s.leadTimeDays?` · ${s.leadTimeDays}gg`:""}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dettaglio fornitore */}
          <div>
            {!currentSupplier?(
              <div style={{ textAlign:"center",padding:"60px 0",color:"var(--k2-text-dim)" }}>
                <div style={{ fontSize:40,marginBottom:12 }}>🚚</div>
                <div style={{ fontSize:14 }}>Seleziona un fornitore dalla lista</div>
              </div>
            ):(
              <>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16 }}>
                  <div>
                    <h3 style={{ margin:0,fontSize:18,color:"#c8a96e" }}>{currentSupplier.name}</h3>
                    <div style={{ fontSize:11,color:"var(--k2-text-dim)",marginTop:4 }}>
                      {currentSupplier.telefono&&<span>📞 {currentSupplier.telefono}  </span>}
                      {currentSupplier.email&&<span>✉ {currentSupplier.email}  </span>}
                      {currentSupplier.referente&&<span>👤 {currentSupplier.referente}</span>}
                    </div>
                  </div>
                  <button
                    onClick={()=>{
                      const allKeys=supplierProducts.map(p=>p.key);
                      const allSel=allKeys.every(k=>supplierChecked[k]);
                      const u={};allKeys.forEach(k=>{u[k]=!allSel;});
                      setSupplierChecked(prev=>({...prev,...u}));
                    }}
                    style={btn("#6b7280")}
                  >
                    {supplierProducts.every(p=>supplierChecked[p.key])?"Deseleziona tutti":"Seleziona tutti"}
                  </button>
                </div>

                {/* Prodotti */}
                <div style={{ border:"1px solid var(--k2-border)",borderRadius:8,overflow:"hidden",marginBottom:12 }}>
                  {supplierProducts.map((p,idx)=>(
                    <div key={p.key} style={{
                      display:"grid",gridTemplateColumns:"34px 1fr 100px 140px",
                      gap:8,alignItems:"center",padding:"8px 12px",
                      background:supplierChecked[p.key]?"rgba(74,222,128,0.06)":p.inSottoscorta?"rgba(248,113,113,0.06)":idx%2===0?"var(--k2-bg-card)":"var(--k2-bg)",
                      borderBottom:idx<supplierProducts.length-1?"1px solid var(--k2-border)":"none",
                      cursor:"pointer",
                    }} onClick={()=>setSupplierChecked(prev=>({...prev,[p.key]:!prev[p.key]}))}>
                      <div style={{
                        width:20,height:20,borderRadius:4,flexShrink:0,
                        border:`2px solid ${supplierChecked[p.key]?"#4ade80":p.inSottoscorta?"#f87171":"var(--k2-border)"}`,
                        background:supplierChecked[p.key]?"#4ade80":"transparent",
                        display:"flex",alignItems:"center",justifyContent:"center",
                      }}>
                        {supplierChecked[p.key]&&<span style={{fontSize:11,color:"#000",fontWeight:"bold"}}>✓</span>}
                      </div>
                      <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                        <span style={{
                          fontSize:12,
                          textDecoration:supplierChecked[p.key]?"line-through":"none",
                          color:supplierChecked[p.key]?"var(--k2-text-dim)":"var(--k2-text)",
                        }}>{p.name}</span>
                        {p.inSottoscorta&&<span style={badgeSty("#f87171")}>⚠ {p.manca}</span>}
                      </div>
                      <input type="text" placeholder="Qtà"
                        value={qtyMap[p.key]||(p.manca||"")}
                        onChange={e=>{e.stopPropagation();setQtyMap(prev=>({...prev,[p.key]:e.target.value}));}}
                        onClick={e=>e.stopPropagation()}
                        style={{...inp,textAlign:"right"}}/>
                      <input type="text" placeholder="Nota"
                        value={noteMap[p.key]||""}
                        onChange={e=>{e.stopPropagation();setNoteMap(prev=>({...prev,[p.key]:e.target.value}));}}
                        onClick={e=>e.stopPropagation()}
                        style={inp}/>
                    </div>
                  ))}
                </div>

                {/* Extra fornitore */}
                {(supplierExtra[selSupplier]||[]).length>0&&(
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10,color:"#a78bfa",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6 }}>Aggiunte manuali</div>
                    {(supplierExtra[selSupplier]||[]).map(e=>(
                      <div key={e.key} style={{
                        display:"flex",gap:8,alignItems:"center",padding:"7px 12px",
                        borderRadius:6,marginBottom:4,cursor:"pointer",
                        background:supplierChecked[e.key]?"rgba(167,139,250,0.08)":"var(--k2-bg-card)",
                        border:`1px solid ${supplierChecked[e.key]?"#a78bfa44":"var(--k2-border)"}`,
                      }} onClick={()=>setSupplierChecked(prev=>({...prev,[e.key]:!prev[e.key]}))}>
                        <div style={{
                          width:18,height:18,borderRadius:3,flexShrink:0,
                          border:`2px solid ${supplierChecked[e.key]?"#a78bfa":"var(--k2-border)"}`,
                          background:supplierChecked[e.key]?"#a78bfa":"transparent",
                          display:"flex",alignItems:"center",justifyContent:"center",
                        }}>
                          {supplierChecked[e.key]&&<span style={{fontSize:10,color:"#fff",fontWeight:"bold"}}>✓</span>}
                        </div>
                        <span style={{ flex:1,fontSize:12 }}>{e.name}</span>
                        {e.qty&&<span style={{ fontSize:11,color:"var(--k2-text-dim)",fontFamily:"monospace" }}>{e.qty}</span>}
                        {e.note&&<span style={{ fontSize:11,color:"var(--k2-text-dim)" }}>{e.note}</span>}
                        <button onClick={ev=>{ev.stopPropagation();removeSupExtra(selSupplier,e.key);}}
                          style={{ background:"transparent",border:"none",color:"#f87171",cursor:"pointer",fontSize:14 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Form extra */}
                <div style={{ border:"1px dashed var(--k2-border)",borderRadius:8,padding:12 }}>
                  <div style={{ fontSize:11,color:"#a78bfa",fontWeight:"bold",marginBottom:8 }}>
                    ➕ Aggiungi prodotto a {currentSupplier.name}
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 80px 1fr auto",gap:8 }}>
                    <input placeholder="Nome prodotto *" value={newSupExtra.name} onChange={e=>setNewSupExtra(p=>({...p,name:e.target.value}))} style={inp}/>
                    <input placeholder="Qtà" value={newSupExtra.qty} onChange={e=>setNewSupExtra(p=>({...p,qty:e.target.value}))} style={inp}/>
                    <input placeholder="Nota" value={newSupExtra.note} onChange={e=>setNewSupExtra(p=>({...p,note:e.target.value}))} style={inp}/>
                    <button onClick={addSupExtra} style={btn("#a78bfa")}>Aggiungi</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
