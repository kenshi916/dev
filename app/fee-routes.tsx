"use client";
import { useState } from "react";
import FeeCollection from "./fee-collection";
export default function FeeRoutes({ data, act, busy, connect, setError }: any) {
  const [prepared, setPrepared] = useState<any>(null),
    [coin, setCoin] = useState(""),
    [checked, setChecked] = useState(false),
    [signing, setSigning] = useState(false),
    [status, setStatus] = useState("");
  const coins = data.drafts.filter((d: any) => d.status === "launched");
  async function submit() {
    if (!checked || !prepared) return;
    setSigning(true);
    try {
      let signature: string | undefined;
      if (!prepared.sessionSigner) {
        const provider = await connect();
        if (!provider) return;
        if (provider.publicKey.toString() !== prepared.wallet)
          throw new Error("Connect the original coin creator wallet.");
        const { VersionedTransaction } = await import("@solana/web3.js");
        const tx = VersionedTransaction.deserialize(
          Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)),
        );
        signature = (await provider.signAndSendTransaction(tx)).signature;
      }
      const r = await act(
        "submit_support",
        { draftId: coin, signature },
        "Fee setup submitted.",
      );
      if (r) {
        setPrepared(null);
        setStatus("Submitted: " + r.signature);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSigning(false);
    }
  }
  return (
    <div className="fee-routes">
      <h3 className="subhead">Apply support to a launched coin</h3>
      {!coins.length ? (
        <p className="smalltext muted">
          Confirmed coins will appear here for permanent on-chain fee sharing.
        </p>
      ) : (
        <>
          <label className="field">
            <span>Confirmed coin</span>
            <select
              className="input"
              value={coin}
              onChange={(e) => {
                setCoin(e.target.value);
                setPrepared(null);
                setStatus("");
              }}
            >
              <option value="">Choose a coin</option>
              {coins.map((d: any) => (
                <option value={d.id} key={d.id}>
                  {d.name} · ${d.symbol}
                </option>
              ))}
            </select>
          </label>
          <div className="row wrap">
            <button
              className="button small"
              disabled={!coin || !!busy || signing}
              onClick={async () => {
                const p = await act("prepare_support", { draftId: coin });
                if (p) {
                  setPrepared(p);
                  setChecked(false);
                }
              }}
            >
              Prepare fee split
            </button>
            <button
              className="button small"
              disabled={!coin || !!busy}
              onClick={async () => {
                const r = await act("check_support", { draftId: coin });
                if (r) setStatus("Fee routing: " + r.status);
              }}
            >
              Check routing
            </button>
          </div>
          {prepared && (
            <>
              <div className="note">
                <b>Permanent creator-fee split</b>
                <br />
                {prepared.percentage}% to {prepared.treasury}
                <br />
                Estimated setup cost: {prepared.estimatedSol} SOL.
                <br />
                {prepared.sessionSigner
                  ? "Signed by your dedicated launch wallet within its remaining budget."
                  : "Your creator wallet must sign."}
              </div>
              <label className="row smalltext">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I approve this permanent split and its setup cost.
              </label>
              <button
                className="button primary"
                style={{ marginTop: 14 }}
                disabled={!checked || signing || !!busy}
                onClick={submit}
              >
                {signing ? "Submitting…" : "Confirm permanent fee split"}
              </button>
            </>
          )}
          {status && (
            <p className="smalltext" style={{ wordBreak: "break-all" }}>
              {status}
            </p>
          )}
          {coin && (
            <FeeCollection
              key={coin}
              coin={coin}
              act={act}
              busy={busy}
              connect={connect}
              setError={setError}
            />
          )}
        </>
      )}
    </div>
  );
}
