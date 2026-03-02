require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  Events,
  SlashCommandBuilder,
} = require('discord.js');
const express = require('express');

// =============================
// Environment Variables
// =============================
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT) || 10000;
const REGISTER_COMMANDS = process.env.REGISTER_COMMANDS === 'true';

// =============================
// Boot Logs
// =============================
console.log('=== Boot start ===');
console.log('DISCORD_TOKEN exists?:', !!TOKEN);
console.log('GUILD_ID exists?:', !!GUILD_ID);
console.log('REGISTER_COMMANDS:', REGISTER_COMMANDS);
console.log('NODE_VERSION:', process.version);
console.log('discord.js version:', require('discord.js').version);
console.log('PORT:', PORT);

if (!TOKEN) console.error('❌ DISCORD_TOKEN が未設定です');
if (!GUILD_ID) console.error('❌ GUILD_ID が未設定です');

// =============================
// Discord Client
// =============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// =============================
// Safe Debug Logs
// =============================
client.on('debug', (msg) => {
  if (typeof msg === 'string' && msg.includes('Provided token')) return;
  console.log('🐞 debug:', msg);
});

client.on('error', (err) => console.error('❌ Client error:', err));
client.on('warn', (info) => console.warn('⚠ Warn:', info));

client.on('invalidated', () => {
  console.error('❌ invalidated event fired');
});

client.on('shardDisconnect', (event, id) => {
  console.warn(`⚠ shardDisconnect shard=${id} code=${event.code}`);
});

client.on('shardError', (error, id) => {
  console.error(`❌ shardError shard=${id}`, error);
});

client.on('shardReady', (id, unavailableGuilds) => {
  console.log(`✅ shardReady shard=${id} unavailableGuilds=${unavailableGuilds?.size ?? 0}`);
});

client.on('shardReconnecting', (id) => {
  console.warn(`🔁 shardReconnecting shard=${id}`);
});

client.on('shardResume', (id, replayed) => {
  console.log(`✅ shardResume shard=${id} replayed=${replayed}`);
});

// =============================
// Express
// =============================
const app = express();

app.get('/', (req, res) => {
  res.status(200).send('Bot is running!');
});

app.get('/healthz', (req, res) => {
  const isDiscordReady =
    typeof client.isReady === 'function' ? client.isReady() : false;

  res.status(200).json({
    ok: true,
    discord: isDiscordReady ? 'ready' : 'not_ready',
    wsStatus: client.ws?.status ?? null,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =============================
// Ready Events
// =============================
client.on('ready', () => {
  console.log('🎉 ready event fired');
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Ready as ${readyClient.user.tag}`);
  console.log(`✅ Bot user id: ${readyClient.user.id}`);
  console.log(`✅ Guild count: ${readyClient.guilds.cache.size}`);

  if (!REGISTER_COMMANDS) {
    console.log('ℹ Command registration skipped');
    return;
  }

  try {
    const guild = client.guilds.cache.get(GUILD_ID);

    if (!guild) {
      console.error('❌ Guild not found. GUILD_ID を確認してください');
      return;
    }

    console.log(`✅ Guild found: ${guild.name} (${guild.id})`);

    const commands = [
      new SlashCommandBuilder()
        .setName('ping')
        .setDescription('疎通確認用コマンド'),

      new ContextMenuCommandBuilder()
        .setName('Fast Translate')
        .setType(ApplicationCommandType.Message),

      new ContextMenuCommandBuilder()
        .setName('Deep Translate')
        .setType(ApplicationCommandType.Message),
    ];

    await guild.commands.set(commands);
    console.log('✅ Commands registered successfully');
  } catch (err) {
    console.error('❌ Command registration error:', err);
  }
});

// =============================
// Interaction Handler
// =============================
client.on(Events.InteractionCreate, async (interaction) => {
  console.log('🔥 InteractionCreate fired');
  console.log('type:', interaction.type);
  console.log('commandName:', interaction.commandName);
  console.log('user:', interaction.user?.tag);

  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ping') {
        await interaction.reply({
          content: 'pong',
          ephemeral: true,
        });
        console.log('✅ /ping reply success');
        return;
      }

      await interaction.reply({
        content: '不明なスラッシュコマンドです。',
        ephemeral: true,
      });
      return;
    }

    if (interaction.isMessageContextMenuCommand()) {
      await interaction.reply({
        content: '受信はできています。',
        ephemeral: true,
      });
      console.log('✅ Context menu reply success');
      return;
    }

    console.log('ℹ Unsupported interaction type');
  } catch (err) {
    console.error('❌ Interaction error:', err);
  }
});

// =============================
// Timed Status Checks
// =============================
let loginSettled = false;

setTimeout(() => {
  console.log('⏰ 10s status check', {
    ready: typeof client.isReady === 'function' ? client.isReady() : false,
    wsStatus: client.ws?.status ?? null,
  });
}, 10000);

setTimeout(() => {
  console.log('⏰ 20s status check', {
    ready: typeof client.isReady === 'function' ? client.isReady() : false,
    wsStatus: client.ws?.status ?? null,
  });
}, 20000);

setTimeout(() => {
  console.log('⏰ 60s status check', {
    ready: typeof client.isReady === 'function' ? client.isReady() : false,
    wsStatus: client.ws?.status ?? null,
  });
}, 60000);

setInterval(() => {
  console.log('🩺 heartbeat', {
    ready: typeof client.isReady === 'function' ? client.isReady() : false,
    wsStatus: client.ws?.status ?? null,
    uptime: Math.floor(process.uptime()),
  });
}, 30000);

setTimeout(() => {
  if (!loginSettled) {
    console.error('⛔ login promise still pending after 30s');
  }
}, 30000);

// =============================
// Process Events
// =============================
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err);
});

process.on('exit', (code) => {
  console.log(`ℹ process exit code: ${code}`);
});

process.on('SIGTERM', async () => {
  console.log('⚠ SIGTERM received, shutting down gracefully...');
  try {
    client.destroy();
    console.log('✅ Discord client destroyed');
  } catch (e) {
    console.error('❌ Error during client.destroy():', e);
  }
  process.exit(0);
});

// =============================
// Login
// =============================
if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN がないため Discord にログインできません');
} else {
  console.log('11. before client.login');

  client.login(TOKEN)
    .then(() => {
      loginSettled = true;
      console.log('✅ client.login() success');
    })
    .catch((err) => {
      loginSettled = true;
      console.error('❌ client.login() failed:', err);
    });

  console.log('12. after client.login call');
}
