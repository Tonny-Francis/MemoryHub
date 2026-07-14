import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Discord sends 48kHz stereo 16-bit PCM after Opus decode.
// Whisper works best at 16kHz mono — downsample 3:1 and mix channels.

const SAMPLE_RATE_IN = 48000;
const SAMPLE_RATE_OUT = 16000;
const CHANNELS_IN = 2;
const STEP = SAMPLE_RATE_IN / SAMPLE_RATE_OUT; // 3

function downsampleMono(pcm: Buffer): Buffer {
  const samplesIn = Math.floor(pcm.length / (2 * CHANNELS_IN));
  const samplesOut = Math.floor(samplesIn / STEP);
  const out = Buffer.alloc(samplesOut * 2);

  for (let i = 0; i < samplesOut; i++) {
    const srcIdx = Math.floor(i * STEP) * CHANNELS_IN * 2;
    const l = pcm.readInt16LE(srcIdx);
    const r = pcm.readInt16LE(srcIdx + 2);
    const mono = Math.max(-32768, Math.min(32767, (l + r) >> 1));
    out.writeInt16LE(mono, i * 2);
  }

  return out;
}

function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataBytes + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);      // PCM
  header.writeUInt16LE(1, 22);      // mono
  header.writeUInt32LE(SAMPLE_RATE_OUT, 24);
  header.writeUInt32LE(SAMPLE_RATE_OUT * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);      // block align
  header.writeUInt16LE(16, 34);     // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export function writeWav(username: string, chunks: Buffer[]): string {
  const pcm = Buffer.concat(chunks);
  const mono16 = downsampleMono(pcm);
  const filePath = path.join(os.tmpdir(), `memoryhub-${username}-${Date.now()}.wav`);
  const fd = fs.openSync(filePath, 'w');
  fs.writeSync(fd, wavHeader(mono16.length));
  fs.writeSync(fd, mono16);
  fs.closeSync(fd);
  return filePath;
}

export function cleanupWav(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}
