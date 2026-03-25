import { useState, useEffect, useRef } from "react";

// ─── Storage helpers ───────────────────────────────────────────────────────
const STORAGE_KEY = "adz-financeiro-v1";

const defaultData = {
  personal: {
    label: "Pessoal",
    caixa: 25000,
    entries: [
      { id: 1, desc: "Contas de abril", amount: 17500, type: "saida", cat: "Fixo", month: "2026-04" },
      { id: 2, desc: "Boston – viagem", amount: 5000, type: "saida", cat: "Viagem", month: "2026-04" },
      { id: 3, desc: "Celular da irmã", amount: 3700, type: "saida", cat: "Pessoal", month: "2026-04" },
    ],
  },
  audazi: {
    label: "Audazi",
    caixa: 0,
    entries: [
      { id: 4, desc: "Etiquetas", amount: 1000, type: "saida", cat: "Produção", month: "2026-04" },
      { id: 5, desc: "Bonés – 2 modelos", amount: 1840, type: "saida", cat: "Produção", month: "2026-04" },
    ],
  },
};

async function loadData() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : defaultData;
  } catch { return defaultData; }
}

async function saveData(data) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MONTH_NOW = "2026-04";

function calcSaldo(ledger, month) {
  const entries = ledger.entries.filter(e => e.month === month);
  const entradas = entries.filter(e => e.type === "entrada").reduce((a, b) => a + b.amount, 0);
  const saidas = entries.filter(e => e.type === "saida").reduce((a, b) => a + b.amount, 0);
  return { entradas, saidas, saldo: ledger.caixa + entradas - saidas };
}

// ─── API call ──────────────────────────────────────────────────────────────
async function callClaude(messages, data) {
  const systemPrompt = `Você é o assistente financeiro pessoal do Fabiano Audazi, 31 anos, estrategista e dono da marca Audazi.
Você gerencia dois orçamentos: "personal" (finanças pessoais) e "audazi" (marca/negócio).

Estado atual das finanças:
${JSON.stringify(data, null, 2)}

Mês atual: abril/2026.

Responda SEMPRE em JSON válido neste formato exato:
{
  "msg": "sua resposta em português, direta e inteligente",
  "action": null
}

OU se o usuário quiser adicionar/remover uma transação:
{
  "msg": "confirmação da ação",
  "action": {
    "type": "add" | "remove" | "set_caixa",
    "ledger": "personal" | "audazi",
    "entry": { "desc": "...", "amount": 1000, "type": "entrada" | "saida", "cat": "...", "month": "2026-04" }
  }
}

Para remove: inclua "id" no entry ao invés dos outros campos.
Para set_caixa: inclua "caixa" no action e não inclua "entry".

Categorias pessoais: Fixo, Renda, Viagem, Pessoal, Investimento, Outro
Categorias Audazi: Produção, Marketing, Renda, Operacional, Outro

Regras:
- Seja direto, sem rodeios, fale como um CFO inteligente
- Se o saldo estiver negativo, alerte
- Quando o usuário disser "recebi X", "vendi X", "entrou X" → entrada
- Quando disser "paguei X", "gastei X", "saiu X" → saída
- Se não houver ação a executar, retorne action: null
- Responda APENAS com JSON, sem markdown, sem texto fora do JSON`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  const result = await response.json();
  const text = result.content?.[0]?.text || '{"msg":"Erro ao processar.","action":null}';
  try { return JSON.parse(text); }
  catch { return { msg: text, action: null }; }
}

// ─── Components ────────────────────────────────────────────────────────────
function SaldoBar({ label, entradas, saidas, saldo, caixa }) {
  const max = Math.max(caixa, saidas, 1);
  const pos = saldo >= 0;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: 3, color: "#666", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: pos ? "#22c55e" : "#ef4444", fontFamily: "'Syne', sans-serif" }}>
          {fmt(saldo)}
        </span>
      </div>
      <div style={{ height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          background: pos ? "#22c55e" : "#ef4444",
          width: `${Math.min(100, Math.abs(saldo) / max * 100)}%`,
          transition: "width 0.5s ease",
        }} />
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
        <span style={{ fontSize: 11, color: "#22c55e" }}>↑ {fmt(entradas + caixa)}</span>
        <span style={{ fontSize: 11, color: "#ef4444" }}>↓ {fmt(saidas)}</span>
      </div>
    </div>
  );
}

function EntryList({ entries, onRemove, month }) {
  const filtered = entries.filter(e => e.month === month);
  if (!filtered.length) return <div style={{ color: "#333", fontSize: 12, padding: "12px 0" }}>Nenhum lançamento neste mês.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {filtered.map(e => (
        <div key={e.id} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", borderRadius: 6,
          background: "#0d0d0d",
          borderLeft: `3px solid ${e.type === "entrada" ? "#22c55e" : "#ef4444"}`,
        }}>
          <div style={{ flex: 1, fontSize: 12, color: "#ccc" }}>{e.desc}</div>
          <div style={{ fontSize: 10, color: "#555", background: "#1a1a1a", padding: "2px 6px", borderRadius: 3 }}>{e.cat}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: e.type === "entrada" ? "#22c55e" : "#ef4444", minWidth: 80, textAlign: "right" }}>
            {e.type === "saida" ? "-" : "+"}{fmt(e.amount)}
          </div>
          <button onClick={() => onRemove(e.id)} style={{
            background: "none", border: "none", color: "#333", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1,
          }}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeLedger, setActiveLedger] = useState("personal");
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Fala, Fabiano. Seu financeiro tá aqui. Me diz o que entrou, saiu, ou o que quer saber." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiMessages, setApiMessages] = useState([]);
  const chatRef = useRef(null);

  useEffect(() => { loadData().then(setData); }, []);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  if (!data) return <div style={{ background: "#080808", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontFamily: "monospace" }}>carregando...</div>;

  const persist = (newData) => { setData(newData); saveData(newData); };

  const removeEntry = (ledger, id) => {
    const updated = { ...data, [ledger]: { ...data[ledger], entries: data[ledger].entries.filter(e => e.id !== id) } };
    persist(updated);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setLoading(true);

    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);

    const newApiMessages = [...apiMessages, { role: "user", content: userMsg }];

    try {
      const resp = await callClaude(newApiMessages, data);

      let updatedData = data;
      if (resp.action) {
        const { type, ledger, entry, caixa: newCaixa } = resp.action;
        if (type === "add" && entry) {
          const newEntry = { ...entry, id: Date.now() };
          updatedData = { ...data, [ledger]: { ...data[ledger], entries: [...data[ledger].entries, newEntry] } };
          persist(updatedData);
        } else if (type === "remove" && entry?.id) {
          updatedData = { ...data, [ledger]: { ...data[ledger], entries: data[ledger].entries.filter(e => e.id !== entry.id) } };
          persist(updatedData);
        } else if (type === "set_caixa" && newCaixa !== undefined) {
          updatedData = { ...data, [ledger]: { ...data[ledger], caixa: newCaixa } };
          persist(updatedData);
        }
      }

      const assistantContent = resp.msg || "Feito.";
      setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
      setApiMessages([...newApiMessages, { role: "assistant", content: assistantContent }]);
    } catch (err) {
      setMessages([...newMessages, { role: "assistant", content: "Erro ao conectar. Tenta de novo." }]);
    }
    setLoading(false);
  };

  const pCalc = calcSaldo(data.personal, MONTH_NOW);
  const aCalc = calcSaldo(data.audazi, MONTH_NOW);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080808",
      color: "#e8e8e0",
      fontFamily: "'DM Mono', monospace",
      display: "flex",
      flexDirection: "column",
      maxWidth: 680,
      margin: "0 auto",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        input { outline: none; } textarea { outline: none; resize: none; }
        button { cursor: pointer; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .msg-in { animation: fadeUp 0.25s ease; }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
        .dot { animation: pulse 1.2s ease infinite; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        .tab-btn:hover { background: #141414 !important; }
        .ledger-btn:hover { opacity: 0.8; }
        .entry-row:hover { background: #111 !important; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "20px 24px 0", borderBottom: "1px solid #111" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
            ADZ<span style={{ color: "#3b82f6" }}>.</span>FINANCEIRO
          </h1>
          <span style={{ fontSize: 10, color: "#444", letterSpacing: 3, textTransform: "uppercase" }}>abril 2026</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {["dashboard", "chat"].map(tab => (
            <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)} style={{
              background: activeTab === tab ? "#141414" : "transparent",
              border: "none",
              borderTop: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
              color: activeTab === tab ? "#e8e8e0" : "#444",
              fontSize: 11, letterSpacing: 2, textTransform: "uppercase",
              padding: "10px 20px",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}>
              {tab === "dashboard" ? "📊 Dashboard" : "💬 Agente"}
            </button>
          ))}
        </div>
      </div>

      {/* Dashboard */}
      {activeTab === "dashboard" && (
        <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {/* Ledger switcher */}
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            {["personal", "audazi"].map(k => (
              <button key={k} className="ledger-btn" onClick={() => setActiveLedger(k)} style={{
                flex: 1, padding: "10px 0",
                background: activeLedger === k ? "#3b82f6" : "#111",
                border: "none", borderRadius: 8,
                color: activeLedger === k ? "#fff" : "#555",
                fontFamily: "inherit", fontSize: 12, letterSpacing: 2, textTransform: "uppercase",
                fontWeight: activeLedger === k ? 600 : 400,
                transition: "all 0.2s",
              }}>
                {k === "personal" ? "Pessoal" : "Audazi"}
              </button>
            ))}
          </div>

          {/* Saldo card */}
          {activeLedger === "personal" ? (
            <SaldoBar label="Pessoal · Abril" {...pCalc} caixa={data.personal.caixa} />
          ) : (
            <SaldoBar label="Audazi · Abril" {...aCalc} caixa={data.audazi.caixa} />
          )}

          {/* Caixa edit */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 14px", background: "#0d0d0d", borderRadius: 8, border: "1px solid #1a1a1a" }}>
            <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 2 }}>Caixa inicial</span>
            <input
              type="number"
              value={data[activeLedger].caixa}
              onChange={e => {
                const val = parseFloat(e.target.value) || 0;
                persist({ ...data, [activeLedger]: { ...data[activeLedger], caixa: val } });
              }}
              style={{
                flex: 1, background: "transparent", border: "none",
                color: "#3b82f6", fontSize: 16, fontWeight: 600, fontFamily: "inherit", textAlign: "right",
              }}
            />
            <span style={{ fontSize: 10, color: "#444" }}>R$</span>
          </div>

          {/* Entries */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#444", textTransform: "uppercase", marginBottom: 10 }}>
              Lançamentos — {activeLedger === "personal" ? "Pessoal" : "Audazi"}
            </div>
            <EntryList
              entries={data[activeLedger].entries}
              month={MONTH_NOW}
              onRemove={id => removeEntry(activeLedger, id)}
            />
          </div>

          {/* Tip */}
          <div style={{ marginTop: 24, padding: "12px 16px", background: "#0d0d0d", borderRadius: 8, border: "1px dashed #1a1a1a" }}>
            <div style={{ fontSize: 11, color: "#444" }}>
              💬 Use o <span style={{ color: "#3b82f6" }}>Agente</span> pra lançar entradas e saídas por chat — ele atualiza aqui automaticamente.
            </div>
          </div>
        </div>
      )}

      {/* Chat */}
      {activeTab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Resumo rápido */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "16px 24px 0" }}>
            {[
              { label: "Pessoal", value: pCalc.saldo },
              { label: "Audazi", value: aCalc.saldo },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: value >= 0 ? "#22c55e" : "#ef4444" }}>{fmt(value)}</div>
              </div>
            ))}
          </div>

          {/* Messages */}
          <div ref={chatRef} style={{
            flex: 1, overflowY: "auto", padding: "20px 24px",
            display: "flex", flexDirection: "column", gap: 12,
            minHeight: 300, maxHeight: 420,
          }}>
            {messages.map((m, i) => (
              <div key={i} className="msg-in" style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                  background: m.role === "user" ? "#3b82f6" : "#111",
                  border: m.role === "assistant" ? "1px solid #1a1a1a" : "none",
                  fontSize: 13, lineHeight: 1.5,
                  color: m.role === "user" ? "#fff" : "#d4d4d0",
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: 5, padding: "10px 14px", background: "#111", borderRadius: "12px 12px 12px 2px", width: "fit-content", border: "1px solid #1a1a1a" }}>
                {[0,1,2].map(i => <div key={i} className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6" }} />)}
              </div>
            )}
          </div>

          {/* Sugestões */}
          <div style={{ padding: "0 24px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Entrou R$3k de consultoria", "Paguei R$500 de ads Audazi", "Qual meu saldo?", "Atualiza meu caixa pessoal"].map(s => (
              <button key={s} onClick={() => setInput(s)} style={{
                background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 16,
                color: "#555", fontSize: 10, padding: "4px 10px", fontFamily: "inherit",
                transition: "all 0.15s",
              }}
                onMouseEnter={e => { e.target.style.color = "#999"; e.target.style.borderColor = "#333"; }}
                onMouseLeave={e => { e.target.style.color = "#555"; e.target.style.borderColor = "#1a1a1a"; }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding: "0 24px 24px" }}>
            <div style={{
              display: "flex", gap: 10,
              background: "#0d0d0d", border: "1px solid #1e1e1e",
              borderRadius: 12, padding: "10px 14px",
            }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Ex: Recebi R$2k da BMG hoje..."
                style={{
                  flex: 1, background: "transparent", border: "none",
                  color: "#e8e8e0", fontSize: 13, fontFamily: "inherit",
                }}
              />
              <button onClick={sendMessage} disabled={loading} style={{
                background: loading ? "#1a2a4a" : "#3b82f6",
                border: "none", borderRadius: 8,
                color: "#fff", fontSize: 12, padding: "6px 14px",
                fontFamily: "inherit", fontWeight: 600,
                transition: "background 0.15s",
              }}>
                {loading ? "..." : "→"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}