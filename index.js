require('dotenv').config();

const express = require('express');
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
console.log('RELAY_TOKEN exists?:', !!process.env.RELAY_TOKEN);

// =============================
// Locale -> target language
// =============================
function normalizeTargetLang(rawLocale) {
  const loc = String(rawLocale || 'ja').toLowerCase();

  // 中国語は zh に潰さず保持する
  if (loc === 'zh-cn' || loc === 'zh-sg' || loc === 'zh-hans') {
    return 'zh-CN';
  }
  if (loc === 'zh-tw' || loc === 'zh-hk' || loc === 'zh-mo' || loc === 'zh-hant') {
    return 'zh-TW';
  }

  // それ以外は基本 lang 部分だけ
  return loc.split('-')[0];
}

// =============================
// Gemini
// =============================
let model = null;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
} else {
  console.warn('⚠ GEMINI_API_KEY が未設定のため Deep Translate は使えません');
}

// =============================
// Discord Client
// =============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// =============================
// Ready
// =============================
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ LingoFlow Ready! Logged in as ${readyClient.user.tag}`);

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

    await guild.commands.set([fastData, deepData]);
    console.log('✅ Two commands registered successfully!');
  } catch (err) {
    console.error('❌ Command registration error:', err);
  }
});

// =============================
// Interaction Handler
// =============================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isMessageContextMenuCommand()) return;
  if (interaction.replied || interaction.deferred) return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    console.error('❌ deferReply失敗 (3秒制限):', e.message);
    return;
  }

  try {
    const originalText = interaction.targetMessage?.content;
    const rawLocale = interaction.locale || 'ja';
    const targetLang = normalizeTargetLang(rawLocale);

    console.log('[lang] raw locale =', rawLocale, '=> targetLang =', targetLang);

    if (!originalText || !originalText.trim()) {
      await interaction.editReply('翻訳するテキストがありません。').catch(() => {});
      return;
    }

    // -----------------------------
    // Fast Translate (Google)
    // -----------------------------
    if (interaction.commandName === 'Fast Translate') {
      try {
        const res = await translate(originalText, { to: targetLang });
        await interaction.editReply(`⚡ **Fast Translate (Google):**\n${res.text}`);
        return;
      } catch (err) {
        console.error('❌ Fast Translate Error:', err);
        await interaction.editReply('⚡ Fast Translateでエラーが発生しました。').catch(() => {});
        return;
      }
    }

    // -----------------------------
    // Deep Translate (Gemini)
    // -----------------------------
    if (interaction.commandName === 'Deep Translate') {
      if (!model) {
        await interaction.editReply(
          '🧠 GEMINI_API_KEY が未設定のため、Deep Translate は現在利用できません。'
        ).catch(() => {});
        return;
      }

      const prompt = `Translate the following text into the language of code "${targetLang}".
Context: Online chat. Deliver only the translated text.
Text: ${originalText}`;

      let attempts = 0;
      let translatedText = null;

      while (attempts < 3) {
        try {
          const result = await model.generateContent(prompt);
          translatedText = result.response.text();
          break;
        } catch (err) {
          if (err?.status === 429) {
            await interaction.editReply(
              "⚠️ You may have exceeded the free tier limit. Please wait a while or use 'Fast Translate' instead.\n\nGemini APIの利用制限に達した可能性があります。しばらく待つか、'Fast Translate' を使ってください。"
            ).catch(() => {});
            return;
          }

          if (err?.status === 503 || err?.status === 500) {
            attempts++;
            console.log(`🔁 Retry attempt ${attempts}...`);
            await new Promise((res) => setTimeout(res, 2000));
          } else {
            throw err;
          }
        }
      }

      if (!translatedText) {
        await interaction.editReply(
          '🧠 Deep Translateが現在混雑しています。少し時間を置いて再試行してください。'
        ).catch(() => {});
        return;
      }

      await interaction.editReply(`🧠 **Deep Translate (Gemini):**\n${translatedText}`);
      return;
    }

  } catch (error) {
    console.error('🔥 Interaction Execution Error:', error);
    await interaction.editReply('翻訳処理中に予期せぬエラーが発生しました。').catch(() => {});
  }
});

// =============================
// Express
// =============================
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.get('/healthz', (req, res) => {
  res.status(200).json({
    ok: true,
    ready: client.isReady(),
    timestamp: new Date().toISOString(),
  });
});

// =============================
// Discord Webhook Relay
// GAS（Google共用IP）から直接Discordを叩くとCloudflare 1015で弾かれるため、
// VPS（専有IP）を経由させる中継エンドポイント。bot認証は不要、純粋にHTTP転送。
// =============================
app.post('/relay/discord', async (req, res) => {
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.RELAY_TOKEN || ''}`;
  if (!process.env.RELAY_TOKEN || auth !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const { webhookUrl, payload } = req.body || {};
  if (typeof webhookUrl !== 'string' ||
      !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhookUrl)) {
    return res.status(400).json({ ok: false, error: 'invalid webhookUrl' });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, error: 'missing payload' });
  }

  const doFetch = async () => {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { code: r.status, text: await r.text() };
  };

  try {
    let result = await doFetch();

    // Discord本体の429ならretry_afterに従って1回だけリトライ。Cloudflareの1015はそのまま返す。
    if (result.code === 429) {
      const is1015 = /error code:\s*1015/i.test(result.text);
      if (is1015) {
        return res.status(200).json({ ok: false, code: 429, text: result.text, is1015: true });
      }
      try {
        const parsed = JSON.parse(result.text);
        const waitMs = Math.min(5000, Math.ceil(Number(parsed.retry_after || 1) * 1000) + 200);
        await new Promise((r) => setTimeout(r, waitMs));
        result = await doFetch();
      } catch (_) {
        // JSONでなければそのまま返す
      }
    }

    return res.status(200).json({
      ok: result.code === 200 || result.code === 204,
      code: result.code,
      text: result.text,
      is1015: false,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =============================
// Error Handling
// =============================
client.on('error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// =============================
// Login
// =============================
client.login(TOKEN);
