import iconv from "iconv-lite";
import { gunzipSync, inflateRawSync } from "node:zlib";

/** Extract the first file from a simple ZIP (some Cerberus "*.gz" are actually ZIP). */
function unzipFirstEntry(bytes: Buffer): Buffer {
  if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Not a ZIP archive");
  }
  const compression = bytes.readUInt16LE(8);
  const compSize = bytes.readUInt32LE(18);
  const nameLen = bytes.readUInt16LE(26);
  const extraLen = bytes.readUInt16LE(28);
  const dataStart = 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataStart, dataStart + compSize);
  if (compression === 0) return Buffer.from(compressed);
  if (compression === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${compression}`);
}

export function decodeFeedBytes(bytes: Buffer): string {
  let buf = bytes;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    buf = gunzipSync(bytes);
  } else if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    buf = unzipFirstEntry(bytes);
  }
  // Many IL Stores/Price feeds are UTF-16 with BOM. Mis-decoding as UTF-8 produces
  // null-byte junk that makes fast-xml-parser hit "Maximum nested tags exceeded".
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return iconv.decode(buf, "utf16-be").replace(/^\uFEFF/, "");
  }
  // UTF-16 LE without BOM: ASCII tags appear as X\0Y\0…
  if (
    buf.length >= 8 &&
    buf[0] === 0x3c &&
    buf[1] === 0x00 &&
    buf[2] !== 0x00 &&
    buf[3] === 0x00
  ) {
    return buf.toString("utf16le").replace(/^\uFEFF/, "");
  }
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD") && /<\?xml|<[A-Za-z]/.test(utf8)) {
    return utf8.replace(/^\uFEFF/, "");
  }
  return iconv.decode(buf, "windows-1255");
}
