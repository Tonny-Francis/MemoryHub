import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from '@discordjs/voice';
import prism from 'prism-media';
import { env } from './Config/Env.Config.js';
import { logger } from './Config/Logger.Config.js';
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

  if (env.MEMORYHUB_API_URL && env.MEMORYHUB_API_TOKEN) {
    const res = await fetch(`${env.MEMORYHUB_API_URL}/api/projects/${session.projectSlug}/drafts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MEMORYHUB_API_TOKEN}`,
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
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'join') await handleJoin(interaction).catch((err) => logger.error({ err }, 'join error'));
  if (interaction.commandName === 'leave') await handleLeave(interaction).catch((err) => logger.error({ err }, 'leave error'));
});

client.login(env.DISCORD_BOT_TOKEN);
