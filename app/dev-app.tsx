"use client";
import DeployStudio from "./deploy-studio";
import HomepageStory from "./homepage-story";
import ModelAvatar from "./model-avatar";
import TwitterStatus, {
  twitterLabel,
  type TwitterStatusData,
} from "./twitter-status";
import { WalletTracker, InstantLaunch, MainCoin } from "./advanced";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Terminal,
  Plus,
  Zap,
  Radio,
  Cpu,
  Check,
  Activity,
  Settings2,
  X,
  Wallet,
  Rocket,
  Link2,
  RefreshCw,
  ExternalLink,
  Bot,
  MessageCircle,
  Eye,
  Square,
  ChevronRight,
  Search,
  ShieldCheck,
  Download,
  Unplug,
} from "lucide-react";

type Agent = {
  id: string;
  name: string;
  mission: string;
  model: string;
  status: string;
};
type Event = {
  id: string;
  agent_id: string;
  kind: string;
  message: string;
  created_at: string;
};
type Draft = {
  id: string;
  agent_id: string;
  name: string;
  symbol: string;
  description: string;
  rationale: string;
  status: string;
  image_url?: string;
  metadata_uri?: string;
  signature?: string;
  mint?: string;
};
type Track = { id: string; query: string; last_checked?: string };
type Tweet = {
  id: string;
  author: string;
  text: string;
  created_at: string;
  likes: number;
  url: string;
};
type Data = {
  wallets?: any[];
  walletSignals?: any[];
  sessions?: any[];
  support?: any;
  sessionImage?: string;
  agents: Agent[];
  events: Event[];
  drafts: Draft[];
  tracks: Track[];
  tweets: Tweet[];
  connections: Record<string, boolean>;
  aiAccess?: {
    available: boolean;
    source: string | null;
    dailyLimitUsd?: number | null;
    message?: string;
  };
  twitterStatus?: TwitterStatusData;
};
const EMPTY: Data = {
  agents: [],
  events: [],
  drafts: [],
  tracks: [],
  tweets: [],
  connections: {},
};
const PRESETS = [
  {
    label: "Meme scout",
    name: "Meme scout",
    mission:
      "Read my tracked tweets, find one original meme theme, and prepare a pump.fun coin proposal with a name, ticker, description, and a short explanation of the source signals. Avoid impersonation and promises of returns.",
  },
  {
    label: "Community builder",
    name: "Community dev",
    mission:
      "Create an original community-first meme coin concept for pump.fun. Use my tweet signals for inspiration, clearly separate evidence from speculation, and explain the concept in plain language.",
  },
  {
    label: "Trend watcher",
    name: "Trend dev",
    mission:
      "Study the latest saved tweet signals and turn an emerging theme into one original pump.fun coin proposal. Explain the signal, acknowledge limited evidence, and avoid recycling existing coin names.",
  },
];
const DEMO: Draft = {
  id: "demo",
  agent_id: "demo",
  name: "Terminal Cat",
  symbol: "TCAT",
  description:
    "For the cats who never close their terminal. A playful community coin for late-night builders.",
  rationale:
    "Example only: a developer-culture theme gives the coin a recognizable identity. No real tweets were analyzed and no coin has been launched.",
  status: "draft",
};

async function api(action: string, body: Record<string, unknown> = {}) {
  const r = await fetch("/api/dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const d: any = await r.json();
  if (!r.ok)
    throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function short(value: string) {
  return value.length > 16 ? value.slice(0, 6) + "…" + value.slice(-5) : value;
}

export default function DevApp({ user }: { user: { name: string } | null }) {
  const [data, setData] = useState<Data>(EMPTY),
    [view, setView] = useState("Launch terminal"),
    [name, setName] = useState(""),
    [mission, setMission] = useState(""),
    [model, setModel] = useState(""),
    [models, setModels] = useState<
      { id: string; name: string; created?: number }[]
    >([]),
    [modelError, setModelError] = useState("");
  const [modal, setModal] = useState<
      "connections" | "example" | "create" | null
    >(null),
    [active, setActive] = useState<string | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [running, setRunning] = useState(""),
    [wallet, setWallet] = useState(""),
    [query, setQuery] = useState(""),
    [autoRefresh, setAutoRefresh] = useState(false),
    [tab, setTab] = useState("Proposals");
  const [keys, setKeys] = useState<Record<string, string>>({}),
    [aiCheck, setAiCheck] = useState<any>(null),
    [launchDraft, setLaunchDraft] = useState<Draft | null>(null),
    [launchState, setLaunchState] = useState<any>(null),
    [launchChecked, setLaunchChecked] = useState(false),
    [draftEdit, setDraftEdit] = useState<Draft | null>(null),
    [imageFile, setImageFile] = useState<File | null>(null);
  const launchTx = useRef<any>(null),
    formRef = useRef<HTMLFormElement>(null),
    closeRef = useRef<HTMLButtonElement>(null);
  const notify = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 5000);
  }, []);
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await fetch("/api/dev");
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load your workspace.");
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user]);
  useEffect(() => {
    void refresh();
    fetch("/api/models")
      .then(async (r) => {
        const d: any = await r.json();
        if (!r.ok)
          throw new Error(d.error || "Could not load OpenRouter models.");
        setModels(d.models);
        setModel("");
      })
      .catch((e) => setModelError(e.message));
    const p = new URLSearchParams(location.search);
    if (p.has("connected"))
      notify("OpenRouter connected. Choose your model and create a dev.");
    if (p.has("connection_error"))
      setError(p.get("connection_error") || "Connection failed.");
  }, [refresh, notify]);
  useEffect(() => {
    if (!modal && !launchDraft && !draftEdit) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setLaunchDraft(null);
        setDraftEdit(null);
      }
      if (e.key === "Tab") {
        const dialog = document.querySelector('[role="dialog"]');
        const items = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input,textarea,select",
          ) || [],
        );
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [modal, launchDraft, draftEdit]);
  const act = useCallback(
    async (
      action: string,
      payload: Record<string, unknown> = {},
      success = "",
    ) => {
      setBusy(action);
      setError("");
      try {
        const r = await api(action, payload);
        await refresh();
        if (action === "refresh_tweets") {
          if (r.errors?.length) setError(r.message);
          else if (success) notify(r.message || success);
        } else if (success) notify(success);
        return r;
      } catch (e) {
        setError((e as Error).message);
        if (action === "refresh_tweets") await refresh();
        return null;
      } finally {
        setBusy("");
      }
    },
    [refresh, notify],
  );
  useEffect(() => {
    if (
      !autoRefresh ||
      !["Tweet tracker", "Launch terminal"].includes(view) ||
      !user ||
      !(data.twitterStatus?.connected ?? data.connections.x)
    )
      return;
    const id = setInterval(() => {
      if (!document.hidden && !busy && data.tracks.length)
        void act("refresh_tweets");
    }, 120000);
    return () => clearInterval(id);
  }, [
    autoRefresh,
    view,
    user,
    (data.twitterStatus?.connected ?? data.connections.x),
    data.tracks.length,
    busy,
    act,
  ]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "open_dev_template",
          title: "Choose a dev template",
          description:
            "Fill the visible dev creation form with a meme scout, community builder, or trend watcher template. Does not create an agent or launch a coin.",
          inputSchema: {
            type: "object",
            properties: {
              template: {
                type: "string",
                enum: ["Meme scout", "Community builder", "Trend watcher"],
              },
            },
            required: ["template"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: any) => {
            const p = PRESETS.find((p) => p.label === input?.template);
            if (!p) throw new Error("Choose a listed template.");
            setName(p.name);
            setMission(p.mission);
            setView("Overview");
            setModal("create");
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            formRef.current?.scrollIntoView({ block: "center" });
            return { staged: true, name: p.name };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  function preset(p: (typeof PRESETS)[number]) {
    setName(p.name);
    setMission(p.mission);
    setModal("create");
    setView("Overview");
    setTimeout(
      () =>
        formRef.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        }),
      0,
    );
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      location.href = "/signin-with-chatgpt?return_to=/";
      return;
    }
    const result = await act(
      "create_agent",
      { name, mission, model },
      "Your dev is ready.",
    );
    if (result) {
      setActive(result.id);
      setView("My devs");
      setModal(null);
    }
  }
  async function run(id: string) {
    if (!data.connections.openrouter && !data.aiAccess?.available) {
      setModal("connections");
      return;
    }
    setRunning(id);
    setError("");
    try {
      const r = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id }),
      });
      if (!r.ok) {
        const d: any = await r.json();
        throw new Error(d.error || "Run could not start.");
      }
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line) {
            const event = JSON.parse(line);
            if (event.error) setError(event.error);
            await refresh();
          }
        }
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning("");
    }
  }
  async function connectWallet() {
    const provider = (window as any).phantom?.solana || (window as any).solana;
    if (!provider?.connect) {
      setError(
        "Open this site in a browser with the Phantom wallet extension to connect your Solana wallet.",
      );
      return null;
    }
    try {
      const r = await provider.connect();
      setWallet(r.publicKey.toString());
      return provider;
    } catch (e) {
      setError((e as Error).message || "Wallet connection cancelled.");
      return null;
    }
  }
  async function prepareLaunch() {
    if (!launchDraft) return;
    setBusy("prepare");
    setError("");
    try {
      const provider = await connectWallet();
      if (!provider) return;
      const pubkey = provider.publicKey.toString();
      const prepared = await api("prepare_launch", {
        draftId: launchDraft.id,
        wallet: pubkey,
      });
      const { VersionedTransaction } = await import("@solana/web3.js");
      launchTx.current = VersionedTransaction.deserialize(
        Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)),
      );
      setLaunchState(prepared);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function signLaunch() {
    if (!launchState || !launchDraft || !launchChecked) return;
    setBusy("sign");
    setError("");
    try {
      const provider =
        (window as any).phantom?.solana || (window as any).solana;
      if (provider?.publicKey?.toString() !== launchState.wallet)
        throw new Error(
          "Your wallet changed. Close this review and prepare the launch again.",
        );
      const result = await provider.signAndSendTransaction(launchTx.current);
      await api("record_submission", {
        draftId: launchDraft.id,
        signature: result.signature,
        mint: launchState.mint,
      });
      setLaunchState({ ...launchState, signature: result.signature });
      await refresh();
      notify("Transaction submitted. Check confirmation before retrying.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function uploadImage() {
    if (!draftEdit || !imageFile) return;
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.set("file", imageFile);
      form.set("draftId", draftEdit.id);
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed.");
      setDraftEdit({ ...draftEdit, image_url: d.url });
      await refresh();
      notify("Coin image uploaded to IPFS.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(async () => {
      if (running || busy) return;
      const s = data.sessions?.find(
        (s) =>
          s.enabled &&
          new Date(s.expires_at).getTime() > Date.now() &&
          s.used_launches < s.max_launches,
      );
      if (!s) return;
      try {
        if ((data.twitterStatus?.connected ?? data.connections.x) && data.tracks.length)
          await api("refresh_tweets");
        if (data.wallets?.length) await api("refresh_wallets");
        await run(s.agent_id);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 120000);
    return () => clearInterval(timer);
  }, [
    data.sessions,
    running,
    busy,
    user,
    (data.twitterStatus?.connected ?? data.connections.x),
    data.tracks.length,
  ]);
  const selected = data.agents.find((a) => a.id === active);
  const selectedDrafts = data.drafts.filter(
    (d) => !active || d.agent_id === active,
  );
  const selectedEvents = data.events.filter(
    (e) => !active || e.agent_id === active,
  );
  const events = (items: Event[]) =>
    items.length ? (
      items.slice(0, 12).map((e) => (
        <div className="event" key={e.id}>
          <span className="event-icon">
            {e.kind === "error" ? (
              <X size={15} />
            ) : e.kind === "draft" ? (
              <Rocket size={15} />
            ) : (
              <Check size={15} />
            )}
          </span>
          <div>
            <p>{e.message}</p>
            <time>
              {time(e.created_at)} · {e.kind}
            </time>
          </div>
        </div>
      ))
    ) : (
      <div className="empty">
        <Activity size={28} />
        <h3>Every action, in the open.</h3>
        <p>
          Run a dev to see its signals, tool calls, and decision summaries here.
        </p>
      </div>
    );
  const draftCard = (d: Draft) => (
    <div className="workspace-body" key={d.id}>
      <div className="coin">
        <div className="coin-art">
          {d.image_url ? (
            <img src={d.image_url} alt={d.name} />
          ) : (
            d.symbol.slice(0, 2)
          )}
        </div>
        <div>
          <h3>{d.name}</h3>
          <p className="muted mono">
            ${d.symbol} <span className="badge">{d.status}</span>
          </p>
        </div>
      </div>
      <p className="content">{d.description}</p>
      <div className="note">
        <b>Decision summary</b>
        <br />
        {d.rationale}
      </div>
      {d.id !== "demo" && (
        <div className="row wrap">
          <button
            className="button small"
            onClick={() => {
              setDraftEdit(d);
              setImageFile(null);
            }}
          >
            Edit proposal
          </button>
          {!d.signature ? (
            <button
              className="button small primary"
              onClick={() => {
                setLaunchDraft(d);
                setLaunchState(null);
                setLaunchChecked(false);
              }}
            >
              Review launch
            </button>
          ) : (
            <>
              <a
                className="button small"
                href={"https://solscan.io/tx/" + d.signature}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
                Transaction
              </a>
              <button
                className="button small"
                disabled={!!busy}
                onClick={() =>
                  act(
                    "confirm_launch",
                    { draftId: d.id },
                    "Confirmation checked.",
                  )
                }
              >
                Check confirmation
              </button>
              {d.status === "launched" && (
                <a
                  className="button small primary"
                  target="_blank"
                  rel="noreferrer"
                  href={"https://pump.fun/coin/" + d.mint}
                >
                  View on pump.fun
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
  const advancedProps = {
    data,
    act,
    busy,
    user,
    connect: connectWallet,
    notify,
    setError,
    refresh,
    learnWallet: (address: string) => {
      setName("Wallet research dev");
      setMission(
        "Study the saved observations for wallet " +
          address +
          ". Explain its launch themes, trade timing, and matched buy/sell SOL cashflow when available. Separate observed facts from hypotheses about why trades worked. Never infer lifetime PNL or motives from a partial sample. Use these lessons to propose one original pump.fun coin with a visible thesis and source links.",
      );
      setModal("create");
    },
  };
  const createForm = (
    <form ref={formRef} className="launch-box" onSubmit={create}>
      <div className="panel-title">
        <h2>Create your dev</h2>
        <span className="badge green">01 / CONFIGURE</span>
      </div>
      <label className="field">
        <span>Dev name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Meme scout"
          required
          maxLength={60}
        />
      </label>
      <label className="field">
        <span>
          <ModelAvatar model={model} size={20} />
          AI model <span className="spacer" />
          <span className="tiny muted">via OpenRouter</span>
        </span>
        <select
          className="input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
        >
          <option value="">
            {modelError ? "Model catalog unavailable" : "Choose a model"}
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {modelError && (
        <p className="tiny muted">
          {modelError}{" "}
          <button
            type="button"
            className="preset"
            onClick={() => location.reload()}
          >
            Retry
          </button>
        </p>
      )}
      <label className="field">
        <span>What should it look for?</span>
        <textarea
          className="input"
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          placeholder="Find original meme ideas in my tracked tweets and prepare a coin launch…"
          required
          minLength={12}
          maxLength={3000}
        />
      </label>
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="preset"
            type="button"
            onClick={() => preset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="launch-bottom">
        <span className="muted">
          Your dev proposes.
          <br />
          You control the launch budget.
        </span>
        <button
          className="button primary"
          disabled={!!busy || !model}
          type="submit"
        >
          <Plus size={16} />
          {busy === "create_agent" ? "Creating…" : "Create dev"}
        </button>
      </div>
    </form>
  );
  return (
    <>
      <div className="topline">
        <b>DEV</b> &nbsp; YOUR MODEL. YOUR COIN. &nbsp;{" "}
        <span>POWERED BY OPENROUTER</span>
      </div>
      <header className="shell">
        <div className="nav">
          <button
            className="brand"
            onClick={() => {
              setView("Overview");
              setActive(null);
            }}
            aria-label="Dev home"
          >
            <Terminal size={31} strokeWidth={2.6} />
            dev
          </button>
          <nav className="navlinks" aria-label="Main navigation">
            {[
              "Launch terminal",
              "Overview",
              "My devs",
              "Wallet tracker",
              "Tweet tracker",
              "Main coin",
            ].map((v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => {
                  setView(v);
                  setActive(null);
                }}
              >
                {v}
              </button>
            ))}
          </nav>
          <div className="nav-actions">
            <button
              className="button primary round"
              onClick={() => setView("Launch terminal")}
            >
              Launch
            </button>
            <button
              className="button ghost"
              onClick={() => setModal("connections")}
            >
              <Link2 size={15} />
              <span>
                {data.connections.openrouter ? "Connected" : "Connect AI"}
              </span>
            </button>
            <button className="button primary round" onClick={connectWallet}>
              <Wallet size={15} />
              <span>{wallet ? short(wallet) : "Connect wallet"}</span>
            </button>
          </div>
        </div>
      </header>
      <div className="ticker">
        <div className="shell ticker-inner">
          <b className="ticker-label">
            <Radio size={13} /> AGENT NETWORK
          </b>
          <span>
            <Cpu size={13} /> Your model. Your API key.
          </span>
          <span>
            <MessageCircle size={13} /> Tweets become launch signals
          </span>
          <span>
            <ShieldCheck size={13} /> Wallet or capped instant mode
          </span>
        </div>
      </div>
      <main className="shell">
        {error && (
          <div className="note error" role="alert">
            <div className="row between">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        {view === "Launch terminal" ? (
          <DeployStudio
            data={data}
            models={models}
            model={model}
            setModel={setModel}
            user={user}
            busy={busy}
            running={running}
            act={act}
            run={run}
            connect={connectWallet}
            connections={() => setModal("connections")}
            review={(d) => {
              setLaunchDraft(d);
              setLaunchState(null);
              setLaunchChecked(false);
            }}
            refresh={refresh}
            setError={setError}
            wallet={wallet}
            view={setView}
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
          />
        ) : view === "Overview" ? (
          <>
            <section className="intro">
              <div>
                <span className="tag">
                  <Zap size={12} /> BUILT TO LAUNCH ON PUMP.FUN
                </span>
                <h1>
                  AI devs
                  <br />
                  that launch
                  <br />
                  <em>memecoins.</em>
                </h1>
                <p>
                  Create your own AI dev. Give it a model, let it follow the
                  conversation, and turn fresh ideas into your next coin launch.
                </p>
                <div className="intro-foot">
                  <button
                    className="button primary"
                    onClick={() => setModal("create")}
                  >
                    Launch a dev
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => setModal("example")}
                  >
                    See what a dev creates
                  </button>
                </div>
              </div>
            </section>
            <div className="stats">
              {[
                ["YOUR DEVS", data.agents.length, "ready to build"],
                ["COIN PROPOSALS", data.drafts.length, "ideas to review"],
                [
                  "CONFIRMED LAUNCHES",
                  data.drafts.filter((d) => d.status === "launched").length,
                  "on pump.fun",
                ],
                ["TWEET SIGNALS", data.tweets.length, "in your feed"],
              ].map(([label, n, hint]) => (
                <div className="stat" key={label}>
                  <div className="label">{label}</div>
                  <strong>
                    {n} <small>{hint}</small>
                  </strong>
                </div>
              ))}
            </div>
            <div className="workspace-grid">
              <section className="panel">
                <div className="panelhead">
                  <h3>Your devs</h3>
                  <span className="badge">{data.agents.length} CREATED</span>
                </div>
                {data.agents.length ? (
                  data.agents.slice(0, 3).map((a) => (
                    <button
                      className="agentrow"
                      key={a.id}
                      onClick={() => {
                        setActive(a.id);
                        setView("My devs");
                      }}
                    >
                      <div className="agent-icon">
                        <ModelAvatar model={a.model} name={a.name} size={30} />
                      </div>
                      <div>
                        <h3>{a.name}</h3>
                        <p>{a.model}</p>
                      </div>
                      <span className="badge green">{a.status}</span>
                    </button>
                  ))
                ) : (
                  <div className="empty">
                    <Bot size={28} />
                    <h3>Your first dev starts here.</h3>
                    <p>
                      Pick a template above or give your dev a mission of its
                      own.
                    </p>
                  </div>
                )}
                <div className="demo">
                  <div>
                    <strong>Take a look under the hood.</strong>
                    <p>Explore a sample coin proposal before you begin.</p>
                  </div>
                  <button
                    className="button small"
                    onClick={() => setModal("example")}
                  >
                    View example
                  </button>
                </div>
              </section>
              <section className="panel">
                <div className="panelhead">
                  <h3>Latest activity</h3>
                  <button
                    className="tiny muted"
                    onClick={() => {
                      setView("Activity");
                      setActive(null);
                    }}
                  >
                    View all
                  </button>
                </div>
                {events(data.events.slice(0, 3))}
              </section>
            </div>
            <div className="steps">
              {[
                [
                  "01",
                  "Choose your intelligence",
                  "Connect OpenRouter and pick the model behind your dev.",
                ],
                [
                  "02",
                  "Tune into the conversation",
                  "Track accounts and keywords on X. Turn signals into ideas.",
                ],
                [
                  "03",
                  "Review. Sign. Launch.",
                  "Your dev drafts the coin. You approve the details in your wallet.",
                ],
              ].map(([n, h, p]) => (
                <div className="step" key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{h}</h3>
                    <p>{p}</p>
                  </div>
                </div>
              ))}
            </div>
            <HomepageStory
              onTerminal={() => setView("Launch terminal")}
              onWallet={() => setView("Wallet tracker")}
            />
          </>
        ) : view === "My devs" ? (
          <section className="section">
            <div className="sectionhead">
              <div>
                <div className="eyebrow">Your workspace</div>
                <h2 style={{ marginTop: 10 }}>
                  {selected ? selected.name : "Your autonomous devs"}
                </h2>
                <p>
                  {selected
                    ? selected.model
                    : "A model, a mission, and a launch waiting to happen."}
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => {
                  setModal("create");
                }}
              >
                <Plus size={15} />
                New dev
              </button>
            </div>
            {!selected ? (
              <div className="panel">
                {data.agents.length ? (
                  data.agents.map((a) => (
                    <button
                      key={a.id}
                      className="agentrow"
                      onClick={() => setActive(a.id)}
                    >
                      <div className="agent-icon">
                        <ModelAvatar model={a.model} name={a.name} size={30} />
                      </div>
                      <div>
                        <h3>{a.name}</h3>
                        <p>{a.mission}</p>
                      </div>
                      <span className="badge green">{a.status}</span>
                      <ChevronRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty">
                    <Bot size={30} />
                    <h3>No devs yet.</h3>
                    <p>Create a dev to start generating coin proposals.</p>
                    <button
                      className="button"
                      onClick={() => preset(PRESETS[0])}
                    >
                      Use Meme scout template
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="note">
                  <div className="row between wrap">
                    <span>{selected.mission}</span>
                    <div className="row">
                      {running === selected.id ? (
                        <button
                          className="button small"
                          disabled={!!busy}
                          onClick={() =>
                            act(
                              "cancel_run",
                              { agentId: selected.id },
                              "Stop requested. The current step will finish.",
                            )
                          }
                        >
                          <Square size={12} />
                          Stop
                        </button>
                      ) : (
                        <button
                          className="button primary small"
                          disabled={!!running || selected.status === "running"}
                          onClick={() => run(selected.id)}
                        >
                          <Zap size={14} />
                          {selected.status === "running"
                            ? "Running…"
                            : "Run dev"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="panel">
                  <div className="tabs">
                    {["Proposals", "Execution log", "Instant launch"].map(
                      (t) => (
                        <button
                          key={t}
                          className={tab === t ? "active" : ""}
                          onClick={() => setTab(t)}
                        >
                          {t === "Proposals" ? (
                            <Rocket size={14} />
                          ) : (
                            <Activity size={14} />
                          )}{" "}
                          {t}
                        </button>
                      ),
                    )}
                    <span className="spacer" />
                    <button onClick={refresh}>
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                  </div>
                  {tab === "Instant launch" ? (
                    <InstantLaunch {...advancedProps} agentId={selected.id} />
                  ) : tab === "Execution log" ? (
                    <>
                      <div className="note" style={{ margin: 20 }}>
                        Actual actions and concise decision summaries. Private
                        model reasoning is not displayed.
                      </div>
                      {events(selectedEvents)}
                    </>
                  ) : selectedDrafts.length ? (
                    selectedDrafts.map(draftCard)
                  ) : (
                    <div className="empty">
                      <Rocket size={30} />
                      <h3>
                        {running
                          ? "Your dev is working."
                          : "Ready for its first mission."}
                      </h3>
                      <p>
                        {running
                          ? "Open the execution log to follow its progress."
                          : "Add tweet signals, connect OpenRouter, and run your dev to create a proposal."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="row" style={{ marginTop: 16 }}>
                  <button
                    className="button ghost small"
                    onClick={() => setActive(null)}
                  >
                    All devs
                  </button>
                  <span className="tiny muted">
                    One run · up to 6 model steps · no automatic transactions
                  </span>
                </div>
              </>
            )}
          </section>
        ) : view === "Wallet tracker" ? (
          <WalletTracker {...advancedProps} />
        ) : view === "Main coin" ? (
          <MainCoin {...advancedProps} />
        ) : view === "Tweet tracker" ? (
          <section className="section">
            <div className="sectionhead">
              <div>
                <div className="eyebrow">The signal before the coin</div>
                <h2 style={{ marginTop: 10 }}>Tweet tracker</h2>
                <p>
                  Follow the accounts and conversations your dev should pay
                  attention to.
                </p>
              </div>
              <button
                className="button primary"
                disabled={!!busy || !data.tracks.length}
                onClick={() =>
                  (data.twitterStatus?.connected ?? data.connections.x)
                    ? act("refresh_tweets", {}, "Tweet feed refreshed.")
                    : setModal("connections")
                }
              >
                <RefreshCw size={14} />
                {busy === "refresh_tweets" ? "Refreshing…" : "Refresh feed"}
              </button>
            </div>
            <div className="tracker-layout">
              <aside className="panel">
                <form
                  className="trackerform"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await act(
                      "add_track",
                      { query },
                      "Tracker added.",
                    );
                    if (r) setQuery("");
                  }}
                >
                  <h3 className="subhead" style={{ marginTop: 0 }}>
                    Watch a conversation
                  </h3>
                  <label className="field">
                    <span>Account, keyword, or X query</span>
                    <input
                      className="input"
                      placeholder="@username or a topic"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      required
                      maxLength={400}
                    />
                  </label>
                  <button className="button full" disabled={!!busy || !user}>
                    <Plus size={14} />
                    Add tracker
                  </button>
                  {!user && (
                    <a
                      className="button full"
                      style={{ marginTop: 10 }}
                      href="/signin-with-chatgpt?return_to=/"
                    >
                      Sign in to save trackers
                    </a>
                  )}
                </form>
                {data.tracks.map((t) => (
                  <div className="track" key={t.id}>
                    <div>
                      <h3>{t.query}</h3>
                      <p>
                        {t.last_checked
                          ? "Checked " + time(t.last_checked)
                          : "Waiting for first refresh"}
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={"Remove " + t.query}
                      onClick={() => act("remove_track", { id: t.id })}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <div style={{ padding: 20 }}>
                  <label className="row tiny muted">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                    />
                    Refresh every 2 minutes while this tab is open
                  </label>
                  <p className="tiny muted" style={{ marginTop: 12 }}>
                    A connected tweet provider is required. Refreshes use
                    that provider's credits.
                  </p>
                </div>
              </aside>
              <section className="panel">
                <div className="panelhead">
                  <h3>Latest signals</h3>
                  <span
                    className={"badge " + ((data.twitterStatus?.connected ?? data.connections.x) ? "green" : "")}
                  >
                    {twitterLabel(data.twitterStatus, (data.twitterStatus?.connected ?? data.connections.x))}
                  </span>
                </div>
                <TwitterStatus status={data.twitterStatus} />
                {data.tweets.length ? (
                  data.tweets.map((t) => (
                    <article className="tweet" key={t.id}>
                      <div className="row between">
                        <b className="smalltext">@{t.author}</b>
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open tweet on X"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                      <p>{t.text}</p>
                      <div className="tweetfooter">
                        <span>
                          {new Date(t.created_at).toLocaleString()} · {t.likes}{" "}
                          likes
                        </span>
                        <span>Available to your devs</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty">
                    <Radio size={34} />
                    <h3>Find your next idea in the feed.</h3>
                    <p>
                      Add an account or keyword and connect X to pull in real
                      tweets. Your dev can use the saved signals in its next
                      run.
                    </p>
                    <button
                      className="button"
                      onClick={() => setModal("connections")}
                    >
                      {(data.twitterStatus?.connected ?? data.connections.x) ? "Manage tweet access" : "Connect tweet API"}
                    </button>
                  </div>
                )}
              </section>
            </div>
          </section>
        ) : (
          <section className="section">
            <div className="sectionhead">
              <div>
                <div className="eyebrow">A record of every step</div>
                <h2 style={{ marginTop: 10 }}>Execution log</h2>
                <p>
                  Signals read, proposals created, and launch confirmations.
                </p>
              </div>
              <button className="button" onClick={refresh}>
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            <div className="panel">{events(data.events)}</div>
          </section>
        )}
        <footer className="footer">
          <button className="brand" onClick={() => setView("Overview")}>
            <Terminal size={23} />
            dev
          </button>
          <span>From a signal to something of your own.</span>
          <div className="row">
            <a href="https://openrouter.ai" target="_blank" rel="noreferrer">
              OpenRouter
            </a>
            <span>·</span>
            <a href="https://pump.fun" target="_blank" rel="noreferrer">
              pump.fun
            </a>
            <span>·</span>
            <button onClick={() => setModal("connections")}>Connections</button>
          </div>
        </footer>
      </main>
      {(modal || launchDraft || draftEdit) && (
        <div
          className="dialogback"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setModal(null);
              setLaunchDraft(null);
              setDraftEdit(null);
            }
          }}
        >
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "create"
                ? "Create a dev"
                : modal === "connections"
                  ? "Connections"
                  : modal === "example"
                    ? "Example proposal"
                    : draftEdit
                      ? "Edit coin proposal"
                      : "Review coin launch"
            }
          >
            <div className="row between">
              <h2>
                {modal === "create"
                  ? "Launch your dev."
                  : modal === "connections"
                    ? "Make the connections."
                    : modal === "example"
                      ? "Meet Terminal Cat."
                      : draftEdit
                        ? "Refine your coin."
                        : "Review your launch."}
              </h2>
              <button
                ref={closeRef}
                className="icon-button"
                aria-label="Close dialog"
                disabled={!!busy}
                onClick={() => {
                  setModal(null);
                  setLaunchDraft(null);
                  setDraftEdit(null);
                  setError("");
                }}
              >
                <X size={17} />
              </button>
            </div>
            {error && (
              <div className="note error" role="alert">
                {error}
              </div>
            )}
            {modal === "create" ? (
              createForm
            ) : modal === "example" ? (
              <>
                <p>
                  This is a sample proposal, not a live run or a launched coin.
                </p>
                {draftCard(DEMO)}
                <button
                  className="button primary full"
                  onClick={() => {
                    setModal(null);
                    preset(PRESETS[0]);
                  }}
                >
                  Create a dev like this
                </button>
              </>
            ) : modal === "connections" ? (
              <>
                <p>
                  Connect the services that power your dev. Credentials stay
                  encrypted on the server.
                </p>
                {!user ? (
                  <a
                    className="button primary full"
                    style={{ marginTop: 20 }}
                    href="/signin-with-chatgpt?return_to=/"
                  >
                    Sign in to connect your accounts
                  </a>
                ) : (
                  <>
                    <div className="connection">
                      <div className="row between">
                        <h3>Pump.fun launches</h3>
                        <span className="badge">OFFICIAL SDK</span>
                      </div>
                      <p>
                        No Pump API key required. Connect a Solana mainnet RPC,
                        Pinata for artwork, and a funded wallet to prepare and
                        sign a launch.
                      </p>
                      <a
                        className="story-text-link"
                        href="https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Pump.fun creation docs <ExternalLink size={12} />
                      </a>
                    </div>
                    <div className="connection">
                      <div className="row between">
                        <h3>Model funding</h3>
                        <span className="badge">
                          {data.aiAccess?.source === "sponsored"
                            ? "DEV-FUNDED"
                            : data.connections.openrouter
                              ? "YOUR ACCOUNT"
                              : "SETUP REQUIRED"}
                        </span>
                      </div>
                      <p>
                        {data.aiAccess?.message ||
                          "Connect OpenRouter to start. Platform-funded access becomes available when an operator assigns your workspace a capped budget."}
                      </p>
                      {data.aiAccess?.source === "sponsored" && (
                        <p>
                          Daily allowance: $
                          {data.aiAccess.dailyLimitUsd?.toFixed(2)} · resets at
                          midnight UTC.
                        </p>
                      )}
                      {data.aiAccess?.available && (
                        <div className="row wrap" style={{ marginTop: 12 }}>
                          <button
                            className="button small"
                            disabled={!!busy}
                            onClick={async () => {
                              setAiCheck(null);
                              const result = await act("check_ai");
                              if (result) setAiCheck(result);
                            }}
                          >
                            Check key allowance
                          </button>
                          <button
                            className="button small"
                            disabled={!!busy || !model}
                            onClick={async () => {
                              setAiCheck(null);
                              const result = await act("check_ai", { model });
                              if (result) setAiCheck(result);
                            }}
                          >
                            Test selected model · 64 tokens
                          </button>
                        </div>
                      )}
                      {aiCheck && (
                        <div className="note" role="status">
                          <p>
                            {aiCheck.remainingUsd === null
                              ? "No key allowance limit reported."
                              : "$" +
                                aiCheck.remainingUsd.toFixed(4) +
                                " key allowance remaining."}{" "}
                            Account credits are separate.
                          </p>
                          {aiCheck.expiresAt && (
                            <p>
                              Expires{" "}
                              {new Date(aiCheck.expiresAt).toLocaleDateString()}
                              .
                            </p>
                          )}
                          {aiCheck.reply && (
                            <p>Live model response: {aiCheck.reply}</p>
                          )}
                        </div>
                      )}
                      <p>
                        Creator-fee revenue can replenish the project’s AI
                        budget after collection. OpenRouter credits are
                        purchased separately.
                      </p>
                      <a
                        className="story-text-link"
                        href="https://openrouter.ai/settings/credits"
                        target="_blank"
                        rel="noreferrer"
                      >
                        OpenRouter credits <ExternalLink size={12} />
                      </a>
                    </div>
                    {[
                      [
                        "openrouter",
                        "OpenRouter",
                        "Choose from current models with tool support. Your OpenRouter account pays for model usage.",
                        "https://openrouter.ai/settings/keys",
                      ],
                      [
                        "x",
                        "X / Twitter",
                        "Create an app in the X Developer Console, add API credits, and copy its app-only bearer token. Your first refresh verifies read access.",
                        "https://console.x.com",
                      ],
                      [
                        "pinata",
                        "Pinata / IPFS",
                        "Upload coin artwork and metadata to IPFS before launching.",
                        "https://app.pinata.cloud/developers/api-keys",
                      ],
                      [
                        "twitterapi",
                        "TwitterAPI.io",
                        "Alternative tweet feed with its own credits. Dev reads one page per refresh, with a two-minute interval per tracker. Saving a key does not switch your active provider.",
                        "https://twitterapi.io/dashboard",
                      ],
                      [
                        "rpc",
                        "Solana RPC",
                        "An HTTPS mainnet RPC endpoint for transaction preparation and confirmation.",
                        "https://solana.com/docs/rpc",
                      ],
                    ].map(([key, title, desc, setupUrl]) => (
                      <div className="connection" key={key}>
                        <div className="row between">
                          <h3>{title}</h3>
                          <span
                            className={
                              "badge " + (data.connections[key] ? "green" : "")
                            }
                          >
                            {key === (data.twitterStatus?.provider || "x")
                              ? twitterLabel(
                                  data.twitterStatus,
                                  (data.twitterStatus?.connected ?? data.connections.x),
                                )
                              : data.connections[key]
                                ? "CONNECTED"
                                : "NOT CONNECTED"}
                          </span>
                        </div>
                        <p>{desc}</p>
                        <a
                          className="story-text-link"
                          href={setupUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {title} setup <ExternalLink size={12} />
                        </a>
                        {key === "openrouter" &&
                          !data.connections.openrouter && (
                            <a
                              className="button primary full"
                              href="/api/openrouter/connect"
                            >
                              Connect with OpenRouter
                            </a>
                          )}
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const r = await act(
                              "save_connection",
                              { provider: key, value: keys[key] },
                              key === "x" || key === "twitterapi"
                                ? title + " key saved. Select this provider and refresh the feed to verify access."
                                : title + " connected.",
                            );
                            if (r) setKeys({ ...keys, [key]: "" });
                          }}
                        >
                          <label className="field">
                            <span>
                              {key === "rpc"
                                ? "RPC endpoint"
                                : key === "x"
                                  ? "X API bearer token"
                                  : key === "twitterapi"
                                    ? "TwitterAPI.io API key"
                                  : key === "pinata"
                                    ? "Pinata JWT"
                                    : "Or use an API key"}
                            </span>
                            <input
                              className="input"
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              value={keys[key] || ""}
                              onChange={(e) =>
                                setKeys({ ...keys, [key]: e.target.value })
                              }
                              placeholder={
                                key === "rpc"
                                  ? "https://your-mainnet-rpc.example"
                                  : "Enter securely"
                              }
                              required
                            />
                          </label>
                          <div className="row">
                            <button className="button small" disabled={!!busy}>
                              Save connection
                            </button>
                            {data.connections[key] && (
                              <button
                                type="button"
                                className="button small ghost"
                                disabled={!!busy}
                                onClick={() =>
                                  act(
                                    "disconnect",
                                    { provider: key },
                                    title + " disconnected.",
                                  )
                                }
                              >
                                <Unplug size={12} />
                                Disconnect
                              </button>
                            )}
                          </div>
                        </form>
                        {(key === "x" || key === "twitterapi") && data.connections[key] && (
                          <button className="button small" disabled={!!busy || key === (data.twitterStatus?.provider || "x")} onClick={() => act("set_twitter_provider", { provider: key }, title + " selected for the tweet feed.")}>
                            {key === (data.twitterStatus?.provider || "x") ? "Active tweet provider" : "Use for tweet feed"}
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : draftEdit ? (
              <>
                <p>
                  Check the name, symbol, description, and image before making
                  the metadata permanent on IPFS.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await act(
                      "edit_draft",
                      {
                        id: draftEdit.id,
                        name: draftEdit.name,
                        symbol: draftEdit.symbol,
                        description: draftEdit.description,
                      },
                      "Proposal saved.",
                    );
                    if (r) setDraftEdit(null);
                  }}
                >
                  <div className="grid2">
                    <label className="field">
                      <span>Coin name</span>
                      <input
                        className="input"
                        required
                        maxLength={32}
                        value={draftEdit.name}
                        onChange={(e) =>
                          setDraftEdit({ ...draftEdit, name: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Symbol</span>
                      <input
                        className="input"
                        required
                        maxLength={13}
                        pattern="[A-Za-z0-9]+"
                        value={draftEdit.symbol}
                        onChange={(e) =>
                          setDraftEdit({
                            ...draftEdit,
                            symbol: e.target.value.toUpperCase(),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Description</span>
                    <textarea
                      className="input"
                      required
                      maxLength={2000}
                      value={draftEdit.description}
                      onChange={(e) =>
                        setDraftEdit({
                          ...draftEdit,
                          description: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Coin image · PNG, JPG, or WebP · up to 2 MB</span>
                    <input
                      className="input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) =>
                        setImageFile(e.target.files?.[0] || null)
                      }
                    />
                  </label>
                  {draftEdit.image_url && (
                    <p className="smalltext">Image uploaded ✓</p>
                  )}
                  <div className="row wrap">
                    <button
                      className="button"
                      type="button"
                      disabled={!imageFile || !!busy}
                      onClick={uploadImage}
                    >
                      {busy === "upload"
                        ? "Uploading…"
                        : "Upload image to IPFS"}
                    </button>
                    <button className="button primary" disabled={!!busy}>
                      Save proposal
                    </button>
                  </div>
                </form>
              </>
            ) : launchDraft ? (
              <>
                <p>
                  Your wallet will create this coin on Solana mainnet through
                  the pump.fun program. This version creates the coin with no
                  initial token purchase.
                </p>
                <div className="coin" style={{ marginTop: 22 }}>
                  <div className="coin-art">
                    {launchDraft.image_url ? (
                      <img src={launchDraft.image_url} alt="Coin artwork" />
                    ) : (
                      launchDraft.symbol.slice(0, 2)
                    )}
                  </div>
                  <div>
                    <h3>{launchDraft.name}</h3>
                    <p className="mono">${launchDraft.symbol}</p>
                  </div>
                </div>
                <p>{launchDraft.description}</p>
                <div className="note">
                  You pay network fees and account rent. Your wallet remains the
                  creator. No wallet secret is shared with Dev or the AI model.
                </div>
                {!launchDraft.image_url ? (
                  <p className="danger">
                    Add coin artwork using Edit proposal before preparing this
                    launch.
                  </p>
                ) : !launchState ? (
                  <button
                    className="button primary full"
                    disabled={!!busy}
                    onClick={prepareLaunch}
                  >
                    {busy === "prepare"
                      ? "Preparing…"
                      : "Prepare launch for review"}
                  </button>
                ) : launchState.signature ? (
                  <>
                    <div className="note">
                      Submitted: {short(launchState.signature)}. A submission is
                      not a confirmation.
                    </div>
                    <a
                      className="button full"
                      href={"https://solscan.io/tx/" + launchState.signature}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View transaction
                    </a>
                    <button
                      className="button primary full"
                      style={{ marginTop: 10 }}
                      disabled={!!busy}
                      onClick={() =>
                        act(
                          "confirm_launch",
                          { draftId: launchDraft.id },
                          "Confirmation checked.",
                        )
                      }
                    >
                      Check confirmation
                    </button>
                  </>
                ) : (
                  <>
                    <div className="note">
                      <b>
                        Estimated wallet debit: {launchState.estimatedSol} SOL
                      </b>
                      <br />
                      Includes simulated account creation and network fee.
                      <br />
                      Wallet: {short(launchState.wallet)}
                      <br />
                      Mint: {short(launchState.mint)}
                    </div>
                    <label
                      className="row smalltext"
                      style={{ margin: "18px 0" }}
                    >
                      <input
                        type="checkbox"
                        checked={launchChecked}
                        onChange={(e) => setLaunchChecked(e.target.checked)}
                      />
                      I reviewed this coin and the estimated mainnet cost.
                    </label>
                    <button
                      className="button primary full"
                      disabled={!launchChecked || !!busy}
                      onClick={signLaunch}
                    >
                      <Wallet size={15} />
                      {busy === "sign"
                        ? "Waiting for wallet…"
                        : "Sign and launch in wallet"}
                    </button>
                    <p className="tiny">
                      Preparing publishes metadata to IPFS. Signing creates the
                      coin permanently. If the transaction expires, close this
                      dialog and prepare it again.
                    </p>
                  </>
                )}
              </>
            ) : null}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
