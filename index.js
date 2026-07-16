const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ChannelType, 
    PermissionFlagsBits, 
    Collection, 
    REST, 
    Routes 
} = require('discord.js');
const dotenv = require('dotenv');
const express = require('express');
dotenv.config();

// ========== ВЕБ-СЕРВЕР ДЛЯ RENDER ==========
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('✅ Бот RUNA работает 24/7!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'online', 
        uptime: process.uptime(),
        tickets: tickets ? tickets.size : 0,
        timestamp: new Date().toISOString()
    });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Веб-сервер запущен на порту ${PORT}`);
});

// ========== КЛИЕНТ DISCORD ==========
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ========== КОНФИГУРАЦИЯ ==========
const CONFIG = {
    MIN_HOURS: 3000,
    MIN_AGE: 15,
    MIN_ONLINE: 6,
    TICKET_CATEGORY: process.env.TICKET_CATEGORY_ID || null,
    STAFF_ROLE: process.env.STAFF_ROLE_ID || null,
    LOG_CHANNEL: process.env.LOG_CHANNEL_ID || null,
    GUILD_ID: process.env.GUILD_ID || null,
    CLIENT_ID: process.env.CLIENT_ID || null
};

// ========== ПРОВЕРКА ПЕРЕМЕННЫХ ==========
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ОШИБКА: DISCORD_TOKEN не найден!');
    process.exit(1);
}

if (!CONFIG.GUILD_ID) {
    console.error('❌ ОШИБКА: GUILD_ID не найден!');
    process.exit(1);
}

if (!CONFIG.STAFF_ROLE) {
    console.error('❌ ОШИБКА: STAFF_ROLE_ID не найден!');
    process.exit(1);
}

if (!CONFIG.CLIENT_ID) {
    console.error('❌ ОШИБКА: CLIENT_ID не найден!');
    process.exit(1);
}

console.log('✅ Переменные окружения загружены');

// ========== ХРАНИЛИЩА ==========
const tickets = new Collection();
let recruitmentOpen = true;

// ========== ФУНКЦИЯ ЛОГИРОВАНИЯ ==========
async function sendLog(guild, action, user, hours = null, age = null, staff = null) {
    if (!CONFIG.LOG_CHANNEL) return;
    
    const logChannel = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
    if (!logChannel) return;

    let description = '';
    let color = '#FFFFFF';
    let title = '';

    switch (action) {
        case 'create':
            title = '📝 Создан тикет';
            description = `**Пользователь:** ${user}\n**Часов:** ${hours}\n**Возраст:** ${age}`;
            color = '#00FF00';
            break;
        case 'accept':
            title = '✅ Тикет принят';
            description = `**Пользователь:** ${user}\n**Принял:** ${staff}\n**Пользователь приглашен в клан!**`;
            color = '#00FF00';
            break;
        case 'close':
            title = '🔒 Тикет закрыт';
            description = `**Пользователь:** ${user}\n**Закрыл:** ${staff || user}\n**Тикет закрыт**`;
            color = '#FF0000';
            break;
        case 'delete':
            title = '🗑️ Тикет удален';
            description = `**Пользователь:** ${user}\n**Удалил:** ${staff}\n**Тикет удален**`;
            color = '#FF0000';
            break;
        case 'call':
            title = '📞 Вызов на обзвон';
            description = `**Пользователь:** ${user}\n**Вызвал:** ${staff}\n**Пользователь вызван в голосовой канал**`;
            color = '#0099FF';
            break;
        default:
            return;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: 'RUNA Clan • 2026' });

    await logChannel.send({ embeds: [embed] });
    console.log(`📝 Лог: ${action} | ${user.tag || user} | ${hours || ''} ${age || ''}`);
}

// ========== РЕГИСТРАЦИЯ КОМАНД ==========
async function registerCommands() {
    const commands = [
        {
            name: 'panel',
            description: 'Создать панель управления (только для стаффа)',
            options: [
                {
                    name: 'type',
                    description: 'Тип панели',
                    type: 3,
                    required: true,
                    choices: [
                        { name: 'Тикеты', value: 'ticket' },
                        { name: 'Статус', value: 'status' }
                    ]
                }
            ]
        },
        {
            name: 'recruitment',
            description: 'Открыть или закрыть набор в клан (только для стаффа)'
        },
        {
            name: 'status',
            description: 'Проверить статус набора в клан'
        },
        {
            name: 'tickets',
            description: 'Показать список активных тикетов (только для стаффа)'
        },
        {
            name: 'clearpanel',
            description: 'Очистить все панели бота в канале (только для стаффа)'
        },
        {
            name: 'register',
            description: 'Перерегистрировать команды (только для стаффа)'
        }
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands }
        );
        
        console.log(`✅ Зарегистрировано ${commands.length} команд!`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error);
        return false;
    }
}

// ========== СОЗДАНИЕ ПАНЕЛИ ТИКЕТОВ ==========
async function createTicketPanel(channel) {
    const statusEmoji = recruitmentOpen ? '🟢' : '🔴';
    const statusText = recruitmentOpen ? 'Набор открыт' : 'Набор закрыт';
    
    const embed = new EmbedBuilder()
        .setTitle('Подача заявки в клан RUNA')
        .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
        .addFields(
            { 
                name: 'Требования', 
                value: `Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\nМинимальный возраст: ${CONFIG.MIN_AGE} лет\nОнлайн в день: от ${CONFIG.MIN_ONLINE} часов`, 
                inline: false 
            },
            { 
                name: `${statusEmoji} Статус набора`, 
                value: statusText, 
                inline: false 
            }
        )
        .setFooter({ text: 'RUNA Clan • 2026' })
        .setTimestamp();

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Подать заявку')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!recruitmentOpen),
            new ButtonBuilder()
                .setCustomId('toggle_recruitment')
                .setLabel(recruitmentOpen ? 'Закрыть набор' : 'Открыть набор')
                .setStyle(ButtonStyle.Secondary)
        );

    try {
        const messages = await channel.messages.fetch({ limit: 30 });
        const botMessages = messages.filter(msg => 
            msg.author.id === client.user.id && 
            msg.embeds.length > 0 && 
            msg.embeds[0].title?.includes('Подача заявки')
        );
        for (const msg of botMessages.values()) {
            await msg.delete();
        }
    } catch (error) {}

    await channel.send({ embeds: [embed], components: [row] });
    console.log(`📋 Панель тикетов создана в #${channel.name}`);
}

// ========== СОЗДАНИЕ ПАНЕЛИ СТАТУСА ==========
async function createStatusPanel(channel) {
    const statusEmoji = recruitmentOpen ? '🟢' : '🔴';
    const statusText = recruitmentOpen ? 'Набор открыт' : 'Набор закрыт';
    const activeTickets = tickets.filter(t => t.status === 'open').size;
    
    const embed = new EmbedBuilder()
        .setTitle('Статус клана RUNA')
        .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
        .addFields(
            { name: `${statusEmoji} Набор в клан`, value: statusText, inline: false },
            { 
                name: 'Требования', 
                value: `Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\nМинимальный возраст: ${CONFIG.MIN_AGE} лет\nОнлайн в день: от ${CONFIG.MIN_ONLINE} часов`, 
                inline: false 
            },
            { name: 'Активных тикетов', value: `${activeTickets}`, inline: true },
            { name: 'Всего тикетов', value: `${tickets.size}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'RUNA Clan • 2026' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('Обновить')
                .setStyle(ButtonStyle.Secondary)
        );

    try {
        const messages = await channel.messages.fetch({ limit: 30 });
        const botMessages = messages.filter(msg => 
            msg.author.id === client.user.id && 
            msg.embeds.length > 0 && 
            msg.embeds[0].title?.includes('Статус клана')
        );
        for (const msg of botMessages.values()) {
            await msg.delete();
        }
    } catch (error) {}

    await channel.send({ embeds: [embed], components: [row] });
    console.log(`📊 Панель статуса создана в #${channel.name}`);
}

// ========== ПЕРЕКЛЮЧЕНИЕ НАБОРА ==========
async function toggleRecruitment(interaction) {
    recruitmentOpen = !recruitmentOpen;
    const status = recruitmentOpen ? 'открыт' : 'закрыт';
    
    await interaction.reply({
        content: `✅ Набор в клан теперь ${status}!`,
        ephemeral: true
    });

    const guild = interaction.guild;
    const channels = guild.channels.cache.filter(ch => 
        ch.type === ChannelType.GuildText && 
        ch.permissionsFor(guild.members.me).has(PermissionFlagsBits.ViewChannel)
    );

    for (const channel of channels.values()) {
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMessages = messages.filter(msg => 
                msg.author.id === client.user.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].title?.includes('Подача заявки')
            );
            
            for (const msg of botMessages.values()) {
                await msg.delete();
                await createTicketPanel(channel);
                break;
            }
        } catch (error) {}
    }
}

// ========== ПОКАЗ СТАТУСА ==========
async function showStatus(interaction) {
    const statusEmoji = recruitmentOpen ? '🟢' : '🔴';
    const statusText = recruitmentOpen ? 'Набор открыт' : 'Набор закрыт';
    const activeTickets = tickets.filter(t => t.status === 'open').size;
    
    const embed = new EmbedBuilder()
        .setTitle('Статус набора в RUNA')
        .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
        .addFields(
            { name: `${statusEmoji} Набор в клан`, value: statusText, inline: false },
            { 
                name: 'Требования', 
                value: `Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\nМинимальный возраст: ${CONFIG.MIN_AGE} лет\nОнлайн в день: от ${CONFIG.MIN_ONLINE} часов`, 
                inline: false 
            },
            { name: 'Активных тикетов', value: `${activeTickets}`, inline: true },
            { name: 'Всего тикетов', value: `${tickets.size}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'RUNA Clan • 2026' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ========== СПИСОК ТИКЕТОВ ==========
async function showTicketsList(interaction) {
    const openTickets = tickets.filter(t => t.status === 'open');
    
    if (openTickets.size === 0) {
        return interaction.reply({
            content: 'Активных тикетов нет.',
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('Список активных тикетов')
        .setColor('#0099FF')
        .setDescription(`Всего активных тикетов: ${openTickets.size}`)
        .setTimestamp();

    let ticketList = '';
    openTickets.forEach((ticket, index) => {
        const user = interaction.guild.members.cache.get(ticket.userId);
        ticketList += `${index + 1}. <#${ticket.channelId}> - ${user ? user.user.tag : 'Неизвестный пользователь'}\n`;
    });

    embed.addFields({ name: 'Тикеты', value: ticketList || 'Нет данных', inline: false });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ========== ОЧИСТКА ПАНЕЛЕЙ ==========
async function clearPanels(interaction) {
    const channel = interaction.channel;
    
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const botMessages = messages.filter(msg => 
            msg.author.id === client.user.id && 
            msg.embeds.length > 0 && 
            (msg.embeds[0].title?.includes('Подача заявки') || 
             msg.embeds[0].title?.includes('Статус клана'))
        );

        if (botMessages.size === 0) {
            return interaction.reply({
                content: 'В этом канале нет панелей бота.',
                ephemeral: true
            });
        }

        let deletedCount = 0;
        for (const msg of botMessages.values()) {
            await msg.delete();
            deletedCount++;
        }

        await interaction.reply({
            content: `✅ Удалено ${deletedCount} панелей!`,
            ephemeral: true
        });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.reply({
            content: '❌ Ошибка при очистке панелей.',
            ephemeral: true
        });
    }
}

// ========== ОБРАБОТКА КОМАНД ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;
    const isStaff = interaction.member.roles.cache.has(CONFIG.STAFF_ROLE);

    if (commandName === 'register') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав!', 
                ephemeral: true 
            });
        }

        await interaction.reply({ 
            content: '🔄 Регистрирую команды...', 
            ephemeral: true 
        });

        const registered = await registerCommands();
        
        if (registered) {
            await interaction.editReply({
                content: '✅ Команды зарегистрированы! Напишите / в чате.'
            });
        } else {
            await interaction.editReply({
                content: '❌ Ошибка регистрации! Проверьте логи.'
            });
        }
    }

    if (commandName === 'panel') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав!', 
                ephemeral: true 
            });
        }

        const type = options.getString('type');
        const channel = interaction.channel;

        if (type === 'ticket') {
            await createTicketPanel(channel);
            await interaction.reply({ 
                content: '✅ Панель тикетов создана!', 
                ephemeral: true 
            });
        } else if (type === 'status') {
            await createStatusPanel(channel);
            await interaction.reply({ 
                content: '✅ Панель статуса создана!', 
                ephemeral: true 
            });
        }
    }

    if (commandName === 'recruitment') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав!', 
                ephemeral: true 
            });
        }
        await toggleRecruitment(interaction);
    }

    if (commandName === 'status') {
        await showStatus(interaction);
    }

    if (commandName === 'tickets') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав!', 
                ephemeral: true 
            });
        }
        await showTicketsList(interaction);
    }

    if (commandName === 'clearpanel') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав!', 
                ephemeral: true 
            });
        }
        await clearPanels(interaction);
    }
});

// ========== ОБРАБОТКА КНОПОК ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket') {
        if (!recruitmentOpen) {
            return interaction.reply({ 
                content: '❌ Набор закрыт!', 
                ephemeral: true 
            });
        }

        const existingTicket = tickets.find(t => t.userId === interaction.user.id && t.status === 'open');
        if (existingTicket) {
            return interaction.reply({
                content: `❌ У вас уже есть тикет: <#${existingTicket.channelId}>`,
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('ticket_modal')
            .setTitle('Заявка в RUNA');

        const hoursInput = new TextInputBuilder()
            .setCustomId('hours')
            .setLabel('Сколько часов в игре?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 3500')
            .setRequired(true);

        const ageInput = new TextInputBuilder()
            .setCustomId('age')
            .setLabel('Сколько вам лет?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 18')
            .setRequired(true);

        const onlineInput = new TextInputBuilder()
            .setCustomId('online')
            .setLabel('Часов в день / Часовой пояс')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 8ч / UTC+3')
            .setRequired(true);

        const callInput = new TextInputBuilder()
            .setCustomId('call')
            .setLabel('Умение слушать колл (1-10)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 7')
            .setRequired(true);

        const roleInput = new TextInputBuilder()
            .setCustomId('role')
            .setLabel('Ваша роль')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Введите роль')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(hoursInput),
            new ActionRowBuilder().addComponents(ageInput),
            new ActionRowBuilder().addComponents(onlineInput),
            new ActionRowBuilder().addComponents(callInput),
            new ActionRowBuilder().addComponents(roleInput)
        );

        await interaction.showModal(modal);
    }

    if (interaction.customId === 'toggle_recruitment') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(CONFIG.STAFF_ROLE)) {
            return interaction.reply({ 
                content: '❌ У вас нет прав!', 
                ephemeral: true 
            });
        }
        await toggleRecruitment(interaction);
    }

    if (interaction.customId === 'refresh_status') {
        const statusEmoji = recruitmentOpen ? '🟢' : '🔴';
        const statusText = recruitmentOpen ? 'Набор открыт' : 'Набор закрыт';
        const activeTickets = tickets.filter(t => t.status === 'open').size;
        
        const embed = new EmbedBuilder()
            .setTitle('Статус клана RUNA')
            .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
            .addFields(
                { name: `${statusEmoji} Набор в клан`, value: statusText, inline: false },
                { 
                    name: 'Требования', 
                    value: `Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\nМинимальный возраст: ${CONFIG.MIN_AGE} лет\nОнлайн в день: от ${CONFIG.MIN_ONLINE} часов`, 
                    inline: false 
                },
                { name: 'Активных тикетов', value: `${activeTickets}`, inline: true },
                { name: 'Всего тикетов', value: `${tickets.size}`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'RUNA Clan • 2026' });

        await interaction.update({ embeds: [embed] });
    }

    if (['accept_ticket', 'call_ticket', 'close_ticket', 'delete_ticket'].includes(interaction.customId)) {
        await handleTicketAction(interaction);
    }
});

// ========== ОБРАБОТКА МОДАЛЬНОГО ОКНА ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'ticket_modal') return;

    await interaction.deferReply({ ephemeral: true });

    const hours = parseInt(interaction.fields.getTextInputValue('hours'));
    const age = parseInt(interaction.fields.getTextInputValue('age'));
    const online = interaction.fields.getTextInputValue('online');
    const call = parseInt(interaction.fields.getTextInputValue('call'));
    const role = interaction.fields.getTextInputValue('role');

    if (hours < CONFIG.MIN_HOURS) {
        return interaction.editReply({
            content: `❌ Отклонено! Минимальный онлайн: ${CONFIG.MIN_HOURS} часов. У вас: ${hours}.`
        });
    }

    if (age < CONFIG.MIN_AGE) {
        return interaction.editReply({
            content: `❌ Отклонено! Минимальный возраст: ${CONFIG.MIN_AGE} лет. У вас: ${age}.`
        });
    }

    if (call < 1 || call > 10) {
        return interaction.editReply({
            content: '❌ Оценка должна быть от 1 до 10!'
        });
    }

    const guild = interaction.guild;
    const category = CONFIG.TICKET_CATEGORY ? guild.channels.cache.get(CONFIG.TICKET_CATEGORY) : null;
    
    try {
        const channel = await guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: category ? category.id : null,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                },
                {
                    id: CONFIG.STAFF_ROLE,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                }
            ]
        });

        tickets.set(channel.id, {
            userId: interaction.user.id,
            channelId: channel.id,
            status: 'open',
            createdAt: Date.now(),
            data: { hours, age, online, call, role }
        });

        const embed = new EmbedBuilder()
            .setTitle('Новая заявка в RUNA')
            .setColor('#00FF00')
            .setDescription(`Заявка от ${interaction.user}`)
            .addFields(
                { name: 'Пользователь', value: `${interaction.user}`, inline: false },
                { name: 'Часов в игре', value: `${hours} ч`, inline: false },
                { name: 'Возраст', value: `${age} лет`, inline: false },
                { name: 'Онлайн/Часовой пояс', value: online, inline: false },
                { name: 'Умение слушать колл', value: `${call}/10`, inline: false },
                { name: 'Роль', value: role, inline: false }
            )
            .setFooter({ text: `Создан: ${new Date().toLocaleString()}` })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('accept_ticket')
                    .setLabel('Принять')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('call_ticket')
                    .setLabel('Вызвать на обзвон')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Закрыть')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('delete_ticket')
                    .setLabel('Удалить')
                    .setStyle(ButtonStyle.Danger)
            );

        await channel.send({ 
            content: `<@&${CONFIG.STAFF_ROLE}> | ${interaction.user}`,
            embeds: [embed], 
            components: [row] 
        });

        await sendLog(guild, 'create', interaction.user, hours, age);

        await interaction.editReply({
            content: `✅ Тикет создан! Перейдите в: <#${channel.id}>`
        });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({
            content: '❌ Ошибка при создании тикета.'
        });
    }
});

// ========== ОБРАБОТКА ДЕЙСТВИЙ С ТИКЕТОМ ==========
async function handleTicketAction(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const isStaff = member.roles.cache.has(CONFIG.STAFF_ROLE);
    const ticketInfo = tickets.get(interaction.channel.id);
    const guild = interaction.guild;
    
    if (!ticketInfo) {
        return interaction.reply({ content: '❌ Это не тикет!', ephemeral: true });
    }

    const user = await guild.members.fetch(ticketInfo.userId);

    if (interaction.customId === 'accept_ticket' || interaction.customId === 'call_ticket') {
        if (!isStaff) {
            return interaction.reply({ content: '❌ Только стафф!', ephemeral: true });
        }
    }

    if (interaction.customId === 'close_ticket') {
        if (!isStaff && interaction.user.id !== ticketInfo.userId) {
            return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
        }
    }

    if (interaction.customId === 'delete_ticket') {
        if (!isStaff) {
            return interaction.reply({ content: '❌ Только стафф!', ephemeral: true });
        }
    }

    await interaction.deferReply();

    switch (interaction.customId) {
        case 'accept_ticket': {
            await sendLog(guild, 'accept', user.user, null, null, interaction.user);
            
            await interaction.editReply({
                content: `✅ Тикет принят! ${user} приглашен в клан!`,
                embeds: [],
                components: []
            });
            
            setTimeout(async () => {
                await interaction.channel.delete();
                tickets.delete(interaction.channel.id);
            }, 5000);
            break;
        }

        case 'call_ticket': {
            const voiceState = interaction.member.voice;
            
            if (!voiceState.channel) {
                return interaction.editReply({
                    content: '❌ Вы должны быть в голосовом канале!'
                });
            }

            try {
                await user.voice.setChannel(voiceState.channel);
                await sendLog(guild, 'call', user.user, null, null, interaction.user);
                await interaction.editReply({
                    content: `📞 ${user} вызван в ${voiceState.channel}!`
                });
            } catch (error) {
                await interaction.editReply({
                    content: '❌ Не удалось переместить пользователя!'
                });
            }
            break;
        }

        case 'close_ticket': {
            const closer = interaction.user.id === ticketInfo.userId ? user.user : interaction.user;
            await sendLog(guild, 'close', user.user, null, null, closer);
            
            const embed = new EmbedBuilder()
                .setTitle('Тикет закрыт')
                .setDescription('Тикет может быть открыт снова.')
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], components: [] });
            
            await interaction.channel.permissionOverwrites.edit(ticketInfo.userId, {
                ViewChannel: false
            });
            
            tickets.set(interaction.channel.id, { ...ticketInfo, status: 'closed' });
            break;
        }

        case 'delete_ticket': {
            await sendLog(guild, 'delete', user.user, null, null, interaction.user);
            
            await interaction.editReply({
                content: '🗑️ Тикет будет удален через 3 секунды...'
            });
            
            setTimeout(async () => {
                await interaction.channel.delete();
                tickets.delete(interaction.channel.id);
            }, 3000);
            break;
        }
    }
}

// ========== АВТОМАТИЧЕСКОЕ ВОССТАНОВЛЕНИЕ ==========
client.on('shardDisconnect', (event, id) => {
    console.log(`⚠️ Шард ${id} отключен. Переподключение...`);
});

client.on('shardReconnecting', (id) => {
    console.log(`🔄 Шард ${id} переподключается...`);
});

client.on('shardReady', (id) => {
    console.log(`✅ Шард ${id} готов!`);
});

// ========== ОБРАБОТКА ОШИБОК ==========
client.on('error', error => {
    console.error('❌ Ошибка клиента:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Необработанная ошибка:', error);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен SIGINT. Завершаю работу...');
    server.close(() => {
        client.destroy();
        process.exit(0);
    });
});

// ========== ЗАПУСК БОТА ==========
client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`📊 На серверах: ${client.guilds.cache.size}`);
    
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) {
        console.error(`❌ Сервер с ID ${CONFIG.GUILD_ID} не найден!`);
        return;
    }

    console.log(`✅ Сервер: ${guild.name}`);

    try {
        const staffRole = await guild.roles.fetch(CONFIG.STAFF_ROLE);
        if (!staffRole) {
            console.error(`❌ Роль стаффа не найдена!`);
            return;
        }
        console.log(`✅ Роль стаффа: ${staffRole.name}`);
    } catch (error) {
        console.error('❌ Ошибка проверки роли:', error);
        return;
    }

    console.log('🔄 Регистрация команд...');
    await registerCommands();

    client.user.setPresence({
        activities: [{ name: 'RUNA | /panel ticket', type: 3 }],
        status: 'online'
    });

    console.log('🎫 Бот готов к работе 24/7!');
    console.log('📋 Команды: /panel ticket, /panel status, /recruitment, /status, /tickets, /clearpanel, /register');
    console.log(`🌐 Веб-сервер: http://localhost:${PORT}`);
});

// ========== ЗАПУСК ==========
client.login(process.env.DISCORD_TOKEN);
