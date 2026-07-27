import { describe, it, expect } from 'vitest';
import { sniffUpload } from '../src/files/sniff.js';

const on = { blockExecutables: true };
const off = { blockExecutables: false };

function buf(bytes: number[] | string, pad = 0): Buffer {
  const head = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes);
  return pad > 0 ? Buffer.concat([head, Buffer.alloc(pad)]) : head;
}

describe('sniffUpload — executable rejection (C.9)', () => {
  it('blocks Windows PE ("MZ")', () => {
    const r = sniffUpload(buf([0x4d, 0x5a, 0x90, 0x00], 32), 'exe', 'application/octet-stream', on);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/windows/i);
  });

  it('blocks ELF binaries', () => {
    const r = sniffUpload(buf([0x7f, 0x45, 0x4c, 0x46], 32), '', 'application/octet-stream', on);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/elf/i);
  });

  it('blocks Mach-O / Java class (CAFEBABE)', () => {
    const r = sniffUpload(buf([0xca, 0xfe, 0xba, 0xbe], 32), '', 'application/octet-stream', on);
    expect(r.blocked).toBe(true);
  });

  it('blocks WebAssembly modules', () => {
    const r = sniffUpload(buf([0x00, 0x61, 0x73, 0x6d], 32), 'wasm', 'application/octet-stream', on);
    expect(r.blocked).toBe(true);
  });

  it('blocks zip-wrapped executables by extension (.jar/.apk share PK magic)', () => {
    const jar = sniffUpload(buf('PK\x03\x04rest'), 'jar', 'application/java-archive', on);
    expect(jar.blocked).toBe(true);
    const apk = sniffUpload(buf('PK\x03\x04rest'), 'apk', 'application/vnd.android.package-archive', on);
    expect(apk.blocked).toBe(true);
  });

  it('honors policy=off (nothing blocked)', () => {
    const r = sniffUpload(buf([0x4d, 0x5a, 0x90, 0x00], 32), 'exe', 'application/octet-stream', off);
    expect(r.blocked).toBe(false);
  });

  it('does NOT block legitimate documents', () => {
    expect(sniffUpload(buf('%PDF-1.7'), 'pdf', 'application/pdf', on).blocked).toBe(false);
    expect(sniffUpload(buf('PK\x03\x04'), 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', on).blocked).toBe(false);
    expect(sniffUpload(buf('# hello'), 'md', 'text/markdown', on).blocked).toBe(false);
  });

  it('does NOT block text scripts users may want analyzed', () => {
    expect(sniffUpload(buf('#!/bin/sh\necho hi'), 'sh', 'text/x-shellscript', on).blocked).toBe(false);
    expect(sniffUpload(buf('print("hi")'), 'py', 'text/x-python', on).blocked).toBe(false);
  });
});

describe('sniffUpload — MIME correction from magic bytes', () => {
  it('corrects a generic client MIME using magic bytes', () => {
    expect(sniffUpload(buf('%PDF-1.4'), 'pdf', 'application/octet-stream', on).mime).toBe('application/pdf');
    expect(sniffUpload(buf([0x89, 0x50, 0x4e, 0x47], 8), 'png', '', on).mime).toBe('image/png');
    expect(sniffUpload(buf([0xff, 0xd8, 0xff, 0xe0], 8), 'jpg', 'application/octet-stream', on).mime).toBe('image/jpeg');
    expect(sniffUpload(buf('GIF89a'), 'gif', 'binary/octet-stream', on).mime).toBe('image/gif');
  });

  it('never overrides a specific client MIME (office routing relies on it)', () => {
    const office = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(sniffUpload(buf('PK\x03\x04'), 'xlsx', office, on).mime).toBe(office);
  });

  it('falls back to octet-stream when nothing is recognizable', () => {
    expect(sniffUpload(buf([0x00, 0x01, 0x02, 0x03]), 'zzz', '', on).mime).toBe('application/octet-stream');
  });
});
