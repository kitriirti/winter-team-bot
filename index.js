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
});

process.on('unhandledRejection', (reason) => {
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
    rest: { retries: 3, timeout: 15000 },
});

// ============================================================
//                        ХРАНИЛИЩЕ ДАННЫХ
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (e) {}
}

function readJSON(filename) {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) {}
    return null;
}

function writeJSON(filename, data) {
    ensureDataDir();
    try {
        fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {}
}

ensureDataDir();
if (!fs.existsSync(path.join(DATA_DIR, 'events.json'))) writeJSON('events.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'reminders.json'))) writeJSON('reminders.json', []);
if (!fs.existsSync(path.join(DATA_DIR, 'afk.json'))) writeJSON('afk.json', {});

// ============================================================
//                     ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function safeString(val, fallback = 'Неизвестно') {
    try { return (val === null || val === undefined) ? fallback : String(val); } catch { return fallback; }
}

function safeNumber(val, fallback = 0) {
    try { const num = parseInt(val); return isNaN(num) ? fallback : num; } catch { return fallback; }
}

function getEnv(key, fallback = '') {
    try { return process.env[key] || fallback; } catch { return fallback; }
}

// ============================================================
//                    РЕГИСТРАЦИЯ КОМАНД
// ============================================================
const commands = [
    {
        name: 'setup',
        description: 'Настройка систем',
        options: [
            { type: 1, name: 'apply', description: 'Создать панель заявок' },
            { type: 1, name: 'tickets', description: 'Создать панель тикетов' },
        ],
    },
    {
        name: 'ticket',
        description: 'Управление тикетами',
        options: [
            { type: 1, name: 'create', description: 'Создать новый тикет' },
        ],
    },
    {
        name: 'event',
        description: 'Управление ивентами',
        options: [
            {
                type: 1, name: 'create', description: 'Создать ивент',
                options: [
                    { type: 3, name: 'название', description: 'Название', required: true },
                    { type: 3, name: 'описание', description: 'Описание', required: true },
                    { type: 3, name: 'дата', description: 'ДД.ММ.ГГГГ', required: true },
                    { type: 3, name: 'время', description: 'ЧЧ:ММ МСК', required: true },
                    { type: 7, name: 'канал', description: 'Канал', required: false },
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
        options: [{ type: 3, name: 'сообщение', description: 'Сообщение', required: false }],
    },
    {
        name: 'afk',
        description: 'Управление отпусками',
        options: [
            { type: 1, name: 'setup', description: 'Создать панель отпусков' },
            { type: 1, name: 'list', description: 'Список отсутствующих' },
        ],
    },
];

async function registerCommands() {
    try {
        const token = getEnv('BOT_TOKEN');
        const clientId = getEnv('CLIENT_ID');
        if (!token || !clientId) return console.error('❌ BOT_TOKEN или CLIENT_ID не найдены!');

        const rest = new REST({ version: '10' }).setToken(token);

        // 1. Удаляем ВСЕ глобальные команды
        console.log('🗑️ Удаляю старые глобальные команды...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log('✅ Глобальные команды удалены');

        // 2. Удаляем команды на всех серверах
        console.log('🗑️ Удаляю команды на серверах...');
        const guilds = await rest.get(Routes.userGuilds()).catch(() => []);
        for (const guild of guilds) {
            try {
                await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            } catch {}
        }
        console.log('✅ Команды серверов удалены');

        // 3. Пауза
        await new Promise(r => setTimeout(r, 3000));

        // 4. Регистрируем новые глобальные команды
        console.log('📝 Регистрирую новые команды...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('✅ Команды зарегистрированы:');
        commands.forEach(c => console.log(`   /${c.name}`));

    } catch (e) {
        console.error('❌ Ошибка регистрации:', e.message);
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
        const ch = guild.channels.cache.get(logChannelId);
        if (!ch) return;

        let embed = new EmbedBuilder().setTimestamp();
        switch (type) {
            case 'apply':
                embed.setTitle('📋 Новая заявка').setColor(0xFFA500)
                    .addFields({ name: '👤', value: `<@${safeString(data.userId)}>`, inline: true },
                        { name: '⏱️ Часы', value: safeString(data.hours), inline: true },
                        { name: '🎂 Возраст', value: safeString(data.age), inline: true },
                        { name: '🎯 Роль', value: safeString(data.role), inline: true },
                        { name: '👂 Коллы', value: `${safeString(data.listenSkill)}/10`, inline: true }); break;
            case 'member_join':
                embed.setTitle('✅ Новый участник').setColor(0x57F287)
                    .setDescription(`<@${safeString(data.userId)}>`); break;
            case 'ticket_created':
                embed.setTitle('🎫 Тикет').setColor(0x3498DB)
                    .addFields({ name: '👤', value: `<@${safeString(data.userId)}>`, inline: true }); break;
            case 'ticket_closed':
                embed.setTitle('🔒 Тикет закрыт').setColor(0xED4245)
                    .addFields({ name: 'Причина', value: safeString(data.reason) }); break;
            case 'call_invite':
                embed.setTitle('📞 Обзвон').setColor(0x9B59B6); break;
            case 'ticket_deleted':
                embed.setTitle('🗑️ Удалён').setColor(0x95A5A6); break;
            case 'event_created':
                embed.setTitle('📅 Ивент').setColor(0x5865F2)
                    .addFields({ name: 'Название', value: safeString(data.title) }); break;
            case 'afk_vacation':
                embed.setTitle('📅 Отпуск').setColor(0xE67E22)
                    .addFields({ name: 'Дней', value: safeString(data.days), inline: true }); break;
            case 'afk_away':
                embed.setTitle('⏰ Отошёл').setColor(0x3498DB); break;
            case 'afk_return':
                embed.setTitle('🔄 Вернулся').setColor(0x2ECC71); break;
        }
        await ch.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {}
}

// ============================================================
//                        СИСТЕМА ТИКЕТОВ
// ============================================================
async function createTicket(interaction) {
    try {
        const guild = interaction.guild;
        const catId = getEnv('TICKET_CATEGORY_ID');
        const staffId = getEnv('TICKET_STAFF_ROLE_ID');
        if (!catId || !staffId) return interaction.reply({ content: '❌ Не настроено.', ephemeral: true });

        const exists = guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '')}` && c.parentId === catId);
        if (exists) return interaction.reply({ content: '❌ Уже есть тикет.', ephemeral: true });

        const ch = await guild.channels.create({
            name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '')}`,
            type: ChannelType.GuildText, parent: catId,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ],
        });

        const embed = new EmbedBuilder().setTitle('🎫 Тикет').setDescription(`**${interaction.user}**`).setColor(0x3498DB);
        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket_close_${interaction.user.id}`).setLabel('🔒 Закрыть').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ticket_call_${interaction.user.id}`).setLabel('📞 Обзвон').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ticket_review_${interaction.user.id}`).setLabel('⏳ На рассмотрении').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`ticket_delete_${interaction.user.id}`).setLabel('🗑️ Удалить').setStyle(ButtonStyle.Danger),
        );
        await ch.send({ content: `||${interaction.user}|| <@&${staffId}>`, embeds: [embed], components: [btns] });
        await interaction.reply({ content: `✅ ${ch}`, ephemeral: true });
    } catch (e) {
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function closeTicket(interaction, userId, reason) {
    try {
        const ch = interaction.channel;
        if (!ch) return;
        try { const u = await client.users.fetch(userId); await u.send(`🔒 Тикет закрыт: ${reason}`).catch(() => {}); } catch {}
        await ch.send(`🔒 Закрыт. Причина: ${reason}`);
        await ch.permissionOverwrites.edit(userId, { ViewChannel: false, SendMessages: false }).catch(() => {});
        await interaction.message?.edit({ components: [] }).catch(() => {});
    } catch (e) {}
}

async function callUser(interaction, userId) {
    try {
        const ch = interaction.channel;
        if (!ch) return;
        try { const u = await client.users.fetch(userId); await u.send(`📞 Обзвон: ${ch}`).catch(() => {}); } catch {}
        await ch.send(`📞 <@${userId}> на обзвон!`);
        await interaction.reply({ content: '✅', ephemeral: true });
    } catch (e) {}
}

async function setTicketReview(interaction, userId) {
    try {
        await interaction.channel?.send(`⏳ На рассмотрении у ${interaction.user}`);
        await interaction.reply({ content: '✅', ephemeral: true });
    } catch (e) {}
}

async function deleteTicket(interaction, userId) {
    try {
        const ch = interaction.channel;
        if (!ch) return;
        await interaction.reply({ content: '🗑️ Удаление...', ephemeral: true });
        setTimeout(() => ch.delete().catch(() => {}), 5000);
    } catch (e) {}
}

// ============================================================
//                        СИСТЕМА ИВЕНТОВ
// ============================================================
function getEvents() { const d = readJSON('events.json'); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; }
function saveEvents(d) { if (d && typeof d === 'object') writeJSON('events.json', d); }
function getReminders() { const d = readJSON('reminders.json'); return Array.isArray(d) ? d : []; }
function saveReminders(d) { if (Array.isArray(d)) writeJSON('reminders.json', d); }

async function updateEventEmbed(eventId) {
    try {
        const events = getEvents();
        const event = events[eventId];
        if (!event?.active) return;
        const channel = client.channels.cache.get(event.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(event.messageId).catch(() => null);
        if (!msg?.embeds[0]) return;

        const fl = (l) => (!Array.isArray(l) || l.length === 0) ? '>>> *Никого*' : '>>> ' + l.map(id => `<@${id}>`).join('\n');
        const emb = new EmbedBuilder(msg.embeds[0]).setFields(
            { name: '📋 Дата', value: `📆 ${event.date}\n🕐 ${event.time} МСК\n<t:${event.unixTimestamp}:R>`, inline: false },
            { name: `✅ Придут (${event.accepted.length})`, value: fl(event.accepted), inline: true },
            { name: `❌ Не придут (${event.declined.length})`, value: fl(event.declined), inline: true },
            { name: `🤔 Возможно (${event.tentative.length})`, value: fl(event.tentative), inline: true },
        );
        await msg.edit({ embeds: [emb] }).catch(() => {});
    } catch (e) {}
}

async function handleEventResponse(interaction, eventId, status) {
    try {
        const events = getEvents();
        const event = events[eventId];
        if (!event?.active) return interaction.reply({ content: '❌ Завершён.', ephemeral: true });

        const uid = interaction.user.id;
        ['accepted','declined','tentative'].forEach(k => { if (!Array.isArray(event[k])) event[k] = []; event[k] = event[k].filter(id => id !== uid); });
        if (status === 'accept') event.accepted.push(uid);
        if (status === 'decline') event.declined.push(uid);
        if (status === 'tentative') event.tentative.push(uid);
        saveEvents(events);
        await updateEventEmbed(eventId);
        const t = { accept: '✅ Приду', decline: '❌ Не приду', tentative: '🤔 Возможно' };
        await interaction.reply({ content: `${t[status]} → ${event.title}`, ephemeral: true });
    } catch (e) {
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function endEvent(interaction, eventId) {
    try {
        const events = getEvents();
        const event = events[eventId];
        if (!event) return interaction.reply({ content: '❌ Не найден.', ephemeral: true });
        event.active = false; saveEvents(events);

        const ch = client.channels.cache.get(event.channelId);
        if (ch) {
            const msg = await ch.messages.fetch(event.messageId).catch(() => null);
            if (msg?.embeds[0]) {
                const fl = (l) => (!Array.isArray(l) || l.length === 0) ? '>>> *Никого*' : '>>> ' + l.map(id => `<@${id}>`).join('\n');
                await msg.edit({ content: '🔒 ЗАВЕРШЁН', embeds: [new EmbedBuilder(msg.embeds[0]).setTitle(`📅 [ЗАВЕРШЁН] ${event.title}`).setColor(0x95A5A6).setFields(
                    { name: '📋 Дата', value: `📆 ${event.date} ${event.time}`, inline: false },
                    { name: `✅ (${event.accepted.length})`, value: fl(event.accepted), inline: true },
                    { name: `❌ (${event.declined.length})`, value: fl(event.declined), inline: true },
                    { name: `🤔 (${event.tentative.length})`, value: fl(event.tentative), inline: true },
                )], components: [] }).catch(() => {});
            }
        }
        saveReminders(getReminders().filter(r => r.eventId !== eventId));
        await interaction.reply({ content: `✅ ${event.title} завершён!`, ephemeral: true });
    } catch (e) {}
}

function checkEventReminders() {
    try {
        const reminders = getReminders();
        if (!reminders.length) return;
        const events = getEvents();
        const now = Date.now();
        const toRemove = [];
        for (const r of reminders) {
            if (now >= r.reminderTime) {
                const e = events[r.eventId];
                if (e?.active && !e.reminded10min) {
                    e.reminded10min = true; saveEvents(events);
                    const g = client.guilds.cache.get(e.guildId);
                    if (g) {
                        const ch = g.channels.cache.get(e.channelId);
                        if (ch) ch.send(`⏰ **${e.title}** через 10 мин!\n${[...new Set([...e.accepted, ...e.tentative])].map(id => `<@${id}>`).join(' ')}`).catch(() => {});
                    }
                }
                toRemove.push(r);
            }
        }
        if (toRemove.length) saveReminders(reminders.filter(r => !toRemove.includes(r)));
    } catch (e) {}
}

// ============================================================
//                        СИСТЕМА ОТПУСКОВ
// ============================================================
function getAfk() { const d = readJSON('afk.json'); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; }
function saveAfk(d) { if (d && typeof d === 'object') writeJSON('afk.json', d); }

function parseTime(s) {
    try {
        let ms = 0;
        const hm = s.match(/(\d+)\s*(?:час|ч|h)/); if (hm) ms += parseInt(hm[1]) * 3600000;
        const mm = s.match(/(\d+)\s*(?:мин|м|m)/); if (mm) ms += parseInt(mm[1]) * 60000;
        return ms > 0 ? ms : null;
    } catch { return null; }
}

function formatDuration(ms) {
    try {
        const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
        return [`${d}дн`, `${h}ч`, `${m}мин`].filter(x => !x.startsWith('0')).join(' ') || 'меньше минуты';
    } catch { return '?'; }
}

function formatDate(d) { try { const dd = new Date(d); return `${String(dd.getDate()).padStart(2,'0')}.${String(dd.getMonth()+1).padStart(2,'0')}`; } catch { return '??.??'; } }

async function getOrCreateAfkRole(guild) {
    try {
        let role = guild.roles.cache.find(r => r.name === '🏖️ Отпуск');
        if (!role) role = await guild.roles.create({ name: '🏖️ Отпуск', color: 0xE67E22 });
        return role;
    } catch { return null; }
}

async function giveAfkRole(guild, userId, returnTime) {
    try {
        const role = await getOrCreateAfkRole(guild);
        if (!role) return;
        const m = await guild.members.fetch(userId).catch(() => null);
        if (!m) return;
        await m.roles.add(role).catch(() => {});
        if (returnTime) {
            const rd = formatDate(returnTime);
            for (const r of m.roles.cache.filter(r => r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(() => {}); if (r.members.size <= 1) await r.delete().catch(() => {}); }
            let tr = guild.roles.cache.find(r => r.name === `🏖️ До ${rd}`);
            if (!tr) tr = await guild.roles.create({ name: `🏖️ До ${rd}`, color: 0xE74C3C });
            await m.roles.add(tr).catch(() => {});
        }
    } catch (e) {}
}

async function removeAfkRole(guild, userId) {
    try {
        const m = await guild.members.fetch(userId).catch(() => null);
        if (!m) return;
        const mr = guild.roles.cache.find(r => r.name === '🏖️ Отпуск');
        if (mr) await m.roles.remove(mr).catch(() => {});
        for (const r of m.roles.cache.filter(r => r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(() => {}); if (r.members.size <= 0) await r.delete().catch(() => {}); }
    } catch (e) {}
}

async function processVacation(interaction) {
    try {
        const days = safeNumber(interaction.fields.getTextInputValue('vacation_days'));
        const reason = interaction.fields.getTextInputValue('vacation_reason') || '-';
        if (days <= 0) return interaction.reply({ content: '❌ > 0', ephemeral: true });
        const afk = getAfk();
        if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже в отпуске.', ephemeral: true });
        const rt = Date.now() + days * 86400000;
        afk[interaction.user.id] = { type: 'vacation', reason, days, startTime: Date.now(), returnTime: rt, active: true };
        saveAfk(afk);
        await giveAfkRole(interaction.guild, interaction.user.id, rt);
        const chId = getEnv('AFK_CHANNEL_ID');
        if (chId) {
            const ch = interaction.guild.channels.cache.get(chId);
            if (ch) {
                const emb = new EmbedBuilder().setTitle('📅 ОТПУСК').setDescription(`**${interaction.user}**`).setColor(0xE67E22).addFields({ name: '📅 Дней', value: String(days), inline: true }, { name: '📝 Причина', value: reason, inline: true });
                await ch.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`afk_return_${interaction.user.id}`).setLabel('🔄 Вернулся').setStyle(ButtonStyle.Success))] }).catch(() => {});
            }
        }
        await interaction.reply({ content: `✅ Отпуск на ${days} дн.`, ephemeral: true });
    } catch (e) { try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {} }
}

async function processAway(interaction) {
    try {
        const timeStr = interaction.fields.getTextInputValue('away_time');
        const reason = interaction.fields.getTextInputValue('away_reason') || '-';
        const ms = parseTime(timeStr);
        if (!ms) return interaction.reply({ content: '❌ Формат: "2 часа"', ephemeral: true });
        const afk = getAfk();
        if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже в отпуске.', ephemeral: true });
        const rt = Date.now() + ms;
        afk[interaction.user.id] = { type: 'away', reason, timeStr, startTime: Date.now(), returnTime: rt, active: true };
        saveAfk(afk);
        await giveAfkRole(interaction.guild, interaction.user.id, null);
        const chId = getEnv('AFK_CHANNEL_ID');
        if (chId) {
            const ch = interaction.guild.channels.cache.get(chId);
            if (ch) {
                const emb = new EmbedBuilder().setTitle('⏰ ОТОШЁЛ').setDescription(`**${interaction.user}**`).setColor(0x3498DB).addFields({ name: '⏰', value: timeStr, inline: true }, { name: '📝', value: reason, inline: true });
                await ch.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`afk_return_${interaction.user.id}`).setLabel('🔄 Вернулся').setStyle(ButtonStyle.Success))] }).catch(() => {});
            }
        }
        await interaction.reply({ content: `✅ Отошёл на ${timeStr}`, ephemeral: true });
    } catch (e) { try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {} }
}

async function returnFromAfk(interaction, userId) {
    try {
        const afk = getAfk();
        if (!afk[userId]?.active) return interaction.reply({ content: '❌ Не в отпуске.', ephemeral: true });
        const data = afk[userId];
        const timeAway = formatDuration(Date.now() - data.startTime);
        await removeAfkRole(interaction.guild, userId);
        data.active = false; saveAfk(afk);
        if (interaction.message?.embeds[0]) {
            await interaction.message.edit({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setTitle('✅ ВЕРНУЛСЯ').setColor(0x2ECC71).addFields({ name: '⏱️', value: timeAway, inline: false })], components: [] }).catch(() => {});
        }
        await interaction.reply({ content: `✅ Вернулся! ${timeAway}`, ephemeral: true });
    } catch (e) { try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {} }
}

function checkExpiredAfk() {
    try {
        const afk = getAfk();
        let changed = false;
        const now = Date.now();
        for (const [uid, d] of Object.entries(afk)) {
            if (d?.active && now >= d.returnTime) { d.active = false; changed = true; const g = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID')); if (g) removeAfkRole(g, uid).catch(() => {}); }
        }
        if (changed) saveAfk(afk);
    } catch (e) {}
}

// ============================================================
//                        ГОТОВНОСТЬ
// ============================================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} запущен! Серверов: ${client.guilds.cache.size}`);
    await registerCommands();
    setInterval(checkEventReminders, 30000);
    setInterval(checkExpiredAfk, 60000);
    console.log('🟢 Готов!');
});

client.on('guildMemberAdd', async m => {
    if (m.guild.id === getEnv('COMMUNITY_GUILD_ID')) await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'member_join', { userId: m.id, userTag: m.user.tag });
});

// ============================================================
//                  ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ
// ============================================================
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;

            if (cmd === 'event') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'create') {
                    const title = interaction.options.getString('название');
                    const desc = interaction.options.getString('описание');
                    const date = interaction.options.getString('дата');
                    const time = interaction.options.getString('время');
                    const channel = interaction.options.getChannel('канал') || interaction.channel;
                    const [d, m, y] = date.split('.').map(Number);
                    const [h, min] = time.split(':').map(Number);
                    const ed = new Date(y, m - 1, d, h - 3, min);
                    const uts = Math.floor(ed.getTime() / 1000);
                    if (ed <= Date.now()) return interaction.reply({ content: '❌ Будущее!', ephemeral: true });

                    const eid = Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5);
                    const emb = new EmbedBuilder().setTitle(`📅 ${title}`).setDescription(desc).setColor(0x5865F2)
                        .addFields({ name: '📋', value: `📆 ${date}\n🕐 ${time} МСК\n<t:${uts}:R>`, inline: false },
                            { name: '✅ (0)', value: '>>> *Никого*', inline: true },
                            { name: '❌ (0)', value: '>>> *Никого*', inline: true },
                            { name: '🤔 (0)', value: '>>> *Никого*', inline: true })
                        .setFooter({ text: `ID: ${eid}` }).setTimestamp();
                    const btns = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`event_accept_${eid}`).setLabel('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`event_decline_${eid}`).setLabel('❌').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`event_tentative_${eid}`).setLabel('🤔').setStyle(ButtonStyle.Secondary),
                    );
                    const msg = await channel.send({ content: '||@everyone||', embeds: [emb], components: [btns] });
                    const events = getEvents();
                    events[eid] = { messageId: msg.id, channelId: channel.id, guildId: channel.guild.id, title, description: desc, date, time, unixTimestamp: uts, accepted: [], declined: [], tentative: [], active: true, reminded10min: false };
                    saveEvents(events);
                    const rt = ed.getTime() - 600000;
                    if (rt > Date.now()) { const rems = getReminders(); rems.push({ eventId: eid, reminderTime: rt, type: '10min' }); saveReminders(rems); }
                    await interaction.reply({ content: `✅ Ивент создан!\nID: \`${eid}\``, ephemeral: true });
                }
                if (sub === 'end') await endEvent(interaction, interaction.options.getString('id'));
                return;
            }

            if (cmd === 'raid') {
                const extra = interaction.options.getString('сообщение') || '';
                await interaction.channel.send({ content: `@everyone **⚔️ RAID! ⚔️**\n${extra ? `📋 ${extra}\n` : ''}**Всем в игру!** 🔥` });
                await interaction.reply({ content: '✅', ephemeral: true });
                return;
            }

            if (cmd === 'afk') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'setup') {
                    const emb = new EmbedBuilder().setTitle('🏖️ ОТПУСК').setDescription('📅 Отпуск — > суток\n⏰ Отошёл — часы/минуты').setColor(0x3498DB);
                    await interaction.channel.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('afk_vacation').setLabel('📅 Отпуск').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('afk_away').setLabel('⏰ Отошёл').setStyle(ButtonStyle.Secondary))] });
                    await interaction.reply({ content: '✅', ephemeral: true });
                }
                if (sub === 'list') {
                    const afk = getAfk();
                    const active = Object.entries(afk).filter(([,d]) => d?.active);
                    if (!active.length) return interaction.reply({ content: '✅ Все на месте!', ephemeral: true });
                    const emb = new EmbedBuilder().setTitle('🏖️ Отсутствующие').setColor(0xE67E22).setDescription(`Всего: **${active.length}**`);
                    for (const [uid, d] of active) emb.addFields({ name: `${d.type === 'vacation' ? '📅' : '⏰'} <@${uid}>`, value: `Причина: ${d.reason}`, inline: false });
                    await interaction.reply({ embeds: [emb], ephemeral: true });
                }
                return;
            }

            if (cmd === 'ticket') {
                if (interaction.options.getSubcommand() === 'create') await createTicket(interaction);
                return;
            }

            if (cmd === 'setup') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'apply') {
                    const emb = new EmbedBuilder().setTitle('📋 ЗАЯВКА В КЛАН RUNA').setDescription('● 3000+ часов\n● 15+ лет\n● Хороший микрофон\n● Слушать коллы\n● 6+ ч онлайна\n\n**🟢 Открыт**').setColor(0x57F287);
                    await interaction.channel.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('apply_button').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('toggle_status').setLabel('🟢 Открыт').setStyle(ButtonStyle.Success))] });
                    await interaction.reply({ content: '✅', ephemeral: true });
                }
                if (sub === 'tickets') {
                    const emb = new EmbedBuilder().setTitle('🎫 Поддержка').setDescription('Создать тикет').setColor(0x3498DB);
                    await interaction.channel.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Тикет').setStyle(ButtonStyle.Primary))] });
                    await interaction.reply({ content: '✅', ephemeral: true });
                }
                return;
            }
        }

        // КНОПКИ
        if (interaction.isButton()) {
            const cid = interaction.customId;

            if (cid === 'apply_button') {
                const modal = new ModalBuilder().setCustomId('apply_modal').setTitle('Заявка');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hours').setLabel('Часы').setPlaceholder('3500').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('age').setLabel('Возраст').setPlaceholder('18').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('daily_hours').setLabel('Онлайн/день').setPlaceholder('6-8 ч').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role').setLabel('Роль').setPlaceholder('комбат').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('listen_skill').setLabel('Коллы (1-10)').setPlaceholder('8').setStyle(TextInputStyle.Short).setRequired(true)),
                );
                await interaction.showModal(modal);
                return;
            }

            if (cid === 'toggle_status') {
                if (!interaction.member.roles.cache.has(getEnv('COMMUNITY_ADMIN_ROLE_ID'))) return interaction.reply({ content: '⛔', ephemeral: true });
                const emb = interaction.message.embeds[0];
                const isOpen = emb.description.includes('🟢');
                await interaction.update({ embeds: [new EmbedBuilder(emb).setDescription(emb.description.replace(isOpen ? '🟢' : '🔴', isOpen ? '🔴' : '🟢')).setColor(isOpen ? 0xED4245 : 0x57F287)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('apply_button').setLabel('📝').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('toggle_status').setLabel(isOpen ? '🔴 Закрыт' : '🟢 Открыт').setStyle(isOpen ? ButtonStyle.Danger : ButtonStyle.Success))] });
                return;
            }

            if (cid.startsWith('accept_')) {
                const uid = cid.split('_')[1];
                if (!interaction.member.roles.cache.has(getEnv('PRIVATE_ADMIN_ROLE_ID'))) return interaction.reply({ content: '⛔', ephemeral: true });
                try {
                    const u = await client.users.fetch(uid);
                    const g = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
                    const inv = await g.channels.cache.find(c => c.type === 0).createInvite({ maxUses: 1, maxAge: 86400, unique: true });
                    await u.send(`🎉 Заявка одобрена!\n${inv.url}`).catch(() => {});
                    await interaction.update({ content: '✅', components: [], embeds: [] });
                } catch { await interaction.reply({ content: '❌', ephemeral: true }); }
                return;
            }

            if (cid.startsWith('deny_')) {
                const uid = cid.split('_')[1];
                if (!interaction.member.roles.cache.has(getEnv('PRIVATE_ADMIN_ROLE_ID'))) return interaction.reply({ content: '⛔', ephemeral: true });
                try { const u = await client.users.fetch(uid); await u.send('❌ Отклонено.').catch(() => {}); } catch {}
                await interaction.update({ content: '❌', components: [], embeds: [] });
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
                const modal = new ModalBuilder().setCustomId('vacation_modal').setTitle('Отпуск');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vacation_days').setLabel('Дней').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vacation_reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                await interaction.showModal(modal);
                return;
            }
            if (cid === 'afk_away') {
                const modal = new ModalBuilder().setCustomId('away_modal').setTitle('Отошёл');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_time').setLabel('Время (2 часа / 30 мин)').setPlaceholder('2 часа').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                await interaction.showModal(modal);
                return;
            }
            if (cid.startsWith('afk_return_')) { await returnFromAfk(interaction, cid.replace('afk_return_', '')); return; }
        }

        // МОДАЛКИ
        if (interaction.isModalSubmit()) {
            const mid = interaction.customId;
            if (mid === 'apply_modal') {
                const h = safeNumber(interaction.fields.getTextInputValue('hours'));
                const a = safeNumber(interaction.fields.getTextInputValue('age'));
                const dh = interaction.fields.getTextInputValue('daily_hours') || '-';
                const r = interaction.fields.getTextInputValue('role') || '-';
                const ls = safeNumber(interaction.fields.getTextInputValue('listen_skill'));
                if (h < 3000) return interaction.reply({ content: '❌ <3000ч', ephemeral: true });
                if (a < 15) return interaction.reply({ content: '❌ <15 лет', ephemeral: true });
                if (ls < 1 || ls > 10) return interaction.reply({ content: '❌ 1-10', ephemeral: true });

                const g = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
                const ch = g?.channels.cache.get(getEnv('APPLY_CHANNEL_ID'));
                if (!ch) return interaction.reply({ content: '❌', ephemeral: true });

                const emb = new EmbedBuilder().setTitle('📋 Заявка').setColor(0xFFA500)
                    .addFields({ name: '👤', value: `${interaction.user}`, inline: false }, { name: '⏱️', value: String(h), inline: true }, { name: '🎂', value: String(a), inline: true }, { name: '🕐', value: dh, inline: true }, { name: '🎯', value: r, inline: true }, { name: '👂', value: `${ls}/10`, inline: true }).setTimestamp();
                await ch.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`accept_${interaction.user.id}`).setLabel('✅').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('❌').setStyle(ButtonStyle.Danger))] });
                await interaction.reply({ content: '✅ Отправлено!', ephemeral: true });
                return;
            }
            if (mid === 'vacation_modal') { await processVacation(interaction); return; }
            if (mid === 'away_modal') { await processAway(interaction); return; }
            if (mid.startsWith('close_modal_')) { await closeTicket(interaction, mid.split('_')[2], interaction.fields.getTextInputValue('close_reason') || '-'); await interaction.reply({ content: '✅', ephemeral: true }); return; }
        }
    } catch (e) {
        console.error('❌', e.message);
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
});

// ============================================================
//                           ЗАПУСК
// ============================================================
const token = getEnv('BOT_TOKEN');
if (!token) { console.error('❌ BOT_TOKEN не найден!'); process.exit(1); }
client.login(token).catch(e => { console.error('❌ Ошибка входа:', e.message); process.exit(1); });
