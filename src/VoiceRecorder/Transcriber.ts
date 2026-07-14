import fs from 'node:fs';
import FormData from 'node:stream';

import { env } from '../Config/Env.Config.js';
import { extractAdr } from '../Ingestion/Extractor.js';
import type { IngestItem } from '../Ingestion/types.js';

export interface SpeakerTranscript {
  username: string;
  text: string;
}

export async function transcribeFile(wavPath: string): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const formData = new (await import('node:stream')).PassThrough();
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;

  const fileBuffer = fs.readFileSync(wavPath);
  const filename = wavPath.split('/').pop() ?? 'audio.wav';

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\npt\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API ${response.status}: ${err}`);
  }

  const data = await response.json() as { text: string };
  return data.text.trim();
}

export function buildFullTranscript(speakers: SpeakerTranscript[]): string {
  return speakers
    .filter((s) => s.text.length > 0)
    .map((s) => `${s.username}: ${s.text}`)
    .join('\n\n');
}

export async function extractDecisionDraft(
  transcript: string,
  projectSlug: string,
  sessionTitle: string,
): Promise<string | null> {
  const item: IngestItem = {
    id: `voice:${Date.now()}`,
    source: 'discord',
    projectSlug,
    title: sessionTitle,
    body: transcript,
    createdAt: new Date().toISOString(),
  };
  return extractAdr(item);
}
