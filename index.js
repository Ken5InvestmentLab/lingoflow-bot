require('dotenv').config();

const { Client, GatewayIntentBits, ContextMenuCommandBuilder, ApplicationCommandType, Events } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const translate = require('google-translate-api-next');

const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GUILD_ID = process.env.GUILD_ID;

// ----------------

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// 変数名を model に統一
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" }); 

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ LingoFlow Dual Mode Ready! Logged in as ${readyClient.user.tag}`);

    const fastData = new ContextMenuCommandBuilder()
        .setName('Fast Translate')
        .setType(ApplicationCommandType.Message);

    const deepData = new ContextMenuCommandBuilder()
        .setName('Deep Translate')
        .setType(ApplicationCommandType.Message);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        await guild.commands.set([fastData, deepData]);
        console.log('✅ Two commands registered successfully!');
    }
});

client.on(Events.InteractionCreate, async interaction => {
    // コンテキストメニューコマンド以外は無視
    if (!interaction.isMessageContextMenuCommand()) return;

    // 二重応答防止
    if (interaction.replied || interaction.deferred) return;

    // 🔥 1. 何よりも先に deferReply (失敗してもプロセスを落とさない)
    try {
        // ephemeral: true の代わりに新しい書き方（MessageFlags.Ephemeral）を使う
        await interaction.deferReply({ ephemeral: true });
    } catch (e) {
        console.error("❌ deferReply失敗 (3秒制限):", e.message);
        return; 
    }

    try {
        const originalText = interaction.targetMessage?.content;
        const targetLang = (interaction.locale || 'ja').split('-')[0];

        if (!originalText) {
            return await interaction.editReply('翻訳するテキストがありません。').catch(() => {});
        }

        // --- Fast Translate (Google) ---
        if (interaction.commandName === 'Fast Translate') {
            try {
                const res = await translate(originalText, { to: targetLang });
                return await interaction.editReply(`⚡ **Fast Translate (Google):**\n${res.text}`);
            } catch (err) {
                console.error("Fast Translate Error:", err);
                return await interaction.editReply("⚡ Fast Translateでエラーが発生しました。");
            }
        }

        // --- Deep Translate (Gemini) ---
        if (interaction.commandName === 'Deep Translate') {
            const prompt = `Translate the following text into the language of code "${targetLang}". 
Context: Online chat. Deliver only the translated text.
Text: ${originalText}`;

            let attempts = 0;
            let translatedText = null;

            while (attempts < 3) {
                try {
                    const result = await model.generateContent(prompt);
                    translatedText = result.response.text();
                    break; // 成功したらループ脱出
                } catch (err) {
                    // API制限(429)やサーバー過負荷(503)の処理
                    if (err.status === 429) {
                        return await interaction.editReply(
                            "⚠️ You may have exceeded the free tier limit (approx. 20 requests/day). Please wait a while or use **'Fast Translate'** instead.\n\nGemini APIの利用制限に達しました。\n無料枠の上限（1日20回程度）を超えた可能性があります。しばらく待つか、**'Fast Translate'** を使ってください。"
                        ).catch(() => {});
                    }
                    
                    if (err.status === 503 || err.status === 500) {
                        attempts++;
                        console.log(`Retry attempt ${attempts}...`);
                        await new Promise(res => setTimeout(res, 2000));
                    } else {
                        throw err; // それ以外のエラーはcatchへ
                    }
                }
            }

            if (!translatedText) {
                return await interaction.editReply(
                    "🧠 Deep Translateが現在混雑しています。少し時間を置いて再試行してください。"
                );
            }

            return await interaction.editReply(`🧠 **Deep Translate (Gemini):**\n${translatedText}`);
        }

    } catch (error) {
        console.error("🔥 Interaction Execution Error:", error);
        // すでにdefer済みなのでeditReplyを使用
        await interaction.editReply('翻訳処理中に予期せぬエラーが発生しました。').catch(() => {});
    }
});

client.login(TOKEN);

const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.listen(3000, () => {
  console.log("Web server running on port 3000");
});

client.on("error", console.error);
process.on("unhandledRejection", console.error);

