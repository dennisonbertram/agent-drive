/** Legal pages. One source for the HTML pages and their Markdown twins. */

export type LegalPage = { slug: 'privacy' | 'terms'; title: string; summary: string; body: string };

const PRIVACY = `**Last updated: November 9, 2026**

This policy explains what information Agent Drive collects, how we use it, and who else handles it. Agent Drive is run by DappHero Corp., 185 Wythe Avenue, 2nd Floor, Brooklyn, NY 11249, USA ("DappHero", "we", "us"). The service is available at agentdrive.xyz. Questions about this policy can go to support@agentdrive.xyz.

## What we cannot see, and what we can

Agent Drive encrypts the contents of your files on your own machine, with AES-256-GCM, before anything is uploaded. The key that unlocks a drive is created on your machine and is never sent to us in plaintext. We store ciphertext only. **We cannot read your file contents, and we cannot recover or restore them if you lose your drive key and your recovery file.** Nobody at Agent Drive can reset this for you.

We can see information about your files and your use of the service. This is not encrypted:

- **File paths and names**, drive names, tags and descriptions. Do not put secrets in them.
- **File sizes**, version history, and timestamps for creation, changes and deletion.
- **Your account details**, such as your email address and name from your sign-in provider.
- **Activity records**: which agent or person did what, when, and whether it succeeded.

Two cases need a note:

- When you connect another agent, an encrypted copy of the drive key can be passed through our servers and stored there, sealed so that only the receiving agent can open it. We cannot open it.
- If you turn on an OpenRouter trace webhook for a drive, OpenRouter sends each trace to our server in plaintext over TLS. We hold it in memory for that request, encrypt it to your drive's trace-inbox public key, and store only the ciphertext. We do not log the trace content or your webhook token, and we cannot read the stored trace afterwards.

If you create a share link, the key that decrypts the file sits in the part of the URL after the "#". Browsers do not send that part to servers, so we never receive it.

## What we collect and store

- **Account:** your name and email address, and the user ID from our sign-in provider (Clerk). If you set up billing alerts, the alert email address.
- **Drive metadata:** the items listed above that we can see.
- **Agents and machines:** the names you give them, creation times, and hashes of their API keys. We do not store the keys themselves.
- **Activity records:** audit events (what action, which agent, success or failure, when) and file change events.
- **Sharing:** share link records (which file version, expiry, revoked or not). Not the decryption key.
- **Encrypted file data:** the ciphertext of your files, and a wrapped (encrypted) file key that we cannot unwrap.
- **Device connections:** pairing codes, public keys, requested access, approval state, and the encrypted key-transfer records described above.
- **Downloads:** a record for each download (which object, when, how many bytes, which account and agent), used for usage and billing.
- **Request logs:** when you or your agents use the website, the API or storage, our hosting and storage infrastructure record request and access logs and related metadata, such as the time, the address requested, the response status, and the IP address that made the request.
- **Device sign-in protection:** when an agent asks to connect, we store a hash of the requesting IP address to limit abuse. We do not keep the raw address in our database for this purpose.
- **Billing:** your plan, usage totals (storage, downloads, operations), and Stripe customer and subscription IDs. Stripe handles card details. We never see or store card numbers.
- **Support:** if you email us, we keep the message and our replies.

## How we use it

We use this information to run and secure the service, sign you in, store and deliver your encrypted files, measure usage, bill paid plans, send service and billing messages, prevent abuse, fix problems, and answer your questions. We do not use it for advertising, and we do not use your file contents, which we cannot read, for anything.

## Sign-in

We use Clerk to sign you in with email, GitHub or Google. Clerk receives your sign-in details and sets the cookies that keep you signed in. Google sign-in requests the scopes openid, email and profile. GitHub sign-in requests user:email and read:user. These give read-only access to your email address and basic profile. We use them only to identify you. We do not read your Gmail, Google Drive, GitHub repositories or other data in those accounts.

## Cookies

We set only the cookies needed to sign you in and keep your session. We do not run advertising or analytics scripts on this site.

## Who handles data for us

These service providers process data on our behalf, only to provide Agent Drive:

- **Vercel:** hosts the website and the API.
- **Neon:** hosts our Postgres database (through Vercel).
- **Amazon Web Services (S3):** stores your encrypted files and storage access logs.
- **Clerk:** sign-in, sessions, and sign-in and verification emails.
- **Stripe:** payments and subscriptions.
- **Resend:** sends billing alert emails, if you turn them on. We do not send marketing email.
- **OpenRouter:** only if you configure an OpenRouter trace webhook for a drive. OpenRouter then sends us your traces, as described above.

These providers keep their own logs and records under their own policies. We may also disclose information when the law requires it, to protect the rights, safety or security of users or the service, or in a merger or sale of the business. We do not sell your data.

## How long we keep it

- **Files and drives:** until you delete them. Deleting a file moves it to Trash. Its encrypted versions are kept so it can be restored, until the drive or your account is deleted. There is no automatic Trash expiry today.
- **Account and drive deletion:** when you delete a drive or your account, new access through the app is blocked at once. Download links already issued can work for up to 10 minutes, and transfers in progress may finish. A background job then purges the stored data after a short waiting period (at least 10 minutes). This is not instant.
- **Logs:** request and access logs, and related metadata, are currently kept indefinitely. They are not removed when you delete a drive or your account.
- **Other records:** aggregate billing receipts (plan, periods, usage totals, amounts), internal deletion IDs, and hashed sign-in identity records used to block old sessions stay after deletion. Stripe records, backups and provider logs follow their own retention.

## Your choices and rights

In the console you can view and download your files and activity, and delete drives and your account (Activity & deletion). With the CLI you can download files and export agent credentials. For anything else, including a request to access, correct or delete personal information we hold about you, email support@agentdrive.xyz. Depending on where you live, you may have legal rights over your personal information, and we will respond as the law requires. We cannot recover or reveal file contents, because we cannot decrypt them.

## International use

Agent Drive is operated from the United States. If you use it from another country, your information is transferred to and processed in the United States and wherever our providers operate.

## Children

Agent Drive is not for children under 13, and we do not knowingly collect information from them. If you believe a child has given us information, contact us and we will delete it.

## Security

Beyond client-side encryption, we use TLS for data in transit and restrict access to our systems. No system is perfectly secure, and we cannot guarantee absolute security.

## Changes

If we change this policy, we will update this page and its date. For material changes we will notify account holders by email or in the console before the change takes effect.

## Contact

DappHero Corp., 185 Wythe Avenue, 2nd Floor, Brooklyn, NY 11249, USA. Email: support@agentdrive.xyz.
`;

const TERMS = `**Last updated: November 9, 2026**

These terms govern your use of Agent Drive at agentdrive.xyz, which is run by DappHero Corp., 185 Wythe Avenue, 2nd Floor, Brooklyn, NY 11249, USA ("DappHero", "we", "us"). By creating an account or using the service, you agree to them. If you use Agent Drive for an organization, you confirm you can bind it to these terms. If you do not agree, do not use the service.

## The service

Agent Drive is encrypted file storage for agents. A person signs in, approves an agent, and the agent saves encrypted files to a drive. Our [privacy policy](/privacy) explains what we collect and how we handle it.

## Your account

You must give accurate information and keep your sign-in and API keys safe. You are responsible for everything your agents do with the keys you approve. Revoke any key you no longer trust in the console. You must be at least 13 years old, and old enough in your country to form a binding contract.

## Your keys and recovery: your responsibility

Your files are encrypted on your machine with a drive key that we never receive in plaintext. **We cannot read your files, and we cannot recover or restore them if you lose your drive key and your recovery file.** You are responsible for keeping your recovery file and your agent credentials safe, in a place that survives the loss of your machine or sandbox. If you lose them, the encrypted data is gone for good. We are not liable for data you cannot read because your keys are lost, and we cannot reset this for you.

## Your content

You keep all rights to your files. You give us only the permission needed to store, copy and deliver your encrypted data to you and to the people you share it with, and to run the service. Because we cannot read your contents (other than the brief plaintext handling of OpenRouter webhook traces described in the privacy policy), you alone are responsible for what you store and share, and for having the right to store it.

## Acceptable use

Do not use Agent Drive to:

- break the law, or store or share content you have no right to store or share;
- attack, probe or overload the service, or get around plan limits, rate limits or security controls;
- spread malware, or abuse other people's systems or accounts;
- share access in ways that harm others, or resell the service without our written approval.

We cannot see file contents, but we can see metadata such as paths and sizes. We may investigate and act on reports and on abuse we can observe, including by removing access.

## Plans, limits and billing

Each plan has limits on drives, stored data, downloads and API operations. See [pricing](/pricing) for current plans, prices and limits. Paid plans are billed monthly through Stripe, in US dollars, before applicable taxes. Paid usage above the included amounts is charged at the published rates. Free accounts stop at their included limits. You authorize us and Stripe to charge your payment method for the fees due. We may change prices or plan limits with notice, and a change applies from your next billing period.

You can cancel a paid plan at any time from the billing page in the console. After you cancel, your plan stays active until the end of the period you have already paid for, and we do not renew it. **Fees are non-refundable, including for partial periods and unused allowances, except where the law requires a refund.**

## Availability and no warranty

We aim to keep Agent Drive running, but we do not promise that it will always be available, error-free or secure, or that data will never be lost. The service is provided "as is" and "as available", without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose and non-infringement. Keep your own copy of anything you cannot afford to lose.

## Limitation of liability

To the fullest extent the law allows, DappHero and its officers, employees and providers are not liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, goodwill or data, including data you lost because you lost your keys or recovery file, even if we were told such damages were possible.

To the fullest extent the law allows, our total liability for all claims relating to the service or these terms is limited to the fees you paid us for one month of your subscription, being the month before the claim arose. If you were on the Free plan, our total liability is zero. Some places do not allow certain limits, so parts of this section may not apply to you.

## Indemnity

You will defend and indemnify DappHero and its officers, employees and providers against claims, losses and costs (including reasonable legal fees) that arise from your content, your use of the service in breach of these terms or the law, or your agents' actions.

## Ending your use

You can stop at any time and delete your drives or account in the console. We may suspend or end your access if you break these terms, do not pay, or put the service or other users at risk. We will try to give notice where we reasonably can, and we may act at once to stop abuse or a security risk. When your access ends, the sections that by their nature should continue (including payment obligations, disclaimers, liability limits, indemnity and governing law) continue. Deleted data is removed as described in the [privacy policy](/privacy).

## Changes

We may update these terms. We will change the date above and, for material changes, notify account holders by email or in the console before they take effect. If you keep using the service after a change takes effect, you accept it. If you do not agree, stop using the service and delete your account.

## Governing law

These terms are governed by the laws of the State of New York, without regard to its conflict-of-laws rules. Any dispute about these terms or the service will be brought exclusively in the state or federal courts located in New York, New York, and you and we consent to their jurisdiction and venue.

## General

These terms and the privacy policy are the whole agreement between you and us about the service. If a part is found unenforceable, the rest stays in effect. If we do not enforce a term, we have not waived it. You may not assign these terms without our written consent; we may assign them in a merger or sale of the business.

## Contact

DappHero Corp., 185 Wythe Avenue, 2nd Floor, Brooklyn, NY 11249, USA. Email: support@agentdrive.xyz, for support, billing, privacy and legal questions.
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
