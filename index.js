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
    GatewayIntentBits.GuildBans
  ]
});

// ========== ХРАНИЛИЩА В ПАМЯТИ ==========
const channelDeleteLog = new Collection(); // userId -> { count, firstDeleteTime }
const deletedChannels = new Collection(); // channelId -> { данные канала }
const activeTickets = new Collection(); // ticketId -> { данные тикета }
const autoDeleteTimeouts = new Collection(); // ticketId -> timeout
const pendingSends = new Collection(); // userId -> { данные для send }

let staffStats = new Collection(); // staffId -> { accepted, tag }

// ========== ПЕРЕМЕННЫЕ СОСТОЯНИЯ ==========
let ticketStatus = { stack1: true, stack2: true };

let stats = {
  stack1: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() },
  stack2: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() }
};

// Проверка сброса недельной статистики
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

// Очистка лога удалений каждые 10 секунд (анти-снос)
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of channelDeleteLog) {
    if (now - data.firstDeleteTime > 10000) {
      channelDeleteLog.delete(userId);
    }
  }
}, 10000);

// ========== ПОЛУЧЕНИЕ КОНФИГУРАЦИИ ==========
const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    ticketCategory: process.env.TICKET_CATEGORY,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2,
    logChannelId: process.env.LOG_CHANNEL_ID,
    memberRoleId: process.env.MEMBER_ROLE_ID
  };
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function getWorkingHoursMessage() {
  const now = new Date();
  const mskHour = (now.getUTCHours() + 3) % 24;
  if (mskHour >= 10 && mskHour < 21) return '';
  return `\n**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n⏰ *Заявки рассматриваются с 10:00 до 21:00 по МСК.*`;
}

async function sendLog(guild, embed) {
  try {
    const cfg = getConfig();
    if (!cfg.logChannelId) return;
    
    const channel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!channel) return;
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Ошибка отправки лога:', error);
  }
}

function scheduleInactiveDelete(channelId, ticketId) {
  const timeout = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const messages = await channel.messages.fetch({ limit: 5 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        
        if (messages.size <= 1 || (messages.size === 2 && botMessages.size >= 1)) {
          await channel.send('🗑️ **Тикет автоматически закрыт (неактивность 48 часов).**');
          setTimeout(async () => {
            try { await channel.delete(); } catch (error) {}
          }, 5000);
        }
      }
      activeTickets.delete(ticketId);
      autoDeleteTimeouts.delete(ticketId);
    } catch (error) {
      console.error('❌ Ошибка авто-удаления неактивного тикета:', error);
    }
  }, 48 * 60 * 60 * 1000);
  
  autoDeleteTimeouts.set(ticketId, timeout);
}

async function cleanupOldChannels(guild) {
  const cfg = getConfig();
  if (!cfg.ticketCategory) return;
  
  const category = await guild.channels.fetch(cfg.ticketCategory).catch(() => null);
  if (!category) return;
  
  const now = Date.now();
  const inactiveThreshold = 48 * 60 * 60 * 1000;
  
  for (const channel of category.children.cache.values()) {
    if (!channel.isTextBased()) continue;
    if (!channel.name.startsWith('🔥｜') && !channel.name.startsWith('💧｜')) continue;
    
    try {
      const messages = await channel.messages.fetch({ limit: 5 });
      
      if (messages.size === 0) {
        await channel.delete().catch(() => {});
        console.log(`🗑️ Удалён пустой канал: ${channel.name}`);
        continue;
      }
      
      const lastMessage = messages.first();
      if (lastMessage) {
        const timeSinceLastMessage = now - lastMessage.createdTimestamp;
        
        if (timeSinceLastMessage > inactiveThreshold) {
          const humanMessages = messages.filter(m => !m.author.bot);
          
          if (humanMessages.size === 0) {
            await channel.send('🗑️ **Тикет автоматически закрыт (неактивность 48 часов).**');
            setTimeout(async () => {
              try { await channel.delete(); } catch (error) {}
            }, 5000);
            console.log(`🗑️ Удалён неактивный канал: ${channel.name}`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Ошибка проверки канала ${channel.name}:`, error);
    }
  }
  
  console.log('✅ Проверка старых каналов завершена');
}

async function createTicketMessage(channel, stackType) {
  const isStack1 = stackType === 'stack1';
  const stackName = isStack1 ? 'СТАК 1' : 'СТАК 2';
  const hours = isStack1 ? '3500' : '2500';
  
  const embed = new EmbedBuilder()
    .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН WT')
    .setDescription(
      `**ТРЕБОВАНИЯ ДЛЯ ${stackName}:**\n\n` +
      `● ${hours} часов на аккаунте и более\n● 15+ лет\n● Иметь хороший микрофон\n` +
      `● Умение слушать коллы и адекватно реагировать на критику\n● Минимум 6 часов стабильного онлайна в день\n\n` +
      `**Статус набора:** ${ticketStatus[stackType] ? '🟢 Открыт' : '🔴 Закрыт'}\n\nНажмите кнопку ниже, чтобы заполнить анкету.`
    )
    .setColor(0x3498DB)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`create_ticket_${stackType}`).setLabel(`📝 Подать заявку в ${stackName}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`toggle_${stackType}`).setEmoji(ticketStatus[stackType] ? '🟢' : '🔴').setStyle(ButtonStyle.Secondary)
  );

  return await channel.send({ embeds: [embed], components: [row] });
}

const startTime = Date.now();

function getUptime() {
  const diff = Date.now() - startTime;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  let result = '';
  if (days > 0) result += `${days}д `;
  if (hours > 0) result += `${hours}ч `;
  result += `${minutes}м`;
  return result;
}

async function updateStaffRole(guild, staffId, acceptedCount) {
  try {
    const member = await guild.members.fetch(staffId).catch(() => null);
    if (!member) return;
    
    const roleName = `📋 Принял ${acceptedCount} заявок`;
    
    const oldRoles = member.roles.cache.filter(r => r.name.startsWith('📋 Принял '));
    for (const role of oldRoles.values()) {
      await member.roles.remove(role).catch(() => {});
      if (role.members.size === 1) {
        await role.delete().catch(() => {});
      }
    }
    
    let newRole = guild.roles.cache.find(r => r.name === roleName);
    if (!newRole) {
      newRole = await guild.roles.create({
        name: roleName,
        color: 0x3498DB,
        reason: `Статистика принятых заявок для ${member.user.tag}`
      });
    }
    
    await member.roles.add(newRole);
    console.log(`✅ Роль "${roleName}" выдана ${member.user.tag}`);
  } catch (error) {
    console.error('❌ Ошибка обновления роли стаффа:', error);
  }
}

async function restoreChannel(guild, channelData) {
  try {
    let parentId = null;
    
    if (channelData.parentName) {
      const parent = guild.channels.cache.find(c => 
        c.type === ChannelType.GuildCategory && c.name === channelData.parentName
      );
      if (parent) parentId = parent.id;
    } else if (channelData.parentId) {
      parentId = channelData.parentId;
    }
    
    if (channelData.type === 'text') {
      return await guild.channels.create({
        name: channelData.name,
        type: ChannelType.GuildText,
        parent: parentId,
        position: channelData.position,
        topic: channelData.topic || undefined,
        nsfw: channelData.nsfw || false,
        rateLimitPerUser: channelData.rateLimitPerUser || 0
      });
    } else if (channelData.type === 'voice') {
      return await guild.channels.create({
        name: channelData.name,
        type: ChannelType.GuildVoice,
        parent: parentId,
        position: channelData.position,
        bitrate: channelData.bitrate || 64000,
        userLimit: channelData.userLimit || 0
      });
    } else if (channelData.type === 'category') {
      return await guild.channels.create({
        name: channelData.name,
        type: ChannelType.GuildCategory,
        position: channelData.position
      });
    }
  } catch (error) {
    console.error(`❌ Ошибка восстановления канала ${channelData.name}:`, error);
    return null;
  }
}

// ========== ЗАЩИТА ОТ СНОСА ==========
client.on('channelDelete', async (channel) => {
  try {
    if (channel.type === ChannelType.DM || !channel.guild) return;
    
    const guild = channel.guild;
    const auditLogs = await guild.fetchAuditLogs({ type: 12, limit: 1 });
    const deleteLog = auditLogs.entries.first();
    
    if (!deleteLog) return;
    
    const { executor } = deleteLog;
    
    if (executor.bot) return;
    if (executor.id === guild.ownerId || executor.permissions.has(PermissionFlagsBits.Administrator)) {
      return;
    }
    
    console.log(`🗑️ Канал "${channel.name}" удалён пользователем ${executor.tag}`);
    
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
    
    deletedChannels.set(channel.id, channelData);
    setTimeout(() => deletedChannels.delete(channel.id), 60 * 60 * 1000);
    
    const now = Date.now();
    const userLog = channelDeleteLog.get(executor.id) || { count: 0, firstDeleteTime: now };
    userLog.count++;
    userLog.firstDeleteTime = userLog.firstDeleteTime || now;
    channelDeleteLog.set(executor.id, userLog);
    
    if (userLog.count >= 3 && (now - userLog.firstDeleteTime) <= 10000) {
      console.log(`🚨 АНТИ-СНОС: ${executor.tag} удалил ${userLog.count} каналов за 10 секунд!`);
      
      try {
        await executor.timeout(24 * 60 * 60 * 1000, 'Анти-снос: массовое удаление каналов');
      } catch (error) {
        console.error('❌ Ошибка тайм-аута:', error);
      }
      
      let restoredCount = 0;
      for (const [chId, chData] of deletedChannels) {
        const restored = await restoreChannel(guild, chData);
        if (restored) restoredCount++;
      }
      
      channelDeleteLog.delete(executor.id);
      
      const logEmbed = new EmbedBuilder()
        .setTitle('🚨 АНТИ-СНОС АКТИВИРОВАН')
        .setColor(0xFF0000)
        .addFields(
          { name: '👤 Нарушитель', value: `${executor.tag} (${executor.id})`, inline: true },
          { name: '🗑️ Удалено', value: `${userLog.count}`, inline: true },
          { name: '🔄 Восстановлено', value: `${restoredCount}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(guild, logEmbed);
    }
    
  } catch (error) {
    console.error('❌ Ошибка в channelDelete:', error);
  }
});

// ========== ЗАПУСК БОТА ==========
client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  
  setInterval(() => {
    client.user.setActivity(`❤️ ${getUptime()}`, { type: 3 });
  }, 60000);
  
  client.user.setActivity(`❤️ ${getUptime()}`, { type: 3 });
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  if (guild) {
    await cleanupOldChannels(guild);
  }
  
  try {
    await client.application.commands.set([
      { name: 'ticket_stack1', description: 'Создать сообщение для подачи заявок в СТАК 1 (3500+ часов)' },
      { name: 'ticket_stack2', description: 'Создать сообщение для подачи заявок в СТАК 2 (2500+ часов)' },
      { name: 'stats', description: 'Показать статистику заявок за неделю (только для стаффа)' },
      { name: 'ping', description: 'Проверить задержку бота' },
      { name: 'send', description: 'Отправить сообщение от имени бота в канал',
        options: [
          { name: 'channel', description: 'Канал для отправки', type: 7, required: true },
          { name: 'text', description: 'Текст сообщения', type: 3, required: false },
          { name: 'name', description: 'Имя отправителя', type: 3, required: false },
          { name: 'avatar', description: 'Ссылка на аватарку', type: 3, required: false }
        ]
      },
      { name: 'unbanall', description: 'Разбанить всех забаненных участников (только для админа)' },
      { name: 'restore_channels', description: 'Восстановить последние удалённые каналы (только для админа)' },
      { name: 'restore_all', description: 'Восстановить ВСЕ удалённые каналы из памяти (только для админа)' },
      { name: 'deleted_list', description: 'Показать список удалённых каналов в памяти' },
      { name: 'clear_memory', description: 'Очистить память удалённых каналов (только для админа)' }
    ]);
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации команд:', error);
  }
});

// ========== ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ ==========
client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  const hasStaff = (cfg.staffRoleId_stack1 && interaction.member?.roles?.cache?.has(cfg.staffRoleId_stack1)) || 
                   (cfg.staffRoleId_stack2 && interaction.member?.roles?.cache?.has(cfg.staffRoleId_stack2)) ||
                   interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // ========== /ping ==========
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true });
    await interaction.editReply({ content: `🏓 Понг! ${sent.createdTimestamp - interaction.createdTimestamp}ms | API: ${client.ws.ping}ms\n🛡️ Каналов в памяти: ${deletedChannels.size}` });
  }
  
  // ========== /deleted_list ==========
  if (interaction.isCommand() && interaction.commandName === 'deleted_list') {
    if (!hasStaff && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Только для стаффа/админов!', ephemeral: true });
    }
    
    if (deletedChannels.size === 0) {
      return interaction.reply({ content: '📭 В памяти нет удалённых каналов', ephemeral: true });
    }
    
    const channels = Array.from(deletedChannels.values());
    const list = channels.slice(0, 20).map((ch, i) => 
      `**${i + 1}.** ${ch.type === 'text' ? '💬' : ch.type === 'voice' ? '🔊' : '📁'} **${ch.name}**`
    ).join('\n');
    
    const embed = new EmbedBuilder()
      .setTitle('🗑️ Удалённые каналы в памяти')
      .setColor(0xFFA500)
      .setDescription(list || 'Нет данных')
      .setFooter({ text: `Всего: ${deletedChannels.size} каналов | Хранятся 1 час` });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // ========== /restore_channels ==========
  if (interaction.isCommand() && interaction.commandName === 'restore_channels') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    if (deletedChannels.size === 0) {
      return interaction.reply({ content: '❌ В памяти нет удалённых каналов!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    let restoredCount = 0;
    const channelsToRestore = Array.from(deletedChannels.entries());
    
    for (const [chId, chData] of channelsToRestore) {
      const restored = await restoreChannel(interaction.guild, chData);
      if (restored) {
        restoredCount++;
        deletedChannels.delete(chId);
      }
    }
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Каналы восстановлены')
      .setColor(0x00FF00)
      .setDescription(`Восстановлено: **${restoredCount}** каналов\nОсталось в памяти: **${deletedChannels.size}**`);
    
    await interaction.editReply({ embeds: [embed] });
  }
  
  // ========== /restore_all ==========
  if (interaction.isCommand() && interaction.commandName === 'restore_all') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    if (deletedChannels.size === 0) {
      return interaction.reply({ content: '❌ В памяти нет удалённых каналов!', ephemeral: true });
    }
    
    await interaction.deferReply();
    
    let restoredCount = 0;
    const channelsToRestore = Array.from(deletedChannels.entries());
    
    for (const [chId, chData] of channelsToRestore) {
      const restored = await restoreChannel(interaction.guild, chData);
      if (restored) {
        restoredCount++;
        deletedChannels.delete(chId);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const embed = new EmbedBuilder()
      .setTitle('✅ ВСЕ КАНАЛЫ ВОССТАНОВЛЕНЫ')
      .setColor(0x00FF00)
      .setDescription(`Восстановлено: **${restoredCount}** каналов\nПамять очищена`)
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }
  
  // ========== /clear_memory ==========
  if (interaction.isCommand() && interaction.commandName === 'clear_memory') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Только для администраторов!', ephemeral: true });
    }
    
    const count = deletedChannels.size;
    deletedChannels.clear();
    
    await interaction.reply({ content: `🧹 Память очищена! Удалено **${count}** записей о каналах.`, ephemeral: true });
  }
  
  // ========== /unbanall ==========
  if (interaction.isCommand() && interaction.commandName === 'unbanall') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ У вас нет прав! Только администратор.', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const bans = await interaction.guild.bans.fetch();
      
      if (bans.size === 0) {
        return interaction.editReply({ content: 'ℹ️ На сервере нет забаненных участников.' });
      }
      
      let unbannedCount = 0;
      let failedCount = 0;
      
      for (const ban of bans.values()) {
        try {
          await interaction.guild.members.unban(ban.user.id);
          unbannedCount++;
        } catch (error) {
          failedCount++;
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🔓 РАЗБАН ВСЕХ УЧАСТНИКОВ')
        .setColor(0x00FF00)
        .setDescription(`**Успешно разбанено:** ${unbannedCount}\n**Ошибок:** ${failedCount}`)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      
      const logEmbed = new EmbedBuilder()
        .setTitle('🔓 Массовый разбан')
        .setColor(0x00FF00)
        .addFields(
          { name: '👮 Администратор', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📊 Разбанено', value: `${unbannedCount}`, inline: true },
          { name: '❌ Ошибок', value: `${failedCount}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
      
    } catch (error) {
      console.error('❌ Ошибка разбана:', error);
      await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
    }
  }
  
  // ========== /stats ==========
  if (interaction.isCommand() && interaction.commandName === 'stats') {
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const totalWeekAccepted = stats.stack1.weekAccepted + stats.stack2.weekAccepted;
    const totalWeekDenied = stats.stack1.weekDenied + stats.stack2.weekDenied;
    const totalAutoDenied = (stats.stack1.autoDenied || 0) + (stats.stack2.autoDenied || 0);
    
    const sortedStaff = [...staffStats.entries()]
      .sort((a, b) => b[1].accepted - a[1].accepted)
      .slice(0, 10);
    
    let staffList = sortedStaff.length > 0 
      ? sortedStaff.map(([id, data]) => `<@${id}> — **${data.accepted}**`).join('\n')
      : 'Нет данных';
    
    const embed = new EmbedBuilder()
      .setTitle('📊 СТАТИСТИКА ЗА НЕДЕЛЮ')
      .setColor(0x3498DB)
      .addFields(
        { name: '🔥 СТАК 1', value: `✅ ${stats.stack1.weekAccepted} | ❌ ${stats.stack1.weekDenied}`, inline: true },
        { name: '💧 СТАК 2', value: `✅ ${stats.stack2.weekAccepted} | ❌ ${stats.stack2.weekDenied}`, inline: true },
        { name: '━━━━━━━━━━━━━━━━━━', value: `🎯 **Всего:** ✅ ${totalWeekAccepted} | ❌ ${totalWeekDenied} | 🤖 ${totalAutoDenied}`, inline: false },
        { name: '🔧 Статус набора', value: `🔥 ${ticketStatus.stack1 ? '🟢' : '🔴'} | 💧 ${ticketStatus.stack2 ? '🟢' : '🔴'}`, inline: true },
        { name: '👑 Топ стаффа (принято)', value: staffList, inline: false }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // ========== /ticket_stack1 и /ticket_stack2 ==========
  if (interaction.isCommand() && (interaction.commandName === 'ticket_stack1' || interaction.commandName === 'ticket_stack2')) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    }
    const stack = interaction.commandName === 'ticket_stack1' ? 'stack1' : 'stack2';
    await createTicketMessage(interaction.channel, stack);
    await interaction.reply({ content: `✅ Сообщение для ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'} создано!`, ephemeral: true });
  }
  
  // ========== /send ==========
  if (interaction.isCommand() && interaction.commandName === 'send') {
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const channel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('text') || '';
    const customName = interaction.options.getString('name') || 'Winter Team';
    const avatarUrl = interaction.options.getString('avatar') || client.user.displayAvatarURL();
    
    if (!channel.isTextBased()) {
      return interaction.reply({ content: '❌ Канал должен быть текстовым!', ephemeral: true });
    }
    
    try {
      const webhook = await channel.createWebhook({
        name: customName,
        avatar: avatarUrl
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription(text || '​');
      
      await webhook.send({ embeds: [embed] });
      await webhook.delete();
      
      await interaction.reply({ content: `✅ Сообщение отправлено в ${channel} от имени **${customName}**!`, ephemeral: true });
      
    } catch (error) {
      console.error('❌ Ошибка:', error);
      await interaction.reply({ content: `❌ Ошибка: ${error.message}`, ephemeral: true });
    }
  }
  
  // ========== КНОПКИ СТАТУСА НАБОРА ==========
  if (interaction.isButton() && (interaction.customId === 'toggle_stack1' || interaction.customId === 'toggle_stack2')) {
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const stack = interaction.customId === 'toggle_stack1' ? 'stack1' : 'stack2';
    ticketStatus[stack] = !ticketStatus[stack];
    
    const embed = EmbedBuilder.from(interaction.message.embeds[0]).setDescription(
      interaction.message.embeds[0].description.replace(/Статус набора:.*/, `**Статус набора:** ${ticketStatus[stack] ? '🟢 Открыт' : '🔴 Закрыт'}`)
    );
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`create_ticket_${stack}`).setLabel(`📝 Подать заявку в ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'}`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`toggle_${stack}`).setEmoji(ticketStatus[stack] ? '🟢' : '🔴').setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({ embeds: [embed], components: [row] });
    
    const logEmbed = new EmbedBuilder()
      .setTitle(ticketStatus[stack] ? '🟢 НАБОР ОТКРЫТ' : '🔴 НАБОР ЗАКРЫТ')
      .setDescription(`**${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'}** — набор ${ticketStatus[stack] ? 'открыт' : 'закрыт'}`)
      .setColor(ticketStatus[stack] ? 0x00FF00 : 0xFF0000)
      .addFields({ name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true })
      .setTimestamp();
    
    await sendLog(interaction.guild, logEmbed);
  }
  
  // ========== КНОПКИ ОТКРЫТИЯ АНКЕТЫ ==========
  if (interaction.isButton() && (interaction.customId === 'create_ticket_stack1' || interaction.customId === 'create_ticket_stack2')) {
    const stack = interaction.customId === 'create_ticket_stack1' ? 'stack1' : 'stack2';
    if (!ticketStatus[stack]) return interaction.reply({ content: '❌ Набор закрыт!', ephemeral: true });
    
    const modal = new ModalBuilder().setCustomId(`app_${stack}`).setTitle(`Заявка в ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'}`);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Имя').setPlaceholder('Артём').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('age').setLabel('Возраст (цифры)').setPlaceholder('15').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('steam').setLabel('Steam ссылка').setPlaceholder('https://steamcommunity.com/...').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hours').setLabel('Часы (цифры)').setPlaceholder(stack === 'stack1' ? '3500' : '2500').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role').setLabel('Роль').setPlaceholder('Строитель, ПвПшник...').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))
    );
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА АНКЕТЫ ==========
  if (interaction.isModalSubmit() && interaction.customId.startsWith('app_')) {
    const stack = interaction.customId.replace('app_', '');
    const name = interaction.fields.getTextInputValue('name');
    const age = parseInt(interaction.fields.getTextInputValue('age'));
    const steam = interaction.fields.getTextInputValue('steam');
    const hours = parseInt(interaction.fields.getTextInputValue('hours'));
    const role = interaction.fields.getTextInputValue('role');
    
    if (isNaN(age)) return interaction.reply({ content: '❌ Возраст - только цифры!', ephemeral: true });
    if (!steam.includes('steamcommunity.com')) return interaction.reply({ content: '❌ Некорректная Steam ссылка!', ephemeral: true });
    if (isNaN(hours)) return interaction.reply({ content: '❌ Часы - только цифры!', ephemeral: true });
    
    const minHours = stack === 'stack1' ? 3500 : 2500;
    if (hours < minHours) {
      if (stack === 'stack1') { stats.stack1.denied++; stats.stack1.weekDenied++; stats.stack1.autoDenied = (stats.stack1.autoDenied||0)+1; }
      else { stats.stack2.denied++; stats.stack2.weekDenied++; stats.stack2.autoDenied = (stats.stack2.autoDenied||0)+1; }
      
      const logEmbed = new EmbedBuilder()
        .setTitle('🤖 Заявка отклонена автоматически')
        .setColor(0xFF0000)
        .addFields(
          { name: '👤 Заявитель', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true },
          { name: '⏰ Часы', value: `${hours} / ${minHours}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
      
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('❌ Отклонено').setDescription(`Часов: ${hours}, нужно: ${minHours}+`).setColor(0xFF0000)], ephemeral: true });
    }
    
    await interaction.reply({ content: '⏳ Создаю тикет...', ephemeral: true });
    
    try {
      const staffRole = stack === 'stack1' ? cfg.staffRoleId_stack1 : cfg.staffRoleId_stack2;
      
      const permissionOverwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ];
      
      if (staffRole) {
        permissionOverwrites.push({ id: staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
      }
      
      const channelOptions = {
        name: `${stack === 'stack1' ? '🔥' : '💧'}｜${stack === 'stack1' ? 'СТАК-1' : 'СТАК-2'}｜${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: permissionOverwrites
      };
      
      if (cfg.ticketCategory) {
        try {
          const category = await interaction.guild.channels.fetch(cfg.ticketCategory).catch(() => null);
          if (category) channelOptions.parent = cfg.ticketCategory;
        } catch (error) {}
      }
      
      const channel = await interaction.guild.channels.create(channelOptions);
      
      const ticketId = `${interaction.user.id}_${stack}`;
      activeTickets.set(ticketId, { channelId: channel.id, userId: interaction.user.id, stackType: stack, status: 'pending', createdAt: Date.now() });
      
      scheduleInactiveDelete(channel.id, ticketId);
      
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setDescription(`### <@${interaction.user.id}> подал заявку в **${stack === 'stack1' ? 'СТАК-1' : 'СТАК-2'}**\n━━━━━━━━━━━━━━━━━━\n👤 **Имя:** ${name}\n🎂 **Возраст:** ${age}\n🔗 **Steam:** ${steam}\n⏰ **Часы:** ${hours} ч\n🎯 **Роль:** ${role}${getWorkingHoursMessage()}`);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${interaction.user.id}_${stack}`).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`consider_${interaction.user.id}_${stack}`).setEmoji('⏳').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`call_${interaction.user.id}_${stack}`).setEmoji('📞').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`deny_${interaction.user.id}_${stack}`).setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`close_${channel.id}`).setEmoji('🔒').setStyle(ButtonStyle.Secondary)
      );
      
      let content = '';
      if (staffRole) content = `<@&${staffRole}>`;
      
      await channel.send({ content, embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ Заявка создана: ${channel}` });
      
      const logEmbed = new EmbedBuilder()
        .setTitle('📝 Новая заявка')
        .setColor(0x3498DB)
        .addFields(
          { name: '👤 Заявитель', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true },
          { name: '⏰ Часы', value: `${hours}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
      
    } catch (error) {
      console.error('❌ Ошибка создания тикета:', error);
      await interaction.editReply('❌ Ошибка создания!');
    }
  }
  
  // ========== КНОПКИ УПРАВЛЕНИЯ ТИКЕТОМ ==========
  if (interaction.isButton()) {
    const id = interaction.customId;
    
    // Закрытие тикета
    if (id.startsWith('close_')) {
      const channelId = id.split('_')[1];
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.reply({ content: '🔒 Закрываю...', ephemeral: true });
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      
      for (const [tid, t] of activeTickets) {
        if (t.channelId === channelId) {
          clearTimeout(autoDeleteTimeouts.get(tid));
          activeTickets.delete(tid);
          break;
        }
      }
      
      setTimeout(() => channel?.delete().catch(() => {}), 2000);
      
      if (channel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('🔒 Тикет закрыт')
          .setColor(0x808080)
          .addFields(
            { name: '📁 Канал', value: channel.name, inline: true },
            { name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        
        await sendLog(interaction.guild, logEmbed);
      }
    }
    
    // Принятие заявки
    if (id.startsWith('accept_')) {
      const [_, userId, stack] = id.split('_');
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const ticketId = `${userId}_${stack}`;
      clearTimeout(autoDeleteTimeouts.get(ticketId));
      
      if (stack === 'stack1') { stats.stack1.accepted++; stats.stack1.weekAccepted++; } 
      else { stats.stack2.accepted++; stats.stack2.weekAccepted++; }
      
      const staffId = interaction.user.id;
      if (!staffStats.has(staffId)) {
        staffStats.set(staffId, { accepted: 0, tag: interaction.user.tag });
      }
      staffStats.get(staffId).accepted++;
      
      await updateStaffRole(interaction.guild, staffId, staffStats.get(staffId).accepted);
      
      if (cfg.memberRoleId) {
        await interaction.guild.members.fetch(userId).then(m => m.roles.add(cfg.memberRoleId)).catch(() => {});
      }
      
      await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF00)], components: [] });
      await interaction.channel.send(`<@${userId}> 🎉 Заявка принята!`);
      
      setTimeout(() => interaction.channel.delete().catch(() => {}), 30 * 60 * 1000);
      await interaction.channel.send(`⏰ **Этот канал будет автоматически удалён через 30 минут.**`);
      
      activeTickets.delete(ticketId);
      
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Заявка принята')
        .setColor(0x00FF00)
        .addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
    }
    
    // На рассмотрении
    if (id.startsWith('consider_')) {
      const [_, userId, stack] = id.split('_');
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFFA500)], components: interaction.message.components });
      await interaction.channel.send(`<@${userId}> ⏳ Заявка на рассмотрении.`);
      
      const logEmbed = new EmbedBuilder()
        .setTitle('⏳ Заявка на рассмотрении')
        .setColor(0xFFA500)
        .addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
    }
    
    // Обзвон
    if (id.startsWith('call_')) {
      const [_, userId, stack] = id.split('_');
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x808080)], components: interaction.message.components });
      const vc = interaction.member.voice.channel;
      const invite = vc ? await vc.createInvite({ maxAge: 86400, maxUses: 1 }).catch(() => null) : null;
      await interaction.channel.send(`<@${userId}> 📞 Обзвон!${invite ? `\n🔊 ${invite.url}` : ''}`);
      
      const logEmbed = new EmbedBuilder()
        .setTitle('📞 Обзвон')
        .setColor(0x808080)
        .addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
    }
    
    // Отклонение
    if (id.startsWith('deny_')) {
      const [_, userId, stack] = id.split('_');
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const modal = new ModalBuilder()
        .setCustomId(`deny_reason_${userId}_${stack}_${interaction.channel.id}`)
        .setTitle('❌ Причина отклонения');
      
      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Укажите причину отклонения')
        .setPlaceholder('Например: Недостаточно часов...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500);
      
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
  }
  
  // ========== ОБРАБОТКА ПРИЧИНЫ ОТКЛОНЕНИЯ ==========
  if (interaction.isModalSubmit() && interaction.customId.startsWith('deny_reason_')) {
    const [_, userId, stack, channelId] = interaction.customId.split('_');
    const reason = interaction.fields.getTextInputValue('reason');
    
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      
      if (stack === 'stack1') { stats.stack1.denied++; stats.stack1.weekDenied++; } 
      else { stats.stack2.denied++; stats.stack2.weekDenied++; }
      
      const ticketId = `${userId}_${stack}`;
      clearTimeout(autoDeleteTimeouts.get(ticketId));
      activeTickets.delete(ticketId);
      
      if (channel) {
        await channel.send(`<@${userId}> 😔 **Заявка отклонена.**\n**Причина:** ${reason}`);
        setTimeout(() => channel.delete().catch(() => {}), 5000);
      }
      
      try {
        const targetUser = await client.users.fetch(userId);
        await targetUser.send({
          embeds: [new EmbedBuilder()
            .setTitle(`❌ ЗАЯВКА ОТКЛОНЕНА | ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'}`)
            .setColor(0xFF0000)
            .setDescription(`**Причина:** ${reason}\n\nВы можете подать заявку повторно позже.`)
          ]
        });
      } catch (error) {}
      
      await interaction.editReply({ content: '✅ Заявка отклонена!', ephemeral: true });
      
      const logEmbed = new EmbedBuilder()
        .setTitle('❌ Заявка отклонена')
        .setColor(0xFF0000)
        .addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
      
    } catch (error) {
      console.error('❌ Ошибка отклонения:', error);
      await interaction.editReply('❌ Ошибка!');
    }
  }
});

// ========== ОБРАБОТКА ОШИБОК ==========
client.on('error', e => console.error('❌ Ошибка клиента:', e));
process.on('unhandledRejection', e => console.error('❌ Необработанное отклонение:', e));

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN;
if (!token) { 
  console.error('❌ ТОКЕН НЕ НАЙДЕН! Укажите DISCORD_TOKEN в переменных окружения Render'); 
  process.exit(1); 
}

client.login(token);

// ========== HTTP СЕРВЕР ДЛЯ RENDER ==========
http.createServer((req, res) => { 
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); 
  res.end(`
    <!DOCTYPE html>
    <html>
    <head><title>Winter Team Bot</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px;">
      <h1>✅ Winter Team Bot работает!</h1>
      <p>🛡️ Каналов в памяти: ${deletedChannels.size}</p>
      <p>⏰ Время работы: ${getUptime()}</p>
    </body>
    </html>
  `); 
}).listen(process.env.PORT || 3000);

console.log(`🌐 HTTP сервер запущен на порту ${process.env.PORT || 3000}`);
