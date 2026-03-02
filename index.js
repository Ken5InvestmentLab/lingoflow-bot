require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  MessageFlags,
  Events,
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
const PORT = process.env.PORT || 10000;

// コマンド再登録をしたい時だけ true にする
// Render の Environment に REGISTER_COMMANDS=true を入れた時だけ実行
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
  console.error('❌ GEMINI_API_KEY が未設定です');
}
if (!GUILD_ID) {
  console.error('❌ GUILD_ID が未設定です');
}

// =============================
// Gemini
// =============================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

// =============================
// Discord Client
// =============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// =============================
// Ready Event
// =============================
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Ready as ${readyClient.user.tag}`);

  // 毎回コマンドを再登録すると起動時の負荷になるので、
  // 必要な時だけ REGISTER_COMMANDS=true にして実行する
  if (!REGISTER_COMMANDS) {
    console.log('ℹ Command registration skipped');
    return;
  }

  try {
    const fastData = new ContextMenuCommandBuilder()
      .setName('Fast Translate')
      .setType(ApplicationCommandType.Message);

    const deepData = new ContextMenuCommandBuilder()
      .setName('Deep Translate')
      .setType(ApplicationCommandType.Message);

    const guild = client.guilds.cache.get(GUILD_ID);

    if (!guild) {
      console.error('❌ Guild not found. GUILD_ID を確認してください');
      return;
    }

    console.log(`✅ Guild found: ${guild.name} (${guild.id})`);
    await guild.commands.set([fastData, deepData]);
    console.log('✅ Commands registered successfully');
  } catch (err) {
    console.error('❌ Command registration error:', err);
  }
});

// =============================
// Interaction Handler
// =============================
client.on(Events.InteractionCreate, async (interaction) => {
  console.log('--- Interaction received ---');
  console.log('commandName:', interaction.commandName);
  console.log('user:', interaction.user?.tag);
  console.log('locale:', interaction.locale);

  if (!interaction.isMessageContextMenuCommand()) return;
  if (interaction.replied || interaction.deferred) return;

  try {
    console.log('⏳ deferReply start');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    console.log('✅ deferReply success');
  } catch (e) {
    console.error('❌ deferReply failed:', e);
    return;
  }

  try {
    const originalText = interaction.targetMessage?.content;
    const targetLang = (interaction.locale || 'ja').split('-')[0];

    if (!originalText || !originalText.trim()) {
      await interaction.editReply('翻訳するテキストがありません。');
      return;
    }

    // =============================
    // Fast Translate
    // =============================
    if (interaction.commandName === 'Fast Translate') {
      console.log('⚡ Fast Translate start');

      try {
        const res = await translate(originalText, { to: targetLang });
        await interaction.editReply(`⚡ **Fast Translate (Google):**\n${res.text}`);
        console.log('✅ Fast Translate reply success');
        return;
      } catch (err) {
        console.error('❌ Fast Translate Error:', err);
        await interaction.editReply('⚡ Fast Translateでエラーが発生しました。');
        return;
      }
    }

    // =============================
    // Deep Translate
    // =============================
    if (interaction.commandName === 'Deep Translate') {
      console.log('🧠 Deep Translate start');

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

          if (err.status === 429) {
            await interaction.editReply(
              "⚠️ You may have exceeded the free tier limit. Please wait a while or use 'Fast Translate' instead.\n\nGemini APIの利用制限に達した可能性があります。しばらく待つか、'Fast Translate' を使ってください。"
            );
            return;
          }

          if (err.status === 503 || err.status === 500) {
            attempts++;
            console.log(`🔁 Retry after 2 seconds... (${attempts}/3)`);
            await new Promise((res) => setTimeout(res, 2000));
          } else {
            throw err;
          }
        }
      }

      if (!translatedText) {
        await interaction.editReply('🧠 Deep Translateが現在混雑しています。少し時間を置いて再試行してください。');
        return;
      }

      await interaction.editReply(`🧠 **Deep Translate (Gemini):**\n${translatedText}`);
      console.log('✅ Deep Translate reply success');
      return;
    }

    await interaction.editReply('不明なコマンドです。');
  } catch (error) {
    console.error('🔥 Interaction error:', error);
    await interaction.editReply('翻訳処理中に予期せぬエラーが発生しました。').catch(() => {});
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

// Render が終了シグナルを送ってきた時に安全に終了
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
console.log('11. before client.login');
client.login(TOKEN)
  .then(() => console.log('✅ client.login() success'))
  .catch((err) => console.error('❌ client.login() failed:', err));
console.log('12. after client.login call');

// =============================
// Express
// =============================
const app = express();

app.get('/', (req, res) => {
  console.log('🌐 GET /');
  res.send('Bot is running!');
});

// Render の Health Check 用
app.get('/healthz', (req, res) => {
  const isDiscordReady = typeof client.isReady === 'function' ? client.isReady() : false;

  if (isDiscordReady) {
    return res.status(200).json({
      ok: true,
      discord: 'ready',
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(503).json({
    ok: false,
    discord: 'not_ready',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});
