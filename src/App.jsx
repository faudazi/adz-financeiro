import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "adz-fin-v3";

const CATS = ["Alimentação", "Transporte", "Saúde", "Lazer", "Viagem", "Assinaturas", "Vestuário", "Audazi/PJ", "Casa", "Outro"];
const CAT_COLORS = {
  "Alimentação": "#f59e0b", "Transporte": "#3b82f6", "Saúde": "#22c55e",
  "Lazer": "#a855f7", "Viagem": "#06b6d4", "Assinaturas": "#f43f5e",
  "Vestuário": "#ec4899", "Audazi/PJ": "#6366f1", "Casa": "#84cc16", "Outro": "#94a3b8",
};

const CARDS = [
  { id: "itau", label: "Itaú Uniclass", color: "#ef4444" },
  { id: "nubank", label: "Nubank", color: "#a855f7" },
];

const fmt = (v, usd = false) => usd
  ? `$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
  : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function load() {
  try { const r = await window.storage.get(STORAGE_KEY); return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
async function save(d) { try { await window.storage.set(STORAGE_KEY, JSON.stringify(d)); } catch {} }

// ── AI: parse PDF text into transactions ───────────────────────────────────
async function parseFatura(text, cardLabel) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: `Você é um parser de faturas de cartão de crédito brasileiro.
Extraia TODAS as transações do texto da fatura e categorize cada uma.
Categorias disponíveis: ${CATS.join(", ")}.
Retorne APENAS JSON válido, sem markdown:
{"transactions":[{"date":"DD/MM","desc":"descrição limpa","amount":123.45,"cat":"Categoria","audazi":false}],"total":1234.56}
- amount sempre positivo (em reais)
- audazi: true se parecer gasto de negócio/empresa
- date no formato DD/MM
- desc: nome limpo do estabelecimento`,
      messages: [{ role: "user", content: `Fatura ${cardLabel}:\n\n${text.substring(0, 15000)}` }],
    }),
  });
  const data = await resp.json();
  const txt = data.content?.[0]?.text || "{}";
  try {
    const clean = txt.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch { return { transactions: [], total: 0 }; }
}

// ── AI: chat agent ─────────────────────────────────────────────────────────
async function chatAgent(messages, context) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `Você é o assistente financeiro do Fabiano Audazi.
Contexto atual das faturas:
${JSON.stringify(context, null, 2)}
Responda em português, de forma direta e analítica. Máximo 3 parágrafos.`,
      messages,
    }),
  });
  const data = await resp.json();
  return data.content?.[0]?.text || "Erro ao processar.";
}

// ── Bar Chart ──────────────────────────────────────────────────────────────
function BarChart({ transactions }) {
  const catTotals = {};
  transactions.forEach(t => { catTotals[t.cat] = (catTotals[t.cat] || 0) + t.amount; });
  const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sorted.map(([cat, val]) => (
        <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 80, fontSize: 11, color: "#555", textAlign: "right", flexShrink: 0 }}>{cat}</div>
          <div style={{ flex: 1, height: 20, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4,
              background: CAT_COLORS[cat] || "#94a3b8",
              width: `${(val / max) * 100}%`,
              transition: "width 0.5s ease",
              display: "flex", alignItems: "center", paddingLeft: 6,
            }}>
              <span style={{ fontSize: 10, color: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(val)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Transaction List ───────────────────────────────────────────────────────
function TxList({ transactions, onCatChange }) {
  const [filter, setFilter] = useState("Todas");
  const filtered = filter === "Todas" ? transactions : transactions.filter(t => t.cat === filter);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {["Todas", ...CATS].map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{
            padding: "3px 10px", borderRadius: 20, border: "1px solid #ddd",
            background: filter === c ? "#1e1e1e" : "#fff",
            color: filter === c ? "#fff" : "#555",
            fontSize: 11, cursor: "pointer",
          }}>{c}</button>
        ))}
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
        {filtered.map((t, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
            background: i % 2 === 0 ? "#fafafa" : "#fff",
            borderRadius: 6, borderLeft: `3px solid ${CAT_COLORS[t.cat] || "#ccc"}`,
          }}>
            <span style={{ fontSize: 11, color: "#999", width: 40, flexShrink: 0 }}>{t.date}</span>
            <span style={{ flex: 1, fontSize: 12, color: "#333" }}>{t.desc}</span>
            {t.audazi && <span style={{ fontSize: 9, background: "#6366f1", color: "#fff", padding: "1px 5px", borderRadius: 3 }}>PJ</span>}
            <select
              value={t.cat}
              onChange={e => onCatChange(i, e.target.value)}
              style={{ fontSize: 10, border: "1px solid #eee", borderRadius: 4, padding: "2px 4px", background: "#fff", color: "#555" }}
            >
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#ef4444", minWidth: 80, textAlign: "right" }}>
              {fmt(t.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [cardsData, setCardsData] = useState({});
  const [activeCard, setActiveCard] = useState("itau");
  const [tab, setTab] = useState("faturas");
  const [parsing, setParsing] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Fala, Fabiano. Sobe sua fatura em PDF e eu analiso tudo pra você — onde foi o dinheiro, o que é Audazi, onde cortar." }
  ]);
  const [apiMsgs, setApiMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef(null);
  const chatRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => { load().then(d => { if (d.cardsData) setCardsData(d.cardsData); }); }, []);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  const persist = (cd) => { setCardsData(cd); save({ cardsData: cd }); };

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

      // Use Claude to extract text from PDF
      const extractResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: "Extraia todo o texto desta fatura de cartão de crédito, incluindo todas as transações com datas e valores. Retorne apenas o texto extraído, sem comentários." }
            ]
          }]
        }),
      });
      const extractData = await extractResp.json();
      const text = extractData.content?.[0]?.text || "";

      const card = CARDS.find(c => c.id === activeCard);
      const parsed = await parseFatura(text, card.label);

      const updated = {
        ...cardsData,
        [activeCard]: {
          transactions: parsed.transactions || [],
          total: parsed.total || 0,
          fileName: file.name,
          uploadedAt: new Date().toLocaleDateString("pt-BR"),
        }
      };
      persist(updated);
    } catch (e) {
      alert("Erro ao processar PDF. Tente novamente.");
    }
    setParsing(false);
  };

  const updateCat = (cardId, idx, newCat) => {
    const updated = { ...cardsData };
    updated[cardId].transactions[idx].cat = newCat;
    persist(updated);
  };

  const sendChat = async (text) => {
    const msg = (text || input).trim();
    if (!msg || chatLoading) return;
    setInput("");
    setChatLoading(true);
    const newMsgs = [...messages, { role: "user", content: msg }];
    setMessages(newMsgs);
    const newApi = [...apiMsgs, { role: "user", content: msg }];
    const reply = await chatAgent(newApi, cardsData);
    setMessages([...newMsgs, { role: "assistant", content: reply }]);
    setApiMsgs([...newApi, { role: "assistant", content: reply }]);
    setChatLoading(false);
  };

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Seu navegador não suporta voz. Use Chrome."); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = e => { const t = e.results[0][0].transcript; setInput(t); setListening(false); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const card = CARDS.find(c => c.id === activeCard);
  const cardData = cardsData[activeCard];
  const allTx = Object.values(cardsData).flatMap(c => c?.transactions || []);
  const totalGeral = Object.values(cardsData).reduce((a, c) => a + (c?.total || 0), 0);

  // Summary by category across all cards
  const catSummary = {};
  allTx.forEach(t => { catSummary[t.cat] = (catSummary[t.cat] || 0) + t.amount; });
  const audaziTotal = allTx.filter(t => t.audazi).reduce((a, t) => a + t.amount, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button { cursor: pointer; font-family: inherit; }
        input, select { font-family: inherit; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .msg { animation: fadeUp 0.2s ease; }
        .upload-zone:hover { border-color: #3b82f6 !important; background: #eff6ff !important; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "0 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>
              ADZ<span style={{ color: "#3b82f6" }}>.</span>FINANCEIRO
            </span>
            <span style={{ fontSize: 11, color: "#aaa", letterSpacing: 2 }}>ABRIL 2026</span>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {[["faturas", "💳 Faturas"], ["analise", "📊 Análise"], ["chat", "💬 Agente"]].map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "6px 16px", borderRadius: 6, border: "none",
                background: tab === t ? "#1e1e1e" : "transparent",
                color: tab === t ? "#fff" : "#666",
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
              }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px", maxWidth: "100%" }}>

        {/* ── FATURAS TAB ── */}
        {tab === "faturas" && (
          <div>
            {/* Cartão selector */}
            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              {CARDS.map(c => (
                <button key={c.id} onClick={() => setActiveCard(c.id)} style={{
                  flex: 1, padding: "14px 20px", borderRadius: 12,
                  border: `2px solid ${activeCard === c.id ? c.color : "#eee"}`,
                  background: activeCard === c.id ? `${c.color}10` : "#fff",
                  textAlign: "left", transition: "all 0.15s",
                }}>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 4, letterSpacing: 1 }}>CARTÃO</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: activeCard === c.id ? c.color : "#333" }}>{c.label}</div>
                  {cardsData[c.id] && (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {fmt(cardsData[c.id].total)} · {cardsData[c.id].transactions.length} lançamentos
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Upload zone */}
            {!cardData && !parsing && (
              <div
                className="upload-zone"
                onClick={() => fileRef.current?.click()}
                style={{
                  border: "2px dashed #ddd", borderRadius: 16, padding: "48px 32px",
                  textAlign: "center", cursor: "pointer", background: "#fff",
                  transition: "all 0.2s", marginBottom: 24,
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 6 }}>
                  Sobe a fatura {card.label} em PDF
                </div>
                <div style={{ fontSize: 13, color: "#999" }}>
                  Clica aqui ou arrasta o arquivo · O agente lê e categoriza tudo automaticamente
                </div>
                <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
              </div>
            )}

            {parsing && (
              <div style={{ background: "#fff", borderRadius: 16, padding: "48px 32px", textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 32, height: 32, border: "3px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: "#333" }}>Analisando fatura...</div>
                <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>Lendo transações e categorizando</div>
              </div>
            )}

            {cardData && !parsing && (
              <div>
                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "Total da fatura", value: fmt(cardData.total), color: "#ef4444" },
                    { label: "Transações", value: cardData.transactions.length, color: "#3b82f6" },
                    { label: "Gastos Audazi/PJ", value: fmt(cardData.transactions.filter(t => t.audazi).reduce((a, t) => a + t.amount, 0)), color: "#6366f1" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #eee" }}>
                      <div style={{ fontSize: 11, color: "#999", marginBottom: 6, letterSpacing: 1 }}>{label.toUpperCase()}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #eee", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: "#333" }}>Gastos por categoria</div>
                  <BarChart transactions={cardData.transactions} />
                </div>

                {/* Transactions */}
                <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Lançamentos — {cardData.fileName}</div>
                    <button onClick={() => { const updated = { ...cardsData }; delete updated[activeCard]; persist(updated); }} style={{
                      fontSize: 11, color: "#ef4444", background: "none", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px",
                    }}>Trocar PDF</button>
                  </div>
                  <TxList transactions={cardData.transactions} onCatChange={(i, cat) => updateCat(activeCard, i, cat)} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ANÁLISE TAB ── */}
        {tab === "analise" && (
          <div>
            {allTx.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 16, padding: "48px 32px", textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#333" }}>Suba pelo menos uma fatura primeiro</div>
                <button onClick={() => setTab("faturas")} style={{ marginTop: 16, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13 }}>
                  Ir para Faturas
                </button>
              </div>
            ) : (
              <div>
                {/* Total geral */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
                  {[
                    { label: "Total geral cartões", value: fmt(totalGeral), color: "#ef4444", big: true },
                    { label: "Gastos Audazi/PJ", value: fmt(audaziTotal), color: "#6366f1" },
                    { label: "Gastos Pessoais", value: fmt(totalGeral - audaziTotal), color: "#f59e0b" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #eee" }}>
                      <div style={{ fontSize: 11, color: "#999", letterSpacing: 1, marginBottom: 6 }}>{label.toUpperCase()}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Consolidated chart */}
                <div style={{ background: "#fff", borderRadius: 12, padding: "24px", border: "1px solid #eee", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Todos os cartões — por categoria</div>
                  <BarChart transactions={allTx} />
                </div>

                {/* Per card breakdown */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                  {CARDS.filter(c => cardsData[c.id]).map(c => (
                    <div key={c.id} style={{ background: "#fff", borderRadius: 12, padding: "20px", border: `1px solid ${c.color}30` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontWeight: 700, color: c.color }}>{c.label}</span>
                        <span style={{ fontWeight: 700, color: "#ef4444" }}>{fmt(cardsData[c.id].total)}</span>
                      </div>
                      <BarChart transactions={cardsData[c.id].transactions} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CHAT TAB ── */}
        {tab === "chat" && (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #eee", overflow: "hidden" }}>
            {/* Quick stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", borderBottom: "1px solid #eee" }}>
              {[
                { label: "Total faturas", value: fmt(totalGeral), color: "#ef4444" },
                { label: "Audazi/PJ", value: fmt(audaziTotal), color: "#6366f1" },
                { label: "Transações", value: allTx.length, color: "#3b82f6" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: "14px 20px", borderRight: "1px solid #eee" }}>
                  <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1 }}>{label.toUpperCase()}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Messages */}
            <div ref={chatRef} style={{ height: 380, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((m, i) => (
                <div key={i} className="msg" style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: m.role === "user" ? "#1e1e1e" : "#f5f5f5",
                    color: m.role === "user" ? "#fff" : "#333",
                    fontSize: 13, lineHeight: 1.5,
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: "flex", gap: 5, padding: "10px 14px", background: "#f5f5f5", borderRadius: "12px 12px 12px 2px", width: "fit-content" }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#aaa", animation: `spin ${0.8 + i * 0.2}s linear infinite` }} />)}
                </div>
              )}
            </div>

            {/* Suggestions */}
            <div style={{ padding: "0 24px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["Onde gastei mais?", "Quanto é Audazi?", "Onde posso cortar?", "Compare os cartões"].map(s => (
                <button key={s} onClick={() => sendChat(s)} style={{
                  background: "#f5f5f5", border: "1px solid #eee", borderRadius: 20,
                  color: "#555", fontSize: 11, padding: "4px 12px",
                }}>{s}</button>
              ))}
            </div>

            {/* Input */}
            <div style={{ padding: "0 24px 20px" }}>
              <div style={{ display: "flex", gap: 8, background: "#f5f5f5", borderRadius: 12, padding: "10px 14px", border: "1px solid #eee" }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendChat()}
                  placeholder="Pergunte sobre seus gastos..."
                  style={{ flex: 1, background: "transparent", border: "none", fontSize: 13, color: "#333", outline: "none" }}
                />
                <button onClick={startVoice} style={{
                  background: listening ? "#ef4444" : "#fff",
                  border: "1px solid #ddd", borderRadius: 8, padding: "6px 10px", fontSize: 14,
                  color: listening ? "#fff" : "#555",
                }}>{listening ? "⏹" : "🎤"}</button>
                <button onClick={() => sendChat()} disabled={chatLoading} style={{
                  background: "#1e1e1e", border: "none", borderRadius: 8, color: "#fff",
                  padding: "6px 16px", fontSize: 13, fontWeight: 600,
                }}>→</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}