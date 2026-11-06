import { createHash } from "node:crypto";
import { Inflate } from "fflate";
import type { UploadPolicy, UploadValidator } from "./types.js";

// Reads bytes only. Never executes, renders or writes an upload anywhere.
// Reasons never repeat the file or entry name, because those are attacker text.

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  maxBytes: 25 * 1024 * 1024,
  allowedExtensions: ["txt", "md", "json", "js", "ts", "tsx", "css", "html", "zip"],
  maxZipEntries: 1000,
  maxZipUncompressedBytes: 100 * 1024 * 1024,
  maxZipRatio: 100,
};

// Sent when a browser or client has no specific type for a file.
const GENERIC_MIMES = ["", "application/octet-stream"];

const CONTENT_RULES: Record<string, { kind: "text" | "zip"; mimes: string[] }> = {
  txt: { kind: "text", mimes: ["text/plain"] },
  md: { kind: "text", mimes: ["text/markdown", "text/x-markdown", "text/plain"] },
  json: { kind: "text", mimes: ["application/json", "text/json", "text/plain"] },
  js: { kind: "text", mimes: ["text/javascript", "application/javascript", "application/x-javascript", "text/plain"] },
  // Browsers often label .ts as an MPEG video stream.
  ts: { kind: "text", mimes: ["text/typescript", "application/typescript", "video/mp2t", "text/plain"] },
  tsx: { kind: "text", mimes: ["text/typescript", "application/typescript", "text/tsx", "text/plain"] },
  css: { kind: "text", mimes: ["text/css", "text/plain"] },
  html: { kind: "text", mimes: ["text/html"] },
  zip: { kind: "zip", mimes: ["application/zip", "application/x-zip-compressed", "multipart/x-zip"] },
};

// Inner name segments that make a name a double extension. Ordinary dotted
// names such as foo.test.ts and app.min.js are still allowed.
const EXTENSION_LIKE = new Set([
  ...Object.keys(CONTENT_RULES),
  "exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "sh", "vbs", "jar", "apk", "app",
  "htm", "xhtml", "svg", "php", "py", "rb", "pl", "tar", "gz", "rar", "7z",
]);

const MAGIC: { name: string; bytes: number[]; plain: string }[] = [
  { name: "zip", bytes: [0x50, 0x4b, 0x03, 0x04], plain: "a zip archive" },
  { name: "exe", bytes: [0x4d, 0x5a], plain: "a Windows program" },
  { name: "elf", bytes: [0x7f, 0x45, 0x4c, 0x46], plain: "a Linux program" },
  { name: "png", bytes: [0x89, 0x50, 0x4e, 0x47], plain: "a PNG image" },
  { name: "jpeg", bytes: [0xff, 0xd8, 0xff], plain: "a JPEG image" },
  { name: "pdf", bytes: [0x25, 0x50, 0x44, 0x46], plain: "a PDF document" },
  { name: "gzip", bytes: [0x1f, 0x8b], plain: "a compressed archive" },
];

const startsWith = (bytes: Uint8Array, prefix: number[]) =>
  prefix.every((value, index) => bytes[index] === value);

const REJECT_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const checkFileName = (name: unknown): string | null => {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) {
    return "The file name is missing or too long.";
  }
  if (REJECT_CONTROL_CHARS.test(name)) {
    return "The file name contains hidden characters. Please rename the file.";
  }
  if (/[/\\:]/.test(name) || name === "." || name === "..") {
    return "The file name must not contain folder paths. Please rename the file.";
  }
  if (name.startsWith(".") || /[. ]$/.test(name)) {
    return "The file name must not start with a dot or end with a dot or space. Please rename the file.";
  }
  const segments = name.toLowerCase().split(".");
  if (segments.slice(1, -1).some((segment) => EXTENSION_LIKE.has(segment))) {
    return "The file name has more than one file type in it, like report.html.exe. Please rename the file.";
  }
  return null;
};

const checkText = (bytes: Uint8Array): string | null => {
  const describe = () => {
    const match = MAGIC.find((magic) => startsWith(bytes, magic.bytes));
    return match ? `This file is actually ${match.plain}, not a text file.` : "This file is not a text file.";
  };
  if (bytes.includes(0)) return describe();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return `${describe()} Text files must be saved as UTF-8.`;
  }
  return null;
};

const ZIP_UNREADABLE = "This zip file is damaged or uses a format we do not support.";
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const MAX_U32 = 0xffffffff;
const MAX_U16 = 0xffff;
const INFLATE_CHUNK = 16 * 1024;

const checkEntryName = (name: string): string | null => {
  const path = name.endsWith("/") ? name.slice(0, -1) : name;
  if (
    name.length === 0 ||
    REJECT_CONTROL_CHARS.test(name) ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name) ||
    path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    return "This zip contains a file with an unsafe path, which could overwrite files elsewhere.";
  }
  return null;
};

/** Decompresses in memory to check the declared size. Nothing is kept or written. */
const inspectEntryData = (
  data: Uint8Array,
  method: number,
  declaredSize: number,
): { size: number; head: number[] } | null => {
  if (method === 0) return { size: data.length, head: [...data.subarray(0, 4)] };
  const head: number[] = [];
  let size = 0;
  const overLimit = new Error("over declared size");
  const inflate = new Inflate((chunk) => {
    for (let i = 0; i < chunk.length && head.length < 4; i += 1) head.push(chunk[i]!);
    size += chunk.length;
    if (size > declaredSize) throw overLimit;
  });
  try {
    // Small pieces, so a lying header cannot expand far before the limit stops it.
    for (let offset = 0; offset < data.length; offset += INFLATE_CHUNK) {
      const end = Math.min(offset + INFLATE_CHUNK, data.length);
      inflate.push(data.subarray(offset, end), end === data.length);
    }
    if (data.length === 0) inflate.push(new Uint8Array(0), true);
  } catch {
    return null;
  }
  return { size, head };
};

const checkZip = (bytes: Uint8Array, policy: UploadPolicy): string | null => {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return "This file is named .zip but is not a real zip file.";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let endOffset = -1;
  const earliest = Math.max(0, bytes.length - 22 - MAX_U16);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (
      view.getUint32(offset, true) === END_SIGNATURE &&
      view.getUint16(offset + 20, true) === bytes.length - offset - 22
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return ZIP_UNREADABLE;

  const diskFields = view.getUint16(endOffset + 4, true) + view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (
    diskFields !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === MAX_U16 ||
    directorySize === MAX_U32 ||
    directoryOffset === MAX_U32 ||
    directoryOffset + directorySize !== endOffset
  ) {
    return ZIP_UNREADABLE;
  }
  if (totalEntries === 0) return "This zip file is empty.";
  if (totalEntries > policy.maxZipEntries) {
    return `This zip has too many files. The limit is ${policy.maxZipEntries}.`;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seenNames = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  const entries: { dataStart: number; compressed: number; size: number; method: number; name: string }[] = [];
  let totalSize = 0;
  let cursor = directoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) return ZIP_UNREADABLE;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const attributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (nameBytes.length !== nameLength) return ZIP_UNREADABLE;
    cursor += 46 + nameLength + extraLength + commentLength;

    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      return "This zip contains a file with an unreadable name.";
    }
    const nameProblem = checkEntryName(name);
    if (nameProblem) return nameProblem;
    if (seenNames.has(name)) return "This zip contains two files with the same name.";
    seenNames.add(name);

    // Bit 0 and bit 6: encrypted data. Bit 13: encrypted central directory.
    if (flags & 0x2041) return "This zip is password protected. Please upload it without a password.";
    const fileType = (attributes >>> 16) & 0o170000;
    if (fileType === 0o120000 || attributes & 0x400) {
      return "This zip contains a shortcut link to another location, which is not allowed.";
    }
    if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
      return "This zip contains a special system file, which is not allowed.";
    }
    if (compressed === MAX_U32 || size === MAX_U32 || localOffset === MAX_U32) return ZIP_UNREADABLE;
    if (method !== 0 && method !== 8) return ZIP_UNREADABLE;
    if (name.toLowerCase().endsWith(".zip")) return "This zip contains another zip inside it, which is not allowed.";
    if (name.endsWith("/") && size !== 0) return ZIP_UNREADABLE;
    if (method === 0 && compressed !== size) return ZIP_UNREADABLE;

    totalSize += size;
    if (totalSize > policy.maxZipUncompressedBytes) {
      return "This zip would be too large once unpacked.";
    }
    if (size > 0 && (compressed === 0 || size / compressed > policy.maxZipRatio)) {
      return "This zip contains a file that expands far too much when unpacked, which is how zip bombs work.";
    }

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return ZIP_UNREADABLE;
    if (view.getUint16(localOffset + 6, true) & 0x41) {
      return "This zip is password protected. Please upload it without a password.";
    }
    if (view.getUint16(localOffset + 8, true) !== method) return ZIP_UNREADABLE;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    // Two different names for one file can fool whichever tool unpacks it later.
    if (localNameLength !== nameLength || !localName.every((value, i) => value === nameBytes[i])) {
      return ZIP_UNREADABLE;
    }
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > directoryOffset) return ZIP_UNREADABLE;
    ranges.push({ start: localOffset, end: dataStart + compressed });
    entries.push({ dataStart, compressed, size, method, name });
  }
  if (cursor !== endOffset) return ZIP_UNREADABLE;

  // Overlapping entries reuse the same bytes many times: another zip bomb trick.
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      return "This zip contains overlapping files, which is how zip bombs work.";
    }
  }

  // The sizes above are only what the zip claims. Check them against the data.
  for (const entry of entries) {
    const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    const actual = inspectEntryData(data, entry.method, entry.size);
    if (!actual || actual.size !== entry.size) {
      return "This zip contains a file whose real size does not match what the zip claims.";
    }
    if (startsWith(new Uint8Array(actual.head), [0x50, 0x4b, 0x03, 0x04])) {
      return "This zip contains another zip inside it, which is not allowed.";
    }
  }
  return null;
};

export const uploadValidator: UploadValidator = {
  async validate(file, policy) {
    const reject = (reason: string) => ({ ok: false as const, reason });
    try {
      const { name, claimedMime, bytes } = file;
      if (!(bytes instanceof Uint8Array)) return reject("The file could not be read.");
      if (bytes.length === 0) return reject("This file is empty.");
      if (bytes.length > policy.maxBytes) {
        return reject(`This file is too large. The limit is ${policy.maxBytes} bytes.`);
      }

      const nameProblem = checkFileName(name);
      if (nameProblem) return reject(nameProblem);

      const extension = name.toLowerCase().split(".").at(-1) ?? "";
      const allowed = policy.allowedExtensions.map((value) => value.toLowerCase());
      const rule = name.includes(".") && Object.hasOwn(CONTENT_RULES, extension) ? CONTENT_RULES[extension] : undefined;
      if (!rule || !allowed.includes(extension)) {
        return reject(`This file type is not allowed. Allowed types: ${allowed.join(", ")}.`);
      }

      const mime = String(claimedMime ?? "").split(";")[0]!.trim().toLowerCase();
      if (!GENERIC_MIMES.includes(mime) && !rule.mimes.includes(mime)) {
        return reject("The file type reported by your browser does not match the file name.");
      }

      const contentProblem = rule.kind === "zip" ? checkZip(bytes, policy) : checkText(bytes);
      if (contentProblem) return reject(contentProblem);

      return {
        ok: true,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        detectedType: rule.kind === "zip" ? "application/zip" : "text/plain; charset=utf-8",
        size: bytes.length,
      };
    } catch {
      // Out-of-bounds reads from a truncated or hostile file land here.
      return reject(ZIP_UNREADABLE);
    }
  },
};
