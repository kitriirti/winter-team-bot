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
  } catch (error) {}
}

// ========== ОБНОВЛЕНИЕ РОЛИ СТАФФА ==========
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
    console.error(`❌ Ошибка обновления роли:`, error);
  }
}

// ========== СИСТЕМА ТИКЕТОВ ==========
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
    } catch (error) {}
  }, 48 * 60 * 60 * 1000);
  
  autoDeleteTimeouts.set(ticketId, timeout);
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

function isTicketChannel(channel) {
  const cfg = getConfig();
  if (channel.name.startsWith('🔥｜') || channel.name.startsWith('💧｜')) return true;
  if (cfg.ticketCategory && channel.parentId === cfg.ticketCategory) return true;
  return false;
}

// ========== СОХРАНЕНИЕ СТРУКТУРЫ КАНАЛОВ ==========
async function saveAllChannels(guild) {
  try {
    const categories = [];
    const standaloneChannels = [];
    
    for (const channel of guild.channels.cache.values()) {
      if (isTicketChannel(channel)) continue;
      
      if (channel.type === ChannelType.GuildCategory) {
        categories.push({
          name: channel.name,
          type: 'category',
          position: channel.position,
          channels: []
        });
      }
    }
    
    for (const channel of guild.channels.cache.values()) {
      if (isTicketChannel(channel)) continue;
      
      if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
        const channelData = {
          name: channel.name,
          type: channel.type === ChannelType.GuildText ? 'text' : 'voice',
          parentName: channel.parent?.name || null,
          position: channel.position,
          topic: channel.topic || null,
          nsfw: channel.nsfw || false,
          rateLimitPerUser: channel.rateLimitPerUser || 0,
          bitrate: channel.bitrate || null,
          userLimit: channel.userLimit || null
        };
        
        if (channel.parent) {
          const category = categories.find(c => c.name === channel.parent.name);
          if (category) category.channels.push(channelData);
        } else {
          standaloneChannels.push(channelData);
        }
      }
    }
    
    const backupData = {
      guildName: guild.name,
      exportedAt: new Date().toISOString(),
      categories: categories,
      standaloneChannels: standaloneChannels,
      totalChannels: categories.reduce((acc, cat) => acc + cat.channels.length, 0) + standaloneChannels.length
    };
    
    savedChannels.set('full_backup', backupData);
    console.log(`💾 Сохранено: ${categories.length} категорий, ${backupData.totalChannels} каналов`);
    return backupData;
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    return null;
  }
}

// ========== ЭКСПОРТ БЭКАПА (ОТПРАВЛЯЕТ JSON В ЧАТ) ==========
async function exportBackup(interaction) {
  try {
    const backupData = await saveAllChannels(interaction.guild);
    
    if (!backupData) {
      return { success: false, error: 'Не удалось создать бэкап' };
    }
    
    // Конвертируем в JSON строку
    const jsonString = JSON.stringify(backupData, null, 2);
    
    // Разбиваем на части если слишком большой (Discord лимит 2000 символов)
    const chunks = [];
    for (let i = 0; i < jsonString.length; i += 1900) {
      chunks.push(jsonString.slice(i, i + 1900));
    }
    
    return { success: true, chunks, backupData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ========== ИМПОРТ БЭКАПА (СОЗДАЁТ КАНАЛЫ ИЗ JSON) ==========
async function importBackup(guild, jsonString) {
  try {
    const backupData = JSON.parse(jsonString);
    
    let createdCategories = 0;
    let createdChannels = 0;
    const categoryMap = new Map();
    
    // Создаём категории
    for (const cat of backupData.categories) {
      try {
        // Проверяем, нет ли уже категории с таким именем
        const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === cat.name);
        if (!existing) {
          const newCategory = await guild.channels.create({
            name: cat.name,
            type: ChannelType.GuildCategory,
            position: cat.position
          });
          categoryMap.set(cat.name, newCategory.id);
          createdCategories++;
          console.log(`📁 Создана категория: ${cat.name}`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Задержка чтобы не спамить API
        } else {
          categoryMap.set(cat.name, existing.id);
          console.log(`📁 Категория уже существует: ${cat.name}`);
        }
      } catch (e) {
        console.error(`❌ Ошибка категории ${cat.name}:`, e.message);
      }
    }
    
    // Создаём каналы в категориях
    for (const cat of backupData.categories) {
      for (const ch of cat.channels) {
        try {
          const parentId = categoryMap.get(ch.parentName);
          
          // Проверяем, нет ли уже канала с таким именем в этой категории
          const existing = guild.channels.cache.find(c => c.name === ch.name && c.parentId === parentId);
          if (!existing) {
            if (ch.type === 'text') {
              await guild.channels.create({
                name: ch.name,
                type: ChannelType.GuildText,
                parent: parentId,
                position: ch.position,
                topic: ch.topic || undefined,
                nsfw: ch.nsfw || false,
                rateLimitPerUser: ch.rateLimitPerUser || 0
              });
            } else if (ch.type === 'voice') {
              await guild.channels.create({
                name: ch.name,
                type: ChannelType.GuildVoice,
                parent: parentId,
                position: ch.position,
                bitrate: ch.bitrate || 64000,
                userLimit: ch.userLimit || 0
              });
            }
            createdChannels++;
            console.log(`📋 Создан канал: ${ch.name}`);
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            console.log(`📋 Канал уже существует: ${ch.name}`);
          }
        } catch (e) {
          console.error(`❌ Ошибка канала ${ch.name}:`, e.message);
        }
      }
    }
    
    // Создаём каналы вне категорий
    for (const ch of backupData.standaloneChannels) {
      try {
        const existing = guild.channels.cache.find(c => c.name === ch.name && !c.parentId);
        if (!existing) {
          if (ch.type === 'text') {
            await guild.channels.create({
              name: ch.name,
              type: ChannelType.GuildText,
              position: ch.position,
              topic: ch.topic || undefined,
              nsfw: ch.nsfw || false,
              rateLimitPerUser: ch.rateLimitPerUser || 0
            });
          } else if (ch.type === 'voice') {
            await guild.channels.create({
              name: ch.name,
              type: ChannelType.GuildVoice,
              position: ch.position,
              bitrate: ch.bitrate || 64000,
              userLimit: ch.userLimit || 0
            });
          }
          createdChannels++;
          console.log(`📋 Создан канал: ${ch.name}`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e) {
        console.error(`❌ Ошибка канала ${ch.name}:`, e.message);
      }
    }
    
    return { 
      success: true, 
      categories: createdCategories, 
      channels: createdChannels,
      totalCategories: backupData.categories.length,
      totalChannels: backupData.totalChannels
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ========== ВОССТАНОВЛЕНИЕ ОДНОГО КАНАЛА ==========
async function restoreChannel(guild, channelData) {
  try {
    let parentId = null;
    if (channelData.parentName) {
      const parent = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === channelData.parentName);
      if (parent) parentId = parent.id;
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

// ========== АНТИ-СНОС ==========
client.on('channelDelete', async (channel) => {
  try {
    if (channel.type === ChannelType.DM || !channel.guild) return;
    
    const guild = channel.guild;
    
    if (isTicketChannel(channel)) {
      console.log(`🎫 Тикет-канал "${channel.name}" удалён — игнорируем`);
      
      for (const [ticketId, ticket] of activeTickets) {
        if (ticket.channelId === channel.id) {
          clearTimeout(autoDeleteTimeouts.get(ticketId));
          activeTickets.delete(ticketId);
          autoDeleteTimeouts.delete(ticketId);
          break;
        }
      }
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const auditLogs = await guild.fetchAuditLogs({ type: 12, limit: 10 });
    const deleteLog = auditLogs.entries.find(entry => 
      entry.target.id === channel.id && 
      Date.now() - entry.createdTimestamp < 10000
    );
    
    const executor = deleteLog?.executor;
    
    console.log(`🗑️ Канал "${channel.name}" удалён!`);
    if (executor) console.log(`👤 Удалил: ${executor.tag}`);
    
    const channelData = {
      name: channel.name,
      type: channel.type === ChannelType.GuildText ? 'text' : 
            (channel.type === ChannelType.GuildVoice ? 'voice' : 'category'),
      parentName: channel.parent?.name || null,
      position: channel.position,
      topic: channel.topic || null,
      nsfw: channel.nsfw || false,
      rateLimitPerUser: channel.rateLimitPerUser || 0,
      bitrate: channel.bitrate || null,
      userLimit: channel.userLimit || null,
      deletedAt: new Date()
    };
    
    if (!savedChannels.has('deleted_channels')) {
      savedChannels.set('deleted_channels', new Collection());
    }
    const deletedCollection = savedChannels.get('deleted_channels');
    deletedCollection.set(channel.id, channelData);
    
    if (deletedCollection.size > 50) {
      const firstKey = deletedCollection.keys().next().value;
      deletedCollection.delete(firstKey);
    }
    
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
          timeoutEnd: Date.now() + 24 * 60 * 60 * 1000,
          deletedChannel: channelData
        });
        
        const admins = guild.members.cache.filter(m => 
          m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot
        );
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`remove_timeout_${executor.id}`)
            .setLabel('🔓 Снять таймаут')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`restore_deleted_${channel.id}`)
            .setLabel('🔄 Восстановить канал')
            .setStyle(ButtonStyle.Primary)
        );
        
        const alertEmbed = new EmbedBuilder()
          .setTitle('🚨 АНТИ-СНОС: КАНАЛ УДАЛЁН!')
          .setColor(0xFF0000)
          .setDescription(
            `**Нарушитель:** ${executor.tag} (${executor.id})\n` +
            `**Удалённый канал:** ${channelData.name}\n` +
            `**Тип:** ${channelData.type}\n\n` +
            `**Наказание:** Таймаут 24 часа\n\n` +
            `Нажмите кнопку ниже чтобы снять таймаут или восстановить канал.`
          )
          .setTimestamp();
        
        for (const admin of admins.values()) {
          try {
            await admin.send({ embeds: [alertEmbed], components: [row] });
          } catch (e) {}
        }
        
        const cfg = getConfig();
        if (cfg.logChannelId) {
          const logChannel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🚨 АНТИ-СНОС: ТАЙМАУТ ВЫДАН')
              .setColor(0xFF0000)
              .addFields(
                { name: '👤 Нарушитель', value: executor.tag, inline: true },
                { name: '🗑️ Канал', value: channelData.name, inline: true },
                { name: '⏰ Наказание', value: '24 часа', inline: true }
              )
              .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
          }
        }
      } catch (error) {
        console.error(`❌ Ошибка выдачи таймаута:`, error);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка в channelDelete:', error);
  }
});

// ========== ПРИВЕТСТВИЕ (ТОЛЬКО ВЫДАЧА РОЛИ) ==========
client.on('guildMemberAdd', async (member) => {
  try {
    const cfg = getConfig();
    if (cfg.autoRoleId) {
      await member.roles.add(cfg.autoRoleId).catch(() => {});
      console.log(`✅ Роль выдана участнику ${member.user.tag}`);
    }
    
    try {
      const newInvites = await member.guild.invites.fetch();
      invites.set(member.guild.id, newInvites);
    } catch (error) {}
    
  } catch (error) {
    console.error('❌ Ошибка в guildMemberAdd:', error);
  }
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
      { name: 'ticket_stack1', description: 'Создать сообщение для подачи заявок в СТАК 1 (3500+ часов)' },
      { name: 'ticket_stack2', description: 'Создать сообщение для подачи заявок в СТАК 2 (2500+ часов)' },
      { name: 'stats', description: 'Показать статистику заявок за неделю (только для стаффа)' },
      { name: 'ping', description: 'Проверить задержку бота' },
      { name: 'uptime', description: 'Показать время работы бота' },
      { name: 'send', description: 'Отправить сообщение от имени бота в канал',
        options: [
          { name: 'channel', description: 'Канал для отправки', type: 7, required: true },
          { name: 'text', description: 'Текст сообщения', type: 3, required: false },
          { name: 'name', description: 'Имя отправителя', type: 3, required: false },
          { name: 'avatar', description: 'Ссылка на аватарку', type: 3, required: false }
        ]
      },
      { name: 'unbanall', description: 'Разбанить всех забаненных участников (только для админа)' },
      { name: 'invites', description: 'Показать топ пригласивших' },
      { name: 'save_channels', description: 'Сохранить структуру каналов в память (админ)' },
      { name: 'export_backup', description: '📤 Экспортировать структуру каналов в JSON (скопируйте код)' },
      { name: 'import_backup', description: '📥 Импортировать каналы из JSON кода',
        options: [
          { name: 'json', description: 'JSON код из команды /export_backup', type: 3, required: true }
        ]
      },
      { name: 'deleted_list', description: 'Показать список недавно удалённых каналов (админ)' }
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
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // ========== /export_backup ==========
  if (interaction.isCommand() && interaction.commandName === 'export_backup') {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const result = await exportBackup(interaction);
      
      if (result.success) {
        // Отправляем JSON по частям
        for (let i = 0; i < result.chunks.length; i++) {
          const chunk = result.chunks[i];
          const part = i + 1;
          const total = result.chunks.length;
          
          await interaction.followUp({
            content: `📤 **Часть ${part}/${total}**\n\`\`\`json\n${chunk}\n\`\`\``,
            ephemeral: true
          });
        }
        
        const embed = new EmbedBuilder()
          .setTitle('✅ ЭКСПОРТ ВЫПОЛНЕН')
          .setColor(0x00FF00)
          .setDescription(
            `**Сервер:** ${result.backupData.guildName}\n` +
            `**Категорий:** ${result.backupData.categories.length}\n` +
            `**Каналов:** ${result.backupData.totalChannels}\n\n` +
            `**📋 ИНСТРУКЦИЯ ПО ПЕРЕНОСУ:**\n` +
            `1. Скопируйте ВЕСЬ JSON код из сообщений выше\n` +
            `2. Объедините все части в один текст\n` +
            `3. На другом сервере используйте:\n` +
            `   \`/import_backup json: <вставьте JSON>\`\n\n` +
            `⚠️ Важно: JSON должен быть без разрывов!`
          )
          .setTimestamp();
        
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      } else {
        await interaction.editReply({ content: `❌ ${result.error}` });
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
    }
  }
  
  // ========== /import_backup ==========
  if (interaction.isCommand() && interaction.commandName === 'import_backup') {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    const jsonInput = interaction.options.getString('json');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const result = await importBackup(interaction.guild, jsonInput);
      
      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle('✅ ИМПОРТ ВЫПОЛНЕН')
          .setColor(0x00FF00)
          .setDescription(
            `**Категорий создано:** ${result.categories} / ${result.totalCategories}\n` +
            `**Каналов создано:** ${result.channels} / ${result.totalChannels}\n\n` +
            `⚠️ Существующие каналы пропущены.`
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ content: `❌ Ошибка импорта: ${result.error}` });
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
    }
  }
  
  // ========== КНОПКА ВОССТАНОВЛЕНИЯ УДАЛЁННОГО КАНАЛА ==========
  if (interaction.isButton() && interaction.customId.startsWith('restore_deleted_')) {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    const channelId = interaction.customId.replace('restore_deleted_', '');
    const deletedCollection = savedChannels.get('deleted_channels');
    
    if (!deletedCollection) {
      return interaction.reply({ content: '❌ Нет сохранённых удалённых каналов!', ephemeral: true });
    }
    
    const channelData = deletedCollection.get(channelId);
    
    if (!channelData) {
      return interaction.reply({ content: '❌ Данные канала не найдены!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const restored = await restoreChannel(interaction.guild, channelData);
      
      if (restored) {
        deletedCollection.delete(channelId);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ КАНАЛ ВОССТАНОВЛЕН')
          .setColor(0x00FF00)
          .setDescription(`Канал **${channelData.name}** успешно восстановлен!`)
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ content: '❌ Не удалось восстановить канал!' });
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
    }
  }
  
  // ========== /deleted_list ==========
  if (interaction.isCommand() && interaction.commandName === 'deleted_list') {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    const deletedCollection = savedChannels.get('deleted_channels');
    
    if (!deletedCollection || deletedCollection.size === 0) {
      return interaction.reply({ content: '📭 Нет удалённых каналов в памяти', ephemeral: true });
    }
    
    const channels = Array.from(deletedCollection.values());
    const list = channels.slice(0, 20).map((ch, i) => 
      `**${i + 1}.** ${ch.type === 'text' ? '💬' : ch.type === 'voice' ? '🔊' : '📁'} **${ch.name}** — ${new Date(ch.deletedAt).toLocaleTimeString('ru-RU')}`
    ).join('\n');
    
    const embed = new EmbedBuilder()
      .setTitle('🗑️ НЕДАВНО УДАЛЁННЫЕ КАНАЛЫ')
      .setColor(0xFFA500)
      .setDescription(list || 'Нет данных')
      .setFooter({ text: `Всего: ${deletedCollection.size} каналов` });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // ========== КНОПКА СНЯТИЯ ТАЙМАУТА ==========
  if (interaction.isButton() && interaction.customId.startsWith('remove_timeout_')) {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    const targetUserId = interaction.customId.replace('remove_timeout_', '');
    
    try {
      const guild = interaction.guild || client.guilds.cache.get(cfg.guildId);
      const member = await guild.members.fetch(targetUserId).catch(() => null);
      
      if (!member) return interaction.reply({ content: '❌ Участник не найден!', ephemeral: true });
      if (!member.communicationDisabledUntil) return interaction.reply({ content: '❌ Нет таймаута!', ephemeral: true });
      
      await member.timeout(null, `Снят админом ${interaction.user.tag}`);
      timedOutUsers.delete(targetUserId);
      
      const embed = new EmbedBuilder()
        .setTitle('✅ ТАЙМАУТ СНЯТ')
        .setColor(0x00FF00)
        .setDescription(`Таймаут с **${member.user.tag}** снят.`)
        .setTimestamp();
      
      await interaction.update({ embeds: [embed], components: [] });
    } catch (error) {
      await interaction.reply({ content: `❌ Ошибка: ${error.message}`, ephemeral: true });
    }
  }
  
  // ========== /ping ==========
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true });
    await interaction.editReply({ content: `🏓 Понг! **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${client.ws.ping}ms**` });
  }
  
  // ========== /uptime ==========
  if (interaction.isCommand() && interaction.commandName === 'uptime') {
    const embed = new EmbedBuilder()
      .setTitle('⏰ ВРЕМЯ РАБОТЫ БОТА')
      .setColor(0x3498DB)
      .setDescription(`**${getUptime()}**`)
      .addFields({ name: '📅 Запущен', value: `<t:${Math.floor(startTime / 1000)}:F>`, inline: true });
    
    await interaction.reply({ embeds: [embed] });
  }
  
  // ========== /save_channels ==========
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
      
      if (sorted.length === 0) return interaction.editReply({ content: '📭 Нет данных' });
      
      const list = sorted.map((stat, i) => `**${i + 1}.** ${stat.user} — **${stat.uses}** приглашений`).join('\n');
      
      const embed = new EmbedBuilder()
        .setTitle('📨 ТОП ПРИГЛАСИВШИХ')
        .setColor(0x9B59B6)
        .setDescription(list)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: '❌ Ошибка!' });
    }
  }
  
  // ========== /unbanall ==========
  if (interaction.isCommand() && interaction.commandName === 'unbanall') {
    if (!isAdmin) return interaction.reply({ content: '❌ Только для админов!', ephemeral: true });
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const bans = await interaction.guild.bans.fetch();
      if (bans.size === 0) return interaction.editReply({ content: 'ℹ️ Нет забаненных участников.' });
      
      let unbannedCount = 0;
      for (const ban of bans.values()) {
        try {
          await interaction.guild.members.unban(ban.user.id);
          unbannedCount++;
        } catch (error) {}
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🔓 РАЗБАН ВСЕХ')
        .setColor(0x00FF00)
        .setDescription(`**Разбанено:** ${unbannedCount}`);
      
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
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
        { name: '👑 Топ стаффа', value: staffList, inline: false }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // ========== /ticket_stack1 и /ticket_stack2 ==========
  if (interaction.isCommand() && (interaction.commandName === 'ticket_stack1' || interaction.commandName === 'ticket_stack2')) {
    if (!isAdmin) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const stack = interaction.commandName === 'ticket_stack1' ? 'stack1' : 'stack2';
    await createTicketMessage(interaction.channel, stack);
    await interaction.reply({ content: `✅ Сообщение для ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'} создано!`, ephemeral: true });
  }
  
  // ========== /send ==========
  if (interaction.isCommand() && interaction.commandName === 'send') {
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const channel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('text') || '';
    const customName = interaction.options.getString('name') || 'Winter Team';
    const avatarUrl = interaction.options.getString('avatar') || client.user.displayAvatarURL();
    
    if (!channel.isTextBased()) return interaction.reply({ content: '❌ Канал должен быть текстовым!', ephemeral: true });
    
    try {
      const webhook = await channel.createWebhook({ name: customName, avatar: avatarUrl });
      const embed = new EmbedBuilder().setColor(0x2B2D31).setDescription(text || '​');
      await webhook.send({ embeds: [embed] });
      await webhook.delete();
      
      await interaction.reply({ content: `✅ Сообщение отправлено!`, ephemeral: true });
    } catch (error) {
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
      
    } catch (error) {
      console.error('❌ Ошибка создания тикета:', error);
      await interaction.editReply('❌ Ошибка создания!');
    }
  }
  
  // ========== КНОПКИ УПРАВЛЕНИЯ ТИКЕТОМ ==========
  if (interaction.isButton()) {
    const id = interaction.customId;
    
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
    }
    
    if (id.startsWith('accept_')) {
      const [_, userId, stack] = id.split('_');
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const ticketId = `${userId}_${stack}`;
      clearTimeout(autoDeleteTimeouts.get(ticketId));
      
      if (stack === 'stack1') { stats.stack1.accepted++; stats.stack1.weekAccepted++; } 
      else { stats.stack2.accepted++; stats.stack2.weekAccepted++; }
      
      const staffId = interaction.user.id;
      if (!staffStats.has(staffId)) staffStats.set(staffId, { accepted: 0, tag: interaction.user.tag });
      staffStats.get(staffId).accepted++;
      
      await updateStaffRole(interaction.guild, staffId, staffStats.get(staffId).accepted);
      
      if (cfg.memberRoleId) {
        await interaction.guild.members.fetch(userId).then(m => m.roles.add(cfg.memberRoleId)).catch(() => {});
      }
      
      await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF00)], components: [] });
      await interaction.channel.send(`<@${userId}> 🎉 Заявка принята!`);
      
      setTimeout(async () => {
        try {
          const ch = await interaction.guild.channels.fetch(interaction.channel.id).catch(() => null);
          if (ch) await ch.delete();
        } catch (error) {}
      }, 30 * 60 * 1000);
      
      await interaction.channel.send(`⏰ **Канал будет удалён через 30 минут.**`);
      
      activeTickets.delete(ticketId);
    }
    
    if (id.startsWith('consider_')) {
      const [_, userId, stack] = id.split('_');
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFFA500)], components: interaction.message.components });
      await interaction.channel.send(`<@${userId}> ⏳ Заявка на рассмотрении.`);
    }
    
    if (id.startsWith('call_')) {
      const [_, userId, stack] = id.split('_');
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x808080)], components: interaction.message.components });
      const vc = interaction.member.voice.channel;
      const invite = vc ? await vc.createInvite({ maxAge: 86400, maxUses: 1 }).catch(() => null) : null;
      await interaction.channel.send(`<@${userId}> 📞 Обзвон!${invite ? `\n🔊 ${invite.url}` : ''}`);
    }
    
    if (id.startsWith('deny_')) {
      const [_, userId, stack] = id.split('_');
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const modal = new ModalBuilder()
        .setCustomId(`deny_reason_${userId}_${stack}_${interaction.channel.id}`)
        .setTitle('❌ Причина отклонения');
      
      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Укажите причину')
        .setPlaceholder('Например: Недостаточно часов...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500);
      
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
  }
  
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
      
      await interaction.editReply({ content: '✅ Заявка отклонена!' });
      
    } catch (error) {
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
  console.error('❌ ТОКЕН НЕ НАЙДЕН!'); 
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
      <p>📤 /export_backup - экспорт в JSON</p>
      <p>📥 /import_backup - импорт из JSON</p>
      <p>⏰ Аптайм: ${getUptime()}</p>
    </body>
    </html>
  `); 
}).listen(process.env.PORT || 3000);

console.log(`🌐 HTTP сервер запущен на порту ${process.env.PORT || 3000}`);
