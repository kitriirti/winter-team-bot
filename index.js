const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildInvites
  ]
});

const deletedChannels = new Collection();
const savedChannels = new Collection();
const activeTickets = new Collection();
const autoDeleteTimeouts = new Collection();
let staffStats = new Collection();
const invites = new Collection();

let ticketStatus = { stack1: true, stack2: true };
let stats = {
  stack1: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() },
  stack2: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() }
};

const startTime = Date.now();

const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    ticketCategory: process.env.TICKET_CATEGORY,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2,
    logChannelId: process.env.LOG_CHANNEL_ID,
    memberRoleId: process.env.MEMBER_ROLE_ID,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
    autoRoleId: process.env.AUTO_ROLE_ID
  };
};

function getUptime() {
  const diff = Date.now() - startTime;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  let result = '';
  if (days > 0) result += `${days} д. `;
  if (hours > 0) result += `${hours} ч. `;
  if (minutes > 0) result += `${minutes} мин. `;
  result += `${seconds} сек.`;
  return result;
}

function getUptimeShort() {
  const diff = Date.now() - startTime;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  let result = '';
  if (days > 0) result += `${days}д `;
  if (hours > 0) result += `${hours}ч `;
  result += `${minutes}м`;
  return result || '0м';
}

async function saveAllChannels(guild) {
  try {
    savedChannels.clear();
    const categories = [];
    const standaloneChannels = [];
    
    for (const channel of guild.channels.cache.values()) {
      if (channel.type === ChannelType.GuildCategory) {
        categories.push({
          id: channel.id, name: channel.name, type: 'category',
          position: channel.position, channels: []
        });
      }
    }
    
    for (const channel of guild.channels.cache.values()) {
      if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
        const channelData = {
          id: channel.id, name: channel.name,
          type: channel.type === ChannelType.GuildText ? 'text' : 'voice',
          parentId: channel.parentId, parentName: channel.parent?.name || null,
          position: channel.position, topic: channel.topic || null,
          nsfw: channel.nsfw || false, rateLimitPerUser: channel.rateLimitPerUser || 0,
          bitrate: channel.bitrate || null, userLimit: channel.userLimit || null
        };
        
        if (channel.parent) {
          const category = categories.find(c => c.id === channel.parentId);
          if (category) category.channels.push(channelData);
        } else {
          standaloneChannels.push(channelData);
        }
      }
    }
    
    const backupData = {
      guildId: guild.id, guildName: guild.name, savedAt: new Date(),
      categories, standaloneChannels, totalChannels: guild.channels.cache.size
    };
    
    savedChannels.set('full_backup', backupData);
    console.log(`💾 Сохранено: ${categories.length} категорий, ${standaloneChannels.length} каналов`);
    return backupData;
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    return null;
  }
}

async function restoreChannel(guild, channelData) {
  try {
    let parentId = null;
    if (channelData.parentName) {
      const parent = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === channelData.parentName);
      if (parent) parentId = parent.id;
    } else if (channelData.parentId) {
      parentId = channelData.parentId;
    }
    
    if (channelData.type === 'text') {
      return await guild.channels.create({
        name: channelData.name, type: ChannelType.GuildText, parent: parentId,
        position: channelData.position, topic: channelData.topic || undefined,
        nsfw: channelData.nsfw || false, rateLimitPerUser: channelData.rateLimitPerUser || 0
      });
    } else if (channelData.type === 'voice') {
      return await guild.channels.create({
        name: channelData.name, type: ChannelType.GuildVoice, parent: parentId,
        position: channelData.position, bitrate: channelData.bitrate || 64000,
        userLimit: channelData.userLimit || 0
      });
    } else if (channelData.type === 'category') {
      return await guild.channels.create({
        name: channelData.name, type: ChannelType.GuildCategory, position: channelData.position
      });
    }
  } catch (error) {
    console.error(`❌ Ошибка восстановления ${channelData.name}:`, error);
    return null;
  }
}

// ========== АНТИ-СНОС: НАХОДИМ КТО УДАЛИЛ И ВЫДАЁМ ТАЙМАУТ ==========
client.on('channelDelete', async (channel) => {
  try {
    if (channel.type === ChannelType.DM || !channel.guild) return;
    
    const guild = channel.guild;
    
    // Ждём немного, чтобы аудит-лог обновился
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Получаем аудит-лог
    const auditLogs = await guild.fetchAuditLogs({ type: 12, limit: 5 });
    const deleteLog = auditLogs.entries.find(entry => 
      entry.target.id === channel.id && 
      Date.now() - entry.createdTimestamp < 5000
    );
    
    const executor = deleteLog?.executor;
    
    console.log(`🗑️ Канал "${channel.name}" удалён!`);
    if (executor) {
      console.log(`👤 Удалил: ${executor.tag} (${executor.id})`);
    } else {
      console.log(`⚠️ Не удалось определить кто удалил`);
    }
    
    // Сохраняем данные канала
    const channelData = {
      name: channel.name,
      type: channel.type === ChannelType.GuildText ? 'text' : 
            (channel.type === ChannelType.GuildVoice ? 'voice' : 'category'),
      parentId: channel.parentId,
      parentName: channel.parent?.name || null,
      position: channel.position,
      topic: channel.topic || null,
      nsfw: channel.nsfw || false,
      rateLimitPerUser: channel.rateLimitPerUser || 0,
      bitrate: channel.bitrate || null,
      userLimit: channel.userLimit || null
    };
    
    // Восстанавливаем канал
    const restored = await restoreChannel(guild, channelData);
    
    // Если нашли кто удалил и это НЕ админ и НЕ владелец - выдаём таймаут
    if (executor && 
        executor.id !== guild.ownerId && 
        !executor.permissions.has(PermissionFlagsBits.Administrator) &&
        !executor.bot) {
      
      try {
        await executor.timeout(24 * 60 * 60 * 1000, 'Анти-снос: удаление канала без прав администратора');
        console.log(`✅ ${executor.tag} получил таймаут на 24 часа`);
        
        // Уведомление в канал логов
        const cfg = getConfig();
        if (cfg.logChannelId) {
          const logChannel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('🚨 АНТИ-СНОС: ТАЙМАУТ ВЫДАН')
              .setColor(0xFF0000)
              .setDescription(
                `**Нарушитель:** ${executor.tag} (${executor.id})\n` +
                `**Канал:** ${channelData.name}\n` +
                `**Восстановлен:** ${restored ? '✅ Да' : '❌ Нет'}\n` +
                `**Наказание:** Таймаут 24 часа`
              )
              .setTimestamp();
            
            await logChannel.send({ embeds: [embed] });
          }
        }
      } catch (error) {
        console.error(`❌ Ошибка выдачи таймаута ${executor.tag}:`, error);
      }
    } else if (executor && (executor.id === guild.ownerId || executor.permissions.has(PermissionFlagsBits.Administrator))) {
      console.log(`ℹ️ ${executor.tag} - админ/владелец, таймаут не выдаётся`);
    }
    
    if (restored) {
      console.log(`✅ Канал "${channelData.name}" восстановлен`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка в channelDelete:', error);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const cfg = getConfig();
    if (cfg.autoRoleId) {
      await member.roles.add(cfg.autoRoleId).catch(() => {});
    }
    
    if (cfg.welcomeChannelId) {
      const welcomeChannel = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
      if (welcomeChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('👋 НОВЫЙ УЧАСТНИК!')
          .setDescription(`**${member.user}** присоединился к серверу!\n\n🆔 **ID:** \`${member.user.id}\``)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        await welcomeChannel.send({ embeds: [embed] });
      }
    }
  } catch (error) {}
});

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  console.log(`🛡️ АНТИ-СНОС АКТИВЕН (1 канал = таймаут 24ч)`);
  
  setInterval(() => {
    client.user.setActivity(`🛡️ ${getUptimeShort()}`, { type: 3 });
  }, 60000);
  
  client.user.setActivity(`🛡️ ${getUptimeShort()}`, { type: 3 });
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  if (guild) {
    await saveAllChannels(guild);
    console.log(`📊 Сервер: ${guild.name} | Участников: ${guild.memberCount}`);
  }
  
  await client.application.commands.set([
    { name: 'ping', description: 'Проверить задержку бота' },
    { name: 'uptime', description: 'Показать время работы бота' },
    { name: 'save_channels', description: 'Сохранить каналы в память (админ)' },
    { name: 'backup_info', description: 'Информация о бэкапе (админ)' },
    { name: 'restore_backup', description: 'Восстановить из бэкапа (админ)' }
  ]);
  
  console.log('✅ Команды зарегистрированы!');
});

client.on('interactionCreate', async interaction => {
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true });
    await interaction.editReply({ content: `🏓 Понг! **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${client.ws.ping}ms**` });
  }
  
  if (interaction.isCommand() && interaction.commandName === 'uptime') {
    const embed = new EmbedBuilder()
      .setTitle('⏰ ВРЕМЯ РАБОТЫ БОТА')
      .setColor(0x3498DB)
      .setDescription(`**${getUptime()}**`)
      .addFields({ name: '📅 Запущен', value: `<t:${Math.floor(startTime / 1000)}:F>`, inline: true });
    
    await interaction.reply({ embeds: [embed] });
  }
  
  if (interaction.isCommand() && interaction.commandName === 'save_channels') {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    await interaction.deferReply({ ephemeral: true });
    const backupData = await saveAllChannels(interaction.guild);
    
    if (backupData) {
      const embed = new EmbedBuilder()
        .setTitle('💾 КАНАЛЫ СОХРАНЕНЫ')
        .setColor(0x00FF00)
        .setDescription(`**Категорий:** ${backupData.categories.length}\n**Каналов:** ${backupData.totalChannels}`);
      
      await interaction.editReply({ embeds: [embed] });
    }
  }
  
  if (interaction.isCommand() && interaction.commandName === 'backup_info') {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    const backupData = savedChannels.get('full_backup');
    if (!backupData) return interaction.reply({ content: '❌ Бэкап не создан!', ephemeral: true });
    
    const embed = new EmbedBuilder()
      .setTitle('📦 ИНФОРМАЦИЯ О БЭКАПЕ')
      .setColor(0x3498DB)
      .setDescription(`**Сохранено:** ${new Date(backupData.savedAt).toLocaleString('ru-RU')}\n**Каналов:** ${backupData.totalChannels}`);
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.on('error', e => console.error('❌', e));
process.on('unhandledRejection', e => console.error('❌', e));

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<h1>✅ Бот работает!</h1><p>Аптайм: ${getUptime()}</p>`);
}).listen(process.env.PORT || 3000);
