"use client";
import { useEffect, useState } from "react";
import { Coins, ExternalLink, RefreshCw, Square, Upload, Wallet, Zap } from "lucide-react";

export default function AgentWalletPanel({ data, act, busy, connect, notify, setError, refresh, agentId }: any) {
  const [maxSol, setMaxSol] = useState("0.05"), [perLaunch, setPerLaunch] = useState("0.015"),
    [maxLaunches, setMaxLaunches] = useState("3"), [recipient, setRecipient] = useState(""),
    [consent, setConsent] = useState(false), [file, setFile] = useState<File | null>(null),
    [uploading, setUploading] = useState(false);
  const session = data.sessions?.find((s: any) => s.agent_id === agentId);
  const readiness = data.walletReadiness?.[agentId];
  const study = data.deployStudy;
  const active = session?.enabled && new Date(session.expires_at).getTime() > Date.now();
  useEffect(() => {
    if (!session) return;
    setRecipient(session.recipient || "");
    setMaxSol(String(session.max_lamports / 1e9));
    setPerLaunch(String(session.per_launch / 1e9));
    setMaxLaunches(String(session.max_launches));
  }, [session?.public_key]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const result: any = await response.json();
      if (!response.ok) throw new Error(result.error);
      await refresh();
      notify("Default coin artwork uploaded.");
    } catch (error) { setError((error as Error).message); }
    finally { setUploading(false); }
  }
  return <div className="workspace-body agent-wallet">
    <div className="row between"><h3>{session ? "Your agent’s wallet" : "Finish creating its wallet"}</h3><span className={"badge " + (active ? "green" : "")}>{active ? "ACTIVE" : "NOT ACTIVE"}</span></div>
    <div className="agent-study">
      <div className="row between wrap"><div><span className="eyebrow">DEPLOY STUDY</span><h3>Learn from bwa’s deployments.</h3></div><button className="button small" disabled={!!busy} onClick={() => act("study_deploys", {}, "Deploy study refreshed.")}><RefreshCw size={14} />{busy === "study_deploys" ? "Studying…" : "Study deploys"}</button></div>
      <p>The agent studies verified Pump launches for naming, themes and cadence before proposing its own concept. It can skip when there’s no strong idea.</p>
      <a className="mono tiny" href="https://solscan.io/account/bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa" target="_blank" rel="noreferrer">bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa <ExternalLink size={12} /></a>
      {study?.deployments?.length ? <div className="study-deployments">{study.deployments.map((d: any) => <a key={d.transaction} href={d.transaction} target="_blank" rel="noreferrer"><span>{d.name} <b>${d.symbol}</b></span><ExternalLink size={12} /></a>)}</div> : <p className="tiny muted">{study ? study.refreshStatus + ". No verified deploys in the saved sample yet." : "No study loaded yet. Refresh the sample here or let an active agent check before its next run."}</p>}
      <p className="tiny muted">A partial sample of recent transactions. Naming patterns are observations; this does not establish PNL or why a coin made money.</p>
      <a className="smalltext" href="/skill.md" target="_blank" rel="noreferrer">Read the agent skill <ExternalLink size={12} /></a>
    </div>
    {!session ? <>
      <p className="smalltext muted">Dev will create a dedicated wallet for this existing agent. You can fund it and choose its limits afterward.</p>
      <button className="button primary" disabled={!!busy} onClick={() => act("create_session", { agentId }, "Agent wallet created. Copy its address and fund it with SOL.")}><Wallet size={15} />Create agent wallet</button>
    </> : <>
      <div className="agent-deposit">
        <span className="eyebrow">01 / FUND WITH SOL</span>
        <code>{session.public_key}</code>
        <div className="row wrap">
          <button className="button small" onClick={async () => { try { await navigator.clipboard.writeText(session.public_key); notify("Deposit address copied."); } catch { setError("Select and copy the address above."); } }}>Copy deposit address</button>
          <a className="button small ghost" href={"https://solscan.io/account/" + session.public_key} target="_blank" rel="noreferrer">View wallet <ExternalLink size={13} /></a>
        </div>
        <p>Send SOL to this address to cover coin creation. Dev manages this dedicated wallet; the model never receives its key. Choose where unused funds can return before you activate it.</p>
      </div>
      <div className="agent-metrics">
        <div><span>Confirmed balance</span><strong>{readiness?.balanceLamports == null ? "Not checked" : (readiness.balanceLamports / 1e9).toFixed(5) + " SOL"}</strong></div>
        <div><span>Allowance remaining</span><strong>{((session.max_lamports - session.used_lamports) / 1e9).toFixed(5)} SOL</strong></div>
        <div><span>Launches remaining</span><strong>{session.max_launches - session.used_launches} / {session.max_launches}</strong></div>
      </div>
      <p className="tiny muted">Maximum {session.per_launch / 1e9} SOL per launch, including rent and network fees. Reserved amounts include uncertain submissions. No initial token purchase.</p>
      <div className="agent-setup-block">
        <span className="eyebrow">02 / PREPARE YOUR AGENT</span>
        {session.expires_at.startsWith("1970-") && <div className="agent-wallet-settings">
          <div className="grid2">
            <label className="field"><span>Total launch allowance · SOL</span><input className="input" type="number" min="0.001" max="1" step="0.001" value={maxSol} onChange={e => setMaxSol(e.target.value)} /></label>
            <label className="field"><span>Maximum per launch · SOL</span><input className="input" type="number" min="0.001" max={maxSol} step="0.001" value={perLaunch} onChange={e => setPerLaunch(e.target.value)} /></label>
          </div>
          <label className="field"><span>Maximum coins to launch</span><input className="input" type="number" min="1" max="10" value={maxLaunches} onChange={e => setMaxLaunches(e.target.value)} /></label>
          <label className="field"><span>Return address for unused SOL</span><input className="input mono" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Set a withdrawal destination before activation" maxLength={44} /></label>
          <div className="row wrap">
            <button className="button small" onClick={async () => { const provider = await connect(); if (provider) setRecipient(provider.publicKey.toString()); }}>Use connected wallet</button>
            <button className="button small primary" disabled={!!busy || !recipient} onClick={() => act("configure_agent_wallet", { agentId, recipient, maxSol, perLaunch, maxLaunches }, "Launch settings saved. These become fixed on first activation.")}>Save launch settings</button>
          </div>
          <p className="tiny muted">These settings become fixed on first activation. Your deposit stays in the wallet until you authorize launches or return it.</p>
        </div>}

        <label className="field"><span>Default coin artwork · PNG, JPG or WebP · up to 2 MB</span><input className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        <div className="row wrap"><button className="button small" disabled={!file || uploading || !!busy} onClick={upload}><Upload size={14} />{uploading ? "Uploading…" : "Upload artwork"}</button><span className="smalltext muted">{session.image_url || data.sessionImage ? "Artwork ready" : "Artwork required before activation"}</span></div>
        <button className="button small" style={{ marginTop: 18 }} disabled={!!busy} onClick={() => act("check_session", { agentId })}><RefreshCw size={14} />{busy === "check_session" ? "Checking…" : "Check balance & readiness"}</button>
        {readiness && <div className="agent-checks" aria-live="polite">{readiness.checks.map((check: any) => <div key={check.label} className={check.ok ? "passed" : ""}><span>{check.ok ? "✓" : "○"}</span><div><b>{check.label}</b><p>{check.detail}</p></div></div>)}<small>Checked {new Date(readiness.checkedAt).toLocaleString()}. Activation checks these again.</small></div>}
      </div>
      <div className="agent-setup-block">
        <span className="eyebrow">03 / ACTIVATE</span>
        <p className="smalltext muted">The agent reviews fresh signals, can skip weak ideas, and creates coins within its allowance. It checks every two minutes while Dev is open. A hosted background runner is not connected yet.</p>
        {!active && <label className="row smalltext agent-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I authorize this agent to launch mainnet coins within the limits shown above.</label>}
        <div className="row wrap">
          <button className={"button " + (active ? "" : "primary")} disabled={!!busy || (!active && !consent)} onClick={() => act("toggle_session", { agentId, enabled: !active }, active ? "Agent paused." : "Agent activated. Keep Dev open for scheduled decisions.")}>{active ? <Square size={14} /> : <Zap size={14} />}{active ? "Pause agent" : "Activate agent"}</button>
          <button className="button small" disabled={!!busy || !session.recipient} onClick={() => act("withdraw_session", { agentId }, "Return transaction submitted. Check confirmation before assuming funds arrived.")}>Retire & return remaining SOL</button>
        </div>
        <p className="tiny muted">{session.expires_at.startsWith("1970-") ? "Your 24-hour authorization begins on first activation." : "Authorization expires " + new Date(session.expires_at).toLocaleString() + ". Pausing does not extend it."}</p>
        <p className="tiny muted" style={{ overflowWrap: "anywhere" }}>Return address: {session.recipient || "Not set yet"}. Retiring revokes this wallet’s launch authorization. An already-submitted transaction may still finish.</p>
      </div>
      <div className="agent-fee-note"><Coins size={20} /><div><b>Its launches can fund its intelligence.</b><p>Creator fees from confirmed coins can support Dev’s AI budget. Dev’s model budget is managed by the operator; wallet deposits cover launches.</p></div></div>
    </>}
  </div>;
}
