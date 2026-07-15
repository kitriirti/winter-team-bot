require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits, ChannelType, REST, Routes
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================================
// ЗАЩИТА ОТ КРАША
// ============================================================
process.on('uncaughtException', (err) => console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', err.message));
process.on('unhandledRejection', (reason) => console.error('❌ НЕОБРАБОТАННЫЙ REJECTION:', reason));

// ============================================================
// КЛИЕНТ
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
    failIfNotExists: false,
    rest: { retries: 3, timeout: 15000 },
});

// ============================================================
// ХРАНИЛИЩЕ
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file) {
    const p = path.join(DATA_DIR, file);
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { console.error('Ошибка чтения:', file, e.message); }
    return null;
}

function writeJSON(file, data) {
    try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); } catch (e) { console.error('Ошибка записи:', file, e.message); }
}

// Инициализация
if (!fs.existsSync(path.join(DATA_DIR, 'events.json'))) writeJSON('events.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'reminders.json'))) writeJSON('reminders.json', []);
if (!fs.existsSync(path.join(DATA_DIR, 'afk.json'))) writeJSON('afk.json', {});
if (!fs.existsSync(path.join(DATA_DIR, 'config.json'))) writeJSON('config.json', {});

// ============================================================
// УТИЛИТЫ
// ============================================================
const getEnv = (key, fb = '') => process.env[key] || fb;
const safeNum = (v, fb = 0) => { const n = parseInt(v); return isNaN(n) ? fb : n; };

const hasRole = (member, roleId) => member && roleId && member.roles.cache.has(roleId);
const isAdmin = (member) => hasRole(member, getEnv('COMMUNITY_ADMIN_ROLE_ID'));
const isStaff = (member) => hasRole(member, getEnv('APPLY_STAFF_ROLE_ID'));
const isAdminOrStaff = (member) => isAdmin(member) || isStaff(member);
const isPrivateAdmin = (member) => hasRole(member, getEnv('PRIVATE_ADMIN_ROLE_ID'));

// ============================================================
// РЕГИСТРАЦИЯ КОМАНД
// ============================================================
const ALL_COMMANDS = [
    {
        name: 'setup', description: 'Настройка панелей',
        options: [
            { type: 1, name: 'apply', description: 'Создать панель заявок' },
            { type: 1, name: 'afk', description: 'Создать панель отпусков' },
        ],
    },
    {
        name: 'ticket', description: 'Подать заявку в клан',
        options: [{ type: 1, name: 'create', description: 'Создать заявку' }],
    },
    {
        name: 'event', description: 'Управление ивентами',
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
            { type: 1, name: 'end', description: 'Завершить', options: [{ type: 3, name: 'id', description: 'ID', required: true }] },
        ],
    },
    {
        name: 'raid', description: 'Объявить рейд',
        options: [{ type: 3, name: 'сообщение', description: 'Сообщение', required: false }],
    },
    {
        name: 'afk', description: 'Отпуск / отсутствие',
        options: [{ type: 1, name: 'list', description: 'Список отсутствующих' }],
    },
];

async function registerCommands() {
    const token = getEnv('BOT_TOKEN'), clientId = getEnv('CLIENT_ID');
    if (!token || !clientId) return;
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log('🗑️ Удаление старых команд...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        const guilds = await rest.get(Routes.userGuilds()).catch(() => []);
        for (const g of guilds) await rest.put(Routes.applicationGuildCommands(clientId, g.id), { body: [] }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        console.log('📝 Регистрация новых...');
        await rest.put(Routes.applicationCommands(clientId), { body: ALL_COMMANDS });
        console.log('✅ Команды зарегистрированы');
    } catch (e) { console.error('❌ Ошибка регистрации:', e.message); }
}

// ============================================================
// ЛОГИ
// ============================================================
async function log(guildId, embed) {
    try {
        if (!guildId) return;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const chId = getEnv('LOG_CHANNEL_ID');
        if (!chId) return;
        const ch = guild.channels.cache.get(chId);
        if (!ch) return;
        await ch.send({ embeds: [embed.setTimestamp()] }).catch(() => {});
    } catch (e) {}
}

// ============================================================
// ЗАЯВКИ
// ============================================================
async function createApply(interaction) {
    try {
        const guild = interaction.guild;
        const catId = getEnv('APPLY_CATEGORY_ID');
        if (!catId) return interaction.reply({ content: '❌ Категория не настроена (APPLY_CATEGORY_ID).', ephemeral: true });

        const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        if (guild.channels.cache.find(c => c.name === `заявка-${safe}` && c.parentId === catId)) {
            return interaction.reply({ content: '❌ Уже есть открытая заявка.', ephemeral: true });
        }

        const perms = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }];
        const staffId = getEnv('APPLY_STAFF_ROLE_ID'), adminId = getEnv('COMMUNITY_ADMIN_ROLE_ID');
        if (staffId && guild.roles.cache.get(staffId)) perms.push({ id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        if (adminId && guild.roles.cache.get(adminId)) perms.push({ id: adminId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

        const ch = await guild.channels.create({ name: `заявка-${safe}`, type: ChannelType.GuildText, parent: catId, permissionOverwrites: perms });

        const emb = new EmbedBuilder().setTitle('📋 Заявка в клан RUNA').setDescription(`**${interaction.user}**\n🟡 Ожидает`).setColor(0xFFA500);
        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ap_yes_${interaction.user.id}`).setLabel('✅ Принять').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`ap_no_${interaction.user.id}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
        );

        let ping = `||${interaction.user}||`;
        if (staffId) ping += ` <@&${staffId}>`;
        if (adminId) ping += ` <@&${adminId}>`;

        await ch.send({ content: ping, embeds: [emb], components: [btns] });
        await log(getEnv('COMMUNITY_GUILD_ID'), new EmbedBuilder().setTitle('📋 Заявка').setColor(0xFFA500).addFields({ name: 'От', value: `<@${interaction.user.id}>`, inline: true }));
        await interaction.reply({ content: `✅ Заявка создана: ${ch}`, ephemeral: true });
    } catch (e) {
        console.error('❌ createApply:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
}

async function acceptApply(interaction, userId) {
    if (!isAdminOrStaff(interaction.member)) return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });
    try {
        const g = client.guilds.cache.get(getEnv('PRIVATE_GUILD_ID'));
        const inv = await g.channels.cache.find(c => c.type === 0).createInvite({ maxUses: 1, maxAge: 86400, unique: true });
        const u = await client.users.fetch(userId).catch(() => null);
        if (u) await u.send(`🎉 Заявка одобрена!\n${inv.url}`).catch(() => {});
        await interaction.channel.send(`✅ <@${userId}> одобрен!`);
        await interaction.update({ content: '✅ Одобрено', components: [], embeds: [] }).catch(() => {});
        await log(getEnv('COMMUNITY_GUILD_ID'), new EmbedBuilder().setTitle('✅ Заявка принята').setColor(0x57F287).addFields({ name: 'Кто', value: `<@${userId}>`, inline: true }, { name: 'Принял', value: `<@${interaction.user.id}>`, inline: true }));
    } catch (e) { console.error('❌ accept:', e.message); }
}

async function denyApply(interaction, userId) {
    if (!isAdminOrStaff(interaction.member)) return interaction.reply({ content: '⛔ Нет прав.', ephemeral: true });
    try {
        const u = await client.users.fetch(userId).catch(() => null);
        if (u) await u.send('❌ Заявка отклонена.').catch(() => {});
        await interaction.channel.send(`❌ <@${userId}> отклонён.`);
        await interaction.update({ content: '❌ Отклонено', components: [], embeds: [] }).catch(() => {});
        await log(getEnv('COMMUNITY_GUILD_ID'), new EmbedBuilder().setTitle('❌ Заявка отклонена').setColor(0xED4245).addFields({ name: 'Кто', value: `<@${userId}>`, inline: true }, { name: 'Отклонил', value: `<@${interaction.user.id}>`, inline: true }));
    } catch (e) { console.error('❌ deny:', e.message); }
}

// ============================================================
// ПАНЕЛИ
// ============================================================
async function setupApply(channel) {
    const emb = new EmbedBuilder().setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН RUNA').setDescription('**ТРЕБОВАНИЯ:**\n\n● 3000+ часов\n● 15+ лет\n● Хороший микрофон\n● Умение слушать коллы\n● 6+ часов онлайна\n\n**🟢 Открыт**').setColor(0x57F287);
    const btns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_apply').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_toggle').setLabel('🟢 Открыт').setStyle(ButtonStyle.Success),
    );
    await channel.send({ embeds: [emb], components: [btns] });
}

async function setupAfk(channel) {
    const emb = new EmbedBuilder().setTitle('🏖️ ОТПУСК / ОТСУТСТВИЕ').setDescription('**🏖️ Отпуск** — на сколько дней\n**🚶 Отошёл** — на сколько минут/часов\n\nПосле заполнения будет выдана роль.').setColor(0x3498DB);
    const btns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('afk_vac').setLabel('🏖️ Отпуск').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('afk_away_btn').setLabel('🚶 Отошёл').setStyle(ButtonStyle.Secondary),
    );
    const msg = await channel.send({ embeds: [emb], components: [btns] });
    const cfg = readJSON('config.json') || {};
    cfg.afkMsgId = msg.id; cfg.afkChId = channel.id;
    writeJSON('config.json', cfg);
}

async function moveAfkDown(channel) {
    try {
        const cfg = readJSON('config.json') || {};
        if (!cfg.afkMsgId || cfg.afkChId !== channel.id) return;
        const msg = await channel.messages.fetch(cfg.afkMsgId).catch(() => null);
        if (!msg) return;
        const e = msg.embeds[0], c = msg.components;
        await msg.delete().catch(() => {});
        const nm = await channel.send({ embeds: [e], components: c });
        cfg.afkMsgId = nm.id; writeJSON('config.json', cfg);
    } catch (e) {}
}

// ============================================================
// ОТПУСКА
// ============================================================
const getAfk = () => { const d = readJSON('afk.json'); return (d && typeof d === 'object') ? d : {}; };
const saveAfk = (d) => { if (d) writeJSON('afk.json', d); };

function parseTime(s) {
    let ms = 0;
    const h = s.match(/(\d+)\s*(?:час|ч|h)/); if (h) ms += parseInt(h[1]) * 3600000;
    const m = s.match(/(\d+)\s*(?:мин|м|m)/); if (m) ms += parseInt(m[1]) * 60000;
    return ms > 0 ? ms : null;
}

function fmtDur(ms) {
    const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000), m = Math.floor((ms%3600000)/60000);
    return [`${d}дн`,`${h}ч`,`${m}мин`].filter(x=>!x.startsWith('0')).join(' ')||'<1 мин';
}

function fmtDate(d) { const dd=new Date(d); return `${String(dd.getDate()).padStart(2,'0')}.${String(dd.getMonth()+1).padStart(2,'0')}`; }

async function getAfkRole(guild) {
    let r = guild.roles.cache.find(r=>r.name==='🏖️ Отпуск');
    if (!r) r = await guild.roles.create({ name: '🏖️ Отпуск', color: 0xE67E22 });
    return r;
}

async function addAfkRole(guild, uid, retTime) {
    const role = await getAfkRole(guild); if (!role) return;
    const m = await guild.members.fetch(uid).catch(()=>null); if (!m) return;
    await m.roles.add(role).catch(()=>{});
    if (retTime) {
        const rd = fmtDate(retTime);
        for (const r of m.roles.cache.filter(r=>r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(()=>{}); if (r.members.size<=1) await r.delete().catch(()=>{}); }
        let tr = guild.roles.cache.find(r=>r.name===`🏖️ До ${rd}`);
        if (!tr) tr = await guild.roles.create({ name: `🏖️ До ${rd}`, color: 0xE74C3C });
        await m.roles.add(tr).catch(()=>{});
    }
}

async function delAfkRole(guild, uid) {
    const m = await guild.members.fetch(uid).catch(()=>null); if (!m) return;
    const mr = guild.roles.cache.find(r=>r.name==='🏖️ Отпуск');
    if (mr) await m.roles.remove(mr).catch(()=>{});
    for (const r of m.roles.cache.filter(r=>r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(()=>{}); if (r.members.size<=0) await r.delete().catch(()=>{}); }
}

async function doVacation(interaction) {
    const days = safeNum(interaction.fields.getTextInputValue('vac_days'));
    const reason = interaction.fields.getTextInputValue('vac_reason') || '-';
    if (days <= 0) return interaction.reply({ content: '❌ >0', ephemeral: true });
    const afk = getAfk();
    if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже в отпуске.', ephemeral: true });
    const rt = Date.now() + days * 86400000;
    afk[interaction.user.id] = { type: 'vacation', reason, days, startTime: Date.now(), returnTime: rt, active: true };
    saveAfk(afk);
    await addAfkRole(interaction.guild, interaction.user.id, rt);
    const emb = new EmbedBuilder().setTitle('📅 ОТПУСК').setDescription(`**${interaction.user}**`).setColor(0xE67E22).addFields({ name: '📅 Дней', value: String(days), inline: true }, { name: '📝', value: reason, inline: true });
    await interaction.channel.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`afk_ret_${interaction.user.id}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success))] });
    await moveAfkDown(interaction.channel);
    await log(getEnv('COMMUNITY_GUILD_ID'), new EmbedBuilder().setTitle('📅 Отпуск').setColor(0xE67E22).addFields({ name: 'Кто', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Дней', value: String(days), inline: true }));
    await interaction.reply({ content: `✅ Отпуск на ${days} дн.`, ephemeral: true });
}

async function doAway(interaction) {
    const ts = interaction.fields.getTextInputValue('away_time');
    const reason = interaction.fields.getTextInputValue('away_reason') || '-';
    const ms = parseTime(ts);
    if (!ms) return interaction.reply({ content: '❌ Формат: "2 часа"', ephemeral: true });
    const afk = getAfk();
    if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже.', ephemeral: true });
    const rt = Date.now() + ms;
    afk[interaction.user.id] = { type: 'away', reason, timeStr: ts, startTime: Date.now(), returnTime: rt, active: true };
    saveAfk(afk);
    await addAfkRole(interaction.guild, interaction.user.id, null);
    const emb = new EmbedBuilder().setTitle('🚶 ОТОШЁЛ').setDescription(`**${interaction.user}**`).setColor(0x3498DB).addFields({ name: '⏰', value: ts, inline: true }, { name: '📝', value: reason, inline: true });
    await interaction.channel.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`afk_ret_${interaction.user.id}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success))] });
    await moveAfkDown(interaction.channel);
    await log(getEnv('COMMUNITY_GUILD_ID'), new EmbedBuilder().setTitle('🚶 Отошёл').setColor(0x3498DB).addFields({ name: 'Кто', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Время', value: ts, inline: true }));
    await interaction.reply({ content: `✅ Отошёл на ${ts}`, ephemeral: true });
}

async function doReturn(interaction, uid) {
    const afk = getAfk();
    if (!afk[uid]?.active) return interaction.reply({ content: '❌ Не в отпуске.', ephemeral: true });
    const d = afk[uid]; const t = fmtDur(Date.now() - d.startTime);
    await delAfkRole(interaction.guild, uid);
    d.active = false; saveAfk(afk);
    if (interaction.message?.embeds[0]) await interaction.message.edit({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setTitle('✅ ВЕРНУЛСЯ').setColor(0x2ECC71).addFields({ name: '⏱️', value: t, inline: false })], components: [] }).catch(() => {});
    await log(getEnv('COMMUNITY_GUILD_ID'), new EmbedBuilder().setTitle('✅ Вернулся').setColor(0x2ECC71).addFields({ name: 'Кто', value: `<@${uid}>`, inline: true }, { name: 'Отсутствовал', value: t, inline: true }));
    await interaction.reply({ content: `✅ Вернулся! ${t}`, ephemeral: true });
}

// ============================================================
// ГОТОВНОСТЬ
// ============================================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} | Серверов: ${client.guilds.cache.size}`);
    await registerCommands();
    setInterval(() => {
        try {
            const afk = getAfk(); let ch = false; const now = Date.now();
            for (const [uid, d] of Object.entries(afk)) {
                if (d?.active && now >= d.returnTime) { d.active = false; ch = true; const g = client.guilds.cache.get(getEnv('COMMUNITY_GUILD_ID')); if (g) delAfkRole(g, uid).catch(()=>{}); }
            }
            if (ch) saveAfk(afk);
        } catch (e) {}
    }, 60000);
    console.log('🟢 Готов!');
});

// ============================================================
// ОБРАБОТКА
// ============================================================
client.on('interactionCreate', async (i) => {
    try {
        if (i.isChatInputCommand()) {
            const cmd = i.commandName;

            if (cmd === 'setup') {
                const sub = i.options.getSubcommand();
                if (!isAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                if (sub === 'apply') { await setupApply(i.channel); await i.reply({ content: '✅', ephemeral: true }); }
                if (sub === 'afk') { await setupAfk(i.channel); await i.reply({ content: '✅', ephemeral: true }); }
                return;
            }

            if (cmd === 'ticket') { await createApply(i); return; }

            if (cmd === 'event') {
                const sub = i.options.getSubcommand();
                if (sub === 'create') {
                    if (!isPrivateAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                    const title = i.options.getString('название'), desc = i.options.getString('описание');
                    const date = i.options.getString('дата'), time = i.options.getString('время');
                    const ch = i.options.getChannel('канал') || i.channel;
                    const [d,m,y] = date.split('.').map(Number), [h,min] = time.split(':').map(Number);
                    const ed = new Date(y,m-1,d,h-3,min), uts = Math.floor(ed.getTime()/1000);
                    if (ed <= Date.now()) return i.reply({ content: '❌ Будущее!', ephemeral: true });
                    const eid = Date.now().toString(36).toUpperCase();
                    const emb = new EmbedBuilder().setTitle(`📅 ${title}`).setDescription(desc).setColor(0x5865F2)
                        .addFields({ name: '📋', value: `📆 ${date}\n🕐 ${time} МСК\n<t:${uts}:R>`, inline: false },
                            { name: '✅ (0)', value: '>>> *Никого*', inline: true }, { name: '❌ (0)', value: '>>> *Никого*', inline: true }, { name: '🤔 (0)', value: '>>> *Никого*', inline: true })
                        .setFooter({ text: `ID: ${eid}` });
                    const btns = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`ev_yes_${eid}`).setLabel('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`ev_no_${eid}`).setLabel('❌').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`ev_mb_${eid}`).setLabel('🤔').setStyle(ButtonStyle.Secondary),
                    );
                    const msg = await ch.send({ content: '||@everyone||', embeds: [emb], components: [btns] });
                    const evs = getEvents();
                    evs[eid] = { msgId: msg.id, chId: ch.id, gId: ch.guild.id, title, desc, date, time, uts, accepted: [], declined: [], tentative: [], active: true };
                    saveEvents(evs);
                    await i.reply({ content: `✅ Ивент создан!\nID: \`${eid}\``, ephemeral: true });
                }
                if (sub === 'end') {
                    if (!isPrivateAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                    const evs = getEvents(), ev = evs[i.options.getString('id')];
                    if (!ev) return i.reply({ content: '❌ Не найден.', ephemeral: true });
                    ev.active = false; saveEvents(evs);
                    await i.reply({ content: '✅ Завершён!', ephemeral: true });
                }
                return;
            }

            if (cmd === 'raid') {
                if (!isPrivateAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                const extra = i.options.getString('сообщение') || '';
                await i.channel.send(`@everyone **⚔️ RAID! ⚔️**\n${extra ? `📋 ${extra}\n` : ''}**Всем в игру!** 🔥`);
                await i.reply({ content: '✅', ephemeral: true });
                return;
            }

            if (cmd === 'afk') {
                const afk = getAfk();
                const act = Object.entries(afk).filter(([,d])=>d?.active);
                if (!act.length) return i.reply({ content: '✅ Все на месте!', ephemeral: true });
                const emb = new EmbedBuilder().setTitle('🏖️ Отсутствующие').setColor(0xE67E22).setDescription(`Всего: **${act.length}**`);
                for (const [uid, d] of act) emb.addFields({ name: `${d.type==='vacation'?'📅':'🚶'} <@${uid}>`, value: `Причина: ${d.reason}`, inline: false });
                await i.reply({ embeds: [emb], ephemeral: true });
                return;
            }
        }

        // КНОПКИ
        if (i.isButton()) {
            const cid = i.customId;

            if (cid === 'btn_apply') { await createApply(i); return; }

            if (cid === 'btn_toggle') {
                if (!isAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                const emb = i.message.embeds[0];
                const isOpen = emb.description.includes('🟢');
                await i.update({
                    embeds: [new EmbedBuilder(emb).setDescription(emb.description.replace(isOpen?'🟢':'🔴', isOpen?'🔴':'🟢')).setColor(isOpen?0xED4245:0x57F287)],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_apply').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('btn_toggle').setLabel(isOpen?'🔴 Закрыт':'🟢 Открыт').setStyle(isOpen?ButtonStyle.Danger:ButtonStyle.Success),
                    )]
                });
                return;
            }

            if (cid.startsWith('ap_yes_')) { await acceptApply(i, cid.split('_')[2]); return; }
            if (cid.startsWith('ap_no_')) { await denyApply(i, cid.split('_')[2]); return; }

            if (cid.startsWith('ev_yes_')) {
                const eid = cid.replace('ev_yes_','');
                const evs = getEvents(), ev = evs[eid];
                if (!ev?.active) return i.reply({ content: '❌ Завершён.', ephemeral: true });
                const uid = i.user.id;
                ['accepted','declined','tentative'].forEach(k => { ev[k] = (ev[k]||[]).filter(id => id !== uid); });
                ev.accepted.push(uid); saveEvents(evs);
                await i.reply({ content: `✅ Приду → ${ev.title}`, ephemeral: true });
                return;
            }
            if (cid.startsWith('ev_no_')) {
                const eid = cid.replace('ev_no_','');
                const evs = getEvents(), ev = evs[eid];
                if (!ev?.active) return i.reply({ content: '❌ Завершён.', ephemeral: true });
                const uid = i.user.id;
                ['accepted','declined','tentative'].forEach(k => { ev[k] = (ev[k]||[]).filter(id => id !== uid); });
                ev.declined.push(uid); saveEvents(evs);
                await i.reply({ content: `❌ Не приду → ${ev.title}`, ephemeral: true });
                return;
            }
            if (cid.startsWith('ev_mb_')) {
                const eid = cid.replace('ev_mb_','');
                const evs = getEvents(), ev = evs[eid];
                if (!ev?.active) return i.reply({ content: '❌ Завершён.', ephemeral: true });
                const uid = i.user.id;
                ['accepted','declined','tentative'].forEach(k => { ev[k] = (ev[k]||[]).filter(id => id !== uid); });
                ev.tentative.push(uid); saveEvents(evs);
                await i.reply({ content: `🤔 Возможно → ${ev.title}`, ephemeral: true });
                return;
            }

            if (cid === 'afk_vac') {
                const m = new ModalBuilder().setCustomId('vac_m').setTitle('🏖️ Отпуск');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vac_days').setLabel('Дней').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vac_reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await i.showModal(m); return;
            }
            if (cid === 'afk_away_btn') {
                const m = new ModalBuilder().setCustomId('away_m').setTitle('🚶 Отошёл');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_time').setLabel('Время (2 часа / 30 мин)').setPlaceholder('2 часа').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await i.showModal(m); return;
            }
            if (cid.startsWith('afk_ret_')) { await doReturn(i, cid.replace('afk_ret_','')); return; }
        }

        // МОДАЛКИ
        if (i.isModalSubmit()) {
            if (i.customId === 'vac_m') { await doVacation(i); return; }
            if (i.customId === 'away_m') { await doAway(i); return; }
        }
    } catch (e) {
        console.error('❌ ОБРАБОТЧИК:', e.message);
        try { if (!i.replied && !i.deferred) await i.reply({ content: '❌ Ошибка.', ephemeral: true }); } catch {}
    }
});

// ============================================================
// ЗАПУСК
// ============================================================
function getEvents() { const d = readJSON('events.json'); return (d && typeof d === 'object') ? d : {}; }
function saveEvents(d) { if (d) writeJSON('events.json', d); }

client.login(getEnv('BOT_TOKEN')).catch(e => { console.error('❌ ТОКЕН:', e.message); process.exit(1); });
