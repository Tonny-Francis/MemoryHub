import fs from 'node:fs';
import FormData from 'node:stream';

import { env } from '../Config/Env.Config.js';
import { extractAdr } from '../Ingestion/Extractor.js';
import type { IngestItem } from '../Ingestion/types.js';

export interface SpeakerTranscript {
  username: string;
  text: string;
}

function buildMultipartBody(wavPath: string, model: string): { body: Buffer; boundary: string } {
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
  const fileBuffer = fs.readFileSync(wavPath);
  const filename = wavPath.split('/').pop() ?? 'audio.wav';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\npt\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

export async function transcribeFile(wavPath: string): Promise<string> {
  if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY) {
    throw new Error('Set OPENAI_API_KEY or GROQ_API_KEY to enable transcription');
  }

  const useGroq = !env.OPENAI_API_KEY && !!env.GROQ_API_KEY;
  const apiUrl = useGroq
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const apiKey = useGroq ? env.GROQ_API_KEY! : env.OPENAI_API_KEY!;
  const model = useGroq ? 'whisper-large-v3' : 'whisper-1';

  const { body, boundary } = buildMultipartBody(wavPath, model);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Transcription API ${response.status}: ${err}`);
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
