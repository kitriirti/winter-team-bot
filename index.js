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

// Получаем настройки из переменных окружения или config.json
const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN || config.token,
    clientId: process.env.CLIENT_ID || config.clientId,
    guildId: process.env.GUILD_ID || config.guildId,
    ticketCategory: process.env.TICKET_CATEGORY || config.ticketCategory,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1 || config.staffRoleId_stack1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2 || config.staffRoleId_stack2
  };
};

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} успешно запущен!`);
  
  // Устанавливаем статус
  client.user.setActivity('заявки в клан WT', { type: 3 }); // WATCHING
  
  try {
    await client.application.commands.create({
      name: 'ticket_stack1',
      description: 'Создать сообщение для подачи заявок в СТАК 1 (3000+ часов)'
    });
    
    await client.application.commands.create({
      name: 'ticket_stack2',
      description: 'Создать сообщение для подачи заявок в СТАК 2 (2000+ часов)'
    });
    
    console.log('✅ Команды /ticket_stack1 и /ticket_stack2 зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации команд:', error);
  }
  
  // Очищаем хранилище тикетов
  activeTickets.clear();
  console.log('✅ Хранилище тикетов очищено');
  console.log('✅ Бот готов к работе!');
});

client.on('interactionCreate', async interaction => {
  
  const cfg = getConfig();
  
  // ========== КОМАНДА ДЛЯ СТАК 1 (3000 часов) ==========
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
        '✅ 3000 часов на аккаунте и более\n' +
        '✅ 15+ лет\n' +
        '✅ Иметь хороший микрофон\n' +
        '✅ Умение слушать коллы и адекватно реагировать на критику\n' +
        '✅ Минимум 6 часов стабильного онлайна в день\n\n' +
        'Нажмите кнопку ниже, чтобы заполнить анкету.'
      )
      .setColor(0xFF4500)
      .setFooter({ text: 'WINTER TEAM • TICKET STACK 1' })
      .setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket_stack1')
          .setLabel('📝 Подать заявку в СТАК 1')
          .setStyle(ButtonStyle.Danger)
      );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ 
      content: '✅ Сообщение для СТАК 1 создано!', 
      ephemeral: true 
    });
  }

  // ========== КОМАНДА ДЛЯ СТАК 2 (2000 часов) ==========
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
        '✅ 2000 часов на аккаунте и более\n' +
        '✅ 14+ лет\n' +
        '✅ Иметь хороший микрофон\n' +
        '✅ Умение слушать коллы и адекватно реагировать на критику\n' +
        '✅ Минимум 6 часов стабильного онлайна в день\n\n' +
        'Нажмите кнопку ниже, чтобы заполнить анкету.'
      )
      .setColor(0x3498DB)
      .setFooter({ text: 'WINTER TEAM • TICKET STACK 2' })
      .setTimestamp();

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

  // ========== ОБРАБОТКА КНОПОК (открытие модального окна) ==========
  if (interaction.isButton()) {
    
    let stackType = '';
    if (interaction.customId === 'create_ticket_stack1') {
      stackType = 'stack1';
    } else if (interaction.customId === 'create_ticket_stack2') {
      stackType = 'stack2';
    }
    
    if (stackType) {
      
      // ПРОВЕРКА: Есть ли у пользователя уже активный тикет в ЭТОМ стаке?
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
        .setPlaceholder(stackType === 'stack1' ? '15+ лет' : '14+ лет')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      const steamInput = new TextInputBuilder()
        .setCustomId('steam')
        .setLabel('Ссылка на Steam / Сколько часов?')
        .setPlaceholder(stackType === 'stack1' ? 'https://steamcommunity.com/... / 3000+ часов' : 'https://steamcommunity.com/... / 2000+ часов')
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

  // ========== ОБРАБОТКА ОТПРАВКИ АНКЕТЫ ==========
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
      
      await interaction.reply({
        content: '⏳ Обрабатываем вашу заявку...',
        ephemeral: true
      });

      try {
        const stackName = stackType === 'stack1' ? 'СТАК-1' : 'СТАК-2';
        const stackColor = stackType === 'stack1' ? 0xFF4500 : 0x3498DB;
        const stackEmoji = stackType === 'stack1' ? '🔥' : '💧';
        const stackHours = stackType === 'stack1' ? '3000+' : '2000+';
        const stackAge = stackType === 'stack1' ? '15+' : '14+';

        // Создаём приватный канал
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

        // Сохраняем информацию о тикете
        activeTickets.set(`${user.id}_${stackType}`, {
          channelId: ticketChannel.id,
          userId: user.id,
          stackType: stackType,
          status: 'pending',
          createdAt: Date.now()
        });

        // Компактный дизайн Embed
        const applicationEmbed = new EmbedBuilder()
          .setColor(stackColor)
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .setDescription(
            `### <@${user.id}> подал заявку в **${stackName}**\n` +
            `**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n\n` +
            `👤 **Имя:** ${name}\n` +
            `🎂 **Возраст:** ${age}\n` +
            `🎮 **Steam / Часы:** ${steam}\n` +
            `🎯 **Желаемая роль:** ${role}\n` +
            `👂 **Готовность слушать:** ${listen}\n\n` +
            `**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n` +
            `📌 *Требования ${stackName}: ${stackHours} часов, ${stackAge} лет*`
          )
          .setFooter({ text: `WINTER TEAM • TICKET ${stackName} • ${user.tag}` })
          .setTimestamp();

        // Кнопки управления
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
              .setStyle(ButtonStyle.Danger)
          );

        // Отправляем заявку
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

  // ========== ОБРАБОТКА КНОПОК УПРАВЛЕНИЯ (С ОТПРАВКОЙ В ЛС) ==========
  if (interaction.isButton()) {
    
    const customId = interaction.customId;
    
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
      
      // Получаем пользователя для отправки ЛС
      let targetUser;
      try {
        targetUser = await client.users.fetch(targetUserId);
      } catch (error) {
        console.error(`❌ Не удалось найти пользователя ${targetUserId}:`, error);
      }
      
      // ========== ПРИНЯТЬ ==========
      if (action === 'accept') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0x00FF00)
          .setFooter({ text: `✅ Принят в ${stackName} • ${interaction.user.tag}` });
        
        await interaction.update({ embeds: [embed], components: [] });
        await channel.send(`<@${targetUserId}> 🎉 **Поздравляем! Ваша заявка в ${stackName} ПРИНЯТА!** Свяжитесь с лидером.`);
        
        // Удаляем тикет из активных
        activeTickets.delete(`${targetUserId}_${stackType}`);
        
        // Устанавливаем таймер на удаление канала через 12 часов
        setTimeout(async () => {
          try {
            const channelToDelete = await client.channels.fetch(channel.id).catch(() => null);
            if (channelToDelete) {
              await channelToDelete.delete();
              console.log(`✅ Канал ${channel.name} удалён через 12 часов после принятия`);
            }
          } catch (error) {
            console.error('Ошибка удаления канала по таймеру:', error);
          }
        }, 12 * 60 * 60 * 1000); // 12 часов
        
        await channel.send(`⏰ **Этот канал будет автоматически удалён через 12 часов.**`);
        
        // Отправка в ЛС
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
              .setColor(0x00FF00)
              .setFooter({ text: 'WINTER TEAM • Добро пожаловать!' })
              .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
            await channel.send(`⚠️ Не удалось отправить уведомление в ЛС <@${targetUserId}>.`);
          }
        }
      } 
      
      // ========== НА РАССМОТРЕНИЕ ==========
      else if (action === 'consider') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0xFFA500)
          .setFooter({ text: `⏳ На рассмотрении (${stackName}) • ${interaction.user.tag}` });
        
        await interaction.update({ embeds: [embed], components: [interaction.message.components[0]] });
        await channel.send(`<@${targetUserId}> Ваша заявка в **${stackName}** взята **НА РАССМОТРЕНИЕ**.`);
        
        // Отправка в ЛС
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
              .setColor(0xFFA500)
              .setFooter({ text: 'WINTER TEAM • Ожидайте решения' })
              .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
            await channel.send(`⚠️ Не удалось отправить уведомление в ЛС <@${targetUserId}>.`);
          }
        }
      } 
      
      // ========== НА ОБЗВОН ==========
      else if (action === 'call') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0x808080)
          .setFooter({ text: `📞 Вызван на обзвон (${stackName}) • ${interaction.user.tag}` });
        
        await interaction.update({ embeds: [embed], components: [interaction.message.components[0]] });
        await channel.send(`<@${targetUserId}> 📞 Вы **ВЫЗВАНЫ НА ОБЗВОН** в **${stackName}**. Будьте готовы к вопросам в войсе.`);
        
        // Отправка в ЛС
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
              .setColor(0x808080)
              .setFooter({ text: 'WINTER TEAM • Не отвечайте на это сообщение' })
              .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
            await channel.send(`⚠️ Не удалось отправить уведомление в ЛС <@${targetUserId}>. Возможно, у него закрыты личные сообщения.`);
          }
        }
      } 
      
      // ========== ОТКЛОНИТЬ ==========
      else if (action === 'deny') {
        const embed = EmbedBuilder.from(originalEmbed)
          .setColor(0xFF0000)
          .setFooter({ text: `❌ Отклонено (${stackName}) • ${interaction.user.tag}` });
        
        await interaction.update({ embeds: [embed], components: [] });
        await channel.send(`<@${targetUserId}> 😔 Ваша заявка в **${stackName}** **ОТКЛОНЕНА**. Можете подать снова позже.`);
        
        // Удаляем тикет из активных
        activeTickets.delete(`${targetUserId}_${stackType}`);
        
        // Отправка в ЛС
        if (targetUser) {
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle(`${stackEmoji} ЗАЯВКА ОТКЛОНЕНА | ${stackName}`)
              .setDescription(
                `**К сожалению, ваша заявка в клан WINTER TEAM была ОТКЛОНЕНА.**\n\n` +
                `🔥 **Состав:** ${stackName}\n` +
                `👤 **Стафф:** ${interaction.user.tag}\n\n` +
                `**Возможные причины:**\n` +
                `❌ Недостаточно часов\n` +
                `❌ Не подходите по возрасту\n` +
                `❌ Не соответствуете требованиям клана\n\n` +
                `**Что дальше:**\n` +
                `✅ Вы можете подать заявку повторно позже\n` +
                `✅ Попробуйте подать заявку в другой состав (если подходите)\n` +
                `✅ Улучшайте свои навыки и приходите снова!\n\n` +
                `🍀 Удачи в поиске клана!`
              )
              .setColor(0xFF0000)
              .setFooter({ text: 'WINTER TEAM • Не расстраивайтесь!' })
              .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
          } catch (error) {
            console.error(`❌ Не удалось отправить ЛС пользователю ${targetUserId}:`, error);
          }
        }
        
        // Удаляем канал через 5 секунд
        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (error) {
            console.error('Ошибка удаления канала:', error);
          }
        }, 5000);
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
  console.error('❌ ТОКЕН НЕ НАЙДЕН! Укажите DISCORD_TOKEN в переменных окружения или в config.json');
  process.exit(1);
}

client.login(token).catch(error => {
  console.error('❌ Ошибка входа. Проверьте токен:', error);
  process.exit(1);
});

// ========== HTTP СЕРВЕР ДЛЯ RENDER ==========
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WINTER TEAM Bot</title>
      <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: #1a1a1a; color: white; }
        h1 { color: #FF4500; }
      </style>
    </head>
    <body>
      <h1>🔥 WINTER TEAM BOT</h1>
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