import { EndBehaviorType, VoiceConnectionStatus, entersState, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import prism from 'prism-media';

import { logger } from '../Config/Logger.Config.js';
import { cleanupWav, writeWav } from './AudioWriter.js';
import { buildFullTranscript, extractDecisionDraft, transcribeFile, type SpeakerTranscript } from './Transcriber.js';

export interface RecorderOptions {
  botToken: string;
  guildId: string;
  channelId: string;
  projectSlug: string;
  sessionTitle: string;
  apiUrl: string;
  apiToken: string;
}

export async function runRecorder(opts: RecorderOptions): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  const speakerChunks = new Map<string, Buffer[]>();
  const speakerNames = new Map<string, string>();

  await new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, async (c) => {
      logger.info(`Logged in as ${c.user.tag}`);

      const guild = await c.guilds.fetch(opts.guildId);
      const channel = await guild.channels.fetch(opts.channelId);

      if (!channel || !channel.isVoiceBased()) {
        reject(new Error(`Channel ${opts.channelId} is not a voice channel`));
        return;
      }

      const connection = joinVoiceChannel({
        channelId: opts.channelId,
        guildId: opts.guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      logger.info(`Joined voice channel: ${channel.name}`);
      logger.info('Recording... Press Ctrl+C to stop and process.');

      const receiver = connection.receiver;

      receiver.speaking.on('start', async (userId) => {
        if (speakerChunks.has(userId)) return;

        let username = userId;
        try {
          const member = await guild.members.fetch(userId);
          username = member.displayName;
        } catch { /* use userId as fallback */ }

        speakerNames.set(userId, username);
        speakerChunks.set(userId, []);
        logger.debug(`Started recording: ${username}`);

        const audioStream = receiver.subscribe(userId, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
        });

        const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
        audioStream.pipe(decoder);

        decoder.on('data', (chunk: Buffer) => {
          speakerChunks.get(userId)?.push(chunk);
        });

        decoder.on('end', () => {
          logger.debug(`Stream ended: ${username}`);
        });
      });

      // Keep alive until Ctrl+C
      process.once('SIGINT', async () => {
        logger.info('\nStopping recording...');
        connection.destroy();
        resolve();
      });
    });

    client.login(opts.botToken).catch(reject);
  });

  await client.destroy();

  // Process audio
  const speakers: SpeakerTranscript[] = [];
  const wavFiles: string[] = [];

  for (const [userId, chunks] of speakerChunks) {
    const username = speakerNames.get(userId) ?? userId;
    if (!chunks.length) continue;

    logger.info(`Transcribing ${username}...`);
    try {
      const wavPath = writeWav(username, chunks);
      wavFiles.push(wavPath);
      const text = await transcribeFile(wavPath);
      logger.info(`${username}: "${text.slice(0, 80)}..."`);
      speakers.push({ username, text });
    } catch (err) {
      logger.warn({ err, username }, 'transcription failed for speaker');
    }
  }

  // Cleanup temp files
  wavFiles.forEach(cleanupWav);

  if (!speakers.length) {
    logger.info('No audio recorded. Nothing to save.');
    return;
  }

  const fullTranscript = buildFullTranscript(speakers);
  logger.info('\n=== Full transcript ===\n' + fullTranscript.slice(0, 500) + (fullTranscript.length > 500 ? '...' : ''));

  // Extract decisions
  const content = await extractDecisionDraft(fullTranscript, opts.projectSlug, opts.sessionTitle);

  if (!content) {
    logger.info('No decision patterns detected in transcript. Saving raw transcript as draft.');
  }

  const draftContent = content ?? [
    `# Draft: ${opts.sessionTitle}`,
    '',
    '**Source:** Discord voice call',
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    '',
    '> No decision patterns detected — raw transcript for review.',
    '',
    '---',
    '',
    fullTranscript,
  ].join('\n');

  // Post draft to MemoryHub API
  const date = new Date().toISOString().slice(0, 10);

  const response = await fetch(`${opts.apiUrl}/api/projects/${opts.projectSlug}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: opts.sessionTitle,
      content: draftContent,
      date,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`Failed to save draft: ${response.status} — ${err}`);
    return;
  }

  const saved = await response.json() as { filename: string };
  logger.info(`Draft saved: "${saved.filename}" — check MemoryHub UI to review and confirm.`);
}
