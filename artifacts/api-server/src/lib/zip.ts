/**
 * Tiny dependency-free ZIP writer (deflate, method 8) — enough to bundle a project's files + assets
 * into one downloadable archive. No external library: local file headers + central directory + EOCD,
 * with real DEFLATE compression via Node's zlib and a standard CRC-32.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Buffer };

/** Build a ZIP archive (Buffer) from the given entries. */
export function makeZip(entries: ZipEntry[]): Buffer {
  const DOS_TIME = 0;      // 00:00:00
  const DOS_DATE = 0x21;   // 1980-01-01 (earliest valid ZIP date)
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name.replace(/^\/+/, ""), "utf8");
    const data = e.data;
    const crc = crc32(data);
    const comp = deflateRawSync(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);       // version needed
    lh.writeUInt16LE(0x0800, 6);   // flags: bit 11 = UTF-8 names
    lh.writeUInt16LE(8, 8);        // method: deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);       // extra length
    local.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);       // version made by
    ch.writeUInt16LE(20, 6);       // version needed
    ch.writeUInt16LE(0x0800, 8);   // flags
    ch.writeUInt16LE(8, 10);       // method
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);       // extra length
    ch.writeUInt16LE(0, 32);       // comment length
    ch.writeUInt16LE(0, 34);       // disk number
    ch.writeUInt16LE(0, 36);       // internal attrs
    ch.writeUInt32LE(0, 38);       // external attrs
    ch.writeUInt32LE(offset, 42);  // local header offset
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);   // central dir offset
  eocd.writeUInt16LE(0, 18);        // comment length
  return Buffer.concat([...local, centralBuf, eocd]);
}
