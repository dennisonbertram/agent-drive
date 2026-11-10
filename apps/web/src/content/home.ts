import { allPlanFacts } from './plans';
import { egressNotMetered } from './pricing';

/** Homepage copy that the Markdown twin reuses. Backticks mark inline code. */
export const HERO = {
  title: 'Agent files that outlive the sandbox.',
  lede: 'Agents get a cloud drive to save work that outlives a session or sandbox.',
  next: 'Free to start. Your agent shows a pairing code, and you approve it in your account.',
};

/** The public origin shown in copyable setup instructions. Never a local host. */
export const CANONICAL_ORIGIN = 'https://agentdrive.xyz';

export const RELAY = {
  title: 'Long-running sessions need persistent data.',
  lede: 'Frontier research, traces kept for training, research output too big for GitHub. Work that runs for days needs a place to live between sessions.',
};

export const GAMES = {
  tag: 'Game development',
  title: 'Keep every generated asset between sessions.',
  lede: 'Agents that build games generate sprites, textures, audio and levels. Save them to the drive and the next session opens with the whole asset library, not an empty folder.',
};

export const PROTEIN = {
  tag: 'Research data',
  title: "Gigabytes of protein data don't fit in GitHub.",
  lede: "Anthropic's Fable 6.2 can now do protein work. That work produces structure files, embeddings and simulation runs measured in gigabytes. GitHub blocks files over 100 MB. Agent Drive keeps them encrypted, versioned and shared with every agent on the project.",
};

export const PROBLEM = {
  title: 'Sandboxes end. Machines change. Platforms switch.',
  lede: 'Each one wipes whatever the agent saved locally, and the next run starts from zero. With a drive, the agent picks up where it stopped.',
};

export const FEATURES = [
  {
    tag: 'Encrypted',
    text: "Files are encrypted on the agent's machine (AES-256-GCM). We store only ciphertext and never see your drive keys.",
  },
  {
    tag: 'Sharable',
    text: "Send an expiring link that decrypts in the recipient's browser. No account needed; revoke it any time.",
  },
  {
    tag: 'Works anywhere',
    text: 'A CLI and an MCP server. Set one secret in a sandbox, laptop or CI runner and the agent has its drive.',
  },
];

export const FAQ = [
  {
    q: 'What happens if I lose the drive key?',
    a: 'Nobody can open the files, including us. Save the recovery file when you create a drive, or ask your agent to run `agent-drive credentials export --to <a safe path>`.',
  },
  {
    q: 'How is this different from S3, git or Dropbox?',
    a: 'The agent connects in one step with no keys to paste. Files are encrypted before upload. Each agent has its own revocable key and folder limits. Every version records which agent wrote it. And it works the same in any sandbox.',
  },
  {
    q: 'Which agents work with it?',
    a: 'Any agent that can run a shell command or use an MCP server. We have tested Claude Code, Codex, pi and opencode.',
  },
  {
    q: "Can a chat assistant in a vendor's cloud use it?",
    a: "Not yet. Encryption happens on the agent's own machine, so it needs a shell or a local MCP server.",
  },
  {
    q: 'What counts as an API operation?',
    a: 'Each successful request an agent makes (for example a list, upload or download) counts as one. Failed requests do not count.',
  },
];

export function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a.replaceAll('`', '') },
    })),
  };
}

export function homeMarkdown(origin: string): string {
  const plans = allPlanFacts(egressNotMetered())
    .map((p) => `- ${p.name}: ${p.price} / month. ${p.drives}, ${p.storage}, ${p.downloads}.`)
    .join('\n');
  return `# Agent Drive

> Encrypted storage your agents keep across sandboxes. Files survive sandboxes, machines and platform switches.

${HERO.title} ${HERO.lede}

## Set up

Give this to your agent: \`Set up Agent Drive: ${origin}/llms.txt\`

Or in a terminal: \`npm install -g @dennisonbertram/agent-drive\`

${HERO.next}

## ${PROBLEM.title}

${PROBLEM.lede}

## Use cases

- Long-running work: ${RELAY.title} ${RELAY.lede}
- ${GAMES.tag}: ${GAMES.title} ${GAMES.lede}
- ${PROTEIN.tag}: ${PROTEIN.title} ${PROTEIN.lede}

## Features

${FEATURES.map((f) => `- ${f.tag}: ${f.text}`).join('\n')}

## FAQ

${FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n')}

## Pricing

${plans}

Full details: ${origin}/pricing.md

## More

- Docs: ${origin}/docs.md
- Comparisons with S3 and R2, git and GitHub, Dropbox and Google Drive: ${origin}/compare.md
- Agent setup guide: ${origin}/llms.txt
`;
}
