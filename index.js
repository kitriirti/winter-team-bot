const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, Collection } = require('discord.js');
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

// Конфигурация
const CONFIG = {
    MIN_HOURS: 3000,
    MIN_AGE: 15,
    MIN_ONLINE: 6,
    TICKET_CATEGORY: process.env.TICKET_CATEGORY_ID,
    STAFF_ROLE: process.env.STAFF_ROLE_ID,
    LOG_CHANNEL: process.env.LOG_CHANNEL_ID,
    GUILD_ID: process.env.GUILD_ID
};

// Хранилище тикетов
const tickets = new Collection();
const ticketChannels = new Collection();

client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) {
        console.error('❌ Сервер не найден!');
        return;
    }

    // Создаем канал для тикетов если его нет
    let ticketChannel = guild.channels.cache.find(ch => ch.name === '🎫-tickets');
    if (!ticketChannel) {
        try {
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
            console.log('📝 Канал для тикетов создан');
        } catch (error) {
            console.error('❌ Ошибка создания канала:', error);
            return;
        }
    }

    // Создаем кнопки управления
    await createTicketPanel(ticketChannel);
    
    // Устанавливаем статус
    client.user.setPresence({
        activities: [{ name: 'RUNA | /ticket', type: 3 }],
        status: 'online'
    });

    console.log('🎫 Бот готов к работе!');
});

async function createTicketPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🎫 Создание тикета в клан RUNA')
        .setDescription('Нажмите кнопку ниже, чтобы подать заявку на вступление в клан.')
        .setColor('#FF6B00')
        .addFields(
            { name: '📋 Требования:', value: `• Минимальный онлайн: ${CONFIG.MIN_HOURS} часов\n• Минимальный возраст: ${CONFIG.MIN_AGE} лет\n• Онлайн в день: от ${CONFIG.MIN_ONLINE} часов`, inline: false },
            { name: '📌 Важно:', value: 'Заполните все поля анкеты. Неверные данные приведут к автоматическому отклонению.', inline: false }
        )
        .setFooter({ text: 'RUNA Clan • 2026' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('📩 Подать заявку')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('toggle_recruitment')
                .setLabel('🔓 Открыть/Закрыть набор')
                .setStyle(ButtonStyle.Secondary)
        );

    // Очищаем старые сообщения
    const messages = await channel.messages.fetch({ limit: 10 });
    for (const msg of messages.values()) {
        if (msg.author.id === client.user.id) {
            await msg.delete();
        }
    }

    await channel.send({ embeds: [embed], components: [row] });
    console.log('📋 Панель тикетов обновлена');
}

// Модальное окно для создания тикета
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket') {
        // Проверяем открыт ли набор
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
    const category = guild.channels.cache.get(CONFIG.TICKET_CATEGORY);
    
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

// Функции управления набором
let recruitmentOpen = true;

async function checkRecruitmentStatus() {
    return recruitmentOpen;
}

async function toggleRecruitment(interaction) {
    recruitmentOpen = !recruitmentOpen;
    const status = recruitmentOpen ? '🔓 ОТКРЫТ' : '🔒 ЗАКРЫТ';
    
    await interaction.reply({
        content: `✅ Набор в клан теперь ${status}!`,
        ephemeral: true
    });

    // Обновляем панель
    const guild = interaction.guild;
    const ticketChannel = guild.channels.cache.find(ch => ch.name === '🎫-tickets');
    if (ticketChannel) {
        await createTicketPanel(ticketChannel);
    }
}

// Обработка ошибок
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Запуск бота
client.login(process.env.DISCORD_TOKEN);
