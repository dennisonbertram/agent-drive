import { downloadsLabel, PLANS, type PlanName } from '../billing/policy';
import { formatBytes } from '../format/bytes';

/**
 * Plan text shared by /pricing, its Markdown twin and its JSON-LD, so the three cannot disagree.
 * Numbers come from PLANS in src/billing/policy.ts.
 */
export const allowance = (bytes: bigint) => formatBytes(bytes);

export const money = (cents: number | bigint) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(cents) / 100,
  );

export const PLAN_INCLUDES = 'CLI, MCP, web console, and encrypted sharing';

export function planFacts(name: PlanName, egressNotMetered: boolean) {
  const plan = PLANS[name];
  return {
    name,
    price: money(plan.baseCents),
    drives: `${String(plan.drives)} drives`,
    storage: `${allowance(plan.storageBytes)} stored ciphertext`,
    downloads: downloadsLabel(allowance(plan.egressBytes), egressNotMetered),
    operations: `${Number(plan.operations).toLocaleString('en-US')} API operations / month`,
  };
}

export function allPlanFacts(egressNotMetered: boolean) {
  return (Object.keys(PLANS) as PlanName[]).map((n) => planFacts(n, egressNotMetered));
}
