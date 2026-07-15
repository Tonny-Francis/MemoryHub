import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from '@discordjs/voice';
import prism from 'prism-media';
import 'dotenv/config';
import pino from 'pino';

const logger = pino({ level: 'info' });

const env = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  MEMORYHUB_API_URL: process.env.MEMORYHUB_API_URL,
  MEMORYHUB_EMAIL: process.env.MEMORYHUB_EMAIL,
  MEMORYHUB_PASSWORD: process.env.MEMORYHUB_PASSWORD,
};

let apiToken: string | null = null;

async function getApiToken(): Promise<string | null> {
  if (apiToken) return apiToken;
  if (!env.MEMORYHUB_API_URL || !env.MEMORYHUB_EMAIL || !env.MEMORYHUB_PASSWORD) return null;
  try {
    const res = await fetch(`${env.MEMORYHUB_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.MEMORYHUB_EMAIL, password: env.MEMORYHUB_PASSWORD }),
    });
    if (!res.ok) { logger.warn('MemoryHub login failed'); return null; }
    const data = await res.json() as { accessToken: string };
    apiToken = data.accessToken;
    logger.info('Authenticated with MemoryHub API');
    return apiToken;
  } catch (err) {
    logger.warn({ err }, 'Could not reach MemoryHub API');
    return null;
  }
}

import { cleanupWav, writeWav } from './VoiceRecorder/AudioWriter.js';
import { buildFullTranscript, extractDecisionDraft, transcribeFile, type SpeakerTranscript } from './VoiceRecorder/Transcriber.js';

if (!env.DISCORD_BOT_TOKEN) {
  logger.error('DISCORD_BOT_TOKEN is not set — exiting');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel and start transcribing')
    .addStringOption((o) =>
      o.setName('project').setDescription('MemoryHub project slug').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('Session title for the draft').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Stop transcribing and save draft to MemoryHub'),
  new SlashCommandBuilder()
    .setName('decision')
    .setDescription('Log a confirmed decision to MemoryHub'),
  new SlashCommandBuilder()
    .setName('draft')
    .setDescription('Log a draft (pending review) to MemoryHub'),
].map((c) => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

interface Session {
  connection: VoiceConnection;
  speakerChunks: Map<string, Buffer[]>;
  speakerNames: Map<string, string>;
  projectSlug: string;
  sessionTitle: string;
  guildId: string;
}

const sessions = new Map<string, Session>();

async function registerCommands(clientId: string) {
  const rest = new REST().setToken(env.DISCORD_BOT_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info('Slash commands registered globally');
  } catch (err) {
    logger.warn({ err }, 'Failed to register slash commands');
  }
}

function buildEntryModal(customId: string, title: string): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('project')
        .setLabel('Project slug')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('my-project')
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Short description of the decision')
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Content (markdown)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('## Context\n...\n## Decision\n...')
        .setRequired(true),
    ),
  );
  return modal;
}

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const project = interaction.fields.getTextInputValue('project').trim();
  const title = interaction.fields.getTextInputValue('title').trim();
  const content = interaction.fields.getTextInputValue('content').trim();
  const date = new Date().toISOString().slice(0, 10);
  const isDraft = interaction.customId === 'draft-modal';

  const token = await getApiToken();
  if (!env.MEMORYHUB_API_URL || !token) {
    await interaction.editReply('MemoryHub API not configured — set `MEMORYHUB_API_URL`, `MEMORYHUB_EMAIL`, and `MEMORYHUB_PASSWORD`.');
    return;
  }

  const endpoint = isDraft
    ? `${env.MEMORYHUB_API_URL}/api/projects/${project}/drafts`
    : `${env.MEMORYHUB_API_URL}/api/projects/${project}/decisions`;

  const body = isDraft
    ? { topic: title, content, date }
    : { topic: title, content, date };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      await interaction.editReply(`Failed: ${err.error ?? `HTTP ${res.status}`}`);
      return;
    }

    const saved = await res.json() as { filename: string };
    const label = isDraft ? 'Draft' : 'Decision';
    await interaction.editReply(`${label} saved: \`${saved.filename}\``);
  } catch (err) {
    logger.error({ err }, 'Failed to save to MemoryHub');
    await interaction.editReply('Could not reach MemoryHub API.');
  }
}

async function handleJoin(interaction: ChatInputCommandInteraction) {
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  const voiceChannel = member?.voice.channel;

  if (!voiceChannel || !voiceChannel.isVoiceBased()) {
    await interaction.reply({ content: 'You must be in a voice channel first.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId!;

  if (sessions.has(guildId)) {
    await interaction.reply({ content: 'Already recording in this server. Use `/leave` first.', ephemeral: true });
    return;
  }

  const projectSlug = interaction.options.getString('project', true);
  const sessionTitle = interaction.options.getString('title') ?? `Voice session ${new Date().toISOString().slice(0, 16)}`;

  await interaction.reply(`Joining **${voiceChannel.name}** and recording for project \`${projectSlug}\`...`);

  const guild = interaction.guild as Guild;
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  const session: Session = {
    connection,
    speakerChunks: new Map(),
    speakerNames: new Map(),
    projectSlug,
    sessionTitle,
    guildId,
  };

  const receiver = connection.receiver;

  receiver.speaking.on('start', async (userId) => {
    if (session.speakerChunks.has(userId)) return;

    let username = userId;
    try {
      const m = await guild.members.fetch(userId);
      username = m.displayName;
    } catch { /* fallback to userId */ }

    session.speakerNames.set(userId, username);
    session.speakerChunks.set(userId, []);
    logger.debug(`Recording started: ${username}`);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
    });

    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
    audioStream.pipe(decoder);

    decoder.on('data', (chunk: Buffer) => {
      session.speakerChunks.get(userId)?.push(chunk);
    });
  });

  sessions.set(guildId, session);
}

async function handleLeave(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const session = sessions.get(guildId);

  if (!session) {
    await interaction.reply({ content: 'Not currently recording in this server.', ephemeral: true });
    return;
  }

  await interaction.reply('Stopping recording and processing transcript...');
  session.connection.destroy();
  sessions.delete(guildId);

  const speakers: SpeakerTranscript[] = [];
  const wavFiles: string[] = [];

  for (const [userId, chunks] of session.speakerChunks) {
    const username = session.speakerNames.get(userId) ?? userId;
    if (!chunks.length) continue;
    try {
      const wavPath = writeWav(username, chunks);
      wavFiles.push(wavPath);
      const text = await transcribeFile(wavPath);
      speakers.push({ username, text });
    } catch (err) {
      logger.warn({ err, username }, 'transcription failed');
    }
  }

  wavFiles.forEach(cleanupWav);

  if (!speakers.length) {
    await interaction.editReply('No audio recorded — nothing to save.');
    return;
  }

  const fullTranscript = buildFullTranscript(speakers);
  const content = await extractDecisionDraft(fullTranscript, session.projectSlug, session.sessionTitle);

  const draftContent = content ?? [
    `# Draft: ${session.sessionTitle}`,
    '',
    '**Source:** Discord voice call',
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    '',
    '---',
    '',
    fullTranscript,
  ].join('\n');

  const token = await getApiToken();
  if (env.MEMORYHUB_API_URL && token) {
    const res = await fetch(`${env.MEMORYHUB_API_URL}/api/projects/${session.projectSlug}/drafts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ topic: session.sessionTitle, content: draftContent, date: new Date().toISOString().slice(0, 10) }),
    });

    if (res.ok) {
      const saved = await res.json() as { filename: string };
      await interaction.editReply(`Draft saved: \`${saved.filename}\` — check MemoryHub UI to review.`);
      return;
    }
  }

  await interaction.editReply(`Transcript ready (${speakers.length} speakers, ${fullTranscript.length} chars). Configure MEMORYHUB_API_URL and MEMORYHUB_API_TOKEN to auto-save.`);
}

client.once(Events.ClientReady, async (c) => {
  logger.info(`Discord bot online: ${c.user.tag}`);
  await registerCommands(c.user.id);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'join') await handleJoin(interaction).catch((err) => logger.error({ err }, 'join error'));
    if (interaction.commandName === 'leave') await handleLeave(interaction).catch((err) => logger.error({ err }, 'leave error'));
    if (interaction.commandName === 'decision') await interaction.showModal(buildEntryModal('decision-modal', 'Log Decision')).catch((err) => logger.error({ err }, 'decision modal error'));
    if (interaction.commandName === 'draft') await interaction.showModal(buildEntryModal('draft-modal', 'Log Draft')).catch((err) => logger.error({ err }, 'draft modal error'));
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'decision-modal' || interaction.customId === 'draft-modal') {
      await handleModalSubmit(interaction).catch((err) => logger.error({ err }, 'modal submit error'));
    }
  }
});

client.login(env.DISCORD_BOT_TOKEN);
