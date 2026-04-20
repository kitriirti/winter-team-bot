const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const http = require('http');

// ========== НАСТРОЙКИ КЛИЕНТА ==========
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

// ========== ХРАНИЛИЩА В ПАМЯТИ ==========
const savedChannels = new Collection();
const activeTickets = new Collection();
const autoDeleteTimeouts = new Collection();
const timedOutUsers = new Collection();
let staffStats = new Collection();
const invites = new Collection();

// ========== ПЕРЕМЕННЫЕ СОСТОЯНИЯ ==========
let ticketStatus = { stack1: true, stack2: true };
let stats = {
  stack1: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() },
  stack2: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() }
};

const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
if (stats.stack1.weekStart < weekAgo) {
  stats.stack1.weekAccepted = 0;
  stats.stack1.weekDenied = 0;
  stats.stack1.weekStart = Date.now();
}
if (stats.stack2.weekStart < weekAgo) {
  stats.stack2.weekAccepted = 0;
  stats.stack2.weekDenied = 0;
  stats.stack2.weekStart = Date.now();
}

const startTime = Date.now();

// ========== ПОЛУЧЕНИЕ КОНФИГУРАЦИИ ==========
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

// ========== ФУНКЦИИ АПТАЙМА ==========
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

// ========== СОХРАНЕНИЕ КАНАЛОВ ==========
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

// ========== ВОССТАНОВЛЕНИЕ КАНАЛА ==========
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

// ========== ВОССТАНОВЛЕНИЕ ИЗ БЭКАПА ==========
async function restoreFromBackup(guild) {
  try {
    const backupData = savedChannels.get('full_backup');
    if (!backupData) return { success: false, error: 'Нет сохранённых данных!' };
    
    let createdCategories = 0;
    let createdChannels = 0;
    const categoryMap = new Map();
    
    for (const cat of backupData.categories) {
      try {
        const existing = guild.channels.cache.get(cat.id);
        if (!existing) {
          const newCategory = await guild.channels.create({
            name: cat.name, type: ChannelType.GuildCategory, position: cat.position
          });
          categoryMap.set(cat.id, newCategory.id);
          createdCategories++;
        } else {
          categoryMap.set(cat.id, cat.id);
        }
      } catch (e) {}
    }
    
    for (const cat of backupData.categories) {
      for (const ch of cat.channels) {
        try {
          const existing = guild.channels.cache.get(ch.id);
          if (!existing) {
            const parentId = categoryMap.get(ch.parentId) || ch.parentId;
            if (ch.type === 'text') {
              await guild.channels.create({
                name: ch.name, type: ChannelType.GuildText, parent: parentId,
                position: ch.position, topic: ch.topic || undefined,
                nsfw: ch.nsfw, rateLimitPerUser: ch.rateLimitPerUser
              });
            } else if (ch.type === 'voice') {
              await guild.channels.create({
                name: ch.name, type: ChannelType.GuildVoice, parent: parentId,
                position: ch.position, bitrate: ch.bitrate || 64000, userLimit: ch.userLimit || 0
              });
            }
            createdChannels++;
          }
        } catch (e) {}
      }
    }
    
    for (const ch of backupData.standaloneChannels) {
      try {
        const existing = guild.channels.cache.get(ch.id);
        if (!existing) {
          if (ch.type === 'text') {
            await guild.channels.create({
              name: ch.name, type: ChannelType.GuildText, position: ch.position,
              topic: ch.topic || undefined, nsfw: ch.nsfw, rateLimitPerUser: ch.rateLimitPerUser
            });
          } else if (ch.type === 'voice') {
            await guild.channels.create({
              name: ch.name, type: ChannelType.GuildVoice, position: ch.position,
              bitrate: ch.bitrate || 64000, userLimit: ch.userLimit || 0
            });
          }
          createdChannels++;
        }
      } catch (e) {}
    }
    
    return { success: true, categories: createdCategories, channels: createdChannels };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ========== АНТИ-СНОС: НАХОДИМ КТО УДАЛИЛ И ВЫДАЁМ ТАЙМАУТ ==========
client.on('channelDelete', async (channel) => {
  try {
    if (channel.type === ChannelType.DM || !channel.guild) return;
    
    const guild = channel.guild;
    
    // Ждём обновления аудит-лога
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Получаем аудит-лог
    const auditLogs = await guild.fetchAuditLogs({ type: 12, limit: 10 });
    const deleteLog = auditLogs.entries.find(entry => 
      entry.target.id === channel.id && 
      Date.now() - entry.createdTimestamp < 10000
    );
    
    const executor = deleteLog?.executor;
    
    console.log(`🗑️ Канал "${channel.name}" удалён!`);
    if (executor) {
      console.log(`👤 Удалил: ${executor.tag} (${executor.id})`);
    } else {
      console.log(`⚠️ Не удалось определить кто удалил (возможно, нет прав на аудит-лог)`);
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
    
    // Если нашли кто удалил и это НЕ админ и НЕ владелец и НЕ бот - выдаём таймаут
    if (executor && 
        executor.id !== guild.ownerId && 
        !executor.permissions.has(PermissionFlagsBits.Administrator) &&
        !executor.bot) {
      
      try {
        await executor.timeout(24 * 60 * 60 * 1000, 'Анти-снос: удаление канала без прав администратора');
        console.log(`✅ ${executor.tag} получил таймаут на 24 часа`);
        
        timedOutUsers.set(executor.id, {
          userId: executor.id,
          userTag: executor.tag,
          guildId: guild.id,
          timeoutEnd: Date.now() + 24 * 60 * 60 * 1000
        });
        
        // Уведомление админам в ЛС
        const admins = guild.members.cache.filter(m => 
          m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot
        );
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`remove_timeout_${executor.id}`)
            .setLabel('🔓 Снять таймаут')
            .setStyle(ButtonStyle.Success)
        );
        
        const alertEmbed = new EmbedBuilder()
          .setTitle('🚨 АНТИ-СНОС: ТАЙМАУТ ВЫДАН!')
          .setColor(0xFF0000)
          .setDescription(
            `**Нарушитель:** ${executor.tag} (${executor.id})\n` +
            `**Удалённый канал:** ${channelData.name}\n` +
            `**Восстановлен:** ${restored ? '✅ Да' : '❌ Нет'}\n\n` +
            `**Наказание:** Таймаут 24 часа\n\n` +
            `Нажмите кнопку ниже чтобы снять таймаут.`
          )
          .setTimestamp();
        
        for (const admin of admins.values()) {
          try {
            await admin.send({ embeds: [alertEmbed], components: [row] });
            console.log(`📨 Уведомление отправлено админу ${admin.user.tag}`);
          } catch (e) {}
        }
        
        // Лог в канал логов
        const cfg = getConfig();
        if (cfg.logChannelId) {
          const logChannel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🚨 АНТИ-СНОС: ТАЙМАУТ ВЫДАН')
              .setColor(0xFF0000)
              .addFields(
                { name: '👤 Нарушитель', value: `${executor.tag}`, inline: true },
                { name: '🗑️ Канал', value: channelData.name, inline: true },
                { name: '🔄 Восстановлен', value: restored ? '✅' : '❌', inline: true }
              )
              .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
          }
        }
      } catch (error) {
        console.error(`❌ Ошибка выдачи таймаута ${executor.tag}:`, error);
      }
    } else if (executor && (executor.id === guild.ownerId || executor.permissions.has(PermissionFlagsBits.Administrator))) {
      console.log(`ℹ️ ${executor.tag} - админ/владелец, таймаут не выдаётся`);
      
      // Просто логируем восстановление
      const cfg = getConfig();
      if (cfg.logChannelId && restored) {
        const logChannel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle('🔄 КАНАЛ ВОССТАНОВЛЕН')
            .setColor(0xFFA500)
            .setDescription(`Канал **${channelData.name}** был удалён админом и автоматически восстановлен.`)
            .setTimestamp();
          
          await logChannel.send({ embeds: [embed] });
        }
      }
    }
    
    if (restored) {
      console.log(`✅ Канал "${channelData.name}" успешно восстановлен`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка в channelDelete:', error);
  }
});

// ========== ПРИВЕТСТВИЕ НОВЫХ УЧАСТНИКОВ ==========
client.on('guildMemberAdd', async (member) => {
  try {
    const cfg = getConfig();
    
    if (cfg.autoRoleId) {
      try {
        await member.roles.add(cfg.autoRoleId);
        console.log(`✅ Роль выдана ${member.user.tag}`);
      } catch (error) {}
    }
    
    let inviter = null;
    let totalInvites = 0;
    
    try {
      const newInvites = await member.guild.invites.fetch();
      const oldInvites = invites.get(member.guild.id);
      
      if (oldInvites) {
        let maxIncrease = 0;
        for (const [code, invite] of newInvites) {
          const oldInvite = oldInvites.get(code);
          if (oldInvite) {
            const increase = invite.uses - oldInvite.uses;
            if (increase > maxIncrease) {
              maxIncrease = increase;
              inviter = invite.inviter;
            }
          }
        }
      }
      
      invites.set(member.guild.id, newInvites);
      
      if (inviter) {
        totalInvites = newInvites
          .filter(inv => inv.inviter?.id === inviter.id)
          .reduce((total, inv) => total + (inv.uses || 0), 0);
      }
    } catch (error) {}
    
    if (cfg.welcomeChannelId) {
      const welcomeChannel = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
      if (welcomeChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('👋 НОВЫЙ УЧАСТНИК!')
          .setDescription(
            `**${member.user}** присоединился к серверу!\n\n` +
            `🆔 **ID:** \`${member.user.id}\`\n` +
            (inviter ? `📨 **Пригласил:** ${inviter} (всего: **${totalInvites}**)` : ``)
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        await welcomeChannel.send({ embeds: [embed] });
      }
    }
  } catch (error) {}
});

// ========== ОТСЛЕЖИВАНИЕ ПРИГЛАШЕНИЙ ==========
client.on('inviteCreate', async (invite) => {
  const guildInvites = invites.get(invite.guild.id) || new Collection();
  guildInvites.set(invite.code, invite);
  invites.set(invite.guild.id, guildInvites);
});

client.on('inviteDelete', async (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) {
    guildInvites.delete(invite.code);
    invites.set(invite.guild.id, guildInvites);
  }
});

// ========== ЗАПУСК БОТА ==========
client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  console.log(`🛡️ АНТИ-СНОС АКТИВЕН: 1 канал = таймаут 24ч (кроме админов)`);
  
  setInterval(() => {
    client.user.setActivity(`🛡️ ${getUptimeShort()}`, { type: 3 });
  }, 60000);
  
  client.user.setActivity(`🛡️ ${getUptimeShort()}`, { type: 3 });
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  if (guild) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guild.id, new Collection(guildInvites.map(invite => [invite.code, invite])));
      console.log(`✅ Загружено ${guildInvites.size} приглашений`);
    } catch (error) {}
    
    await saveAllChannels(guild);
    console.log(`📊 Сервер: ${guild.name} | Участников: ${guild.memberCount}`);
  }
  
  try {
    await client.application.commands.set([
      { name: 'ping', description: 'Проверить задержку бота' },
      { name: 'uptime', description: 'Показать время работы бота' },
      { name: 'save_channels', description: 'Сохранить структуру каналов в память (админ)' },
      { name: 'backup_info', description: 'Показать информацию о бэкапе (админ)' },
      { name: 'restore_backup', description: 'Восстановить каналы из бэкапа (админ)' },
      { name: 'invites', description: 'Показать топ пригласивших' }
    ]);
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации команд:', error);
  }
});

// ========== ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ ==========
client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // ========== КНОПКА СНЯТИЯ ТАЙМАУТА ==========
  if (interaction.isButton() && interaction.customId.startsWith('remove_timeout_')) {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    const targetUserId = interaction.customId.replace('remove_timeout_', '');
    
    try {
      const guild = interaction.guild || client.guilds.cache.get(cfg.guildId);
      const member = await guild.members.fetch(targetUserId).catch(() => null);
      
      if (!member) {
        return interaction.reply({ content: '❌ Участник не найден!', ephemeral: true });
      }
      
      if (!member.communicationDisabledUntil) {
        return interaction.reply({ content: '❌ У участника нет таймаута!', ephemeral: true });
      }
      
      await member.timeout(null, `Таймаут снят администратором ${interaction.user.tag}`);
      timedOutUsers.delete(targetUserId);
      
      const embed = new EmbedBuilder()
        .setTitle('✅ ТАЙМАУТ СНЯТ')
        .setColor(0x00FF00)
        .setDescription(`Таймаут с участника **${member.user.tag}** успешно снят.`)
        .setTimestamp();
      
      await interaction.update({ embeds: [embed], components: [] });
      
    } catch (error) {
      console.error('❌ Ошибка снятия таймаута:', error);
      await interaction.reply({ content: `❌ Ошибка: ${error.message}`, ephemeral: true });
    }
  }
  
  // ========== /ping ==========
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const backup = savedChannels.get('full_backup');
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true });
    await interaction.editReply({ 
      content: `🏓 Понг! **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${client.ws.ping}ms**\n` +
               `💾 Бэкап: ${backup ? `${backup.totalChannels} каналов` : 'не создан'}\n` +
               `⏰ Аптайм: ${getUptimeShort()}`
    });
  }
  
  // ========== /uptime ==========
  if (interaction.isCommand() && interaction.commandName === 'uptime') {
    const embed = new EmbedBuilder()
      .setTitle('⏰ ВРЕМЯ РАБОТЫ БОТА')
      .setColor(0x3498DB)
      .setDescription(`**${getUptime()}**`)
      .addFields(
        { name: '📅 Запущен', value: `<t:${Math.floor(startTime / 1000)}:F>`, inline: true },
        { name: '🛡️ Анти-снос', value: '1 канал = таймаут 24ч', inline: true }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  }
  
  // ========== /save_channels ==========
  if (interaction.isCommand() && interaction.commandName === 'save_channels') {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const backupData = await saveAllChannels(interaction.guild);
      
      if (backupData) {
        const embed = new EmbedBuilder()
          .setTitle('💾 КАНАЛЫ СОХРАНЕНЫ')
          .setColor(0x00FF00)
          .setDescription(
            `**Сервер:** ${backupData.guildName}\n` +
            `**Категорий:** ${backupData.categories.length}\n` +
            `**Каналов:** ${backupData.totalChannels}\n` +
            `**Сохранено:** ${backupData.savedAt.toLocaleString('ru-RU')}`
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
    }
  }
  
  // ========== /backup_info ==========
  if (interaction.isCommand() && interaction.commandName === 'backup_info') {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    const backupData = savedChannels.get('full_backup');
    
    if (!backupData) {
      return interaction.reply({ content: '❌ Нет сохранённых данных! Используйте /save_channels', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
      .setTitle('📦 ИНФОРМАЦИЯ О БЭКАПЕ')
      .setColor(0x3498DB)
      .setDescription(
        `**Сервер:** ${backupData.guildName}\n` +
        `**Сохранено:** ${new Date(backupData.savedAt).toLocaleString('ru-RU')}\n` +
        `**Категорий:** ${backupData.categories.length}\n` +
        `**Каналов:** ${backupData.totalChannels}`
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // ========== /restore_backup ==========
  if (interaction.isCommand() && interaction.commandName === 'restore_backup') {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    const backupData = savedChannels.get('full_backup');
    
    if (!backupData) {
      return interaction.reply({ content: '❌ Нет сохранённых данных! Используйте /save_channels', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const result = await restoreFromBackup(interaction.guild);
      
      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle('✅ КАНАЛЫ ВОССТАНОВЛЕНЫ')
          .setColor(0x00FF00)
          .setDescription(
            `**Категорий создано:** ${result.categories}\n` +
            `**Каналов создано:** ${result.channels}`
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ content: `❌ ${result.error}` });
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
    }
  }
  
  // ========== /invites ==========
  if (interaction.isCommand() && interaction.commandName === 'invites') {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const guildInvites = await interaction.guild.invites.fetch();
      const inviterStats = new Collection();
      
      for (const invite of guildInvites.values()) {
        if (invite.inviter) {
          const stats = inviterStats.get(invite.inviter.id) || { user: invite.inviter, uses: 0 };
          stats.uses += invite.uses || 0;
          inviterStats.set(invite.inviter.id, stats);
        }
      }
      
      const sorted = Array.from(inviterStats.values())
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 15);
      
      if (sorted.length === 0) {
        return interaction.editReply({ content: '📭 Нет данных о приглашениях' });
      }
      
      const list = sorted.map((stat, i) => 
        `**${i + 1}.** ${stat.user} — **${stat.uses}** приглашений`
      ).join('\n');
      
      const embed = new EmbedBuilder()
        .setTitle('📨 ТОП ПРИГЛАСИВШИХ')
        .setColor(0x9B59B6)
        .setDescription(list)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      await interaction.editReply({ content: '❌ Ошибка получения статистики!' });
    }
  }
});

// ========== ОБРАБОТКА ОШИБОК ==========
client.on('error', e => console.error('❌ Ошибка клиента:', e));
process.on('unhandledRejection', e => console.error('❌ Необработанное отклонение:', e));

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN;
if (!token) { 
  console.error('❌ ТОКЕН НЕ НАЙДЕН!'); 
  process.exit(1); 
}

client.login(token);

// ========== HTTP СЕРВЕР ДЛЯ RENDER ==========
http.createServer((req, res) => { 
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); 
  const backup = savedChannels.get('full_backup');
  res.end(`
    <!DOCTYPE html>
    <html>
    <head><title>Winter Team Bot</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px;">
      <h1>✅ Winter Team Bot работает!</h1>
      <p>💾 Бэкап: ${backup ? `${backup.totalChannels} каналов` : 'не создан'}</p>
      <p>🛡️ Анти-снос: 1 канал = таймаут 24ч</p>
      <p>⏰ Аптайм: ${getUptime()}</p>
    </body>
    </html>
  `); 
}).listen(process.env.PORT || 3000);

console.log(`🌐 HTTP сервер запущен на порту ${process.env.PORT || 3000}`);
