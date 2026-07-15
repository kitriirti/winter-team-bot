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
//                   ЗАЩИТА ОТ КРАША
// ============================================================
process.on('uncaughtException', (error) => console.error('❌', error.message));
process.on('unhandledRejection', (reason) => console.error('❌', reason));

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
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(f) { ensureDir(); try { if (fs.existsSync(path.join(DATA_DIR, f))) return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')); } catch {} return null; }
function writeJSON(f, d) { ensureDir(); try { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); } catch {} }

ensureDir();
if (!fs.existsSync(path.join(DATA_DIR, 'events.json'))) writeJSON('events.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'reminders.json'))) writeJSON('reminders.json', []);
if (!fs.existsSync(path.join(DATA_DIR, 'afk.json'))) writeJSON('afk.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'config.json'))) writeJSON('config.json', { applyMessageId: null, afkMessageId: null });

function getEnv(k, fb = '') { try { return process.env[k] || fb; } catch { return fb; } }
function safeNum(v, fb = 0) { try { const n = parseInt(v); return isNaN(n) ? fb : n; } catch { return fb; } }

// ============================================================
//                    ПРОВЕРКА ПРАВ (АДМИН ИЛИ СТАФФ)
// ============================================================
function isAdminOrStaff(member) {
    const adminRole = getEnv('COMMUNITY_ADMIN_ROLE_ID');
    const staffRole = getEnv('APPLY_STAFF_ROLE_ID');
    return member.roles.cache.has(adminRole) || member.roles.cache.has(staffRole);
}

function isAdmin(member) {
    const adminRole = getEnv('COMMUNITY_ADMIN_ROLE_ID');
    return member.roles.cache.has(adminRole);
}

// ============================================================
//                    РЕГИСТРАЦИЯ КОМАНД
// ============================================================
const commands = [
    {
        name: 'setup',
        description: 'Настройка панели заявок и отпусков',
        options: [
            { type: 1, name: 'apply', description: 'Создать/обновить панель заявок' },
        ],
    },
    {
        name: 'ticket',
        description: 'Подать заявку в клан',
        options: [
            { type: 1, name: 'create', description: 'Создать заявку' },
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
            { type: 1, name: 'end', description: 'Завершить ивент', options: [{ type: 3, name: 'id', description: 'ID', required: true }] },
        ],
    },
    {
        name: 'raid',
        description: 'Объявить рейд',
        options: [{ type: 3, name: 'сообщение', description: 'Сообщение', required: false }],
    },
    {
        name: 'afk',
        description: 'Отпуск / отсутствие',
        options: [
            { type: 1, name: 'list', description: 'Список отсутствующих' },
        ],
    },
];

async function registerCommands() {
    try {
        const token = getEnv('BOT_TOKEN'), cid = getEnv('CLIENT_ID');
        if (!token || !cid) return console.error('❌ BOT_TOKEN или CLIENT_ID не найдены!');
        const rest = new REST({ version: '10' }).setToken(token);
        console.log('🗑️ Удаляю старые команды...');
        await rest.put(Routes.applicationCommands(cid), { body: [] });
        const guilds = await rest.get(Routes.userGuilds()).catch(() => []);
        for (const g of guilds) { try { await rest.put(Routes.applicationGuildCommands(cid, g.id), { body: [] }); } catch {} }
        await new Promise(r => setTimeout(r, 3000));
        console.log('📝 Регистрирую новые...');
        await rest.put(Routes.applicationCommands(cid), { body: commands });
        console.log('✅ Готово!');
    } catch (e) { console.error('❌', e.message); }
}

// ============================================================
//                        СИСТЕМА ЗАЯВОК
// ============================================================
async function createApplyTicket(interaction) {
    try {
        const guild = interaction.guild;
        if (!guild) return interaction.reply({ content: '❌ Сервер не найден.', ephemeral: true });

        const channel = interaction.channel;
        const parentId = channel.parentId;
        if (!parentId) return interaction.reply({ content: '❌ Канал не в категории.', ephemeral: true });

        const staffRoleId = getEnv('APPLY_STAFF_ROLE_ID');
        const adminRoleId = getEnv('COMMUNITY_ADMIN_ROLE_ID');
        const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '');

        const exists = guild.channels.cache.find(c => c.name === `заявка-${safeName}` && c.parentId === parentId);
        if (exists) return interaction.reply({ content: '❌ У тебя уже есть открытая заявка!', ephemeral: true });

        const ticketChannel = await guild.channels.create({
            name: `заявка-${safeName}`,
            type: ChannelType.GuildText,
            parent: parentId,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
                { id: adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
            ],
        });

        const embed = new EmbedBuilder()
            .setTitle('📋 Заявка в клан RUNA')
            .setDescription(`**Пользователь:** ${interaction.user}\n**Статус:** 🟡 Ожидает\n\nОпиши почему хочешь вступить в клан.`)
            .setColor(0xFFA500)
            .setTimestamp();

        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`apply_accept_${interaction.user.id}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`apply_deny_${interaction.user.id}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
        );

        await ticketChannel.send({ content: `||${interaction.user}|| <@&${staffRoleId}> <@&${adminRoleId}>`, embeds: [embed], components: [btns] });

        await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'apply', { userId: interaction.user.id });
        await interaction.reply({ content: `✅ Заявка создана: ${ticketChannel}`, ephemeral: true });
    } catch (e) {
        console.error('❌', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

// Принять заявку (может админ И стафф)
async function acceptApply(interaction, userId) {
    try {
        if (!isAdminOrStaff(interaction.member)) return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });

        const guild = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
        if (!guild) return interaction.reply({ content: '❌ Приватный сервер не найден.', ephemeral: true });

        const invCh = guild.channels.cache.find(c => c.type === 0);
        if (!invCh) return interaction.reply({ content: '❌ Нет текстовых каналов.', ephemeral: true });

        const invite = await invCh.createInvite({ maxUses: 1, maxAge: 86400, unique: true });

        const user = await client.users.fetch(userId);
        await user.send(`🎉 **Твоя заявка в клан RUNA одобрена!**\nПриглашение: ${invite.url}\n⚠️ Одноразовое, 24 часа.`).catch(() => {});

        await interaction.channel.send(`✅ Заявка одобрена пользователем ${interaction.user}! Приглашение отправлено в ЛС.`);
        await interaction.update({ content: `✅ Одобрено ${interaction.user}`, components: [], embeds: [] }).catch(() => {});
    } catch (e) {
        console.error('❌', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

// Отклонить заявку (может админ И стафф)
async function denyApply(interaction, userId) {
    try {
        if (!isAdminOrStaff(interaction.member)) return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });

        const user = await client.users.fetch(userId);
        await user.send('❌ **Твоя заявка в клан RUNA отклонена.**').catch(() => {});

        await interaction.channel.send(`❌ Заявка отклонена пользователем ${interaction.user}.`);
        await interaction.update({ content: `❌ Отклонено ${interaction.user}`, components: [], embeds: [] }).catch(() => {});
    } catch (e) {
        console.error('❌', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

// ============================================================
//                        ПАНЕЛЬ ЗАЯВОК + ОТПУСКОВ
// ============================================================
async function setupPanels(channel) {
    try {
        const applyEmbed = new EmbedBuilder()
            .setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН RUNA')
            .setDescription(
                '**ТРЕБОВАНИЯ:**\n\n' +
                '● 3000+ часов\n● 15+ лет\n● Хороший микрофон\n' +
                '● Умение слушать коллы\n● 6+ часов онлайна в день\n\n' +
                '**Статус набора:** 🟢 Открыт'
            )
            .setColor(0x57F287);

        const applyBtns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_apply_ticket').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('toggle_apply_status').setLabel('🟢 Открыт').setStyle(ButtonStyle.Success),
        );

        const applyMsg = await channel.send({ embeds: [applyEmbed], components: [applyBtns] });

        const afkEmbed = new EmbedBuilder()
            .setTitle('🏖️ ОТПУСК / ОТСУТСТВИЕ')
            .setDescription(
                'Выберите тип отсутствия:\n\n' +
                '**🏖️ Отпуск** — укажите на сколько дней\n' +
                '**🚶 Отошёл** — укажите на сколько минут/часов\n\n' +
                'После заполнения вам будет выдана роль.\n' +
                'Нажмите на кнопку ниже.'
            )
            .setColor(0x3498DB);

        const afkBtns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('afk_vacation').setLabel('🏖️ Отпуск').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('afk_away').setLabel('🚶 Отошёл').setStyle(ButtonStyle.Secondary),
        );

        const afkMsg = await channel.send({ embeds: [afkEmbed], components: [afkBtns] });

        const config = readJSON('config.json') || {};
        config.applyMessageId = applyMsg.id;
        config.afkMessageId = afkMsg.id;
        config.channelId = channel.id;
        writeJSON('config.json', config);

    } catch (e) {
        console.error('❌', e.message);
    }
}

async function moveAfkPanelDown(channel) {
    try {
        const config = readJSON('config.json') || {};
        if (!config.afkMessageId || !config.channelId) return;

        const ch = client.channels.cache.get(config.channelId);
        if (!ch) return;

        const afkMsg = await ch.messages.fetch(config.afkMessageId).catch(() => null);
        if (!afkMsg) return;

        const afkEmbed = afkMsg.embeds[0];
        const afkBtns = afkMsg.components;

        await afkMsg.delete().catch(() => {});

        const newMsg = await ch.send({ embeds: [afkEmbed], components: afkBtns });

        config.afkMessageId = newMsg.id;
        writeJSON('config.json', config);
    } catch (e) {}
}

// ============================================================
//                        СИСТЕМА ЛОГОВ
// ============================================================
async function sendLog(guildId, type, data) {
    try {
        if (!guildId) return;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const chId = getEnv('LOG_CHANNEL_ID');
        if (!chId) return;
        const ch = guild.channels.cache.get(chId);
        if (!ch) return;

        let embed = new EmbedBuilder().setTimestamp();
        switch (type) {
            case 'apply': embed.setTitle('📋 Заявка').setColor(0xFFA500); break;
            case 'member_join': embed.setTitle('✅ Участник').setColor(0x57F287); break;
            case 'event_created': embed.setTitle('📅 Ивент').setColor(0x5865F2); break;
            case 'afk_vacation': embed.setTitle('📅 Отпуск').setColor(0xE67E22); break;
            case 'afk_away': embed.setTitle('🚶 Отошёл').setColor(0x3498DB); break;
            case 'afk_return': embed.setTitle('✅ Вернулся').setColor(0x2ECC71); break;
        }
        await ch.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {}
}

// ============================================================
//                        СИСТЕМА ИВЕНТОВ
// ============================================================
function getEvents() { const d = readJSON('events.json'); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; }
function saveEvents(d) { if (d) writeJSON('events.json', d); }
function getReminders() { const d = readJSON('reminders.json'); return Array.isArray(d) ? d : []; }
function saveReminders(d) { if (Array.isArray(d)) writeJSON('reminders.json', d); }

async function updateEventEmbed(eventId) {
    try {
        const events = getEvents(), event = events[eventId];
        if (!event?.active) return;
        const ch = client.channels.cache.get(event.channelId);
        if (!ch) return;
        const msg = await ch.messages.fetch(event.messageId).catch(() => null);
        if (!msg?.embeds[0]) return;
        const fl = (l) => (!Array.isArray(l) || !l.length) ? '>>> *Никого*' : '>>> ' + l.map(id => `<@${id}>`).join('\n');
        await msg.edit({ embeds: [new EmbedBuilder(msg.embeds[0]).setFields(
            { name: '📋', value: `📆 ${event.date}\n🕐 ${event.time} МСК\n<t:${event.unixTimestamp}:R>`, inline: false },
            { name: `✅ (${event.accepted.length})`, value: fl(event.accepted), inline: true },
            { name: `❌ (${event.declined.length})`, value: fl(event.declined), inline: true },
            { name: `🤔 (${event.tentative.length})`, value: fl(event.tentative), inline: true },
        )] }).catch(() => {});
    } catch (e) {}
}

async function handleEventResponse(interaction, eventId, status) {
    try {
        const events = getEvents(), event = events[eventId];
        if (!event?.active) return interaction.reply({ content: '❌ Завершён.', ephemeral: true });
        const uid = interaction.user.id;
        ['accepted','declined','tentative'].forEach(k => { event[k] = (event[k]||[]).filter(id => id !== uid); });
        if (status === 'accept') event.accepted.push(uid);
        if (status === 'decline') event.declined.push(uid);
        if (status === 'tentative') event.tentative.push(uid);
        saveEvents(events); await updateEventEmbed(eventId);
        const t = { accept: '✅ Приду', decline: '❌ Не приду', tentative: '🤔 Возможно' };
        await interaction.reply({ content: `${t[status]} → ${event.title}`, ephemeral: true });
    } catch (e) {}
}

// ============================================================
//                        СИСТЕМА ОТПУСКОВ
// ============================================================
function getAfk() { const d = readJSON('afk.json'); return (d && typeof d === 'object') ? d : {}; }
function saveAfk(d) { if (d) writeJSON('afk.json', d); }

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
        const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000), m = Math.floor((ms%3600000)/60000);
        return [`${d}дн`,`${h}ч`,`${m}мин`].filter(x=>!x.startsWith('0')).join(' ')||'<1 мин';
    } catch { return '?'; }
}

function formatDate(d) { try { const dd=new Date(d); return `${String(dd.getDate()).padStart(2,'0')}.${String(dd.getMonth()+1).padStart(2,'0')}`; } catch { return '??.??'; } }

async function getOrCreateAfkRole(guild) {
    try {
        let r = guild.roles.cache.find(r=>r.name==='🏖️ Отпуск');
        if (!r) r = await guild.roles.create({ name: '🏖️ Отпуск', color: 0xE67E22 });
        return r;
    } catch { return null; }
}

async function giveAfkRole(guild, userId, returnTime) {
    try {
        const role = await getOrCreateAfkRole(guild); if (!role) return;
        const m = await guild.members.fetch(userId).catch(()=>null); if (!m) return;
        await m.roles.add(role).catch(()=>{});
        if (returnTime) {
            const rd = formatDate(returnTime);
            for (const r of m.roles.cache.filter(r=>r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(()=>{}); if (r.members.size<=1) await r.delete().catch(()=>{}); }
            let tr = guild.roles.cache.find(r=>r.name===`🏖️ До ${rd}`);
            if (!tr) tr = await guild.roles.create({ name: `🏖️ До ${rd}`, color: 0xE74C3C });
            await m.roles.add(tr).catch(()=>{});
        }
    } catch (e) {}
}

async function removeAfkRole(guild, userId) {
    try {
        const m = await guild.members.fetch(userId).catch(()=>null); if (!m) return;
        const mr = guild.roles.cache.find(r=>r.name==='🏖️ Отпуск');
        if (mr) await m.roles.remove(mr).catch(()=>{});
        for (const r of m.roles.cache.filter(r=>r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(()=>{}); if (r.members.size<=0) await r.delete().catch(()=>{}); }
    } catch (e) {}
}

async function processVacation(interaction) {
    try {
        const days = safeNum(interaction.fields.getTextInputValue('vacation_days'));
        const reason = interaction.fields.getTextInputValue('vacation_reason') || '-';
        if (days <= 0) return interaction.reply({ content: '❌ Число > 0.', ephemeral: true });
        const afk = getAfk();
        if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже в отпуске.', ephemeral: true });
        const rt = Date.now() + days * 86400000;
        afk[interaction.user.id] = { type: 'vacation', reason, days, startTime: Date.now(), returnTime: rt, active: true };
        saveAfk(afk);
        await giveAfkRole(interaction.guild, interaction.user.id, rt);

        const emb = new EmbedBuilder().setTitle('📅 ОТПУСК').setDescription(`**${interaction.user}** ушёл в отпуск`).setColor(0xE67E22)
            .addFields({ name: '📅 Дней', value: String(days), inline: true }, { name: '📝 Причина', value: reason, inline: true }).setTimestamp();
        const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`afk_return_${interaction.user.id}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success));
        await interaction.channel.send({ embeds: [emb], components: [btn] });
        await moveAfkPanelDown(interaction.channel);
        await interaction.reply({ content: `✅ Отпуск на ${days} дн.`, ephemeral: true });
    } catch (e) { try { await interaction.reply({ content: '❌', ephemeral: true }); } catch {} }
}

async function processAway(interaction) {
    try {
        const timeStr = interaction.fields.getTextInputValue('away_time');
        const reason = interaction.fields.getTextInputValue('away_reason') || '-';
        const ms = parseTime(timeStr);
        if (!ms) return interaction.reply({ content: '❌ Формат: "2 часа"', ephemeral: true });
        const afk = getAfk();
        if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже.', ephemeral: true });
        const rt = Date.now() + ms;
        afk[interaction.user.id] = { type: 'away', reason, timeStr, startTime: Date.now(), returnTime: rt, active: true };
        saveAfk(afk);
        await giveAfkRole(interaction.guild, interaction.user.id, null);

        const emb = new EmbedBuilder().setTitle('🚶 ОТОШЁЛ').setDescription(`**${interaction.user}** отошёл`).setColor(0x3498DB)
            .addFields({ name: '⏰', value: timeStr, inline: true }, { name: '📝', value: reason, inline: true }).setTimestamp();
        const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`afk_return_${interaction.user.id}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success));
        await interaction.channel.send({ embeds: [emb], components: [btn] });
        await moveAfkPanelDown(interaction.channel);
        await interaction.reply({ content: `✅ Отошёл на ${timeStr}`, ephemeral: true });
    } catch (e) { try { await interaction.reply({ content: '❌', ephemeral: true }); } catch {} }
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
    } catch (e) { try { await interaction.reply({ content: '❌', ephemeral: true }); } catch {} }
}

function checkExpiredAfk() {
    try {
        const afk = getAfk(); let changed = false; const now = Date.now();
        for (const [uid, d] of Object.entries(afk)) {
            if (d?.active && now >= d.returnTime) { d.active = false; changed = true; const g = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID')); if (g) removeAfkRole(g, uid).catch(()=>{}); }
        }
        if (changed) saveAfk(afk);
    } catch (e) {}
}

// ============================================================
//                        ГОТОВНОСТЬ
// ============================================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} | Серверов: ${client.guilds.cache.size}`);
    await registerCommands();
    setInterval(checkEventReminders, 30000);
    setInterval(checkExpiredAfk, 60000);
    console.log('🟢 Готов!');
});

client.on('guildMemberAdd', async m => {
    if (m.guild.id === getEnv('COMMUNITY_GUILD_ID')) await sendLog(getEnv('COMMUNITY_GUILD_ID'), 'member_join', {});
});

function checkEventReminders() {
    try {
        const rems = getReminders(); if (!rems.length) return;
        const events = getEvents(); const now = Date.now(); const toRemove = [];
        for (const r of rems) {
            if (now >= r.reminderTime) {
                const e = events[r.eventId];
                if (e?.active && !e.reminded10min) {
                    e.reminded10min = true; saveEvents(events);
                    const g = client.guilds.cache.get(e.guildId);
                    if (g) { const ch = g.channels.cache.get(e.channelId); if (ch) ch.send(`⏰ **${e.title}** через 10 мин!\n${[...new Set([...e.accepted, ...e.tentative])].map(id=>`<@${id}>`).join(' ')}`).catch(()=>{}); }
                }
                toRemove.push(r);
            }
        }
        if (toRemove.length) saveReminders(rems.filter(r=>!toRemove.includes(r)));
    } catch (e) {}
}

// ============================================================
//                  ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ
// ============================================================
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;

            if (cmd === 'setup' && interaction.options.getSubcommand() === 'apply') {
                await setupPanels(interaction.channel);
                await interaction.reply({ content: '✅ Панели созданы!', ephemeral: true });
                return;
            }

            if (cmd === 'ticket' && interaction.options.getSubcommand() === 'create') {
                await createApplyTicket(interaction);
                return;
            }

            if (cmd === 'event') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'create') {
                    const title = interaction.options.getString('название'), desc = interaction.options.getString('описание');
                    const date = interaction.options.getString('дата'), time = interaction.options.getString('время');
                    const channel = interaction.options.getChannel('канал') || interaction.channel;
                    const [d,m,y] = date.split('.').map(Number), [h,min] = time.split(':').map(Number);
                    const ed = new Date(y,m-1,d,h-3,min), uts = Math.floor(ed.getTime()/1000);
                    if (ed <= Date.now()) return interaction.reply({ content: '❌ Будущее!', ephemeral: true });
                    const eid = Date.now().toString(36).toUpperCase()+Math.random().toString(36).substring(2,5);
                    const emb = new EmbedBuilder().setTitle(`📅 ${title}`).setDescription(desc).setColor(0x5865F2)
                        .addFields({ name: '📋', value: `📆 ${date}\n🕐 ${time} МСК\n<t:${uts}:R>`, inline: false },
                            { name: '✅ (0)', value: '>>> *Никого*', inline: true }, { name: '❌ (0)', value: '>>> *Никого*', inline: true }, { name: '🤔 (0)', value: '>>> *Никого*', inline: true })
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
                    const rt = ed.getTime()-600000;
                    if (rt > Date.now()) { const rems = getReminders(); rems.push({ eventId: eid, reminderTime: rt, type: '10min' }); saveReminders(rems); }
                    await interaction.reply({ content: `✅ Создан!\nID: \`${eid}\``, ephemeral: true });
                }
                if (sub === 'end') {
                    const events = getEvents(), event = events[interaction.options.getString('id')];
                    if (!event) return interaction.reply({ content: '❌ Не найден.', ephemeral: true });
                    event.active = false; saveEvents(events);
                    saveReminders(getReminders().filter(r=>r.eventId !== interaction.options.getString('id')));
                    await interaction.reply({ content: '✅ Завершён!', ephemeral: true });
                }
                return;
            }

            if (cmd === 'raid') {
                const extra = interaction.options.getString('сообщение') || '';
                await interaction.channel.send({ content: `@everyone **⚔️ RAID! ⚔️**\n${extra ? `📋 ${extra}\n` : ''}**Всем в игру!** 🔥` });
                await interaction.reply({ content: '✅', ephemeral: true });
                return;
            }

            if (cmd === 'afk' && interaction.options.getSubcommand() === 'list') {
                const afk = getAfk();
                const active = Object.entries(afk).filter(([,d])=>d?.active);
                if (!active.length) return interaction.reply({ content: '✅ Все на месте!', ephemeral: true });
                const emb = new EmbedBuilder().setTitle('🏖️ Отсутствующие').setColor(0xE67E22).setDescription(`Всего: **${active.length}**`);
                for (const [uid, d] of active) emb.addFields({ name: `${d.type==='vacation'?'📅':'🚶'} <@${uid}>`, value: `Причина: ${d.reason}`, inline: false });
                await interaction.reply({ embeds: [emb], ephemeral: true });
                return;
            }
        }

        // КНОПКИ
        if (interaction.isButton()) {
            const cid = interaction.customId;

            if (cid === 'create_apply_ticket') { await createApplyTicket(interaction); return; }

            // Переключение статуса (только админ)
            if (cid === 'toggle_apply_status') {
                if (!isAdmin(interaction.member)) return interaction.reply({ content: '⛔ Только администратор.', ephemeral: true });
                const emb = interaction.message.embeds[0];
                const isOpen = emb.description?.includes('🟢');
                await interaction.update({
                    embeds: [new EmbedBuilder(emb).setDescription(emb.description.replace(isOpen?'🟢':'🔴', isOpen?'🔴':'🟢')).setColor(isOpen?0xED4245:0x57F287)],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('create_apply_ticket').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('toggle_apply_status').setLabel(isOpen?'🔴 Закрыт':'🟢 Открыт').setStyle(isOpen?ButtonStyle.Danger:ButtonStyle.Success),
                    )]
                });
                return;
            }

            // Принять/отклонить (админ И стафф)
            if (cid.startsWith('apply_accept_')) { await acceptApply(interaction, cid.split('_')[2]); return; }
            if (cid.startsWith('apply_deny_')) { await denyApply(interaction, cid.split('_')[2]); return; }

            if (cid.startsWith('event_accept_')) { await handleEventResponse(interaction, cid.replace('event_accept_',''), 'accept'); return; }
            if (cid.startsWith('event_decline_')) { await handleEventResponse(interaction, cid.replace('event_decline_',''), 'decline'); return; }
            if (cid.startsWith('event_tentative_')) { await handleEventResponse(interaction, cid.replace('event_tentative_',''), 'tentative'); return; }

            if (cid === 'afk_vacation') {
                const modal = new ModalBuilder().setCustomId('vacation_modal').setTitle('🏖️ Отпуск');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vacation_days').setLabel('На сколько дней?').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vacation_reason').setLabel('Причина').setPlaceholder('Уезжаю').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await interaction.showModal(modal);
                return;
            }
            if (cid === 'afk_away') {
                const modal = new ModalBuilder().setCustomId('away_modal').setTitle('🚶 Отошёл');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_time').setLabel('На сколько? (2 часа / 30 минут)').setPlaceholder('2 часа').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_reason').setLabel('Причина').setPlaceholder('В магазин').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await interaction.showModal(modal);
                return;
            }
            if (cid.startsWith('afk_return_')) { await returnFromAfk(interaction, cid.replace('afk_return_','')); return; }
        }

        // МОДАЛКИ
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'vacation_modal') { await processVacation(interaction); return; }
            if (interaction.customId === 'away_modal') { await processAway(interaction); return; }
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
client.login(token).catch(e => { console.error('❌', e.message); process.exit(1); });
