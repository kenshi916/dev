"use client";
import FeeRoutes from "./fee-routes";
export { default as InstantLaunch } from "./agent-wallet-panel";
import { useState } from "react";
import { ShieldCheck, Coins } from "lucide-react";
type Props = {
  data: any;
  act: (action: string, payload?: any, success?: string) => Promise<any>;
  busy: string;
  user: any;
  connect: () => Promise<any>;
  notify: (s: string) => void;
  setError: (s: string) => void;
  refresh: () => Promise<void>;
};
export function MainCoin(props: Props) {
  const { data, act, busy, user } = props;
  const [mint, setMint] = useState(data.support?.mint || ""),
    [treasury, setTreasury] = useState(data.support?.treasury || ""),
    [percentage, setPercentage] = useState(data.support?.percentage || 20);
  return (
    <section className="section">
      <div className="sectionhead">
        <div>
          <div className="eyebrow">Keep your agents running</div>
          <h2 style={{ marginTop: 12 }}>Coins earn fees. Fees support AI.</h2>
          <p>
            Use creator revenue from the coins your agents launch to help fund their next decisions.
          </p>
        </div>
        <span className="badge">
          {data.support?.treasury ? "TREASURY CONFIGURED" : "TREASURY NEEDED"}
        </span>
      </div>
      <div className="agent-funding-status">
        <div><span>Recorded treasury receipts</span><strong>{((data.feeReceipts || []).reduce((total: number, receipt: any) => total + (receipt.receivedLamports || 0), 0) / 1e9).toFixed(5)} SOL</strong><p>Confirmed creator-fee distributions recorded by Dev.</p></div>
        <div><span>AI payment source</span><strong>{data.aiAccess?.source === "sponsored" ? "Dev-funded" : data.aiAccess?.source === "personal" ? "Personal OpenRouter" : "Not configured"}</strong><p>{data.aiAccess?.source === "sponsored" ? "Provider credits must be prepaid. The daily cap is not a balance." : "Platform-funded model access needs operator setup and prepaid credits."}</p></div>
        <div><span>Funding loop</span><strong>Revenue → AI budget</strong><p>Collect creator fees, replenish OpenRouter, then fund future decisions. SOL is not converted automatically.</p></div>
      </div>
      <div className="workspace-grid">
        <div className="panel">
          <div className="panelhead">
            <h3>AI funding plan</h3>
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
              <span>Main coin mint · optional</span>
              <input
                className="input"
                value={mint}
                onChange={(e) => setMint(e.target.value)}
                placeholder="Main coin mint address"
              />
            </label>
            <label className="field">
              <span>AI funding treasury wallet</span>
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
              coin creator wallet. This percentage applies to creator fees, not all
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
            <h3 className="subhead">03 · Keep models within their allowance</h3>
            <p className="smalltext muted">
              Dev-funded access is configured by the operator with a daily cap. Users can also connect their own OpenRouter account. Fee revenue does not guarantee sufficient model credits.
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
