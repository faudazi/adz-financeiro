import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "adz-fin-v4";

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

const fmt = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const defaultManual = [
  { id: 1, desc: "Contas de abril", amount: 17500, type: "saida", cat: "Fixo", month: "2026-04" },
  { id: 2, desc: "Boston – viagem", amount: 5000, type: "saida", cat: "Viagem", month: "2026-04" },
  { id: 3, desc: "Celular da irmã", amount: 3700, type: "saida", cat: "Pessoal", month: "2026-04" },
  { id: 4, desc: "Etiquetas Audazi", amount: 1000, type: "saida", cat: "Audazi/PJ", month: "2026-04" },
  { id: 5, desc: "Bonés Audazi", amount: 1840, type: "saida", cat: "Audazi/PJ", month: "2026-04" },
];

function dbLoad() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function dbSave(d) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {} }

async function parsePDF(base64, cardLabel) {
  const extractResp = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 8000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: "Extraia todas as transações desta fatura. Retorne apenas o texto bruto com todas as linhas de transações, datas e valores." }
      ]}]
    }),
  });
  const eData = await extractResp.json();
  const text = eData.content?.[0]?.text || "";

  const parseResp = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 4000,
      system: `Parse fatura brasileira. Categorias: ${CATS.join(", ")}. 
Retorne APENAS JSON válido sem markdown:
{"transactions":[{"date":"DD/MM","desc":"nome limpo","amount":123.45,"cat":"Categoria","audazi":false}],"total":1234.56}
amount sempre positivo. audazi:true se parecer gasto de negócio/empresa.`,
      messages: [{ role: "user", content: `Fatura ${cardLabel}:\n${text.substring(0, 12000)}` }]
    }),
  });
  const pData = await parseResp.json();
  const txt = pData.content?.[0]?.text || "{}";
  try { return JSON.parse(txt.replace(/```json|```/g, "").trim()); }
  catch { return { transactions: [], total: 0 }; }
}

async function chatAI(messages, context) {
  const resp = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1000,
      system: `Você é o assistente financeiro do Fabiano Audazi. Contexto atual:\n${JSON.stringify(context, null, 2)}\nSeja direto e analítico. Máximo 3 parágrafos.`,
      messages,
    }),
  });
  const d = await resp.json();
  return d.content?.[0]?.text || "Erro.";
}

// ── Bar Chart ──────────────────────────────────────────────────────────────
function BarChart({ transactions }) {
  const totals = {};
  transactions.forEach(t => { totals[t.cat] = (totals[t.cat] || 0) + t.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sorted.map(([cat, val]) => (
        <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 90, fontSize: 11, color: "#666", textAlign: "right", flexShrink: 0 }}>{cat}</div>
          <div style={{ flex: 1, height: 22, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 4, background: CAT_COLORS[cat] || "#94a3b8", width: `${(val / max) * 100}%`, transition: "width 0.5s", display: "flex", alignItems: "center", paddingLeft: 8 }}>
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(val)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("manual");
  const [caixa, setCaixa] = useState(25000);
  const [manual, setManual] = useState(defaultManual);
  const [cardsData, setCardsData] = useState({});
  const [activeCard, setActiveCard] = useState("itau");
  const [parsing, setParsing] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", content: "Fala, Fabiano. Posso analisar suas faturas ou responder sobre seus lançamentos manuais." }]);
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
    const d = dbLoad();
    if (!d) return;
    if (d.caixa !== undefined) setCaixa(d.caixa);
    if (d.manual) setManual(d.manual);
    if (d.cardsData) setCardsData(d.cardsData);
  }, []);

  const persist = (updates) => {
    const next = { caixa, manual, cardsData, ...updates };
    if (updates.caixa !== undefined) setCaixa(updates.caixa);
    if (updates.manual !== undefined) setManual(updates.manual);
    if (updates.cardsData !== undefined) setCardsData(updates.cardsData);
    dbSave(next);
  };

  const saidas = manual.filter(e => e.type === "saida").reduce((a, b) => a + b.amount, 0);
  const entradas = manual.filter(e => e.type === "entrada").reduce((a, b) => a + b.amount, 0);
  const saldo = caixa + entradas - saidas;

  const addEntry = () => {
    if (!newDesc || !newAmount) return;
    const entry = { id: Date.now(), desc: newDesc, amount: parseFloat(newAmount.replace(",", ".")), type: newType, cat: newCat, month: "2026-04", fixo: newFixo };
    const updated = [...manual, entry];
    persist({ manual: updated });
    setNewDesc(""); setNewAmount("");
  };

  const removeEntry = (id) => persist({ manual: manual.filter(e => e.id !== id) });

  const handleFile = async (file) => {
    if (!file) return;
    setParsing(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const card = CARDS.find(c => c.id === activeCard);
      const parsed = await parsePDF(base64, card.label);
      const updated = { ...cardsData, [activeCard]: { transactions: parsed.transactions || [], total: parsed.total || 0, fileName: file.name } };
      persist({ cardsData: updated });
    } catch { alert("Erro ao processar PDF."); }
    setParsing(false);
  };

  const updateTxCat = (cardId, idx, cat) => {
    const updated = { ...cardsData };
    updated[cardId].transactions[idx].cat = cat;
    persist({ cardsData: updated });
  };

  const sendChat = async (text) => {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    setChatLoading(true);
    const newMsgs = [...messages, { role: "user", content: msg }];
    setMessages(newMsgs);
    const newApi = [...apiMsgs, { role: "user", content: msg }];
    const reply = await chatAI(newApi, { caixa, saldo, manual, cardsData });
    setMessages([...newMsgs, { role: "assistant", content: reply }]);
    setApiMsgs([...newApi, { role: "assistant", content: reply }]);
    setChatLoading(false);
  };

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Use Chrome para voz."); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = "pt-BR"; rec.continuous = false; rec.interimResults = false;
    rec.onresult = e => { setChatInput(e.results[0][0].transcript); setListening(false); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  };

  const allTx = Object.values(cardsData).flatMap(c => c?.transactions || []);
  const cardData = cardsData[activeCard];

  const TABS = [["manual", "📋 Lançamentos"], ["faturas", "💳 Faturas PDF"], ["analise", "📊 Análise"], ["chat", "💬 Agente"]];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        html, body, #root { margin: 0; padding: 0; background: #f0f2f5; min-height: 100vh; width: 100%; }
        * { box-sizing: border-box; }
        button, input, select { font-family: inherit; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        .msg { animation: fadeUp 0.2s ease; }
        .upload-zone:hover { border-color: #3b82f6 !important; background: #eff6ff !important; }
        .entry-row:hover { background: #fafafa !important; }
        .tab-btn:hover { background: #f5f5f5 !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'DM Sans', system-ui, sans-serif", width: "100%" }}>

        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "0 40px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: "#111" }}>
                ADZ<span style={{ color: "#3b82f6" }}>.</span>FINANCEIRO
              </span>
              <span style={{ fontSize: 11, color: "#999", letterSpacing: 3 }}>ABRIL 2026</span>
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              {TABS.map(([t, l]) => (
                <button key={t} className="tab-btn" onClick={() => setTab(t)} style={{
                  padding: "7px 18px", borderRadius: 8, border: "none",
                  background: tab === t ? "#1e1e1e" : "transparent",
                  color: tab === t ? "#fff" : "#666",
                  fontSize: 13, fontWeight: tab === t ? 600 : 400, cursor: "pointer",
                  transition: "all 0.15s",
                }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: "24px 40px", width: "100%", maxWidth: "100%" }}>

          {/* ── LANÇAMENTOS MANUAIS ── */}
          {tab === "manual" && (
            <div>
              {/* Saldo cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
                {[
                  { label: "Caixa inicial", value: fmt(caixa), color: "#3b82f6", editable: true },
                  { label: "Entradas", value: fmt(entradas), color: "#22c55e" },
                  { label: "Saídas", value: fmt(saidas), color: "#ef4444" },
                  { label: "Saldo", value: fmt(saldo), color: saldo >= 0 ? "#22c55e" : "#ef4444" },
                ].map(({ label, value, color, editable }) => (
                  <div key={label} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "18px 22px" }}>
                    <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
                    {editable ? (
                      <input
                        type="number"
                        value={caixa}
                        onChange={e => persist({ caixa: parseFloat(e.target.value) || 0 })}
                        style={{ fontSize: 22, fontWeight: 700, color, border: "none", outline: "none", width: "100%", background: "transparent" }}
                      />
                    ) : (
                      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Gráfico */}
              {manual.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "22px 28px", marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: "#333" }}>Saídas por categoria</div>
                  <BarChart transactions={manual.filter(e => e.type === "saida")} />
                </div>
              )}

              {/* Adicionar */}
              <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "20px 28px", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: "#333" }}>+ Novo lançamento</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descrição" onKeyDown={e => e.key === "Enter" && addEntry()}
                    style={{ flex: 2, minWidth: 160, padding: "9px 14px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff", color: "#333" }} />
                  <input value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="Valor" onKeyDown={e => e.key === "Enter" && addEntry()}
                    style={{ flex: 1, minWidth: 100, padding: "9px 14px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff", color: "#333" }} />
                  <select value={newType} onChange={e => setNewType(e.target.value)}
                    style={{ padding: "9px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, cursor: "pointer", outline: "none", background: "#fff", color: "#333" }}>
                    <option value="saida">Saída</option>
                    <option value="entrada">Entrada</option>
                  </select>
                  <select value={newCat} onChange={e => setNewCat(e.target.value)}
                    style={{ padding: "9px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, cursor: "pointer", outline: "none", background: "#fff", color: "#333" }}>
                    {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={() => setNewFixo(f => !f)} style={{
                    padding: "9px 14px", borderRadius: 8, border: `1px solid ${newFixo ? "#3b82f6" : "#eee"}`,
                    background: newFixo ? "#eff6ff" : "#fff", color: newFixo ? "#3b82f6" : "#aaa",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}>
                    {newFixo ? "🔁 Fixo" : "Fixo?"}
                  </button>
                  <button onClick={addEntry} style={{ padding: "9px 20px", background: "#1e1e1e", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Adicionar
                  </button>
                </div>
              </div>

              {/* Lista */}
              <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
                {manual.map((e, i) => (
                  <div key={e.id} className="entry-row" style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "11px 20px",
                    borderLeft: `3px solid ${e.type === "entrada" ? "#22c55e" : "#ef4444"}`,
                    borderBottom: i < manual.length - 1 ? "1px solid #f5f5f5" : "none",
                    background: "#fff", transition: "background 0.1s",
                  }}>
                    <div style={{ flex: 1, fontSize: 13, color: "#333", textAlign: "left" }}>{e.desc}</div>
                    {e.fixo && <span style={{ fontSize: 9, background: "#eff6ff", color: "#3b82f6", padding: "2px 6px", borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>🔁 FIXO</span>}
                    <div style={{ fontSize: 10, background: CAT_COLORS[e.cat] ? `${CAT_COLORS[e.cat]}20` : "#f0f0f0", color: CAT_COLORS[e.cat] || "#666", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{e.cat}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: e.type === "entrada" ? "#22c55e" : "#ef4444", minWidth: 100, textAlign: "right" }}>
                      {e.type === "entrada" ? "+" : "-"}{fmt(e.amount)}
                    </div>
                    <button onClick={() => removeEntry(e.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── FATURAS PDF ── */}
          {tab === "faturas" && (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                {CARDS.map(c => (
                  <button key={c.id} onClick={() => setActiveCard(c.id)} style={{
                    flex: 1, padding: "16px 22px", borderRadius: 14, border: `2px solid ${activeCard === c.id ? c.color : "#eee"}`,
                    background: activeCard === c.id ? `${c.color}08` : "#fff", textAlign: "left", cursor: "pointer", transition: "all 0.15s",
                  }}>
                    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4, letterSpacing: 1 }}>CARTÃO</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: activeCard === c.id ? c.color : "#333" }}>{c.label}</div>
                    {cardsData[c.id] && (
                      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                        {fmt(cardsData[c.id].total)} · {cardsData[c.id].transactions.length} itens
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {!cardData && !parsing && (
                <div className="upload-zone" onClick={() => fileRef.current?.click()} style={{
                  border: "2px dashed #ddd", borderRadius: 16, padding: "56px 32px",
                  textAlign: "center", cursor: "pointer", background: "#fff", transition: "all 0.2s",
                }}>
                  <div style={{ fontSize: 48, marginBottom: 14 }}>📄</div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: "#333", marginBottom: 6 }}>
                    Sobe a fatura {CARDS.find(c => c.id === activeCard)?.label} em PDF
                  </div>
                  <div style={{ fontSize: 13, color: "#aaa" }}>O agente lê e categoriza tudo automaticamente</div>
                  <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                </div>
              )}

              {parsing && (
                <div style={{ background: "#fff", borderRadius: 16, padding: "56px 32px", textAlign: "center", border: "1px solid #eee" }}>
                  <div style={{ width: 36, height: 36, border: "3px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Lendo fatura...</div>
                  <div style={{ fontSize: 13, color: "#aaa", marginTop: 6 }}>Isso pode levar 30 segundos</div>
                </div>
              )}

              {cardData && !parsing && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
                    {[
                      { label: "Total fatura", value: fmt(cardData.total), color: "#ef4444" },
                      { label: "Transações", value: cardData.transactions.length, color: "#3b82f6" },
                      { label: "Audazi/PJ", value: fmt(cardData.transactions.filter(t => t.audazi).reduce((a, t) => a + t.amount, 0)), color: "#6366f1" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "18px 22px" }}>
                        <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "22px 28px", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Por categoria</div>
                    <BarChart transactions={cardData.transactions} />
                  </div>

                  <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f0f0f0" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Lançamentos — {cardData.fileName}</div>
                      <button onClick={() => { const u = { ...cardsData }; delete u[activeCard]; persist({ cardsData: u }); }}
                        style={{ fontSize: 11, color: "#ef4444", background: "none", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                        Trocar PDF
                      </button>
                    </div>
                    <div style={{ maxHeight: 380, overflowY: "auto" }}>
                      {cardData.transactions.map((t, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 20px",
                          borderLeft: `3px solid ${CAT_COLORS[t.cat] || "#ccc"}`,
                          borderBottom: "1px solid #f9f9f9", background: "#fff",
                        }}>
                          <span style={{ fontSize: 11, color: "#aaa", width: 42, flexShrink: 0 }}>{t.date}</span>
                          <span style={{ flex: 1, fontSize: 12, color: "#333" }}>{t.desc}</span>
                          {t.audazi && <span style={{ fontSize: 9, background: "#6366f1", color: "#fff", padding: "1px 6px", borderRadius: 3 }}>PJ</span>}
                          <select value={t.cat} onChange={e => updateTxCat(activeCard, i, e.target.value)}
                            style={{ fontSize: 10, border: "1px solid #eee", borderRadius: 4, padding: "2px 4px", cursor: "pointer", outline: "none" }}>
                            {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", minWidth: 90, textAlign: "right" }}>{fmt(t.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ANÁLISE ── */}
          {tab === "analise" && (
            <div>
              {allTx.length === 0 && manual.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#aaa" }}>Nenhum dado ainda. Adicione lançamentos ou suba uma fatura.</div>
              ) : (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 24 }}>
                    {[
                      { label: "Total faturas cartão", value: fmt(Object.values(cardsData).reduce((a, c) => a + (c?.total || 0), 0)), color: "#ef4444" },
                      { label: "Lançamentos manuais", value: fmt(saidas), color: "#f59e0b" },
                      { label: "Audazi/PJ (faturas)", value: fmt(allTx.filter(t => t.audazi).reduce((a, t) => a + t.amount, 0)), color: "#6366f1" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "20px 24px" }}>
                        <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {allTx.length > 0 && (
                    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "24px 28px", marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Faturas — todos os cartões</div>
                      <BarChart transactions={allTx} />
                    </div>
                  )}

                  {manual.length > 0 && (
                    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: "24px 28px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Lançamentos manuais</div>
                      <BarChart transactions={manual.filter(e => e.type === "saida")} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── AGENTE ── */}
          {tab === "chat" && (
            <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", borderBottom: "1px solid #eee" }}>
                {[
                  { label: "Saldo manual", value: fmt(saldo), color: saldo >= 0 ? "#22c55e" : "#ef4444" },
                  { label: "Total faturas", value: fmt(Object.values(cardsData).reduce((a, c) => a + (c?.total || 0), 0)), color: "#ef4444" },
                  { label: "Transações PDF", value: allTx.length, color: "#3b82f6" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ padding: "16px 24px", borderRight: "1px solid #eee" }}>
                    <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 2 }}>{label.toUpperCase()}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>

              <div ref={chatRef} style={{ height: 360, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                {messages.map((m, i) => (
                  <div key={i} className="msg" style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "80%", padding: "10px 16px",
                      borderRadius: m.role === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                      background: m.role === "user" ? "#1e1e1e" : "#f5f5f5",
                      color: m.role === "user" ? "#fff" : "#333", fontSize: 13, lineHeight: 1.6,
                    }}>{m.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: "flex", gap: 5, padding: "10px 16px", background: "#f5f5f5", borderRadius: "14px 14px 14px 2px", width: "fit-content" }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#bbb", animation: `spin ${0.8 + i * 0.15}s linear infinite` }} />)}
                  </div>
                )}
              </div>

              <div style={{ padding: "0 24px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Onde gastei mais?", "O que é Audazi?", "Onde cortar?", "Compare cartões", "Qual meu saldo real?"].map(s => (
                  <button key={s} onClick={() => sendChat(s)} style={{
                    background: "#f5f5f5", border: "1px solid #eee", borderRadius: 20,
                    color: "#555", fontSize: 11, padding: "4px 12px", cursor: "pointer",
                  }}>{s}</button>
                ))}
              </div>

              <div style={{ padding: "0 24px 24px" }}>
                <div style={{ display: "flex", gap: 8, background: "#f8f8f8", borderRadius: 12, padding: "10px 16px", border: "1px solid #eee" }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()}
                    placeholder="Pergunte sobre seus gastos..." style={{ flex: 1, background: "transparent", border: "none", fontSize: 13, color: "#333", outline: "none" }} />
                  <button onClick={startVoice} style={{
                    background: listening ? "#ef4444" : "#fff", border: "1px solid #ddd",
                    borderRadius: 8, padding: "6px 10px", fontSize: 15, cursor: "pointer",
                    color: listening ? "#fff" : "#555",
                  }}>{listening ? "⏹" : "🎤"}</button>
                  <button onClick={() => sendChat()} disabled={chatLoading} style={{
                    background: "#1e1e1e", border: "none", borderRadius: 8,
                    color: "#fff", padding: "6px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>→</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}