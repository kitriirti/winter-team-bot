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

const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN || config.token,
    clientId: process.env.CLIENT_ID || config.clientId,
    guildId: process.env.GUILD_ID || config.guildId,
    ticketCategory: process.env.TICKET_CATEGORY || config.ticketCategory,
    staffRoleId_stack1: process.env.STAFF_ROLE_STACK1 || config.staffRoleId_stack1,
    staffRoleId_stack2: process.env.STAFF_ROLE_STACK2 || config.staffRoleId_stack2,
    logChannelId: process.env.LOG_CHANNEL_ID || config.logChannelId,
    memberRoleId: process.env.MEMBER_ROLE_ID || config.memberRoleId,
    photoChannelId: process.env.PHOTO_CHANNEL_ID || config.photoChannelId // НОВАЯ ПЕРЕМЕННАЯ
  };
};

function getWorkingHoursMessage() {
  const now = new Date();
  const mskHour = (now.getUTCHours() + 3) % 24;
  if (mskHour >= 10 && mskHour < 21) return '';
  return `\n**━━━━━━━━━━━━━━━━━━━━━━━━━━**\n⏰ *Заявки рассматриваются с 10:00 до 21:00 по МСК. Ваша заявка будет обработана в рабочее время.*`;
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
  client.user.setActivity('заявки в клан WT', { type: 3 });
  
  const cfg = getConfig();
  
  try {
    const globalCommands = await client.application.commands.fetch();
    for (const cmd of globalCommands.values()) await cmd.delete();
    const guild = client.guilds.cache.get(cfg.guildId);
    if (guild) for (const cmd of (await guild.commands.fetch()).values()) await cmd.delete();
    
    await client.application.commands.create({ name: 'ticket_stack1', description: 'Создать сообщение для подачи заявок в СТАК 1 (3500+ часов)' });
    await client.application.commands.create({ name: 'ticket_stack2', description: 'Создать сообщение для подачи заявок в СТАК 2 (2500+ часов)' });
    await client.application.commands.create({ name: 'stats', description: 'Показать статистику заявок за неделю (только для стаффа)' });
    await client.application.commands.create({ name: 'battlemetrics', description: 'Показать BattleMetrics профиль игрока из заявки (только для стаффа)' });
    await client.application.commands.create({ name: 'ping', description: 'Проверить задержку бота' });
    
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
  }
});

// ========== !compress В ЛС ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;
  if (!message.content.startsWith('!compress')) return;
  
  const description = message.content.slice('!compress'.length).trim() || '';
  
  if (message.attachments.size === 0) {
    return message.reply('❌ Прикрепите фото!\nПример: `!compress Мой скриншот` + фото');
  }
  
  const attachment = message.attachments.first();
  if (!attachment.contentType?.startsWith('image/')) {
    return message.reply('❌ Файл не изображение!');
  }
  
  try {
    const cfg = getConfig();
    const guild = client.guilds.cache.get(cfg.guildId);
    if (!guild) return message.reply('❌ Сервер не найден!');
    
    // Ищем канал для фото
    let targetChannel = null;
    if (cfg.photoChannelId) {
      targetChannel = await guild.channels.fetch(cfg.photoChannelId).catch(() => null);
    }
    
    // Если нет PHOTO_CHANNEL_ID, пробуем LOG_CHANNEL_ID
    if (!targetChannel && cfg.logChannelId) {
      targetChannel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    }
    
    // Если совсем ничего нет - ищем первый текстовый канал
    if (!targetChannel) {
      targetChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages));
    }
    
    if (!targetChannel) return message.reply('❌ Не найден канал для отправки!');
    
    const response = await fetch(attachment.url);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    
    let ext = 'jpg';
    if (attachment.contentType.includes('png')) ext = 'png';
    else if (attachment.contentType.includes('webp')) ext = 'webp';
    else if (attachment.contentType.includes('gif')) ext = 'gif';
    
    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setImage(`attachment://image.${ext}`);
    if (description) embed.setDescription(`**${description}**`);
    
    await targetChannel.send({ embeds: [embed], files: [{ attachment: imageBuffer, name: `image.${ext}` }] });
    await message.reply(`✅ Отправлено в **#${targetChannel.name}**!`);
    
  } catch (error) {
    console.error('❌ !compress error:', error);
    await message.reply('❌ Ошибка отправки!');
  }
});

// ========== СЛЭШ-КОМАНДЫ ==========
client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  
  if (interaction.isCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Пинг...', fetchReply: true, ephemeral: true });
    await interaction.editReply({ content: `🏓 Понг! ${sent.createdTimestamp - interaction.createdTimestamp}ms | API: ${client.ws.ping}ms` });
  }
  
  if (interaction.isCommand() && interaction.commandName === 'battlemetrics') {
    const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || interaction.member.roles.cache.has(cfg.staffRoleId_stack2);
    if (!hasStaff && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
    const channel = interaction.channel;
    if (!channel.name.startsWith('🔥｜') && !channel.name.startsWith('💧｜')) return interaction.reply({ content: '❌ Только в каналах тикетов!', ephemeral: true });
    
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
  
  if (interaction.isCommand() && interaction.commandName === 'stats') {
    const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || interaction.member.roles.cache.has(cfg.staffRoleId_stack2);
    if (!hasStaff && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    
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
  
  if (interaction.isCommand() && (interaction.commandName === 'ticket_stack1' || interaction.commandName === 'ticket_stack2')) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
    const stack = interaction.commandName === 'ticket_stack1' ? 'stack1' : 'stack2';
    await createTicketMessage(interaction.channel, stack);
    await interaction.reply({ content: `✅ Сообщение для ${stack === 'stack1' ? 'СТАК 1' : 'СТАК 2'} создано!`, ephemeral: true });
  }
  
  // Кнопки переключения статуса
  if (interaction.isButton() && (interaction.customId === 'toggle_stack1' || interaction.customId === 'toggle_stack2')) {
    const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || interaction.member.roles.cache.has(cfg.staffRoleId_stack2) || interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
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
  
  // Кнопки открытия анкеты
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
  
  // Обработка анкеты
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
      const channel = await interaction.guild.channels.create({
        name: `${stack === 'stack1' ? '🔥' : '💧'}｜${stack === 'stack1' ? 'СТАК-1' : 'СТАК-2'}｜${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: cfg.ticketCategory,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });
      
      const ticketId = `${interaction.user.id}_${stack}`;
      activeTickets.set(ticketId, { channelId: channel.id, userId: interaction.user.id, stackType: stack, status: 'pending', createdAt: Date.now() });
      scheduleAutoDelete(channel.id, ticketId);
      
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setDescription(`### <@${interaction.user.id}> подал заявку в **${stack === 'stack1' ? 'СТАК-1' : 'СТАК-2'}**\n━━━━━━━━━━━━━━━━━━\n👤 **Имя:** ${name}\n🎂 **Возраст:** ${age}\n🔗 **Steam:** ${steam}\n⏰ **Часы:** ${hours} ч\n🎯 **Роль:** ${role}${getWorkingHoursMessage()}`);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${interaction.user.id}_${stack}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`consider_${interaction.user.id}_${stack}`).setLabel('⏳ На рассмотрение').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`call_${interaction.user.id}_${stack}`).setLabel('📞 На обзвон').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`deny_${interaction.user.id}_${stack}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`close_${channel.id}`).setLabel('🔒 Закрыть').setStyle(ButtonStyle.Secondary)
      );
      
      await channel.send({ content: `<@&${staffRole}>`, embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ Заявка создана: ${channel}` });
    } catch (error) {
      await interaction.editReply('❌ Ошибка создания!');
    }
  }
  
  // Кнопки управления тикетом
  if (interaction.isButton()) {
    const id = interaction.customId;
    
    if (id.startsWith('close_')) {
      const channelId = id.split('_')[1];
      const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId_stack1) || interaction.member.roles.cache.has(cfg.staffRoleId_stack2);
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      await interaction.reply({ content: '🔒 Закрываю...', ephemeral: true });
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      
      for (const [tid, t] of activeTickets) if (t.channelId === channelId) { clearTimeout(autoDeleteTimeouts.get(tid)); activeTickets.delete(tid); break; }
      setTimeout(() => channel?.delete().catch(() => {}), 2000);
    }
    
    if (id.startsWith('accept_') || id.startsWith('consider_') || id.startsWith('call_') || id.startsWith('deny_')) {
      const [action, userId, stack] = id.split('_');
      const staffRole = stack === 'stack1' ? cfg.staffRoleId_stack1 : cfg.staffRoleId_stack2;
      if (!interaction.member.roles.cache.has(staffRole)) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const ticketId = `${userId}_${stack}`;
      clearTimeout(autoDeleteTimeouts.get(ticketId));
      
      if (action === 'accept') {
        if (stack === 'stack1') { stats.stack1.accepted++; stats.stack1.weekAccepted++; } else { stats.stack2.accepted++; stats.stack2.weekAccepted++; }
        saveStats();
        if (cfg.memberRoleId) await interaction.guild.members.fetch(userId).then(m => m.roles.add(cfg.memberRoleId)).catch(() => {});
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
        if (stack === 'stack1') { stats.stack1.denied++; stats.stack1.weekDenied++; } else { stats.stack2.denied++; stats.stack2.weekDenied++; }
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
const token = process.env.DISCORD_TOKEN || config.token;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

// HTTP СЕРВЕР
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);
