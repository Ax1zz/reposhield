/**
 * RepoShield classifier — Day 1 (rule-based, no embeddings yet).
 *
 * Inputs are normalized fields from a GitHub webhook (issue or PR).
 * Output is a verdict with score 0..1 and an array of human-readable reasons.
 * A verdict crosses the `block` threshold when score >= 0.6 — tunable.
 *
 * Day-2 plan: add embedding similarity vs a curated slop-corpus.
 * Day-3 plan: add a learned model fine-tuned on collected ground truth.
 *
 * Design choices that pull two directions at once:
 *  - POSITIVE signals (push score up) come from spammer patterns:
 *    airdrop language, suspicious domains, AI-templated phrasing,
 *    drive-by account stats, wallet addresses, IM-invite links.
 *  - NEGATIVE signals (push score down) come from "real bug report" tells:
 *    fenced code blocks, stack traces, file:line refs, semver strings,
 *    cross-references like #42. Spammers almost never produce these.
 *
 *    Without negatives the classifier over-fires on first-time issue
 *    reporters who paste a stack trace — and that's the demographic we
 *    most need to keep happy.
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

/* ---------- positive signal dictionaries ---------- */

const CRYPTO_SPAM_PATTERNS = [
  /\bairdrop\b/i,
  /\bclaim\s+(?:your\s+)?(?:tokens?|rewards?|nfts?|airdrop)\b/i,
  /\bconnect\s+(?:your\s+)?wallet\b/i,
  /\bverify\s+(?:your\s+)?wallet\b/i,
  /\b(?:metamask|trustwallet|walletconnect|phantom\s+wallet)\b/i,
  /\b(?:usdt|usdc|eth|bnb|sol|matic|trx)\s+(?:giveaway|drop|reward|airdrop)\b/i,
  /\$[a-z]{2,6}\s+(?:token|airdrop|presale|drop|mint)/i,
  /\bpresale\s+is\s+live\b/i,
  /\bfree\s+(?:mint|nft|drop|claim)\b/i,
  /\blimited[-\s]?time\s+(?:offer|drop|airdrop|claim)/i,
  /\bexclusive\s+(?:drop|airdrop|mint)/i,
  /\byield\s+farming\b/i,
  /\bweb3\s+(?:rewards?|airdrop|claim)/i,
  /\b(?:ico|presale|ido|defi)\s+(?:live|now|alert|open)/i,
];

/** Known phishing / drop-farming domains. Cheap exact-match. */
const SUSPICIOUS_DOMAINS = [
  'token-claw.xyz',
  'watery-compost.today',
  'mev-bot.app',
  'claim-tokens.io',
  'wallet-verify.io',
];

/** URL shorteners — opaque destinations are a strong spam tell. */
const URL_SHORTENERS = [
  'bit.ly',
  'tinyurl.com',
  'shorturl.at',
  'cutt.ly',
  'goo.gl',
  'lnkd.in',
  'rb.gy',
  'is.gd',
  't.co',
  'ow.ly',
  'tiny.cc',
];

/**
 * GitHub-impersonating typosquat hosts. We do NOT add `github.io` (pages)
 * or `gist.github.com` — those are legitimate.
 */
const GITHUB_TYPOSQUATS = [
  /\bg[il1]thub[-.]?(?:claim|verify|airdrop|reward|support|secure)\b/i,
  /\bgith[ouw]b\.(?:io|com|net|app)\b/i, // gthub, githuv, etc — but not github
  /\bgit-?hub\.(?!com|io)[a-z]{2,}/i,
];

const LLM_SLOP_PHRASES = [
  /\bi\s+noticed\s+(?:an\s+)?(?:issue|problem|opportunity)\s+(?:and|to)\s+(?:would\s+like\s+to|contribute|improve)/i,
  /\bas\s+(?:a|an)\s+(?:large\s+language\s+model|ai\s+(?:assistant|model|language\s+model))/i,
  /\bcertainly[!,.]?\s+here(?:'?s|\s+is)\s+(?:the|a)/i,
  /\bin\s+conclusion[,:]\s+(?:this|the)\s+(?:change|pull request|update)/i,
  /\boverall[,:]\s+this\s+(?:pull request|change|contribution)\s+(?:aims|seeks|will)/i,
  /\bthis\s+(?:pull request|pr|change)\s+(?:aims\s+to|seeks\s+to|will)\s+(?:improve|enhance|fix|address)\s+the\s+(?:project|codebase|repository)/i,
  /\bi(?:'ve|\s+have)\s+(?:analyzed|reviewed|examined)\s+the\s+(?:codebase|code|repository|project)/i,
  /\bi(?:'d|\s+would)\s+be\s+happy\s+to\s+(?:help|contribute|assist)/i,
  /\bhere(?:'?s|\s+is)\s+a\s+(?:breakdown|comprehensive|detailed)\s+(?:of\s+)?(?:the\s+)?(?:changes|solution|approach)/i,
  /\bthank\s+you\s+for\s+your\s+attention\s+to\s+this\s+matter/i,
  /\bplease\s+let\s+me\s+know\s+if\s+(?:you\s+)?(?:have\s+any\s+)?(?:questions|concerns|feedback)/i,
  /\bi\s+hope\s+(?:this|that)\s+(?:helps|contribution|change)\s+(?:is\s+)?(?:useful|helpful|beneficial)/i,
  /\bto\s+summarize[,:]?\s+(?:the|this)/i,
];

const TEMPLATED_TYPO_TITLES = [
  /^(?:docs?|readme)\s*[:\-]?\s*fix\s+typo$/i,
  /^fix\s+typo\s+in\s+readme$/i,
  /^update\s+readme(?:\.md)?$/i,
  /^minor\s+(?:fix|update|improvement)s?$/i,
  /^improvements?$/i,
  /^enhancement$/i,
  /^refactor(?:ing)?$/i,
  /^(?:chore|docs|fix|feat)\s*:\s*(?:minor|small|tiny)\s+(?:fix|update|change)$/i,
];

/* ---------- specific high-confidence regexes ---------- */

/** Crypto wallet addresses. Hits 0x… (ETH/EVM), bc1…/1…/3… (BTC), T… (TRON). */
const WALLET_ADDR_RE =
  /\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[A-Za-z0-9]{33})\b/;

/** Telegram channel/invite or Discord invite links. */
const IM_INVITE_RE = /\b(?:t\.me\/[a-zA-Z0-9_+]+|discord\.gg\/[a-zA-Z0-9]+|discord\.com\/invite\/[a-zA-Z0-9]+)\b/i;

/* ---------- negative signal regexes (real bug reports look like this) ---------- */

/** Fenced code block or inline code. Strong evidence of a real report. */
const CODE_BLOCK_RE = /```[\s\S]*?```/;

/** Stack trace frames — JS, Python, Go, Rust, Java. */
const STACK_TRACE_RE =
  /(?:at\s+[\w$.<>]+\s*\([^)]*:\d+(?::\d+)?\)|File\s+"[^"]+",\s+line\s+\d+|panic:\s|thread\s+'[^']+'\s+panicked|goroutine\s+\d+\s+\[|Exception\s+in\s+thread\s+")/;

/** Reference to a file with a line number (foo.ts:42 or src/foo.js#L42). */
const FILE_LINE_RE = /\b[\w./\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|c|cpp|h|hpp|rb|php|cs|swift|md|yml|yaml|json|sh)(?::\d+|#L\d+)\b/i;

/** Semver-ish version strings or runtime markers (node 20.x, Python 3.11). */
const VERSION_RE = /\b(?:v\d+\.\d+(?:\.\d+)?|(?:node|python|ruby|go|rust|java|deno|bun)\s+v?\d+(?:\.\d+)*(?:\.\w+)?)\b/i;

/** Cross-reference to another issue/PR in the same repo. */
const ISSUE_REF_RE = /(?<!\w)#\d{1,6}\b/;

/* ---------- helpers ---------- */

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86400000;
}

function countMatches(haystack: string, needles: RegExp[]): number {
  let n = 0;
  for (const r of needles) if (r.test(haystack)) n++;
  return n;
}

/** Count unicode-emoji code points. Cheap proxy: anything outside BMP letters/digits plus dingbats. */
function emojiCount(s: string): number {
  // Pictographic ranges cover most modern emoji including flags + ZWJ sequences.
  const re =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu;
  return (s.match(re) ?? []).length;
}

/** Count em-dashes (—) — GPT/Claude love them; humans almost never type one. */
function emDashCount(s: string): number {
  return (s.match(/—/g) ?? []).length;
}

/** Extract all hostnames from URLs in text (best-effort, no full URL parser). */
function extractHosts(text: string): string[] {
  const re = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
  const hosts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) hosts.push(m[1].toLowerCase());
  return hosts;
}

/* ---------- main scoring ---------- */

export function classify(author: AuthorSignal, content: ContentSignal): Verdict {
  const reasons: string[] = [];
  let score = 0;
  let primary: Verdict['primaryCategory'] = null;

  const haystack = `${content.title}\n${content.body}`;
  const bodyLen = content.body.length;
  const hosts = extractHosts(haystack);

  /* === POSITIVE SIGNALS === */

  /* 1) crypto-airdrop / phishing — high-confidence single-shot */
  const cryptoHits = countMatches(haystack, CRYPTO_SPAM_PATTERNS);
  if (cryptoHits >= 1) {
    score += 0.6;
    reasons.push(`crypto-airdrop language (${cryptoHits} pattern match${cryptoHits > 1 ? 'es' : ''})`);
    primary = 'crypto_airdrop';
  }

  /* 1a) crypto wallet address — almost never appears in legitimate issues.
         A single wallet address in body is, by itself, sufficient to block. */
  if (WALLET_ADDR_RE.test(content.body)) {
    score += 0.5;
    reasons.push('crypto wallet address in body');
    if (!primary) primary = 'crypto_airdrop';
  }

  /* 1b) known-bad / typosquatted / shortener domains */
  for (const d of SUSPICIOUS_DOMAINS) {
    if (haystack.toLowerCase().includes(d)) {
      score += 0.4;
      reasons.push(`known-bad domain: ${d}`);
      if (!primary) primary = 'crypto_airdrop';
      break;
    }
  }
  for (const re of GITHUB_TYPOSQUATS) {
    if (re.test(haystack)) {
      score += 0.5;
      reasons.push('GitHub-impersonating typosquat domain');
      if (!primary) primary = 'crypto_airdrop';
      break;
    }
  }
  const shortenerHits = hosts.filter((h) => URL_SHORTENERS.includes(h));
  if (shortenerHits.length > 0) {
    // 1 shortener is mild, all-shorteners is loud.
    const allShort = hosts.length > 0 && shortenerHits.length === hosts.length;
    score += allShort ? 0.3 : 0.15;
    reasons.push(`URL shortener${shortenerHits.length > 1 ? 's' : ''}: ${shortenerHits.join(', ')}`);
    if (!primary) primary = 'crypto_airdrop';
  }

  /* 1c) Telegram/Discord invite — common crypto-drop funnel.
         In code-repo issues these are >95% spam ("join our trading group",
         "free signals", invite-gated airdrop drops). Legit projects put
         community links in README, not in issues. */
  if (IM_INVITE_RE.test(haystack)) {
    score += 0.5;
    reasons.push('Telegram/Discord invite link');
    if (!primary) primary = 'crypto_airdrop';
  }

  /* 2) LLM-slop phrasing */
  const slopHits = countMatches(haystack, LLM_SLOP_PHRASES);
  if (slopHits > 0) {
    score += 0.25 + 0.1 * Math.min(slopHits - 1, 3);
    reasons.push(`LLM-templated phrasing (${slopHits} match${slopHits > 1 ? 'es' : ''})`);
    if (!primary) primary = 'llm_slop';
  }

  /* 2a) Emoji density — only meaningful in shorter content, otherwise marketing
         and design issues legitimately use them. */
  const emoji = emojiCount(content.body);
  if (bodyLen > 0 && bodyLen < 600 && emoji >= 4) {
    score += 0.15;
    reasons.push(`high emoji density (${emoji} in ${bodyLen} chars)`);
    if (!primary) primary = 'llm_slop';
  }

  /* 2b) Em-dash density — typed em-dash is rare on Windows keyboards.
         Two or more per 200 chars is a strong AI-prose tell. */
  const dashes = emDashCount(content.body);
  if (bodyLen >= 100 && dashes >= 2 && dashes / bodyLen > 0.005) {
    score += 0.1;
    reasons.push(`em-dash density (${dashes} in ${bodyLen} chars)`);
    if (!primary) primary = 'llm_slop';
  }

  /* 3) Templated-typo title */
  if (TEMPLATED_TYPO_TITLES.some((r) => r.test(content.title.trim()))) {
    score += 0.2;
    reasons.push('boilerplate title (typo/readme PR pattern)');
    if (!primary) primary = 'templated_typo';
  }

  /* 4) Drive-by account signals — only stack on top of existing signal */
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
  if (score > 0) {
    score += driveBy;
    if (driveBy >= 0.2 && !primary) primary = 'drive_by';
  } else if (driveBy >= 0.4) {
    score += driveBy * 0.7;
    reasons.push('strong drive-by signals (manual review suggested)');
    primary = 'drive_by';
  }

  /* 5) PR-specific patterns */

  /* 5a) one-line PR from a fresh first-time contributor — airdrop farming */
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

  /* 5b) "Add X to awesome list" — single-file single-line append to README,
         from a no-history account. The single most common drop-farming PR
         pattern on awesome-* repos. */
  if (
    content.kind === 'pull_request' &&
    (content.filesChanged ?? 0) === 1 &&
    (content.additions ?? 0) <= 3 &&
    (content.deletions ?? 0) === 0 &&
    (author.priorContributionsToRepo ?? 0) === 0 &&
    /\b(?:awesome|add(?:ing)?\s+to\s+(?:the\s+)?(?:list|awesome))/i.test(content.title)
  ) {
    score += 0.25;
    reasons.push('single append to awesome-list from no-history account');
    if (!primary) primary = 'templated_typo';
  }

  /* === NEGATIVE SIGNALS (rescue real bug reports) === */

  let negative = 0;
  const negativeReasons: string[] = [];

  if (CODE_BLOCK_RE.test(content.body)) {
    negative += 0.15;
    negativeReasons.push('contains code block');
  }
  if (STACK_TRACE_RE.test(content.body)) {
    negative += 0.2;
    negativeReasons.push('contains stack trace');
  }
  if (FILE_LINE_RE.test(content.body)) {
    negative += 0.1;
    negativeReasons.push('references file with line number');
  }
  if (VERSION_RE.test(content.body)) {
    negative += 0.05;
    negativeReasons.push('cites a version string');
  }
  if (ISSUE_REF_RE.test(content.body)) {
    negative += 0.05;
    negativeReasons.push('references another issue/PR');
  }

  // Negative signals are CAPPED so they can't fully erase a strong positive
  // (a wallet address + code block should still block — spammers will pad).
  // Cap is also waived when crypto_airdrop is the primary category, because
  // wallet-bearing spam often pastes block-formatted addresses.
  const cap = primary === 'crypto_airdrop' ? 0.15 : 0.4;
  negative = Math.min(negative, cap);
  if (negative > 0) {
    score -= negative;
    reasons.push(`(negative −${negative.toFixed(2)}: ${negativeReasons.join(', ')})`);
  }

  score = Math.max(0, Math.min(1, score));
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
    '> Closed automatically by [RepoShield](https://reposhield.dev).',
    '',
    `**Verdict:** \`${verdict.primaryCategory ?? 'spam'}\` (confidence ${(verdict.score * 100).toFixed(0)}%)`,
    '',
    '**Why:**',
    ...verdict.reasons.map((r) => `- ${r}`),
    '',
    'If this was a mistake, a maintainer can reopen this thread and RepoShield will learn from the override.',
  ].join('\n');
}
