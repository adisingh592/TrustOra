#!/usr/bin/env node
// Secret scanner with no dependencies. Findings are always masked.
//
//   node scripts/secret-scan.mjs            tracked files in the working tree
//   node scripts/secret-scan.mjs --staged   staged content (used by the pre-commit hook)
//   node scripts/secret-scan.mjs --history  every commit reachable from any ref
//
// Exit codes: 0 clean, 1 findings, 2 could not run.
// To accept a false positive, put "secret-scan:allow" on the same line.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKIPPED_FILES = /(^|\/)pnpm-lock\.yaml$/;
const ENV_LIKE_FILE = /(^|\/)\.env(\.[^/]*)?$|\.env$/;
const SENSITIVE_FILE = /(^|\/)\.env(\.[^/]*)?$|\.(pem|key|p12|pfx|db)$/;
const ENV_TEMPLATE = /(^|\/)\.env\.example$/;
const ALLOW_MARKER = "secret-scan:allow";

// A hash of all zeros and similar placeholders are not secrets.
const hasEntropy = (value) => new Set(value.replace(/^0x/, "")).size >= 8;

const RULES = [
  {
    id: "hex-64 (possible private key)",
    pattern: /(?<![0-9a-zA-Z])[0-9a-fA-F]{64}(?![0-9a-zA-Z])/g,
    accept: hasEntropy,
  },
  {
    id: "0x-hex-64 in env file",
    pattern: /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{64}(?![0-9a-zA-Z])/g,
    accept: hasEntropy,
    envOnly: true,
  },
  {
    id: "0x-hex-64 assigned to a key or secret",
    pattern:
      /(?:private_?key|secret|mnemonic)["'`]?\s*[:=]+\s*["'`]?(0x[0-9a-fA-F]{64})(?![0-9a-zA-Z])/gi,
    group: 1,
    accept: hasEntropy,
  },
  {
    id: "PRIVATE_KEY with a value",
    pattern: /[A-Za-z0-9_]*PRIVATE_KEY\s*=\s*["'`]?([^\s"'`#=][^\s"'`#]*)/g,
    group: 1,
    accept: (value) => !/^(\$|<|process\.|env\.|import\.)/.test(value),
  },
  {
    id: "mnemonic (12 or 24 lowercase words)",
    pattern:
      /(?:^|["'`=:]\s*)((?:[a-z]{3,8} ){23}[a-z]{3,8}|(?:[a-z]{3,8} ){11}[a-z]{3,8})(?=\s*$|["'`])/g,
    group: 1,
    trimLine: true,
    mask: (value) => `[masked ${value.split(" ").length} words]`,
  },
  { id: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { id: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: "sk- API key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { id: "Stripe live key", pattern: /\b[sr]k_live_[A-Za-z0-9]{16,}/g },
  { id: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: "PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    id: "secret in a NEXT_PUBLIC_ name",
    pattern: /\bNEXT_PUBLIC_[A-Z0-9_]*(?:PRIVATE|SECRET|MNEMONIC)[A-Z0-9_]*/g,
    mask: (value) => value,
  },
];

const maskValue = (value) => `${value.slice(0, 4)}...(${value.length} chars)`;

const findInLine = (line, path) => {
  if (line.includes(ALLOW_MARKER)) return [];
  const found = [];
  for (const rule of RULES) {
    if (rule.envOnly && !ENV_LIKE_FILE.test(path)) continue;
    const text = rule.trimLine ? line.trim() : line;
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[rule.group ?? 0];
      if (rule.accept && !rule.accept(value)) continue;
      found.push({ rule: rule.id, masked: (rule.mask ?? maskValue)(value) });
    }
  }
  return found;
};

const isSensitiveFile = (path) =>
  SENSITIVE_FILE.test(path) && !ENV_TEMPLATE.test(path);

const git = (args, cwd) => {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout;
};

const scanContent = (path, content, findings) => {
  if (SKIPPED_FILES.test(path) || content.includes(0)) return;
  content
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const finding of findInLine(line, path)) {
        findings.push({ ...finding, where: `${path}:${index + 1}` });
      }
    });
};

const scanFiles = (paths, read, findings) => {
  let scanned = 0;
  for (const path of paths) {
    if (isSensitiveFile(path)) {
      findings.push({
        rule: "sensitive file is tracked",
        masked: "[contents not shown]",
        where: path,
      });
    }
    const content = read(path);
    if (content) {
      scanContent(path, content, findings);
      scanned += 1;
    }
  }
  return `${scanned} files`;
};

const scanTracked = (root, findings) => {
  const paths = git(["ls-files", "-z"], root).toString("utf8").split("\0").filter(Boolean);
  return scanFiles(
    paths,
    (path) => {
      try {
        return readFileSync(join(root, path));
      } catch {
        return null; // Tracked but deleted from the working tree.
      }
    },
    findings,
  );
};

const scanStaged = (root, findings) => {
  const paths = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return scanFiles(paths, (path) => git(["show", `:${path}`], root), findings);
};

const scanHistory = (root, findings) => {
  const log = git(
    ["log", "--all", "-m", "-p", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=0"],
    root,
  ).toString("utf8");
  const seen = new Set();
  const commits = new Set();
  let commit = "";
  let path = "";
  let inDiff = false;

  const add = (finding, where) => {
    const key = `${finding.rule}|${where}|${finding.masked}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ ...finding, where });
    }
  };

  for (const line of log.split(/\r?\n/)) {
    const commitLine = /^commit ([0-9a-f]{40})/.exec(line);
    if (commitLine) {
      commit = commitLine[1].slice(0, 7);
      commits.add(commit);
      inDiff = false;
      path = "";
      continue;
    }
    const diffLine = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (diffLine) {
      path = diffLine[1];
      inDiff = true;
      if (isSensitiveFile(path)) {
        add({ rule: "sensitive file in history", masked: "[contents not shown]" }, `${commit} ${path}`);
      }
      continue;
    }
    if (!inDiff) {
      // Commit messages are indented by four spaces.
      if (line.startsWith("    ")) {
        for (const finding of findInLine(line, "")) add(finding, `${commit} (commit message)`);
      }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++") && !SKIPPED_FILES.test(path)) {
      for (const finding of findInLine(line.slice(1), path)) add(finding, `${commit} ${path}`);
    }
  }
  return `${commits.size} commits`;
};

const main = () => {
  const args = process.argv.slice(2);
  const known = ["--history", "--staged"];
  const unknown = args.filter((arg) => !known.includes(arg));
  if (unknown.length > 0 || args.length > 1) {
    console.error(`Usage: secret-scan.mjs [--history | --staged]`);
    return 2;
  }
  const mode = args[0]?.slice(2) ?? "tracked";
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).toString("utf8").trim();
  const findings = [];
  const scan = { history: scanHistory, staged: scanStaged, tracked: scanTracked }[mode];
  const scanned = scan(root, findings);

  for (const { rule, where, masked } of findings) {
    console.log(`FINDING  ${rule}  ${where}  ${masked}`);
  }
  console.log(`Secret scan (${mode}): scanned ${scanned}, ${findings.length} findings`);
  if (findings.length > 0) {
    console.log(`If a finding is a false positive, add "${ALLOW_MARKER}" to that line.`);
    console.log("If it is real, see docs/SECURITY.md, section: If a key leaks.");
  }
  return findings.length > 0 ? 1 : 0;
};

try {
  process.exitCode = main();
} catch (error) {
  console.error(`Secret scan could not run: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 2;
}
