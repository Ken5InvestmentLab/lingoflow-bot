require('dotenv').config();

const Eris = require('eris');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const translate = require('google-translate-api-next');

// =============================
// Environment Variables
// =============================
const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT) || 10000;
const REGISTER_COMMANDS = process.env.REGISTER_COMMANDS === 'true';

// =============================
// Boot Logs
// =============================
console.log('=== Boot start ===');
console.log('DISCORD_TOKEN exists?:', !!TOKEN);
console.log('GEMINI_API_KEY exists?:', !!GEMINI_API_KEY);
console.log('GUILD_ID exists?:', !!GUILD_ID);
console.log('REGISTER_COMMANDS:', REGISTER_COMMANDS);
console.log('NODE_VERSION:', process.version);
console.log('PORT:', PORT);

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN が未設定です');
}
if (!GEMINI_API_KEY) {
  console.warn('⚠ GEMINI_API_KEY が未設定です（Deep Translate は使えません）');
}
if (!GUILD_ID) {
  console.error('❌ GUILD_ID が未設定です');
}

// =============================
// Gemini
// =============================
let model = null;

if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
}

// =============================
// Express
// =============================
const app = express();

let botReady = false;

app.get('/', (req, res) => {
  res.status(200).send('Bot is running!');
});

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
// Helper
// =============================
function getTargetMessageFromInteraction(interaction) {
  const targetId = interaction?.data?.target_id;
  const resolved = interaction?.data?.resolved;

  if (!targetId || !resolved) {
    return null;
  }

  const messages = resolved.messages;

  if (messages && typeof messages === 'object' && messages[targetId]) {
    return messages[targetId];
  }

  if (messages && typeof messages.get === 'function') {
    const msg = messages.get(targetId);
    if (msg) return msg;
  }

  if (messages && typeof messages === 'object') {
    for (const [key, value] of Object.entries(messages)) {
      if (String(key) === String(targetId)) {
        return value;
      }
    }
  }

  return null;
}

// =============================
// Interaction Handler
// =============================
bot.on('interactionCreate', async (interaction) => {
  try {
    console.log('🔥 interactionCreate fired');
    console.log('type:', interaction.type);
    console.log('name:', interaction.data?.name);

    // Slash command
    if (interaction.data?.type === 1 && interaction.data?.name === 'ping') {
      await interaction.createMessage({
        content: 'pong',
        flags: 64
      });
      console.log('✅ /ping reply success');
      return;
    }

    // Message context menu only
    if (interaction.data?.type !== 3) {
      await interaction.createMessage({
        content: '未対応のコマンドです。',
        flags: 64
      });
      return;
    }

    const targetMessage = getTargetMessageFromInteraction(interaction);

    console.log('target_id:', interaction.data?.target_id);
    console.log('resolved message found?:', !!targetMessage);
    console.log(
      'resolved message keys:',
      Object.keys(interaction.data?.resolved?.messages || {})
    );

    const originalText = targetMessage?.content || '';
    const locale = interaction.locale || 'ja';
    const targetLang = locale.split('-')[0];

    console.log('originalText:', originalText);

    if (!originalText.trim()) {
      await interaction.createMessage({
        content: '翻訳するテキストがありません。',
        flags: 64
      });
      return;
    }

    await interaction.defer(64);

    // =============================
    // Fast Translate
    // =============================
    if (interaction.data.name === 'Fast Translate') {
      try {
        const res = await translate(originalText, { to: targetLang });

        await interaction.editOriginalMessage({
          content: `⚡ **Fast Translate (Google):**\n${res.text}`
        });

        console.log('✅ Fast Translate reply success');
        return;
      } catch (err) {
        console.error('❌ Fast Translate Error:', err);

        await interaction.editOriginalMessage({
          content: '⚡ Fast Translateでエラーが発生しました。'
        });
        return;
      }
    }

    // =============================
    // Deep Translate
    // =============================
    if (interaction.data.name === 'Deep Translate') {
      if (!model) {
        await interaction.editOriginalMessage({
          content: '🧠 GEMINI_API_KEY が未設定のため、Deep Translate は利用できません。'
        });
        return;
      }

      try {
        const prompt = `Translate the following text into the language of code "${targetLang}".
Context: Online chat. Deliver only the translated text.
Text: ${originalText}`;

        const result = await model.generateContent(prompt);
        const translatedText = result.response.text();

        await interaction.editOriginalMessage({
          content: `🧠 **Deep Translate (Gemini):**\n${translatedText}`
        });

        console.log('✅ Deep Translate reply success');
        return;
      } catch (err) {
        console.error('❌ Deep Translate Error:', err);

        await interaction.editOriginalMessage({
          content: '🧠 Deep Translateでエラーが発生しました。'
        });
        return;
      }
    }

    await interaction.editOriginalMessage({
      content: '未対応のコマンドです。'
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
// Status Logs
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
