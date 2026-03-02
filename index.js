require('dotenv').config();

const Eris = require('eris');
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
console.log('PORT:', PORT);

if (!TOKEN) console.error('❌ DISCORD_TOKEN が未設定です');
if (!GUILD_ID) console.error('❌ GUILD_ID が未設定です');

// =============================
// Express
// =============================
const app = express();

app.get('/', (req, res) => {
  res.status(200).send('Bot is running!');
});

let botReady = false;

app.get('/healthz', (req, res) => {
  res.status(200).json({
    ok: true,
    ready: botReady,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =============================
// Eris Client
// =============================
const bot = new Eris(TOKEN, {
  intents: ['guilds'],
  autoreconnect: true,
  maxShards: 1,
  restMode: true,
});

// =============================
// Logging
// =============================
bot.on('error', (err) => {
  console.error('❌ bot error:', err);
});

bot.on('warn', (msg) => {
  console.warn('⚠ warn:', msg);
});

bot.on('disconnect', (err) => {
  console.warn('⚠ disconnect:', err);
});

bot.on('reconnecting', (attempt) => {
  console.warn('🔁 reconnecting, attempt:', attempt);
});

bot.on('resume', () => {
  console.log('✅ session resumed');
});

// =============================
// Ready
// =============================
bot.on('ready', async () => {
  botReady = true;
  console.log('🎉 ready event fired');
  console.log(`✅ Ready as ${bot.user.username}#${bot.user.discriminator}`);
  console.log(`✅ Bot user id: ${bot.user.id}`);

  if (!REGISTER_COMMANDS) {
    console.log('ℹ Command registration skipped');
    return;
  }

  try {
    const commands = [
      {
        name: 'ping',
        description: '疎通確認用コマンド',
        type: 1
      },
      {
        name: 'Fast Translate',
        type: 3
      },
      {
        name: 'Deep Translate',
        type: 3
      }
    ];

    await bot.bulkEditGuildCommands(GUILD_ID, commands);
    console.log('✅ Commands registered successfully');
  } catch (err) {
    console.error('❌ Command registration error:', err);
  }
});

// =============================
// Interaction Handler
// =============================
bot.on('interactionCreate', async (interaction) => {
  try {
    console.log('🔥 interactionCreate fired');
    console.log('type:', interaction.type);
    console.log('name:', interaction.data?.name);

    if (interaction.data?.type === 1 && interaction.data?.name === 'ping') {
      await interaction.createMessage({
        content: 'pong',
        flags: 64
      });
      console.log('✅ /ping reply success');
      return;
    }

    if (interaction.data?.type === 3) {
      await interaction.createMessage({
        content: '受信はできています。',
        flags: 64
      });
      console.log('✅ Context menu reply success');
      return;
    }

    await interaction.createMessage({
      content: '未対応のコマンドです。',
      flags: 64
    });
  } catch (err) {
    console.error('❌ interaction error:', err);
    try {
      await interaction.createMessage({
        content: 'エラーが発生しました。',
        flags: 64
      });
    } catch (_) {}
  }
});

// =============================
// Timed Status Checks
// =============================
setTimeout(() => {
  console.log('⏰ 20s status check', {
    ready: botReady,
    uptime: Math.floor(process.uptime()),
  });
}, 20000);

setTimeout(() => {
  console.log('⏰ 60s status check', {
    ready: botReady,
    uptime: Math.floor(process.uptime()),
  });
}, 60000);

setInterval(() => {
  console.log('🩺 heartbeat', {
    ready: botReady,
    uptime: Math.floor(process.uptime()),
  });
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

process.on('SIGTERM', () => {
  console.log('⚠ SIGTERM received, shutting down gracefully...');
  try {
    bot.disconnect({ reconnect: false });
    console.log('✅ Bot disconnected');
  } catch (e) {
    console.error('❌ disconnect error:', e);
  }
  process.exit(0);
});

// =============================
// Connect
// =============================
if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN がないため Discord に接続できません');
} else {
  console.log('11. before bot.connect');
  bot.connect();
  console.log('12. after bot.connect call');
}
