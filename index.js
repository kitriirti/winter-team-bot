const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, Collection } = require('discord.js');
const http = require('http');

// Загружаем конфиг (для локальной разработки)
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
    GatewayIntentBits.GuildMembers
  ]
});

// Хранилище активных тикетов (в памяти)
const activeTickets = new Collection();

// Хранилище времени последней заявки (анти-спам)
const lastApplicationTime = new Collection();

// Статистика (загружается из переменной окружения)
let stats = {
  stack1: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() },
  stack2: { accepted: 0, denied: 0, autoDenied: 0, weekAccepted: 0, weekDenied: 0, weekStart: Date.now() }
};

// Загружаем статистику из переменной окружения
try {
  if (process.env.STATS_DATA) {
    const loadedStats = JSON.parse(process.env.STATS_DATA);
    stats = loadedStats;
    console.log('✅ Статистика загружена из переменной окружения');
  }
} catch (error) {
  console.error('❌ Ошибка загрузки статистики из переменной:', error);
}

// Проверяем, не началась ли новая неделя
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

// Функция сохранения статистики
function saveStats() {
  try {
    const statsJson = JSON.stringify(stats);
    console.log(`📊 СТАТИСТИКА (скопируй для Render): STATS_DATA='${statsJson}'`);
  } catch (error) {
    console.error('❌ Ошибка сохранения статистики:', error);
  }
}

// Получаем настройки из переменных окружения
const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN || config.token,
    clientId: process.env.CLIENT_ID || config.clientId,
    guildId: process.env.GUILD_ID || config.guildId,
    ticketCategory: process.env.TICKET_CATEGORY || config.ticketCategory,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1 || config.staffRoleId_stack1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2 || config.staffRoleId_stack2,
    logChannelId: process.env.LOG_CHANNEL_ID || config.logChannelId,
    memberRoleId: process.env.MEMBER_ROLE_ID || config.memberRoleId // Роль для принятых участников
  };
};

// Функция для отправки логов
async function sendLog(channelId, embed) {
  try {
    if (!channelId) return;
    
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    
    await channel.send({ embeds: [embed] });
    console.log(`✅ Лог отправлен в канал ${channel.name}`);
  } catch (error) {
    console.error('❌ Ошибка отправки лога:', error.message);
  }
}

// Функция для извлечения часов из текста
function extractHours(text) {
  // Ищем числа в тексте
  const matches = text.match(/(\d+[\s,]?\d*)\s*(?:часов?|hours?|ч|h)/i);
  if (matches) {
    return parseInt(matches[1].replace(/[\s,]/g, ''));
  }
  
  // Если не нашли по шаблону, ищем просто число
  const numbers = text.match(/\d+/g);
  if (numbers) {
    // Берём самое большое число (скорее всего это часы)
    return Math.max(...numbers.map(n => parseInt(n)));
  }
  
  return 0;
}

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} успешно запущен!`);
  
  client.user.setActivity('заявки в клан WT', { type: 3 });
  
  const cfg = getConfig();
  
  // Очищаем старые команды и регистрируем новые
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
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации команд:', error);
  }
  
  activeTickets.clear();
  lastApplicationTime.clear();
  
  console.log('✅ Бот готов к работе!');
  console.log(`📊 ТЕКУЩАЯ СТАТИСТИКА: СТАК1 принято=${stats.stack1.accepted} отклонено=${stats.stack1.denied} автоотклонено=${stats.stack1.autoDenied || 0} | СТАК2 принято=${stats.stack2.accepted} отклонено=${stats.stack2.denied} автоотклонено=${stats.stack2.autoDenied || 0}`);
});

client.on('interactionCreate', async interaction => {
  
  const cfg = getConfig();
  
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
  
  // ========== КОМАНДА ДЛЯ СТАК 1 ==========
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

  // ========== КОМАНДА ДЛЯ СТАК 2 ==========
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

  // ========== ОБРАБОТКА КНОПОК ==========
  if (interaction.isButton()) {
    
    let stackType = '';
    if (interaction.customId === 'create_ticket_stack1') {
      stackType = 'stack1';
    } else if (interaction.customId === 'create_ticket_stack2') {
      stackType = 'stack2';
    }
    
    if (stackType) {
      
      // АНТИ-СПАМ
      const lastTime = lastApplicationTime.get(`${interaction.user.id}_${stackType}`);
      if (lastTime) {
        const timeLeft = 24 * 60 * 60 * 1000 - (Date.now() - lastTime);
        if (timeLeft > 0) {
          const hours = Math.floor(timeLeft / (60 * 60 * 1000));
          const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
          return interaction.reply({
            content: `❌ Вы уже подавали заявку в этот состав! Попробуйте снова через **${hours} ч ${minutes} мин**.`,
            ephemeral: true
          });
        }
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
        .setLabel('Ваш возраст?')
        .setPlaceholder('15+ лет')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      const steamInput = new TextInputBuilder()
        .setCustomId('steam')
        .setLabel('Ссылка на Steam / Сколько часов?')
        .setPlaceholder(stackType === 'stack1' ? 'https://steamcommunity.com/... / 3500+ часов' : 'https://steamcommunity.com/... / 2500+ часов')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);

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

      const nameRow = new ActionRowBuilder().addComponents(nameInput);
      const ageRow = new ActionRowBuilder().addComponents(ageInput);
      const steamRow = new ActionRowBuilder().addComponents(steamInput);
      const roleRow = new ActionRowBuilder().addComponents(roleInput);
      const listenRow = new ActionRowBuilder().addComponents(listenInput);

      modal.addComponents(nameRow, ageRow, steamRow, roleRow, listenRow);

      await interaction.showModal(modal);
    }
  }

  // ========== ОБРАБОТКА МОДАЛЬНЫХ ОКОН ==========
  if (interaction.isModalSubmit()) {
    
    const customId = interaction.customId;
    
    if (customId.startsWith('application_modal_')) {
      
      const stackType = customId.replace('application_modal_', '');
      
      const name = interaction.fields.getTextInputValue('name');
      const age = interaction.fields.getTextInputValue('age');
      const steam = interaction.fields.getTextInputValue('steam');
      const role = interaction.fields.getTextInputValue('role');
      const listen = interaction.fields.getTextInputValue('listen');
      
      const user = interaction.user;
      
      const staffRoleId = stackType === 'stack1' 
        ? cfg.staffRoleId_stack1 
        : cfg.staffRoleId_stack2;
      
      lastApplicationTime.set(`${user.id}_${stackType}`, Date.now());
      
      // ========== АВТО-ОТКЛОНЕНИЕ ПО ЧАСАМ ==========
      const hours = extractHours(steam);
      const minHours = stackType === 'stack1' ? 3500 : 2500;
      
      if (hours > 0 && hours < minHours) {
        // Автоотклонение
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
            `**К сожалению, ваша заявка в клан WINTER TEAM была отклонена автоматически.**\n\n` +
            `**Причина:** Недостаточно часов в Rust\n` +
            `**Ваши часы:** ${hours}\n` +
            `**Минимум для ${stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2'}:** ${minHours}+ часов\n\n` +
            `Вы можете подать заявку снова, когда наберёте нужное количество часов.`
          )
          .setColor(0xFF0000)
          .setTimestamp();
        
        await interaction.reply({ embeds: [autoDenyEmbed], ephemeral: true });
        
        // Лог автоотклонения
        const logEmbed = new EmbedBuilder()
          .setTitle('🤖 Заявка отклонена автоматически')
          .setColor(0xFF0000)
          .addFields(
            { name: '👤 Заявитель', value: `<@${user.id}> (${user.tag})`, inline: true },
            { name: '📋 Состав', value: stackType === 'stack1' ? 'СТАК 1' : 'СТАК 2', inline: true },
            { name: '⏰ Часы', value: `${hours} / ${minHours}`, inline: true },
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
        const stackHours = stackType === 'stack1' ? '3500+' : '2500+';
        const stackAge = '15+';

        const ticketChannel = await interaction.guild.channels.create({
          name: `${stackEmoji}｜${stackName}｜${user.username}`,
          type: ChannelType.GuildText,
          parent: cfg.ticketCategory,
          permissionOverwrites: [
            {
              id: interaction.guild.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            {
              id: staffRoleId,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
          ]
        });

        activeTickets.set(`${user.id}_${stackType}`, {
          channelId: ticketChannel.id,
          userId: user.id,
          stackType: stackType,
          status: 'pending',
          createdAt: Date.now()
        });

        const applicationEmbed = new EmbedBuilder()
          .setColor(stackColor)
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .setDescription(
            `### <@${user.id}> подал заявку в **${stackName}**\n` +
            `**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n\n` +
            `👤 **Имя:** ${name}\n` +
            `🎂 **Возраст:** ${age}\n` +
            `🎮 **Steam / Часы:** ${steam} ${hours > 0 ? `(${hours} ч)` : ''}\n` +
            `🎯 **Желаемая роль:** ${role}\n` +
            `👂 **Готовность слушать:** ${listen}\n\n` +
            `**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n` +
            `📌 *Требования ${stackName}: ${stackHours} часов, ${stackAge} лет*`
          );

        const actionRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`accept_${user.id}_${stackType}`)
              .setLabel('✅ Принять')
              .setStyle(ButtonStyle.Success),
            
            new ButtonBuilder()
              .setCustomId(`consider_${user.id}_${stackType}`)
              .setLabel('⏳ На рассмотрение')
              .setStyle(ButtonStyle.Primary),
            
            new ButtonBuilder()
              .setCustomId(`call_${user.id}_${stackType}`)
              .setLabel('📞 На обзвон')
              .setStyle(ButtonStyle.Secondary),
            
            new ButtonBuilder()
              .setCustomId(`deny_${user.id}_${stackType}`)
              .setLabel('❌ Отклонить')
              .setStyle(ButtonStyle.Danger),
            
            new ButtonBuilder()
              .setCustomId(`close_${ticketChannel.id}`)
              .setLabel('🔒 Закрыть')
              .setStyle(ButtonStyle.Secondary)
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
        return interaction.reply({
          content: '❌ У вас нет прав!',
          ephemeral: true
        });
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
        
        activeTickets.delete(`${targetUserId}_${stackType}`);
        
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
                `**Причина отклонения:**\n` +
                `> ${reason}\n\n` +
                `**Что дальше:**\n` +
                `✅ Вы можете подать заявку повторно позже\n` +
                `✅ Попробуйте подать заявку в другой состав (если подходите)\n` +
                `✅ Улучшайте свои навыки и приходите снова!\n\n` +
                `🍀 Удачи в поиске клана!`
              )
              .setColor(0xFF0000);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
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
          if (channel) {
            await channel.delete();
          }
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
      
      // ПРИНЯТЬ
      if (action === 'accept') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0x00FF00);
        
        await interaction.update({ embeds: [embed], components: [] });
        await channel.send(`<@${targetUserId}> 🎉 **Поздравляем! Ваша заявка в ${stackName} ПРИНЯТА!** Свяжитесь с лидером.`);
        
        // ОБНОВЛЯЕМ СТАТИСТИКУ
        if (stackType === 'stack1') {
          stats.stack1.accepted++;
          stats.stack1.weekAccepted++;
        } else {
          stats.stack2.accepted++;
          stats.stack2.weekAccepted++;
        }
        saveStats();
        
        // ========== ВЫДАЁМ РОЛЬ ==========
        if (cfg.memberRoleId) {
          try {
            const member = await interaction.guild.members.fetch(targetUserId);
            await member.roles.add(cfg.memberRoleId);
            await channel.send(`✅ Роль <@&${cfg.memberRoleId}> выдана участнику.`);
            console.log(`✅ Роль выдана пользователю ${targetUser?.tag}`);
          } catch (error) {
            console.error('❌ Ошибка выдачи роли:', error);
            await channel.send(`⚠️ Не удалось выдать роль. Проверьте права бота.`);
          }
        }
        
        activeTickets.delete(`${targetUserId}_${stackType}`);
        
        const logEmbed = new EmbedBuilder()
          .setTitle('✅ Заявка принята')
          .setColor(0x00FF00)
          .addFields(
            { name: '👤 Заявитель', value: `<@${targetUserId}> (${targetUser?.tag || targetUserId})`, inline: true },
            { name: '👮 Стафф', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '📋 Состав', value: stackName, inline: true },
            { name: '🎯 Роль', value: cfg.memberRoleId ? '✅ Выдана' : '❌ Не настроена', inline: true }
          )
          .setTimestamp();
        
        await sendLog(cfg.logChannelId, logEmbed);
        
        setTimeout(async () => {
          try {
            const channelToDelete = await client.channels.fetch(channel.id).catch(() => null);
            if (channelToDelete) {
              await channelToDelete.delete();
            }
          } catch (error) {
            console.error('Ошибка удаления канала по таймеру:', error);
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
                `**Дальнейшие действия:**\n` +
                `✅ Свяжитесь с лидером для получения роли\n` +
                `✅ Ознакомьтесь с правилами клана\n` +
                `✅ Добро пожаловать в команду!\n\n` +
                `🎮 Удачной игры!`
              )
              .setColor(0x00FF00);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
          }
        }
      } 
      
      // НА РАССМОТРЕНИЕ
      else if (action === 'consider') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0xFFA500);
        
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
                `**Что это значит:**\n` +
                `✅ Ваша заявка заинтересовала стафф\n` +
                `✅ Решение будет принято в ближайшее время\n` +
                `✅ Ожидайте дальнейших уведомлений\n\n` +
                `📌 Следите за каналом заявки!`
              )
              .setColor(0xFFA500);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
          }
        }
      } 
      
      // НА ОБЗВОН
      else if (action === 'call') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0x808080);
        
        await interaction.update({ embeds: [embed], components: [interaction.message.components[0]] });
        await channel.send(`<@${targetUserId}> 📞 Вы **ВЫЗВАНЫ НА ОБЗВОН** в **${stackName}**. Будьте готовы к вопросам в войсе.`);
        
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`📞 ВЫЗОВ НА ОБЗВОН | ${stackName}`)
              .setDescription(
                `**Вы были вызваны на обзвон в клан WINTER TEAM!**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `**Пожалуйста, будьте готовы:**\n` +
                `✅ Иметь рабочий микрофон\n` +
                `✅ Ответить на вопросы о вашем опыте\n` +
                `✅ Показать часы в Rust (если потребуется)\n` +
                `✅ Быть адекватным и вежливым\n\n` +
                `📌 Зайдите в голосовой канал и ожидайте стаффа.\n` +
                `⏰ У вас есть 10-15 минут, чтобы присоединиться!`
              )
              .setColor(0x808080);
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
          }
        }
      } 
      
      // ОТКЛОНИТЬ (открываем модальное окно)
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
        
        const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(reasonRow);
        
        await interaction.showModal(modal);
      }
    }
  }
});

client.on('error', error => {
  console.error('❌ Ошибка клиента:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Необработанная ошибка:', error);
});

// ========== ЗАПУСК БОТА ==========
const token = process.env.DISCORD_TOKEN || (config.token || null);

if (!token) {
  console.error('❌ ТОКЕН НЕ НАЙДЕН!');
  process.exit(1);
}

client.login(token).catch(error => {
  console.error('❌ Ошибка входа:', error);
  process.exit(1);
});

// ========== HTTP СЕРВЕР ==========
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>WINTER TEAM Bot</title>
      <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: #1a1a1a; color: white; }
        h1 { color: #3498DB; }
      </style>
    </head>
    <body>
      <h1>💧 WINTER TEAM BOT</h1>
      <p>Бот работает!</p>
      <p>Статус: 🟢 Online</p>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ HTTP сервер запущен на порту ${PORT}`);
});
