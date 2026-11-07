import { billingRates, PLANS, type PlanName } from '../billing/policy';
import { allPlanFacts, money, PLAN_INCLUDES } from './plans';

export function publishedRates() {
  try {
    return billingRates();
  } catch {
    return null;
  }
}

export const egressNotMetered = () => process.env.S3_EGRESS_METERING === 'none';

export function pricingMarkdown(origin: string): string {
  const notMetered = egressNotMetered();
  const rates = publishedRates();
  const rows = allPlanFacts(notMetered).map(
    (p) =>
      `| ${p.name} | ${p.price} / month | ${p.drives} | ${p.storage} | ${p.downloads} | ${p.operations} |`,
  );
  const lines = [
    '# Pricing',
    '',
    '> Client-side encryption on every plan. Base prices are in USD, before applicable taxes.',
    '',
    '| Plan | Price | Drives | Storage | Downloads | API operations |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Every plan includes: ${PLAN_INCLUDES}.`,
    '',
    'Limits apply across your account. All retained file versions count toward storage, including overwritten files and trash. Each encrypted upload can be at most 5 GiB. Free accounts stop at their included allowances.',
  ];
  if (rates) {
    lines.push(
      '',
      '## Additional usage on paid plans',
      '',
      `- Extra drive / month: ${money(rates.drive)}`,
      `- Extra GiB stored / month: ${money(rates.storage)}`,
      `- Extra GiB downloaded: ${notMetered ? 'Not charged' : money(rates.egress)}`,
      `- Extra 1,000 API operations: ${money(rates.operations)}`,
    );
  }
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
