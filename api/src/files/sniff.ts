// Upload content sniffing (docs/file-upload-rag.md §C.9: "never trust client mime;
// re-derive from magic bytes; reject executables by policy config"). Two jobs:
//   1) Security: detect compiled executables / installers by magic bytes AND a small
//      extension blocklist (for zip-wrapped ones magic can't see, e.g. .jar/.apk) so
//      they can be rejected before anything is stored or indexed.
//   2) Routing: re-derive a trustworthy content-type from magic bytes when the client
//      MIME is missing or generic (application/octet-stream), improving processor pick.
// Pure/zero-dep and total: any unrecognized input just returns the client MIME unchanged.

export interface SniffResult {
  /** Best-known content type: the magic-derived type when confident, else the client MIME. */
  mime: string;
  /** True when upload policy rejects this file (executable/installer). */
  blocked: boolean;
  /** Human-readable rejection reason (only when blocked). */
  reason?: string;
}

// Compiled-executable / loadable-binary extensions. Zip-wrapped ones (jar/apk/…)
// share PK magic with office docs, so we catch those by extension. Text scripts
// (.sh/.py/.ps1/…) are intentionally NOT here — users legitimately upload source
// to ask questions about it, and they carry no executable magic.
const EXECUTABLE_EXTS = new Set([
  'exe', 'dll', 'so', 'dylib', 'msi', 'msix', 'bat', 'cmd', 'com', 'scr', 'cpl',
  'jar', 'apk', 'class', 'wasm', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'app',
]);

/** Detect a compiled executable / loadable binary purely from magic bytes. */
function executableFromMagic(b: Buffer): string | null {
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return 'Windows executable (PE/DOS)'; // "MZ"
  if (b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'Linux executable (ELF)'; // 0x7F ELF
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d) return 'WebAssembly module'; // "\0asm"
  if (b.length >= 4) {
    const be = b.readUInt32BE(0);
    // Mach-O (32/64/reverse), Mach-O universal ("fat"), and Java .class all share
    // these headers; every one of them is executable/loadable → reject.
    if (
      be === 0xfeedface || be === 0xfeedfacf || be === 0xcefaedfe || be === 0xcffaedfe ||
      be === 0xcafebabe || be === 0xbebafeca
    ) {
      return be === 0xcafebabe ? 'executable (Mach-O universal / Java class)' : 'Mach-O executable';
    }
  }
  return null;
}

// Confident magic → MIME map used only to *correct* a missing/generic client MIME.
function mimeFromMagic(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === '8BPS') return 'image/vnd.adobe.photoshop';
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x21) return 'application/postscript'; // "%!"
  const head = b.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'application/xml';
  if (head.startsWith('{') || head.startsWith('[')) return 'application/json';
  return null;
}

const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

/**
 * Inspect an upload's first bytes. Rejects compiled executables/installers when
 * `blockExecutables` is on, and returns a corrected MIME when the client MIME is
 * missing/generic but the magic bytes are recognizable. Never throws.
 */
export function sniffUpload(
  buffer: Buffer,
  ext: string,
  clientMime: string,
  opts: { blockExecutables: boolean },
): SniffResult {
  const magic = buffer.subarray(0, 64);
  const client = (clientMime || '').toLowerCase();

  if (opts.blockExecutables) {
    const exe = executableFromMagic(magic);
    if (exe) return { mime: client || 'application/octet-stream', blocked: true, reason: `rejected ${exe}: executables are not accepted` };
    if (EXECUTABLE_EXTS.has(ext)) {
      return { mime: client || 'application/octet-stream', blocked: true, reason: `rejected .${ext} file: executables and installers are not accepted` };
    }
  }

  // Correct only when the client gave us nothing useful — never override a specific
  // client MIME (office/docx routing relies on the client type + extension).
  if (GENERIC_MIMES.has(client)) {
    const sniffed = mimeFromMagic(magic);
    if (sniffed) return { mime: sniffed, blocked: false };
  }
  return { mime: client || 'application/octet-stream', blocked: false };
}
