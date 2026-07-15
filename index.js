// Загружаем .env вручную (Render Secret Files)
const fs = require('fs');
const path = require('path');

try {
    const secretPath = '/etc/secrets/.env';
    if (fs.existsSync(secretPath)) {
        const envContent = fs.readFileSync(secretPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex > 0) {
                    const key = trimmed.substring(0, eqIndex).trim();
                    const value = trimmed.substring(eqIndex + 1).trim();
                    if (key && value) process.env[key] = value;
                }
            }
        });
        console.log('✅ Загружен .env из /etc/secrets/.env');
    }
} catch (e) {
    console.error('❌ Ошибка загрузки /etc/secrets/.env:', e.message);
}

try {
    const localPath = path.join(__dirname, '.env');
    if (fs.existsSync(localPath)) {
        const envContent = fs.readFileSync(localPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex > 0) {
                    const key = trimmed.substring(0, eqIndex).trim();
                    const value = trimmed.substring(eqIndex + 1).trim();
                    if (key && value && !process.env[key]) {
                        process.env[key] = value;
                    }
                }
            }
        });
        console.log('✅ Загружен .env из корня');
    }
} catch (e) {
    console.error('❌ Ошибка загрузки .env:', e.message);
}

const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits, ChannelType, REST, Routes
} = require('discord.js');

// ============================================================
// ЗАЩИТА
// ============================================================
process.on('uncaughtException', (err) => console.error('❌', err.message));
process.on('unhandledRejection', (reason) => console.error('❌', reason));

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
const DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function load(f) {
    const p = path.join(DIR, f);
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) {}
    return null;
}
function save(f, d) {
    try { fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2)); } catch (e) {}
}

if (!fs.existsSync(path.join(DIR, 'events.json'))) save('events.json', {});
if (!fs.existsSync(path.join(DIR, 'afk.json'))) save('afk.json', {});
if (!fs.existsSync(path.join(DIR, 'cfg.json'))) save('cfg.json', {});

// ============================================================
// УТИЛИТЫ
// ============================================================
const env = (k, fb = '') => {
    const val = process.env[k];
    if (val) return val;
    console.log(`⚠️ Переменная ${k} не найдена!`);
    return fb;
};

const num = (v, fb = 0) => { const n = parseInt(v); return isNaN(n) ? fb : n; };
const has = (m, rid) => m && rid && m.roles.cache.has(rid);
const isAdmin = (m) => has(m, env('COMMUNITY_ADMIN_ROLE_ID'));
const isStaff = (m) => has(m, env('APPLY_STAFF_ROLE_ID'));
const isAdminOrStaff = (m) => isAdmin(m) || isStaff(m);
const isPrivAdmin = (m) => has(m, env('PRIVATE_ADMIN_ROLE_ID'));

// ============================================================
// КОМАНДЫ
// ============================================================
const CMDS = [
    {
        name: 'setup', description: 'Настройка',
        options: [
            { type: 1, name: 'apply', description: 'Панель заявок' },
            { type: 1, name: 'afk', description: 'Панель отпусков' },
        ],
    },
    {
        name: 'ticket', description: 'Заявка в клан',
        options: [{ type: 1, name: 'create', description: 'Создать' }],
    },
    {
        name: 'event', description: 'Ивенты',
        options: [
            {
                type: 1, name: 'create', description: 'Создать',
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
    { name: 'raid', description: 'Рейд', options: [{ type: 3, name: 'сообщение', description: 'Текст', required: false }] },
    { name: 'afk', description: 'Список', options: [{ type: 1, name: 'list', description: 'Отсутствующие' }] },
];

async function reg() {
    const tok = env('BOT_TOKEN'), cid = env('CLIENT_ID');
    if (!tok || !cid) return;
    const r = new REST({ version: '10' }).setToken(tok);
    try {
        await r.put(Routes.applicationCommands(cid), { body: [] });
        const gs = await r.get(Routes.userGuilds()).catch(() => []);
        for (const g of gs) await r.put(Routes.applicationGuildCommands(cid, g.id), { body: [] }).catch(() => {});
        await new Promise(rr => setTimeout(rr, 3000));
        await r.put(Routes.applicationCommands(cid), { body: CMDS });
        console.log('✅ Команды готовы');
    } catch (e) { console.error('❌ reg:', e.message); }
}

// ============================================================
// ЛОГ
// ============================================================
async function log(emb) {
    try {
        const gid = env('COMMUNITY_GUILD_ID');
        if (!gid) return;
        const g = client.guilds.cache.get(gid);
        if (!g) return;
        const cid = env('LOG_CHANNEL_ID');
        if (!cid) return;
        const ch = g.channels.cache.get(cid);
        if (!ch) return;
        await ch.send({ embeds: [emb.setTimestamp()] }).catch(() => {});
    } catch (e) {}
}

// ============================================================
// ЗАЯВКИ
// ============================================================
async function newApply(interaction) {
    try {
        const g = interaction.guild;
        const cat = env('APPLY_CATEGORY_ID');
        
        // Отладка
        console.log('🔍 DEBUG newApply:');
        console.log('  APPLY_CATEGORY_ID из env:', cat);
        console.log('  BOT_TOKEN есть:', !!env('BOT_TOKEN'));
        console.log('  COMMUNITY_GUILD_ID:', env('COMMUNITY_GUILD_ID'));
        
        if (!cat || cat === '') {
            return interaction.reply({ content: '❌ Категория заявок не настроена. Проверь переменную APPLY_CATEGORY_ID в настройках Render.', ephemeral: true });
        }

        const sn = interaction.user.username.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        if (g.channels.cache.find(c => c.name === `заявка-${sn}` && c.parentId === cat)) {
            return interaction.reply({ content: '❌ Уже есть заявка.', ephemeral: true });
        }

        const perms = [
            { id: g.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];
        const srid = env('APPLY_STAFF_ROLE_ID'), arid = env('COMMUNITY_ADMIN_ROLE_ID');
        if (srid && g.roles.cache.get(srid)) perms.push({ id: srid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        if (arid && g.roles.cache.get(arid)) perms.push({ id: arid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

        const ch = await g.channels.create({ name: `заявка-${sn}`, type: ChannelType.GuildText, parent: cat, permissionOverwrites: perms });

        const emb = new EmbedBuilder().setTitle('📋 Заявка в клан RUNA').setDescription(`**${interaction.user}**\n🟡 Ожидает`).setColor(0xFFA500);
        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`aY_${interaction.user.id}`).setLabel('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`aN_${interaction.user.id}`).setLabel('❌').setStyle(ButtonStyle.Danger),
        );

        let ping = `||${interaction.user}||`;
        if (srid) ping += ` <@&${srid}>`;
        if (arid) ping += ` <@&${arid}>`;

        await ch.send({ content: ping, embeds: [emb], components: [btns] });
        await log(new EmbedBuilder().setTitle('📋 Заявка').setColor(0xFFA500).addFields({ name: 'От', value: `<@${interaction.user.id}>`, inline: true }));
        await interaction.reply({ content: `✅ ${ch}`, ephemeral: true });
    } catch (e) {
        console.error('❌ newApply:', e.message);
        try { await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true }); } catch {}
    }
}

async function accept(interaction, uid) {
    if (!isAdminOrStaff(interaction.member)) return interaction.reply({ content: '⛔', ephemeral: true });
    try {
        const pg = client.guilds.cache.get(env('PRIVATE_GUILD_ID'));
        if (!pg) return interaction.reply({ content: '❌ Приватка не найдена.', ephemeral: true });
        const ic = pg.channels.cache.find(c => c.type === 0);
        if (!ic) return interaction.reply({ content: '❌ Нет канала.', ephemeral: true });
        const inv = await ic.createInvite({ maxUses: 1, maxAge: 86400, unique: true });
        const u = await client.users.fetch(uid).catch(() => null);
        if (u) await u.send(`🎉 Заявка одобрена!\n${inv.url}`).catch(() => {});
        await interaction.channel?.send(`✅ <@${uid}> одобрен!`);
        await interaction.update({ content: '✅', components: [], embeds: [] }).catch(() => {});
        await log(new EmbedBuilder().setTitle('✅ Принято').setColor(0x57F287).addFields({ name: 'Кто', value: `<@${uid}>`, inline: true }));
    } catch (e) { console.error('❌ accept:', e.message); }
}

async function deny(interaction, uid) {
    if (!isAdminOrStaff(interaction.member)) return interaction.reply({ content: '⛔', ephemeral: true });
    try {
        const u = await client.users.fetch(uid).catch(() => null);
        if (u) await u.send('❌ Отклонено.').catch(() => {});
        await interaction.channel?.send(`❌ <@${uid}> отклонён.`);
        await interaction.update({ content: '❌', components: [], embeds: [] }).catch(() => {});
        await log(new EmbedBuilder().setTitle('❌ Отклонено').setColor(0xED4245).addFields({ name: 'Кто', value: `<@${uid}>`, inline: true }));
    } catch (e) { console.error('❌ deny:', e.message); }
}

// ============================================================
// ПАНЕЛИ
// ============================================================
async function panelApply(ch) {
    const e = new EmbedBuilder().setTitle('📋 ПОДАТЬ ЗАЯВКУ В КЛАН RUNA').setDescription('**ТРЕБОВАНИЯ:**\n\n● 3000+ часов\n● 15+ лет\n● Микрофон\n● Слушать коллы\n● 6+ ч/день\n\n**🟢 Открыт**').setColor(0x57F287);
    const b = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btnA').setLabel('📝 Подать заявку').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btnT').setLabel('🟢 Открыт').setStyle(ButtonStyle.Success),
    );
    await ch.send({ embeds: [e], components: [b] });
}

async function panelAfk(ch) {
    const e = new EmbedBuilder().setTitle('🏖️ ОТПУСК / ОТСУТСТВИЕ').setDescription('**🏖️ Отпуск** — дни\n**🚶 Отошёл** — часы/минуты\n\nВыдаётся роль.').setColor(0x3498DB);
    const b = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('afkV').setLabel('🏖️ Отпуск').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('afkA').setLabel('🚶 Отошёл').setStyle(ButtonStyle.Secondary),
    );
    const m = await ch.send({ embeds: [e], components: [b] });
    const cfg = load('cfg.json') || {};
    cfg.afkMsg = m.id; cfg.afkCh = ch.id;
    save('cfg.json', cfg);
}

async function moveAfk(ch) {
    try {
        const cfg = load('cfg.json') || {};
        if (!cfg.afkMsg || cfg.afkCh !== ch.id) return;
        const m = await ch.messages.fetch(cfg.afkMsg).catch(() => null);
        if (!m) return;
        const e = m.embeds[0], c = m.components;
        await m.delete().catch(() => {});
        const nm = await ch.send({ embeds: [e], components: c });
        cfg.afkMsg = nm.id; save('cfg.json', cfg);
    } catch (e) {}
}

// ============================================================
// ОТПУСКА
// ============================================================
const gAfk = () => { const d = load('afk.json'); return (d && typeof d === 'object') ? d : {}; };
const sAfk = (d) => { if (d) save('afk.json', d); };

function pTime(s) {
    let ms = 0;
    const h = s.match(/(\d+)\s*(?:час|ч|h)/); if (h) ms += parseInt(h[1]) * 3600000;
    const m = s.match(/(\d+)\s*(?:мин|м|m)/); if (m) ms += parseInt(m[1]) * 60000;
    return ms > 0 ? ms : null;
}

function fDur(ms) {
    const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000), m = Math.floor((ms%3600000)/60000);
    return [`${d}дн`,`${h}ч`,`${m}мин`].filter(x=>!x.startsWith('0')).join(' ')||'<1 мин';
}

function fDate(d) { const dd=new Date(d); return `${String(dd.getDate()).padStart(2,'0')}.${String(dd.getMonth()+1).padStart(2,'0')}`; }

async function gRole(g) {
    let r = g.roles.cache.find(r=>r.name==='🏖️ Отпуск');
    if (!r) r = await g.roles.create({ name: '🏖️ Отпуск', color: 0xE67E22 });
    return r;
}

async function aRole(g, uid, rt) {
    const role = await gRole(g); if (!role) return;
    const m = await g.members.fetch(uid).catch(()=>null); if (!m) return;
    await m.roles.add(role).catch(()=>{});
    if (rt) {
        const rd = fDate(rt);
        for (const r of m.roles.cache.filter(r=>r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(()=>{}); if (r.members.size<=1) await r.delete().catch(()=>{}); }
        let tr = g.roles.cache.find(r=>r.name===`🏖️ До ${rd}`);
        if (!tr) tr = await g.roles.create({ name: `🏖️ До ${rd}`, color: 0xE74C3C });
        await m.roles.add(tr).catch(()=>{});
    }
}

async function dRole(g, uid) {
    const m = await g.members.fetch(uid).catch(()=>null); if (!m) return;
    const mr = g.roles.cache.find(r=>r.name==='🏖️ Отпуск');
    if (mr) await m.roles.remove(mr).catch(()=>{});
    for (const r of m.roles.cache.filter(r=>r.name.startsWith('🏖️ До ')).values()) { await m.roles.remove(r).catch(()=>{}); if (r.members.size<=0) await r.delete().catch(()=>{}); }
}

async function vac(interaction) {
    const days = num(interaction.fields.getTextInputValue('vd'));
    const reason = interaction.fields.getTextInputValue('vr') || '-';
    if (days <= 0) return interaction.reply({ content: '❌ >0', ephemeral: true });
    const afk = gAfk();
    if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже.', ephemeral: true });
    const rt = Date.now() + days * 86400000;
    afk[interaction.user.id] = { type: 'vacation', reason, days, startTime: Date.now(), returnTime: rt, active: true };
    sAfk(afk);
    await aRole(interaction.guild, interaction.user.id, rt);
    const e = new EmbedBuilder().setTitle('📅 ОТПУСК').setDescription(`**${interaction.user}**`).setColor(0xE67E22).addFields({ name: 'Дней', value: String(days), inline: true }, { name: 'Причина', value: reason, inline: true });
    await interaction.channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`aR_${interaction.user.id}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success))] });
    await moveAfk(interaction.channel);
    await interaction.reply({ content: `✅ Отпуск на ${days} дн.`, ephemeral: true });
}

async function away(interaction) {
    const ts = interaction.fields.getTextInputValue('at');
    const reason = interaction.fields.getTextInputValue('ar') || '-';
    const ms = pTime(ts);
    if (!ms) return interaction.reply({ content: '❌ "2 часа"', ephemeral: true });
    const afk = gAfk();
    if (afk[interaction.user.id]?.active) return interaction.reply({ content: '❌ Уже.', ephemeral: true });
    const rt = Date.now() + ms;
    afk[interaction.user.id] = { type: 'away', reason, timeStr: ts, startTime: Date.now(), returnTime: rt, active: true };
    sAfk(afk);
    await aRole(interaction.guild, interaction.user.id, null);
    const e = new EmbedBuilder().setTitle('🚶 ОТОШЁЛ').setDescription(`**${interaction.user}**`).setColor(0x3498DB).addFields({ name: 'Время', value: ts, inline: true }, { name: 'Причина', value: reason, inline: true });
    await interaction.channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`aR_${interaction.user.id}`).setLabel('✅ Вернулся').setStyle(ButtonStyle.Success))] });
    await moveAfk(interaction.channel);
    await interaction.reply({ content: `✅ Отошёл на ${ts}`, ephemeral: true });
}

async function ret(interaction, uid) {
    const afk = gAfk();
    if (!afk[uid]?.active) return interaction.reply({ content: '❌ Не в отпуске.', ephemeral: true });
    const d = afk[uid]; const t = fDur(Date.now() - d.startTime);
    await dRole(interaction.guild, uid);
    d.active = false; sAfk(afk);
    if (interaction.message?.embeds[0]) await interaction.message.edit({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setTitle('✅ ВЕРНУЛСЯ').setColor(0x2ECC71).addFields({ name: 'Отсутствовал', value: t, inline: false })], components: [] }).catch(() => {});
    await interaction.reply({ content: `✅ Вернулся! ${t}`, ephemeral: true });
}

// ============================================================
// ГОТОВ
// ============================================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} | Серверов: ${client.guilds.cache.size}`);
    console.log('🔍 ПЕРЕМЕННЫЕ:');
    console.log('  BOT_TOKEN:', env('BOT_TOKEN') ? '✅' : '❌');
    console.log('  CLIENT_ID:', env('CLIENT_ID') ? '✅' : '❌');
    console.log('  COMMUNITY_GUILD_ID:', env('COMMUNITY_GUILD_ID') ? '✅' : '❌');
    console.log('  COMMUNITY_ADMIN_ROLE_ID:', env('COMMUNITY_ADMIN_ROLE_ID') ? '✅' : '❌');
    console.log('  APPLY_STAFF_ROLE_ID:', env('APPLY_STAFF_ROLE_ID') ? '✅' : '❌');
    console.log('  APPLY_CATEGORY_ID:', `"${env('APPLY_CATEGORY_ID')}"`);
    console.log('  LOG_CHANNEL_ID:', env('LOG_CHANNEL_ID') ? '✅' : '❌');
    console.log('  PRIVATE_GUILD_ID:', env('PRIVATE_GUILD_ID') ? '✅' : '❌');
    console.log('  PRIVATE_ADMIN_ROLE_ID:', env('PRIVATE_ADMIN_ROLE_ID') ? '✅' : '❌');
    await reg();
    setInterval(() => {
        try {
            const afk = gAfk(); let ch = false; const now = Date.now();
            for (const [uid, d] of Object.entries(afk)) {
                if (d?.active && now >= d.returnTime) { d.active = false; ch = true; const g = client.guilds.cache.get(env('COMMUNITY_GUILD_ID')); if (g) dRole(g, uid).catch(()=>{}); }
            }
            if (ch) sAfk(afk);
        } catch (e) {}
    }, 60000);
    console.log('🟢 Онлайн');
});

// ============================================================
// ОБРАБОТКА
// ============================================================
const gEv = () => { const d = load('events.json'); return (d && typeof d === 'object') ? d : {}; };
const sEv = (d) => { if (d) save('events.json', d); };

client.on('interactionCreate', async (i) => {
    try {
        if (i.isChatInputCommand()) {
            const c = i.commandName;

            if (c === 'setup') {
                if (!isAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                const s = i.options.getSubcommand();
                if (s === 'apply') { await panelApply(i.channel); await i.reply({ content: '✅ Панель заявок создана!', ephemeral: true }); }
                if (s === 'afk') { await panelAfk(i.channel); await i.reply({ content: '✅ Панель отпусков создана!', ephemeral: true }); }
                return;
            }

            if (c === 'ticket') { await newApply(i); return; }

            if (c === 'event') {
                const s = i.options.getSubcommand();
                if (s === 'create') {
                    if (!isPrivAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                    const t = i.options.getString('название'), d = i.options.getString('описание');
                    const dt = i.options.getString('дата'), tm = i.options.getString('время');
                    const ch = i.options.getChannel('канал') || i.channel;
                    const [dd,mm,yy] = dt.split('.').map(Number), [hh,min] = tm.split(':').map(Number);
                    const ed = new Date(yy,mm-1,dd,hh-3,min), uts = Math.floor(ed.getTime()/1000);
                    if (ed <= Date.now()) return i.reply({ content: '❌ Будущее!', ephemeral: true });
                    const eid = Date.now().toString(36).toUpperCase();
                    const emb = new EmbedBuilder().setTitle(`📅 ${t}`).setDescription(d).setColor(0x5865F2)
                        .addFields({ name: '📋', value: `📆 ${dt}\n🕐 ${tm} МСК\n<t:${uts}:R>`, inline: false },
                            { name: '✅ (0)', value: '>>> *Никого*', inline: true }, { name: '❌ (0)', value: '>>> *Никого*', inline: true }, { name: '🤔 (0)', value: '>>> *Никого*', inline: true })
                        .setFooter({ text: `ID: ${eid}` });
                    const btns = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`eY_${eid}`).setLabel('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`eN_${eid}`).setLabel('❌').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`eM_${eid}`).setLabel('🤔').setStyle(ButtonStyle.Secondary),
                    );
                    const msg = await ch.send({ content: '||@everyone||', embeds: [emb], components: [btns] });
                    const ev = gEv(); ev[eid] = { msgId: msg.id, chId: ch.id, gId: ch.guild.id, title: t, desc: d, date: dt, time: tm, uts, accepted: [], declined: [], tentative: [], active: true };
                    sEv(ev);
                    await i.reply({ content: `✅ Ивент создан!\nID: \`${eid}\``, ephemeral: true });
                }
                if (s === 'end') {
                    if (!isPrivAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                    const ev = gEv(), e = ev[i.options.getString('id')];
                    if (!e) return i.reply({ content: '❌ Не найден.', ephemeral: true });
                    e.active = false; sEv(ev);
                    await i.reply({ content: '✅ Завершён!', ephemeral: true });
                }
                return;
            }

            if (c === 'raid') {
                if (!isPrivAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                const ex = i.options.getString('сообщение') || '';
                await i.channel.send(`@everyone **⚔️ RAID! ⚔️**\n${ex ? `📋 ${ex}\n` : ''}**Всем в игру!** 🔥`);
                await i.reply({ content: '✅', ephemeral: true });
                return;
            }

            if (c === 'afk') {
                const afk = gAfk();
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
            if (cid === 'btnA') { await newApply(i); return; }
            if (cid === 'btnT') {
                if (!isAdmin(i.member)) return i.reply({ content: '⛔', ephemeral: true });
                const emb = i.message.embeds[0];
                const open = emb.description.includes('🟢');
                await i.update({
                    embeds: [new EmbedBuilder(emb).setDescription(emb.description.replace(open?'🟢':'🔴', open?'🔴':'🟢')).setColor(open?0xED4245:0x57F287)],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btnA').setLabel('📝').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('btnT').setLabel(open?'🔴':'🟢').setStyle(open?ButtonStyle.Danger:ButtonStyle.Success),
                    )]
                });
                return;
            }
            if (cid.startsWith('aY_')) { await accept(i, cid.split('_')[1]); return; }
            if (cid.startsWith('aN_')) { await deny(i, cid.split('_')[1]); return; }
            if (cid.startsWith('eY_')) {
                const ev = gEv(), e = ev[cid.replace('eY_','')];
                if (!e?.active) return i.reply({ content: '❌', ephemeral: true });
                ['accepted','declined','tentative'].forEach(k => { e[k] = (e[k]||[]).filter(id => id !== i.user.id); });
                e.accepted.push(i.user.id); sEv(ev);
                await i.reply({ content: `✅ ${e.title}`, ephemeral: true }); return;
            }
            if (cid.startsWith('eN_')) {
                const ev = gEv(), e = ev[cid.replace('eN_','')];
                if (!e?.active) return i.reply({ content: '❌', ephemeral: true });
                ['accepted','declined','tentative'].forEach(k => { e[k] = (e[k]||[]).filter(id => id !== i.user.id); });
                e.declined.push(i.user.id); sEv(ev);
                await i.reply({ content: `❌ ${e.title}`, ephemeral: true }); return;
            }
            if (cid.startsWith('eM_')) {
                const ev = gEv(), e = ev[cid.replace('eM_','')];
                if (!e?.active) return i.reply({ content: '❌', ephemeral: true });
                ['accepted','declined','tentative'].forEach(k => { e[k] = (e[k]||[]).filter(id => id !== i.user.id); });
                e.tentative.push(i.user.id); sEv(ev);
                await i.reply({ content: `🤔 ${e.title}`, ephemeral: true }); return;
            }
            if (cid === 'afkV') {
                const m = new ModalBuilder().setCustomId('vM').setTitle('🏖️ Отпуск');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vd').setLabel('Дней').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vr').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await i.showModal(m); return;
            }
            if (cid === 'afkA') {
                const m = new ModalBuilder().setCustomId('aM').setTitle('🚶 Отошёл');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('at').setLabel('Время (2 часа / 30 мин)').setPlaceholder('2 часа').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ar').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                );
                await i.showModal(m); return;
            }
            if (cid.startsWith('aR_')) { await ret(i, cid.replace('aR_','')); return; }
        }

        // МОДАЛКИ
        if (i.isModalSubmit()) {
            if (i.customId === 'vM') { await vac(i); return; }
            if (i.customId === 'aM') { await away(i); return; }
        }
    } catch (e) {
        console.error('❌', e.message);
        try { if (!i.replied && !i.deferred) await i.reply({ content: '❌', ephemeral: true }); } catch {}
    }
});

// ============================================================
// ЗАПУСК
// ============================================================
client.login(env('BOT_TOKEN')).catch(e => { console.error('❌ Токен:', e.message); process.exit(1); });
