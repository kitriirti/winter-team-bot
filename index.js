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
    GatewayIntentBits.GuildVoiceStates
  ]
});

const activeTickets = new Collection();
const autoDeleteTimeouts = new Collection();

let ticketStatus = {
  stack1: true,
  stack2: true
};

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

function scheduleAutoDelete(channelId, ticketId) {
  const timeout = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send('🗑️ **Тикет автоматически закрыт (прошло 7 дней).**');
        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (error) {
            console.error('Ошибка удаления канала:', error);
          }
        }, 5000);
      }
      activeTickets.delete(ticketId);
      autoDeleteTimeouts.delete(ticketId);
    } catch (error) {
      console.error('Ошибка авто-удаления:', error);
    }
  }, 7 * 24 * 60 * 60 * 1000);
  
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
      `● ${hours} часов на аккаунте и более\n` +
      `● 15+ лет\n` +
      `● Иметь хороший микрофон\n` +
      `● Умение слушать коллы и адекватно реагировать на критику\n` +
      `● Минимум 6 часов стабильного онлайна в день\n\n` +
      `**Статус набора:** ${ticketStatus[stackType] ? '🟢 Открыт' : '🔴 Закрыт'}\n\n` +
      `Нажмите кнопку ниже, чтобы заполнить анкету.`
    )
    .setColor(0x3498DB)
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`create_ticket_${stackType}`)
        .setLabel(`📝 Подать заявку в ${stackName}`)
        .setStyle(ButtonStyle.Primary),
      
      new ButtonBuilder()
        .setCustomId(`toggle_${stackType}`)
        .setEmoji(ticketStatus[stackType] ? '🟢' : '🔴')
        .setStyle(ButtonStyle.Secondary)
    );

  return await channel.send({ embeds: [embed], components: [row] });
}

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} успешно запущен!`);
  client.user.setActivity('заявки в клан WT', { type: 3 });
  
  const cfg = getConfig();
  
  try {
    // Удаляем ВСЕ старые команды
    const globalCommands = await client.application.commands.fetch();
    for (const command of globalCommands.values()) {
      await command.delete();
      console.log(`🗑️ Удалена глобальная команда: ${command.name}`);
    }
    
    const guild = client.guilds.cache.get(cfg.guildId);
    if (guild) {
      const guildCommands = await guild.commands.fetch();
      for (const command of guildCommands.values()) {
        await command.delete();
        console.log(`🗑️ Удалена команда сервера: ${command.name}`);
      }
    }
    
    // Регистрируем только нужные команды
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
    
    await client.application.commands.create({
      name: 'compress',
      description: 'Отправить изображение по ссылке'
    });
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации команд:', error);
  }
  
  console.log('✅ Бот готов к работе!');
  console.log(`🔧 Статус приёма: СТАК 1 = ${ticketStatus.stack1 ? '🟢 Открыт' : '🔴 Закрыт'}, СТАК 2 = ${ticketStatus.stack2 ? '🟢 Открыт' : '🔴 Закрыт'}`);
});

client.on('interactionCreate', async interaction => {
  
  const cfg = getConfig();
  
  // ========== КОМАНДА /compress ==========
  if (interaction.isCommand() && interaction.commandName === 'compress') {
    
    const modal = new ModalBuilder()
      .setCustomId('compress_modal')
      .setTitle('📷 Отправить изображение');
    
    const commentInput = new TextInputBuilder()
      .setCustomId('comment')
      .setLabel('Комментарий к фото')
      .setPlaceholder('Ваш комментарий...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);
    
    const urlInput = new TextInputBuilder()
      .setCustomId('image_url')
      .setLabel('Ссылка на изображение')
      .setPlaceholder('https://files.catbox.moe/abc.png')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(commentInput),
      new ActionRowBuilder().addComponents(urlInput)
    );
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА МОДАЛЬНОГО ОКНА /compress ==========
  if (interaction.isModalSubmit() && interaction.customId === 'compress_modal') {
    const url = interaction.fields.getTextInputValue('image_url').trim();
    const comment = interaction.fields.getTextInputValue('comment') || null;
    
    await interaction.deferReply();
    
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return interaction.editReply('❌ **Ошибка!** Пожалуйста, вставьте прямую ссылку на изображение.');
      }
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      
      let extension = 'jpg';
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('png')) extension = 'png';
      else if (contentType.includes('webp')) extension = 'webp';
      else if (contentType.includes('gif')) extension = 'gif';
      else if (url.includes('.png')) extension = 'png';
      else if (url.includes('.webp')) extension = 'webp';
      else if (url.includes('.gif')) extension = 'gif';
      
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setImage(`attachment://image.${extension}`);
      
      if (comment) {
        embed.setDescription(`**${comment}**`);
      }
      
      // Удаляем defer и отправляем как обычное сообщение
      await interaction.deleteReply();
      await interaction.channel.send({
        embeds: [embed],
        files: [{ attachment: imageBuffer, name: `image.${extension}` }]
      });
      
    } catch (error) {
      console.error('Ошибка:', error.message);
      
      // Пробуем просто вставить ссылку
      try {
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setImage(url);
        
        if (comment) {
          embed.setDescription(`**${comment}**`);
        }
        
        await interaction.deleteReply();
        await interaction.channel.send({ embeds: [embed] });
      } catch {
        await interaction.editReply('❌ Не удалось загрузить изображение. Проверьте ссылку.');
      }
    }
  }
  
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
      
      const steamMatch = description.match(/🔗\s*\*\*Steam:\*\*\s*([^\n]+)/);
      if (!steamMatch) {
        return interaction.editReply({ content: '❌ Не удалось найти Steam в заявке!' });
      }
      
      const steamText = steamMatch[1].trim();
      
      let steamID = null;
      
      const idMatch = steamText.match(/(7656\d{13})/);
      if (idMatch) steamID = idMatch[1];
      
      const profilesMatch = steamText.match(/steamcommunity\.com\/profiles\/(\d+)/);
      if (profilesMatch) steamID = profilesMatch[1];
      
      const customMatch = steamText.match(/steamcommunity\.com\/id\/([^\/\s\)]+)/);
      if (customMatch) steamID = customMatch[1];
      
      if (!steamID) {
        return interaction.editReply({ content: '❌ Не удалось извлечь Steam ID из ссылки!' });
      }
      
      let bmUrl;
      if (/^\d+$/.test(steamID)) {
        bmUrl = `https://www.battlemetrics.com/players/${steamID}`;
      } else {
        bmUrl = `https://www.battlemetrics.com/players/steam?url=https%3A%2F%2Fsteamcommunity.com%2Fid%2F${steamID}`;
      }
      
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
          value: `🔥 СТАК 1: принято **${stats.stack1.accepted}**, отклонено **${stats.stack1.denied}**\n💧 СТАК 2: принято **${stats.stack2.accepted}**, отклонено **${stats.stack2.denied}**\n\n🤖 Автоотклонено по часам: **${totalAutoDenied}**`,
          inline: false
        },
        {
          name: '🔧 Статус приёма',
          value: `🔥 СТАК 1: ${ticketStatus.stack1 ? '🟢 Открыт' : '🔴 Закрыт'}\n💧 СТАК 2: ${ticketStatus.stack2 ? '🟢 Открыт' : '🔴 Закрыт'}`,
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

    await createTicketMessage(interaction.channel, 'stack1');
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

    await createTicketMessage(interaction.channel, 'stack2');
    await interaction.reply({ 
      content: '✅ Сообщение для СТАК 2 создано!', 
      ephemeral: true 
    });
  }

  // ========== ОБРАБОТКА КНОПОК ==========
  if (interaction.isButton()) {
    
    const customId = interaction.customId;
    
    if (customId === 'toggle_stack1' || customId === 'toggle_stack2') {
      
      const hasStaffRole = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || 
                           interaction.member.roles.cache.has(cfg.staffRoleId_stack2) ||
                           interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
      
      if (!hasStaffRole) {
        return interaction.reply({ 
          content: '❌ У вас нет прав для управления набором!', 
          ephemeral: true 
        });
      }
      
      const stackType = customId === 'toggle_stack1' ? 'stack1' : 'stack2';
      const stackName = stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2';
      const hours = stackType === 'stack1' ? '3500' : '2500';
      
      ticketStatus[stackType] = !ticketStatus[stackType];
      saveTicketStatus();
      
      const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(
          `**ТРЕБОВАНИЯ ДЛЯ ${stackName}:**\n\n` +
          `● ${hours} часов на аккаунте и более\n` +
          `● 15+ лет\n` +
          `● Иметь хороший микрофон\n` +
          `● Умение слушать коллы и адекватно реагировать на критику\n` +
          `● Минимум 6 часов стабильного онлайна в день\n\n` +
          `**Статус набора:** ${ticketStatus[stackType] ? '🟢 Открыт' : '🔴 Закрыт'}\n\n` +
          `Нажмите кнопку ниже, чтобы заполнить анкету.`
        )
        .setTimestamp();
      
      const newRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`create_ticket_${stackType}`)
            .setLabel(`📝 Подать заявку в ${stackName}`)
            .setStyle(ButtonStyle.Primary),
          
          new ButtonBuilder()
            .setCustomId(`toggle_${stackType}`)
            .setEmoji(ticketStatus[stackType] ? '🟢' : '🔴')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.update({ embeds: [newEmbed], components: [newRow] });
      
      const logEmbed = new EmbedBuilder()
        .setTitle(ticketStatus[stackType] ? '🟢 НАБОР ОТКРЫТ' : '🔴 НАБОР ЗАКРЫТ')
        .setDescription(`**${stackName}** — набор ${ticketStatus[stackType] ? 'открыт' : 'закрыт'}`)
        .setColor(ticketStatus[stackType] ? 0x00FF00 : 0xFF0000)
        .addFields({ name: '👮 Стафф', value: `<@${interaction.user.id}>`, inline: true })
        .setTimestamp();
      
      await sendLog(cfg.logChannelId, logEmbed);
      return;
    }
    
    let stackType = '';
    if (customId === 'create_ticket_stack1') {
      stackType = 'stack1';
    } else if (customId === 'create_ticket_stack2') {
      stackType = 'stack2';
    }
    
    if (stackType) {
      
      if (!ticketStatus[stackType]) {
        return interaction.reply({
          content: '❌ **Набор в клан временно закрыт!** Попробуйте позже.',
          ephemeral: true
        });
      }
      
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
        .setLabel('Ваш возраст? (только цифры)')
        .setPlaceholder('15')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3);

      const steamInput = new TextInputBuilder()
        .setCustomId('steam')
        .setLabel('Ссылка на Steam профиль')
        .setPlaceholder('https://steamcommunity.com/profiles/...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);

      const hoursInput = new TextInputBuilder()
        .setCustomId('hours')
        .setLabel('Сколько часов в Rust? (только цифры)')
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

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(ageInput),
        new ActionRowBuilder().addComponents(steamInput),
        new ActionRowBuilder().addComponents(hoursInput),
        new ActionRowBuilder().addComponents(roleInput)
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
      const ageText = interaction.fields.getTextInputValue('age');
      const steam = interaction.fields.getTextInputValue('steam');
      const hoursText = interaction.fields.getTextInputValue('hours');
      const role = interaction.fields.getTextInputValue('role');
      
      const user = interaction.user;
      
      const staffRoleId = stackType === 'stack1' 
        ? cfg.staffRoleId_stack1 
        : cfg.staffRoleId_stack2;
      
      const ageNumber = parseInt(ageText.replace(/\s+/g, ''));
      
      if (isNaN(ageNumber) || ageNumber <= 0) {
        return interaction.reply({
          content: '❌ **Ошибка!** Поле "Возраст" должно содержать только цифры (например: 15).',
          ephemeral: true
        });
      }
      
      if (!steam.toLowerCase().includes('steamcommunity.com')) {
        return interaction.reply({
          content: '❌ **Ошибка!** Пожалуйста, укажите корректную ссылку на Steam профиль.',
          ephemeral: true
        });
      }
      
      const hoursNumber = parseInt(hoursText.replace(/\s+/g, ''));
      
      if (isNaN(hoursNumber) || hoursNumber <= 0) {
        return interaction.reply({
          content: '❌ **Ошибка!** Поле "Часы" должно содержать только цифры (например: 3500).',
          ephemeral: true
        });
      }
      
      const minHours = stackType === 'stack1' ? 3500 : 2500;
      
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

        scheduleAutoDelete(ticketChannel.id, ticketId);

        const workingHoursMsg = getWorkingHoursMessage();
        
        const applicationEmbed = new EmbedBuilder()
          .setColor(stackColor)
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .setDescription(
            `### <@${user.id}> подал заявку в **${stackName}**\n` +
            `**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n\n` +
            `👤 **Имя:** ${name}\n` +
            `🎂 **Возраст:** ${ageNumber} лет\n` +
            `🔗 **Steam:** ${steam}\n` +
            `⏰ **Часы:** ${hoursNumber} ч\n` +
            `🎯 **Желаемая роль:** ${role}` +
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
  }

  // ========== ОБРАБОТКА КНОПОК УПРАВЛЕНИЯ ТИКЕТОМ ==========
  if (interaction.isButton()) {
    
    const customId = interaction.customId;
    
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
      
      for (const [ticketId, ticket] of activeTickets) {
        if (ticket.channelId === channelId) {
          const timeout = autoDeleteTimeouts.get(ticketId);
          if (timeout) {
            clearTimeout(timeout);
            autoDeleteTimeouts.delete(ticketId);
          }
          activeTickets.delete(ticketId);
          break;
        }
      }
      
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
      
      const autoDeleteTimeout = autoDeleteTimeouts.get(ticketId);
      if (autoDeleteTimeout) {
        clearTimeout(autoDeleteTimeout);
        autoDeleteTimeouts.delete(ticketId);
      }
      
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
        
        activeTickets.delete(ticketId);
        
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
      
      else if (action === 'deny') {
        const embed = EmbedBuilder.from(originalEmbed).setColor(0xFF0000);
        
        await interaction.update({ embeds: [embed], components: [] });
        await channel.send(`<@${targetUserId}> 😔 Ваша заявка в **${stackName}** **ОТКЛОНЕНА**.`);
        
        if (stackType === 'stack1') {
          stats.stack1.denied++;
          stats.stack1.weekDenied++;
        } else {
          stats.stack2.denied++;
          stats.stack2.weekDenied++;
        }
        saveStats();
        
        activeTickets.delete(ticketId);
        
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`${stackEmoji} ЗАЯВКА ОТКЛОНЕНА | ${stackName}`)
              .setDescription(
                `**К сожалению, ваша заявка в клан WINTER TEAM была ОТКЛОНЕНА.**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `Вы можете подать заявку повторно позже.\n` +
                `🍀 Удачи в поиске клана!`
              )
              .setColor(0xFF0000);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС:`, error);
          }
        }
        
        setTimeout(async () => {
          try {
            const channelToDelete = await client.channels.fetch(channel.id).catch(() => null);
            if (channelToDelete) await channelToDelete.delete();
          } catch (error) {
            console.error('Ошибка удаления канала:', error);
          }
        }, 5000);
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
