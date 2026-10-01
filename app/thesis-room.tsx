"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Flame,
  Link2,
  LoaderCircle,
  MessageCircle,
  Radio,
  Send,
  Sparkles,
} from "lucide-react";
import ModelAvatar from "./model-avatar";

type Message = {
  id: string;
  role: string;
  name: string;
  model: string;
  content: string;
  sourceIds: string[];
};
type Source = {
  id: string;
  title: string;
  url: string;
  kind: string;
  observedAt: string;
};
export type Discussion = {
  id: string;
  topic: string;
  createdAt: string;
  models: string[];
  messages: Message[];
  sources: Source[];
  proposal: {
    name: string;
    symbol: string;
    description: string;
    thesis: string;
    differentiation: string;
    novelty: string;
    quoteAsset: string;
    pairing: { type: string; candidate: string; reason: string };
    risks: string[];
  };
  coverage: {
    signalCount: number;
    marketCount: number;
    searchTerm: string;
    retrievedAt: string;
    noveltyScope: string;
    marketStatus?: "available" | "unavailable";
    newestSavedSignalAt?: string | null;
  };
};
type Props = {
  user: any;
  model: string;
  models: { id: string; name: string }[];
  agents: { id: string; name: string; model: string }[];
  connected: boolean;
  funding?: "personal" | "sponsored" | null;
  connections: () => void;
  onSend: (discussion: Discussion) => Promise<boolean>;
};
const roles = ["Narrative scout", "Contrarian", "Launch architect"];
const examples = [
  "Start with the signal. What are people repeating, and which coins already own that story? I want the source before the ticker.",
  "If we vamp a narrative, the hook needs to stand on its own. A new ticker on the same meme is not a thesis. What would make people care about this version?",
  "Bring the fresh angle, the closest competing coins, and the community it fits. Then we can propose a name and a SOL launch for review.",
];
function sourceLink(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
async function responseData(response: Response): Promise<any> {
  if (!response.headers.get("content-type")?.includes("json"))
    throw new Error(
      "The thesis service is unavailable. Refresh and try again.",
    );
  return response.json();
}
export default function ThesisRoom(p: Props) {
  const [topic, setTopic] = useState("");
  const [crewMode, setCrewMode] = useState(false);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    if (p.user)
      fetch("/api/thesis")
        .then(async (r) => {
          const d: any = await responseData(r);
          if (!r.ok)
            throw new Error(d.error || "Could not load your saved discussion.");
          if (active.current && d.discussion) {
            setDiscussion(d.discussion);
            setTopic(d.discussion.topic);
          }
        })
        .catch((e) => {
          if (active.current) setError(e.message);
        });
    return () => {
      active.current = false;
    };
  }, [p.user?.userId]);
  const crew = agentIds
    .map((id) => p.agents.find((a) => a.id === id))
    .filter(Boolean) as Props["agents"];
  const seats = roles.map((role, i) => ({
    role,
    name: crewMode
      ? crew[i % (crew.length || 1)]?.name || "Choose a dev"
      : role,
    model: crewMode ? crew[i % (crew.length || 1)]?.model || "" : p.model,
  }));
  const messages =
    busy || liveMessages.length ? liveMessages : discussion?.messages || [];
  const modelName = (id: string) =>
    p.models.find((m) => m.id === id)?.name.replace(/^[^:]+: /, "") ||
    id ||
    "Choose a model above";
  async function start() {
    if (!p.user) {
      location.href = "/signin-with-chatgpt?return_to=/";
      return;
    }
    if (!p.connected) {
      p.connections();
      return;
    }
    setBusy(true);
    setError("");
    setLiveMessages([]);
    setStatus("Reading signals and comparing coins…");
    try {
      const r = await fetch("/api/thesis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({
          topic,
          ...(crewMode ? { agentIds } : { model: p.model }),
          ...(discussion && discussion.topic === topic.trim()
            ? { previousDiscussionId: discussion.id }
            : {}),
        }),
      });
      if (!r.ok) {
        const d: any = await responseData(r);
        throw new Error(d.error || "Discussion could not start.");
      }
      if (r.headers.get("content-type")?.includes("ndjson") && r.body) {
        const reader = r.body.getReader(),
          decoder = new TextDecoder();
        let pending = "",
          completed = false;
        const receive = (line: string) => {
          if (!line.trim()) return;
          const e = JSON.parse(line);
          if (e.type === "error")
            throw new Error(e.error || "Discussion interrupted.");
          if (!active.current) return;
          if (e.type === "status") setStatus(e.message);
          if (e.type === "message") setLiveMessages((m) => [...m, e.message]);
          if (e.type === "result") {
            setDiscussion(e.discussion);
            setLiveMessages([]);
            completed = true;
          }
        };
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const line of lines) receive(line);
        }
        receive(pending + decoder.decode());
        if (!completed)
          throw new Error(
            "The discussion ended before the final thesis. Try again.",
          );
      } else {
        const d: any = await responseData(r);
        if (active.current) {
          setDiscussion(d.discussion);
          setLiveMessages([]);
        }
      }
      setSentId("");
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) {
        setBusy(false);
        setStatus("");
      }
    }
  }
  return (
    <section className="terminal-card thesis-room" aria-label="Dev thesis room">
      <div className="terminal-head">
        <b>
          <Flame size={15} /> Dev thesis
        </b>
        <span className="thesis-live">
          <i /> RESEARCH ROOM
        </span>
      </div>
      <div className="thesis-intro">
        <span className="thesis-kicker">THE CONVERSATION BEFORE THE COIN</span>
        <h2>Find the angle. Challenge the hype.</h2>
        <p>
          Your devs debate what’s moving, what’s been done, and what deserves a
          different take.
        </p>
      </div>
      <div className="thesis-lenses">
        <span>
          <Radio size={12} /> Trend radar
        </span>
        <span>
          <Flame size={12} /> Vamp thesis
        </span>
        <span>
          <Sparkles size={12} /> Fresh angle
        </span>
        <span>
          <Link2 size={12} /> Pairing
        </span>
      </div>
      <form
        className="thesis-form"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <label htmlFor="thesis-topic">Put a narrative on the table</label>
        <div className="thesis-prompt">
          <input
            id="thesis-topic"
            placeholder="A ticker, mint, or emerging narrative…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            minLength={3}
            maxLength={160}
            required
            disabled={busy}
          />
          <button
            type="submit"
            aria-label="Start dev discussion"
            disabled={
              busy ||
              topic.trim().length < 3 ||
              (crewMode ? !crew.length : !p.model)
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Send size={17} />
            )}
          </button>
        </div>
        <div className="thesis-crew-header">
          <span>AT THE TABLE</span>
          <label>
            <input
              type="checkbox"
              checked={crewMode}
              disabled={busy || !p.agents.length}
              onChange={(e) => setCrewMode(e.target.checked)}
            />{" "}
            Use my devs
          </label>
        </div>
        {crewMode && (
          <div className="thesis-agent-picker">
            {p.agents.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={agentIds.includes(a.id)}
                  disabled={
                    busy || (!agentIds.includes(a.id) && agentIds.length >= 3)
                  }
                  onChange={(e) =>
                    setAgentIds((ids) =>
                      e.target.checked
                        ? [...ids, a.id]
                        : ids.filter((id) => id !== a.id),
                    )
                  }
                />
                <ModelAvatar model={a.model} size={20} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="thesis-seats">
          {seats.map((s) => (
            <div key={s.role}>
              <ModelAvatar model={s.model} size={28} />
              <div>
                <b>{s.name}</b>
                <span title={s.model}>{modelName(s.model)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="thesis-cost">
          {crewMode
            ? "Your selected devs rotate through three perspectives."
            : "One selected model, three AI perspectives."}{" "}
          Three replies per round ·{" "}
          {p.funding === "sponsored"
            ? "uses your Dev-funded daily allowance."
            : "uses your OpenRouter credits."}
        </div>
        {!p.connected && (
          <button
            type="button"
            className="thesis-connect"
            onClick={p.connections}
          >
            <Link2 size={12} /> Connect OpenRouter to start a real discussion{" "}
            <ArrowUpRight size={12} />
          </button>
        )}
      </form>
      <div className="thesis-conversation" aria-live="polite">
        <div className="thesis-thread-label">
          <MessageCircle size={12} />
          {messages.length ? "DEV DISCUSSION" : "EXAMPLE CONVERSATION"}
          <span>
            {busy
              ? "IN PROGRESS"
              : liveMessages.length
                ? "INCOMPLETE ROUND"
                : discussion
                  ? new Date(discussion.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "PREVIEW"}
          </span>
        </div>
        {!messages.length && !busy
          ? examples.map((text, i) => (
              <article className="thesis-message example" key={roles[i]}>
                <ModelAvatar model={seats[i].model} size={30} />
                <div>
                  <header>
                    <b>{roles[i]}</b>
                    <span>ILLUSTRATIVE</span>
                  </header>
                  <p>{text}</p>
                </div>
              </article>
            ))
          : messages.map((m, i) => (
              <article className="thesis-message" key={m.id}>
                <ModelAvatar model={m.model} size={30} />
                <div>
                  <header>
                    <b>{m.name}</b>
                    <span>{m.role || roles[i]}</span>
                  </header>
                  <small>{modelName(m.model)}</small>
                  <p>{m.content}</p>
                  <div className="thesis-citations">
                    {m.sourceIds?.map((id) => {
                      const source =
                        !busy && !liveMessages.length
                          ? discussion?.sources.find((s) => s.id === id)
                          : undefined;
                      return source && sourceLink(source.url) ? (
                        <a
                          href={sourceLink(source.url)}
                          key={id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.title}
                          <ArrowUpRight size={10} />
                        </a>
                      ) : (
                        <span key={id}>Source {id}</span>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
        {busy && (
          <div className="thesis-working" role="status">
            <LoaderCircle className="spin" size={14} />
            {status}
          </div>
        )}
        {error && (
          <div className="thesis-error" role="alert">
            {error}
          </div>
        )}
      </div>
      {!busy && discussion?.proposal && !liveMessages.length && (
        <div className="thesis-proposal">
          <div className="thesis-proposal-head">
            <span>
              <Sparkles size={12} /> PROPOSED LAUNCH
            </span>
            <span>FOR REVIEW</span>
          </div>
          <h3>
            {discussion.proposal.name}{" "}
            <span>${discussion.proposal.symbol}</span>
          </h3>
          <p>{discussion.proposal.thesis}</p>
          <div className="thesis-evidence">
            {discussion.coverage.marketStatus === "unavailable"
              ? "Live market search unavailable"
              : "Market sample: " +
                new Date(discussion.coverage.retrievedAt).toLocaleString()}
            {" · "}
            {discussion.coverage.signalCount} saved tweet / wallet signals
            {discussion.coverage.newestSavedSignalAt &&
              " · newest signal " +
                new Date(
                  discussion.coverage.newestSavedSignalAt,
                ).toLocaleString()}
          </div>
          <dl>
            <dt>The different take</dt>
            <dd>{discussion.proposal.differentiation}</dd>
            <dt>Originality check</dt>
            <dd>{discussion.proposal.novelty}</dd>
            <dt>Narrative pairing</dt>
            <dd>
              <b>{discussion.proposal.pairing.candidate}</b> —{" "}
              {discussion.proposal.pairing.reason}
            </dd>
            <dt>Trading pair</dt>
            <dd>
              SOL · the supported launch quote. Narrative pairing does not
              create another market.
            </dd>
          </dl>
          {!!discussion.proposal.risks?.length && (
            <details>
              <summary>
                What could invalidate this thesis <ChevronDown size={12} />
              </summary>
              <ul>
                {discussion.proposal.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            className="thesis-send"
            disabled={sending || sentId === discussion.id}
            onClick={async () => {
              setSending(true);
              try {
                if (await p.onSend(discussion)) setSentId(discussion.id);
              } finally {
                setSending(false);
              }
            }}
          >
            {sentId === discussion.id ? (
              <Check size={14} />
            ) : (
              <ArrowUpRight size={14} />
            )}{" "}
            {sending
              ? "Saving proposal…"
              : sentId === discussion.id
                ? "Loaded in launch terminal"
                : "Send to launch terminal"}
          </button>
          <small>Saves a draft for review. Does not submit a launch.</small>
        </div>
      )}
      {!!discussion?.sources?.length && !busy && !liveMessages.length && (
        <div className="thesis-sources">
          <button onClick={() => setSourcesOpen(!sourcesOpen)}>
            <Link2 size={12} />
            {discussion.sources.length} sources ·{" "}
            {discussion.coverage.marketCount} market matches
            <ChevronDown size={12} />
          </button>
          {sourcesOpen && (
            <>
              <p>{discussion.coverage.noveltyScope}</p>
              {discussion.sources.map((s) => (
                <a
                  key={s.id}
                  href={sourceLink(s.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    {s.kind} · {s.title}
                  </span>
                  <ArrowUpRight size={11} />
                </a>
              ))}
            </>
          )}
        </div>
      )}
      {discussion && !busy && (
        <div className="thesis-round">
          <span>Keep developing the idea with fresh market data.</span>
          <button
            disabled={
              topic.trim().length < 3 || (crewMode ? !crew.length : !p.model)
            }
            onClick={start}
          >
            <MessageCircle size={12} />{" "}
            {topic.trim() === discussion.topic
              ? "Continue discussion"
              : "Discuss new topic"}
          </button>
        </div>
      )}
      {!discussion && (
        <div className="thesis-footer">
          Preview only. Start a round for sourced discussion and a launch
          thesis.
        </div>
      )}
    </section>
  );
}
