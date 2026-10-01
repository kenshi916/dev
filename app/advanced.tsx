"use client";
import FeeRoutes from "./fee-routes";
import WalletEvidence from "./wallet-evidence";
import { useEffect, useState } from "react";
import {
  Activity,
  ExternalLink,
  Eye,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Zap,
  Square,
  Upload,
  Coins,
} from "lucide-react";
const WATCH = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
type Props = {
  data: any;
  act: (action: string, payload?: any, success?: string) => Promise<any>;
  busy: string;
  user: any;
  connect: () => Promise<any>;
  notify: (s: string) => void;
  setError: (s: string) => void;
  refresh: () => Promise<void>;
  learnWallet?: (address: string) => void;
};
export function WalletTracker({ data, act, busy, user, learnWallet }: Props) {
  const [address, setAddress] = useState(""),
    [label, setLabel] = useState("");
  return (
    <section className="section">
      <div className="sectionhead">
        <div>
          <div className="eyebrow">Follow the builders</div>
          <h2 style={{ marginTop: 12 }}>Learn the launch style.</h2>
          <p>
            Study launch history, observed trades, and matched buy/sell results.
            Give your dev evidence for what worked and what remains unknown.
          </p>
        </div>
        <button
          className="button primary"
          disabled={!!busy || !user}
          onClick={() => act("refresh_wallets", {}, "Wallet scan finished.")}
        >
          <RefreshCw size={14} />
          {busy === "refresh_wallets" ? "Scanning…" : "Scan wallets"}
        </button>
      </div>
      <div className="tracker-layout">
        <aside className="panel">
          <form
            className="trackerform"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  "add_wallet",
                  { query: address, label },
                  "Developer wallet added.",
                )
              ) {
                setAddress("");
                setLabel("");
              }
            }}
          >
            <h3 className="subhead" style={{ marginTop: 0 }}>
              Track a developer
            </h3>
            <label className="field">
              <span>Wallet address</span>
              <input
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                placeholder="Solana public address"
              />
            </label>
            <label className="field">
              <span>Your label</span>
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="e.g. Developer 01"
              />
            </label>
            <button className="button full" disabled={!user || !!busy}>
              <Plus size={14} />
              Track wallet
            </button>
          </form>
          {(data.wallets?.length
            ? data.wallets
            : [
                {
                  id: "suggested",
                  query: WATCH,
                  label: "Your selected developer",
                },
              ]
          ).map((w: any) => (
            <div className="track" key={w.id}>
              <div style={{ minWidth: 0 }}>
                <h3>{w.label || "Developer wallet"}</h3>
                <a
                  className="tiny mono muted"
                  style={{ wordBreak: "break-all" }}
                  href={"https://solscan.io/account/" + w.query}
                  target="_blank"
                  rel="noreferrer"
                >
                  {w.query}
                </a>
                <p>
                  {w.last_checked
                    ? "Last checked " +
                      new Date(w.last_checked).toLocaleTimeString()
                    : "Ready for first scan"}
                </p>
                {learnWallet && (
                  <button
                    className="button small"
                    style={{ marginTop: 10 }}
                    disabled={!user || !!busy}
                    onClick={() => learnWallet(w.query)}
                  >
                    Create a dev from this wallet
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="note" style={{ margin: 18 }}>
            Addresses are public sources. Labels do not verify the identity or
            reputation of their owners.
          </div>
        </aside>
        <div className="panel">
          <div className="panelhead">
            <h3>Observed launches & trades</h3>
            <span className="badge">RECENT SAMPLE</span>
          </div>
          {data.walletSignals?.length ? (
            data.walletSignals.map((s: any) => {
              let c: any = {};
              try {
                c = JSON.parse(s.text);
              } catch {}
              return (
                <article className="tweet" key={s.id}>
                  <div className="row between">
                    <b>
                      {c.name ||
                        (c.observation === "pump_trade"
                          ? "Observed Pump trade"
                          : c.observation === "balance_change"
                            ? "Wallet activity"
                            : "pump.fun launch")}{" "}
                      {c.symbol && <span className="badge">${c.symbol}</span>}
                    </b>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View source transaction"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  <p>
                    {c.summary ||
                      c.description ||
                      "On-chain launch verified; description is unavailable."}
                  </p>
                  <WalletEvidence analysis={c.analysis} />
                  <div className="tweetfooter">
                    <span>{new Date(s.created_at).toLocaleString()}</span>
                    <span>Source available to your dev</span>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty">
              <Eye size={34} />
              <h3>A style starts with evidence.</h3>
              <p>
                Scan the selected wallet to collect recent launches and trades.
                Matched buy/sell activity can explain observed SOL cashflow.
                Your chosen model can use those facts to develop a launch
                thesis.
              </p>
              {!user ? (
                <a className="button" href="/signin-with-chatgpt?return_to=/">
                  Sign in to track this wallet
                </a>
              ) : (
                <p className="tiny">
                  Scans use a public Solana RPC. Connect your own endpoint for
                  reliable access.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function InstantLaunch({
  data,
  act,
  busy,
  user,
  connect,
  notify,
  setError,
  refresh,
  agentId,
}: Props & { agentId: string }) {
  const [maxSol, setMaxSol] = useState("0.05"),
    [perLaunch, setPerLaunch] = useState("0.015"),
    [maxLaunches, setMaxLaunches] = useState("3"),
    [consent, setConsent] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [uploading, setUploading] = useState(false);
  const session = data.sessions?.find((s: any) => s.agent_id === agentId);
  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const f = new FormData();
      f.set("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: f });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      await refresh();
      notify("Default coin artwork uploaded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function create() {
    const p = await connect();
    if (p)
      await act(
        "create_session",
        {
          agentId,
          recipient: p.publicKey.toString(),
          maxSol,
          perLaunch,
          maxLaunches,
        },
        "Launch wallet created. Fund it before enabling instant mode.",
      );
  }
  return (
    <div className="workspace-body">
      <div className="row between">
        <h3>Instant launch</h3>
        <span className={"badge " + (session?.enabled ? "green" : "")}>
          {session?.enabled ? "ENABLED" : "OFF"}
        </span>
      </div>
      <p className="smalltext muted" style={{ marginTop: 14 }}>
        When a run produces a proposal, your dev can create the coin immediately
        from a dedicated launch wallet. The model never receives its private
        key.
      </p>
      {!session ? (
        <>
          <div className="note">
            This server controls the dedicated wallet. Use a small budget. A
            session lasts 24 hours and cannot spend from your main wallet. New
            runs happen every 2 minutes while Dev is open; launches still need
            network confirmation.
          </div>
          <div className="grid2">
            <label className="field">
              <span>Total session budget · SOL</span>
              <input
                className="input"
                type="number"
                min="0.001"
                max="1"
                step="0.001"
                value={maxSol}
                onChange={(e) => setMaxSol(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Maximum per launch · SOL</span>
              <input
                className="input"
                type="number"
                min="0.001"
                max="1"
                step="0.001"
                value={perLaunch}
                onChange={(e) => setPerLaunch(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Maximum launches</span>
            <input
              className="input"
              type="number"
              min="1"
              max="10"
              value={maxLaunches}
              onChange={(e) => setMaxLaunches(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Default coin artwork · up to 2 MB</span>
            <input
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <div className="row">
            <button
              className="button small"
              disabled={!file || uploading}
              onClick={upload}
            >
              <Upload size={13} />
              {uploading ? "Uploading…" : "Upload to IPFS"}
            </button>
            {data.sessionImage && <span className="tiny">Artwork ready ✓</span>}
          </div>
          <label className="row smalltext" style={{ margin: "20px 0" }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I authorize this dev to create mainnet coins within these caps after
            I fund and enable its launch wallet.
          </label>
          <button
            className="button primary"
            disabled={!consent || !data.sessionImage || !!busy}
            onClick={create}
          >
            <Wallet size={14} />
            Create dedicated launch wallet
          </button>
        </>
      ) : (
        <>
          <div className="note">
            <b>Launch wallet</b>
            <br />
            <span className="mono" style={{ wordBreak: "break-all" }}>
              {session.public_key}
            </span>
            <br />
            Send up to {session.max_lamports / 1e9} SOL to this address from
            your wallet to fund it. Coins are created with no initial purchase.
            Account rent and fees count toward the cap.
          </div>
          <div className="grid2">
            <div className="connection">
              <b>
                {session.used_launches} / {session.max_launches}
              </b>
              <p>Launch slots reserved</p>
            </div>
            <div className="connection">
              <b>
                {(session.used_lamports / 1e9).toFixed(5)} /{" "}
                {session.max_lamports / 1e9} SOL
              </b>
              <p>Budget reserved, including uncertain submissions</p>
            </div>
          </div>
          <p className="tiny muted">
            Expires {new Date(session.expires_at).toLocaleString()}. Per-launch
            cap: {session.per_launch / 1e9} SOL.
          </p>
          <div className="row wrap" style={{ marginTop: 20 }}>
            <button
              className={"button " + (session.enabled ? "" : "primary")}
              disabled={!!busy}
              onClick={() =>
                act(
                  "toggle_session",
                  { agentId, enabled: !session.enabled },
                  session.enabled
                    ? "Instant mode stopped."
                    : "Instant mode enabled. Run your dev or keep this page open.",
                )
              }
            >
              {session.enabled ? <Square size={13} /> : <Zap size={13} />}{" "}
              {session.enabled ? "Stop instant mode" : "Enable instant mode"}
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={() =>
                act(
                  "withdraw_session",
                  { agentId },
                  "Return transaction submitted to your fixed recipient wallet.",
                )
              }
            >
              Stop & return remaining SOL
            </button>
          </div>
          <p
            className="tiny muted"
            style={{ marginTop: 14, wordBreak: "break-all" }}
          >
            Return address: {session.recipient}. A stopped session may finish an
            already-submitted transaction.
          </p>
        </>
      )}
    </div>
  );
}

export function MainCoin(props: Props) {
  const { data, act, busy, user } = props;
  const [mint, setMint] = useState(data.support?.mint || ""),
    [treasury, setTreasury] = useState(data.support?.treasury || ""),
    [percentage, setPercentage] = useState(data.support?.percentage || 20);
  return (
    <section className="section">
      <div className="sectionhead">
        <div>
          <div className="eyebrow">Build an ecosystem</div>
          <h2 style={{ marginTop: 12 }}>Trading fees. Working intelligence.</h2>
          <p>
            Give launches a clear way to fund the models and services behind
            Dev.
          </p>
        </div>
        <span className="badge">
          {data.support?.mint ? "CONFIGURED" : "MAIN COIN NOT SET"}
        </span>
      </div>
      <div className="workspace-grid">
        <div className="panel">
          <div className="panelhead">
            <h3>Creator-fee support plan</h3>
            <Coins size={18} />
          </div>
          <form
            className="workspace-body"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                "save_support",
                { mint, treasury, percentage },
                "Treasury support settings saved.",
              );
            }}
          >
            <label className="field">
              <span>Main coin mint · add when launched</span>
              <input
                className="input"
                value={mint}
                onChange={(e) => setMint(e.target.value)}
                placeholder="Main coin mint address"
              />
            </label>
            <label className="field">
              <span>Dev treasury wallet</span>
              <input
                className="input"
                value={treasury}
                onChange={(e) => setTreasury(e.target.value)}
                placeholder="Wallet receiving SOL creator fees"
              />
            </label>
            <label className="field">
              <span>Share of creator fees · {percentage}%</span>
              <input
                className="input"
                type="range"
                min="1"
                max="99"
                value={percentage}
                onChange={(e) => setPercentage(Number(e.target.value))}
              />
            </label>
            <div className="note">
              {percentage}% to the support treasury · {100 - percentage}% to the
              coin creator. This percentage applies to creator fees, not all
              trading volume.
            </div>
            <button className="button primary" disabled={!user || !!busy}>
              Save support settings
            </button>
          </form>
        </div>
        <div className="panel">
          <div className="panelhead">
            <h3>How fees fund Dev</h3>
            <ShieldCheck size={18} />
          </div>
          <div className="workspace-body">
            <h3 className="subhead">01 · Revenue for the treasury</h3>
            <p className="smalltext muted">
              Participating launches can share a portion of their pump.fun
              creator fees with the main project. The split must be confirmed
              on-chain for each launched coin.
            </p>
            <h3 className="subhead">02 · Replenish the AI budget</h3>
            <p className="smalltext muted">
              Collect the treasury’s share, then purchase OpenRouter credits.
              Approved workspaces can use a Dev-funded key with a daily spending
              cap. Credits must be available before models can run.
            </p>
            <h3 className="subhead">03 · Support the product people use</h3>
            <p className="smalltext muted">
              Wallet signals, tweet intelligence, and model choice are the
              product utility. A main coin can later unlock benefits when its
              holder rules are defined.
            </p>
            <div className="note">
              {data.support?.treasury
                ? "Treasury plan saved."
                : "Add your treasury to start."}{" "}
              A main coin mint is optional. Saving a plan does not route fees;
              each split needs on-chain confirmation. Finalized splits are
              permanent. Collection and OpenRouter credit purchases are separate
              steps.
            </div>
            <FeeRoutes {...props} />
          </div>
        </div>
      </div>
    </section>
  );
}
