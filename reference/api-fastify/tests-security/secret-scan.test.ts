import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real script in a temporary Git repo. Every "secret" is random and
// generated here, so nothing that looks like a secret is committed in this file.
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "..", "..", "scripts", "secret-scan.mjs");

let repo: string;

const git = (...args: string[]) => {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=", ...args],
    { cwd: repo, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
};

const scan = (...args: string[]) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" });
  return { code: result.status, output: result.stdout + result.stderr };
};

const write = (name: string, content: string) => writeFileSync(join(repo, name), content);
const commitAll = (message = "test commit") => {
  git("add", "-A");
  git("commit", "-q", "-m", message);
};
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const fakeMnemonic = (words: number) => Array.from({ length: words }, () => "fixture").join(" ");

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "trustora-scan-test-"));
  git("init", "-q");
  write("README.md", "clean file\n");
  commitAll("first commit");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const expectFinding = (name: string, content: string, rule: RegExp, secret: string) => {
  write(name, content);
  commitAll();
  const { code, output } = scan();
  expect(code, output).toBe(1);
  expect(output).toMatch(rule);
  expect(output).not.toContain(secret);
};

describe("secret scan: finds and masks", () => {
  it("a bare 64-hex key in any file", () => {
    const key = hex(32);
    expectFinding("config.ts", `const value = "${key}";\n`, /hex-64/, key);
  });

  it("a 0x 64-hex value in an env file", () => {
    const key = `0x${hex(32)}`;
    expectFinding(".env.local", `SOME_VALUE=${key}\n`, /0x-hex-64 in env file/, key);
  });

  it("a 0x 64-hex value assigned to a private key in code", () => {
    const key = `0x${hex(32)}`;
    expectFinding("deploy.ts", `const privateKey = "${key}";\n`, /assigned to a key or secret/, key);
  });

  it("a private key name with a non-empty value", () => {
    const value = hex(8);
    expectFinding("notes.md", `ARC_DEPLOYER_PRIVATE_KEY=${value}\n`, /PRIVATE_KEY with a value/, value);
  });

  it("a 12-word mnemonic", () => {
    const phrase = fakeMnemonic(12);
    expectFinding("notes.txt", `${phrase}\n`, /masked 12 words/, phrase);
  });

  it("a 24-word mnemonic in a quoted value", () => {
    const phrase = fakeMnemonic(24);
    expectFinding("seed.ts", `const seed = "${phrase}";\n`, /masked 24 words/, phrase);
  });

  it.each([
    ["GitHub", () => `ghp_${hex(20)}`],
    ["GitHub", () => `github_pat_${hex(20)}`],
    ["AWS", () => `AKIA${hex(8).toUpperCase()}`],
    ["sk-", () => `sk-${hex(20)}`],
    ["Slack", () => `xoxb-${hex(10)}`],
  ])("a %s API key", (rule, make) => {
    const key = make();
    expectFinding("client.ts", `const token = "${key}";\n`, new RegExp(rule), key);
  });

  it("a PEM private key header", () => {
    write("server.txt", `-----BEGIN ${"RSA "}PRIVATE KEY-----\n`);
    commitAll();
    expect(scan().code).toBe(1);
  });

  it("a secret-looking NEXT_PUBLIC_ name, even with no value", () => {
    write(".env.example", "NEXT_PUBLIC_ARC_DEPLOYER_PRIVATE_KEY=\n"); // secret-scan:allow
    commitAll();
    const { code, output } = scan();
    expect(code).toBe(1);
    expect(output).toMatch(/NEXT_PUBLIC_/);
  });

  it("a tracked sensitive file", () => {
    write("wallet.pem", "contents\n");
    commitAll();
    const { code, output } = scan();
    expect(code).toBe(1);
    expect(output).toMatch(/sensitive file is tracked.*wallet\.pem/);
  });
});

describe("secret scan: history", () => {
  it("finds a secret that was deleted from the current files", () => {
    const key = hex(32);
    write("oops.ts", `const value = "${key}";\n`);
    commitAll();
    rmSync(join(repo, "oops.ts"));
    commitAll("remove it");

    expect(scan().code).toBe(0);
    const { code, output } = scan("--history");
    expect(code, output).toBe(1);
    expect(output).toMatch(/oops\.ts/);
    expect(output).not.toContain(key);
  });

  it("finds a secret on another branch", () => {
    git("checkout", "-q", "-b", "other");
    const key = hex(32);
    write("other.ts", `const value = "${key}";\n`);
    commitAll();
    git("checkout", "-q", "-");
    expect(scan("--history").code).toBe(1);
  });

  it("finds a secret in a commit message", () => {
    const key = hex(32);
    git("commit", "-q", "--allow-empty", "-m", `key is ${key}`);
    const { code, output } = scan("--history");
    expect(code, output).toBe(1);
    expect(output).toMatch(/commit message/);
    expect(output).not.toContain(key);
  });

  it("baseline hides only the exact reviewed finding", () => {
    write("oops.ts", `const value = "${hex(32)}";\n`);
    commitAll();
    const first = scan("--history");
    expect(first.code, first.output).toBe(1);
    const reviewed = first.output
      .split("\n")
      .find((line) => line.startsWith("FINDING  "))!
      .replace("FINDING  ", "");
    write(".secret-scan-baseline", `# reviewed\n${reviewed}\n`);
    commitAll("add baseline");
    const second = scan("--history");
    expect(second.code, second.output).toBe(0);

    write("again.ts", `const value = "${hex(32)}";\n`);
    commitAll("a new secret is not hidden by the baseline");
    const third = scan("--history");
    expect(third.code, third.output).toBe(1);
    expect(third.output).toMatch(/again\.ts/);
  });

  it("this repository scans clean, in both modes", () => {
    const repoRoot = join(here, "..", "..", "..");
    for (const args of [[], ["--history"]]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(result.status, result.stdout).toBe(0);
    }
  });

  it("reports a clean history as clean", () => {
    const { code, output } = scan("--history");
    expect(code, output).toBe(0);
    expect(output).toMatch(/0 findings/);
  });
});

describe("secret scan: staged", () => {
  it("scans staged content, not the working copy", () => {
    const key = hex(32);
    write("a.ts", `const value = "${key}";\n`);
    git("add", "a.ts");
    write("a.ts", "clean now\n");
    const { code, output } = scan("--staged");
    expect(code, output).toBe(1);
    expect(output).not.toContain(key);
  });

  it("ignores secrets that are not staged", () => {
    write("a.ts", `const value = "${hex(32)}";\n`);
    expect(scan("--staged").code).toBe(0);
  });
});

describe("secret scan: does not flag", () => {
  it.each([
    ["empty env names", ".env.example", "ARC_DEPLOYER_PRIVATE_KEY=\nHEDERA_AGENT_PRIVATE_KEY=\nDATABASE_URL=\n"], // secret-scan:allow
    ["all-zero placeholder hash", "a.ts", `const zero = "0x${"0".repeat(64)}";\n`],
    ["a 0x hash in ordinary code", "a.ts", `const txHash = "0x${hex(32)}";\n`],
    ["an env reference", "a.ts", "const k = PRIVATE_KEY = process.env.KEY;\n"],
    ["a CI secret reference", "a.yml", "PRIVATE_KEY=${{ secrets.KEY }}\n"],
    ["an allowed line", "a.ts", `const h = "${hex(32)}"; // secret-scan:allow\n`],
    ["a public NEXT_PUBLIC_ name", ".env.example", "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=\n"],
    ["ordinary prose", "a.md", "This sentence has twelve words, with punctuation, and capital letters in it.\n"],
  ])("%s", (_label, name, content) => {
    write(name, content);
    commitAll();
    const { code, output } = scan();
    expect(code, output).toBe(0);
  });

  it("skips the lockfile", () => {
    write("pnpm-lock.yaml", `integrity: ${hex(32)}\n`);
    commitAll();
    expect(scan().code).toBe(0);
  });

  it("rejects an unknown flag instead of passing silently", () => {
    expect(scan("--nope").code).toBe(2);
  });
});
