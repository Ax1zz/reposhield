/**
 * BotShield classifier — Day 1 (rule-based, no embeddings yet).
 *
 * Inputs are normalized fields from a GitHub webhook (issue or PR).
 * Output is a verdict with score 0..1 and an array of human-readable reasons.
 * A verdict crosses the `block` threshold when score >= 0.6 — tunable.
 *
 * Day-2 plan: add embedding similarity vs a curated slop-corpus.
 * Day-3 plan: add a learned model fine-tuned on collected ground truth.
 */

export interface AuthorSignal {
  login: string;
  /** ISO timestamp of account creation, if known. */
  createdAt?: string;
  /** Number of public repos. */
  publicRepos?: number;
  /** Number of followers. */
  followers?: number;
  /** Whether the avatar URL is the default identicon. */
  hasDefaultAvatar?: boolean;
  /** Author's prior contribution count to THIS repo (issues+PRs+commits). */
  priorContributionsToRepo?: number;
}

export interface ContentSignal {
  kind: 'issue' | 'pull_request';
  title: string;
  body: string;
  /** For PRs: number of files changed. */
  filesChanged?: number;
  /** For PRs: net additions. */
  additions?: number;
  /** For PRs: net deletions. */
  deletions?: number;
}

export interface Verdict {
  score: number;
  block: boolean;
  reasons: string[];
  primaryCategory:
    | 'crypto_airdrop'
    | 'llm_slop'
    | 'drive_by'
    | 'templated_typo'
    | 'clean'
    | null;
}

/* ---------- heuristic feature extractors ---------- */

const CRYPTO_SPAM_PATTERNS = [
  /\bairdrop\b/i,
  /\bclaim\s+(?:your\s+)?(?:tokens?|rewards?|nfts?)\b/i,
  /\bconnect\s+(?:your\s+)?wallet\b/i,
  /\b(?:metamask|trustwallet|walletconnect)\b/i,
  /\b(?:usdt|usdc|eth|bnb|sol|matic)\s+(?:giveaway|drop)\b/i,
  /\$[a-z]{2,6}\s+(?:token|airdrop|presale)/i,
  /\bpresale\s+is\s+live\b/i,
  /\bverify\s+(?:your\s+)?wallet\b/i,
];

/** Domains historically used for crypto-airdrop phishing or drop farming. */
const SUSPICIOUS_DOMAINS = [
  'token-claw.xyz',
  'watery-compost.today',
  'mev-bot.app',
  't.me/+', // private telegram invites
  'bit.ly',
  'tinyurl.com',
];

const LLM_SLOP_PHRASES = [
  /\bi\s+noticed\s+(?:an\s+)?(?:issue|problem|opportunity)\s+(?:and|to)\s+(?:would\s+like\s+to|contribute|improve)/i,
  /\bas\s+(?:a|an)\s+(?:large\s+language\s+model|ai\s+(?:assistant|model))/i,
  /\bcertainly[!,.]?\s+here(?:'?s|\s+is)\s+(?:the|a)/i,
  /\bin\s+conclusion[,:]\s+(?:this|the)\s+(?:change|pull request|update)/i,
  /\boverall[,:]\s+this\s+(?:pull request|change|contribution)\s+(?:aims|seeks|will)/i,
  /\bthis\s+(?:pull request|pr|change)\s+(?:aims\s+to|seeks\s+to|will)\s+(?:improve|enhance|fix|address)\s+the\s+(?:project|codebase|repository)/i,
];

const TEMPLATED_TYPO_TITLES = [
  /^(?:docs?|readme)\s*[:\-]?\s*fix\s+typo$/i,
  /^fix\s+typo\s+in\s+readme$/i,
  /^update\s+readme(?:\.md)?$/i,
  /^minor\s+(?:fix|update|improvement)s?$/i,
  /^improvements?$/i,
];

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86400000;
}

function countMatches(haystack: string, needles: RegExp[]): number {
  let n = 0;
  for (const r of needles) if (r.test(haystack)) n++;
  return n;
}

/* ---------- main scoring ---------- */

export function classify(author: AuthorSignal, content: ContentSignal): Verdict {
  const reasons: string[] = [];
  let score = 0;
  let primary: Verdict['primaryCategory'] = null;

  const haystack = `${content.title}\n${content.body}`;

  /* 1) crypto-airdrop / phishing signals — high-confidence single-shot */
  const cryptoHits = countMatches(haystack, CRYPTO_SPAM_PATTERNS);
  if (cryptoHits >= 1) {
    score += 0.6;
    reasons.push(`crypto-airdrop language (${cryptoHits} pattern match${cryptoHits > 1 ? 'es' : ''})`);
    primary = 'crypto_airdrop';
  }
  for (const d of SUSPICIOUS_DOMAINS) {
    if (haystack.toLowerCase().includes(d)) {
      score += 0.35;
      reasons.push(`suspicious domain referenced: ${d}`);
      if (!primary) primary = 'crypto_airdrop';
      break;
    }
  }

  /* 2) LLM-slop language */
  const slopHits = countMatches(haystack, LLM_SLOP_PHRASES);
  if (slopHits > 0) {
    score += 0.25 + 0.1 * Math.min(slopHits - 1, 3);
    reasons.push(`LLM-templated phrasing (${slopHits} match${slopHits > 1 ? 'es' : ''})`);
    if (!primary) primary = 'llm_slop';
  }

  /* 3) templated-typo title — classic airdrop-farming PR */
  if (TEMPLATED_TYPO_TITLES.some((r) => r.test(content.title.trim()))) {
    score += 0.2;
    reasons.push('boilerplate title (typo/readme PR pattern)');
    if (!primary) primary = 'templated_typo';
  }

  /* 4) drive-by account signals — only stack if there's already something */
  let driveBy = 0;
  if (author.createdAt) {
    const age = daysBetween(new Date(author.createdAt), new Date());
    if (age < 7) {
      driveBy += 0.25;
      reasons.push(`account is ${age.toFixed(1)} day(s) old`);
    } else if (age < 30) {
      driveBy += 0.1;
      reasons.push(`account is ${age.toFixed(0)} days old`);
    }
  }
  if ((author.priorContributionsToRepo ?? 0) === 0) {
    driveBy += 0.05;
    reasons.push('first-time contributor to this repo');
  }
  if (author.hasDefaultAvatar) {
    driveBy += 0.05;
    reasons.push('default avatar');
  }
  if ((author.followers ?? 0) === 0 && (author.publicRepos ?? 0) === 0) {
    driveBy += 0.1;
    reasons.push('zero followers and zero public repos');
  }
  // Drive-by alone isn't enough — only counts on top of other signals.
  if (score > 0) {
    score += driveBy;
    if (driveBy >= 0.2 && !primary) primary = 'drive_by';
  } else if (driveBy >= 0.4) {
    // Strong drive-by signal can still flag for manual review (below block threshold).
    score += driveBy * 0.7;
    reasons.push('strong drive-by signals (manual review suggested)');
    primary = 'drive_by';
  }

  /* 5) PR-specific: zero-content typo PR from a fresh account */
  if (
    content.kind === 'pull_request' &&
    (content.additions ?? 0) <= 2 &&
    (content.deletions ?? 0) <= 2 &&
    (content.filesChanged ?? 0) <= 1 &&
    (author.priorContributionsToRepo ?? 0) === 0
  ) {
    score += 0.15;
    reasons.push('one-line PR from first-time contributor (airdrop-farming pattern)');
    if (!primary) primary = 'templated_typo';
  }

  score = Math.min(1, score);
  const block = score >= 0.6;

  if (reasons.length === 0) {
    reasons.push('no spam signals detected');
    primary = 'clean';
  }

  return { score, block, reasons, primaryCategory: primary };
}

/** Render a closing-comment body for a blocked event. */
export function renderCloseComment(verdict: Verdict): string {
  return [
    '> Closed automatically by [BotShield](https://botshield.dev).',
    '',
    `**Verdict:** \`${verdict.primaryCategory ?? 'spam'}\` (confidence ${(verdict.score * 100).toFixed(0)}%)`,
    '',
    '**Why:**',
    ...verdict.reasons.map((r) => `- ${r}`),
    '',
    'If this was a mistake, a maintainer can reopen this thread and BotShield will learn from the override.',
  ].join('\n');
}
