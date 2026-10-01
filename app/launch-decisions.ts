export const decisionReasonKeys = ["feeRecipients", "pairing", "cashback", "vampRisk", "differentiation", "skipConditions"] as const;
export type DecisionReasonKey = typeof decisionReasonKeys[number];
export type DecisionReasons = Record<DecisionReasonKey, string>;

export type LaunchExecution = {
  quoteAsset: "SOL";
  stockPair: null;
  feeMode: "standard_creator_fees";
  creator: string;
  creatorShareBps: 10000;
  feeBasis: "creator_fee_only";
  supportSplit: "separate_onchain_setup_required";
  supportPlan: { treasury: string; treasuryShareBps: number; creatorShareBps: number } | null;
  cashback: false;
  holderRewards: false;
  artwork: "session_default";
};

export type LaunchDecisions = {
  version: 1;
  /** Dev's creation configuration. Later fee-sharing changes are separate transactions. */
  execution: LaunchExecution;
  reasoning: DecisionReasons;
  copycatAssessment: { scope: "workspace_only"; marketSearch: "not_performed"; protection: "none" };
};

const wallet = (v: unknown): v is string => typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);

/** Allowlist the public snapshot; never spread model output or workspace settings into the feed. */
export function publicLaunchDecisions(value: unknown, confirmedCreator: unknown): LaunchDecisions | null {
  const v = value as LaunchDecisions | null;
  const e = v?.execution;
  if (v?.version !== 1 || !e || !wallet(confirmedCreator) || e.creator !== confirmedCreator ||
      e.quoteAsset !== "SOL" || e.stockPair !== null || e.feeMode !== "standard_creator_fees" ||
      e.creatorShareBps !== 10000 || e.feeBasis !== "creator_fee_only" ||
      e.supportSplit !== "separate_onchain_setup_required" || e.cashback !== false ||
      e.holderRewards !== false || e.artwork !== "session_default" ||
      !decisionReasonKeys.every(key => typeof v.reasoning?.[key] === "string" && v.reasoning[key].trim())) return null;
  const plan = e.supportPlan;
  const supportPlan = plan && wallet(plan.treasury) && plan.treasury !== confirmedCreator &&
    Number.isInteger(plan.treasuryShareBps) && plan.treasuryShareBps >= 100 && plan.treasuryShareBps <= 9900 &&
    plan.creatorShareBps === 10000 - plan.treasuryShareBps
    ? { treasury: plan.treasury, treasuryShareBps: plan.treasuryShareBps, creatorShareBps: plan.creatorShareBps } : null;
  return {
    version: 1,
    execution: {
      quoteAsset: "SOL", stockPair: null, feeMode: "standard_creator_fees", creator: confirmedCreator,
      creatorShareBps: 10000, feeBasis: "creator_fee_only", supportSplit: "separate_onchain_setup_required",
      supportPlan, cashback: false, holderRewards: false, artwork: "session_default",
    },
    reasoning: Object.fromEntries(decisionReasonKeys.map(key => [key, v.reasoning[key].trim().slice(0, 350)])) as DecisionReasons,
    copycatAssessment: { scope: "workspace_only", marketSearch: "not_performed", protection: "none" },
  };
}
