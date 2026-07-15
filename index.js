require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Channel],
});

// ============================================================
//                        ХРАНИЛИЩА ДАННЫХ
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readJSON(filename) {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) {
        console.error(`Ошибка чтения ${filename}:`, e);
    }
    return {};
}

function writeJSON(filename, data) {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
//                        СИСТЕМА ЛОГОВ
// ============================================================
async function sendLog(guildId, type, data) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;

    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    let embed;

    switch (type) {
        case 'apply':
            embed = new EmbedBuilder()
                .setTitle('📋 Новая заявка')
                .setColor(0xFFA500)
                .addFields(
                    { name: '👤 Пользователь', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '🆔 ID', value: data.userId, inline: true },
                    { name: '⏱️ Часы', value: `${data.hours}`, inline: true },
                    { name: '🎂 Возраст', value: `${data.age}`, inline: true },
                    { name: '🕐 Онлайн в день', value: data.dailyHours, inline: true },
                    { name: '🎯 Роль', value: data.role, inline: true },
                    { name: '👂 Слушает коллы', value: `${data.listenSkill}/10`, inline: true },
                )
                .setTimestamp();
            break;

        case 'member_join':
            embed = new EmbedBuilder()
                .setTitle('✅ Новый участник')
                .setColor(0x57F287)
                .setDescription(`<@${data.userId}> присоединился к серверу!`)
                .addFields(
                    { name: '👤 Имя', value: data.userTag, inline: true },
                    { name: '🆔 ID', value: data.userId, inline: true },
                    { name: '📅 Аккаунт создан', value: `<t:${Math.floor(data.createdAt / 1000)}:R>`, inline: true },
                )
                .setTimestamp();
            break;

        case 'ticket_created':
            embed = new EmbedBuilder()
                .setTitle('🎫 Тикет создан')
                .setColor(0x3498DB)
                .addFields(
                    { name: '👤 Кем', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '📝 Канал', value: `<#${data.channelId}>`, inline: true },
                )
                .setTimestamp();
            break;

        case 'ticket_closed':
            embed = new EmbedBuilder()
                .setTitle('🔒 Тикет закрыт')
                .setColor(0xED4245)
                .addFields(
                    { name: '👤 Кем', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '👮 Закрыл', value: `<@${data.staffId}> (${data.staffTag})`, inline: true },
                    { name: '📝 Причина', value: data.reason, inline: false },
                )
                .setTimestamp();
            break;

        case 'call_invite':
            embed = new EmbedBuilder()
                .setTitle('📞 Вызов на обзвон')
                .setColor(0x9B59B6)
                .addFields(
                    { name: '👤 Кого', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '👮 Кто вызвал', value: `<@${data.staffId}> (${data.staffTag})`, inline: true },
                    { name: '📝 Канал', value: `<#${data.channelId}>`, inline: true },
                )
                .setTimestamp();
            break;

        case 'ticket_review':
            embed = new EmbedBuilder()
                .setTitle('⏳ Тикет на рассмотрении')
                .setColor(0xF1C40F)
                .addFields(
                    { name: '👤 Кем', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '👮 Кто рассматривает', value: `<@${data.staffId}> (${data.staffTag})`, inline: true },
                )
                .setTimestamp();
            break;

        case 'ticket_deleted':
            embed = new EmbedBuilder()
                .setTitle('🗑️ Тикет удалён')
                .setColor(0x95A5A6)
                .addFields(
                    { name: '👤 Кем был', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '👮 Удалил', value: `<@${data.staffId}> (${data.staffTag})`, inline: true },
                )
                .setTimestamp();
            break;

        case 'event_created':
            embed = new EmbedBuilder()
                .setTitle('📅 Ивент создан')
                .setColor(0x5865F2)
                .addFields(
                    { name: '📋 Название', value: data.title, inline: true },
                    { name: '👮 Создал', value: `<@${data.staffId}> (${data.staffTag})`, inline: true },
                    { name: '📆 Дата', value: data.date, inline: true },
                    { name: '🕐 Время', value: `${data.time} МСК`, inline: true },
                )
                .setTimestamp();
            break;

        case 'afk_vacation':
            embed = new EmbedBuilder()
                .setTitle('📅 ОТПУСК')
                .setColor(0xE67E22)
                .addFields(
                    { name: '👤 Пользователь', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '📅 Дней', value: `${data.days}`, inline: true },
                    { name: '📝 Причина', value: data.reason, inline: false },
                    { name: '🔄 Возвращение', value: `<t:${Math.floor(data.returnTime / 1000)}:F>`, inline: false },
                )
                .setTimestamp();
            break;

        case 'afk_away':
            embed = new EmbedBuilder()
                .setTitle('⏰ ОТОШЁЛ')
                .setColor(0x3498DB)
                .addFields(
                    { name: '👤 Пользователь', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '⏰ Время', value: data.timeStr, inline: true },
                    { name: '📝 Причина', value: data.reason, inline: false },
                    { name: '🔄 Вернётся', value: `<t:${Math.floor(data.returnTime / 1000)}:F>`, inline: false },
                )
                .setTimestamp();
            break;

        case 'afk_return':
            embed = new EmbedBuilder()
                .setTitle('🔄 ВОЗВРАЩЕНИЕ')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '👤 Пользователь', value: `<@${data.userId}> (${data.userTag})`, inline: true },
                    { name: '⏱️ Отсутствовал', value: data.timeAway, inline: true },
                )
                .setTimestamp();
            break;
    }

    if (embed) {
        await logChannel.send({ embeds: [embed] }).catch(() => {});
    }
}

// ============================================================
//                        СИСТЕМА ТИКЕТОВ
// ============================================================
const ticketData = {};

async function createTicket(interaction) {
    const guild = interaction.guild;
    const categoryId = process.env.TICKET_CATEGORY_ID;
    const staffRoleId = process.env.TICKET_STAFF_ROLE_ID;

    if (!categoryId || !staffRoleId) {
        return interaction.reply({ content: '❌ Система тикетов не настроена!', ephemeral: true });
    }

    const existingChannel = guild.channels.cache.find(
        c => c.name === `ticket-${interaction.user.username.toLowerCase()}` && 
        c.parentId === categoryId
    );

    if (existingChannel) {
        return interaction.reply({ content: '❌ У тебя уже есть открытый тикет!', ephemeral: true });
    }

    const ticketChannel = await guild.channels.create({
        name: `ticket-${interaction.user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
        ],
    });

    ticketData[ticketChannel.id] = {
        userId: interaction.user.id,
        staffId: null,
        status: 'open',
        createdAt: Date.now(),
    };

    const ticketEmbed = new EmbedBuilder()
        .setTitle('🎫 Тикет создан')
        .setDescription(`**Пользователь:** ${interaction.user}\n**Статус:** 🟡 Ожидает рассмотрения\n\nОпиши свою проблему или вопрос, и стафф скоро ответит.`)
        .setColor(0x3498DB)
        .setTimestamp();

    const staffButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`ticket_close_${interaction.user.id}`).setLabel('🔒 Закрыть тикет').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ticket_call_${interaction.user.id}`).setLabel('📞 Вызвать на обзвон').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ticket_review_${interaction.user.id}`).setLabel('⏳ На рассмотрении').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`ticket_delete_${interaction.user.id}`).setLabel('🗑️ Удалить тикет').setStyle(ButtonStyle.Danger),
        );

    await ticketChannel.send({ content: `||${interaction.user}|| <@&${staffRoleId}>`, embeds: [ticketEmbed], components: [staffButtons] });

    await sendLog(process.env.COMMUNITY_GUILD_ID, 'ticket_created', {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        channelId: ticketChannel.id,
    });

    await interaction.reply({ content: `✅ Тикет создан! Перейди в ${ticketChannel}`, ephemeral: true });
}

async function closeTicket(interaction, userId, reason) {
    const channel = interaction.channel;

    try {
        const user = await client.users.fetch(userId);
        await user.send(`🔒 **Твой тикет был закрыт.**\nПричина: ${reason}\nЕсли у тебя остались вопросы, создай новый тикет.`).catch(() => {});
    } catch (e) {}

    await sendLog(process.env.COMMUNITY_GUILD_ID, 'ticket_closed', {
        userId,
        userTag: (await client.users.fetch(userId).catch(() => ({ tag: 'Неизвестный' }))).tag,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
        reason,
    });

    await channel.send(`🔒 Тикет закрыт пользователем ${interaction.user}. Причина: ${reason}`);
    await channel.permissionOverwrites.edit(userId, { ViewChannel: false, SendMessages: false });
    await interaction.message.edit({ components: [] }).catch(() => {});
}

async function callUser(interaction, userId) {
    const channel = interaction.channel;

    try {
        const user = await client.users.fetch(userId);
        await user.send(`📞 **Тебя вызывают на обзвон!**\nПожалуйста, зайди в тикет: ${channel}`).catch(() => {});
    } catch (e) {}

    await channel.send(`📞 <@${userId}> вызывается на обзвон! Пожалуйста, зайди в голосовой канал.`);

    await sendLog(process.env.COMMUNITY_GUILD_ID, 'call_invite', {
        userId,
        userTag: (await client.users.fetch(userId).catch(() => ({ tag: 'Неизвестный' }))).tag,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
        channelId: channel.id,
    });
}

async function setTicketReview(interaction, userId) {
    await interaction.channel.send(`⏳ Тикет взят на рассмотрение пользователем ${interaction.user}`);
    await sendLog(process.env.COMMUNITY_GUILD_ID, 'ticket_review', {
        userId,
        userTag: (await client.users.fetch(userId).catch(() => ({ tag: 'Неизвестный' }))).tag,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
    });
}

async function deleteTicket(interaction, userId) {
    const channel = interaction.channel;
    await sendLog(process.env.COMMUNITY_GUILD_ID, 'ticket_deleted', {
        userId,
        userTag: (await client.users.fetch(userId).catch(() => ({ tag: 'Неизвестный' }))).tag,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
    });
    await interaction.reply({ content: '🗑️ Тикет будет удалён через 5 секунд...', ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 5000);
}

// ============================================================
//                        СИСТЕМА ИВЕНТОВ
// ============================================================
function getEvents() { return readJSON('events.json'); }
function saveEvents(data) { writeJSON('events.json', data); }
function getReminders() { return readJSON('reminders.json'); }
function saveReminders(data) { writeJSON('reminders.json', data); }

async function updateEventEmbed(eventId) {
    const events = getEvents();
    const event = events[eventId];
    if (!event || !event.active) return;

    const channel = client.channels.cache.get(event.channelId);
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(event.messageId);
        if (!message) return;

        const oldEmbed = message.embeds[0];
        if (!oldEmbed) return;

        const formatList = (list) => {
            if (!list || list.length === 0) return '>>> *Пока никто*';
            return '>>> ' + list.map(id => `<@${id}>`).join('\n');
        };

        const newEmbed = new EmbedBuilder(oldEmbed)
            .setFields(
                {
                    name: '📋 Дата и время',
                    value: `📆 **${event.date}**\n🕐 **${event.time} МСК**\n\n<t:${event.unixTimestamp}:F>\n(<t:${event.unixTimestamp}:R>)`,
                    inline: false
                },
                { name: `✅ Придут (${event.accepted.length})`, value: formatList(event.accepted), inline: true },
                { name: `❌ Не придут (${event.declined.length})`, value: formatList(event.declined), inline: true },
                { name: `🤔 Возможно (${event.tentative.length})`, value: formatList(event.tentative), inline: true },
            );

        await message.edit({ embeds: [newEmbed] });
    } catch (e) {
        console.error('Ошибка обновления эмбеда ивента:', e);
    }
}

async function handleEventResponse(interaction, eventId, status) {
    const events = getEvents();
    const event = events[eventId];
    
    if (!event || !event.active) {
        return interaction.reply({ content: '❌ Этот ивент уже завершён или не найден.', ephemeral: true });
    }

    const userId = interaction.user.id;

    event.accepted = event.accepted.filter(id => id !== userId);
    event.declined = event.declined.filter(id => id !== userId);
    event.tentative = event.tentative.filter(id => id !== userId);

    if (status === 'accept') event.accepted.push(userId);
    if (status === 'decline') event.declined.push(userId);
    if (status === 'tentative') event.tentative.push(userId);

    saveEvents(events);
    await updateEventEmbed(eventId);

    const statusText = {
        accept: '✅ Ты отмечен как **Приду**',
        decline: '❌ Ты отмечен как **Не приду**',
        tentative: '🤔 Ты отмечен как **Возможно**',
    };

    await interaction.reply({ content: `${statusText[status]} на ивент **${event.title}**`, ephemeral: true });
}

async function endEvent(interaction, eventId) {
    const events = getEvents();
    const event = events[eventId];

    if (!event) return interaction.reply({ content: '❌ Ивент с таким ID не найден.', ephemeral: true });
    if (!event.active) return interaction.reply({ content: '❌ Этот ивент уже завершён.', ephemeral: true });

    event.active = false;
    saveEvents(events);

    const channel = client.channels.cache.get(event.channelId);
    if (channel) {
        try {
            const message = await channel.messages.fetch(event.messageId);
            if (message) {
                const oldEmbed = message.embeds[0];
                const formatList = (list) => {
                    if (!list || list.length === 0) return '>>> *Никого*';
                    return '>>> ' + list.map(id => `<@${id}>`).join('\n');
                };

                const finalEmbed = new EmbedBuilder(oldEmbed)
                    .setTitle(`📅 [ЗАВЕРШЁН] ${event.title}`)
                    .setColor(0x95A5A6)
                    .setFields(
                        { name: '📋 Дата и время', value: `📆 **${event.date}**\n🕐 **${event.time} МСК**`, inline: false },
                        { name: `✅ Пришли (${event.accepted.length})`, value: formatList(event.accepted), inline: true },
                        { name: `❌ Не пришли (${event.declined.length})`, value: formatList(event.declined), inline: true },
                        { name: `🤔 Думали (${event.tentative.length})`, value: formatList(event.tentative), inline: true },
                    );

                await message.edit({ content: '🔒 **ИВЕНТ ЗАВЕРШЁН**', embeds: [finalEmbed], components: [] });
            }
        } catch (e) {}
    }

    const reminders = getReminders();
    const filtered = reminders.filter(r => r.eventId !== eventId);
    saveReminders(filtered);

    await interaction.reply({ content: `✅ Ивент **${event.title}** завершён!`, ephemeral: true });
}

async function send10MinReminder(event) {
    const guild = client.guilds.cache.get(event.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(event.channelId);
    if (!channel) return;

    const usersToPing = [...new Set([...event.accepted, ...event.tentative])];

    let pingMessage = `⏰ **НАПОМИНАНИЕ!**\n📅 Ивент **${event.title}** начнётся через **10 минут**!\n\n`;
    if (usersToPing.length > 0) pingMessage += usersToPing.map(id => `<@${id}>`).join(' ') + '\n\n';
    pingMessage += `🕐 Время: **${event.time} МСК**\n📆 Дата: **${event.date}**`;

    await channel.send(pingMessage).catch(() => {});

    for (const userId of usersToPing) {
        try {
            const user = await client.users.fetch(userId);
            if (user) {
                await user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⏰ Напоминание об ивенте!')
                            .setDescription(`📅 **${event.title}**\n\nИвент начнётся через **10 минут**!\n\n🕐 Время: **${event.time} МСК**\n📆 Дата: **${event.date}**\n\nНе опаздывай! ⚔️`)
                            .setColor(0xF1C40F)
                    ]
                }).catch(() => {});
            }
        } catch (e) {}
    }
}

function checkEventReminders() {
    const reminders = getReminders();
    const events = getEvents();
    const now = Date.now();
    const toRemove = [];

    for (const reminder of reminders) {
        if (now >= reminder.reminderTime) {
            const event = events[reminder.eventId];
            if (event && event.active && reminder.type === '10min' && !event.reminded10min) {
                send10MinReminder(event);
                event.reminded10min = true;
                saveEvents(events);
            }
            toRemove.push(reminder);
        }
    }

    if (toRemove.length > 0) {
        const filtered = reminders.filter(r => !toRemove.includes(r));
        saveReminders(filtered);
    }
}

// ============================================================
//                        СИСТЕМА ОТПУСКОВ
// ============================================================
function getAfkData() { return readJSON('afk.json'); }
function saveAfkData(data) { writeJSON('afk.json', data); }

function parseTime(timeStr) {
    const lower = timeStr.toLowerCase().trim();
    let totalMs = 0;

    const hourMatch = lower.match(/(\d+)\s*(?:час|ч|h|hour|hours)/);
    if (hourMatch) totalMs += parseInt(hourMatch[1]) * 60 * 60 * 1000;

    const minMatch = lower.match(/(\d+)\s*(?:мин|минут|м|m|min|mins|minute|minutes)/);
    if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;

    return totalMs > 0 ? totalMs : null;
}

function formatDuration(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    const parts = [];
    if (days > 0) parts.push(`${days} дн.`);
    if (hours > 0) parts.push(`${hours} ч.`);
    if (minutes > 0) parts.push(`${minutes} мин.`);
    return parts.join(' ') || 'меньше минуты';
}

async function giveAfkRole(guild, userId) {
    const roleId = process.env.AFK_ROLE_ID;
    if (!roleId) return;
    try {
        const member = await guild.members.fetch(userId);
        if (member) await member.roles.add(roleId);
    } catch (e) {}
}

async function removeAfkRole(guild, userId) {
    const roleId = process.env.AFK_ROLE_ID;
    if (!roleId) return;
    try {
        const member = await guild.members.fetch(userId);
        if (member) await member.roles.remove(roleId);
    } catch (e) {}
}

async function processVacation(interaction) {
    const days = parseInt(interaction.fields.getTextInputValue('vacation_days'));
    const reason = interaction.fields.getTextInputValue('vacation_reason');

    if (isNaN(days) || days <= 0) {
        return interaction.reply({ content: '❌ Укажи количество дней числом (больше 0)!', ephemeral: true });
    }

    const userId = interaction.user.id;
    const afkData = getAfkData();

    if (afkData[userId] && afkData[userId].active) {
        return interaction.reply({ content: '❌ Ты уже находишься в отпуске/отсутствии!', ephemeral: true });
    }

    const now = Date.now();
    const returnTime = now + (days * 24 * 60 * 60 * 1000);

    afkData[userId] = { type: 'vacation', reason, days, startTime: now, returnTime, active: true, username: interaction.user.tag };
    saveAfkData(afkData);

    await giveAfkRole(interaction.guild, userId);

    const afkChannelId = process.env.AFK_CHANNEL_ID;
    if (afkChannelId) {
        const afkChannel = interaction.guild.channels.cache.get(afkChannelId);
        if (afkChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📅 ОТПУСК')
                .setDescription(`**${interaction.user}** ушёл в отпуск!`)
                .setColor(0xE67E22)
                .addFields(
                    { name: '📅 Дней', value: `${days}`, inline: true },
                    { name: '📝 Причина', value: reason, inline: true },
                    { name: '🔄 Возвращение', value: `<t:${Math.floor(returnTime / 1000)}:R>`, inline: true },
                )
                .setFooter({ text: `${interaction.user.tag} • ${interaction.user.id}` })
                .setTimestamp();

            const button = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId(`afk_return_${userId}`).setLabel('🔄 Вернулся').setStyle(ButtonStyle.Success));

            await afkChannel.send({ embeds: [embed], components: [button] });
        }
    }

    await sendLog(process.env.PRIVATE_GUILD_ID, 'afk_vacation', { userId, userTag: interaction.user.tag, days, reason, returnTime });

    await interaction.reply({ content: `✅ Ты ушёл в отпуск на **${days}** дней!\nПричина: **${reason}**\nОжидаемое возвращение: <t:${Math.floor(returnTime / 1000)}:R>`, ephemeral: true });
}

async function processAway(interaction) {
    const timeStr = interaction.fields.getTextInputValue('away_time');
    const reason = interaction.fields.getTextInputValue('away_reason');

    const returnMs = parseTime(timeStr);
    if (!returnMs) {
        return interaction.reply({ content: '❌ Не могу понять время. Укажи в формате: "2 часа", "30 минут", "1 час 30 минут"', ephemeral: true });
    }

    const userId = interaction.user.id;
    const afkData = getAfkData();

    if (afkData[userId] && afkData[userId].active) {
        return interaction.reply({ content: '❌ Ты уже находишься в отпуске/отсутствии!', ephemeral: true });
    }

    const now = Date.now();
    const returnTime = now + returnMs;

    afkData[userId] = { type: 'away', reason, timeStr, startTime: now, returnTime, active: true, username: interaction.user.tag };
    saveAfkData(afkData);

    await giveAfkRole(interaction.guild, userId);

    const afkChannelId = process.env.AFK_CHANNEL_ID;
    if (afkChannelId) {
        const afkChannel = interaction.guild.channels.cache.get(afkChannelId);
        if (afkChannel) {
            const embed = new EmbedBuilder()
                .setTitle('⏰ ОТОШЁЛ')
                .setDescription(`**${interaction.user}** отошёл на время!`)
                .setColor(0x3498DB)
                .addFields(
                    { name: '⏰ Время', value: timeStr, inline: true },
                    { name: '📝 Причина', value: reason, inline: true },
                    { name: '🔄 Вернётся', value: `<t:${Math.floor(returnTime / 1000)}:R>`, inline: true },
                )
                .setFooter({ text: `${interaction.user.tag} • ${interaction.user.id}` })
                .setTimestamp();

            const button = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId(`afk_return_${userId}`).setLabel('🔄 Вернулся').setStyle(ButtonStyle.Success));

            await afkChannel.send({ embeds: [embed], components: [button] });
        }
    }

    await sendLog(process.env.PRIVATE_GUILD_ID, 'afk_away', { userId, userTag: interaction.user.tag, timeStr, reason, returnTime });

    await interaction.reply({ content: `✅ Ты отошёл на **${timeStr}**!\nПричина: **${reason}**\nОжидаемое возвращение: <t:${Math.floor(returnTime / 1000)}:R>`, ephemeral: true });
}

async function returnFromAfk(interaction, userId) {
    const afkData = getAfkData();

    if (!afkData[userId] || !afkData[userId].active) {
        return interaction.reply({ content: '❌ Ты не в отпуске/отсутствии!', ephemeral: true });
    }

    const data = afkData[userId];
    const typeText = data.type === 'vacation' ? 'отпуска' : 'отсутствия';
    const timeAway = formatDuration(Date.now() - data.startTime);

    await removeAfkRole(interaction.guild, userId);

    data.active = false;
    data.returnedAt = Date.now();
    saveAfkData(afkData);

    await interaction.message.edit({
        embeds: [
            new EmbedBuilder(interaction.message.embeds[0])
                .setTitle(`✅ ВЕРНУЛСЯ (был: ${data.type === 'vacation' ? 'Отпуск' : 'Отошёл'})`)
                .setColor(0x2ECC71)
                .addFields({ name: '⏱️ Отсутствовал', value: timeAway, inline: false })
        ],
        components: [],
    }).catch(() => {});

    await sendLog(process.env.PRIVATE_GUILD_ID, 'afk_return', { userId, userTag: interaction.user.tag, timeAway });

    await interaction.reply({ content: `✅ Ты вернулся из ${typeText}! Ты отсутствовал: **${timeAway}**`, ephemeral: true });
}

async function showAfkList(interaction) {
    const afkData = getAfkData();
    const activeEntries = Object.entries(afkData).filter(([_, data]) => data.active);

    if (activeEntries.length === 0) {
        return interaction.reply({ content: '✅ Все на месте! Никто не в отпуске/отсутствии.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setTitle('🏖️ Отсутствующие участники')
        .setColor(0xE67E22)
        .setDescription(`Всего отсутствует: **${activeEntries.length}**`)
        .setTimestamp();

    for (const [userId, data] of activeEntries) {
        const typeEmoji = data.type === 'vacation' ? '📅' : '⏰';
        const typeText = data.type === 'vacation' ? 'Отпуск' : 'Отошёл';
        embed.addFields({
            name: `${typeEmoji} <@${userId}>`,
            value: `**Тип:** ${typeText}\n**Причина:** ${data.reason}\n**Вернётся:** <t:${Math.floor(data.returnTime / 1000)}:R>`,
            inline: false
        });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

function checkExpiredAfk() {
    const afkData = getAfkData();
    const now = Date.now();
    let changed = false;

    for (const [userId, data] of Object.entries(afkData)) {
        if (data.active && now >= data.returnTime) {
            data.active = false;
            data.autoReturned = true;
            changed = true;

            const guild = client.guilds.cache.get(process.env.PRIVATE_GUILD_ID);
            if (guild) removeAfkRole(guild, userId).catch(() => {});
        }
    }

    if (changed) saveAfkData(afkData);
}

// ============================================================
//                        СБОР КОМАНД
// ============================================================
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        client.commands.set(command.data.name, command);
    }
}

// ============================================================
//                        ГОТОВНОСТЬ
// ============================================================
client.once('ready', () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`На серверах: ${client.guilds.cache.size}`);

    // Проверка напоминаний каждые 30 секунд
    setInterval(checkEventReminders, 30000);
    // Проверка авто-возврата из отпусков каждую минуту
    setInterval(checkExpiredAfk, 60000);
});

// ============================================================
//                        ВХОД НА СЕРВЕР
// ============================================================
client.on('guildMemberAdd', async member => {
    if (member.guild.id === process.env.COMMUNITY_GUILD_ID) {
        await sendLog(process.env.COMMUNITY_GUILD_ID, 'member_join', {
            userId: member.id,
            userTag: member.user.tag,
            createdAt: member.user.createdTimestamp,
        });
    }
});

// ============================================================
//                    ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ
// ============================================================
client.on('interactionCreate', async interaction => {
    
    // ===== СЛЕШ-КОМАНДЫ =====
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        // Обработка кастомных команд прямо здесь
        if (interaction.commandName === 'event') {
            const subcommand = interaction.options.getSubcommand();
            
            if (subcommand === 'create') {
                const title = interaction.options.getString('название');
                const description = interaction.options.getString('описание');
                const date = interaction.options.getString('дата');
                const time = interaction.options.getString('время');
                const channel = interaction.options.getChannel('канал') || interaction.channel;

                const [day, month, year] = date.split('.').map(Number);
                const [hours, minutes] = time.split(':').map(Number);
                const eventDate = new Date(year, month - 1, day, hours, minutes);
                eventDate.setHours(eventDate.getHours() - 3); // МСК → UTC
                const unixTimestamp = Math.floor(eventDate.getTime() / 1000);

                if (eventDate <= new Date()) {
                    return interaction.reply({ content: '❌ Дата ивента должна быть в будущем!', ephemeral: true });
                }

                const eventId = Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5);

                const embed = new EmbedBuilder()
                    .setTitle(`📅 ${title}`)
                    .setDescription(description)
                    .setColor(0x5865F2)
                    .addFields(
                        { name: '📋 Дата и время', value: `📆 **${date}**\n🕐 **${time} МСК**\n\n<t:${unixTimestamp}:F>\n(<t:${unixTimestamp}:R>)`, inline: false },
                        { name: '✅ Придут (0)', value: '>>> *Пока никто*', inline: true },
                        { name: '❌ Не придут (0)', value: '>>> *Пока никто*', inline: true },
                        { name: '🤔 Возможно (0)', value: '>>> *Пока никто*', inline: true },
                    )
                    .setFooter({ text: `ID: ${eventId} • Создал: ${interaction.user.tag}` })
                    .setTimestamp();

                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`event_accept_${eventId}`).setLabel('✅ Приду').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`event_decline_${eventId}`).setLabel('❌ Не приду').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`event_tentative_${eventId}`).setLabel('🤔 Возможно').setStyle(ButtonStyle.Secondary),
                    );

                const message = await channel.send({ content: '||@everyone||', embeds: [embed], components: [buttons] });

                const events = getEvents();
                events[eventId] = {
                    messageId: message.id, channelId: channel.id, guildId: channel.guild.id,
                    title, description, date, time, unixTimestamp,
                    creator: interaction.user.id, created: Date.now(),
                    accepted: [], declined: [], tentative: [],
                    active: true, reminded10min: false,
                };
                saveEvents(events);

                const reminderTime = eventDate.getTime() - (10 * 60 * 1000);
                if (reminderTime > Date.now()) {
                    const reminders = getReminders();
                    reminders.push({ eventId, reminderTime, type: '10min' });
                    saveReminders(reminders);
                }

                await sendLog(process.env.PRIVATE_GUILD_ID, 'event_created', {
                    title, staffId: interaction.user.id, staffTag: interaction.user.tag, date, time,
                });

                await interaction.reply({ content: `✅ **Ивент создан!**\n\n📋 **Название:** ${title}\n📆 **Дата:** ${date}\n🕐 **Время:** ${time} МСК\n🆔 **ID:** \`${eventId}\`\n\n⏰ Напоминание за 10 минут до начала.`, ephemeral: true });
                return;
            }

            if (subcommand === 'end') {
                const eventId = interaction.options.getString('id');
                await endEvent(interaction, eventId);
                return;
            }
        }

        if (interaction.commandName === 'raid') {
            const extraMessage = interaction.options.getString('сообщение') || '';
            let content = '@everyone **⚔️ RAID! ⚔️**';
            if (extraMessage) content += `\n\n📋 ${extraMessage}`;
            content += '\n\n**Всем срочно зайти в игру!** 🔥';
            await interaction.channel.send({ content });
            await interaction.reply({ content: '✅ Рейд объявлен!', ephemeral: true });
            return;
        }

        if (interaction.commandName === 'afk') {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'setup') {
                const embed = new EmbedBuilder()
                    .setTitle('🏖️ ОТПУСК / ОТСУТСТВИЕ')
                    .setDescription(
                        'Если тебе нужно отлучиться — нажми на одну из кнопок ниже.\n\n' +
                        '**📅 Отпуск** — если отсутствуешь больше суток\n' +
                        '**⏰ Отошёл** — если отлучился на несколько часов/минут\n\n' +
                        '⚠️ Стафф будет видеть твой статус.\n' +
                        'По возвращении нажми кнопку **🔄 Вернулся** в этом же канале.'
                    )
                    .setColor(0x3498DB)
                    .setFooter({ text: 'Клан RUNA • Отпуска' });

                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('afk_vacation').setLabel('📅 Отпуск').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('afk_away').setLabel('⏰ Отошёл').setStyle(ButtonStyle.Secondary),
                    );

                await interaction.channel.send({ embeds: [embed], components: [buttons] });
                await interaction.reply({ content: '✅ Панель отпусков создана!', ephemeral: true });
                return;
            }

            if (subcommand === 'list') {
                await showAfkList(interaction);
                return;
            }
        }

        if (interaction.commandName === 'setup') {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'apply') {
                const embed = new EmbedBuilder()
                    .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН RUNA')
                    .setDescription(
                        '**ТРЕБОВАНИЯ:**\n\n' +
                        '● 3000 часов на аккаунте и более\n' +
                        '● 15+ лет\n' +
                        '● Иметь хороший микрофон\n' +
                        '● Умение слушать коллы и адекватно реагировать на критику\n' +
                        '● Минимум 6 часов стабильного онлайна в день\n\n' +
                        '**Статус набора:** 🟢 Открыт'
                    )
                    .setColor(0x57F287);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('apply_button').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('toggle_status').setLabel('🟢 Статус: Открыт').setStyle(ButtonStyle.Success),
                    );

                await interaction.channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: '✅ Панель заявок создана!', ephemeral: true });
                return;
            }

            if (subcommand === 'tickets') {
                const embed = new EmbedBuilder()
                    .setTitle('🎫 Поддержка')
                    .setDescription('Нужна помощь или есть вопросы?\nНажми кнопку ниже, чтобы создать тикет.\n\n⏰ Стафф ответит в ближайшее время.')
                    .setColor(0x3498DB);

                const row = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Создать тикет').setStyle(ButtonStyle.Primary));

                await interaction.channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: '✅ Панель тикетов создана!', ephemeral: true });
                return;
            }
        }

        // Стандартный вызов команды из файла
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Произошла ошибка!', ephemeral: true }).catch(() => {});
        }
        return;
    }

    // ===== КНОПКИ =====
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Заявки
        if (customId === 'apply_button') {
            const modal = new ModalBuilder().setCustomId('apply_modal').setTitle('📋 Заявка в клан RUNA');

            const hoursInput = new TextInputBuilder().setCustomId('hours').setLabel('Сколько часов в Rust?').setPlaceholder('Например: 3500').setStyle(TextInputStyle.Short).setRequired(true);
            const ageInput = new TextInputBuilder().setCustomId('age').setLabel('Сколько тебе лет?').setPlaceholder('Например: 18').setStyle(TextInputStyle.Short).setRequired(true);
            const dailyHoursInput = new TextInputBuilder().setCustomId('daily_hours').setLabel('Сколько часов в день готов уделять?').setPlaceholder('Например: 6-8 часов').setStyle(TextInputStyle.Short).setRequired(true);
            const roleInput = new TextInputBuilder().setCustomId('role').setLabel('Твоя роль (электрик, комбат, билдер, фермер)').setPlaceholder('Например: комбат').setStyle(TextInputStyle.Short).setRequired(true);
            const listenInput = new TextInputBuilder().setCustomId('listen_skill').setLabel('Умение слушать коллы (от 1 до 10)').setPlaceholder('Например: 8').setStyle(TextInputStyle.Short).setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(hoursInput),
                new ActionRowBuilder().addComponents(ageInput),
                new ActionRowBuilder().addComponents(dailyHoursInput),
                new ActionRowBuilder().addComponents(roleInput),
                new ActionRowBuilder().addComponents(listenInput),
            );

            await interaction.showModal(modal);
            return;
        }

        if (customId === 'toggle_status') {
            if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
                return interaction.reply({ content: '⛔ Только администратор может менять статус набора.', ephemeral: true });
            }

            const embed = interaction.message.embeds[0];
            const oldDescription = embed.description;
            const isOpen = oldDescription.includes('🟢 Открыт');

            const newEmbed = new EmbedBuilder(embed)
                .setDescription(oldDescription.replace(isOpen ? '🟢 Открыт' : '🔴 Закрыт', isOpen ? '🔴 Закрыт' : '🟢 Открыт'))
                .setColor(isOpen ? 0xED4245 : 0x57F287);

            const newRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('apply_button').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('toggle_status').setLabel(isOpen ? '🔴 Статус: Закрыт' : '🟢 Статус: Открыт').setStyle(isOpen ? ButtonStyle.Danger : ButtonStyle.Success),
                );

            await interaction.update({ embeds: [newEmbed], components: [newRow] });
            return;
        }

        // Принять/отклонить заявку (приватка)
        if (customId.startsWith('accept_')) {
            const targetUserId = customId.split('_')[1];
            if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
                return interaction.reply({ content: '⛔ Нет прав!', ephemeral: true });
            }
            try {
                const user = await client.users.fetch(targetUserId);
                const privateGuild = client.guilds.cache.get(process.env.PRIVATE_GUILD_ID);
                const inviteChannel = privateGuild.channels.cache.find(c => c.type === 0);
                const invite = await inviteChannel.createInvite({ maxUses: 1, maxAge: 86400, unique: true, reason: `Приглашение для ${user.tag}` });
                await user.send(`🎉 **Твоя заявка в клан RUNA одобрена!**\nВот приглашение: ${invite.url}\n⚠️ Ссылка одноразовая и действует 24 часа.`).catch(() => {});
                await interaction.update({ content: '✅ Заявка одобрена! Приглашение отправлено в ЛС.', components: [], embeds: [] });
            } catch (e) {
                await interaction.reply({ content: '❌ Ошибка при отправке приглашения.', ephemeral: true });
            }
            return;
        }

        if (customId.startsWith('deny_')) {
            const targetUserId = customId.split('_')[1];
            if (!interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
                return interaction.reply({ content: '⛔ Нет прав!', ephemeral: true });
            }
            try {
                const user = await client.users.fetch(targetUserId);
                await user.send('❌ **Твоя заявка в клан RUNA отклонена.**\nПопробуй подать заявку позже или улучши свои навыки.').catch(() => {});
                await interaction.update({ content: '❌ Заявка отклонена.', components: [], embeds: [] });
            } catch (e) {
                await interaction.reply({ content: '❌ Ошибка при отправке уведомления.', ephemeral: true });
            }
            return;
        }

        // Тикеты
        if (customId === 'create_ticket') {
            await createTicket(interaction);
            return;
        }

        if (customId.startsWith('ticket_close_')) {
            const userId = customId.split('_')[2];
            const modal = new ModalBuilder().setCustomId(`close_modal_${userId}`).setTitle('🔒 Закрытие тикета');
            const reasonInput = new TextInputBuilder().setCustomId('close_reason').setLabel('Причина закрытия').setPlaceholder('Например: Вопрос решён').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
        }

        if (customId.startsWith('ticket_call_')) {
            const userId = customId.split('_')[2];
            await callUser(interaction, userId);
            await interaction.reply({ content: '📞 Вызов отправлен!', ephemeral: true });
            return;
        }

        if (customId.startsWith('ticket_review_')) {
            const userId = customId.split('_')[2];
            await setTicketReview(interaction, userId);
            await interaction.reply({ content: '⏳ Статус обновлён!', ephemeral: true });
            return;
        }

        if (customId.startsWith('ticket_delete_')) {
            const userId = customId.split('_')[2];
            await deleteTicket(interaction, userId);
            return;
        }

        // Ивенты
        if (customId.startsWith('event_accept_')) {
            await handleEventResponse(interaction, customId.replace('event_accept_', ''), 'accept');
            return;
        }
        if (customId.startsWith('event_decline_')) {
            await handleEventResponse(interaction, customId.replace('event_decline_', ''), 'decline');
            return;
        }
        if (customId.startsWith('event_tentative_')) {
            await handleEventResponse(interaction, customId.replace('event_tentative_', ''), 'tentative');
            return;
        }

        // Отпуска
        if (customId === 'afk_vacation') {
            const afkData = getAfkData();
            if (afkData[interaction.user.id] && afkData[interaction.user.id].active) {
                return interaction.reply({ content: '❌ Ты уже находишься в отпуске/отсутствии!', ephemeral: true });
            }

            const modal = new ModalBuilder().setCustomId('vacation_modal').setTitle('📅 Оформление отпуска');
            const daysInput = new TextInputBuilder().setCustomId('vacation_days').setLabel('На сколько дней?').setPlaceholder('Например: 7').setStyle(TextInputStyle.Short).setRequired(true);
            const reasonInput = new TextInputBuilder().setCustomId('vacation_reason').setLabel('Причина отпуска').setPlaceholder('Например: Уезжаю на море').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(daysInput), new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
        }

        if (customId === 'afk_away') {
            const afkData = getAfkData();
            if (afkData[interaction.user.id] && afkData[interaction.user.id].active) {
                return interaction.reply({ content: '❌ Ты уже находишься в отпуске/отсутствии!', ephemeral: true });
            }

            const modal = new ModalBuilder().setCustomId('away_modal').setTitle('⏰ Отсутствие');
            const timeInput = new TextInputBuilder().setCustomId('away_time').setLabel('На сколько часов или минут?').setPlaceholder('Например: 2 часа или 30 минут').setStyle(TextInputStyle.Short).setRequired(true);
            const reasonInput = new TextInputBuilder().setCustomId('away_reason').setLabel('Причина отсутствия').setPlaceholder('Например: Пошёл в магазин').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(timeInput), new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
        }

        if (customId.startsWith('afk_return_')) {
            const userId = customId.replace('afk_return_', '');
            await returnFromAfk(interaction, userId);
            return;
        }
    }

    // ===== МОДАЛЬНЫЕ ОКНА =====
    if (interaction.isModalSubmit()) {
        
        if (interaction.customId === 'apply_modal') {
            const hours = parseInt(interaction.fields.getTextInputValue('hours'));
            const age = parseInt(interaction.fields.getTextInputValue('age'));
            const dailyHours = interaction.fields.getTextInputValue('daily_hours');
            const role = interaction.fields.getTextInputValue('role');
            const listenSkill = parseInt(interaction.fields.getTextInputValue('listen_skill'));

            if (hours < 3000) return interaction.reply({ content: '❌ **Заявка отклонена.**\nПричина: у тебя меньше 3000 часов на аккаунте.', ephemeral: true });
            if (age < 15) return interaction.reply({ content: '❌ **Заявка отклонена.**\nПричина: тебе меньше 15 лет.', ephemeral: true });
            if (listenSkill < 1 || listenSkill > 10) return interaction.reply({ content: '❌ **Ошибка.**\nУмение слушать коллы должно быть от 1 до 10.', ephemeral: true });

            const privateGuild = client.guilds.cache.get(process.env.PRIVATE_GUILD_ID);
            if (!privateGuild) return interaction.reply({ content: '❌ Приватный сервер не найден.', ephemeral: true });

            const applyChannel = privateGuild.channels.cache.get(process.env.APPLY_CHANNEL_ID);
            if (!applyChannel) return interaction.reply({ content: '❌ Канал заявок не найден.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('📋 Новая заявка в клан RUNA')
                .setColor(0xFFA500)
                .addFields(
                    { name: '👤 Discord', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
                    { name: '🆔 ID', value: interaction.user.id, inline: true },
                    { name: '⏱️ Часы в Rust', value: `${hours}`, inline: true },
                    { name: '🎂 Возраст', value: `${age}`, inline: true },
                    { name: '🕐 Онлайн в день', value: dailyHours, inline: true },
                    { name: '🎯 Роль', value: role, inline: true },
                    { name: '👂 Умение слушать коллы', value: `${listenSkill}/10`, inline: true },
                )
                .setTimestamp();

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`accept_${interaction.user.id}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
                );

            await applyChannel.send({ embeds: [embed], components: [buttons] });

            await sendLog(process.env.COMMUNITY_GUILD_ID, 'apply', {
                userId: interaction.user.id, userTag: interaction.user.tag,
                hours, age, dailyHours, role, listenSkill,
            });

            await interaction.reply({ content: '✅ **Заявка успешно отправлена!**\nОжидай, скоро с тобой свяжутся.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'vacation_modal') {
            await processVacation(interaction);
            return;
        }

        if (interaction.customId === 'away_modal') {
            await processAway(interaction);
            return;
        }

        if (interaction.customId.startsWith('close_modal_')) {
            const userId = interaction.customId.split('_')[2];
            const reason = interaction.fields.getTextInputValue('close_reason');
            await closeTicket(interaction, userId, reason);
            await interaction.reply({ content: '✅ Тикет закрыт.', ephemeral: true });
            return;
        }
    }
});

// ============================================================
//                        ЗАПУСК
// ============================================================
client.login(process.env.BOT_TOKEN);
