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

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT) || 10000;
const REGISTER_COMMANDS = process.env.REGISTER_COMMANDS === 'true';

console.log('=== Boot start ===');
console.log('DISCORD_TOKEN exists?:', !!TOKEN);
console.log('GUILD_ID exists?:', !!GUILD_ID);
console.log('REGISTER_COMMANDS:', REGISTER_COMMANDS);
console.log('PORT:', PORT);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

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
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server running on port ${PORT}`);
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

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ping') {
        await interaction.reply({
          content: 'pong',
          ephemeral: true,
        });
        return;
      }
    }

    if (interaction.isMessageContextMenuCommand()) {
      await interaction.reply({
        content: '受信はできています。',
        ephemeral: true,
      });
      return;
    }
  } catch (err) {
    console.error('❌ Interaction error:', err);
  }
});

client.on('error', (err) => console.error('❌ Client error:', err));
client.on('warn', (info) => console.warn('⚠ Warn:', info));

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err);
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

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN がないため Discord にログインできません');
} else {
  console.log('11. before client.login');
  client.login(TOKEN)
    .then(() => console.log('✅ client.login() success'))
    .catch((err) => console.error('❌ client.login() failed:', err));
  console.log('12. after client.login call');
}
