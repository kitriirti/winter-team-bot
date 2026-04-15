const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, Collection } = require('discord.js');
const http = require('http');

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
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL', 'MESSAGE']
});

const activeTickets = new Collection();
const autoDeleteTimeouts = new Collection();

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

// ========== ОЧИСТКА ПРОСРОЧЕННЫХ ВАРНОВ ==========
async function cleanExpiredWarns(guild) {
  const now = new Date();
  const warnRoles = guild.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));

  for (const role of warnRoles.values()) {
    const nameMatch = role.name.match(/⚠️ Warn \((\d{2}\.\d{2}\.\d{4})\) \[(\d+)д\]/);
    if (!nameMatch) continue;
    
    const dateStr = nameMatch[1];
    const durationDays = parseInt(nameMatch[2]);
    
    const [day, month, year] = dateStr.split('.');
    const issueDate = new Date(`${year}-${month}-${day}`);
    const expireDate = new Date(issueDate);
    expireDate.setDate(expireDate.getDate() + durationDays);
    
    if (now >= expireDate) {
      console.log(`🗑️ [${guild.name}] Удаляем просроченный варн: ${role.name}`);
      
      for (const member of role.members.values()) {
        await member.roles.remove(role).catch(() => {});
      }
      
      await role.delete().catch(() => {});
    }
  }
}

// ========== СНЯТИЕ ВСЕХ ВАРНОВ С ПОЛЬЗОВАТЕЛЯ ==========
async function removeAllWarns(member) {
  const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
  
  for (const role of warnRoles.values()) {
    await member.roles.remove(role).catch(() => {});
    
    if (role.members.size === 0) {
      await role.delete().catch(() => {});
    }
  }
  
  return warnRoles.size;
}

// ========== ПОЛУЧЕНИЕ НАСТРОЕК ДЛЯ СЕРВЕРА ==========
const getConfig = (guildId = null) => {
  const baseConfig = {
    token: process.env.DISCORD_TOKEN || config.token,
    clientId: process.env.CLIENT_ID || config.clientId,
  };
  
  if (guildId) {
    const guild1Id = process.env.GUILD_ID_1 || config?.guildId_1;
    const guild2Id = process.env.GUILD_ID_2 || config?.guildId_2;
    
    if (guildId === guild1Id) {
      return {
        ...baseConfig,
        guildId: guild1Id,
        ticketCategory: process.env.TICKET_CATEGORY_1 || config?.ticketCategory_1,
        appealCategory: process.env.APPEAL_CATEGORY_1 || config?.appealCategory_1 || process.env.TICKET_CATEGORY_1,
        staffRoleId_stack1: process.env.STAFF_ROLE_STACK1_1 || config?.staffRoleId_stack1_1,
        staffRoleId_stack2: process.env.STAFF_ROLE_STACK2_1 || config?.staffRoleId_stack2_1,
        logChannelId: process.env.LOG_CHANNEL_ID_1 || config?.logChannelId_1,
        memberRoleId: process.env.MEMBER_ROLE_ID_1 || config?.memberRoleId_1
      };
    } else if (guildId === guild2Id) {
      return {
        ...baseConfig,
        guildId: guild2Id,
        ticketCategory: process.env.TICKET_CATEGORY_2 || config?.ticketCategory_2,
        appealCategory: process.env.APPEAL_CATEGORY_2 || config?.appealCategory_2 || process.env.TICKET_CATEGORY_2,
        staffRoleId_stack1: process.env.STAFF_ROLE_STACK1_2 || config?.staffRoleId_stack1_2,
        staffRoleId_stack2: process.env.STAFF_ROLE_STACK2_2 || config?.staffRoleId_stack2_2,
        logChannelId: process.env.LOG_CHANNEL_ID_2 || config?.logChannelId_2,
        memberRoleId: process.env.MEMBER_ROLE_ID_2 || config?.memberRoleId_2
      };
    }
  }
  
  return {
    ...baseConfig,
    guildId: process.env.GUILD_ID_1 || config?.guildId_1 || process.env.GUILD_ID || config?.guildId,
    ticketCategory: process.env.TICKET_CATEGORY_1 || config?.ticketCategory_1 || process.env.TICKET_CATEGORY || config?.ticketCategory,
    appealCategory: process.env.APPEAL_CATEGORY_1 || config?.appealCategory_1 || process.env.TICKET_CATEGORY_1,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1_1 || config?.staffRoleId_stack1_1 || process.env.STAFF_ROLE_STACK1 || config?.staffRoleId_stack1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2_1 || config?.staffRoleId_stack2_1 || process.env.STAFF_ROLE_STACK2 || config?.staffRoleId_stack2,
    logChannelId: process.env.LOG_CHANNEL_ID_1 || config?.logChannelId_1 || process.env.LOG_CHANNEL_ID || config?.logChannelId,
    memberRoleId: process.env.MEMBER_ROLE_ID_1 || config?.memberRoleId_1 || process.env.MEMBER_ROLE_ID || config?.memberRoleId
  };
};

function getWorkingHoursMessage() {
  const now = new Date();
  const mskHour = (now.getUTCHours() + 3) % 24;
  if (mskHour >= 10 && mskHour < 21) return '';
  return `\n**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n⏰ *Заявки рассматриваются с 10:00 до 21:00 по МСК.*`;
}

async function sendLog(guildId, embed) {
  try {
    const cfg = getConfig(guildId);
    if (!cfg.logChannelId) return;
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    
    const channel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!channel) return;
    
    await channel.send({ embeds: [embed] });
    console.log(`📝 [${guild.name}] Лог отправлен`);
  } catch (error) {
    console.error('❌ Ошибка отправки лога:', error.message);
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
  const cfg = getConfig(channel.guild.id);
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

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  console.log(`📊 Серверов: ${client.guilds.cache.size}`);
  
  // Анимация статуса
  const fullText = 'winter team';
  let currentText = '';
  let letterIndex = 0;
  
  setInterval(() => {
    if (letterIndex < fullText.length) {
      currentText += fullText[letterIndex];
      letterIndex++;
    } else {
      currentText = '';
      letterIndex = 0;
    }
    const displayText = currentText || 'w';
    client.user.setActivity(displayText, { type: 2 });
  }, 5000);
  
  // Очистка варнов при запуске
  for (const guild of client.guilds.cache.values()) {
    await cleanExpiredWarns(guild);
  }
  
  // Периодическая очистка варнов
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await cleanExpiredWarns(guild);
    }
  }, 10 * 60 * 1000);
  
  try {
    await client.application.commands.set([
      { name: 'ticket_stack1', description: 'Создать сообщение для подачи заявок в СТАК 1 (3500+ часов)' },
      { name: 'ticket_stack2', description: 'Создать сообщение для подачи заявок в СТАК 2 (2500+ часов)' },
      { name: 'stats', description: 'Показать статистику заявок за неделю (только для стаффа)' },
      { name: 'battlemetrics', description: 'Показать BattleMetrics профиль игрока из заявки (только для стаффа)' },
      { name: 'ping', description: 'Проверить задержку бота' },
      { name: 'warn', description: 'Выдать предупреждение пользователю' },
      { name: 'unwarn', description: 'Снять все предупреждения с пользователя' },
      { name: 'appeal_panel', description: 'Создать панель обжалования/отработки варнов' }
    ]);
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
  }
});

client.on('interactionCreate', async interaction => {
  const cfg = getConfig(interaction.guild?.id);
  
  // ========== КОМАНДА /appeal_panel ==========
  if (interaction.isCommand() && interaction.commandName === 'appeal_panel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
      .setTitle('📋 ОБЖАЛОВАНИЕ / ОТРАБОТКА ВАРНОВ')
      .setDescription(
        '**Если у вас есть активные предупреждения, вы можете:**\n\n' +
        '📝 **Подать на обжалование** — если считаете варн несправедливым\n' +
        '✅ **Подать на отработку** — если выполнили условия отработки\n\n' +
        'Нажмите соответствующую кнопку ниже.'
      )
      .setColor(0xFFA500)
      .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('appeal_ticket').setLabel('Обжалование').setEmoji('📝').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('workoff_ticket').setLabel('Отработка').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Панель создана!', ephemeral: true });
  }
  
  // ========== КНОПКИ ПАНЕЛИ ОБЖАЛОВАНИЯ ==========
  if (interaction.isButton() && (interaction.customId === 'appeal_ticket' || interaction.customId === 'workoff_ticket')) {
    const type = interaction.customId === 'appeal_ticket' ? 'обжалование' : 'отработка';
    const emoji = interaction.customId === 'appeal_ticket' ? '📝' : '✅';
    
    const warnRoles = interaction.member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
    
    if (warnRoles.size === 0) {
      return interaction.reply({ content: '❌ У вас нет активных предупреждений!', ephemeral: true });
    }
    
    const modal = new ModalBuilder()
      .setCustomId(`appeal_modal_${type}`)
      .setTitle(`${emoji} ${type === 'обжалование' ? 'Обжалование' : 'Отработка'} варна`);
    
    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel(type === 'обжалование' ? 'Почему варн несправедлив?' : 'Что вы сделали для отработки?')
      .setPlaceholder('Опишите вашу ситуацию...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);
    
    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА МОДАЛЬНОГО ОКНА ОБЖАЛОВАНИЯ/ОТРАБОТКИ ==========
  if (interaction.isModalSubmit() && interaction.customId.startsWith('appeal_modal_')) {
    const type = interaction.customId.replace('appeal_modal_', '');
    const reason = interaction.fields.getTextInputValue('reason');
    const emoji = type === 'обжалование' ? '📝' : '✅';
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const user = interaction.user;
      const warnRoles = user.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
      const warnsList = warnRoles.map(r => `- ${r.name}`).join('\n');
      
      // Создаём канал БЕЗ категории (чтобы избежать ошибок)
      const channelOptions = {
        name: `${emoji}-${type}-${user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      };
      
      // Пробуем добавить категорию если она есть
      if (cfg.appealCategory) {
        try {
          const category = await interaction.guild.channels.fetch(cfg.appealCategory).catch(() => null);
          if (category) channelOptions.parent = cfg.appealCategory;
        } catch (error) {}
      }
      
      // Добавляем права для стаффа
      if (cfg.staffRoleId_stack1) {
        channelOptions.permissionOverwrites.push({
          id: cfg.staffRoleId_stack1,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
        });
      }
      if (cfg.staffRoleId_stack2) {
        channelOptions.permissionOverwrites.push({
          id: cfg.staffRoleId_stack2,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
        });
      }
      
      const appealChannel = await interaction.guild.channels.create(channelOptions);
      
      const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${type === 'обжалование' ? 'ОБЖАЛОВАНИЕ' : 'ОТРАБОТКА'} ВАРНА`)
        .setColor(0xFFA500)
        .setDescription(
          `**Пользователь:** <@${user.id}>\n` +
          `**Активные варны:**\n${warnsList}\n\n` +
          `**${type === 'обжалование' ? 'Причина обжалования' : 'Что сделано'}:**\n> ${reason}`
        )
        .setTimestamp();
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`remove_warn_${user.id}_${appealChannel.id}`).setLabel('Снять варн').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`close_appeal_${appealChannel.id}`).setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
      );
      
      let content = '';
      if (cfg.staffRoleId_stack1) content += `<@&${cfg.staffRoleId_stack1}> `;
      if (cfg.staffRoleId_stack2) content += `<@&${cfg.staffRoleId_stack2}>`;
      
      await appealChannel.send({ content: content || 'Стафф', embeds: [embed], components: [row] });
      
      await interaction.editReply({ 
        content: `✅ Ваше обращение создано! Ожидайте в канале ${appealChannel}`,
        ephemeral: true 
      });
      
    } catch (error) {
      console.error('❌ Ошибка создания обращения:', error);
      await interaction.editReply({ content: '❌ Произошла ошибка! Попробуйте позже.', ephemeral: true });
    }
  }
  
  // ========== КНОПКА "СНЯТЬ ВАРН" ==========
  if (interaction.isButton() && interaction.customId.startsWith('remove_warn_')) {
    const parts = interaction.customId.split('_');
    const userId = parts[2];
    const channelId = parts[3];
    
    const hasStaffRole = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                         (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                         interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaffRole) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return interaction.editReply('❌ Пользователь не найден!');
      }
      
      const removedCount = await removeAllWarns(member);
      
      if (removedCount === 0) {
        return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
      }
      
      const originalEmbed = interaction.message.embeds[0];
      const newEmbed = EmbedBuilder.from(originalEmbed)
        .setColor(0x00FF00)
        .setFooter({ text: `✅ Варны сняты модератором ${interaction.user.tag}` });
      
      await interaction.message.edit({ embeds: [newEmbed], components: [] });
      
      await interaction.editReply({ content: `✅ Снято ${removedCount} варнов с ${member.user.tag}!`, ephemeral: true });
      
      await interaction.channel.send(`✅ **Варны сняты!** Модератор: <@${interaction.user.id}>`);
      
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Варны сняты')
        .setColor(0x00FF00)
        .addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild.id, logEmbed);
      
      try {
        await member.send({
          embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)]
        });
      } catch (error) {}
      
      setTimeout(async () => {
        try { await interaction.channel.delete(); } catch (error) {}
      }, 5000);
      
    } catch (error) {
      console.error('❌ Ошибка снятия варна:', error);
      await interaction.editReply('❌ Произошла ошибка!');
    }
  }
  
  // ========== КНОПКА "ЗАКРЫТЬ" ==========
  if (interaction.isButton() && interaction.customId.startsWith('close_appeal_')) {
    const hasStaffRole = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                         (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                         interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaffRole) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    await interaction.reply({ content: '🔒 Закрываю...', ephemeral: true });
    setTimeout(async () => {
      try { await interaction.channel.delete(); } catch (error) {}
    }, 2000);
  }
  
  // ========== КОМАНДА /unwarn ==========
  if (interaction.isCommand() && interaction.commandName === 'unwarn') {
    const hasStaffRole = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                         (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                         interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaffRole) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const modal = new ModalBuilder().setCustomId('unwarn_modal').setTitle('✅ Снять предупреждения');
    
    const userInput = new TextInputBuilder()
      .setCustomId('user')
      .setLabel('ID пользователя или @упоминание')
      .setPlaceholder('Например: 1492902233354797329')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(userInput));
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА /unwarn ==========
  if (interaction.isModalSubmit() && interaction.customId === 'unwarn_modal') {
    const userInput = interaction.fields.getTextInputValue('user');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      let userId = userInput;
      const mentionMatch = userInput.match(/<@!?(\d+)>/);
      if (mentionMatch) userId = mentionMatch[1];
      
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) return interaction.editReply('❌ Пользователь не найден!');
      
      const removedCount = await removeAllWarns(member);
      
      if (removedCount === 0) {
        return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
      }
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Предупреждения сняты')
        .setColor(0x00FF00)
        .setDescription(`**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Снято варнов:** ${removedCount}`)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Варны сняты (команда)')
        .setColor(0x00FF00)
        .addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild.id, logEmbed);
      
      try {
        await member.send({
          embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)]
        });
      } catch (error) {}
      
    } catch (error) {
      console.error('❌ Ошибка снятия варнов:', error);
      await interaction.editReply('❌ Произошла ошибка!');
    }
  }
  
  // ========== КОМАНДА /warn ==========
  if (interaction.isCommand() && interaction.commandName === 'warn') {
    const hasStaffRole = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                         (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                         interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaffRole) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const modal = new ModalBuilder().setCustomId('warn_modal').setTitle('⚠️ Выдать предупреждение');
    
    const userInput = new TextInputBuilder()
      .setCustomId('user')
      .setLabel('ID пользователя или @упоминание')
      .setPlaceholder('Например: 1492902233354797329')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Срок: 7, 14, 30 или forever')
      .setPlaceholder('7, 14, 30, forever')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    
    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина')
      .setPlaceholder('Нарушение правил...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);
    
    const workoffInput = new TextInputBuilder()
      .setCustomId('workoff')
      .setLabel('Отработка (необязательно)')
      .setPlaceholder('Например: Принести 1000 серы')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(200);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(userInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(workoffInput)
    );
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА /warn ==========
  if (interaction.isModalSubmit() && interaction.customId === 'warn_modal') {
    const userInput = interaction.fields.getTextInputValue('user');
    const durationInput = interaction.fields.getTextInputValue('duration').toLowerCase();
    const reason = interaction.fields.getTextInputValue('reason');
    const workoff = interaction.fields.getTextInputValue('workoff') || null;
    
    await interaction.deferReply({ ephemeral: true });
    
    let durationDays = 0;
    let isForever = false;
    let durationText = '';
    
    if (durationInput === 'forever' || durationInput === 'навсегда') {
      isForever = true;
      durationText = 'навсегда';
    } else {
      durationDays = parseInt(durationInput);
      if (isNaN(durationDays) || ![7, 14, 30].includes(durationDays)) {
        return interaction.editReply('❌ Неверный срок! Укажите: 7, 14, 30 или forever');
      }
      durationText = `${durationDays}д`;
    }
    
    try {
      let userId = userInput;
      const mentionMatch = userInput.match(/<@!?(\d+)>/);
      if (mentionMatch) userId = mentionMatch[1];
      
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) return interaction.editReply('❌ Пользователь не найден!');
      
      const today = new Date();
      const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth()+1).toString().padStart(2, '0')}.${today.getFullYear()}`;
      const roleName = isForever ? `⚠️ Warn (навсегда)` : `⚠️ Warn (${dateStr}) [${durationDays}д]`;
      
      let warnRole = interaction.guild.roles.cache.find(r => r.name === roleName);
      if (!warnRole) {
        warnRole = await interaction.guild.roles.create({
          name: roleName,
          color: 0xFFA500,
          reason: `Варн для ${member.user.tag}`
        });
      }
      
      await member.roles.add(warnRole);
      
      let description = `**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Причина:** ${reason}\n**Срок:** ${durationText}`;
      if (!isForever) description += `\n**Дата выдачи:** ${dateStr}`;
      if (workoff) description += `\n**Отработка:** ${workoff}`;
      
      const embed = new EmbedBuilder().setTitle('⚠️ Предупреждение выдано').setColor(0xFFA500).setDescription(description).setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      
      const logEmbed = new EmbedBuilder()
        .setTitle('⚠️ Выдан варн')
        .setColor(0xFFA500)
        .addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '⏰ Срок', value: durationText, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();
      
      if (workoff) logEmbed.addFields({ name: '🔄 Отработка', value: workoff, inline: false });
      
      await sendLog(interaction.guild.id, logEmbed);
      
      let dmDescription = `**Причина:** ${reason}\n**Модератор:** ${interaction.user.tag}\n**Срок:** ${durationText}`;
      if (workoff) dmDescription += `\n\n**Отработка:** ${workoff}`;
      if (!isForever) dmDescription += `\n\nРоль будет автоматически снята через ${durationDays} дней.`;
      
      try {
        await member.send({
          embeds: [new EmbedBuilder().setTitle('⚠️ Вы получили предупреждение').setColor(0xFFA500).setDescription(dmDescription)]
        });
      } catch (error) {}
      
    } catch (error) {
      console.error('❌ Ошибка выдачи варна:', error);
      await interaction.editReply('❌ Произошла ошибка!');
    }
  }
  
  // ========== КОМАНДА /ping ==========
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true, ephemeral: true });
    await interaction.editReply({ content: `🏓 Понг! ${sent.createdTimestamp - interaction.createdTimestamp}ms | API: ${client.ws.ping}ms` });
  }
  
  // ========== КОМАНДА /battlemetrics ==========
  if (interaction.isCommand() && interaction.commandName === 'battlemetrics') {
    const hasStaff = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                     (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                     interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
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
    const hasStaff = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                     (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                     interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const embed = new EmbedBuilder()
      .setTitle('📊 СТАТИСТИКА ЗА НЕДЕЛЮ')
      .setColor(0x3498DB)
      .addFields(
        { name: '🔥 СТАК 1', value: `✅ ${stats.stack1.weekAccepted} | ❌ ${stats.stack1.weekDenied}`, inline: true },
        { name: '💧 СТАК 2', value: `✅ ${stats.stack2.weekAccepted} | ❌ ${stats.stack2.weekDenied}`, inline: true },
        { name: '🔧 Статус', value: `🔥 ${ticketStatus.stack1 ? '🟢' : '🔴'} | 💧 ${ticketStatus.stack2 ? '🟢' : '🔴'}`, inline: false }
      );
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
    const hasStaff = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                     (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                     interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
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
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('❌ Отклонено').setDescription(`Часов: ${hours}, нужно: ${minHours}+`).setColor(0xFF0000)], ephemeral: true });
    }
    
    await interaction.reply({ content: '⏳ Создаю тикет...', ephemeral: true });
    
    try {
      const staffRole = stack === 'stack1' ? cfg.staffRoleId_stack1 : cfg.staffRoleId_stack2;
      
      const channelOptions = {
        name: `${stack === 'stack1' ? '🔥' : '💧'}｜${stack === 'stack1' ? 'СТАК-1' : 'СТАК-2'}｜${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      };
      
      if (cfg.ticketCategory) {
        try {
          const category = await interaction.guild.channels.fetch(cfg.ticketCategory).catch(() => null);
          if (category) channelOptions.parent = cfg.ticketCategory;
        } catch (error) {}
      }
      
      if (staffRole) {
        channelOptions.permissionOverwrites.push({
          id: staffRole,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        });
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
      const hasStaff = (cfg.staffRoleId_stack1 && interaction.member.roles.cache.has(cfg.staffRoleId_stack1)) || 
                       (cfg.staffRoleId_stack2 && interaction.member.roles.cache.has(cfg.staffRoleId_stack2)) ||
                       interaction.member.permissions.has(PermissionFlagsBits.Administrator);
      
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
    
    if (id.startsWith('accept_') || id.startsWith('consider_') || id.startsWith('call_') || id.startsWith('deny_')) {
      const [action, userId, stack] = id.split('_');
      const staffRole = stack === 'stack1' ? cfg.staffRoleId_stack1 : cfg.staffRoleId_stack2;
      
      const hasStaff = (staffRole && interaction.member.roles.cache.has(staffRole)) || 
                       interaction.member.permissions.has(PermissionFlagsBits.Administrator);
      
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const ticketId = `${userId}_${stack}`;
      clearTimeout(autoDeleteTimeouts.get(ticketId));
      
      if (action === 'accept') {
        if (stack === 'stack1') { stats.stack1.accepted++; stats.stack1.weekAccepted++; } 
        else { stats.stack2.accepted++; stats.stack2.weekAccepted++; }
        saveStats();
        
        if (cfg.memberRoleId) {
          await interaction.guild.members.fetch(userId).then(m => m.roles.add(cfg.memberRoleId)).catch(() => {});
        }
        
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF00)], components: [] });
        await interaction.channel.send(`<@${userId}> 🎉 Заявка принята!`);
        setTimeout(() => interaction.channel.delete(), 12 * 60 * 60 * 1000);
        
      } else if (action === 'consider') {
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFFA500)], components: interaction.message.components });
        await interaction.channel.send(`<@${userId}> Заявка на рассмотрении.`);
        
      } else if (action === 'call') {
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x808080)], components: interaction.message.components });
        const vc = interaction.member.voice.channel;
        const invite = vc ? await vc.createInvite({ maxAge: 86400, maxUses: 1 }).catch(() => null) : null;
        await interaction.channel.send(`<@${userId}> 📞 Обзвон!${invite ? `\n🔊 ${invite.url}` : ''}`);
        
      } else if (action === 'deny') {
        if (stack === 'stack1') { stats.stack1.denied++; stats.stack1.weekDenied++; } 
        else { stats.stack2.denied++; stats.stack2.weekDenied++; }
        saveStats();
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFF0000)], components: [] });
        await interaction.channel.send(`<@${userId}> 😔 Заявка отклонена.`);
        setTimeout(() => interaction.channel.delete(), 5000);
      }
      activeTickets.delete(ticketId);
    }
  }
});

client.on('error', e => console.error('❌', e));
process.on('unhandledRejection', e => console.error('❌', e));

// ЗАПУСК
const token = process.env.DISCORD_TOKEN || config?.token;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

// HTTP СЕРВЕР
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);
