require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits, ChannelType, REST, Routes
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================================
//                   ЗАЩИТА ОТ КРАША
// ============================================================
process.on('uncaughtException', (error) => console.error('❌ НЕОБРАБОТАННАЯ ОШИБКА:', error.message));
process.on('unhandledRejection', (reason) => console.error('❌ НЕОБРАБОТАННЫЙ REJECTION:', reason));

// ============================================================
//                            КЛИЕНТ
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Channel],
    failIfNotExists: false,
    rest: { retries: 3, timeout: 15000 },
});

// ============================================================
//                        ХРАНИЛИЩЕ ДАННЫХ
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {}
}

function readJSON(filename) {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {}
    return null;
}

function writeJSON(filename, data) {
    ensureDataDir();
    try { fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {}
}

// Инициализация всех файлов
ensureDataDir();
if (!fs.existsSync(path.join(DATA_DIR, 'events.json'))) writeJSON('events.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'reminders.json'))) writeJSON('reminders.json', []);
if (!fs.existsSync(path.join(DATA_DIR, 'afk.json'))) writeJSON('afk.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'config.json'))) writeJSON('config.json', {});

// ============================================================
//                     ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function getEnv(key, fallback = '') {
    try { return process.env[key] || fallback; } catch { return fallback; }
}

function safeString(val, fallback = 'Неизвестно') {
    try { return (val === null || val === undefined) ? fallback : String(val); } catch { return fallback; }
}

function safeNumber(val, fallback = 0) {
    try { const n = parseInt(val); return isNaN(n) ? fallback : n; } catch { return fallback; }
}

function isAdminOrStaff(member) {
    const adminRole = getEnv('COMMUNITY_ADMIN_ROLE_ID');
    const staffRole = getEnv('APPLY_STAFF_ROLE_ID');
    if (!member) return false;
    return member.roles.cache.has(adminRole) || member.roles.cache.has(staffRole);
}

function isAdmin(member) {
    const adminRole = getEnv('COMMUNITY_ADMIN_ROLE_ID');
    if (!member) return false;
    return member.roles.cache.has(adminRole);
}

function isPrivateAdmin(member) {
    const adminRole = getEnv('PRIVATE_ADMIN_ROLE_ID');
    if (!member) return false;
    return member.roles.cache.has(adminRole);
}

// ============================================================
//                    РЕГИСТРАЦИЯ КОМАНД
// ============================================================
const commands = [
    {
        name: 'setup',
        description: 'Настройка панелей',
        options: [
            { type: 1, name: 'apply', description: 'Создать панель заявок в клан' },
            { type: 1, name: 'afk', description: 'Создать панель отпусков/отсутствия' },
        ],
    },
    {
        name: 'ticket',
        description: 'Подать заявку в клан',
        options: [{ type: 1, name: 'create', description: 'Создать заявку' }],
    },
    {
        name: 'event',
        description: 'Управление ивентами',
        options: [
            {
                type: 1, name: 'create', description: 'Создать ивент',
                options: [
                    { type: 3, name: 'название', description: 'Название ивента', required: true },
                    { type: 3, name: 'описание', description: 'Описание', required: true },
                    { type: 3, name: 'дата', description: 'Дата (ДД.ММ.ГГГГ)', required: true },
                    { type: 3, name: 'время', description: 'Время МСК (ЧЧ:ММ)', required: true },
                    { type: 7, name: 'канал', description: 'Канал для публикации', required: false },
                ],
            },
            {
                type: 1, name: 'end', description: 'Завершить ивент',
                options: [{ type: 3, name: 'id', description: 'ID ивента', required: true }],
            },
        ],
    },
    {
        name: 'raid',
        description: 'Объявить рейд',
        options: [{ type: 3, name: 'сообщение', description: 'Дополнительное сообщение', required: false }],
    },
    {
        name: 'afk',
        description: 'Отпуск / отсутствие',
        options: [{ type: 1, name: 'list', description: 'Список отсутствующих' }],
    },
];

async function registerCommands() {
    try {
        const token = getEnv('BOT_TOKEN');
        const clientId = getEnv('CLIENT_ID');
        if (!token || !clientId) return console.error('❌ BOT_TOKEN или CLIENT_ID не найдены!');

        const rest = new REST({ version: '10' }).setToken(token);

        console.log('🗑️ Удаляю старые глобальные команды...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        console.log('🗑️ Удаляю команды на серверах...');
        const guilds = await rest.get(Routes.userGuilds()).catch(() => []);
        for (const guild of guilds) {
            try { await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] }); } catch {}
        }

        console.log('⏳ Ожидание 3 секунды...');
        await new Promise(r => setTimeout(r, 3000));

        console.log('📝 Регистрирую новые команды...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });

        console.log('✅ Команды зарегистрированы:');
        commands.forEach(c => console.log(`   /${c.name}`));
    } catch (e) {
        console.error('❌ Ошибка регистрации команд:', e.message);
    }
}

// ============================================================
//                        СИСТЕМА ЛОГОВ
// ============================================================
async function sendLog(guildId, type, data = {}) {
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
                embed.setTitle('📋 Новая заявка').setColor(0xFFA500)
                    .addFields({ name: '👤', value: `<@${safeString(data.userId)}>`, inline: true });
                break;
            case 'apply_accept':
                embed.setTitle('✅ Заявка одобрена').setColor(0x57F287)
                    .addFields(
                        { name: '👤 Кандидат', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '👮 Кто принял', value: `<@${safeString(data.staffId)}>`, inline: true },
                    );
                break;
            case 'apply_deny':
                embed.setTitle('❌ Заявка отклонена').setColor(0xED4245)
                    .addFields(
                        { name: '👤 Кандидат', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '👮 Кто отклонил', value: `<@${safeString(data.staffId)}>`, inline: true },
                    );
                break;
            case 'member_join':
                embed.setTitle('✅ Новый участник').setColor(0x57F287)
                    .setDescription(`<@${safeString(data.userId)}> присоединился!`);
                break;
            case 'event_created':
                embed.setTitle('📅 Ивент создан').setColor(0x5865F2)
                    .addFields(
                        { name: '📋 Название', value: safeString(data.title), inline: true },
                        { name: '📆 Дата', value: safeString(data.date), inline: true },
                        { name: '🕐 Время', value: `${safeString(data.time)} МСК`, inline: true },
                    );
                break;
            case 'afk_vacation':
                embed.setTitle('📅 ОТПУСК').setColor(0xE67E22)
                    .addFields(
                        { name: '👤 Кто', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '📅 Дней', value: safeString(data.days), inline: true },
                        { name: '📝 Причина', value: safeString(data.reason), inline: false },
                    );
                break;
            case 'afk_away':
                embed.setTitle('🚶 ОТОШЁЛ').setColor(0x3498DB)
                    .addFields(
                        { name: '👤 Кто', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '⏰ Время', value: safeString(data.timeStr), inline: true },
                        { name: '📝 Причина', value: safeString(data.reason), inline: false },
                    );
                break;
            case 'afk_return':
                embed.setTitle('✅ ВЕРНУЛСЯ').setColor(0x2ECC71)
                    .addFields(
                        { name: '👤 Кто', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '⏱️ Отсутствовал', value: safeString(data.timeAway), inline: true },
                    );
                break;
        }

        await logChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        console.error('❌ Ошибка sendLog:', e.message);
    }
}

// ============================================================
//                        ЗАЯВКИ В КЛАН
// ============================================================
async function createApplyTicket(interaction) {
    try {
        const guild = interaction.guild;
        if (!guild) return interaction.reply({ content: '❌ Сервер не найден.', ephemeral: true });

        const categoryId = getEnv('APPLY_CATEGORY_ID');
        const staffRoleId = getEnv('APPLY_STAFF_ROLE_ID');
        const adminRoleId = getEnv('COMMUNITY_ADMIN_ROLE_ID');

        if (!categoryId) return interaction.reply({ content: '❌ Категория заявок не настроена (APPLY_CATEGORY_ID).', ephemeral: true });
        if (!staffRoleId) return interaction.reply({ content: '❌ Роль стаффа не настроена (APPLY_STAFF_ROLE_ID).', ephemeral: true });

        const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '');

        const existingChannel = guild.channels.cache.find(
            c => c.name === `заявка-${safeName}` && c.parentId === categoryId
        );

        if (existingChannel) {
            return interaction.reply({ content: '❌ У тебя уже есть открытая заявка!', ephemeral: true });
        }

        const ticketChannel = await guild.channels.create({
            name: `заявка-${safeName}`,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ],
        });

        const embed = new EmbedBuilder()
            .setTitle('📋 Заявка в клан RUNA')
            .setDescription(`**Пользователь:** ${interaction.user}\n**Статус:** 🟡 Ожидает рассмотрения\n\nОпиши почему хочешь вступить в клан, свои навыки и опыт.`)
            .setColor(0xFFA500)
            .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`apply_accept_${interaction.user.id}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`apply_deny_${interaction.user.id}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
        );

        await ticketChannel.send({
            content: `||${interaction.user}|| <@&${staffRoleId}> <@&${adminRoleId}>`,
            embeds: [embed],
            components: [buttons],
        });

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'apply', { userId: interaction.user.id });

        await interaction.reply({ content: `✅ Заявка создана! Перейди в ${ticketChannel}`, ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка создания заявки:', e.message);
        try { await interaction.reply({ content: '❌ Произошла ошибка при создании заявки.', ephemeral: true }); } catch {}
    }
}

async function acceptApply(interaction, userId) {
    try {
        if (!isAdminOrStaff(interaction.member)) {
            return interaction.reply({ content: '⛔ У тебя нет прав для этого действия.', ephemeral: true });
        }

        const privateGuild = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
        if (!privateGuild) {
            return interaction.reply({ content: '❌ Приватный сервер не найден.', ephemeral: true });
        }

        const inviteChannel = privateGuild.channels.cache.find(c => c.type === 0);
        if (!inviteChannel) {
            return interaction.reply({ content: '❌ Нет доступных каналов для создания приглашения.', ephemeral: true });
        }

        const invite = await inviteChannel.createInvite({
            maxUses: 1,
            maxAge: 86400,
            unique: true,
            reason: `Приглашение для заявки от ${interaction.user.tag}`,
        });

        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🎉 Заявка одобрена!')
                        .setDescription(`Твоя заявка в клан **RUNA** была одобрена!\n\n🔗 Приглашение: ${invite.url}\n\n⚠️ Ссылка одноразовая и действует 24 часа.`)
                        .setColor(0x57F287)
                ]
            }).catch(() => {});
        }

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'apply_accept', {
            userId: userId,
            staffId: interaction.user.id,
        });

        await interaction.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Заявка одобрена')
                    .setDescription(`Заявка одобрена пользователем ${interaction.user}. Приглашение отправлено в ЛС.`)
                    .setColor(0x57F287)
            ]
        });

        await interaction.update({ content: '✅ Заявка одобрена!', components: [], embeds: [] }).catch(() => {});
    } catch (e) {
        console.error('❌ Ошибка принятия заявки:', e.message);
        try { await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true }); } catch {}
    }
}

async function denyApply(interaction, userId) {
    try {
        if (!isAdminOrStaff(interaction.member)) {
            return interaction.reply({ content: '⛔ У тебя нет прав для этого действия.', ephemeral: true });
        }

        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Заявка отклонена')
                        .setDescription('Твоя заявка в клан **RUNA** была отклонена.\n\nНе расстраивайся, попробуй подать заявку позже!')
                        .setColor(0xED4245)
                ]
            }).catch(() => {});
        }

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'apply_deny', {
            userId: userId,
            staffId: interaction.user.id,
        });

        await interaction.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Заявка отклонена')
                    .setDescription(`Заявка отклонена пользователем ${interaction.user}.`)
                    .setColor(0xED4245)
            ]
        });

        await interaction.update({ content: '❌ Заявка отклонена!', components: [], embeds: [] }).catch(() => {});
    } catch (e) {
        console.error('❌ Ошибка отклонения заявки:', e.message);
        try { await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true }); } catch {}
    }
}

// ============================================================
//                        ПАНЕЛИ
// ============================================================
async function setupApplyPanel(channel) {
    try {
        const embed = new EmbedBuilder()
            .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН RUNA')
            .setDescription(
                '**ТРЕБОВАНИЯ:**\n\n' +
                '● 3000+ часов на аккаунте\n' +
                '● 15+ лет\n' +
                '● Хороший микрофон\n' +
                '● Умение слушать коллы и адекватно реагировать на критику\n' +
                '● Минимум 6 часов стабильного онлайна в день\n\n' +
                '**Статус набора:** 🟢 Открыт'
            )
            .setColor(0x57F287);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_apply_ticket').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('toggle_apply_status').setLabel('🟢 Открыт').setStyle(ButtonStyle.Success),
        );

        await channel.send({ embeds: [embed], components: [buttons] });
    } catch (e) {
        console.error('❌ Ошибка setupApplyPanel:', e.message);
    }
}

async function setupAfkPanel(channel) {
    try {
        const embed = new EmbedBuilder()
            .setTitle('🏖️ ОТПУСК / ОТСУТСТВИЕ')
            .setDescription(
                'Выберите тип отсутствия:\n\n' +
                '**🏖️ Отпуск** — укажите на сколько дней\n' +
                '**🚶 Отошёл** — укажите на сколько минут/часов\n\n' +
                'После заполнения вам будет выдана роль.\n' +
                'Нажмите на кнопку ниже.'
            )
            .setColor(0x3498DB);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('afk_vacation').setLabel('🏖️ Отпуск').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('afk_away').setLabel('🚶 Отошёл').setStyle(ButtonStyle.Secondary),
        );

        const msg = await channel.send({ embeds: [embed], components: [buttons] });

        // Сохраняем ID панели отпусков
        const config = readJSON('config.json') || {};
        config.afkMessageId = msg.id;
        config.channelId = channel.id;
        writeJSON('config.json', config);
    } catch (e) {
        console.error('❌ Ошибка setupAfkPanel:', e.message);
    }
}

async function moveAfkPanelDown(channel) {
    try {
        const config = readJSON('config.json') || {};
        if (!config.afkMessageId || config.channelId !== channel.id) return;

        const afkMsg = await channel.messages.fetch(config.afkMessageId).catch(() => null);
        if (!afkMsg) return;

        const afkEmbed = afkMsg.embeds[0];
        const afkComponents = afkMsg.components;

        // Удаляем старое сообщение
        await afkMsg.delete().catch(() => {});

        // Отправляем новое в самый низ
        const newMsg = await channel.send({ embeds: [afkEmbed], components: afkComponents });

        // Обновляем ID
        config.afkMessageId = newMsg.id;
        writeJSON('config.json', config);
    } catch (e) {
        console.error('❌ Ошибка moveAfkPanelDown:', e.message);
    }
}

// ============================================================
//                        СИСТЕМА ОТПУСКОВ
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
            console.log(`✅ Роль "${roleName}" создана на сервере ${guild.name}`);
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

            // Удаляем старые временные роли
            const oldRoles = member.roles.cache.filter(r => r.name.startsWith('🏖️ До '));
            for (const oldRole of oldRoles.values()) {
                await member.roles.remove(oldRole).catch(() => {});
                if (oldRole.members.size <= 1) await oldRole.delete().catch(() => {});
            }

            // Создаём новую временную роль
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

        // Убираем основную роль
        const mainRole = guild.roles.cache.find(r => r.name === '🏖️ Отпуск');
        if (mainRole && member.roles.cache.has(mainRole.id)) {
            await member.roles.remove(mainRole).catch(() => {});
        }

        // Убираем временные роли
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
        const days = safeNumber(interaction.fields.getTextInputValue('vacation_days'), 0);
        const reason = interaction.fields.getTextInputValue('vacation_reason') || 'Без причины';

        if (days <= 0) {
            return interaction.reply({ content: '❌ Укажи количество дней числом больше 0.', ephemeral: true });
        }

        const userId = interaction.user.id;
        const afkData = getAfkData();

        if (afkData[userId] && afkData[userId].active) {
            return interaction.reply({ content: '❌ Ты уже находишься в отпуске/отсутствии!', ephemeral: true });
        }

        const now = Date.now();
        const returnTime = now + (days * 24 * 60 * 60 * 1000);

        afkData[userId] = {
            type: 'vacation',
            reason,
            days,
            startTime: now,
            returnTime,
            active: true,
            username: interaction.user.tag,
        };
        saveAfkData(afkData);

        await giveAfkRole(interaction.guild, userId, returnTime);

        // Отправляем сообщение об отпуске
        const embed = new EmbedBuilder()
            .setTitle('📅 ОТПУСК')
            .setDescription(`**${interaction.user}** ушёл в отпуск!`)
            .setColor(0xE67E22)
            .addFields(
                { name: '📅 Дней', value: `${days}`, inline: true },
                { name: '📝 Причина', value: reason, inline: true },
                { name: '🔄 Возвращение', value: `<t:${Math.floor(returnTime / 1000)}:R>`, inline: true },
            )
            .setFooter({ text: interaction.user.tag })
            .setTimestamp();

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`afk_return_${userId}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({ embeds: [embed], components: [button] });

        // Перемещаем панель отпусков вниз
        await moveAfkPanelDown(interaction.channel);

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'afk_vacation', {
            userId,
            days: String(days),
            reason,
            returnTime,
        });

        await interaction.reply({
            content: `✅ Ты ушёл в отпуск на **${days}** дней!\nПричина: **${reason}**\nОжидаемое возвращение: <t:${Math.floor(returnTime / 1000)}:R>`,
            ephemeral: true,
        });
    } catch (e) {
        console.error('❌ Ошибка processVacation:', e.message);
        try { await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true }); } catch {}
    }
}

async function processAway(interaction) {
    try {
        const timeStr = interaction.fields.getTextInputValue('away_time');
        const reason = interaction.fields.getTextInputValue('away_reason') || 'Без причины';

        const returnMs = parseTime(timeStr);
        if (!returnMs) {
            return interaction.reply({
                content: '❌ Не могу понять время. Укажи в формате: "2 часа", "30 минут", "1 час 30 минут"',
                ephemeral: true,
            });
        }

        const userId = interaction.user.id;
        const afkData = getAfkData();

        if (afkData[userId] && afkData[userId].active) {
            return interaction.reply({ content: '❌ Ты уже находишься в отпуске/отсутствии!', ephemeral: true });
        }

        const now = Date.now();
        const returnTime = now + returnMs;

        afkData[userId] = {
            type: 'away',
            reason,
            timeStr,
            startTime: now,
            returnTime,
            active: true,
            username: interaction.user.tag,
        };
        saveAfkData(afkData);

        await giveAfkRole(interaction.guild, userId, null);

        // Отправляем сообщение
        const embed = new EmbedBuilder()
            .setTitle('🚶 ОТОШЁЛ')
            .setDescription(`**${interaction.user}** отошёл!`)
            .setColor(0x3498DB)
            .addFields(
                { name: '⏰ Время', value: timeStr, inline: true },
                { name: '📝 Причина', value: reason, inline: true },
                { name: '🔄 Вернётся', value: `<t:${Math.floor(returnTime / 1000)}:R>`, inline: true },
            )
            .setFooter({ text: interaction.user.tag })
            .setTimestamp();

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`afk_return_${userId}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({ embeds: [embed], components: [button] });

        // Перемещаем панель отпусков вниз
        await moveAfkPanelDown(interaction.channel);

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'afk_away', {
            userId,
            timeStr,
            reason,
            returnTime,
        });

        await interaction.reply({
            content: `✅ Ты отошёл на **${timeStr}**!\nПричина: **${reason}**\nОжидаемое возвращение: <t:${Math.floor(returnTime / 1000)}:R>`,
            ephemeral: true,
        });
    } catch (e) {
        console.error('❌ Ошибка processAway:', e.message);
        try { await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true }); } catch {}
    }
}

async function returnFromAfk(interaction, userId) {
    try {
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

        // Обновляем сообщение
        if (interaction.message && interaction.message.embeds[0]) {
            const newEmbed = new EmbedBuilder(interaction.message.embeds[0])
                .setTitle('✅ ВЕРНУЛСЯ')
                .setColor(0x2ECC71)
                .addFields({ name: '⏱️ Отсутствовал', value: timeAway, inline: false });

            await interaction.message.edit({ embeds: [newEmbed], components: [] }).catch(() => {});
        }

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'afk_return', {
            userId,
            timeAway,
        });

        await interaction.reply({
            content: `✅ Ты вернулся из ${typeText}! Ты отсутствовал: **${timeAway}**`,
            ephemeral: true,
        });
    } catch (e) {
        console.error('❌ Ошибка returnFromAfk:', e.message);
        try { await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true }); } catch {}
    }
}

async function showAfkList(interaction) {
    try {
        const afkData = getAfkData();
        const activeEntries = Object.entries(afkData).filter(([, data]) => data && data.active);

        if (activeEntries.length === 0) {
            return interaction.reply({ content: '✅ Все на месте! Никто не в отпуске/отсутствии.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏖️ Отсутствующие участники')
            .setColor(0xE67E22)
            .setDescription(`Всего отсутствует: **${activeEntries.length}**`)
            .setTimestamp();

        for (const [userId, data] of activeEntries) {
            const typeEmoji = data.type === 'vacation' ? '📅' : '🚶';
            const typeText = data.type === 'vacation' ? 'Отпуск' : 'Отошёл';

            embed.addFields({
                name: `${typeEmoji} <@${userId}>`,
                value: `**Тип:** ${typeText}\n**Причина:** ${data.reason}\n**Вернётся:** <t:${Math.floor(data.returnTime / 1000)}:R>`,
                inline: false,
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (e) {
        console.error('❌ Ошибка showAfkList:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

function checkExpiredAfk() {
    try {
        const afkData = getAfkData();
        const now = Date.now();
        let changed = false;

        for (const [userId, data] of Object.entries(afkData)) {
            if (data && data.active && now >= data.returnTime) {
                data.active = false;
                data.autoReturned = true;
                changed = true;

                // Снимаем роль
                const guild = client.guilds.cache.get(getEnv('COMMUNITY_GUILD_ID'));
                if (guild) {
                    removeAfkRole(guild, userId).catch(() => {});
                }
            }
        }

        if (changed) saveAfkData(afkData);
    } catch (e) {
        console.error('❌ Ошибка checkExpiredAfk:', e.message);
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
        if (!message || !message.embeds[0]) return;

        const formatList = (list) => {
            if (!Array.isArray(list) || list.length === 0) return '>>> *Никого*';
            return '>>> ' + list.map(id => `<@${id}>`).join('\n');
        };

        const newEmbed = new EmbedBuilder(message.embeds[0]).setFields(
            {
                name: '📋 Дата и время',
                value: `📆 **${event.date}**\n🕐 **${event.time} МСК**\n\n<t:${event.unixTimestamp}:F>\n(<t:${event.unixTimestamp}:R>)`,
                inline: false,
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
            return interaction.reply({ content: '❌ Этот ивент уже завершён или не найден.', ephemeral: true });
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

        const statusText = {
            accept: '✅ Ты отмечен как **Приду**',
            decline: '❌ Ты отмечен как **Не приду**',
            tentative: '🤔 Ты отмечен как **Возможно**',
        };

        await interaction.reply({
            content: `${statusText[status]} на ивент **${event.title}**`,
            ephemeral: true,
        });
    } catch (e) {
        console.error('❌ Ошибка handleEventResponse:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function endEvent(interaction, eventId) {
    try {
        const events = getEvents();
        const event = events[eventId];

        if (!event) return interaction.reply({ content: '❌ Ивент с таким ID не найден.', ephemeral: true });
        if (!event.active) return interaction.reply({ content: '❌ Этот ивент уже завершён.', ephemeral: true });

        event.active = false;
        saveEvents(events);

        // Удаляем напоминания
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

        let content = `⏰ **НАПОМИНАНИЕ!**\n📅 Ивент **${event.title}** начнётся через **10 минут**!\n\n`;
        if (usersToPing.length > 0) content += usersToPing.map(id => `<@${id}>`).join(' ') + '\n\n';
        content += `🕐 Время: **${event.time} МСК**\n📆 Дата: **${event.date}**`;

        await channel.send(content).catch(() => {});

        // Отправка в ЛС
        for (const userId of usersToPing) {
            try {
                const user = await client.users.fetch(userId);
                if (user) {
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('⏰ Напоминание об ивенте!')
                                .setDescription(
                                    `📅 **${event.title}**\n\n` +
                                    `Ивент начнётся через **10 минут**!\n\n` +
                                    `🕐 Время: **${event.time} МСК**\n` +
                                    `📆 Дата: **${event.date}**\n\n` +
                                    `Не опаздывай! ⚔️`
                                )
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
//                        ГОТОВНОСТЬ
// ============================================================
client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`📊 Серверов: ${client.guilds.cache.size}`);

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

            // /setup apply | /setup afk
            if (cmd === 'setup') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'apply') {
                    if (!isAdmin(interaction.member)) {
                        return interaction.reply({ content: '⛔ Только администратор может создавать панели.', ephemeral: true });
                    }
                    await setupApplyPanel(interaction.channel);
                    await interaction.reply({ content: '✅ Панель заявок создана!', ephemeral: true });
                }
                if (sub === 'afk') {
                    if (!isAdmin(interaction.member)) {
                        return interaction.reply({ content: '⛔ Только администратор может создавать панели.', ephemeral: true });
                    }
                    await setupAfkPanel(interaction.channel);
                    await interaction.reply({ content: '✅ Панель отпусков создана!', ephemeral: true });
                }
                return;
            }

            // /ticket create
            if (cmd === 'ticket') {
                await createApplyTicket(interaction);
                return;
            }

            // /event create | /event end
            if (cmd === 'event') {
                const sub = interaction.options.getSubcommand();

                if (sub === 'create') {
                    if (!isPrivateAdmin(interaction.member)) {
                        return interaction.reply({ content: '⛔ Только администратор приватного сервера.', ephemeral: true });
                    }

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
                        return interaction.reply({ content: '❌ Дата ивента должна быть в будущем!', ephemeral: true });
                    }

                    const eventId = Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5);

                    const embed = new EmbedBuilder()
                        .setTitle(`📅 ${title}`)
                        .setDescription(description)
                        .setColor(0x5865F2)
                        .addFields(
                            {
                                name: '📋 Дата и время',
                                value: `📆 **${date}**\n🕐 **${time} МСК**\n\n<t:${unixTimestamp}:F>\n(<t:${unixTimestamp}:R>)`,
                                inline: false,
                            },
                            { name: '✅ Придут (0)', value: '>>> *Никого*', inline: true },
                            { name: '❌ Не придут (0)', value: '>>> *Никого*', inline: true },
                            { name: '🤔 Возможно (0)', value: '>>> *Никого*', inline: true },
                        )
                        .setFooter({ text: `ID: ${eventId} • Создал: ${interaction.user.tag}` })
                        .setTimestamp();

                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`event_accept_${eventId}`).setLabel('✅ Приду').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`event_decline_${eventId}`).setLabel('❌ Не приду').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`event_tentative_${eventId}`).setLabel('🤔 Возможно').setStyle(ButtonStyle.Secondary),
                    );

                    const message = await channel.send({
                        content: '||@everyone||',
                        embeds: [embed],
                        components: [buttons],
                    });

                    const events = getEvents();
                    events[eventId] = {
                        messageId: message.id,
                        channelId: channel.id,
                        guildId: channel.guild.id,
                        title,
                        description,
                        date,
                        time,
                        unixTimestamp,
                        creator: interaction.user.id,
                        created: Date.now(),
                        accepted: [],
                        declined: [],
                        tentative: [],
                        active: true,
                        reminded10min: false,
                    };
                    saveEvents(events);

                    // Добавляем напоминание за 10 минут
                    const reminderTime = eventDate.getTime() - 10 * 60 * 1000;
                    if (reminderTime > Date.now()) {
                        const reminders = getReminders();
                        reminders.push({ eventId, reminderTime, type: '10min' });
                        saveReminders(reminders);
                    }

                    await sendLog(getEnv('PRIVATE_GUILD_ID'), 'event_created', {
                        title,
                        date,
                        time,
                    });

                    await interaction.reply({
                        content: `✅ **Ивент создан!**\n\n📋 **Название:** ${title}\n📆 **Дата:** ${date}\n🕐 **Время:** ${time} МСК\n🆔 **ID:** \`${eventId}\`\n\n⏰ Напоминание будет за 10 минут до начала.`,
                        ephemeral: true,
                    });
                }

                if (sub === 'end') {
                    if (!isPrivateAdmin(interaction.member)) {
                        return interaction.reply({ content: '⛔ Только администратор приватного сервера.', ephemeral: true });
                    }
                    await endEvent(interaction, interaction.options.getString('id'));
                }
                return;
            }

            // /raid
            if (cmd === 'raid') {
                if (!isPrivateAdmin(interaction.member)) {
                    return interaction.reply({ content: '⛔ Только администратор приватного сервера.', ephemeral: true });
                }

                const extraMessage = interaction.options.getString('сообщение') || '';
                let content = '@everyone **⚔️ RAID! ⚔️**';

                if (extraMessage) {
                    content += `\n\n📋 ${extraMessage}`;
                }

                content += '\n\n**Всем срочно зайти в игру!** 🔥';

                await interaction.channel.send({ content });
                await interaction.reply({ content: '✅ Рейд объявлен!', ephemeral: true });
                return;
            }

            // /afk list
            if (cmd === 'afk') {
                await showAfkList(interaction);
                return;
            }
        }

        // КНОПКИ
        if (interaction.isButton()) {
            const cid = interaction.customId;

            // Заявки
            if (cid === 'create_apply_ticket') {
                await createApplyTicket(interaction);
                return;
            }

            if (cid === 'toggle_apply_status') {
                if (!isAdmin(interaction.member)) {
                    return interaction.reply({ content: '⛔ Только администратор может менять статус набора.', ephemeral: true });
                }

                const embed = interaction.message.embeds[0];
                const oldDescription = embed.description;
                const isOpen = oldDescription.includes('🟢 Открыт');

                const newEmbed = new EmbedBuilder(embed)
                    .setDescription(oldDescription.replace(isOpen ? '🟢 Открыт' : '🔴 Закрыт', isOpen ? '🔴 Закрыт' : '🟢 Открыт'))
                    .setColor(isOpen ? 0xED4245 : 0x57F287);

                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('create_apply_ticket').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('toggle_apply_status')
                        .setLabel(isOpen ? '🔴 Закрыт' : '🟢 Открыт')
                        .setStyle(isOpen ? ButtonStyle.Danger : ButtonStyle.Success),
                );

                await interaction.update({ embeds: [newEmbed], components: [newRow] });
                return;
            }

            if (cid.startsWith('apply_accept_')) {
                const userId = cid.split('_')[2];
                await acceptApply(interaction, userId);
                return;
            }

            if (cid.startsWith('apply_deny_')) {
                const userId = cid.split('_')[2];
                await denyApply(interaction, userId);
                return;
            }

            // Ивенты
            if (cid.startsWith('event_accept_')) {
                await handleEventResponse(interaction, cid.replace('event_accept_', ''), 'accept');
                return;
            }

            if (cid.startsWith('event_decline_')) {
                await handleEventResponse(interaction, cid.replace('event_decline_', ''), 'decline');
                return;
            }

            if (cid.startsWith('event_tentative_')) {
                await handleEventResponse(interaction, cid.replace('event_tentative_', ''), 'tentative');
                return;
            }

            // Отпуска
            if (cid === 'afk_vacation') {
                const afkData = getAfkData();
                if (afkData[interaction.user.id] && afkData[interaction.user.id].active) {
                    return interaction.reply({ content: '❌ Ты уже в отпуске/отсутствии!', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId('vacation_modal')
                    .setTitle('🏖️ Отпуск');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('vacation_days')
                            .setLabel('На сколько дней?')
                            .setPlaceholder('7')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('vacation_reason')
                            .setLabel('Причина отпуска')
                            .setPlaceholder('Уезжаю на море')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    ),
                );

                await interaction.showModal(modal);
                return;
            }

            if (cid === 'afk_away') {
                const afkData = getAfkData();
                if (afkData[interaction.user.id] && afkData[interaction.user.id].active) {
                    return interaction.reply({ content: '❌ Ты уже в отпуске/отсутствии!', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId('away_modal')
                    .setTitle('🚶 Отошёл');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('away_time')
                            .setLabel('На сколько? (2 часа / 30 минут)')
                            .setPlaceholder('2 часа')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('away_reason')
                            .setLabel('Причина отсутствия')
                            .setPlaceholder('Пошёл в магазин')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    ),
                );

                await interaction.showModal(modal);
                return;
            }

            if (cid.startsWith('afk_return_')) {
                const userId = cid.replace('afk_return_', '');
                await returnFromAfk(interaction, userId);
                return;
            }
        }

        // МОДАЛЬНЫЕ ОКНА
        if (interaction.isModalSubmit()) {
            const mid = interaction.customId;

            if (mid === 'vacation_modal') {
                await processVacation(interaction);
                return;
            }

            if (mid === 'away_modal') {
                await processAway(interaction);
                return;
            }
        }
    } catch (e) {
        console.error('❌ ГЛОБАЛЬНАЯ ОШИБКА:', e.message);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Произошла ошибка при обработке команды.', ephemeral: true });
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
