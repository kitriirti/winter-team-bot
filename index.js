require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    ChannelType,
    REST,
    Routes
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================================
//                   ЗАЩИТА ОТ КРАША ПРОЦЕССА
// ============================================================
process.on('uncaughtException', (error) => {
    console.error('❌ НЕОБРАБОТАННАЯ ОШИБКА:', error.message);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ НЕОБРАБОТАННЫЙ PROMISE REJECTION:', reason);
});

// ============================================================
//                            КЛИЕНТ
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Channel],
    failIfNotExists: false,
    rest: {
        retries: 3,
        timeout: 15000,
    },
});

// ============================================================
//                        ХРАНИЛИЩЕ ДАННЫХ
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            console.log('✅ Создана папка data');
        }
    } catch (e) {
        console.error('❌ Ошибка создания папки data:', e.message);
    }
}

function readJSON(filename) {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`❌ Ошибка чтения ${filename}:`, e.message);
    }
    return null;
}

function writeJSON(filename, data) {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error(`❌ Ошибка записи ${filename}:`, e.message);
    }
}

// Инициализация файлов данных
function initDataFiles() {
    ensureDataDir();
    
    const files = ['events.json', 'reminders.json', 'afk.json'];
    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        if (!fs.existsSync(filePath)) {
            const defaultValue = file === 'reminders.json' ? [] : {};
            writeJSON(file, defaultValue);
            console.log(`✅ Создан ${file}`);
        }
    }
}

initDataFiles();

// ============================================================
//                     ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function safeString(val, fallback = 'Неизвестно') {
    try {
        if (val === null || val === undefined) return fallback;
        return String(val);
    } catch {
        return fallback;
    }
}

function safeNumber(val, fallback = 0) {
    try {
        const num = parseInt(val);
        return isNaN(num) ? fallback : num;
    } catch {
        return fallback;
    }
}

function getEnv(key, fallback = '') {
    try {
        return process.env[key] || fallback;
    } catch {
        return fallback;
    }
}

// ============================================================
//                    РЕГИСТРАЦИЯ КОМАНД
// ============================================================
const commands = [
    {
        name: 'setup',
        description: 'Настройка систем',
        options: [
            {
                type: 1,
                name: 'apply',
                description: 'Создать панель заявок',
            },
            {
                type: 1,
                name: 'tickets',
                description: 'Создать панель тикетов',
            },
        ],
    },
    {
        name: 'ticket',
        description: 'Управление тикетами',
        options: [
            {
                type: 1,
                name: 'create',
                description: 'Создать новый тикет',
            },
        ],
    },
    {
        name: 'event',
        description: 'Управление ивентами',
        options: [
            {
                type: 1,
                name: 'create',
                description: 'Создать ивент',
                options: [
                    { type: 3, name: 'название', description: 'Название ивента', required: true },
                    { type: 3, name: 'описание', description: 'Описание', required: true },
                    { type: 3, name: 'дата', description: 'Дата (ДД.ММ.ГГГГ)', required: true },
                    { type: 3, name: 'время', description: 'Время МСК (ЧЧ:ММ)', required: true },
                    { type: 7, name: 'канал', description: 'Канал для публикации', required: false },
                ],
            },
            {
                type: 1,
                name: 'end',
                description: 'Завершить ивент',
                options: [
                    { type: 3, name: 'id', description: 'ID ивента', required: true },
                ],
            },
        ],
    },
    {
        name: 'raid',
        description: 'Объявить рейд',
        options: [
            { type: 3, name: 'сообщение', description: 'Дополнительное сообщение', required: false },
        ],
    },
    {
        name: 'afk',
        description: 'Управление отпусками',
        options: [
            {
                type: 1,
                name: 'setup',
                description: 'Создать панель отпусков',
            },
            {
                type: 1,
                name: 'list',
                description: 'Список отсутствующих',
            },
        ],
    },
];

async function registerCommands() {
    try {
        const token = getEnv('BOT_TOKEN');
        const clientId = getEnv('CLIENT_ID');
        
        if (!token || !clientId) {
            console.error('❌ BOT_TOKEN или CLIENT_ID не найдены!');
            return;
        }
        
        const rest = new REST({ version: '10' }).setToken(token);
        
        console.log('🔄 Обновление слеш-команд...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('✅ Команды зарегистрированы:');
        commands.forEach(cmd => console.log(`  /${cmd.name}`));
        
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error.message);
    }
}

// ============================================================
//                        СИСТЕМА ЛОГОВ
// ============================================================
async function sendLog(guildId, type, data) {
    try {
        if (!guildId) return;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const logChannelId = getEnv('LOG_CHANNEL_ID');
        if (!logChannelId) return;

        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        let embed = new EmbedBuilder().setTimestamp();

        switch (type) {
            case 'apply':
                embed.setTitle('📋 Новая заявка')
                    .setColor(0xFFA500)
                    .addFields(
                        { name: '👤 Пользователь', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '🆔 ID', value: safeString(data.userId), inline: true },
                        { name: '⏱️ Часы', value: safeString(data.hours), inline: true },
                        { name: '🎂 Возраст', value: safeString(data.age), inline: true },
                        { name: '🕐 Онлайн', value: safeString(data.dailyHours), inline: true },
                        { name: '🎯 Роль', value: safeString(data.role), inline: true },
                        { name: '👂 Коллы', value: `${safeString(data.listenSkill)}/10`, inline: true },
                    );
                break;

            case 'member_join':
                embed.setTitle('✅ Новый участник')
                    .setColor(0x57F287)
                    .setDescription(`<@${safeString(data.userId)}> присоединился!`)
                    .addFields(
                        { name: '👤 Имя', value: safeString(data.userTag), inline: true },
                        { name: '🆔 ID', value: safeString(data.userId), inline: true },
                    );
                break;

            case 'ticket_created':
                embed.setTitle('🎫 Тикет создан')
                    .setColor(0x3498DB)
                    .addFields(
                        { name: '👤 Кем', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '📝 Канал', value: `<#${safeString(data.channelId)}>`, inline: true },
                    );
                break;

            case 'ticket_closed':
                embed.setTitle('🔒 Тикет закрыт')
                    .setColor(0xED4245)
                    .addFields(
                        { name: '👤 Кем', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '👮 Закрыл', value: `<@${safeString(data.staffId)}>`, inline: true },
                        { name: '📝 Причина', value: safeString(data.reason), inline: false },
                    );
                break;

            case 'call_invite':
                embed.setTitle('📞 Вызов на обзвон')
                    .setColor(0x9B59B6)
                    .addFields(
                        { name: '👤 Кого', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '👮 Кто', value: `<@${safeString(data.staffId)}>`, inline: true },
                    );
                break;

            case 'ticket_review':
                embed.setTitle('⏳ На рассмотрении')
                    .setColor(0xF1C40F)
                    .addFields(
                        { name: '👤 Кем', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '👮 Кто', value: `<@${safeString(data.staffId)}>`, inline: true },
                    );
                break;

            case 'ticket_deleted':
                embed.setTitle('🗑️ Тикет удалён')
                    .setColor(0x95A5A6)
                    .addFields(
                        { name: '👤 Кем', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '👮 Кто', value: `<@${safeString(data.staffId)}>`, inline: true },
                    );
                break;

            case 'event_created':
                embed.setTitle('📅 Ивент создан')
                    .setColor(0x5865F2)
                    .addFields(
                        { name: '📋 Название', value: safeString(data.title), inline: true },
                        { name: '📆 Дата', value: safeString(data.date), inline: true },
                        { name: '🕐 Время', value: `${safeString(data.time)} МСК`, inline: true },
                    );
                break;

            case 'afk_vacation':
                embed.setTitle('📅 ОТПУСК')
                    .setColor(0xE67E22)
                    .addFields(
                        { name: '👤 Кто', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '📅 Дней', value: safeString(data.days), inline: true },
                        { name: '📝 Причина', value: safeString(data.reason), inline: false },
                    );
                break;

            case 'afk_away':
                embed.setTitle('⏰ ОТОШЁЛ')
                    .setColor(0x3498DB)
                    .addFields(
                        { name: '👤 Кто', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '⏰ Время', value: safeString(data.timeStr), inline: true },
                        { name: '📝 Причина', value: safeString(data.reason), inline: false },
                    );
                break;

            case 'afk_return':
                embed.setTitle('🔄 ВЕРНУЛСЯ')
                    .setColor(0x2ECC71)
                    .addFields(
                        { name: '👤 Кто', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '⏱️ Отсутствовал', value: safeString(data.timeAway), inline: true },
                    );
                break;
        }

        await logChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        console.error('❌ Ошибка в sendLog:', e.message);
    }
}

// ============================================================
//                        СИСТЕМА ТИКЕТОВ
// ============================================================
async function createTicket(interaction) {
    try {
        const guild = interaction.guild;
        if (!guild) return interaction.reply({ content: '❌ Ошибка: сервер не найден.', ephemeral: true });

        const categoryId = getEnv('TICKET_CATEGORY_ID');
        const staffRoleId = getEnv('TICKET_STAFF_ROLE_ID');

        if (!categoryId || !staffRoleId) {
            return interaction.reply({ content: '❌ Система тикетов не настроена.', ephemeral: true });
        }

        const existingChannel = guild.channels.cache.find(
            c => c.name === `ticket-${interaction.user.username.toLowerCase()}` && c.parentId === categoryId
        );

        if (existingChannel) {
            return interaction.reply({ content: '❌ У тебя уже есть открытый тикет!', ephemeral: true });
        }

        const ticketChannel = await guild.channels.create({
            name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '')}`,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
            ],
        });

        const embed = new EmbedBuilder()
            .setTitle('🎫 Тикет создан')
            .setDescription(`**Пользователь:** ${interaction.user}\n**Статус:** 🟡 Ожидает`)
            .setColor(0x3498DB)
            .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket_close_${interaction.user.id}`).setLabel('🔒 Закрыть').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ticket_call_${interaction.user.id}`).setLabel('📞 Обзвон').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ticket_review_${interaction.user.id}`).setLabel('⏳ Рассмотрение').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`ticket_delete_${interaction.user.id}`).setLabel('🗑️ Удалить').setStyle(ButtonStyle.Danger),
        );

        await ticketChannel.send({ content: `||${interaction.user}|| <@&${staffRoleId}>`, embeds: [embed], components: [buttons] });

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'ticket_created', {
            userId: interaction.user.id,
            channelId: ticketChannel.id,
        });

        await interaction.reply({ content: `✅ Тикет создан: ${ticketChannel}`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка создания тикета:', e.message);
        try {
            await interaction.reply({ content: '❌ Ошибка создания тикета.', ephemeral: true });
        } catch {}
    }
}

async function closeTicket(interaction, userId, reason) {
    try {
        const channel = interaction.channel;
        if (!channel) return;

        try {
            const user = await client.users.fetch(userId);
            await user.send(`🔒 Тикет закрыт.\nПричина: ${reason}`).catch(() => {});
        } catch {}

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'ticket_closed', {
            userId,
            staffId: interaction.user.id,
            reason,
        });

        await channel.send(`🔒 Тикет закрыл ${interaction.user}. Причина: ${reason}`);
        await channel.permissionOverwrites.edit(userId, { ViewChannel: false, SendMessages: false }).catch(() => {});
        await interaction.message?.edit({ components: [] }).catch(() => {});
    } catch (e) {
        console.error('❌ Ошибка закрытия тикета:', e.message);
    }
}

async function callUser(interaction, userId) {
    try {
        const channel = interaction.channel;
        if (!channel) return;

        try {
            const user = await client.users.fetch(userId);
            await user.send(`📞 Тебя вызывают на обзвон: ${channel}`).catch(() => {});
        } catch {}

        await channel.send(`📞 <@${userId}> вызывается на обзвон!`);

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'call_invite', {
            userId,
            staffId: interaction.user.id,
        });
        await interaction.reply({ content: '✅ Вызов отправлен!', ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка вызова:', e.message);
    }
}

async function setTicketReview(interaction, userId) {
    try {
        await interaction.channel?.send(`⏳ Тикет на рассмотрении у ${interaction.user}`);
        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'ticket_review', {
            userId,
            staffId: interaction.user.id,
        });
        await interaction.reply({ content: '✅ Статус обновлён!', ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка setTicketReview:', e.message);
    }
}

async function deleteTicket(interaction, userId) {
    try {
        const channel = interaction.channel;
        if (!channel) return;

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'ticket_deleted', {
            userId,
            staffId: interaction.user.id,
        });
        await interaction.reply({ content: '🗑️ Удаление через 5 сек...', ephemeral: true });
        setTimeout(() => {
            channel.delete().catch(() => {});
        }, 5000);
    } catch (e) {
        console.error('❌ Ошибка удаления тикета:', e.message);
    }
}

// ============================================================
//                        СИСТЕМА ИВЕНТОВ
// ============================================================
function getEvents() {
    const data = readJSON('events.json');
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function saveEvents(data) {
    if (data && typeof data === 'object') writeJSON('events.json', data);
}

function getReminders() {
    const data = readJSON('reminders.json');
    return Array.isArray(data) ? data : [];
}

function saveReminders(data) {
    if (Array.isArray(data)) writeJSON('reminders.json', data);
}

async function updateEventEmbed(eventId) {
    try {
        const events = getEvents();
        const event = events[eventId];
        if (!event || !event.active) return;

        const channel = client.channels.cache.get(event.channelId);
        if (!channel) return;

        const message = await channel.messages.fetch(event.messageId).catch(() => null);
        if (!message) return;

        const oldEmbed = message.embeds[0];
        if (!oldEmbed) return;

        const formatList = (list) => {
            if (!Array.isArray(list) || list.length === 0) return '>>> *Никого*';
            return '>>> ' + list.map(id => `<@${id}>`).join('\n');
        };

        const newEmbed = new EmbedBuilder(oldEmbed).setFields(
            {
                name: '📋 Дата и время',
                value: `📆 **${event.date}**\n🕐 **${event.time} МСК**\n\n<t:${event.unixTimestamp}:F>\n(<t:${event.unixTimestamp}:R>)`,
                inline: false
            },
            { name: `✅ Придут (${event.accepted.length})`, value: formatList(event.accepted), inline: true },
            { name: `❌ Не придут (${event.declined.length})`, value: formatList(event.declined), inline: true },
            { name: `🤔 Возможно (${event.tentative.length})`, value: formatList(event.tentative), inline: true },
        );

        await message.edit({ embeds: [newEmbed] }).catch(() => {});
    } catch (e) {
        console.error('❌ Ошибка updateEventEmbed:', e.message);
    }
}

async function handleEventResponse(interaction, eventId, status) {
    try {
        const events = getEvents();
        const event = events[eventId];

        if (!event || !event.active) {
            return interaction.reply({ content: '❌ Ивент завершён или не найден.', ephemeral: true });
        }

        const userId = interaction.user.id;

        if (!Array.isArray(event.accepted)) event.accepted = [];
        if (!Array.isArray(event.declined)) event.declined = [];
        if (!Array.isArray(event.tentative)) event.tentative = [];

        event.accepted = event.accepted.filter(id => id !== userId);
        event.declined = event.declined.filter(id => id !== userId);
        event.tentative = event.tentative.filter(id => id !== userId);

        if (status === 'accept') event.accepted.push(userId);
        if (status === 'decline') event.declined.push(userId);
        if (status === 'tentative') event.tentative.push(userId);

        saveEvents(events);
        await updateEventEmbed(eventId);

        const texts = { accept: '✅ Приду', decline: '❌ Не приду', tentative: '🤔 Возможно' };
        await interaction.reply({ content: `${texts[status]} → **${event.title}**`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка handleEventResponse:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function endEvent(interaction, eventId) {
    try {
        const events = getEvents();
        const event = events[eventId];

        if (!event) return interaction.reply({ content: '❌ Ивент не найден.', ephemeral: true });
        if (!event.active) return interaction.reply({ content: '❌ Уже завершён.', ephemeral: true });

        event.active = false;
        saveEvents(events);

        const channel = client.channels.cache.get(event.channelId);
        if (channel) {
            const message = await channel.messages.fetch(event.messageId).catch(() => null);
            if (message) {
                const oldEmbed = message.embeds[0];
                if (oldEmbed) {
                    const formatList = (list) => {
                        if (!Array.isArray(list) || list.length === 0) return '>>> *Никого*';
                        return '>>> ' + list.map(id => `<@${id}>`).join('\n');
                    };

                    const finalEmbed = new EmbedBuilder(oldEmbed)
                        .setTitle(`📅 [ЗАВЕРШЁН] ${event.title}`)
                        .setColor(0x95A5A6)
                        .setFields(
                            { name: '📋 Дата', value: `📆 ${event.date} ${event.time} МСК`, inline: false },
                            { name: `✅ Пришли (${event.accepted.length})`, value: formatList(event.accepted), inline: true },
                            { name: `❌ Не пришли (${event.declined.length})`, value: formatList(event.declined), inline: true },
                            { name: `🤔 Думали (${event.tentative.length})`, value: formatList(event.tentative), inline: true },
                        );

                    await message.edit({ content: '🔒 **ИВЕНТ ЗАВЕРШЁН**', embeds: [finalEmbed], components: [] }).catch(() => {});
                }
            }
        }

        const reminders = getReminders();
        saveReminders(reminders.filter(r => r.eventId !== eventId));

        await interaction.reply({ content: `✅ Ивент **${event.title}** завершён!`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка endEvent:', e.message);
    }
}

async function send10MinReminder(event) {
    try {
        if (!event || !event.guildId) return;
        const guild = client.guilds.cache.get(event.guildId);
        if (!guild) return;

        const channel = guild.channels.cache.get(event.channelId);
        if (!channel) return;

        const usersToPing = [...new Set([...(event.accepted || []), ...(event.tentative || [])])];

        let content = `⏰ **Ивент "${event.title}" через 10 минут!**\n`;
        if (usersToPing.length > 0) content += usersToPing.map(id => `<@${id}>`).join(' ') + '\n';
        content += `🕐 ${event.time} МСК | 📆 ${event.date}`;

        await channel.send(content).catch(() => {});

        for (const userId of usersToPing) {
            try {
                const user = await client.users.fetch(userId);
                if (user) {
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('⏰ Напоминание!')
                                .setDescription(`**${event.title}** через 10 минут!\n🕐 ${event.time} МСК\n📆 ${event.date}`)
                                .setColor(0xF1C40F)
                        ]
                    }).catch(() => {});
                }
            } catch {}
        }
    } catch (e) {
        console.error('❌ Ошибка send10MinReminder:', e.message);
    }
}

function checkEventReminders() {
    try {
        const reminders = getReminders();
        if (!Array.isArray(reminders) || reminders.length === 0) return;

        const events = getEvents();
        const now = Date.now();
        const toRemove = [];

        for (const reminder of reminders) {
            try {
                if (now >= reminder.reminderTime) {
                    const event = events[reminder.eventId];
                    if (event && event.active && !event.reminded10min) {
                        send10MinReminder(event).catch(() => {});
                        event.reminded10min = true;
                        saveEvents(events);
                    }
                    toRemove.push(reminder);
                }
            } catch {}
        }

        if (toRemove.length > 0) {
            saveReminders(reminders.filter(r => !toRemove.includes(r)));
        }
    } catch (e) {
        console.error('❌ Ошибка checkEventReminders:', e.message);
    }
}

// ============================================================
//                      СИСТЕМА ОТПУСКОВ
// ============================================================
function getAfkData() {
    const data = readJSON('afk.json');
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function saveAfkData(data) {
    if (data && typeof data === 'object') writeJSON('afk.json', data);
}

function parseTime(timeStr) {
    try {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const lower = timeStr.toLowerCase().trim();
        let totalMs = 0;

        const hourMatch = lower.match(/(\d+)\s*(?:час|ч|h|hour|hours)/);
        if (hourMatch) totalMs += parseInt(hourMatch[1]) * 60 * 60 * 1000;

        const minMatch = lower.match(/(\d+)\s*(?:мин|минут|м|m|min|mins|minute|minutes)/);
        if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;

        return totalMs > 0 ? totalMs : null;
    } catch {
        return null;
    }
}

function formatDuration(ms) {
    try {
        if (!ms || ms < 0) return 'неизвестно';
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const parts = [];
        if (days > 0) parts.push(`${days} дн.`);
        if (hours > 0) parts.push(`${hours} ч.`);
        if (minutes > 0) parts.push(`${minutes} мин.`);
        return parts.join(' ') || 'меньше минуты';
    } catch {
        return 'неизвестно';
    }
}

function formatDate(date) {
    try {
        const d = new Date(date);
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    } catch {
        return '??.??';
    }
}

async function getOrCreateAfkRole(guild) {
    try {
        if (!guild) return null;
        const roleName = '🏖️ Отпуск';
        let role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            role = await guild.roles.create({
                name: roleName,
                color: 0xE67E22,
                reason: 'Система отпусков',
            });
        }
        return role;
    } catch (e) {
        console.error('❌ Ошибка создания роли отпуска:', e.message);
        return null;
    }
}

async function giveAfkRole(guild, userId, returnTime) {
    try {
        if (!guild || !userId) return;
        const role = await getOrCreateAfkRole(guild);
        if (!role) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        await member.roles.add(role).catch(() => {});

        if (returnTime) {
            const returnDate = formatDate(returnTime);
            const tempRoleName = `🏖️ До ${returnDate}`;

            const oldRoles = member.roles.cache.filter(r => r.name.startsWith('🏖️ До '));
            for (const oldRole of oldRoles.values()) {
                await member.roles.remove(oldRole).catch(() => {});
                if (oldRole.members.size <= 1) await oldRole.delete().catch(() => {});
            }

            let tempRole = guild.roles.cache.find(r => r.name === tempRoleName);
            if (!tempRole) {
                tempRole = await guild.roles.create({
                    name: tempRoleName,
                    color: 0xE74C3C,
                    reason: `Отпуск до ${returnDate}`,
                });
            }
            await member.roles.add(tempRole).catch(() => {});
        }
    } catch (e) {
        console.error('❌ Ошибка giveAfkRole:', e.message);
    }
}

async function removeAfkRole(guild, userId) {
    try {
        if (!guild || !userId) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        const mainRole = guild.roles.cache.find(r => r.name === '🏖️ Отпуск');
        if (mainRole) await member.roles.remove(mainRole).catch(() => {});

        const tempRoles = member.roles.cache.filter(r => r.name.startsWith('🏖️ До '));
        for (const tempRole of tempRoles.values()) {
            await member.roles.remove(tempRole).catch(() => {});
            if (tempRole.members.size <= 0) await tempRole.delete().catch(() => {});
        }
    } catch (e) {
        console.error('❌ Ошибка removeAfkRole:', e.message);
    }
}

async function processVacation(interaction) {
    try {
        const daysStr = interaction.fields.getTextInputValue('vacation_days');
        const reason = interaction.fields.getTextInputValue('vacation_reason') || 'Без причины';
        const days = safeNumber(daysStr, 0);

        if (days <= 0) {
            return interaction.reply({ content: '❌ Укажи число больше 0.', ephemeral: true });
        }

        const userId = interaction.user.id;
        const afkData = getAfkData();

        if (afkData[userId]?.active) {
            return interaction.reply({ content: '❌ Ты уже в отпуске/отсутствии.', ephemeral: true });
        }

        const now = Date.now();
        const returnTime = now + (days * 86400000);

        afkData[userId] = {
            type: 'vacation', reason, days, startTime: now,
            returnTime, active: true, username: interaction.user.tag
        };
        saveAfkData(afkData);

        await giveAfkRole(interaction.guild, userId, returnTime);

        const afkChannelId = getEnv('AFK_CHANNEL_ID');
        if (afkChannelId) {
            const channel = interaction.guild.channels.cache.get(afkChannelId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('📅 ОТПУСК')
                    .setDescription(`**${interaction.user}** ушёл в отпуск`)
                    .setColor(0xE67E22)
                    .addFields(
                        { name: '📅 Дней', value: String(days), inline: true },
                        { name: '📝 Причина', value: reason, inline: true },
                    )
                    .setTimestamp();

                const btn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`afk_return_${userId}`).setLabel('🔄 Вернулся').setStyle(ButtonStyle.Success)
                );

                await channel.send({ embeds: [embed], components: [btn] }).catch(() => {});
            }
        }

        await sendLog(getEnv('PRIVATE_GUILD_ID'), 'afk_vacation', { userId, days, reason });
        await interaction.reply({ content: `✅ Отпуск на ${days} дн.\nПричина: ${reason}`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка processVacation:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function processAway(interaction) {
    try {
        const timeStr = interaction.fields.getTextInputValue('away_time');
        const reason = interaction.fields.getTextInputValue('away_reason') || 'Без причины';
        const returnMs = parseTime(timeStr);

        if (!returnMs) {
            return interaction.reply({ content: '❌ Формат: "2 часа" или "30 минут"', ephemeral: true });
        }

        const userId = interaction.user.id;
        const afkData = getAfkData();

        if (afkData[userId]?.active) {
            return interaction.reply({ content: '❌ Ты уже в отпуске/отсутствии.', ephemeral: true });
        }

        const now = Date.now();
        const returnTime = now + returnMs;

        afkData[userId] = {
            type: 'away', reason, timeStr, startTime: now,
            returnTime, active: true, username: interaction.user.tag
        };
        saveAfkData(afkData);

        await giveAfkRole(interaction.guild, userId, null);

        const afkChannelId = getEnv('AFK_CHANNEL_ID');
        if (afkChannelId) {
            const channel = interaction.guild.channels.cache.get(afkChannelId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('⏰ ОТОШЁЛ')
                    .setDescription(`**${interaction.user}** отошёл`)
                    .setColor(0x3498DB)
                    .addFields(
                        { name: '⏰ Время', value: timeStr, inline: true },
                        { name: '📝 Причина', value: reason, inline: true },
                    )
                    .setTimestamp();

                const btn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`afk_return_${userId}`).setLabel('🔄 Вернулся').setStyle(ButtonStyle.Success)
                );

                await channel.send({ embeds: [embed], components: [btn] }).catch(() => {});
            }
        }

        await sendLog(getEnv('PRIVATE_GUILD_ID'), 'afk_away', { userId, timeStr, reason });
        await interaction.reply({ content: `✅ Отошёл на ${timeStr}\nПричина: ${reason}`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка processAway:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function returnFromAfk(interaction, userId) {
    try {
        const afkData = getAfkData();

        if (!afkData[userId]?.active) {
            return interaction.reply({ content: '❌ Ты не в отпуске.', ephemeral: true });
        }

        const data = afkData[userId];
        const timeAway = formatDuration(Date.now() - data.startTime);

        await removeAfkRole(interaction.guild, userId);

        data.active = false;
        saveAfkData(afkData);

        if (interaction.message) {
            const oldEmbed = interaction.message.embeds[0];
            if (oldEmbed) {
                const newEmbed = new EmbedBuilder(oldEmbed)
                    .setTitle('✅ ВЕРНУЛСЯ')
                    .setColor(0x2ECC71)
                    .addFields({ name: '⏱️ Отсутствовал', value: timeAway, inline: false });
                await interaction.message.edit({ embeds: [newEmbed], components: [] }).catch(() => {});
            }
        }

        await sendLog(getEnv('PRIVATE_GUILD_ID'), 'afk_return', { userId, timeAway });
        await interaction.reply({ content: `✅ Ты вернулся! Отсутствовал: ${timeAway}`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка returnFromAfk:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function showAfkList(interaction) {
    try {
        const afkData = getAfkData();
        const active = Object.entries(afkData).filter(([, d]) => d?.active);

        if (active.length === 0) {
            return interaction.reply({ content: '✅ Все на месте!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏖️ Отсутствующие')
            .setColor(0xE67E22)
            .setDescription(`Всего: **${active.length}**`)
            .setTimestamp();

        for (const [uid, data] of active) {
            const emoji = data.type === 'vacation' ? '📅' : '⏰';
            const text = data.type === 'vacation' ? 'Отпуск' : 'Отошёл';
            embed.addFields({
                name: `${emoji} <@${uid}>`,
                value: `**${text}**\nПричина: ${data.reason}`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка showAfkList:', e.message);
    }
}

function checkExpiredAfk() {
    try {
        const afkData = getAfkData();
        const now = Date.now();
        let changed = false;

        for (const [userId, data] of Object.entries(afkData)) {
            if (data?.active && now >= data.returnTime) {
                data.active = false;
                changed = true;
                const guild = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
                if (guild) removeAfkRole(guild, userId).catch(() => {});
            }
        }

        if (changed) saveAfkData(afkData);
    } catch (e) {
        console.error('❌ Ошибка checkExpiredAfk:', e.message);
    }
}

// ============================================================
//                        ГОТОВНОСТЬ
// ============================================================
client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`📊 Серверов: ${client.guilds.cache.size}`);
    
    // Авто-регистрация команд
    await registerCommands();
    
    // Таймеры
    setInterval(checkEventReminders, 30000);
    setInterval(checkExpiredAfk, 60000);
    
    console.log('🟢 Бот готов к работе!');
});

// ============================================================
//                     ВХОД НА СЕРВЕР
// ============================================================
client.on('guildMemberAdd', async member => {
    try {
        const communityId = getEnv('COMMUNITY_GUILD_ID');
        if (member.guild.id === communityId) {
            await sendLog(communityId, 'member_join', {
                userId: member.id,
                userTag: member.user.tag,
            });
        }
    } catch (e) {
        console.error('❌ Ошибка guildMemberAdd:', e.message);
    }
});

// ============================================================
//                  ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ
// ============================================================
client.on('interactionCreate', async interaction => {
    try {
        // СЛЕШ-КОМАНДЫ
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;

            if (cmd === 'event') {
                const sub = interaction.options.getSubcommand();

                if (sub === 'create') {
                    try {
                        const title = interaction.options.getString('название');
                        const description = interaction.options.getString('описание');
                        const date = interaction.options.getString('дата');
                        const time = interaction.options.getString('время');
                        const channel = interaction.options.getChannel('канал') || interaction.channel;

                        const [day, month, year] = date.split('.').map(Number);
                        const [hours, minutes] = time.split(':').map(Number);
                        const eventDate = new Date(year, month - 1, day, hours - 3, minutes);
                        const unixTimestamp = Math.floor(eventDate.getTime() / 1000);

                        if (eventDate <= Date.now()) {
                            return interaction.reply({ content: '❌ Дата должна быть в будущем!', ephemeral: true });
                        }

                        const eventId = Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5);

                        const embed = new EmbedBuilder()
                            .setTitle(`📅 ${title}`)
                            .setDescription(description)
                            .setColor(0x5865F2)
                            .addFields(
                                { name: '📋 Дата и время', value: `📆 **${date}**\n🕐 **${time} МСК**\n\n<t:${unixTimestamp}:F>\n(<t:${unixTimestamp}:R>)`, inline: false },
                                { name: '✅ Придут (0)', value: '>>> *Никого*', inline: true },
                                { name: '❌ Не придут (0)', value: '>>> *Никого*', inline: true },
                                { name: '🤔 Возможно (0)', value: '>>> *Никого*', inline: true },
                            )
                            .setFooter({ text: `ID: ${eventId}` })
                            .setTimestamp();

                        const buttons = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`event_accept_${eventId}`).setLabel('✅ Приду').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`event_decline_${eventId}`).setLabel('❌ Не приду').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`event_tentative_${eventId}`).setLabel('🤔 Возможно').setStyle(ButtonStyle.Secondary),
                        );

                        const msg = await channel.send({ content: '||@everyone||', embeds: [embed], components: [buttons] });

                        const events = getEvents();
                        events[eventId] = {
                            messageId: msg.id, channelId: channel.id, guildId: channel.guild.id,
                            title, description, date, time, unixTimestamp,
                            creator: interaction.user.id, created: Date.now(),
                            accepted: [], declined: [], tentative: [],
                            active: true, reminded10min: false,
                        };
                        saveEvents(events);

                        const reminderTime = eventDate.getTime() - 600000;
                        if (reminderTime > Date.now()) {
                            const reminders = getReminders();
                            reminders.push({ eventId, reminderTime, type: '10min' });
                            saveReminders(reminders);
                        }

                        await interaction.reply({ content: `✅ Ивент создан!\n🆔 ID: \`${eventId}\``, ephemeral: true });
                    } catch (e) {
                        console.error('❌ Ошибка создания ивента:', e.message);
                        await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }).catch(() => {});
                    }
                }

                if (sub === 'end') {
                    await endEvent(interaction, interaction.options.getString('id'));
                }
                return;
            }

            if (cmd === 'raid') {
                try {
                    const extra = interaction.options.getString('сообщение') || '';
                    let content = '@everyone **⚔️ RAID! ⚔️**';
                    if (extra) content += `\n📋 ${extra}`;
                    content += '\n**Всем в игру!** 🔥';
                    await interaction.channel.send({ content });
                    await interaction.reply({ content: '✅ Рейд объявлен!', ephemeral: true });
                } catch (e) {
                    console.error('❌ Ошибка raid:', e.message);
                }
                return;
            }

            if (cmd === 'afk') {
                const sub = interaction.options.getSubcommand();

                if (sub === 'setup') {
                    try {
                        const embed = new EmbedBuilder()
                            .setTitle('🏖️ ОТПУСК / ОТСУТСТВИЕ')
                            .setDescription(
                                '**📅 Отпуск** — больше суток\n**⏰ Отошёл** — на часы/минуты\n\nПо возвращении нажми **🔄 Вернулся**'
                            )
                            .setColor(0x3498DB);

                        const buttons = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('afk_vacation').setLabel('📅 Отпуск').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('afk_away').setLabel('⏰ Отошёл').setStyle(ButtonStyle.Secondary),
                        );

                        await interaction.channel.send({ embeds: [embed], components: [buttons] });
                        await interaction.reply({ content: '✅ Готово!', ephemeral: true });
                    } catch (e) {
                        console.error('❌ Ошибка afk setup:', e.message);
                    }
                }

                if (sub === 'list') {
                    await showAfkList(interaction);
                }
                return;
            }

            if (cmd === 'ticket') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'create') {
                    await createTicket(interaction);
                }
                return;
            }

            if (cmd === 'setup') {
                const sub = interaction.options.getSubcommand();

                if (sub === 'apply') {
                    try {
                        const embed = new EmbedBuilder()
                            .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН RUNA')
                            .setDescription(
                                '**ТРЕБОВАНИЯ:**\n\n' +
                                '● 3000+ часов\n● 15+ лет\n● Хороший микрофон\n' +
                                '● Умение слушать коллы\n● 6+ часов онлайна в день\n\n' +
                                '**Статус:** 🟢 Открыт'
                            )
                            .setColor(0x57F287);

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('apply_button').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('toggle_status').setLabel('🟢 Открыт').setStyle(ButtonStyle.Success),
                        );

                        await interaction.channel.send({ embeds: [embed], components: [row] });
                        await interaction.reply({ content: '✅ Готово!', ephemeral: true });
                    } catch (e) {
                        console.error('❌ Ошибка setup apply:', e.message);
                    }
                }

                if (sub === 'tickets') {
                    try {
                        const embed = new EmbedBuilder()
                            .setTitle('🎫 Поддержка')
                            .setDescription('Нажми кнопку чтобы создать тикет.')
                            .setColor(0x3498DB);

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Создать тикет').setStyle(ButtonStyle.Primary),
                        );

                        await interaction.channel.send({ embeds: [embed], components: [row] });
                        await interaction.reply({ content: '✅ Готово!', ephemeral: true });
                    } catch (e) {
                        console.error('❌ Ошибка setup tickets:', e.message);
                    }
                }
                return;
            }
        }

        // КНОПКИ
        if (interaction.isButton()) {
            const cid = interaction.customId;

            if (cid === 'apply_button') {
                const modal = new ModalBuilder().setCustomId('apply_modal').setTitle('📋 Заявка в клан RUNA');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hours').setLabel('Часы в Rust').setPlaceholder('3500').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('age').setLabel('Возраст').setPlaceholder('18').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('daily_hours').setLabel('Онлайн в день').setPlaceholder('6-8 часов').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role').setLabel('Роль (электрик, комбат, билдер, фермер)').setPlaceholder('комбат').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('listen_skill').setLabel('Умение слушать коллы (1-10)').setPlaceholder('8').setStyle(TextInputStyle.Short).setRequired(true)),
                );
                await interaction.showModal(modal);
                return;
            }

            if (cid === 'toggle_status') {
                try {
                    const adminRole = getEnv('COMMUNITY_ADMIN_ROLE_ID');
                    if (!interaction.member.roles.cache.has(adminRole)) {
                        return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });
                    }
                    const embed = interaction.message.embeds[0];
                    const desc = embed.description;
                    const isOpen = desc.includes('🟢 Открыт');
                    const newEmbed = new EmbedBuilder(embed)
                        .setDescription(desc.replace(isOpen ? '🟢 Открыт' : '🔴 Закрыт', isOpen ? '🔴 Закрыт' : '🟢 Открыт'))
                        .setColor(isOpen ? 0xED4245 : 0x57F287);
                    const newRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('apply_button').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('toggle_status').setLabel(isOpen ? '🔴 Закрыт' : '🟢 Открыт').setStyle(isOpen ? ButtonStyle.Danger : ButtonStyle.Success),
                    );
                    await interaction.update({ embeds: [newEmbed], components: [newRow] });
                } catch (e) {
                    console.error('❌ Ошибка toggle_status:', e.message);
                }
                return;
            }

            if (cid.startsWith('accept_')) {
                const uid = cid.split('_')[1];
                const adminRole = getEnv('PRIVATE_ADMIN_ROLE_ID');
                if (!interaction.member.roles.cache.has(adminRole)) return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });
                try {
                    const user = await client.users.fetch(uid);
                    const guild = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
                    const ch = guild.channels.cache.find(c => c.type === 0);
                    const invite = await ch.createInvite({ maxUses: 1, maxAge: 86400, unique: true });
                    await user.send(`🎉 Заявка одобрена!\n${invite.url}`).catch(() => {});
                    await interaction.update({ content: '✅ Одобрено!', components: [], embeds: [] });
                } catch (e) {
                    await interaction.reply({ content: '❌ Ошибка.', ephemeral: true });
                }
                return;
            }

            if (cid.startsWith('deny_')) {
                const uid = cid.split('_')[1];
                const adminRole = getEnv('PRIVATE_ADMIN_ROLE_ID');
                if (!interaction.member.roles.cache.has(adminRole)) return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });
                try {
                    const user = await client.users.fetch(uid);
                    await user.send('❌ Заявка отклонена.').catch(() => {});
                    await interaction.update({ content: '❌ Отклонено!', components: [], embeds: [] });
                } catch (e) {
                    await interaction.reply({ content: '❌ Ошибка.', ephemeral: true });
                }
                return;
            }

            if (cid === 'create_ticket') { await createTicket(interaction); return; }
            if (cid.startsWith('ticket_close_')) {
                const modal = new ModalBuilder().setCustomId(`close_modal_${cid.split('_')[2]}`).setTitle('Закрытие');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close_reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                await interaction.showModal(modal);
                return;
            }
            if (cid.startsWith('ticket_call_')) { await callUser(interaction, cid.split('_')[2]); return; }
            if (cid.startsWith('ticket_review_')) { await setTicketReview(interaction, cid.split('_')[2]); return; }
            if (cid.startsWith('ticket_delete_')) { await deleteTicket(interaction, cid.split('_')[2]); return; }

            if (cid.startsWith('event_accept_')) { await handleEventResponse(interaction, cid.replace('event_accept_', ''), 'accept'); return; }
            if (cid.startsWith('event_decline_')) { await handleEventResponse(interaction, cid.replace('event_decline_', ''), 'decline'); return; }
            if (cid.startsWith('event_tentative_')) { await handleEventResponse(interaction, cid.replace('event_tentative_', ''), 'tentative'); return; }

            if (cid === 'afk_vacation') {
                const modal = new ModalBuilder().setCustomId('vacation_modal').setTitle('📅 Отпуск');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vacation_days').setLabel('Дней').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vacation_reason').setLabel('Причина').setPlaceholder('Уезжаю').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await interaction.showModal(modal);
                return;
            }

            if (cid === 'afk_away') {
                const modal = new ModalBuilder().setCustomId('away_modal').setTitle('⏰ Отошёл');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_time').setLabel('Время (2 часа / 30 минут)').setPlaceholder('2 часа').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_reason').setLabel('Причина').setPlaceholder('В магазин').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await interaction.showModal(modal);
                return;
            }

            if (cid.startsWith('afk_return_')) {
                await returnFromAfk(interaction, cid.replace('afk_return_', ''));
                return;
            }
        }

        // МОДАЛЬНЫЕ ОКНА
        if (interaction.isModalSubmit()) {
            const mid = interaction.customId;

            if (mid === 'apply_modal') {
                const hours = safeNumber(interaction.fields.getTextInputValue('hours'));
                const age = safeNumber(interaction.fields.getTextInputValue('age'));
                const dailyHours = interaction.fields.getTextInputValue('daily_hours') || '-';
                const role = interaction.fields.getTextInputValue('role') || '-';
                const listenSkill = safeNumber(interaction.fields.getTextInputValue('listen_skill'));

                if (hours < 3000) return interaction.reply({ content: '❌ Меньше 3000 часов.', ephemeral: true });
                if (age < 15) return interaction.reply({ content: '❌ Меньше 15 лет.', ephemeral: true });
                if (listenSkill < 1 || listenSkill > 10) return interaction.reply({ content: '❌ Коллы от 1 до 10.', ephemeral: true });

                const guild = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
                if (!guild) return interaction.reply({ content: '❌ Сервер не найден.', ephemeral: true });

                const ch = guild.channels.cache.get(getEnv('APPLY_CHANNEL_ID'));
                if (!ch) return interaction.reply({ content: '❌ Канал не найден.', ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle('📋 Новая заявка')
                    .setColor(0xFFA500)
                    .addFields(
                        { name: '👤 Discord', value: `${interaction.user}`, inline: false },
                        { name: '⏱️ Часы', value: String(hours), inline: true },
                        { name: '🎂 Возраст', value: String(age), inline: true },
                        { name: '🕐 Онлайн', value: dailyHours, inline: true },
                        { name: '🎯 Роль', value: role, inline: true },
                        { name: '👂 Коллы', value: `${listenSkill}/10`, inline: true },
                    )
                    .setTimestamp();

                const btns = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`accept_${interaction.user.id}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
                );

                await ch.send({ embeds: [embed], components: [btns] });
                await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'apply', {
                    userId: interaction.user.id,
                    hours, age, dailyHours, role, listenSkill,
                });
                await interaction.reply({ content: '✅ Заявка отправлена!', ephemeral: true });
                return;
            }

            if (mid === 'vacation_modal') { await processVacation(interaction); return; }
            if (mid === 'away_modal') { await processAway(interaction); return; }

            if (mid.startsWith('close_modal_')) {
                const uid = mid.split('_')[2];
                const reason = interaction.fields.getTextInputValue('close_reason') || 'Без причины';
                await closeTicket(interaction, uid, reason);
                await interaction.reply({ content: '✅ Закрыто.', ephemeral: true });
                return;
            }
        }
    } catch (e) {
        console.error('❌ ГЛОБАЛЬНАЯ ОШИБКА interactionCreate:', e.message);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true });
            }
        } catch {}
    }
});

// ============================================================
//                           ЗАПУСК
// ============================================================
const token = getEnv('BOT_TOKEN');
if (!token) {
    console.error('❌ BOT_TOKEN не найден в переменных окружения!');
    process.exit(1);
}

client.login(token).catch(e => {
    console.error('❌ Ошибка входа:', e.message);
    process.exit(1);
});
