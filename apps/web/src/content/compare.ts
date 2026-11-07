/**
 * Comparison pages. One source for the HTML page and the Markdown twin.
 *
 * Claims about Agent Drive are backed by the repo (see docs/quickstart.md, docs/crypto.md,
 * docs/cli.md, docs/api.md, the pricing page and packages/agent-drive/src/mcp.ts). Claims about
 * other products are deliberately general and stable, with no prices or durability figures; each
 * page links the vendors' own documentation.
 */
export type Comparison = {
  slug: string;
  title: string;
  other: string;
  /** Used in the index and the page description. */
  summary: string;
  /** "Use X when..., use Agent Drive when..." paragraph shown first. */
  answer: string;
  table: [aspect: string, other: string, agentDrive: string][];
  chooseOther: string[];
  chooseAgentDrive: string[];
  links: [label: string, href: string][];
};

export const COMPARE_CHECKED = '2026-11-07';

export const COMPARISONS: Comparison[] = [
  {
    slug: 's3-r2',
    title: 'Agent Drive vs Amazon S3 and Cloudflare R2',
    other: 'S3 / R2',
    summary: 'Object storage you operate, or encrypted storage an agent can connect to itself.',
    answer:
      "Use S3 or R2 when you need general-purpose object storage at any scale, want to serve files to apps or the public, or already run your infrastructure in that cloud. Use Agent Drive when the files belong to agents and you want each agent to connect with one human approval, encrypt files before they leave the agent's machine, and keep per-agent keys and folder limits without writing IAM policies.",
    table: [
      [
        'What it is',
        'General-purpose object storage with a large feature set.',
        'Per-agent encrypted file storage with a CLI and an MCP server.',
      ],
      [
        'Getting an agent access',
        'A person creates credentials or roles in the cloud account and gives them to the agent.',
        'The agent runs `agent-drive login`; a person approves a code once. No API key is copied.',
      ],
      [
        'Encryption',
        'Providers encrypt data on the server side. Encrypting on the client, so the provider never holds the key, is something you add yourself.',
        'Files are encrypted on the agent’s machine with AES-256-GCM. The service stores ciphertext and never receives drive keys. Paths, sizes and tags are visible to the service.',
      ],
      [
        'Per-agent limits',
        'Possible with access policies you write and maintain.',
        'Each agent has its own revocable key, can be read-only, and can be limited to writing under chosen folders.',
      ],
      [
        'File history',
        'Versioning is a bucket option you turn on and manage.',
        'Every write keeps a version that records which agent wrote it. A conditional write fails with a conflict instead of overwriting newer work.',
      ],
      [
        'Scale and features',
        'Very large objects and workloads, lifecycle rules, public hosting and a wide ecosystem of tools.',
        'Plan allowances and a 5 GiB limit per encrypted upload. No public hosting; sharing uses expiring links.',
      ],
    ],
    chooseOther: [
      'You serve files to users, websites or other services.',
      'You need very large objects, high throughput or fine-grained cloud-wide access control.',
      'Your team already manages credentials and policies in that cloud, and you do not need client-side encryption.',
    ],
    chooseAgentDrive: [
      'Agents on different platforms and sandboxes need to share files that survive when a sandbox ends.',
      'You want a person to approve each agent once, instead of copying keys into every environment.',
      'You want file contents encrypted before upload by default, with per-agent keys you can revoke.',
    ],
    links: [
      ['Amazon S3 documentation', 'https://docs.aws.amazon.com/s3/'],
      ['Cloudflare R2 documentation', 'https://developers.cloudflare.com/r2/'],
    ],
  },
  {
    slug: 'git-github',
    title: 'Agent Drive vs git and GitHub',
    other: 'git / GitHub',
    summary: 'Versioned source history for text, or encrypted file storage for agent work.',
    answer:
      'Use git and GitHub when the files are source code or text you want to diff, branch, review and merge, and when collaborators already work there. Use Agent Drive when agents need to save and read files of any type, including large or binary ones, across sandboxes without a commit and push workflow, and when you want the contents encrypted before they leave the agent’s machine.',
    table: [
      [
        'What it is',
        'Distributed version control with a hosting service on top.',
        'Per-agent encrypted file storage with a CLI and an MCP server.',
      ],
      [
        'History and review',
        'Full history, diffs, branches, merges and pull requests.',
        'Per-file versions you can list and restore, with the writing agent recorded. No diffs, branches or review workflow.',
      ],
      [
        'Saving a file',
        'Commit, then push, then pull elsewhere; concurrent changes are merged.',
        'One `put` command. A conditional write (`--if-version`) fails with a conflict if the file changed; the agent reads, merges and retries.',
      ],
      [
        'Large and binary files',
        'Plain git is awkward for large binary files; extensions such as Git LFS exist.',
        'Files of any type up to 5 GiB per encrypted upload.',
      ],
      [
        'Who can read the contents',
        'Git does not encrypt files. The hosting service can read repository contents.',
        'Contents are encrypted on the agent’s machine. The service stores ciphertext and never receives drive keys. Paths, sizes and tags are visible to the service.',
      ],
      [
        'Agent access',
        'Needs git credentials such as a token or SSH key set up for the agent.',
        'The agent runs `agent-drive login`; a person approves a code once. Keys can be read-only or limited to folders.',
      ],
    ],
    chooseOther: [
      'The work is code or text and people will review changes before they land.',
      'You need branches, diffs and a record of why each change was made.',
      'The files are public or shared with a team that already uses GitHub.',
    ],
    chooseAgentDrive: [
      'Agents keep memory, notes, reports or datasets that should survive between runs and platforms.',
      'The files are large or binary, or you do not want agents to manage commits.',
      'You want contents encrypted before upload, and a per-agent key you can revoke.',
    ],
    links: [
      ['git documentation', 'https://git-scm.com/doc'],
      ['GitHub documentation', 'https://docs.github.com/'],
    ],
  },
  {
    slug: 'dropbox-google-drive',
    title: 'Agent Drive vs Dropbox and Google Drive',
    other: 'Dropbox / Google Drive',
    summary: 'File storage built for people and collaboration, or built for agents.',
    answer:
      'Use Dropbox or Google Drive when people edit and share documents together, you want sync apps on every device, and the provider reading your files is acceptable. Use Agent Drive when the users are agents running in shells, CI and sandboxes, you want each agent to connect itself with one human approval, and you want file contents encrypted before upload.',
    table: [
      [
        'Built for',
        'People: sync apps, sharing, comments and, in some products, shared editing.',
        'Agents: a CLI and an MCP server. A web console lets you browse and download.',
      ],
      [
        'Getting an agent access',
        'Typically an OAuth app or API token that a person sets up, with the permissions that integration offers.',
        'The agent runs `agent-drive login`; a person approves a code once. Keys can be read-only or limited to folders.',
      ],
      [
        'Encryption',
        'By default the provider manages the keys, so the service can read file contents. Some business plans offer optional client-side encryption.',
        'Files are encrypted on the agent’s machine with AES-256-GCM. The service stores ciphertext and never receives drive keys. Paths, sizes and tags are visible to the service.',
      ],
      [
        'Collaboration',
        'Rich: shared folders, comments, previews and real-time editing for supported formats.',
        'Agents share one drive. People can send an expiring share link that decrypts in the browser. No shared editing.',
      ],
      [
        'File history',
        'Version history for files is built in.',
        'Every write keeps a version that records which agent wrote it, with restore. A conditional write fails with a conflict instead of overwriting newer work.',
      ],
      [
        'Search',
        'Includes search over file names and, for many formats, content.',
        'Searches names, paths, tags and attribution metadata. It cannot search inside file contents, because the service cannot read them.',
      ],
    ],
    chooseOther: [
      'People need to edit, comment on and share documents together.',
      'You want search inside document contents and previews of office formats.',
      'Your organization already manages accounts and sharing there.',
    ],
    chooseAgentDrive: [
      'Agents on different platforms need a place to save and read files without a person pasting keys.',
      'You want the service to hold only ciphertext, and a revocable key per agent.',
      'You need agents to work through a shell or MCP server instead of a sync app.',
    ],
    links: [
      ['Dropbox developer documentation', 'https://www.dropbox.com/developers'],
      ['Google Drive documentation', 'https://developers.google.com/workspace/drive'],
    ],
  },
];

export const comparison = (slug: string) => COMPARISONS.find((c) => c.slug === slug);

const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

export function comparisonMarkdown(c: Comparison, origin: string): string {
  const esc = (s: string) => s.replaceAll('|', '\\|');
  return `# ${c.title}

${c.answer}

| | ${c.other} | Agent Drive |
| --- | --- | --- |
${c.table.map(([a, o, d]) => `| ${esc(a)} | ${esc(o)} | ${esc(d)} |`).join('\n')}

## When to choose which

Choose ${c.other} when:

${list(c.chooseOther)}

Choose Agent Drive when:

${list(c.chooseAgentDrive)}

## Notes

Statements about ${c.other} are general descriptions checked on ${COMPARE_CHECKED}; they may change, so check the vendor's documentation: ${c.links.map(([l, h]) => `[${l}](${h})`).join(', ')}.

Get started: ${origin}/docs/quickstart.md
`;
}

export function compareIndexMarkdown(origin: string): string {
  return `# Compare Agent Drive

How Agent Drive differs from other places to keep files, and when each is the better choice.

${COMPARISONS.map((c) => `- [${c.title}](${origin}/compare/${c.slug}.md): ${c.summary}`).join('\n')}
`;
}
