import { billingRates, PLANS, type PlanName } from '../billing/policy';
import { checkoutConfigured } from '../billing/providers';
import { MAX_UPLOAD, perGbDollars, RATE_UNIT_NOTE } from '../format/bytes';
import { allPlanFacts, money, PLAN_INCLUDES } from './plans';

export function publishedRates() {
  try {
    return billingRates();
  } catch {
    return null;
  }
}

/** Conditions shown on /pricing and repeated in /pricing.md. One source for both. */
export const DISCLOSURE = {
  checkoutDisabled:
    'Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; the paid prices below describe the supported plans.',
  usage: [
    `Limits apply across your account. All retained file versions count toward storage, including overwritten files and trash. Each encrypted upload can be at most ${MAX_UPLOAD}; the original file must leave room for encryption overhead.`,
    RATE_UNIT_NOTE,
    'Free accounts stop at their included allowances. Paid overages require a configured billing provider and active subscription. Drive and storage overages use the monthly high-water allocation, not hourly averages. Base prices are in USD, before applicable taxes.',
  ],
  noRates:
    'Overage rates have not been published for this deployment. Paid checkout stays disabled until billing is fully configured.',
  downloads:
    'Downloads are measured from observed storage logs, not just issued links. Logs can arrive late, and an issued link can be reused until it expires. Spending caps block new writes; they are not guaranteed invoice or network-traffic ceilings.',
};

export const egressNotMetered = () => process.env.S3_EGRESS_METERING === 'none';

export function pricingMarkdown(origin: string): string {
  const notMetered = egressNotMetered();
  const rates = publishedRates();
  const rows = allPlanFacts(notMetered).map(
    (p) =>
      `| ${p.name} | ${p.price} / month | ${p.drives} | ${p.storage} | ${p.downloads} | ${p.operations} |`,
  );
  const paidAvailable = rates !== null && checkoutConfigured();
  const lines = [
    '# Pricing',
    '',
    '> Client-side encryption on every plan. Base prices are in USD, before applicable taxes.',
    '',
    ...(paidAvailable ? [] : [DISCLOSURE.checkoutDisabled, '']),
    '| Plan | Price | Drives | Storage | Downloads | API operations |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Every plan includes: ${PLAN_INCLUDES}.`,
    '',
    '## How usage works',
    '',
    ...DISCLOSURE.usage.flatMap((p) => [p, '']),
    '## Additional usage on paid plans',
    '',
  ];
  if (rates) {
    lines.push(
      `- Extra drive / month: ${money(rates.drive)}`,
      `- Extra GB stored / month: ${perGbDollars(rates.storage)}`,
      `- Extra GB downloaded: ${notMetered ? 'Not charged' : perGbDollars(rates.egress)}`,
      `- Extra 1,000 API operations: ${money(rates.operations)}`,
    );
  } else {
    lines.push(DISCLOSURE.noRates);
  }
  lines.push('', DISCLOSURE.downloads);
  lines.push('', `Sign up: ${origin}/sign-up`, '');
  return lines.join('\n');
}

/** schema.org SoftwareApplication with one Offer per plan. No user data. */
export function pricingJsonLd(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Agent Drive',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    url: origin,
    description:
      'Encrypted file storage for agents. Files survive sandboxes, machines and platform switches.',
    offers: (Object.keys(PLANS) as PlanName[]).map((name) => ({
      '@type': 'Offer',
      name: `${name} plan`,
      price: (PLANS[name].baseCents / 100).toFixed(2),
      priceCurrency: 'USD',
      url: `${origin}/pricing`,
    })),
  };
}
