export function simulatedDebit(simulation: any): number {
  const before = simulation?.preBalances?.[0];
  const after = simulation?.postBalances?.[0];
  if (
    simulation?.err ||
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    before < after
  ) {
    throw new Error("A reliable same-simulation wallet debit is required.");
  }
  return before - after;
}
