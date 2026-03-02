require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  Events,
  SlashCommandBuilder,
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const translate = require('google-translate-api-next');
const express = require('express');

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

if (!TOKEN) console.error('❌ DISCORD_TOKEN が未設定です');
if (!GEMINI_API_KEY) console.warn('⚠ GEMINI_API_KEY が未設定です（Deep Translate は使えません）');
if (!GUILD_ID) console.error('❌ GUILD_ID が未設定です');

// =============================
// Gemini
// =============================
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
}

// =============================
// Discord Client
// =============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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

  return res.status(200).json({
    ok: true,
    discord: isDiscordReady ? 'ready' : 'not_ready',
    uptimeSeconds: Math.floor(process.uptime()),
    wsStatus: client.ws?.status ?? null,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =============================
// Ready Event
// =============================
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
    // -----------------------------
    // Slash Command: /ping
    // -----------------------------
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ping') {
        console.log('🏓 /ping received');
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

    // -----------------------------
    // Context Menu only
    // -----------------------------
    if (!interaction.isMessageContextMenuCommand()) {
      console.log('ℹ Not a message context menu command');
      return;
    }

    if (interaction.replied || interaction.deferred) {
      console.log('ℹ Already replied or deferred');
      return;
    }

    console.log('--- Message Context Menu received ---');
    console.log('commandName:', interaction.commandName);
    console.log('locale:', interaction.locale);

    await interaction.deferReply({ ephemeral: true });
    console.log('✅ deferReply success');

    const originalText = interaction.targetMessage?.content;
    const targetLang = (interaction.locale || 'ja').split('-')[0];

    if (!originalText || !originalText.trim()) {
      await interaction.editReply('翻訳するテキストがありません。');
      console.log('ℹ No text to translate');
      return;
    }

    // =============================
    // Fast Translate
    // =============================
    if (interaction.commandName === 'Fast Translate') {
      console.log('⚡ Fast Translate start');
      console.log('targetLang:', targetLang);
      console.log('originalText:', originalText);

      try {
        const res = await translate(originalText, { to: targetLang });
        console.log('✅ Fast Translate API success');

        await interaction.editReply(
          `⚡ **Fast Translate (Google):**\n${res.text}`
        );
        console.log('✅ Fast Translate reply success');
        return;
      } catch (err) {
        console.error('❌ Fast Translate Error:', err);

        await interaction.editReply(
          `⚡ Fast Translateでエラーが発生しました。\n\`\`\`\n${String(err?.message || err)}\n\`\`\``
        );
        return;
      }
    }

    // =============================
    // Deep Translate
    // =============================
    if (interaction.commandName === 'Deep Translate') {
      console.log('🧠 Deep Translate start');
      console.log('targetLang:', targetLang);
      console.log('originalText:', originalText);

      if (!model) {
        await interaction.editReply(
          '🧠 GEMINI_API_KEY が未設定のため、Deep Translate は現在利用できません。'
        );
        return;
      }

      const prompt = `Translate the following text into the language of code "${targetLang}".
Context: Online chat. Deliver only the translated text.
Text: ${originalText}`;

      let attempts = 0;
      let translatedText = null;

      while (attempts < 3) {
        try {
          console.log(`🧠 Gemini attempt ${attempts + 1}`);
          const result = await model.generateContent(prompt);
          translatedText = result.response.text();
          console.log('✅ Gemini translation success');
          break;
        } catch (err) {
          console.error(`❌ Gemini error attempt ${attempts + 1}:`, err);

          if (err?.status === 429) {
            await interaction.editReply(
              "⚠️ You may have exceeded the free tier limit. Please wait a while or use 'Fast Translate' instead.\n\nGemini APIの利用制限に達した可能性があります。しばらく待つか、'Fast Translate' を使ってください。"
            );
            return;
          }

          if (err?.status === 503 || err?.status === 500) {
            attempts++;
            console.log(`🔁 Retry after 2 seconds... (${attempts}/3)`);
            await new Promise((res) => setTimeout(res, 2000));
          } else {
            throw err;
          }
        }
      }

      if (!translatedText) {
        await interaction.editReply(
          '🧠 Deep Translateが現在混雑しています。少し時間を置いて再試行してください。'
        );
        return;
      }

      await interaction.editReply(
        `🧠 **Deep Translate (Gemini):**\n${translatedText}`
      );
      console.log('✅ Deep Translate reply success');
      return;
    }

    await interaction.editReply('不明なコンテキストメニューコマンドです。');
  } catch (error) {
    console.error('🔥 Interaction error:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('翻訳処理中に予期せぬエラーが発生しました。');
      } else {
        await interaction.reply({
          content: '翻訳処理中に予期せぬエラーが発生しました。',
          ephemeral: true,
        });
      }
    } catch (replyErr) {
      console.error('❌ Error while sending error reply:', replyErr);
    }
  }
});

// =============================
// Discord Events
// =============================
client.on('error', (err) => console.error('❌ Client error:', err));
client.on('warn', (info) => console.warn('⚠ Warn:', info));
client.on('shardDisconnect', (event, id) => {
  console.warn(`⚠ shardDisconnect shard=${id} code=${event.code}`);
});
client.on('shardError', (error, id) => {
  console.error(`❌ shardError shard=${id}`, error);
});
client.on('shardReconnecting', (id) => {
  console.warn(`🔁 shardReconnecting shard=${id}`);
});
client.on('shardResume', (id, replayed) => {
  console.log(`✅ shardResume shard=${id} replayed=${replayed}`);
});

// =============================
// Heartbeat Logs
// =============================
setInterval(() => {
  console.log('🩺 heartbeat', {
    ready: typeof client.isReady === 'function' ? client.isReady() : false,
    wsStatus: client.ws?.status ?? null,
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
    .then(() => console.log('✅ client.login() success'))
    .catch((err) => console.error('❌ client.login() failed:', err));
  console.log('12. after client.login call');
}
