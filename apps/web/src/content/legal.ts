/** Draft legal pages. One source for the HTML pages and their Markdown twins. */

export const LEGAL_NOTICE =
  'Draft - under review. This page has not been approved yet and is not legal advice. It may change before it takes effect.';

export type LegalPage = { slug: 'privacy' | 'terms'; title: string; summary: string; body: string };

const PRIVACY = `**Draft - under review.** Last updated: [TBD: date of approval].

This policy explains what Agent Drive ("we", "us") collects, why, and who else handles it. The service is run by [TBD: company legal name], [TBD: postal address].

## What we cannot see

Agent Drive encrypts file contents on your machine with AES-256-GCM before upload. The drive key never leaves your machine, so we store only ciphertext and cannot read your file contents. If a share link is made, its decryption key sits in the part of the URL after the "#". Browsers do not send that part to servers, so we do not receive it.

## What we do store

- **Account:** an account name and the user ID from our sign-in provider (Clerk). Billing alert emails, if you set one.
- **Drive metadata, visible to us:** drive names, file paths, sizes, tags, descriptions, version and deletion timestamps. Paths and tags are not encrypted, so do not put secrets in them.
- **Agents and machines:** the names you give them, creation times, and hashes of their API keys (never the keys themselves).
- **Activity records:** audit events (what action, which agent, success or failure, when) and file change events.
- **Sharing:** share link records (which file version, expiry, revoked or not). Not the decryption key.
- **Encrypted file data:** the ciphertext of your files, plus a wrapped (encrypted) file key we cannot unwrap.
- **Device sign-in:** when an agent asks to connect, we store a hash of the requesting IP address to limit abuse (rate limiting). We do not store the raw address in our database.
- **Billing:** your plan, usage totals (storage, downloads, operations), and Stripe customer and subscription IDs. We do not see or store card numbers; Stripe does.

## Sign-in

We use Clerk to sign you in with email, GitHub, or Google. Clerk receives your sign-in details and sets the session cookies that keep you signed in. Google sign-in requests the scopes openid, email, and profile. GitHub sign-in requests user:email and read:user, which give read-only access to your email and profile. We use these only to identify you. We do not read your Gmail, Google Drive, GitHub repositories, or other data in those accounts.

## Cookies

We set only the cookies needed to sign you in and keep your session. We do not run advertising or analytics scripts on this site.

## Who handles data for us

- Vercel: hosts the website and API.
- Neon: hosts our Postgres database (through Vercel).
- [TBD: object storage provider, Amazon S3 or Cloudflare R2]: stores your encrypted files.
- Clerk: sign-in and sessions. Clerk also sends sign-in and verification emails. We do not send email ourselves.
- Stripe: payments and subscriptions.

These providers also keep their own logs under their own policies. Our storage provider may keep access logs for [TBD: log retention period].

## How long we keep it

You can delete a drive or your whole account in the console. Deletion blocks access at once, then a background job removes the encrypted files and metadata after a short waiting period. This is not instant. Some things stay: aggregate billing receipts (plan, periods, usage totals, amounts), internal deletion IDs, and hashed sign-in identity records used to block old sessions. Stripe records, backups, and provider logs follow their own retention.

## Your choices

You can access, export, and delete your data in the console and with the CLI. For anything else, or to ask about your rights under the law where you live, write to [TBD: privacy contact email].

## We do not sell data

We do not sell your data or use it for advertising.

## Changes

If we change this policy, we will update this page and its date. [TBD: how we notify of material changes.]

## Contact

[TBD: company legal name], [TBD: postal address], [TBD: privacy contact email].
`;

const TERMS = `**Draft - under review.** Last updated: [TBD: date of approval].

These terms govern your use of Agent Drive at agentdrive.xyz. The service is run by [TBD: company legal name]. By using it you agree to them.

## The service

Agent Drive is encrypted file storage for agents. A person signs in, approves an agent, and the agent saves encrypted files to a drive.

## Your account

You must give accurate information and keep your sign-in and API keys safe. You are responsible for what your agents do with the keys you approve. Revoke any key you no longer trust in the console.

## Your keys and recovery

Your drive key is created and held on your machine. We never receive it, so we cannot recover your files if you lose it. Keep your recovery file and your agent credentials somewhere safe. If you lose the drive key and have no recovery file, the encrypted data is gone for good. We cannot reset this for you.

## Your content

You keep all rights to your files. You give us only the permission needed to store, copy, and deliver your encrypted data to you and to people you share it with. Because we cannot read your contents, you are responsible for what you store and share.

## Acceptable use

Do not use Agent Drive to:

- break the law or store content you have no right to store;
- attack, probe, or overload the service, or get around plan limits or rate limits;
- spread malware or abuse other people's systems;
- share access in ways that harm others, or resell the service without our written approval.

We can't see file contents, but we can see metadata such as paths and sizes. We may act on reports and on abuse we can observe.

## Plans, limits, and billing

Each plan has limits on drives, stored data, downloads, and API operations. See [pricing](/pricing) for current plans, prices, and limits. Paid plans are billed through Stripe, in US dollars before applicable taxes. Free accounts stop at their included limits. Paid usage above the included amounts is charged at the published rates. [TBD: refund and cancellation policy.]

## Availability and no warranty

We aim to keep Agent Drive running, but we do not promise it will always be available, error-free, or that data will never be lost. The service is provided "as is" and "as available", without warranties of any kind. Keep your own copy of anything you cannot afford to lose.

## Liability

To the extent the law allows, we are not liable for indirect or consequential losses, or for data lost because you lost your keys. [TBD: liability cap and any jurisdiction-specific wording, to be set by counsel.]

## Ending your use

You can stop at any time and delete your drives or account in the console. We may suspend or end access if you break these terms, do not pay, or put the service or other users at risk. We will try to give notice where we reasonably can. Deleted data is removed as described in the [privacy policy](/privacy).

## Changes

We may update these terms. We will change the date above and, for material changes, [TBD: notification method]. Continuing to use the service after a change means you accept it.

## Governing law

[TBD: governing law and venue.]

## Contact

[TBD: company legal name], [TBD: postal address], [TBD: contact email].
`;

export const LEGAL: LegalPage[] = [
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What Agent Drive collects, who handles it, and how long it is kept.',
    body: PRIVACY,
  },
  {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The rules for using Agent Drive.',
    body: TERMS,
  },
];

export const legalPage = (slug: string) => LEGAL.find((p) => p.slug === slug);

export function legalMarkdown(slug: string): string | null {
  const p = legalPage(slug);
  return p ? `# ${p.title}\n\n${p.body}` : null;
}
