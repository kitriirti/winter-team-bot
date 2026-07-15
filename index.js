const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, Collection, REST, Routes } = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Конфигурация с проверкой переменных
const CONFIG = {
    MIN_HOURS: 3000,
    MIN_AGE: 15,
    MIN_ONLINE: 6,
    TICKET_CATEGORY: process.env.TICKET_CATEGORY_ID || null,
    STAFF_ROLE: process.env.STAFF_ROLE_ID || null,
    LOG_CHANNEL: process.env.LOG_CHANNEL_ID || null,
    GUILD_ID: process.env.GUILD_ID || null
};

// Проверка обязательных переменных
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

console.log('✅ Переменные окружения загружены');

// Хранилище тикетов
const tickets = new Collection();
const ticketChannels = new Collection();
let recruitmentOpen = true;

// Функция для регистрации команд
async function registerCommands() {
    const commands = [
        {
            name: 'panel',
            description: '📋 Создать панель управления (только для стаффа)',
            options: [
                {
                    name: 'type',
                    description: 'Тип панели',
                    type: 3, // STRING
                    required: true,
                    choices: [
                        {
                            name: '🎫 Тикеты',
                            value: 'ticket'
                        },
                        {
                            name: '📊 Статус',
                            value: 'status'
                        }
                    ]
                }
            ]
        },
        {
            name: 'recruitment',
            description: '🔓 Открыть или закрыть набор в клан (только для стаффа)'
        },
        {
            name: 'status',
            description: '📊 Проверить статус набора в клан'
        },
        {
            name: 'tickets',
            description: '📋 Показать список активных тикетов (только для стаффа)'
        }
    ];

    try {
        console.log('🔄 Регистрация команд...');
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        // Регистрируем команды для конкретного сервера
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID),
            { body: commands }
        );
        
        console.log(`✅ Зарегистрировано ${commands.length} команд для сервера!`);
        
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error);
    }
}

client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} успешно запущен!`);
    
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) {
        console.error(`❌ Сервер с ID ${CONFIG.GUILD_ID} не найден!`);
        return;
    }

    console.log(`✅ Найден сервер: ${guild.name}`);

    // Регистрируем команды
    await registerCommands();

    // Проверяем роль стаффа
    try {
        const staffRole = await guild.roles.fetch(CONFIG.STAFF_ROLE);
        if (!staffRole) {
            console.error(`❌ Роль с ID ${CONFIG.STAFF_ROLE} не найдена!`);
            return;
        }
        console.log(`✅ Найдена роль стаффа: ${staffRole.name}`);
    } catch (error) {
        console.error('❌ Ошибка при проверке роли стаффа:', error);
        return;
    }

    // Создаем канал для тикетов если его нет
    let ticketChannel = guild.channels.cache.find(ch => ch.name === '🎫-tickets');
    if (!ticketChannel) {
        try {
            console.log('📝 Создаю канал для тикетов...');
            ticketChannel = await guild.channels.create({
                name: '🎫-tickets',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: CONFIG.STAFF_ROLE,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    }
                ]
            });
            console.log('✅ Канал для тикетов создан');
        } catch (error) {
            console.error('❌ Ошибка создания канала:', error);
            return;
        }
    } else {
        console.log('✅ Канал для тикетов найден');
    }

    // Создаем панель тикетов в канале по умолчанию
    try {
        await createTicketPanel(ticketChannel);
        console.log('✅ Панель тикетов создана');
    } catch (error) {
        console.error('❌ Ошибка создания панели:', error);
    }
    
    // Устанавливаем статус
    client.user.setPresence({
        activities: [{ name: 'RUNA | /panel ticket', type: 3 }],
        status: 'online'
    });

    console.log('🎫 Бот полностью готов к работе!');
    console.log('📋 Доступные команды:');
    console.log('  /panel ticket - Создать панель тикетов');
    console.log('  /panel status - Показать статус');
    console.log('  /recruitment - Открыть/закрыть набор');
    console.log('  /status - Проверить статус');
    console.log('  /tickets - Список активных тикетов');
});

// Обработка команд (slash commands)
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    // Проверка прав для команд стаффа
    const isStaff = interaction.member.roles.cache.has(CONFIG.STAFF_ROLE);

    // Команда /panel
    if (commandName === 'panel') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав для использования этой команды! Требуется роль стаффа.', 
                ephemeral: true 
            });
        }

        const type = options.getString('type');
        const channel = interaction.channel;

        if (type === 'ticket') {
            await createTicketPanel(channel);
            await interaction.reply({ 
                content: '✅ Панель тикетов создана/обновлена в этом канале!', 
                ephemeral: true 
            });
        } else if (type === 'status') {
            await createStatusPanel(channel);
            await interaction.reply({ 
                content: '✅ Панель статуса создана/обновлена в этом канале!', 
                ephemeral: true 
            });
        }
    }

    // Команда /recruitment
    if (commandName === 'recruitment') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав для использования этой команды! Требуется роль стаффа.', 
                ephemeral: true 
            });
        }

        await toggleRecruitment(interaction);
    }

    // Команда /status
    if (commandName === 'status') {
        await showStatus(interaction);
    }

    // Команда /tickets
    if (commandName === 'tickets') {
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ У вас нет прав для использования этой команды! Требуется роль стаффа.', 
                ephemeral: true 
            });
        }

        await showTicketsList(interaction);
    }
});

// Функция создания панели статуса
async function createStatusPanel(channel) {
    const status = recruitmentOpen ? '🔓 ОТКРЫТ' : '🔒 ЗАКРЫТ';
    const embed = new EmbedBuilder()
        .setTitle('📊 Статус клана RUNA')
        .setDescription('Актуальная информация о клане')
        .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
        .addFields(
            { name: '🎯 Набор в клан', value: `**${status}**`, inline: false },
            { name: '📋 Требования:', value: `• Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\n• Минимальный возраст: ${CONFIG.MIN_AGE} лет\n• Онлайн в день: от ${CONFIG.MIN_ONLINE} часов`, inline: false },
            { name: '👥 Активных тикетов', value: `${tickets.filter(t => t.status === 'open').size}`, inline: true },
            { name: '📝 Всего тикетов', value: `${tickets.size}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'RUNA Clan • 2026' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_status')
                .setLabel('🔄 Обновить')
                .setStyle(ButtonStyle.Secondary)
        );

    // Очищаем старые сообщения бота
    try {
        const messages = await channel.messages.fetch({ limit: 20 });
        const botMessages = messages.filter(msg => msg.author.id === client.user.id);
        for (const msg of botMessages.values()) {
            await msg.delete();
        }
    } catch (error) {
        console.warn('⚠️ Не удалось очистить сообщения:', error.message);
    }

    await channel.send({ embeds: [embed], components: [row] });
}

// Функция показа статуса
async function showStatus(interaction) {
    const status = recruitmentOpen ? '🔓 ОТКРЫТ' : '🔒 ЗАКРЫТ';
    const embed = new EmbedBuilder()
        .setTitle('📊 Статус набора в RUNA')
        .setDescription(`Набор в клан: **${status}**`)
        .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
        .addFields(
            { name: '📋 Требования:', value: `• Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\n• Минимальный возраст: ${CONFIG.MIN_AGE} лет\n• Онлайн в день: от ${CONFIG.MIN_ONLINE} часов`, inline: false },
            { name: '👥 Активных тикетов:', value: `${tickets.filter(t => t.status === 'open').size}`, inline: true },
            { name: '📝 Всего тикетов:', value: `${tickets.size}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'RUNA Clan • 2026' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Функция показа списка тикетов
async function showTicketsList(interaction) {
    const openTickets = tickets.filter(t => t.status === 'open');
    
    if (openTickets.size === 0) {
        return interaction.reply({
            content: '📭 Активных тикетов нет.',
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Список активных тикетов')
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

// Функция создания панели тикетов
async function createTicketPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🎫 Создание тикета в клан RUNA')
        .setDescription('Нажмите кнопку ниже, чтобы подать заявку на вступление в клан.')
        .setColor('#FF6B00')
        .addFields(
            { name: '📋 Требования:', value: `• Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\n• Минимальный возраст: ${CONFIG.MIN_AGE} лет\n• Онлайн в день: от ${CONFIG.MIN_ONLINE} часов`, inline: false },
            { name: '📌 Статус набора:', value: recruitmentOpen ? '🔓 **ОТКРЫТ**' : '🔒 **ЗАКРЫТ**', inline: false },
            { name: '📌 Важно:', value: 'Заполните все поля анкеты. Неверные данные приведут к автоматическому отклонению.', inline: false }
        )
        .setFooter({ text: 'RUNA Clan • 2026' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('📩 Подать заявку')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!recruitmentOpen),
            new ButtonBuilder()
                .setCustomId('toggle_recruitment')
                .setLabel(recruitmentOpen ? '🔒 Закрыть набор' : '🔓 Открыть набор')
                .setStyle(ButtonStyle.Secondary)
        );

    // Очищаем старые сообщения бота
    try {
        const messages = await channel.messages.fetch({ limit: 20 });
        const botMessages = messages.filter(msg => msg.author.id === client.user.id);
        for (const msg of botMessages.values()) {
            await msg.delete();
        }
    } catch (error) {
        console.warn('⚠️ Не удалось очистить сообщения:', error.message);
    }

    await channel.send({ embeds: [embed], components: [row] });
}

// Функция для переключения набора
async function toggleRecruitment(interaction) {
    recruitmentOpen = !recruitmentOpen;
    const status = recruitmentOpen ? '🔓 ОТКРЫТ' : '🔒 ЗАКРЫТ';
    
    await interaction.reply({
        content: `✅ Набор в клан теперь ${status}!`,
        ephemeral: true
    });

    // Обновляем все панели тикетов на сервере
    const guild = interaction.guild;
    const channels = guild.channels.cache.filter(ch => 
        ch.type === ChannelType.GuildText && 
        ch.permissionsFor(guild.members.me).has(PermissionFlagsBits.ViewChannel)
    );

    for (const channel of channels.values()) {
        try {
            const messages = await channel.messages.fetch({ limit: 5 });
            const botMessages = messages.filter(msg => 
                msg.author.id === client.user.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].title && 
                msg.embeds[0].title.includes('Создание тикета')
            );
            
            for (const msg of botMessages.values()) {
                await msg.delete();
                await createTicketPanel(channel);
                break;
            }
        } catch (error) {
            // Игнорируем ошибки
        }
    }
}

// Функция проверки статуса набора
async function checkRecruitmentStatus() {
    return recruitmentOpen;
}

// Остальной код для кнопок, модальных окон и т.д.
// (все функции из предыдущего ответа остаются без изменений)

// Модальное окно для создания тикета
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket') {
        const isOpen = await checkRecruitmentStatus();
        if (!isOpen) {
            return interaction.reply({ 
                content: '❌ Набор в клан временно закрыт!', 
                ephemeral: true 
            });
        }

        // Проверяем есть ли уже открытый тикет у пользователя
        const existingTicket = tickets.find(t => t.userId === interaction.user.id && t.status === 'open');
        if (existingTicket) {
            return interaction.reply({
                content: `❌ У вас уже есть открытый тикет: <#${existingTicket.channelId}>`,
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('ticket_modal')
            .setTitle('📝 Заявка в RUNA');

        const hoursInput = new TextInputBuilder()
            .setCustomId('hours')
            .setLabel('1. Сколько часов в игре?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 3500')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(10);

        const ageInput = new TextInputBuilder()
            .setCustomId('age')
            .setLabel('2. Сколько вам лет?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 18')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(3);

        const onlineInput = new TextInputBuilder()
            .setCustomId('online')
            .setLabel('3. Часов в день / Часовой пояс')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 8ч / UTC+3')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(30);

        const callInput = new TextInputBuilder()
            .setCustomId('call')
            .setLabel('4. Умение слушать колл (1-10)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: 7')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        const roleInput = new TextInputBuilder()
            .setCustomId('role')
            .setLabel('5. Роль (Комбат/Билдер/Электрик/Фермер)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Пример: Комбат')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(20);

        const firstRow = new ActionRowBuilder().addComponents(hoursInput);
        const secondRow = new ActionRowBuilder().addComponents(ageInput);
        const thirdRow = new ActionRowBuilder().addComponents(onlineInput);
        const fourthRow = new ActionRowBuilder().addComponents(callInput);
        const fifthRow = new ActionRowBuilder().addComponents(roleInput);

        modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);
        await interaction.showModal(modal);
    }

    if (interaction.customId === 'toggle_recruitment') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(CONFIG.STAFF_ROLE)) {
            return interaction.reply({ 
                content: '❌ У вас нет прав для этого действия!', 
                ephemeral: true 
            });
        }

        await toggleRecruitment(interaction);
    }

    if (interaction.customId === 'refresh_status') {
        const status = recruitmentOpen ? '🔓 ОТКРЫТ' : '🔒 ЗАКРЫТ';
        const embed = new EmbedBuilder()
            .setTitle('📊 Статус клана RUNA')
            .setDescription('Актуальная информация о клане')
            .setColor(recruitmentOpen ? '#00FF00' : '#FF0000')
            .addFields(
                { name: '🎯 Набор в клан', value: `**${status}**`, inline: false },
                { name: '📋 Требования:', value: `• Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\n• Минимальный возраст: ${CONFIG.MIN_AGE} лет\n• Онлайн в день: от ${CONFIG.MIN_ONLINE} часов`, inline: false },
                { name: '👥 Активных тикетов', value: `${tickets.filter(t => t.status === 'open').size}`, inline: true },
                { name: '📝 Всего тикетов', value: `${tickets.size}`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'RUNA Clan • 2026' });

        await interaction.update({ embeds: [embed] });
    }

    // Кнопки управления тикетом
    if (['accept_ticket', 'call_ticket', 'close_ticket', 'delete_ticket'].includes(interaction.customId)) {
        await handleTicketAction(interaction);
    }
});

// Обработка модального окна
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'ticket_modal') return;

    await interaction.deferReply({ ephemeral: true });

    const hours = parseInt(interaction.fields.getTextInputValue('hours'));
    const age = parseInt(interaction.fields.getTextInputValue('age'));
    const online = interaction.fields.getTextInputValue('online');
    const call = parseInt(interaction.fields.getTextInputValue('call'));
    const role = interaction.fields.getTextInputValue('role').toLowerCase();

    // Валидация
    if (hours < CONFIG.MIN_HOURS) {
        return interaction.editReply({
            content: `❌ Автоматическое отклонение! Минимальный онлайн: ${CONFIG.MIN_HOURS} часов. У вас: ${hours} часов.`
        });
    }

    if (age < CONFIG.MIN_AGE) {
        return interaction.editReply({
            content: `❌ Автоматическое отклонение! Минимальный возраст: ${CONFIG.MIN_AGE} лет. У вас: ${age} лет.`
        });
    }

    if (call < 1 || call > 10) {
        return interaction.editReply({
            content: '❌ Оценка умения слушать колл должна быть от 1 до 10!'
        });
    }

    const validRoles = ['комбат', 'билдер', 'электрик', 'фермер'];
    if (!validRoles.includes(role)) {
        return interaction.editReply({
            content: '❌ Неверная роль! Доступные роли: Комбат, Билдер, Электрик, Фермер'
        });
    }

    // Создаем тикет
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
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
                },
                {
                    id: CONFIG.STAFF_ROLE,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
                }
            ]
        });

        // Сохраняем информацию о тикете
        tickets.set(channel.id, {
            userId: interaction.user.id,
            channelId: channel.id,
            status: 'open',
            createdAt: Date.now(),
            data: { hours, age, online, call, role }
        });

        ticketChannels.set(interaction.user.id, channel.id);

        // Создаем embed с анкетой
        const embed = new EmbedBuilder()
            .setTitle('📋 Новая заявка в RUNA')
            .setColor('#00FF00')
            .setDescription(`Заявка от ${interaction.user}`)
            .addFields(
                { name: '👤 Пользователь', value: `${interaction.user} (${interaction.user.id})`, inline: false },
                { name: '⏰ Часов в игре', value: `${hours} ч`, inline: true },
                { name: '📅 Возраст', value: `${age} лет`, inline: true },
                { name: '🕐 Онлайн/Часовой пояс', value: online, inline: false },
                { name: '🎧 Умение слушать колл', value: `${call}/10`, inline: true },
                { name: '⚔️ Роль', value: role.charAt(0).toUpperCase() + role.slice(1), inline: true }
            )
            .setFooter({ text: `Создан: ${new Date().toLocaleString()}` })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('accept_ticket')
                    .setLabel('✅ Принять')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('call_ticket')
                    .setLabel('📞 Вызвать на обзвон')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Закрыть')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('delete_ticket')
                    .setLabel('🗑️ Удалить')
                    .setStyle(ButtonStyle.Danger)
            );

        await channel.send({ 
            content: `<@&${CONFIG.STAFF_ROLE}> | ${interaction.user}`,
            embeds: [embed], 
            components: [row] 
        });

        // Логируем в лог-канал
        if (CONFIG.LOG_CHANNEL) {
            const logChannel = guild.channels.cache.get(CONFIG.LOG_CHANNEL);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📝 Создан новый тикет')
                    .setColor('#FFA500')
                    .addFields(
                        { name: 'Пользователь', value: `${interaction.user}`, inline: true },
                        { name: 'Канал', value: `<#${channel.id}>`, inline: true },
                        { name: 'Время', value: new Date().toLocaleString(), inline: true }
                    )
                    .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] });
            }
        }

        await interaction.editReply({
            content: `✅ Тикет успешно создан! Перейдите в канал: <#${channel.id}>`
        });

    } catch (error) {
        console.error('❌ Ошибка создания тикета:', error);
        await interaction.editReply({
            content: '❌ Произошла ошибка при создании тикета. Попробуйте позже.'
        });
    }
});

// Обработка действий с тикетом
async function handleTicketAction(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const isStaff = member.roles.cache.has(CONFIG.STAFF_ROLE);
    const ticketInfo = tickets.get(interaction.channel.id);
    
    if (!ticketInfo) {
        return interaction.reply({ content: '❌ Это не тикет!', ephemeral: true });
    }

    // Проверка прав
    if (interaction.customId === 'accept_ticket' || interaction.customId === 'call_ticket') {
        if (!isStaff) {
            return interaction.reply({ content: '❌ Только стафф может это делать!', ephemeral: true });
        }
    }

    if (interaction.customId === 'close_ticket') {
        if (!isStaff && interaction.user.id !== ticketInfo.userId) {
            return interaction.reply({ content: '❌ Только создатель тикета или стафф может закрыть тикет!', ephemeral: true });
        }
    }

    if (interaction.customId === 'delete_ticket') {
        if (!isStaff) {
            return interaction.reply({ content: '❌ Только стафф может удалить тикет!', ephemeral: true });
        }
    }

    await interaction.deferReply();

    switch (interaction.customId) {
        case 'accept_ticket': {
            const user = await interaction.guild.members.fetch(ticketInfo.userId);
            await interaction.editReply({
                content: `✅ Тикет принят! ${user} приглашен(а) в клан!`,
                embeds: [],
                components: []
            });
            
            // Удаляем канал через 5 секунд
            setTimeout(async () => {
                await interaction.channel.delete();
                tickets.delete(interaction.channel.id);
                ticketChannels.delete(ticketInfo.userId);
            }, 5000);
            break;
        }

        case 'call_ticket': {
            const user = await interaction.guild.members.fetch(ticketInfo.userId);
            const voiceState = interaction.member.voice;
            
            if (!voiceState.channel) {
                return interaction.editReply({
                    content: '❌ Вы должны быть в голосовом канале для вызова!'
                });
            }

            try {
                await user.voice.setChannel(voiceState.channel);
                await interaction.editReply({
                    content: `📞 ${user} вызван(а) в голосовой канал ${voiceState.channel}!`
                });
            } catch (error) {
                await interaction.editReply({
                    content: '❌ Не удалось переместить пользователя в голосовой канал!'
                });
            }
            break;
        }

        case 'close_ticket': {
            const embed = new EmbedBuilder()
                .setTitle('🔒 Тикет закрыт')
                .setDescription('Тикет был закрыт, но может быть открыт снова.')
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], components: [] });
            
            // Меняем права
            await interaction.channel.permissionOverwrites.edit(ticketInfo.userId, {
                ViewChannel: false
            });
            
            tickets.set(interaction.channel.id, { ...ticketInfo, status: 'closed' });
            break;
        }

        case 'delete_ticket': {
            await interaction.editReply({
                content: '🗑️ Тикет будет удален через 3 секунды...'
            });
            
            setTimeout(async () => {
                await interaction.channel.delete();
                tickets.delete(interaction.channel.id);
                ticketChannels.delete(ticketInfo.userId);
            }, 3000);
            break;
        }
    }
}

// Обработка ошибок
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Запуск бота
client.login(process.env.DISCORD_TOKEN);
