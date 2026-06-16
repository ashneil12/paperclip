/**
 * The CEO chat surface (plugin `page` slot). V0 transport: POST /chat to dispatch,
 * then poll /poll until the run is done, rendering the CEO's interim + final
 * report. Buffered by necessity — plugin API routes are JSON-only (no streaming);
 * V1 swaps the poll for a company-WS subscription and renders raw agent events
 * through ./agent-adapters. Deliberately thin: this is the seat you talk to.
 */
import React, { useCallback, useRef, useState } from "react";

const PLUGIN_ID = "@ash/command-center";
const API_BASE = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api`;

interface Message {
  role: "user" | "ceo";
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function replaceLastCeo(messages: Message[], text: string): Message[] {
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.role === "ceo") {
      out[i] = { role: "ceo", text };
      return out;
    }
  }
  return [...out, { role: "ceo", text }];
}

export function CeoChat({ companyId }: { companyId?: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);

  const poll = useCallback(async (convId: string) => {
    for (let i = 0; i < 120; i++) {
      await sleep(1500);
      const res = await fetch(`${API_BASE}/poll?conversationId=${encodeURIComponent(convId)}&companyId=${encodeURIComponent(companyId ?? "")}`);
      if (!res.ok) break;
      const data = (await res.json()) as { report: string; done: boolean };
      setMessages((m) => replaceLastCeo(m, data.report));
      if (data.done) break;
    }
  }, [companyId]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "ceo", text: "Decomposing the objective…" }]);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: conversationId.current, companyId }),
      });
      const data = (await res.json()) as { conversationId: string; report: string; done: boolean };
      conversationId.current = data.conversationId;
      setMessages((m) => replaceLastCeo(m, data.report));
      if (!data.done) await poll(data.conversationId);
    } catch (e) {
      setMessages((m) => replaceLastCeo(m, `⚠ Error talking to the CEO: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  }, [input, busy, poll, companyId]);

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <strong>Command Center</strong>
        <span style={styles.sub}>your CEO — talk strategy, it dispatches the team</span>
      </header>
      <div style={styles.transcript}>
        {messages.length === 0 && (
          <div style={styles.empty}>Tell your CEO an objective. It plans, delegates to the right member, verifies, and reports back.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ ...styles.bubble, ...(m.role === "user" ? styles.user : styles.ceo) }}>
            <div style={styles.role}>{m.role === "user" ? "you" : "CEO"}</div>
            <div style={styles.body}>{m.text}</div>
          </div>
        ))}
      </div>
      <div style={styles.composer}>
        <textarea
          style={styles.input}
          value={input}
          placeholder="e.g. Build a pricing page and QA it before shipping"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
          rows={2}
        />
        <button style={styles.send} onClick={() => void send()} disabled={busy}>
          {busy ? "Working…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", alignItems: "baseline", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border, #e5e7eb)" },
  sub: { color: "var(--muted, #6b7280)", fontSize: 13 },
  transcript: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  empty: { color: "var(--muted, #6b7280)", fontSize: 14, margin: "auto", textAlign: "center", maxWidth: 420 },
  bubble: { borderRadius: 12, padding: "10px 12px", maxWidth: "85%", whiteSpace: "pre-wrap", lineHeight: 1.5 },
  user: { alignSelf: "flex-end", background: "var(--accent-soft, #eef2ff)" },
  ceo: { alignSelf: "flex-start", background: "var(--surface, #f9fafb)", border: "1px solid var(--border, #e5e7eb)" },
  role: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted, #6b7280)", marginBottom: 4 },
  body: { fontSize: 14 },
  composer: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border, #e5e7eb)" },
  input: { flex: 1, resize: "none", padding: 10, borderRadius: 8, border: "1px solid var(--border, #d1d5db)", fontFamily: "inherit", fontSize: 14 },
  send: { padding: "0 18px", borderRadius: 8, border: "none", background: "var(--accent, #4f46e5)", color: "#fff", fontWeight: 600, cursor: "pointer" },
};
