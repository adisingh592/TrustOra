import { createHash } from "node:crypto";
import { DEFAULT_UPLOAD_POLICY, uploadValidator } from "@trustora/security";
import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";

// Every attack file is generated here at run time. No binary fixtures are committed.
const policy = DEFAULT_UPLOAD_POLICY;
const text = (value: string) => new TextEncoder().encode(value);

const validate = (
  name: string,
  bytes: Uint8Array,
  claimedMime = "",
  usePolicy = policy,
) => uploadValidator.validate({ name, claimedMime, bytes }, usePolicy);

const expectRejected = async (result: ReturnType<typeof validate>, reason: RegExp) => {
  const value = await result;
  expect(value.ok).toBe(false);
  if (!value.ok) expect(value.reason).toMatch(reason);
};

const validZip = (entries: Zippable = { "readme.txt": strToU8("hello") }) => zipSync(entries);

/** Finds each central directory record in a zip and lets the test change it. */
const patchCentral = (
  zip: Uint8Array,
  patch: (view: DataView, offset: number) => void,
) => {
  const copy = zip.slice();
  const view = new DataView(copy.buffer);
  for (let offset = 0; offset + 4 <= copy.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) patch(view, offset);
  }
  return copy;
};

const validatedZip = (zip: Uint8Array, usePolicy = policy) =>
  validate("work.zip", zip, "application/zip", usePolicy);

describe("size", () => {
  it("rejects an empty file", async () => {
    await expectRejected(validate("a.txt", new Uint8Array(0)), /empty/);
  });

  it("rejects an oversized file", async () => {
    const small = { ...policy, maxBytes: 10 };
    await expectRejected(validate("a.txt", text("x".repeat(11)), "", small), /too large/);
  });

  it("accepts a file exactly at the limit", async () => {
    const small = { ...policy, maxBytes: 10 };
    expect((await validate("a.txt", text("x".repeat(10)), "", small)).ok).toBe(true);
  });
});

describe("file names", () => {
  it.each([
    ["a.exe"],
    ["a.pdf"],
    ["a.svg"],
    ["noextension"],
    ["a.constructor"],
    ["a.__proto__"],
  ])("rejects a file type that is not allowed: %s", async (name) => {
    await expectRejected(validate(name, text("hello")), /not allowed/);
  });

  it("honours a narrower allowlist", async () => {
    const onlyTxt = { ...policy, allowedExtensions: ["txt"] };
    await expectRejected(validate("a.md", text("hello"), "", onlyTxt), /not allowed/);
  });

  it.each([["a.html.exe"], ["a.exe.txt"], ["a.html.txt"], ["a.js.md"], ["A.EXE.TXT"]])(
    "rejects a double extension: %s",
    async (name) => {
      await expectRejected(validate(name, text("hello")), /not allowed|more than one file type/);
    },
  );

  it.each([["foo.test.ts"], ["app.min.js"], ["index.d.ts"], ["tsconfig.base.json"], ["READ.ME.txt"]])(
    "accepts an ordinary dotted name: %s",
    async (name) => {
      expect((await validate(name, text("hello"))).ok).toBe(true);
    },
  );

  it.each([
    ["../evil.txt"],
    ["..\\evil.txt"],
    ["/etc/passwd.txt"],
    ["C:\\evil.txt"],
    ["folder/evil.txt"],
    ["a.txt:hidden.exe"],
    [".."],
  ])("rejects path traversal in the name: %s", async (name) => {
    await expectRejected(validate(name, text("hello")), /folder paths/);
  });

  it.each([
    ["a\u0000.txt"],
    ["a\n.txt"],
    ["a\u007f.txt"],
  ])("rejects hidden characters in the name", async (name) => {
    await expectRejected(validate(name, text("hello")), /hidden characters/);
  });

  it.each([[".env"], [".htaccess.txt"], ["a.txt."], ["a.txt "]])(
    "rejects a leading dot or trailing dot or space: %s",
    async (name) => {
      await expectRejected(validate(name, text("hello")), /dot/);
    },
  );

  it("rejects an empty or very long name", async () => {
    await expectRejected(validate("", text("hello")), /missing or too long/);
    await expectRejected(validate(`${"a".repeat(300)}.txt`, text("hello")), /missing or too long/);
  });
});

describe("content versus claimed type", () => {
  it("rejects a .exe renamed .txt", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    await expectRejected(validate("setup.txt", exe), /Windows program/);
  });

  it("rejects a PNG renamed .txt", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expectRejected(validate("a.txt", png), /PNG image/);
  });

  it("rejects a zip renamed .txt", async () => {
    await expectRejected(validate("a.txt", validZip()), /zip archive/);
  });

  it("rejects HTML with a claimed MIME of image/png", async () => {
    await expectRejected(validate("a.html", text("<html></html>"), "image/png"), /does not match/);
  });

  it("rejects a claimed MIME of text/html for a .txt", async () => {
    await expectRejected(validate("a.txt", text("hello"), "text/html"), /does not match/);
  });

  it("rejects text with a NUL byte", async () => {
    await expectRejected(validate("a.txt", new Uint8Array([0x68, 0x00, 0x69])), /not a text file/);
  });

  it("rejects text that is not valid UTF-8", async () => {
    await expectRejected(validate("a.txt", new Uint8Array([0x68, 0xc3, 0x28])), /UTF-8/);
  });

  it("rejects a .zip that is not a zip", async () => {
    await expectRejected(validate("a.zip", text("not a zip")), /not a real zip/);
  });

  it.each([
    ["text/plain; charset=utf-8"],
    ["TEXT/PLAIN"],
    [""],
    ["application/octet-stream"],
  ])("accepts a matching or generic MIME: %s", async (mime) => {
    expect((await validate("a.txt", text("hello"), mime)).ok).toBe(true);
  });
});

describe("zip attacks", () => {
  it.each([
    ["parent folder", "../evil.txt"],
    ["nested parent folder", "ok/../../evil.txt"],
    ["absolute path", "/etc/evil.txt"],
    ["backslashes", "..\\evil.txt"],
    ["backslash folder", "folder\\evil.txt"],
    ["drive letter", "C:/evil.txt"],
    ["control character", "evil\u0001.txt"],
  ])("rejects zip-slip entry: %s", async (_label, entry) => {
    await expectRejected(validatedZip(validZip({ [entry]: strToU8("x") })), /unsafe path/);
  });

  it("rejects too many entries", async () => {
    const entries: Zippable = {};
    for (let i = 0; i < 6; i += 1) entries[`f${i}.txt`] = strToU8("x");
    await expectRejected(validatedZip(validZip(entries), { ...policy, maxZipEntries: 5 }), /too many files/);
  });

  it("accepts exactly the maximum number of entries", async () => {
    const entries: Zippable = {};
    for (let i = 0; i < 5; i += 1) entries[`f${i}.txt`] = strToU8("x");
    expect((await validatedZip(validZip(entries), { ...policy, maxZipEntries: 5 })).ok).toBe(true);
  });

  it("rejects a high-ratio zip entry", async () => {
    const zip = validZip({ "zeros.txt": [new Uint8Array(100_000), { level: 9 }] });
    await expectRejected(validatedZip(zip, { ...policy, maxZipRatio: 10 }), /expands far too much/);
  });

  it("rejects total uncompressed size above the limit", async () => {
    const zip = validZip({
      "a.txt": [strToU8("a".repeat(600)), { level: 0 }],
      "b.txt": [strToU8("b".repeat(600)), { level: 0 }],
    });
    await expectRejected(
      validatedZip(zip, { ...policy, maxZipUncompressedBytes: 1000 }),
      /too large once unpacked/,
    );
  });

  it("rejects a zip that lies about a small size to hide a large one", async () => {
    const zip = validZip({ "big.txt": [new Uint8Array(5_000_000).fill(65), { level: 9 }] });
    const lying = patchCentral(zip, (view, offset) => {
      view.setUint32(offset + 24, view.getUint32(offset + 20, true), true);
    });
    await expectRejected(validatedZip(lying), /real size does not match/);
  });

  it("rejects a nested zip, by name, even when its content is not a zip", async () => {
    const zip = validZip({ "inner.zip": strToU8("not really a zip") });
    await expectRejected(validatedZip(zip), /another zip/);
  });

  it("rejects two entries with the same name", async () => {
    // fflate cannot produce this, so build a stored zip by hand.
    const name = strToU8("same.txt");
    const data = strToU8("x");
    const local = () => {
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);
      header.setUint32(18, data.length, true);
      header.setUint32(22, data.length, true);
      header.setUint16(26, name.length, true);
      return [...new Uint8Array(header.buffer), ...name, ...data];
    };
    const central = (offset: number) => {
      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint32(20, data.length, true);
      header.setUint32(24, data.length, true);
      header.setUint16(28, name.length, true);
      header.setUint32(42, offset, true);
      return [...new Uint8Array(header.buffer), ...name];
    };
    const body = [...local(), ...local()];
    const directory = [...central(0), ...central(body.length / 2)];
    const footer = new DataView(new ArrayBuffer(22));
    footer.setUint32(0, 0x06054b50, true);
    footer.setUint16(8, 2, true);
    footer.setUint16(10, 2, true);
    footer.setUint32(12, directory.length, true);
    footer.setUint32(16, body.length, true);
    const zip = new Uint8Array([...body, ...directory, ...new Uint8Array(footer.buffer)]);
    await expectRejected(validatedZip(zip), /same name/);
  });

  it("rejects a nested zip hidden under another name, stored", async () => {
    const zip = validZip({ "inner.txt": [validZip(), { level: 0 }] });
    await expectRejected(validatedZip(zip), /another zip/);
  });

  it("rejects a nested zip hidden under another name, compressed", async () => {
    const zip = validZip({ "inner.txt": [validZip(), { level: 9 }] });
    await expectRejected(validatedZip(zip), /another zip/);
  });

  it("rejects an encrypted entry", async () => {
    const encrypted = patchCentral(validZip(), (view, offset) => {
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 0x1, true);
    });
    await expectRejected(validatedZip(encrypted), /password protected/);
  });

  it("rejects a symlink", async () => {
    const zip = validZip({
      link: [strToU8("/etc/passwd"), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
    });
    await expectRejected(validatedZip(zip), /shortcut link/);
  });

  it("rejects a special system file", async () => {
    const zip = validZip({
      dev: [strToU8("x"), { os: 3, attrs: (0o020666 << 16) >>> 0 }],
    });
    await expectRejected(validatedZip(zip), /special system file/);
  });

  it("rejects a name that differs between the two zip headers", async () => {
    const zip = validZip({ "safe.txt": strToU8("hello") });
    const copy = zip.slice();
    // The central directory name comes after the local header's copy.
    const view = new DataView(copy.buffer);
    for (let offset = 0; offset + 4 <= copy.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) copy[offset + 46] = 0x74;
    }
    await expectRejected(validatedZip(copy), /damaged/);
  });

  it("rejects overlapping entries, the trick behind non-recursive zip bombs", async () => {
    // Entry a.txt stores a whole zip, and a second directory record then points
    // inside it, so the same bytes count as both a.txt and b.txt.
    const inner = zipSync({ "b.txt": [strToU8("hello"), { level: 0 }] });
    const outer = zipSync({ "a.txt": [inner, { level: 0 }] });
    const view = new DataView(outer.buffer, outer.byteOffset, outer.byteLength);
    const end = outer.length - 22;
    const outerDirectory = view.getUint32(end + 16, true);
    const innerLocal = 30 + "a.txt".length;
    const innerView = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
    const innerDirectory = innerView.getUint32(inner.length - 22 + 16, true);
    const innerRecord = inner.slice(innerDirectory, inner.length - 22);
    new DataView(innerRecord.buffer).setUint32(42, innerLocal, true);
    const outerRecord = outer.slice(outerDirectory, end);
    const footer = outer.slice(end);
    const footerView = new DataView(footer.buffer);
    footerView.setUint16(8, 2, true);
    footerView.setUint16(10, 2, true);
    footerView.setUint32(12, outerRecord.length + innerRecord.length, true);
    const overlapping = new Uint8Array([
      ...outer.subarray(0, outerDirectory),
      ...outerRecord,
      ...innerRecord,
      ...footer,
    ]);
    await expectRejected(validatedZip(overlapping), /overlapping/);
  });

  it("rejects a truncated zip without throwing", async () => {
    const zip = validZip();
    await expectRejected(validatedZip(zip.subarray(0, zip.length - 5)), /damaged/);
  });

  it("rejects data prepended and appended around a zip", async () => {
    const zip = validZip();
    const appended = new Uint8Array([...zip, 1, 2, 3]);
    await expectRejected(validatedZip(appended), /damaged/);
    const prepended = new Uint8Array([0x4d, 0x5a, ...zip]);
    await expectRejected(validatedZip(prepended), /not a real zip/);
  });

  it("does not repeat attacker-controlled names in the reason", async () => {
    const value = await validatedZip(validZip({ "../<script>alert(1)</script>.txt": strToU8("x") }));
    expect(value.ok).toBe(false);
    if (!value.ok) expect(value.reason).not.toContain("script");
  });

  it.each(Array.from({ length: 40 }, (_, seed) => [seed]))(
    "never throws on a corrupted zip (seed %i)",
    async (seed) => {
      const copy = validZip({ "a.txt": strToU8("hello"), "b.txt": strToU8("world") }).slice();
      for (let i = 0; i < 8; i += 1) {
        copy[(seed * 31 + i * 97) % copy.length] = (seed * 17 + i * 53) % 256;
      }
      await expect(validatedZip(copy)).resolves.toHaveProperty("ok");
    },
  );
});

describe("accepted files", () => {
  it("accepts a valid text file with the correct hash and size", async () => {
    const value = await validate("notes.txt", text("hello"), "text/plain");
    expect(value).toEqual({
      ok: true,
      // Published SHA-256 test value for "hello". secret-scan:allow
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      detectedType: "text/plain; charset=utf-8",
      size: 5,
    });
  });

  it("accepts a valid small zip and hashes the exact uploaded bytes", async () => {
    const zip = validZip({ "src/index.ts": strToU8("export {};"), "src/": new Uint8Array(0) });
    const value = await validatedZip(zip);
    expect(value).toEqual({
      ok: true,
      sha256: createHash("sha256").update(zip).digest("hex"),
      detectedType: "application/zip",
      size: zip.length,
    });
  });

  it("hashes correctly when the bytes are a view into a larger buffer", async () => {
    const buffer = text("xxhelloxx");
    const value = await validate("a.txt", buffer.subarray(2, 7));
    expect(value).toMatchObject({ ok: true, size: 5 });
    if (value.ok) expect(value.sha256).toBe(createHash("sha256").update("hello").digest("hex"));
  });

  it.each([
    ["txt", "text/plain"],
    ["md", "text/markdown"],
    ["json", "application/json"],
    ["js", "text/javascript"],
    ["ts", "video/mp2t"],
    ["tsx", "text/plain"],
    ["css", "text/css"],
    ["html", "text/html"],
  ])("accepts every default text type: %s", async (extension, mime) => {
    expect((await validate(`file.${extension}`, text("hello"), mime)).ok).toBe(true);
  });

  it("accepts UTF-8 with non-English text", async () => {
    expect((await validate("a.txt", text("नमस्ते"))).ok).toBe(true);
  });
});
