"use client";
import { useState } from "react";
import type { VersionedTransaction } from "@solana/web3.js";
import type { PreparedFeeDistribution } from "./server/support";

type Props = {
  coin: string;
  act: (action: string, payload: Record<string, string>) => Promise<unknown>;
  busy: string | boolean;
  connect: () => Promise<{
    publicKey: { toString(): string };
    signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>;
  } | null | undefined>;
  setError: (message: string) => void;
};

export default function FeeCollection({
  coin,
  act,
  busy,
  connect,
  setError,
}: Props) {
  const [prepared, setPrepared] = useState<PreparedFeeDistribution | null>(null);
  const [signature, setSignature] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  async function prepare() {
    setWorking(true);
    setError("");
    try {
      const provider = await connect();
      if (!provider) return;
      const result = await act("prepare_fee_distribution", {
        draftId: coin,
        wallet: provider.publicKey.toString(),
      }) as PreparedFeeDistribution | null;
      if (result) {
        setConfirmed(false);
        setPrepared(result);
        if (result.signature) {
          setSignature(result.signature);
          setStatus("An earlier distribution is awaiting confirmation.");
        } else setStatus("");
        if (!result.signature) setSignature("");
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function confirm(value: string) {
    const result = await act("confirm_fee_distribution", {
      draftId: coin,
      signature: value,
    }) as { status: string; receivedSol?: string } | null;
    if (result) {
      if (result.status === "confirmed") {
        setConfirmed(true);
        setStatus(
          "Treasury received " +
            result.receivedSol +
            " SOL on-chain. OpenRouter credits are purchased separately.",
        );
      } else if (result.status === "failed" || result.status === "expired") {
        setPrepared(null);
        setSignature("");
        setStatus(
          result.status === "failed"
            ? "Distribution failed on-chain. No payout was confirmed; prepare a fresh transaction."
            : "Transaction expired without landing. You can prepare a fresh distribution.",
        );
      } else
        setStatus(
          "Distribution submitted; confirmation is pending. Check again before preparing another payout.",
        );
    }
  }
  async function sign() {
    if (!prepared || signature) return;
    setWorking(true);
    setError("");
    try {
      const provider = await connect();
      if (!provider) return;
      if (provider.publicKey.toString() !== prepared.wallet)
        throw new Error(
          "Connect the wallet used to prepare this distribution.",
        );
      const { VersionedTransaction } = await import("@solana/web3.js");
      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)),
      );
      const result = await provider.signAndSendTransaction(tx);
      setSignature(result.signature);
      await confirm(result.signature);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="connection">
      <h3>Collect creator fees</h3>
      <p>
        Distribute available fees to the coin’s confirmed recipients. Your
        connected wallet pays the network fee.
      </p>
      {(!signature || confirmed) && (
        <button
          className="button small"
          disabled={!coin || !!busy || working}
          onClick={prepare}
        >
          {working ? "Working…" : confirmed ? "Prepare next distribution" : "Preview fee distribution"}
        </button>
      )}
      {prepared && !signature && (
        <div className="note">
          <p>
            Estimated treasury receipt:{" "}
            {(Number(prepared.estimatedTreasuryLamports) / 1e9).toFixed(6)} SOL
          </p>
          <p>Estimated payer cost: {prepared.estimatedSol} SOL</p>
          <p className="tiny" style={{ overflowWrap: "anywhere" }}>
            Treasury: {prepared.treasury}
          </p>
          <button
            className="button primary"
            disabled={working || !!busy}
            onClick={sign}
          >
            Review & sign in wallet
          </button>
        </div>
      )}
      {signature && (
        <>
          <p className="tiny" style={{ overflowWrap: "anywhere" }}>
            <a
              href={"https://solscan.io/tx/" + signature}
              target="_blank"
              rel="noreferrer"
            >
              View distribution transaction
            </a>
          </p>
          {!confirmed && <button
            className="button small"
            disabled={working || !!busy}
            onClick={() => confirm(signature)}
          >
            Check distribution
          </button>}
        </>
      )}
      {status && (
        <p className="smalltext" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
