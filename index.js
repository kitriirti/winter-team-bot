const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, Collection } = require('discord.js');
const http = require('http');

// Загружаем конфиг
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
  ]
});

const activeTickets = new Collection();
const reminderTimeouts = new Collection();

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

const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN || config.token,
    clientId: process.env.CLIENT_ID || config.clientId,
    guildId: process.env.GUILD_ID || config.guildId,
    ticketCategory: process.env.TICKET_CATEGORY || config.ticketCategory,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1 || config.staffRoleId_stack1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2 || config.staffRoleId_stack2,
    logChannelId: process.env.LOG_CHANNEL_ID || config.logChannelId,
    memberRoleId: process.env.MEMBER_ROLE_ID || config.memberRoleId
  };
};

function getWorkingHoursMessage() {
  const now = new Date();
  const mskHour = (now.getUTCHours() + 3) % 24;
  
  if (mskHour >= 10 && mskHour < 21) {
    return '';
  } else {
    return `\n**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n⏰ *Заявки рассматриваются с 10:00 до 21:00 по МСК. Ваша заявка будет обработана в рабочее время.*`;
  }
}

async function sendLog(channelId, embed) {
  try {
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Ошибка отправки лога:', error.message);
  }
}

// ========== ПРОВЕРКА STEAM ОТКЛЮЧЕНА (ВСЕГДА FALSE) ==========
async function isSteamProfilePrivate(steamUrl) {
  return false;
}

async function extractSteamID(text) {
  const steamIDMatch = text.match(/(7656\d{13})/);
  if (steamIDMatch) return steamIDMatch[1];
  
  const profilesMatch = text.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if (profilesMatch) return profilesMatch[1];
  
  const customMatch = text.match(/steamcommunity\.com\/id\/([^\/\s]+)/);
  if (customMatch) {
    return await resolveVanityURL(customMatch[1]);
  }
  
  return null;
}

async function resolveVanityURL(vanity) {
  try {
    const steamApiKey = process.env.STEAM_API_KEY;
    if (!steamApiKey) return vanity;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${steamApiKey}&vanityurl=${vanity}`,
      { signal: controller.signal }
    );
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    if (data.response && data.response.success === 1) {
      return data.response.steamid;
    }
    return vanity;
  } catch (error) {
    console.error('❌ Ошибка resolveVanityURL:', error.message);
    return vanity;
  }
}

function getBattleMetricsUrl(steamID) {
  if (/^\d+$/.test(steamID)) {
    return `https://www.battlemetrics.com/players/${steamID}`;
  }
  return `https://www.battlemetrics.com/players/steam?url=https%3A%2F%2Fsteamcommunity.com%2Fid%2F${steamID}`;
}

function scheduleReminder(channelId, staffRoleId, ticketId) {
  const timeout = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send({
          content: `<@&${staffRoleId}> ⏰ **Напоминание!** Эта заявка ожидает рассмотрения более 24 часов.`,
        });
      }
      reminderTimeouts.delete(ticketId);
    } catch (error) {
      console.error('Ошибка отправки напоминания:', error);
    }
  }, 24 * 60 * 60 * 1000);
  
  reminderTimeouts.set(ticketId, timeout);
}

function scheduleAutoDelete(channelId, ticketId) {
  const timeout = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send('🗑️ **Этот тикет автоматически закрыт, так как прошло более 7 дней.**');
        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (error) {
            console.error('Ошибка авто-удаления канала:', error);
          }
        }, 5000);
      }
      activeTickets.delete(ticketId);
    } catch (error) {
      console.error('Ошибка авто-удаления:', error);
    }
  }, 7 * 24 * 60 * 60 * 1000);
  
  const ticket = activeTickets.get(ticketId);
  if (ticket) {
    ticket.autoDeleteTimeout = timeout;
    activeTickets.set(ticketId, ticket);
  }
}

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} успешно запущен!`);
  client.user.setActivity('заявки в клан WT', { type: 3 });
  
  const cfg = getConfig();
  
  try {
    const globalCommands = await client.application.commands.fetch();
    for (const command of globalCommands.values()) {
      await command.delete();
    }
    
    const guild = client.guilds.cache.get(cfg.guildId);
    if (guild) {
      const guildCommands = await guild.commands.fetch();
      for (const command of guildCommands.values()) {
        await command.delete();
      }
    }
  } catch (error) {
    console.error('❌ Ошибка удаления команд:', error);
  }
  
  try {
    await client.application.commands.create({
      name: 'ticket_stack1',
      description: 'Создать сообщение для подачи заявок в СТАК 1 (3500+ часов)'
    });
    
    await client.application.commands.create({
      name: 'ticket_stack2',
      description: 'Создать сообщение для подачи заявок в СТАК 2 (2500+ часов)'
    });
    
    await client.application.commands.create({
      name: 'stats',
      description: 'Показать статистику заявок за неделю (только для стаффа)'
    });
    
    await client.application.commands.create({
      name: 'battlemetrics',
      description: 'Показать BattleMetrics профиль игрока из заявки (только для стаффа)'
    });
    
    await client.application.commands.create({
      name: 'ping',
      description: 'Проверить задержку бота'
    });
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации команд:', error);
  }
  
  console.log('✅ Бот готов к работе!');
});

client.on('interactionCreate', async interaction => {
  
  const cfg = getConfig();
  
  // ========== КОМАНДА /ping ==========
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true, ephemeral: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(client.ws.ping);
    
    await interaction.editReply({
      content: `🏓 **Понг!**\n📡 Задержка бота: **${latency}ms**\n🌐 Задержка Discord API: **${apiLatency}ms**`
    });
  }
  
  // ========== КОМАНДА /battlemetrics ==========
  if (interaction.isCommand() && interaction.commandName === 'battlemetrics') {
    
    const hasStaffRole = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || 
                         interaction.member.roles.cache.has(cfg.staffRoleId_stack2);
    
    if (!hasStaffRole && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ 
        content: '❌ У вас нет прав для использования этой команды!', 
        ephemeral: true 
      });
    }
    
    const channel = interaction.channel;
    const isTicketChannel = channel.name.startsWith('🔥｜') || channel.name.startsWith('💧｜');
    
    if (!isTicketChannel) {
      return interaction.reply({ 
        content: '❌ Эта команда работает только в каналах тикетов!', 
        ephemeral: true 
      });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const messages = await channel.messages.fetch({ limit: 10 });
      const ticketMessage = messages.find(msg => 
        msg.author.id === client.user.id && 
        msg.embeds.length > 0 &&
        msg.embeds[0].description?.includes('подал заявку')
      );
      
      if (!ticketMessage) {
        return interaction.editReply({ content: '❌ Не удалось найти заявку в этом канале!' });
      }
      
      const embed = ticketMessage.embeds[0];
      const description = embed.description || '';
      
      const steamMatch = description.match(/🔗\s\*\*Steam:\*\*\s(.+?)(?:\n|$)/);
      if (!steamMatch) {
        return interaction.editReply({ content: '❌ Не удалось найти Steam ссылку в заявке!' });
      }
      
      const steamText = steamMatch[1];
      const steamID = await extractSteamID(steamText);
      
      if (!steamID) {
        return interaction.editReply({ content: '❌ Не удалось извлечь Steam ID из ссылки!' });
      }
      
      const bmUrl = getBattleMetricsUrl(steamID);
      
      const bmEmbed = new EmbedBuilder()
        .setTitle('🎮 BattleMetrics профиль')
        .setColor(0x3498DB)
        .setDescription(
          `**Steam ID:** ${steamID}\n` +
          `**BattleMetrics:** [Открыть профиль](${bmUrl})\n\n` +
          `На сайте можно посмотреть:\n` +
          `● Часы в Rust\n` +
          `● Историю серверов\n` +
          `● Наличие банов\n` +
          `● Статистику игрока`
        );
      
      await interaction.editReply({ embeds: [bmEmbed] });
      
    } catch (error) {
      console.error('Ошибка в /battlemetrics:', error);
      await interaction.editReply({ content: '❌ Произошла ошибка при получении данных!' });
    }
  }
  
  // ========== КОМАНДА /stats ==========
  if (interaction.isCommand() && interaction.commandName === 'stats') {
    
    const hasStaffRole = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || 
                         interaction.member.roles.cache.has(cfg.staffRoleId_stack2);
    
    if (!hasStaffRole && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ 
        content: '❌ У вас нет прав для просмотра статистики!', 
        ephemeral: true 
      });
    }
    
    const totalWeekAccepted = stats.stack1.weekAccepted + stats.stack2.weekAccepted;
    const totalWeekDenied = stats.stack1.weekDenied + stats.stack2.weekDenied;
    const totalWeek = totalWeekAccepted + totalWeekDenied;
    const totalAutoDenied = (stats.stack1.autoDenied || 0) + (stats.stack2.autoDenied || 0);
    
    const statsEmbed = new EmbedBuilder()
      .setTitle('📊 СТАТИСТИКА ЗАЯВОК ЗА НЕДЕЛЮ')
      .setColor(0x3498DB)
      .setDescription('**Статистика за последние 7 дней**')
      .addFields(
        { 
          name: '🔥 СТАК 1 (3500+ часов)', 
          value: `✅ Принято: **${stats.stack1.weekAccepted}**\n❌ Отклонено: **${stats.stack1.weekDenied}**\n📋 Всего: **${stats.stack1.weekAccepted + stats.stack1.weekDenied}**`,
          inline: true 
        },
        { 
          name: '💧 СТАК 2 (2500+ часов)', 
          value: `✅ Принято: **${stats.stack2.weekAccepted}**\n❌ Отклонено: **${stats.stack2.weekDenied}**\n📋 Всего: **${stats.stack2.weekAccepted + stats.stack2.weekDenied}**`,
          inline: true 
        },
        {
          name: '━━━━━━━━━━━━━━━━━━',
          value: `🎯 **ОБЩИЙ ИТОГ:**\n✅ Принято: **${totalWeekAccepted}**\n❌ Отклонено: **${totalWeekDenied}**\n📋 Всего заявок: **${totalWeek}**`,
          inline: false
        },
        {
          name: '📈 Всего за всё время',
          value: `🔥 СТАК 1: принято **${stats.stack1.accepted}**, отклонено **${stats.stack1.denied}**, автоотклонено **${stats.stack1.autoDenied || 0}**\n💧 СТАК 2: принято **${stats.stack2.accepted}**, отклонено **${stats.stack2.denied}**, автоотклонено **${stats.stack2.autoDenied || 0}**\n\n🤖 Всего автоотклонено: **${totalAutoDenied}**`,
          inline: false
        }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [statsEmbed], ephemeral: true });
  }
  
  // ========== КОМАНДЫ СОЗДАНИЯ СООБЩЕНИЙ ==========
  if (interaction.isCommand() && interaction.commandName === 'ticket_stack1') {
    
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ 
        content: '❌ У вас нет прав для использования этой команды', 
        ephemeral: true 
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН WT')
      .setDescription(
        '**ТРЕБОВАНИЯ ДЛЯ СТАК 1:**\n\n' +
        '● 3500 часов на аккаунте и более\n' +
        '● 15+ лет\n' +
        '● Иметь хороший микрофон\n' +
        '● Умение слушать коллы и адекватно реагировать на критику\n' +
        '● Минимум 6 часов стабильного онлайна в день\n\n' +
        'Нажмите кнопку ниже, чтобы заполнить анкету.'
      )
      .setColor(0x3498DB);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket_stack1')
          .setLabel('📝 Подать заявку в СТАК 1')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ 
      content: '✅ Сообщение для СТАК 1 создано!', 
      ephemeral: true 
    });
  }

  if (interaction.isCommand() && interaction.commandName === 'ticket_stack2') {
    
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ 
        content: '❌ У вас нет прав для использования этой команды', 
        ephemeral: true 
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН WT')
      .setDescription(
        '**ТРЕБОВАНИЯ ДЛЯ СТАК 2:**\n\n' +
        '● 2500 часов на аккаунте и более\n' +
        '● 15+ лет\n' +
        '● Иметь хороший микрофон\n' +
        '● Умение слушать коллы и адекватно реагировать на критику\n' +
        '● Минимум 6 часов стабильного онлайна в день\n\n' +
        'Нажмите кнопку ниже, чтобы заполнить анкету.'
      )
      .setColor(0x3498DB);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket_stack2')
          .setLabel('📝 Подать заявку в СТАК 2')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ 
      content: '✅ Сообщение для СТАК 2 создано!', 
      ephemeral: true 
    });
  }

  // ========== ОБРАБОТКА КНОПОК (открытие анкеты) ==========
  if (interaction.isButton()) {
    
    let stackType = '';
    if (interaction.customId === 'create_ticket_stack1') {
      stackType = 'stack1';
    } else if (interaction.customId === 'create_ticket_stack2') {
      stackType = 'stack2';
    }
    
    if (stackType) {
      
      const userActiveTicket = activeTickets.get(`${interaction.user.id}_${stackType}`);
      
      if (userActiveTicket) {
        try {
          const channel = await interaction.guild.channels.fetch(userActiveTicket.channelId).catch(() => null);
          if (channel) {
            return interaction.reply({
              content: `❌ У вас уже есть активная заявка в **${stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2'}**! Ожидайте решения в канале ${channel}`,
              ephemeral: true
            });
          } else {
            activeTickets.delete(`${interaction.user.id}_${stackType}`);
          }
        } catch (error) {
          activeTickets.delete(`${interaction.user.id}_${stackType}`);
        }
      }
      
      const modal = new ModalBuilder()
        .setCustomId(`application_modal_${stackType}`)
        .setTitle(`📋 ЗАЯВЛЕНИЕ В КЛАН WT - ${stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2'}`);

      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Ваше имя?')
        .setPlaceholder('Например: Артём')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

      const ageInput = new TextInputBuilder()
        .setCustomId('age')
        .setLabel('Ваш возраст?')
        .setPlaceholder('15+ лет')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      const steamInput = new TextInputBuilder()
        .setCustomId('steam')
        .setLabel('Ссылка на Steam профиль')
        .setPlaceholder('https://steamcommunity.com/profiles/... или /id/...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);

      const hoursInput = new TextInputBuilder()
        .setCustomId('hours')
        .setLabel('Сколько часов в Rust?')
        .setPlaceholder(stackType === 'stack1' ? '3500' : '2500')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10);

      const roleInput = new TextInputBuilder()
        .setCustomId('role')
        .setLabel('Желаемая роль в клане?')
        .setPlaceholder('Строитель, ПвПшник, Фермер, Электрик')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const listenInput = new TextInputBuilder()
        .setCustomId('listen')
        .setLabel('Готовы слушать коллы и принимать критику?')
        .setPlaceholder('Да, готов / Частично / Нет')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(ageInput),
        new ActionRowBuilder().addComponents(steamInput),
        new ActionRowBuilder().addComponents(hoursInput),
        new ActionRowBuilder().addComponents(roleInput),
        new ActionRowBuilder().addComponents(listenInput)
      );

      await interaction.showModal(modal);
    }
  }

  // ========== ОБРАБОТКА АНКЕТЫ ==========
  if (interaction.isModalSubmit()) {
    
    const customId = interaction.customId;
    
    if (customId.startsWith('application_modal_')) {
      
      const stackType = customId.replace('application_modal_', '');
      
      const name = interaction.fields.getTextInputValue('name');
      const age = interaction.fields.getTextInputValue('age');
      const steam = interaction.fields.getTextInputValue('steam');
      const hoursText = interaction.fields.getTextInputValue('hours');
      const role = interaction.fields.getTextInputValue('role');
      const listen = interaction.fields.getTextInputValue('listen');
      
      const user = interaction.user;
      
      const staffRoleId = stackType === 'stack1' 
        ? cfg.staffRoleId_stack1 
        : cfg.staffRoleId_stack2;
      
      // Проверка часов
      const hoursNumber = parseInt(hoursText.replace(/\s+/g, ''));
      
      if (isNaN(hoursNumber) || hoursNumber <= 0) {
        return interaction.reply({
          content: '❌ **Ошибка!** Поле "Часы" должно содержать только цифры (например: 3500).',
          ephemeral: true
        });
      }
      
      // Проверка ссылки на Steam
      if (!steam.includes('steamcommunity.com')) {
        return interaction.reply({
          content: '❌ **Ошибка!** Пожалуйста, укажите корректную ссылку на Steam профиль.',
          ephemeral: true
        });
      }
      
      // Проверка приватности ОТКЛЮЧЕНА
      // const isPrivate = await isSteamProfilePrivate(steam);
      
      const minHours = stackType === 'stack1' ? 3500 : 2500;
      
      // Авто-отклонение по часам
      if (hoursNumber < minHours) {
        if (stackType === 'stack1') {
          stats.stack1.denied++;
          stats.stack1.weekDenied++;
          stats.stack1.autoDenied = (stats.stack1.autoDenied || 0) + 1;
        } else {
          stats.stack2.denied++;
          stats.stack2.weekDenied++;
          stats.stack2.autoDenied = (stats.stack2.autoDenied || 0) + 1;
        }
        saveStats();
        
        const autoDenyEmbed = new EmbedBuilder()
          .setTitle('❌ ЗАЯВКА ОТКЛОНЕНА АВТОМАТИЧЕСКИ')
          .setDescription(
            `**К сожалению, ваша заявка в клан WINTER TEAM была отклонена.**\n\n` +
            `**Причина:** Недостаточно часов в Rust\n` +
            `**Ваши часы:** ${hoursNumber}\n` +
            `**Минимум:** ${minHours}+ часов\n\n` +
            `Вы можете подать заявку снова, когда наберёте нужное количество часов.`
          )
          .setColor(0xFF0000)
          .setTimestamp();
        
        await interaction.reply({ embeds: [autoDenyEmbed], ephemeral: true });
        
        const logEmbed = new EmbedBuilder()
          .setTitle('🤖 Заявка отклонена автоматически')
          .setColor(0xFF0000)
          .addFields(
            { name: '👤 Заявитель', value: `<@${user.id}> (${user.tag})`, inline: true },
            { name: '📋 Состав', value: stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true },
            { name: '⏰ Часы', value: `${hoursNumber} / ${minHours}`, inline: true },
            { name: '📝 Причина', value: 'Недостаточно часов', inline: false }
          )
          .setTimestamp();
        
        await sendLog(cfg.logChannelId, logEmbed);
        return;
      }
      
      await interaction.reply({
        content: '⏳ Обрабатываем вашу заявку...',
        ephemeral: true
      });

      try {
        const stackName = stackType === 'stack1' ? 'СТАК-1' : 'СТАК-2';
        const stackColor = 0x3498DB;
        const stackEmoji = stackType === 'stack1' ? '🔥' : '💧';

        const ticketChannel = await interaction.guild.channels.create({
          name: `${stackEmoji}｜${stackName}｜${user.username}`,
          type: ChannelType.GuildText,
          parent: cfg.ticketCategory,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const ticketId = `${user.id}_${stackType}`;
        
        activeTickets.set(ticketId, {
          channelId: ticketChannel.id,
          userId: user.id,
          stackType: stackType,
          status: 'pending',
          createdAt: Date.now()
        });

        scheduleReminder(ticketChannel.id, staffRoleId, ticketId);
        scheduleAutoDelete(ticketChannel.id, ticketId);

        const workingHoursMsg = getWorkingHoursMessage();
        
        const applicationEmbed = new EmbedBuilder()
          .setColor(stackColor)
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .setDescription(
            `### <@${user.id}> подал заявку в **${stackName}**\n` +
            `**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n\n` +
            `👤 **Имя:** ${name}\n` +
            `🎂 **Возраст:** ${age}\n` +
            `🔗 **Steam:** ${steam}\n` +
            `⏰ **Часы:** ${hoursNumber} ч\n` +
            `🎯 **Желаемая роль:** ${role}\n` +
            `👂 **Готовность слушать:** ${listen}` +
            workingHoursMsg
          );

        const actionRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId(`accept_${user.id}_${stackType}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`consider_${user.id}_${stackType}`).setLabel('⏳ На рассмотрение').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`call_${user.id}_${stackType}`).setLabel('📞 На обзвон').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`deny_${user.id}_${stackType}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`close_${ticketChannel.id}`).setLabel('🔒 Закрыть').setStyle(ButtonStyle.Secondary)
          );

        await ticketChannel.send({
          content: `<@&${staffRoleId}>`,
          embeds: [applicationEmbed],
          components: [actionRow]
        });

        await interaction.editReply({
          content: `✅ Ваша заявка в **${stackName}** принята! Ожидайте в канале ${ticketChannel}`,
          ephemeral: true
        });

      } catch (error) {
        console.error('Ошибка создания тикета:', error);
        await interaction.editReply({
          content: '❌ Ошибка при создании заявки. Попробуйте позже.',
          ephemeral: true
        });
      }
    }
    
    // ========== ПРИЧИНА ОТКЛОНЕНИЯ ==========
    if (customId.startsWith('deny_reason_')) {
      
      const parts = customId.split('_');
      const targetUserId = parts[2];
      const stackType = parts[3];
      const channelId = parts[4];
      
      const reason = interaction.fields.getTextInputValue('reason');
      
      const requiredStaffRoleId = stackType === 'stack1' 
        ? cfg.staffRoleId_stack1 
        : cfg.staffRoleId_stack2;
      
      if (!interaction.member.roles.cache.has(requiredStaffRoleId)) {
        return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
      }
      
      await interaction.reply({ content: '⏳ Обрабатываем...', ephemeral: true });
      
      try {
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        const stackName = stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2';
        const stackEmoji = stackType === 'stack1' ? '🔥' : '💧';
        
        if (stackType === 'stack1') {
          stats.stack1.denied++;
          stats.stack1.weekDenied++;
        } else {
          stats.stack2.denied++;
          stats.stack2.weekDenied++;
        }
        saveStats();
        
        const ticketId = `${targetUserId}_${stackType}`;
        
        const reminderTimeout = reminderTimeouts.get(ticketId);
        if (reminderTimeout) {
          clearTimeout(reminderTimeout);
          reminderTimeouts.delete(ticketId);
        }
        
        const ticket = activeTickets.get(ticketId);
        if (ticket?.autoDeleteTimeout) {
          clearTimeout(ticket.autoDeleteTimeout);
        }
        
        activeTickets.delete(ticketId);
        
        let targetUser;
        try {
          targetUser = await client.users.fetch(targetUserId);
        } catch (error) {
          console.error(`❌ Не удалось найти пользователя ${targetUserId}:`, error);
        }
        
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`${stackEmoji} ЗАЯВКА ОТКЛОНЕНА | ${stackName}`)
              .setDescription(
                `**К сожалению, ваша заявка в клан WINTER TEAM была ОТКЛОНЕНА.**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `**Причина отклонения:**\n> ${reason}\n\n` +
                `**Что дальше:**\n` +
                `✅ Вы можете подать заявку повторно позже\n` +
                `🍀 Удачи в поиске клана!`
              )
              .setColor(0xFF0000);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС:`, error);
          }
        }
        
        const logEmbed = new EmbedBuilder()
          .setTitle('❌ Заявка отклонена')
          .setColor(0xFF0000)
          .addFields(
            { name: '👤 Заявитель', value: `<@${targetUserId}> (${targetUser?.tag || targetUserId})`, inline: true },
            { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '📋 Состав', value: stackName, inline: true },
            { name: '📝 Причина', value: reason, inline: false }
          )
          .setTimestamp();
        
        await sendLog(cfg.logChannelId, logEmbed);
        
        if (channel) {
          await channel.send(`<@${targetUserId}> 😔 Ваша заявка **ОТКЛОНЕНА**.\n**Причина:** ${reason}`);
          
          setTimeout(async () => {
            try {
              await channel.delete();
            } catch (error) {
              console.error('Ошибка удаления канала:', error);
            }
          }, 5000);
        }
        
        await interaction.editReply({ content: '✅ Заявка отклонена!', ephemeral: true });
        
      } catch (error) {
        console.error('Ошибка отклонения:', error);
        await interaction.editReply({ content: '❌ Ошибка!', ephemeral: true });
      }
    }
  }

  // ========== ОБРАБОТКА КНОПОК УПРАВЛЕНИЯ ==========
  if (interaction.isButton()) {
    
    const customId = interaction.customId;
    
    // КНОПКА ЗАКРЫТЬ
    if (customId.startsWith('close_')) {
      const channelId = customId.split('_')[1];
      
      const hasStaffRole = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || 
                           interaction.member.roles.cache.has(cfg.staffRoleId_stack2);
      
      if (!hasStaffRole && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ У вас нет прав для закрытия тикетов!',
          ephemeral: true
        });
      }
      
      await interaction.reply({ content: '🔒 Закрываю канал...', ephemeral: true });
      
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      const channelName = channel?.name || 'Неизвестный канал';
      
      for (const [ticketId, ticket] of activeTickets) {
        if (ticket.channelId === channelId) {
          const reminderTimeout = reminderTimeouts.get(ticketId);
          if (reminderTimeout) {
            clearTimeout(reminderTimeout);
            reminderTimeouts.delete(ticketId);
          }
          if (ticket.autoDeleteTimeout) {
            clearTimeout(ticket.autoDeleteTimeout);
          }
          activeTickets.delete(ticketId);
          break;
        }
      }
      
      const logEmbed = new EmbedBuilder()
        .setTitle('🔒 Тикет закрыт')
        .setColor(0x808080)
        .addFields(
          { name: '📁 Канал', value: channelName, inline: true },
          { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(cfg.logChannelId, logEmbed);
      
      setTimeout(async () => {
        try {
          if (channel) await channel.delete();
        } catch (error) {
          console.error('Ошибка закрытия канала:', error);
        }
      }, 2000);
      
      return;
    }
    
    if (customId.startsWith('accept_') || customId.startsWith('consider_') || 
        customId.startsWith('call_') || customId.startsWith('deny_')) {
      
      const parts = customId.split('_');
      const action = parts[0];
      const targetUserId = parts[1];
      const stackType = parts[2];
      
      const requiredStaffRoleId = stackType === 'stack1' 
        ? cfg.staffRoleId_stack1 
        : cfg.staffRoleId_stack2;
      
      if (!interaction.member.roles.cache.has(requiredStaffRoleId)) {
        return interaction.reply({
          content: `❌ У вас нет прав для управления заявками в ${stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2'}!`,
          ephemeral: true
        });
      }

      const channel = interaction.channel;
      const stackName = stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2';
      const stackEmoji = stackType === 'stack1' ? '🔥' : '💧';
      
      const originalEmbed = interaction.message.embeds[0];
      
      let targetUser;
      try {
        targetUser = await client.users.fetch(targetUserId);
      } catch (error) {
        console.error(`❌ Не удалось найти пользователя ${targetUserId}:`, error);
      }
      
      const ticketId = `${targetUserId}_${stackType}`;
      
      // ПРИНЯТЬ
      if (action === 'accept') {
        const embed = EmbedBuilder.from(originalEmbed).setColor(0x00FF00);
        
        await interaction.update({ embeds: [embed], components: [] });
        await channel.send(`<@${targetUserId}> 🎉 **Поздравляем! Ваша заявка в ${stackName} ПРИНЯТА!**`);
        
        if (stackType === 'stack1') {
          stats.stack1.accepted++;
          stats.stack1.weekAccepted++;
        } else {
          stats.stack2.accepted++;
          stats.stack2.weekAccepted++;
        }
        saveStats();
        
        if (cfg.memberRoleId) {
          try {
            const member = await interaction.guild.members.fetch(targetUserId);
            await member.roles.add(cfg.memberRoleId);
            await channel.send(`✅ Роль <@&${cfg.memberRoleId}> выдана участнику.`);
          } catch (error) {
            console.error('❌ Ошибка выдачи роли:', error);
          }
        }
        
        const reminderTimeout = reminderTimeouts.get(ticketId);
        if (reminderTimeout) {
          clearTimeout(reminderTimeout);
          reminderTimeouts.delete(ticketId);
        }
        
        const ticket = activeTickets.get(ticketId);
        if (ticket?.autoDeleteTimeout) {
          clearTimeout(ticket.autoDeleteTimeout);
        }
        activeTickets.delete(ticketId);
        
        const logEmbed = new EmbedBuilder()
          .setTitle('✅ Заявка принята')
          .setColor(0x00FF00)
          .addFields(
            { name: '👤 Заявитель', value: `<@${targetUserId}> (${targetUser?.tag || targetUserId})`, inline: true },
            { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '📋 Состав', value: stackName, inline: true }
          )
          .setTimestamp();
        
        await sendLog(cfg.logChannelId, logEmbed);
        
        setTimeout(async () => {
          try {
            const channelToDelete = await client.channels.fetch(channel.id).catch(() => null);
            if (channelToDelete) await channelToDelete.delete();
          } catch (error) {
            console.error('Ошибка удаления канала:', error);
          }
        }, 12 * 60 * 60 * 1000);
        
        await channel.send(`⏰ **Этот канал будет автоматически удалён через 12 часов.**`);
        
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`${stackEmoji} ЗАЯВКА ПРИНЯТА | ${stackName}`)
              .setDescription(
                `**Поздравляем! Ваша заявка в клан WINTER TEAM ПРИНЯТА!**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `✅ Свяжитесь с лидером\n` +
                `✅ Ознакомьтесь с правилами\n` +
                `🎮 Удачной игры!`
              )
              .setColor(0x00FF00);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС:`, error);
          }
        }
      } 
      
      // НА РАССМОТРЕНИЕ
      else if (action === 'consider') {
        const embed = EmbedBuilder.from(originalEmbed).setColor(0xFFA500);
        
        await interaction.update({ embeds: [embed], components: [interaction.message.components[0]] });
        await channel.send(`<@${targetUserId}> Ваша заявка в **${stackName}** взята **НА РАССМОТРЕНИЕ**.`);
        
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`${stackEmoji} ЗАЯВКА НА РАССМОТРЕНИИ | ${stackName}`)
              .setDescription(
                `**Ваша заявка в клан WINTER TEAM взята НА РАССМОТРЕНИЕ!**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `Ожидайте дальнейших уведомлений.`
              )
              .setColor(0xFFA500);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС:`, error);
          }
        }
      } 
      
      // НА ОБЗВОН
      else if (action === 'call') {
        const embed = EmbedBuilder.from(originalEmbed).setColor(0x808080);
        
        await interaction.update({ embeds: [embed], components: [interaction.message.components[0]] });
        
        const staffMember = interaction.member;
        const voiceChannel = staffMember.voice.channel;
        
        let voiceInvite = '';
        if (voiceChannel) {
          try {
            const invite = await voiceChannel.createInvite({
              maxAge: 86400,
              maxUses: 1,
              reason: `Обзвон для заявки ${targetUserId}`
            });
            voiceInvite = `\n\n🔊 **Голосовой канал:** ${invite.url}`;
          } catch (error) {
            console.error('Ошибка создания приглашения:', error);
            voiceInvite = '\n\n⚠️ Не удалось создать приглашение в канал.';
          }
        } else {
          voiceInvite = '\n\n⚠️ Стафф не находится в голосовом канале.';
        }
        
        await channel.send(`<@${targetUserId}> 📞 Вы **ВЫЗВАНЫ НА ОБЗВОН** в **${stackName}**.${voiceInvite}`);
        
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`📞 ВЫЗОВ НА ОБЗВОН | ${stackName}`)
              .setDescription(
                `**Вы были вызваны на обзвон в клан WINTER TEAM!**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `**Подготовьтесь:**\n` +
                `✅ Рабочий микрофон\n` +
                `✅ Ответы на вопросы\n` +
                `✅ Часы в Rust${voiceInvite ? `\n\n${voiceInvite}` : ''}`
              )
              .setColor(0x808080);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС:`, error);
          }
        }
      } 
      
      // ОТКЛОНИТЬ
      else if (action === 'deny') {
        const modal = new ModalBuilder()
          .setCustomId(`deny_reason_${targetUserId}_${stackType}_${channel.id}`)
          .setTitle('❌ Причина отклонения заявки');
        
        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Укажите причину отклонения')
          .setPlaceholder('Например: Недостаточно часов, не подходит возраст...')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);
        
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        
        await interaction.showModal(modal);
      }
    }
  }
});

client.on('error', error => console.error('❌ Ошибка клиента:', error));
process.on('unhandledRejection', error => console.error('❌ Необработанная ошибка:', error));

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN || (config.token || null);
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }

client.login(token).catch(error => { console.error('❌ Ошибка входа:', error); process.exit(1); });

// ========== HTTP СЕРВЕР ==========
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>WINTER TEAM Bot</title><style>body{font-family:Arial;text-align:center;padding:50px;background:#1a1a1a;color:white}h1{color:#3498DB}</style></head><body><h1>💧 WINTER TEAM BOT</h1><p>Бот работает!</p><p>Статус: 🟢 Online</p></body></html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ HTTP сервер запущен на порту ${PORT}`));
