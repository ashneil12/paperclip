/**
 * The CEO chat surface (plugin `page` slot). Talk to your CEO; it plans, dispatches,
 * verifies, and reports back. V0 transport: POST /chat, then poll /poll until done.
 * Styled with the host's design tokens (oklch shadcn vars) so it matches Paperclip.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

// Must match the manifest `id` — the host mounts routes at /api/plugins/<id>/api/*.
const PLUGIN_ID = "command-center";
const API_BASE = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api`;

const EXAMPLES = [
  "Build a pricing page and QA it before shipping",
  "Research our top 3 competitors' pricing",
  "Draft a launch email sequence",
  "What can you do?",
];

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

/** Tiny markdown: **bold** + preserved line breaks. Enough for the CEO's reports. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <div key={li} style={{ minHeight: line ? undefined : "0.5em" }}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
            seg.startsWith("**") && seg.endsWith("**") ? (
              <strong key={si} style={{ fontWeight: 650 }}>{seg.slice(2, -2)}</strong>
            ) : (
              <span key={si}>{seg}</span>
            ),
          )}
        </div>
      ))}
    </>
  );
}

export function CeoChat({ companyId }: { companyId?: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

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

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: msg }, { role: "ceo", text: "__thinking__" }]);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId: conversationId.current, companyId }),
      });
      const data = (await res.json()) as { conversationId: string; report: string; done: boolean };
      conversationId.current = data.conversationId;
      setMessages((m) => replaceLastCeo(m, data.report));
      if (!data.done) await poll(data.conversationId);
    } catch (e) {
      setMessages((m) => replaceLastCeo(m, `⚠ Couldn't reach the CEO: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  }, [input, busy, poll, companyId]);

  const empty = messages.length === 0;

  return (
    <div style={S.wrap}>
      <style>{KEYFRAMES}</style>
      <header style={S.header}>
        <span style={S.dot} />
        <strong style={S.title}>Command Center</strong>
        <span style={S.sub}>your CEO — talk strategy, it dispatches the team</span>
      </header>

      <div ref={scrollRef} style={S.transcript}>
        {empty ? (
          <div style={S.emptyWrap}>
            <div style={S.emptyTitle}>Tell your CEO an objective.</div>
            <div style={S.emptyBody}>It plans, delegates to the right member, verifies the work, and reports back.</div>
            <div style={S.chips}>
              {EXAMPLES.map((ex) => (
                <button key={ex} style={S.chip} onClick={() => void send(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={S.thread}>
            {messages.map((m, i) => (
              <div key={i} style={{ ...S.row, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                {m.role === "ceo" && <div style={S.avatar}>CE</div>}
                <div style={{ ...S.bubble, ...(m.role === "user" ? S.user : S.ceo) }}>
                  {m.text === "__thinking__" ? (
                    <span style={S.typing}><i style={S.tdot} /><i style={{ ...S.tdot, animationDelay: "0.15s" }} /><i style={{ ...S.tdot, animationDelay: "0.3s" }} /></span>
                  ) : (
                    <Rich text={m.text} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={S.composer}>
        <textarea
          ref={inputRef}
          style={S.input}
          value={input}
          placeholder="Tell your CEO what to get done…  (⌘↵ to send)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
        />
        <button style={{ ...S.send, opacity: busy || !input.trim() ? 0.5 : 1 }} onClick={() => void send()} disabled={busy || !input.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const KEYFRAMES = `
@keyframes cc-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes cc-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
`;

const radius = "var(--radius-md, 10px)";
const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, color: "var(--foreground)", fontFamily: "inherit", maxWidth: 920, margin: "0 auto", width: "100%" },
  header: { display: "flex", alignItems: "center", gap: 10, padding: "14px 4px 16px" },
  dot: { width: 8, height: 8, borderRadius: 999, background: "oklch(0.7 0.18 150)", boxShadow: "0 0 8px oklch(0.7 0.18 150 / 0.6)", flex: "none" },
  title: { fontSize: 16, fontWeight: 650 },
  sub: { color: "var(--muted-foreground)", fontSize: 13 },
  transcript: { flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 2px 16px" },
  thread: { display: "flex", flexDirection: "column", gap: 14 },
  row: { display: "flex", alignItems: "flex-end", gap: 8, animation: "cc-fade 0.18s ease-out" },
  avatar: { width: 28, height: 28, borderRadius: 999, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" },
  bubble: { borderRadius: radius, padding: "10px 13px", maxWidth: "78%", whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 14, wordBreak: "break-word" },
  user: { background: "var(--primary)", color: "var(--primary-foreground)" },
  ceo: { background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" },
  typing: { display: "inline-flex", gap: 4, alignItems: "center", padding: "2px 0" },
  tdot: { width: 6, height: 6, borderRadius: 999, background: "var(--muted-foreground)", display: "inline-block", animation: "cc-blink 1.2s infinite ease-in-out" },
  emptyWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", gap: 8, padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: 650 },
  emptyBody: { color: "var(--muted-foreground)", fontSize: 14, maxWidth: 460 },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 14, maxWidth: 560 },
  chip: { padding: "8px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  composer: { display: "flex", gap: 8, alignItems: "flex-end", padding: "12px 2px", borderTop: "1px solid var(--border)" },
  input: { flex: 1, resize: "none", padding: "12px 14px", borderRadius: radius, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, minHeight: 46, maxHeight: 180, outline: "none" },
  send: { padding: "0 20px", height: 46, borderRadius: radius, border: "none", background: "var(--primary)", color: "var(--primary-foreground)", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit", flex: "none" },
};
