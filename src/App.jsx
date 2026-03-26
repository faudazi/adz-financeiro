import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "adz-fin-v5";

const CATS = ["Alimentação", "Transporte", "Saúde", "Lazer", "Viagem", "Assinaturas", "Vestuário", "Audazi/PJ", "Casa", "Fixo", "Outro"];
const CAT_COLORS = {
  "Alimentação": "#f59e0b", "Transporte": "#3b82f6", "Saúde": "#22c55e",
  "Lazer": "#a855f7", "Viagem": "#06b6d4", "Assinaturas": "#f43f5e",
  "Vestuário": "#ec4899", "Audazi/PJ": "#6366f1", "Casa": "#84cc16",
  "Fixo": "#ef4444", "Outro": "#94a3b8",
};
const CARDS = [
  { id: "itau", label: "Itaú Uniclass", color: "#ef4444" },
  { id: "nubank", label: "Nubank", color: "#a855f7" },
];

const MONTHS = [
  "2026-01","2026-02","2026-03","2026-04","2026-05","2026-06",
  "2026-07","2026-08","2026-09","2026-10","2026-11","2026-12"
];
const MONTH_LABELS = {
  "2026-01":"Jan 2026","2026-02":"Fev 2026","2026-03":"Mar 2026","2026-04":"Abr 2026",
  "2026-05":"Mai 2026","2026-06":"Jun 2026","2026-07":"Jul 2026","2026-08":"Ago 2026",
  "2026-09":"Set 2026","2026-10":"Out 2026","2026-11":"Nov 2026","2026-12":"Dez 2026"
};

const fmt = (v) => (v||0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function dbLoad() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function dbSave(d) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {} }

function defaultState() {
  return {
    currentMonth: "2026-03",
    months: {
      "2026-03": { cardsData: {}, manual: [], caixa: 25000 },
    },
    fluxo: {},
  };
}

async function parsePDF(base64, cardLabel, vencimento) {
  const resp = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 4000,
      system: `Parser de faturas brasileiras. Categorias: ${CATS.join(", ")}.
Retorne APENAS JSON valido sem markdown:
{
  "transactions": [{"date":"DD/MM","desc":"nome limpo","amount":123.45,"cat":"Categoria","audazi":false}],
  "total": 1234.56,
  "parcelas": [{"desc":"Nome Estabelecimento","amount":102.46,"parcela_atual":2,"total_parcelas":3}]
}
- amount sempre positivo
- audazi:true se gasto empresarial
- Em parcelas: inclua TODAS as compras parceladas identificadas na fatura com seu numero de parcela atual e total
- Exemplo de parcela: "Nomad Sports - Parcela 2/3" -> desc:"Nomad Sports", parcela_atual:2, total_parcelas:3`,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: `Extraia TODAS as transacoes desta fatura ${cardLabel} (vencimento ${vencimento}) e identifique as compras parceladas. Retorne JSON conforme instrucoes.` }
      ]}]
    }),
  });
  const data = await resp.json();
  const txt = data.content?.[0]?.text || "{}";
  try { return JSON.parse(txt.replace(/```json|```/g, "").trim()); }
  catch { return { transactions: [], total: 0, parcelas: [] }; }
}

async function chatAI(messages, context) {
  const resp = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1000,
      system: `Assistente financeiro do Fabiano Audazi. Contexto:\n${JSON.stringify(context, null, 2)}\nSeja direto e analítico.`,
      messages,
    }),
  });
  const d = await resp.json();
  return d.content?.[0]?.text || "Erro.";
}

function BarChart({ transactions }) {
  const totals = {};
  (transactions||[]).forEach(t => { totals[t.cat] = (totals[t.cat]||0) + t.amount; });
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const max = sorted[0]?.[1] || 1;
  if (!sorted.length) return <div style={{color:"#aaa",fontSize:12,padding:"8px 0"}}>Sem dados</div>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {sorted.map(([cat,val]) => (
        <div key={cat} style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:90,fontSize:11,color:"#666",textAlign:"right",flexShrink:0}}>{cat}</div>
          <div style={{flex:1,height:22,background:"#f0f0f0",borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:4,background:CAT_COLORS[cat]||"#94a3b8",width:`${(val/max)*100}%`,transition:"width 0.5s",display:"flex",alignItems:"center",paddingLeft:8}}>
              <span style={{fontSize:11,color:"#fff",fontWeight:600,whiteSpace:"nowrap"}}>{fmt(val)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── CONCILIAÇÃO ──────────────────────────────────────────────────────────────
function Conciliacao({ previstas, realizadas, onClose }) {
  const prevMap = {};
  (previstas||[]).forEach(p => { prevMap[p.desc.toLowerCase()] = p; });
  const novas = (realizadas||[]).filter(r => !prevMap[r.desc.toLowerCase()]);
  const confirmadas = (realizadas||[]).filter(r => prevMap[r.desc.toLowerCase()]);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:28,width:480,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontWeight:700,fontSize:18,marginBottom:4}}>Conciliação</div>
        <div style={{fontSize:13,color:"#666",marginBottom:20}}>Comparando parcelas previstas com fatura realizada</div>

        {confirmadas.length > 0 && (
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,color:"#22c55e",marginBottom:8}}>✓ CONFIRMADAS ({confirmadas.length})</div>
            {confirmadas.map((r,i) => (
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f5f5f5",fontSize:13}}>
                <span>{r.desc}</span><span style={{color:"#22c55e",fontWeight:600}}>{fmt(r.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {novas.length > 0 && (
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,color:"#ef4444",marginBottom:8}}>⚠ NOVAS / NÃO PREVISTAS ({novas.length})</div>
            {novas.map((r,i) => (
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f5f5f5",fontSize:13}}>
                <span>{r.desc}</span><span style={{color:"#ef4444",fontWeight:600}}>{fmt(r.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} style={{marginTop:8,width:"100%",padding:"10px 0",background:"#1e1e1e",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
          Fechar
        </button>
      </div>
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("historico");
  const [activeCard, setActiveCard] = useState("itau");
  const [parsing, setParsing] = useState(false);
  const [conciliacao, setConciliacao] = useState(null);
  const [messages, setMessages] = useState([{role:"assistant",content:"Fala, Fabiano. Analiso seu histórico e fluxo de caixa. O que quer saber?"}]);
  const [apiMsgs, setApiMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newType, setNewType] = useState("saida");
  const [newCat, setNewCat] = useState("Fixo");
  const [newFixo, setNewFixo] = useState(false);
  const fileRef = useRef(null);
  const chatRef = useRef(null);
  const recRef = useRef(null);

  useEffect(() => {
    const saved = dbLoad();
    setState(saved || defaultState());
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  if (!state) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#fff",color:"#999",fontFamily:"sans-serif"}}>Carregando...</div>;

  const persist = (newState) => {
    setState(newState);
    dbSave(newState);
  };

  const currentMonth = state.currentMonth;
  const monthData = state.months[currentMonth] || { cardsData: {}, manual: [], caixa: 0 };
  const fluxoData = state.fluxo || {};

  // Saldo do mês atual
  const saidas = (monthData.manual||[]).filter(e=>e.type==="saida").reduce((a,b)=>a+b.amount,0);
  const entradas = (monthData.manual||[]).filter(e=>e.type==="entrada").reduce((a,b)=>a+b.amount,0);
  const saldo = (monthData.caixa||0) + entradas - saidas;

  function updateMonth(m, updates) {
    const newState = {
      ...state,
      months: {
        ...state.months,
        [m]: { ...(state.months[m]||{cardsData:{},manual:[],caixa:0}), ...updates }
      }
    };
    persist(newState);
  }

  function handleFile(file) {
    if (!file) return;
    setParsing(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      const card = CARDS.find(c=>c.id===activeCard);

      // Verificar se há parcelas previstas pra conciliação
      const previstas = (fluxoData[currentMonth]||[]).filter(f=>f.cardId===activeCard);

      const parsed = await parsePDF(base64, card.label, MONTH_LABELS[currentMonth]);

      if (!parsed.transactions?.length) {
        alert("Não foi possível ler a fatura. Tente um PDF mais simples.");
        setParsing(false);
        return;
      }

      // Atualiza cardsData do mês atual
      const updatedMonthData = {
        ...(state.months[currentMonth]||{}),
        cardsData: {
          ...(monthData.cardsData||{}),
          [activeCard]: {
            transactions: parsed.transactions||[],
            total: parsed.total||0,
            fileName: file.name,
          }
        }
      };

      // Gera entradas no fluxo para o total da fatura (conta a pagar no mês de vencimento)
      const faturaEntry = {
        id: Date.now(),
        desc: `Fatura ${card.label}`,
        amount: parsed.total||0,
        type: "saida",
        cat: "Fatura Cartão",
        source: "fatura",
        cardId: activeCard,
      };

      // Distribui parcelas nos meses futuros
      const newFluxo = { ...fluxoData };
      
      // Adiciona fatura como conta do mês atual
      if (!newFluxo[currentMonth]) newFluxo[currentMonth] = [];
      newFluxo[currentMonth] = newFluxo[currentMonth].filter(f=>f.cardId!==activeCard||f.source!=="fatura");
      newFluxo[currentMonth].push(faturaEntry);

      // Distribui parcelas futuras
      if (parsed.parcelas?.length) {
        parsed.parcelas.forEach(p => {
          const restantes = p.total_parcelas - p.parcela_atual;
          for (let i = 1; i <= restantes; i++) {
            const mes = addMonths(currentMonth, i);
            if (!newFluxo[mes]) newFluxo[mes] = [];
            // Remove duplicata se existir
            newFluxo[mes] = newFluxo[mes].filter(f=>f.desc!==`${p.desc} - Parcela ${p.parcela_atual+i}/${p.total_parcelas}`);
            newFluxo[mes].push({
              id: Date.now() + i,
              desc: `${p.desc} - Parcela ${p.parcela_atual+i}/${p.total_parcelas}`,
              amount: p.amount,
              type: "saida",
              cat: "Parcela",
              source: "parcela",
              cardId: activeCard,
            });
          }
        });
      }

      const newState = {
        ...state,
        months: { ...state.months, [currentMonth]: updatedMonthData },
        fluxo: newFluxo,
      };
      persist(newState);

      // Conciliação se havia parcelas previstas
      if (previstas.filter(p=>p.source==="parcela").length > 0) {
        setConciliacao({
          previstas: previstas.filter(p=>p.source==="parcela"),
          realizadas: parsed.transactions||[],
        });
      }

      setParsing(false);
    };
    reader.readAsDataURL(file);
  }

  function removeEntry(id) {
    updateMonth(currentMonth, { manual: (monthData.manual||[]).filter(e=>e.id!==id) });
  }

  function addEntry() {
    if (!newDesc||!newAmount) return;
    const entry = { id:Date.now(), desc:newDesc, amount:parseFloat(newAmount.replace(",",".")), type:newType, cat:newCat, fixo:newFixo };
    updateMonth(currentMonth, { manual: [...(monthData.manual||[]), entry] });
    setNewDesc(""); setNewAmount("");
  }

  async function sendChat(text) {
    const msg = (text||chatInput).trim();
    if (!msg||chatLoading) return;
    setChatInput("");
    setChatLoading(true);
    const newMsgs = [...messages, {role:"user",content:msg}];
    setMessages(newMsgs);
    const newApi = [...apiMsgs, {role:"user",content:msg}];
    const reply = await chatAI(newApi, { currentMonth, monthData, fluxo: fluxoData });
    setMessages([...newMsgs, {role:"assistant",content:reply}]);
    setApiMsgs([...newApi, {role:"assistant",content:reply}]);
    setChatLoading(false);
  }

  function startVoice() {
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!SR) { alert("Use Chrome para voz."); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang="pt-BR"; rec.continuous=false; rec.interimResults=false;
    rec.onresult = e => { setChatInput(e.results[0][0].transcript); setListening(false); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current=rec; rec.start(); setListening(true);
  }

  const cardData = (monthData.cardsData||{})[activeCard];
  const allTx = Object.values(monthData.cardsData||{}).flatMap(c=>c?.transactions||[]);
  const fluxoMes = fluxoData[currentMonth]||[];
  const TABS = [["historico","📋 Histórico"],["faturas","💳 Faturas PDF"],["fluxo","📈 Fluxo de Caixa"],["chat","💬 Agente"]];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        html,body,#root{margin:0;padding:0;background:#f0f2f5;min-height:100vh;width:100%;}
        *{box-sizing:border-box;}
        button,input,select{font-family:inherit;}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:#ddd;border-radius:2px;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:none;}}
        .msg{animation:fadeUp 0.2s ease;}
        .tab-btn:hover{background:#f5f5f5!important;}
        .entry-row:hover{background:#fafafa!important;}
      `}</style>

      {conciliacao && <Conciliacao {...conciliacao} onClose={()=>setConciliacao(null)} />}

      <div style={{minHeight:"100vh",background:"#f0f2f5",fontFamily:"'DM Sans',system-ui,sans-serif",width:"100%"}}>

        {/* Header */}
        <div style={{background:"#fff",borderBottom:"1px solid #e5e5e5",padding:"0 40px",width:"100%"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:60}}>
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <span style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,letterSpacing:-0.5,color:"#111"}}>
                ADZ<span style={{color:"#3b82f6"}}>.</span>FINANCEIRO
              </span>
              {/* Month navigator */}
              <div style={{display:"flex",alignItems:"center",gap:6,background:"#f5f5f5",borderRadius:8,padding:"4px 8px"}}>
                <button onClick={()=>{const i=MONTHS.indexOf(currentMonth);if(i>0)persist({...state,currentMonth:MONTHS[i-1]});}} style={{background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:16,padding:"0 4px"}}>‹</button>
                <select value={currentMonth} onChange={e=>persist({...state,currentMonth:e.target.value})} style={{background:"transparent",border:"none",fontSize:13,fontWeight:600,color:"#333",cursor:"pointer",outline:"none"}}>
                  {MONTHS.map(m=><option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
                </select>
                <button onClick={()=>{const i=MONTHS.indexOf(currentMonth);if(i<MONTHS.length-1)persist({...state,currentMonth:MONTHS[i+1]});}} style={{background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:16,padding:"0 4px"}}>›</button>
              </div>
            </div>
            <div style={{display:"flex",gap:2}}>
              {TABS.map(([t,l])=>(
                <button key={t} className="tab-btn" onClick={()=>setTab(t)} style={{padding:"7px 16px",borderRadius:8,border:"none",background:tab===t?"#1e1e1e":"transparent",color:tab===t?"#fff":"#666",fontSize:13,fontWeight:tab===t?600:400,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{padding:"24px 40px"}}>

          {/* ── HISTÓRICO ── */}
          {tab==="historico" && (
            <div>
              {/* Saldo cards */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
                {[
                  {label:"Caixa inicial",value:fmt(monthData.caixa||0),color:"#3b82f6",editable:true},
                  {label:"Entradas",value:fmt(entradas),color:"#22c55e"},
                  {label:"Saídas manuais",value:fmt(saidas),color:"#ef4444"},
                  {label:"Saldo",value:fmt(saldo),color:saldo>=0?"#22c55e":"#ef4444"},
                ].map(({label,value,color,editable})=>(
                  <div key={label} style={{background:"#fff",border:"1px solid #eee",borderRadius:14,padding:"18px 22px"}}>
                    <div style={{fontSize:10,color:"#aaa",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{label}</div>
                    {editable?(
                      <input type="number" value={monthData.caixa||0} onChange={e=>updateMonth(currentMonth,{caixa:parseFloat(e.target.value)||0})}
                        style={{fontSize:22,fontWeight:700,color,border:"none",outline:"none",width:"100%",background:"transparent"}}/>
                    ):(
                      <div style={{fontSize:22,fontWeight:700,color}}>{value}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Gráfico lançamentos */}
              {(monthData.manual||[]).length>0 && (
                <div style={{background:"#fff",border:"1px solid #eee",borderRadius:14,padding:"22px 28px",marginBottom:20}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:16,color:"#333"}}>Saídas manuais por categoria</div>
                  <BarChart transactions={(monthData.manual||[]).filter(e=>e.type==="saida")} />
                </div>
              )}

              {/* Adicionar */}
              <div style={{background:"#fff",border:"1px solid #eee",borderRadius:14,padding:"20px 28px",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:"#333"}}>+ Novo lançamento</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <input value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="Descrição" onKeyDown={e=>e.key==="Enter"&&addEntry()}
                    style={{flex:2,minWidth:160,padding:"9px 14px",border:"1px solid #ddd",borderRadius:8,fontSize:13,outline:"none",background:"#fff",color:"#333"}}/>
                  <input value={newAmount} onChange={e=>setNewAmount(e.target.value)} placeholder="Valor" onKeyDown={e=>e.key==="Enter"&&addEntry()}
                    style={{flex:1,minWidth:100,padding:"9px 14px",border:"1px solid #ddd",borderRadius:8,fontSize:13,outline:"none",background:"#fff",color:"#333"}}/>
                  <select value={newType} onChange={e=>setNewType(e.target.value)} style={{padding:"9px 12px",border:"1px solid #ddd",borderRadius:8,fontSize:13,cursor:"pointer",outline:"none",background:"#fff",color:"#333"}}>
                    <option value="saida">Saída</option>
                    <option value="entrada">Entrada</option>
                  </select>
                  <select value={newCat} onChange={e=>setNewCat(e.target.value)} style={{padding:"9px 12px",border:"1px solid #ddd",borderRadius:8,fontSize:13,cursor:"pointer",outline:"none",background:"#fff",color:"#333"}}>
                    {CATS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={()=>setNewFixo(f=>!f)} style={{padding:"9px 14px",borderRadius:8,border:`1px solid ${newFixo?"#3b82f6":"#ddd"}`,background:newFixo?"#eff6ff":"#fff",color:newFixo?"#3b82f6":"#aaa",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                    {newFixo?"🔁 Fixo":"Fixo?"}
                  </button>
                  <button onClick={addEntry} style={{padding:"9px 20px",background:"#1e1e1e",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>Adicionar</button>
                </div>
              </div>

              {/* Lista */}
              {(monthData.manual||[]).length>0 && (
                <div style={{background:"#fff",border:"1px solid #eee",borderRadius:14,overflow:"hidden"}}>
                  {(monthData.manual||[]).map((e,i)=>(
                    <div key={e.id} className="entry-row" style={{display:"flex",alignItems:"center",gap:10,padding:"11px 20px",borderLeft:`3px solid ${e.type==="entrada"?"#22c55e":"#ef4444"}`,borderBottom:i<(monthData.manual||[]).length-1?"1px solid #f5f5f5":"none",background:"#fff",transition:"background 0.1s"}}>
                      <div style={{flex:1,fontSize:13,color:"#333",textAlign:"left"}}>{e.desc}</div>
                      {e.fixo&&<span style={{fontSize:9,background:"#eff6ff",color:"#3b82f6",padding:"2px 6px",borderRadius:4,fontWeight:700}}>🔁</span>}
                      <div style={{fontSize:10,background:CAT_COLORS[e.cat]?`${CAT_COLORS[e.cat]}20`:"#f0f0f0",color:CAT_COLORS[e.cat]||"#666",padding:"2px 8px",borderRadius:4,fontWeight:600}}>{e.cat}</div>
                      <div style={{fontSize:14,fontWeight:700,color:e.type==="entrada"?"#22c55e":"#ef4444",minWidth:100,textAlign:"right"}}>{e.type==="entrada"?"+":"-"}{fmt(e.amount)}</div>
                      <button onClick={()=>removeEntry(e.id)} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── FATURAS PDF ── */}
          {tab==="faturas" && (
            <div>
              <div style={{display:"flex",gap:12,marginBottom:24}}>
                {CARDS.map(c=>(
                  <button key={c.id} onClick={()=>setActiveCard(c.id)} style={{flex:1,padding:"16px 22px",borderRadius:14,border:`2px solid ${activeCard===c.id?c.color:"#eee"}`,background:activeCard===c.id?`${c.color}08`:"#fff",textAlign:"left",cursor:"pointer",transition:"all 0.15s"}}>
                    <div style={{fontSize:11,color:"#aaa",marginBottom:4,letterSpacing:1}}>CARTÃO</div>
                    <div style={{fontSize:15,fontWeight:700,color:activeCard===c.id?c.color:"#333"}}>{c.label}</div>
                    {(monthData.cardsData||{})[c.id]&&(
                      <div style={{fontSize:12,color:"#888",marginTop:4}}>{fmt((monthData.cardsData||{})[c.id].total)} · {(monthData.cardsData||{})[c.id].transactions.length} itens</div>
                    )}
                  </button>
                ))}
              </div>

              {!cardData&&!parsing&&(
                <div onClick={()=>fileRef.current?.click()} style={{border:"2px dashed #ddd",borderRadius:16,padding:"56px 32px",textAlign:"center",cursor:"pointer",background:"#fff",transition:"all 0.2s"}}>
                  <div style={{fontSize:48,marginBottom:14}}>📄</div>
                  <div style={{fontSize:17,fontWeight:600,color:"#333",marginBottom:6}}>Sobe a fatura {CARDS.find(c=>c.id===activeCard)?.label} em PDF</div>
                  <div style={{fontSize:13,color:"#aaa"}}>O agente lê, categoriza e projeta as parcelas automaticamente</div>
                  <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
                </div>
              )}

              {parsing&&(
                <div style={{background:"#fff",borderRadius:16,padding:"56px 32px",textAlign:"center",border:"1px solid #eee"}}>
                  <div style={{width:36,height:36,border:"3px solid #3b82f6",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 16px"}}/>
                  <div style={{fontSize:16,fontWeight:600}}>Lendo fatura...</div>
                  <div style={{fontSize:13,color:"#aaa",marginTop:6}}>Identificando transações e parcelas futuras</div>
                </div>
              )}

              {cardData&&!parsing&&(
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
                    {[
                      {label:"Total fatura",value:fmt(cardData.total),color:"#ef4444"},
                      {label:"Transações",value:cardData.transactions.length,color:"#3b82f6"},
                      {label:"Audazi/PJ",value:fmt(cardData.transactions.filter(t=>t.audazi).reduce((a,t)=>a+t.amount,0)),color:"#6366f1"},
                    ].map(({label,value,color})=>(
                      <div key={label} style={{background:"#fff",border:"1px solid #eee",borderRadius:14,padding:"18px 22px"}}>
                        <div style={{fontSize:10,color:"#aaa",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{label}</div>
                        <div style={{fontSize:22,fontWeight:700,color}}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{background:"#fff",border:"1px solid #eee",borderRadius:14,padding:"22px 28px",marginBottom:16}}>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:16}}>Por categoria</div>
                    <BarChart transactions={cardData.transactions}/>
                  </div>
                  <div style={{background:"#fff",border:"1px solid #eee",borderRadius:14,overflow:"hidden"}}>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #f0f0f0"}}>
                      <div style={{fontSize:13,fontWeight:600}}>Lançamentos — {cardData.fileName}</div>
                      <button onClick={()=>{const upd={...state};delete upd.months[currentMonth].cardsData[activeCard];persist(upd);}} style={{fontSize:11,color:"#ef4444",background:"none",border:"1px solid #fecaca",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Trocar PDF</button>
                    </div>
                    <div style={{maxHeight:380,overflowY:"auto"}}>
                      {cardData.transactions.map((t,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 20px",borderLeft:`3px solid ${CAT_COLORS[t.cat]||"#ccc"}`,borderBottom:"1px solid #f9f9f9",background:"#fff"}}>
                          <span style={{fontSize:11,color:"#aaa",width:42,flexShrink:0}}>{t.date}</span>
                          <span style={{flex:1,fontSize:12,color:"#333"}}>{t.desc}</span>
                          {t.audazi&&<span style={{fontSize:9,background:"#6366f1",color:"#fff",padding:"1px 6px",borderRadius:3}}>PJ</span>}
                          <span style={{fontSize:10,border:"1px solid #eee",borderRadius:4,padding:"2px 6px",color:"#666"}}>{t.cat}</span>
                          <span style={{fontSize:13,fontWeight:700,color:"#ef4444",minWidth:90,textAlign:"right"}}>{fmt(t.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── FLUXO DE CAIXA ── */}
          {tab==="fluxo" && (
            <div>
              <div style={{marginBottom:20,fontSize:13,color:"#666"}}>
                Projeção dos próximos meses com faturas e parcelas identificadas automaticamente.
              </div>
              {MONTHS.filter(m=>m>=currentMonth).map(m=>{
                const items = fluxoData[m]||[];
                const total = items.filter(i=>i.type==="saida").reduce((a,b)=>a+b.amount,0);
                if (!items.length) return null;
                return (
                  <div key={m} style={{background:"#fff",border:"1px solid #eee",borderRadius:14,padding:"20px 24px",marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                      <div style={{fontSize:15,fontWeight:700,color:"#333"}}>{MONTH_LABELS[m]}</div>
                      <div style={{fontSize:20,fontWeight:700,color:"#ef4444"}}>{fmt(total)}</div>
                    </div>
                    {items.map((item,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:"1px solid #f5f5f5"}}>
                        <span style={{fontSize:10,background:item.source==="fatura"?"#fef2f2":item.source==="parcela"?"#eff6ff":"#f5f5f5",color:item.source==="fatura"?"#ef4444":item.source==="parcela"?"#3b82f6":"#666",padding:"2px 8px",borderRadius:4,fontWeight:600,flexShrink:0}}>
                          {item.source==="fatura"?"FATURA":item.source==="parcela"?"PARCELA":"MANUAL"}
                        </span>
                        <span style={{flex:1,fontSize:13,color:"#333"}}>{item.desc}</span>
                        <span style={{fontSize:13,fontWeight:600,color:"#ef4444"}}>{fmt(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {!MONTHS.filter(m=>m>=currentMonth).some(m=>(fluxoData[m]||[]).length>0)&&(
                <div style={{background:"#fff",borderRadius:14,padding:"48px 32px",textAlign:"center",border:"1px solid #eee"}}>
                  <div style={{fontSize:40,marginBottom:12}}>📈</div>
                  <div style={{fontSize:15,fontWeight:600,color:"#333"}}>Suba uma fatura para gerar o fluxo</div>
                  <div style={{fontSize:13,color:"#aaa",marginTop:6}}>As parcelas serão projetadas automaticamente nos meses seguintes</div>
                </div>
              )}
            </div>
          )}

          {/* ── AGENTE ── */}
          {tab==="chat" && (
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:16,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",borderBottom:"1px solid #eee"}}>
                {[
                  {label:"Saldo "+MONTH_LABELS[currentMonth],value:fmt(saldo),color:saldo>=0?"#22c55e":"#ef4444"},
                  {label:"Total faturas",value:fmt(Object.values(monthData.cardsData||{}).reduce((a,c)=>a+(c?.total||0),0)),color:"#ef4444"},
                  {label:"Comprometido futuro",value:fmt(Object.values(fluxoData).flat().filter(f=>f.type==="saida").reduce((a,b)=>a+b.amount,0)),color:"#f59e0b"},
                ].map(({label,value,color})=>(
                  <div key={label} style={{padding:"16px 24px",borderRight:"1px solid #eee"}}>
                    <div style={{fontSize:10,color:"#aaa",letterSpacing:2}}>{label.toUpperCase()}</div>
                    <div style={{fontSize:18,fontWeight:700,color}}>{value}</div>
                  </div>
                ))}
              </div>
              <div ref={chatRef} style={{height:340,overflowY:"auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:12}}>
                {messages.map((m,i)=>(
                  <div key={i} className="msg" style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                    <div style={{maxWidth:"80%",padding:"10px 16px",borderRadius:m.role==="user"?"14px 14px 2px 14px":"14px 14px 14px 2px",background:m.role==="user"?"#1e1e1e":"#f5f5f5",color:m.role==="user"?"#fff":"#333",fontSize:13,lineHeight:1.6}}>{m.content}</div>
                  </div>
                ))}
                {chatLoading&&<div style={{display:"flex",gap:5,padding:"10px 16px",background:"#f5f5f5",borderRadius:"14px 14px 14px 2px",width:"fit-content"}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#bbb",animation:`spin ${0.8+i*0.15}s linear infinite`}}/>)}</div>}
              </div>
              <div style={{padding:"0 24px 10px",display:"flex",gap:6,flexWrap:"wrap"}}>
                {["Onde gastei mais?","Qual meu fluxo futuro?","O que é Audazi?","Onde cortar?"].map(s=>(
                  <button key={s} onClick={()=>sendChat(s)} style={{background:"#f5f5f5",border:"1px solid #eee",borderRadius:20,color:"#555",fontSize:11,padding:"4px 12px",cursor:"pointer"}}>{s}</button>
                ))}
              </div>
              <div style={{padding:"0 24px 24px"}}>
                <div style={{display:"flex",gap:8,background:"#f8f8f8",borderRadius:12,padding:"10px 16px",border:"1px solid #eee"}}>
                  <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()}
                    placeholder="Pergunte sobre seus gastos..." style={{flex:1,background:"transparent",border:"none",fontSize:13,color:"#333",outline:"none"}}/>
                  <button onClick={startVoice} style={{background:listening?"#ef4444":"#fff",border:"1px solid #ddd",borderRadius:8,padding:"6px 10px",fontSize:15,cursor:"pointer",color:listening?"#fff":"#555"}}>{listening?"⏹":"🎤"}</button>
                  <button onClick={()=>sendChat()} disabled={chatLoading} style={{background:"#1e1e1e",border:"none",borderRadius:8,color:"#fff",padding:"6px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>→</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}