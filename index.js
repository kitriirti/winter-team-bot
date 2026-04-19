const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const http = require('http');
const fs = require('fs');

let config = {};
try {
  config = require('./config.json');
} catch (error) {
  console.log('⚠️ config.json не найден, используем переменные окружения');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: ['CHANNEL', 'MESSAGE']
});

const activeTickets = new Collection();
const autoDeleteTimeouts = new Collection();
const pendingSends = new Collection();

// Статистика стаффа (кто сколько принял)
let staffStats = new Collection(); // userId -> { accepted: 0, tag: '' }

// Загрузка статистики стаффа из переменной окружения
try {
  if (process.env.STAFF_STATS) {
    const data = JSON.parse(process.env.STAFF_STATS);
    staffStats = new Collection(Object.entries(data));
    console.log('✅ Статистика стаффа загружена из переменной');
  }
} catch (error) {
  console.error('❌ Ошибка загрузки статистики стаффа:', error);
}

function saveStaffStats() {
  try {
    const obj = Object.fromEntries(staffStats);
    const json = JSON.stringify(obj);
    console.log(`📊 СТАТИСТИКА СТАФФА (скопируй для Render): STAFF_STATS='${json}'`);
  } catch (error) {
    console.error('❌ Ошибка сохранения статистики стаффа:', error);
  }
}

// Функция обновления роли стаффа
async function updateStaffRole(guild, staffId, acceptedCount) {
  try {
    const member = await guild.members.fetch(staffId).catch(() => null);
    if (!member) return;
    
    const roleName = `📋 Принял ${acceptedCount} заявок`;
    
    // Удаляем старые роли
    const oldRoles = member.roles.cache.filter(r => r.name.startsWith('📋 Принял '));
    for (const role of oldRoles.values()) {
      await member.roles.remove(role).catch(() => {});
      // Если роль пустая - удаляем
      if (role.members.size === 1) {
        await role.delete().catch(() => {});
      }
    }
    
    // Создаём или находим новую роль
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

let ticketStatus = { stack1: true, stack2: true };

try {
  if (process.env.TICKET_STATUS) {
    ticketStatus = JSON.parse(process.env.TICKET_STATUS);
    console.log('✅ Статус приёма загружен');
  }
} catch (error) {
  console.error('❌ Ошибка загрузки статуса:', error);
}

let stats = {
  stack1: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() },
  stack2: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() }
};

try {
  if (process.env.STATS_DATA) {
    const loadedStats = JSON.parse(process.env.STATS_DATA);
    stats = loadedStats;
    console.log('✅ Статистика загружена');
  }
} catch (error) {
  console.error('❌ Ошибка загрузки статистики:', error);
}

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

function saveStats() {
  try {
    const statsJson = JSON.stringify(stats);
    console.log(`📊 СТАТИСТИКА (скопируй для Render): STATS_DATA='${statsJson}'`);
  } catch (error) {
    console.error('❌ Ошибка сохранения статистики:', error);
  }
}

function saveTicketStatus() {
  try {
    const statusJson = JSON.stringify(ticketStatus);
    console.log(`🔧 СТАТУС ПРИЁМА (скопируй для Render): TICKET_STATUS='${statusJson}'`);
  } catch (error) {
    console.error('❌ Ошибка сохранения статуса:', error);
  }
}

const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN || config?.token,
    clientId: process.env.CLIENT_ID || config?.clientId,
    guildId: process.env.GUILD_ID || config?.guildId,
    ticketCategory: process.env.TICKET_CATEGORY || config?.ticketCategory,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1 || config?.staffRoleId_stack1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2 || config?.staffRoleId_stack2,
    logChannelId: process.env.LOG_CHANNEL_ID || config?.logChannelId,
    memberRoleId: process.env.MEMBER_ROLE_ID || config?.memberRoleId
  };
};

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

function scheduleAutoDelete(channelId, ticketId) {
  const timeout = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send('🗑️ **Тикет автоматически закрыт (прошло 7 дней).**');
        setTimeout(async () => {
          try { await channel.delete(); } catch (error) {}
        }, 5000);
      }
      activeTickets.delete(ticketId);
      autoDeleteTimeouts.delete(ticketId);
    } catch (error) {}
  }, 7 * 24 * 60 * 60 * 1000);
  autoDeleteTimeouts.set(ticketId, timeout);
}

async function createTicketMessage(channel, stackType) {
  const cfg = getConfig();
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

// Время запуска бота
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

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  console.log(`📊 Серверов: ${client.guilds.cache.size}`);
  
  // Статус с аптаймом
  setInterval(() => {
    client.user.setActivity(`❤️ ${getUptime()}`, { type: 3 });
  }, 60000);
  
  client.user.setActivity(`❤️ ${getUptime()}`, { type: 3 });
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  // Восстановление ролей стаффа при запуске
  if (guild) {
    for (const [staffId, data] of staffStats) {
      await updateStaffRole(guild, staffId, data.accepted);
    }
    console.log('✅ Роли стаффа восстановлены');
  }
  
  try {
    await client.application.commands.set([
      { name: 'ticket_stack1', description: 'Создать сообщение для подачи заявок в СТАК 1 (3500+ часов)' },
      { name: 'ticket_stack2', description: 'Создать сообщение для подачи заявок в СТАК 2 (2500+ часов)' },
      { name: 'stats', description: 'Показать статистику заявок за неделю (только для стаффа)' },
      { name: 'battlemetrics', description: 'Показать BattleMetrics профиль игрока из заявки (только для стаффа)' },
      { name: 'ping', description: 'Проверить задержку бота' },
      {
        name: 'send',
        description: 'Отправить сообщение от имени бота в канал (поддерживает # ## ###)',
        options: [
          { name: 'channel', description: 'Канал для отправки', type: 7, required: true },
          { name: 'text', description: 'Текст сообщения (можно # Заголовок)', type: 3, required: false },
          { name: 'name', description: 'Имя отправителя (по умолч. Winter Team)', type: 3, required: false },
          { name: 'avatar', description: 'Ссылка на аватарку', type: 3, required: false }
        ]
      }
    ]);
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
  }
});

client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  const hasStaff = (cfg.staffRoleId_stack1 && interaction.member?.roles?.cache?.has(cfg.staffRoleId_stack1)) || 
                   (cfg.staffRoleId_stack2 && interaction.member?.roles?.cache?.has(cfg.staffRoleId_stack2)) ||
                   interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // ========== КОМАНДА /ping ==========
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true, ephemeral: true });
    await interaction.editReply({ content: `🏓 Понг! ${sent.createdTimestamp - interaction.createdTimestamp}ms | API: ${client.ws.ping}ms` });
  }
  
  // ========== КОМАНДА /send ==========
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
    
    const sendData = {
      channelId: channel.id,
      text: text,
      customName: customName,
      avatarUrl: avatarUrl
    };
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`send_photo_${interaction.user.id}`).setLabel('Прикрепить фото').setEmoji('📷').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`send_now_${interaction.user.id}`).setLabel('Отправить сейчас').setEmoji('📤').setStyle(ButtonStyle.Success)
    );
    
    pendingSends.set(interaction.user.id, sendData);
    
    const previewText = text || '(без текста)';
    
    await interaction.reply({
      content: `📤 **Отправка в ${channel}**\nИмя: **${customName}**\n\n**Превью:**\n${previewText}\n\nНажмите кнопку ниже:`,
      components: [row],
      ephemeral: true
    });
  }
  
  // ========== КОМАНДА /battlemetrics ==========
  if (interaction.isCommand() && interaction.commandName === 'battlemetrics') {
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const channel = interaction.channel;
    if (!channel.name.startsWith('🔥｜') && !channel.name.startsWith('💧｜')) {
      return interaction.reply({ content: '❌ Только в каналах тикетов!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const messages = await channel.messages.fetch({ limit: 10 });
      const ticketMsg = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.description?.includes('подал заявку'));
      if (!ticketMsg) return interaction.editReply('❌ Заявка не найдена!');
      
      const steamMatch = ticketMsg.embeds[0].description.match(/🔗\s*\*\*Steam:\*\*\s*([^\n]+)/);
      if (!steamMatch) return interaction.editReply('❌ Steam не найден!');
      
      const steamText = steamMatch[1].trim();
      let steamID = steamText.match(/(7656\d{13})/)?.[1] || steamText.match(/steamcommunity\.com\/profiles\/(\d+)/)?.[1] || steamText.match(/steamcommunity\.com\/id\/([^\/\s\)]+)/)?.[1];
      if (!steamID) return interaction.editReply('❌ Steam ID не извлечь!');
      
      const bmUrl = /^\d+$/.test(steamID) ? `https://www.battlemetrics.com/players/${steamID}` : `https://www.battlemetrics.com/players/steam?url=https%3A%2F%2Fsteamcommunity.com%2Fid%2F${steamID}`;
      
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🎮 BattleMetrics').setColor(0x3498DB).setDescription(`**Steam ID:** ${steamID}\n**BattleMetrics:** [Открыть](${bmUrl})`)] });
    } catch (error) {
      await interaction.editReply('❌ Ошибка!');
    }
  }
  
  // ========== КОМАНДА /stats ==========
  if (interaction.isCommand() && interaction.commandName === 'stats') {
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const totalWeekAccepted = stats.stack1.weekAccepted + stats.stack2.weekAccepted;
    const totalWeekDenied = stats.stack1.weekDenied + stats.stack2.weekDenied;
    const totalWeek = totalWeekAccepted + totalWeekDenied;
    const totalAutoDenied = (stats.stack1.autoDenied || 0) + (stats.stack2.autoDenied || 0);
    
    const sortedStaff = [...staffStats.entries()]
      .sort((a, b) => b[1].accepted - a[1].accepted)
      .slice(0, 10);
    
    let staffList = '';
    if (sortedStaff.length > 0) {
      staffList = sortedStaff.map(([id, data]) => `<@${id}> — **${data.accepted}**`).join('\n');
    } else {
      staffList = 'Нет данных';
    }
    
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
  
  // ========== КОМАНДЫ СОЗДАНИЯ ТИКЕТОВ ==========
  if (interaction.isCommand() && (interaction.commandName === 'ticket_stack1' || interaction.commandName === 'ticket_stack2')) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    }
    const stack = interaction.commandName === 'ticket_stack1' ? 'stack1' : 'stack2';
    await createTicketMessage(interaction.channel, stack);
    await interaction.reply({ content: `✅ Сообщение для ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'} создано!`, ephemeral: true });
  }
  
  // ========== КНОПКИ СТАТУСА НАБОРА ==========
  if (interaction.isButton() && (interaction.customId === 'toggle_stack1' || interaction.customId === 'toggle_stack2')) {
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const stack = interaction.customId === 'toggle_stack1' ? 'stack1' : 'stack2';
    ticketStatus[stack] = !ticketStatus[stack];
    saveTicketStatus();
    
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
      saveStats();
      
      const logEmbed = new EmbedBuilder()
        .setTitle('🤖 Заявка отклонена автоматически')
        .setColor(0xFF0000)
        .addFields(
          { name: '👤 Заявитель', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
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
      scheduleAutoDelete(channel.id, ticketId);
      
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
          { name: '👤 Заявитель', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
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
            { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true }
          )
          .setTimestamp();
        
        await sendLog(interaction.guild, logEmbed);
      }
    }
    
    if (id.startsWith('accept_') || id.startsWith('consider_') || id.startsWith('call_') || id.startsWith('deny_')) {
      const [action, userId, stack] = id.split('_');
      const staffRole = stack === 'stack1' ? cfg.staffRoleId_stack1 : cfg.staffRoleId_stack2;
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const ticketId = `${userId}_${stack}`;
      clearTimeout(autoDeleteTimeouts.get(ticketId));
      
      const logEmbed = new EmbedBuilder().setTimestamp();
      
      if (action === 'accept') {
        if (stack === 'stack1') { stats.stack1.accepted++; stats.stack1.weekAccepted++; } 
        else { stats.stack2.accepted++; stats.stack2.weekAccepted++; }
        saveStats();
        
        // Обновляем статистику стаффа
        const staffId = interaction.user.id;
        if (!staffStats.has(staffId)) {
          staffStats.set(staffId, { accepted: 0, tag: interaction.user.tag });
        }
        staffStats.get(staffId).accepted++;
        staffStats.get(staffId).tag = interaction.user.tag;
        saveStaffStats();
        
        // Обновляем роль стаффа
        await updateStaffRole(interaction.guild, staffId, staffStats.get(staffId).accepted);
        
        if (cfg.memberRoleId) {
          await interaction.guild.members.fetch(userId).then(m => m.roles.add(cfg.memberRoleId)).catch(() => {});
        }
        
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF00)], components: [] });
        await interaction.channel.send(`<@${userId}> 🎉 Заявка принята!`);
        
        // Удаление через 30 минут
        setTimeout(() => interaction.channel.delete().catch(() => {}), 30 * 60 * 1000);
        await interaction.channel.send(`⏰ **Этот канал будет автоматически удалён через 30 минут.**`);
        
        logEmbed.setTitle('✅ Заявка принята').setColor(0x00FF00).addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true },
          { name: '📊 Всего принято', value: `${staffStats.get(staffId).accepted}`, inline: true }
        );
        
      } else if (action === 'consider') {
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFFA500)], components: interaction.message.components });
        await interaction.channel.send(`<@${userId}> Заявка на рассмотрении.`);
        
        logEmbed.setTitle('⏳ Заявка на рассмотрении').setColor(0xFFA500).addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true }
        );
        
      } else if (action === 'call') {
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x808080)], components: interaction.message.components });
        const vc = interaction.member.voice.channel;
        const invite = vc ? await vc.createInvite({ maxAge: 86400, maxUses: 1 }).catch(() => null) : null;
        await interaction.channel.send(`<@${userId}> 📞 Обзвон!${invite ? `\n🔊 ${invite.url}` : ''}`);
        
        logEmbed.setTitle('📞 Обзвон').setColor(0x808080).addFields(
          { name: '👤 Заявитель', value: `<@${userId}>`, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📋 Состав', value: stack === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true }
        );
        
      } else if (action === 'deny') {
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
        return;
      }
      
      activeTickets.delete(ticketId);
      if (action !== 'deny') await sendLog(interaction.guild, logEmbed);
    }
    
    // === КНОПКИ /send ===
    if (id.startsWith('send_photo_')) {
      const userId = id.replace('send_photo_', '');
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ Это не ваша команда!', ephemeral: true });
      }
      
      const sendData = pendingSends.get(userId);
      if (!sendData) {
        return interaction.reply({ content: '❌ Данные не найдены! Вызовите /send заново.', ephemeral: true });
      }
      
      const modal = new ModalBuilder().setCustomId(`send_modal_${userId}`).setTitle('📷 Прикрепить фото');
      
      const photoInput = new TextInputBuilder().setCustomId('photo_url').setLabel('Ссылка на фото или путь к файлу').setPlaceholder('https://i.imgur.com/... или C:\\photo.png').setStyle(TextInputStyle.Paragraph).setRequired(true);
      
      modal.addComponents(new ActionRowBuilder().addComponents(photoInput));
      
      await interaction.showModal(modal);
    }
    
    if (id.startsWith('send_now_')) {
      const userId = id.replace('send_now_', '');
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ Это не ваша команда!', ephemeral: true });
      }
      
      const sendData = pendingSends.get(userId);
      if (!sendData) {
        return interaction.reply({ content: '❌ Данные не найдены!', ephemeral: true });
      }
      
      await interaction.deferUpdate();
      
      try {
        const channel = await client.channels.fetch(sendData.channelId);
        
        const webhook = await channel.createWebhook({
          name: sendData.customName,
          avatar: sendData.avatarUrl
        });
        
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setDescription(sendData.text || '​');
        
        await webhook.send({ embeds: [embed] });
        await webhook.delete();
        
        pendingSends.delete(userId);
        
        await interaction.editReply({
          content: `✅ Сообщение отправлено в ${channel} от имени **${sendData.customName}**!`,
          components: [],
          ephemeral: true
        });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({
          content: `❌ Ошибка: ${error.message}`,
          components: [],
          ephemeral: true
        });
      }
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
      saveStats();
      
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
          { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
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
  
  // ========== ОБРАБОТКА МОДАЛЬНОГО ОКНА ДЛЯ /send ==========
  if (interaction.isModalSubmit() && interaction.customId.startsWith('send_modal_')) {
    const userId = interaction.customId.replace('send_modal_', '');
    const photoUrl = interaction.fields.getTextInputValue('photo_url');
    
    const sendData = pendingSends.get(userId);
    if (!sendData) {
      return interaction.reply({ content: '❌ Данные не найдены!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const channel = await client.channels.fetch(sendData.channelId);
      
      const webhook = await channel.createWebhook({
        name: sendData.customName,
        avatar: sendData.avatarUrl
      });
      
      const files = [];
      let fileName = 'image.png';
      
      if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
        const response = await fetch(photoUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('png')) fileName = 'image.png';
        else if (contentType.includes('webp')) fileName = 'image.webp';
        else if (contentType.includes('gif')) fileName = 'image.gif';
        
        files.push({ attachment: buffer, name: fileName });
      } else {
        if (fs.existsSync(photoUrl)) {
          fileName = photoUrl.split('/').pop() || photoUrl.split('\\').pop() || 'image.png';
          files.push({ attachment: photoUrl, name: fileName });
        } else {
          await webhook.delete();
          return interaction.editReply('❌ Файл не найден!');
        }
      }
      
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setImage(`attachment://${fileName}`)
        .setDescription(sendData.text || null);
      
      await webhook.send({
        embeds: [embed],
        files: files
      });
      
      await webhook.delete();
      
      pendingSends.delete(userId);
      
      await interaction.editReply({
        content: `✅ Сообщение с фото отправлено в ${channel} от имени **${sendData.customName}**!`
      });
      
    } catch (error) {
      console.error('❌ Ошибка:', error);
      await interaction.editReply(`❌ Ошибка: ${error.message}`);
    }
  }
});

client.on('error', e => console.error('❌', e));
process.on('unhandledRejection', e => console.error('❌', e));

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN || config?.token;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

// ========== HTTP СЕРВЕР ==========
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);
