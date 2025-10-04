const Discord = require('discord.js');
const { loadData, saveData, getGroupedParticipants } = require('./data_handler');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

// --- SECRETS & CONFIG ---
const API_PORT = 3000;
const API_KEY = process.env.API_KEY; 
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; 
const REFEREE_ROLE_ID = process.env.REFEREE_ROLE_ID; 
const PARTICIPANT_ROLE_NAME = 'PARTICIPANT EP3'; 
const REGIONS = ['USW', 'USE', 'SA', 'EU', 'INDIA', 'AU', 'ASIA']; 

// Emojis for decoration
const EM_PINK_DASH = '<:Pinkdash:1423662183602196520>';
const EM_YELLOW_DOT = '<:Yellowdot:1423662113343148112>'; 
const EM_CROWN = '<:Crown:1423662295686320279>'; 
const EM_TROPHY = '🏆';


// --- DISCORD SETUP ---
const client = new Discord.Client({ 
    intents: [
        Discord.GatewayIntentBits.Guilds, 
        Discord.GatewayIntentBits.GuildMessages, 
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.GuildMembers 
    ] 
});

// 💡 Load data and initialize tracking structures
let loadedData = loadData();
let botConfig = loadedData.config || { lobbyChannelId: null, participantRoleId: null, resultsChannelId: null }; 
let activeLobbies = loadedData.activeLobbies || {}; 
let matchLobbyHistory = loadedData.matchLobbyHistory || []; // UNIFIED LOBBY HISTORY
let matchResults = loadedData.matchResults || []; 

// Helper function to generate a new unique numeric ID
function getNextMatchId(history) {
    if (!Array.isArray(history) || history.length === 0) return 1;
    // Find the highest existing matchId and increment it
    const maxId = history.reduce((max, lobby) => Math.max(max, lobby.matchId || 0), 0);
    return maxId + 1;
}

// --- EXPRESS API SETUP ---
const app = express();
app.use(bodyParser.json());
app.use(express.static('website')); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'website', 'spin_wheel.html'));
});

// --- CORE LOGIC: ROLE ASSIGNMENT (Helper) ---
async function assignParticipantRole(guild, userId) {
    if (!botConfig.participantRoleId) return;

    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            await member.roles.add(botConfig.participantRoleId);
        }
    } catch (e) {
        console.error(`Error assigning role to user ${userId}:`, e.message);
    }
}

// --- CORE LOGIC: MAP ASSIGNMENT FUNCTION ---
async function processMapAssignment(mapName, lobbyId) {
    
    if (!botConfig.lobbyChannelId) {
         throw new Error('Lobby channel not set. Run /setup first.');
    }

    // Find lobby by its new unified matchId
    const lobby = matchLobbyHistory.find(l => l.matchId === parseInt(lobbyId));
    if (!lobby) {
        throw new Error('Lobby ID not found in history.');
    }

    lobby.map = mapName;
    lobby.mapAssignedTimestamp = new Date().toISOString();

    const lobbyChannel = await client.channels.fetch(botConfig.lobbyChannelId);
    const lobbyMessage = await lobbyChannel.messages.fetch(lobby.messageId).catch(() => null);

    if (lobbyMessage) {
        let content = lobbyMessage.content;
        const mapRegex = /🗺️ Map:\s\*\*(.*?)\*\*/;

        if (content.match(mapRegex)) {
            content = content.replace(mapRegex, `🗺️ Map: **${mapName}**`);
        } else {
            const titleEndIndex = content.indexOf('**Players (');
            if (titleEndIndex !== -1) {
                const titlePart = content.substring(0, titleEndIndex);
                const playersPart = content.substring(titleEndIndex);
                
                content = `${titlePart}\n🗺️ Map: **${mapName}**\n${playersPart}`;
            } else {
                content += `\n🗺️ Map: **${mapName}**`;
            }
        }
        
        await lobbyMessage.edit(content);
    }
    
    const botData = loadData();
    botData.matchLobbyHistory = matchLobbyHistory;
    saveData(botData); 

    return { 
        message: 'Map assigned and lobby message updated.',
        map: mapName,
        lobby: lobby.name
    };
}


/**
 * Core logic for assigning winners to lobbies (Spin Result).
 */
async function processWinnerAndLobbyUpdate(winnerIGN, currentRegion, namesRemaining) {
    
    if (!botConfig.lobbyChannelId) {
         throw new Error('Lobby channel not set. Run /setup first.');
    }

    const botData = loadData();
    const winnerRegistration = botData.registrations.find(r => r.ign === winnerIGN);
    const winnerId = winnerRegistration ? winnerRegistration.userId : null;
    const winnerPing = winnerId ? `<@${winnerId}>` : `**${winnerIGN}**`;
    
    const winnerMemberData = winnerRegistration ? 
        { userId: winnerRegistration.userId, ign: winnerRegistration.ign, region: currentRegion } : 
        { userId: null, ign: winnerIGN, region: currentRegion };

    botData.spinLogs.push({ winnerIGN, currentRegion, timestamp: new Date().toISOString() });
    
    const lobbyChannel = await client.channels.fetch(botConfig.lobbyChannelId);

    let lobbyState = activeLobbies[currentRegion] || { 
        lobbyNum: 1, 
        winners: [], 
        winnerData: [] 
    };
    
    let messageToEditId = lobbyState.messageId;
    
    // --- LOBBY ROLLOVER CHECK (Happens BEFORE adding the new winner) ---
    if (lobbyState.winners.length === 8) {
        // 1. Log the currently full lobby to history
        const fullLobbyData = {
            matchId: getNextMatchId(matchLobbyHistory), // NEW: Unified Match ID
            name: `R1 | ${currentRegion} Lobby #${lobbyState.lobbyNum}`, // NEW: Display Name
            region: currentRegion,
            lobbyNum: lobbyState.lobbyNum,
            players: lobbyState.winnerData,
            messageId: lobbyState.messageId,
            map: null,
            round: 1, // Initial lobbies are always Round 1
            type: 'spin'
        };
        matchLobbyHistory.push(fullLobbyData); // ADDED TO UNIFIED HISTORY
        
        // 2. Update the old lobby's message to reflect it's full status
        if (lobbyState.messageId) {
             const oldMessage = await lobbyChannel.messages.fetch(lobbyState.messageId).catch(() => null);
             if (oldMessage) {
                 const oldTitle = oldMessage.content.split('\n')[0].replace(/\*\*/g, '');
                 const newContent = oldMessage.content.split('\n').slice(1).join('\n');
                 await oldMessage.edit(`🟢 LOBBY FULL (${oldTitle})\n${newContent}`);
             }
        }
        
        // 3. Reset state for the new lobby
        lobbyState.lobbyNum++;
        lobbyState.winners = [];
        lobbyState.winnerData = []; 
        delete lobbyState.messageId; 
        messageToEditId = null; // Forces a new message to be sent below
    }
    
    // --- ADD NEW WINNER (Always happens here) ---
    lobbyState.winners.push(winnerPing);
    lobbyState.winnerData.push(winnerMemberData);
    
    const currentCount = lobbyState.winners.length;
    
    // --- FINAL LOBBY CHECK: SAVE THE LAST LOBBY IF THE LIST IS EXHAUSTED (FIX) ---
    if (currentCount === 8 && namesRemaining === 0) {
         // This is the last lobby, save it immediately
         const finalLobbyData = {
            matchId: getNextMatchId(matchLobbyHistory), // Get the ID
            name: `R1 | ${currentRegion} Lobby #${lobbyState.lobbyNum}`,
            region: currentRegion,
            lobbyNum: lobbyState.lobbyNum,
            players: lobbyState.winnerData,
            messageId: lobbyState.messageId, // The ID of the message we are about to update
            map: null,
            round: 1, 
            type: 'spin'
        };
        matchLobbyHistory.push(finalLobbyData); // Save the last lobby
        
        // Save data immediately so the final lobby is available for map spin
        const data = loadData();
        data.matchLobbyHistory = matchLobbyHistory;
        saveData(data); 

        // The message will be updated below with the "LOBBY FULL" tag.
    }
    // -----------------------------------------------------------------------------

    if (winnerId) {
        await assignParticipantRole(lobbyChannel.guild, winnerId);
    }

    let title = `${currentRegion}, Lobby ${lobbyState.lobbyNum}`;
    
    if (currentCount === 8) {
        title = `🟢 LOBBY FULL (${currentRegion}, Lobby ${lobbyState.lobbyNum})`;
    } else if (namesRemaining === 0) {
        title = `🔴 INCOMPLETE LOBBY (${currentRegion}, Lobby ${lobbyState.lobbyNum})`;
    }
    
    let content = `**Players (${currentCount}/8):**\n`;
    content += lobbyState.winners.map(p => `${EM_PINK_DASH} ${p}`).join('\n');
    
    try {
        let lobbyMessage;
        if (messageToEditId) {
            lobbyMessage = await lobbyChannel.messages.fetch(messageToEditId).catch(() => null);
        }

        if (lobbyMessage) {
            await lobbyMessage.edit(`**${title}**\n${content}`);
            // messageId remains the same if we edited
        } else {
            // New lobby message created here
            lobbyMessage = await lobbyChannel.send(`**${title}**\n${content}`);
            lobbyState.messageId = lobbyMessage.id; 
        }

        activeLobbies[currentRegion] = lobbyState; 
        
        botData.activeLobbies = activeLobbies;
        botData.matchLobbyHistory = matchLobbyHistory; 
        saveData(botData); 
        
        return { 
            message: 'Winner announced and lobby updated.',
            lobbyNum: lobbyState.lobbyNum 
        };

    } catch (e) {
        console.error(`Error creating/editing lobby message: ${e.message}`, e);
        throw new Error('Failed to update Discord lobby.');
    }
}

// --- EXPRESS API ENDPOINTS ---

// NEW ENDPOINT: Get grouped participant names (REGION 1/REGION 2)
app.get('/api/names/grouped', (req, res) => {
    try {
        const groups = getGroupedParticipants();
        return res.json({ groups });
    } catch (e) {
        console.error('Error fetching grouped participants:', e);
        return res.status(500).json({ error: 'Failed to retrieve grouped participants data.' });
    }
});

// Get list of participant IGNs for a specific Discord region
app.get('/api/names/:region', (req, res) => {
    const { region } = req.params;
    
    const botData = loadData(); 
    
    const names = botData.registrations
        .filter(r => r.region.toUpperCase() === region.toUpperCase())
        .map(r => r.ign);

    return res.json({ names });
});

// Log the spin result (Player assignment) and update Discord lobby
app.post('/api/spin_result', async (req, res) => {
    const { winnerIGN, currentRegion, namesRemaining } = req.body;
    
    if (!winnerIGN || !currentRegion) {
        return res.status(400).json({ error: 'Missing winnerIGN or region.' });
    }
    
    try {
        const result = await processWinnerAndLobbyUpdate(winnerIGN, currentRegion, namesRemaining);
        return res.json(result); 
    } catch (e) {
        console.error('Spin Result Error:', e);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/winner', async (req, res) => {
    return res.status(501).json({ error: 'This endpoint is unused. Use /api/spin_result for player assignment or the Discord command /winner for match results.' });
});

// Get list of completed, unmapped lobbies for the map spin dropdown
app.get('/api/lobbies/unmapped', (req, res) => {
    const botData = loadData(); 
    
    // FINAL FIX: Robustly filter matchLobbyHistory to show all eligible R1 lobbies
    const unmappedLobbies = botData.matchLobbyHistory
        .filter(lobby => 
             lobby.type === 'spin' && 
             (lobby.map === null || lobby.map === undefined) && 
             Array.isArray(lobby.players) && lobby.players.length === 8 
        )
        .map(lobby => ({
            id: lobby.matchId.toString(), // Use unified matchId
            name: lobby.name 
        }));

    // Ensure we return an array under 'lobbies' key
    return res.json({ lobbies: unmappedLobbies || [] });
});

// Log the map spin result and update the Discord lobby message
app.post('/api/map/winner', async (req, res) => {
    
    // --- API Key Check ---
    if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key.' });
    }
    
    const { mapName, lobbyId } = req.body;
    
    if (!mapName || !lobbyId) {
        return res.status(400).json({ error: 'Missing mapName or lobbyId.' });
    }
    
    try {
        const result = await processMapAssignment(mapName, lobbyId);
        return res.json(result); 
    } catch (e) {
        console.error('Map Assignment Error:', e);
        return res.status(500).json({ error: e.message });
    }
});


// --- CORE LOGIC: PROCESS WINNER (Centralized Function for R1 and Bracket) ---
async function processMatchWinner(interaction, matchIdString) {
    await interaction.deferReply({ ephemeral: false });
    const guild = interaction.guild;
    const matchId = parseInt(matchIdString);

    const winners = [
        interaction.options.getUser('winner1'),
        interaction.options.getUser('winner2'),
        interaction.options.getUser('winner3'),
        interaction.options.getUser('winner4'),
        interaction.options.getUser('winner5'),
    ].filter(u => u); 
    
    if (winners.length === 0) {
        return interaction.editReply({ content: "❌ You must specify at least one winner." });
    }
    
    // Find lobby by single numeric matchId
    const lobby = matchLobbyHistory.find(l => l.matchId === matchId);

    if (!lobby) {
        console.error(`Lobby lookup failed for numeric ID: ${matchId}`);
        return interaction.editReply({ content: "❌ Lobby not found. Please select an available lobby from the dropdown." });
    }
    
    const round = lobby.round || 1;
    const lobbyMap = lobby.map || 'N/A (Merged Lobbies)';

    const winnerData = winners.map((user, index) => ({
        rank: index + 1,
        userId: user.id,
        username: user.tag,
        ign: lobby.players.find(p => p.userId === user.id)?.ign || 'N/A', 
        lobbyNum: lobby.lobbyNum || lobby.matchId, 
        round: round
    }));
    
    // 1. Log the results
    const resultId = matchIdString; 
    const resultIndex = matchResults.findIndex(r => r.id === resultId);
    const resultEntry = {
        id: resultId,
        name: lobby.name, 
        region: lobby.region || 'MERGED', 
        lobbyNum: lobby.lobbyNum || lobby.matchId,
        count: winnerData.length,
        map: lobbyMap,
        winners: winnerData,
        timestamp: new Date().toISOString(),
        round: round
    };

    if (resultIndex !== -1) {
        matchResults[resultIndex] = resultEntry; 
    } else {
        matchResults.push(resultEntry);
    }
    
    // 2. Format result message for public channel
    const lobbyThreadName = `${lobby.name}`;
    const winnerPings = winnerData.map(w => `<@${w.userId}>`).join('\n'); 
    
    const publicResultMessage = `
__**${lobbyThreadName}**__
**Map:** ${lobbyMap}

${EM_CROWN} ${winnerPings}
Topped the lobby **${lobby.name}** in **Round ${round}**
    `.trim();
    
    // 3. Post to results channel
    if (botConfig.resultsChannelId) {
        try {
            const resultsChannel = await client.channels.fetch(botConfig.resultsChannelId);
            await resultsChannel.send(publicResultMessage);
        } catch (error) {
            console.error("Error sending results message:", error);
        }
    }
    
    // 4. Save Data
    const botData = loadData();
    botData.matchResults = matchResults;
    saveData(botData);

    // 5. Confirmation Message
    const winnerList = winnerData.map(w => `${EM_PINK_DASH} <@${w.userId}> (**${w.ign}**) - Top ${w.rank}`).join('\n');
    
    interaction.editReply({
        content: `✅ Match winners logged for **${lobby.name}** (Top ${winnerData.length}). Results posted to <#${botConfig.resultsChannelId || 'N/A'}>.\n\nWinners:\n${winnerList}`,
        ephemeral: false 
    });
}


// --- DISCORD COMMANDS (Logic) ---

client.on(Discord.Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const guild = interaction.guild;
    
    // --- /list_registrations COMMAND (NEW) ---
    if (interaction.commandName === 'list_registrations') {
        await interaction.deferReply({ ephemeral: false });
        
        const botData = loadData();
        const registrations = botData.registrations;
        
        const region1_names = ['USW', 'USE', 'SA', 'EU'];
        
        const grouped = registrations.reduce((acc, reg) => {
            // Determine if the registration's region (normalized) is in Region 1 group
            const regionUpper = reg.region.toUpperCase().replace(/\s/g, ''); 
            const groupName = region1_names.includes(regionUpper) ? 'REGION 1' : 'REGION 2';

            acc[groupName] = acc[groupName] || [];
            acc[groupName].push(reg);
            return acc;
        }, {});
        
        const totalParticipants = registrations.length;
        
        const embed = new Discord.EmbedBuilder()
            .setColor(0xFFA500) // Orange/Gold color
            .setTitle(`${EM_CROWN} Tournament Registrations`)
            .setDescription(`Total Registered Participants: **${totalParticipants}**`);
        
        let regionalSummary = '';

        for (const groupName of ['REGION 1', 'REGION 2']) {
            const participants = grouped[groupName] || [];
            const list = participants.map(reg => 
                `${EM_YELLOW_DOT} <@${reg.userId}> (IGN: **${reg.ign}**)`
            ).join('\n');
            
            // Add a field for each region
            embed.addFields({
                name: `__${groupName} (${participants.length})__`,
                // FIX: Ensure value is a string, not empty
                value: list.substring(0, 1024) || "No registered participants.",
                inline: false
            });
            
            regionalSummary += `**${groupName}**: ${participants.length}\n`;
        }

        embed.addFields({
            name: `\u200B`, // Zero width space for separation
            value: `**TOTAL REGION BREAKDOWN**\n${regionalSummary}`,
            inline: false
        });

        await interaction.editReply({ embeds: [embed] });
        return;
    }


    // --- /setup COMMAND (Remains the same) ---
    if (interaction.commandName === 'setup') { 
        if (!interaction.member.permissions.has(Discord.PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "You need administrator permission to run this command.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. Create Category and Channels
            const category = await guild.channels.create({
                name: 'TOURNAMENT',
                type: Discord.ChannelType.GuildCategory,
            });
            const lobbiesChannel = await guild.channels.create({
                name: 'lobbies',
                type: Discord.ChannelType.GuildText,
                parent: category.id,
            });
            const resultsChannel = await guild.channels.create({ 
                name: 'results',
                type: Discord.ChannelType.GuildText,
                parent: category.id,
            });

            // 2. Create Participant Role
            let participantRole = guild.roles.cache.find(role => role.name === PARTICIPANT_ROLE_NAME);
            if (!participantRole) {
                participantRole = await guild.roles.create({
                    name: PARTICIPANT_ROLE_NAME,
                    color: '#FFD700', 
                    reason: 'Role for tournament participants.',
                });
            }

            // 3. Save Config
            botConfig.lobbyChannelId = lobbiesChannel.id;
            botConfig.resultsChannelId = resultsChannel.id;
            botConfig.participantRoleId = participantRole.id;
            
            let data = loadData();
            data.config = botConfig;
            data.activeLobbies = activeLobbies; 
            data.matchResults = matchResults; 
            saveData(data);

            await interaction.editReply(`✅ Setup complete! Created category **TOURNAMENT**, channels, and the **@${PARTICIPANT_ROLE_NAME}** role. Round reset to **Round 1**.`);

        } catch (error) {
            console.error("Error during setup:", error);
            await interaction.editReply("❌ Setup failed! Check bot permissions (Manage Channels/Roles).");
        }
    }
    
    // --- /manual_register COMMAND (Remains the same) ---
    if (interaction.commandName === 'manual_register') {
        if (!interaction.member.permissions.has(Discord.PermissionsBitField.Flags.KickMembers)) {
            return interaction.reply({ content: "You need permission to manually register users.", ephemeral: true });
        }
        
        const user = interaction.options.getUser('user');
        const ign = interaction.options.getString('ign');
        const region = interaction.options.getString('region');
        
        const userId = user.id;
        const username = user.tag;
        
        let botData = loadData();
        const existingIndex = botData.registrations.findIndex(r => r.userId === userId);
        const registrationData = { userId, username, ign, region };

        if (existingIndex !== -1) {
            botData.registrations[existingIndex] = registrationData;
        } else {
            botData.registrations.push(registrationData);
        }
        
        await assignParticipantRole(guild, userId);
        
        saveData(botData);

        interaction.reply({ content: `✅ Manual registration updated for ${user.tag}! IGN: **${ign}**, Region: **${region}**`, ephemeral: true });
    }

    // --- /thread COMMAND (Dropdown setup) ---
    if (interaction.commandName === 'thread') {
        if (!botConfig.lobbyChannelId) {
            return interaction.reply({ content: "Lobby channel not set. Run `/setup` first.", ephemeral: true });
        }
        
        // This command now targets R1 spin lobbies from the unified history that need threads
        const unthreadedLobbies = matchLobbyHistory.filter(lobby => lobby.type === 'spin' && !lobby.threadId && lobby.map);
        
        if (unthreadedLobbies.length === 0) {
             return interaction.reply({ content: "No completed, mapped R1 lobbies found that are ready for a thread.", ephemeral: true });
        }
        
        const options = unthreadedLobbies.map(lobby => ({
            label: lobby.name,
            description: `Players: ${lobby.players.length}`,
            value: lobby.matchId.toString() 
        }));
        
        const row = new Discord.ActionRowBuilder().addComponents(
            new Discord.StringSelectMenuBuilder()
                .setCustomId('select_lobby_thread')
                .setPlaceholder('Select a lobby to create a thread for...')
                .addOptions(options)
        );
        
        await interaction.reply({
            content: 'Select the completed lobby you wish to create a discussion thread for:',
            components: [row],
            ephemeral: true
        });
    }

    // --- /winner COMMAND (Unified) ---
    if (interaction.commandName === 'winner') {
        await interaction.deferReply({ ephemeral: false });
        const lobbyIdentifier = interaction.options.getString('lobby');
        return processMatchWinner(interaction, lobbyIdentifier); 
    }
    
    // --- /merge_lobby_threads COMMAND (Remains the same) ---
    if (interaction.commandName === 'merge_lobby_threads') {
        if (!interaction.member.permissions.has(Discord.PermissionsBitField.Flags.KickMembers)) {
            return interaction.reply({ content: "You need staff permission to run this command.", ephemeral: true });
        }
        
        await interaction.deferReply({ ephemeral: true });

        if (!botConfig.lobbyChannelId) {
            return interaction.editReply({ content: "Lobby channel not set. Run `/setup` first." });
        }
        
        const nextRound = interaction.options.getInteger('round_number');
        const resultId1 = interaction.options.getString('lobby_result_1');
        const resultId2 = interaction.options.getString('lobby_result_2');
        
        if (nextRound <= 1) {
             return interaction.editReply({ content: "❌ The new round number must be 2 or greater." });
        }

        // Find results based on ID (which is the numeric matchId as a string)
        const result1 = matchResults.find(r => r.id === resultId1);
        const result2 = matchResults.find(r => r.id === resultId2);
        
        if (!result1 || !result2) {
            return interaction.editReply({ content: "❌ Could not find one or both lobby results. Please choose from the autocomplete list." });
        }
        
        const lobbyChannel = await client.channels.fetch(botConfig.lobbyChannelId);
        
        // --- 1. DETERMINE NEW LOBBY NUMBER ---
        const roundKey = nextRound.toString();
        
        // The new lobby ID is just the next global numeric ID
        const newMatchId = getNextMatchId(matchLobbyHistory);
        const newLobbyNum = matchLobbyHistory.filter(l => l.round === nextRound).length + 1; // LobbyNum relative to the new round
        
        // --- 2. COMPILE PLAYERS AND CREATE LOBBY MESSAGE ---
        
        // Combine winners from the two results
        const allWinners = [
            ...result1.winners.map(w => ({ 
                userId: w.userId, 
                ign: w.ign, 
                region: w.region, 
                origin: `R${result1.round} L#${result1.lobbyNum} ${result1.region}`
            })), 
            ...result2.winners.map(w => ({ 
                userId: w.userId, 
                ign: w.ign, 
                region: w.region,
                origin: `R${result2.round} L#${result2.lobbyNum} ${result2.region}`
            }))
        ];
        
        // Updated title for better branding
        const mergedLobbyTitle = `R${nextRound} | LOBBY #${newLobbyNum}`;
        
        // --- PUBLIC LOBBIES MESSAGE (SIMPLIFIED and DECORATED) ---
        // Players are now listed one per line in the public message
        const playerMentions = allWinners.map(w => `${EM_YELLOW_DOT} <@${w.userId}>`).join('\n'); 
        
        const lobbyMessageContent = `
**${mergedLobbyTitle}**
${EM_CROWN} **Match Participants (${allWinners.length} total):**
${playerMentions}
        `.trim();
        
        // --- PRIVATE THREAD CONTENT (DETAILED) ---
        const threadMessageContent = `
**LOBBY Match!** ${EM_TROPHY}
**Round:** **${nextRound}** | **Lobby:** **#${newLobbyNum}**

**Matchup:** R${result1.round} L#${result1.lobbyNum} vs R${result2.round} L#${result2.lobbyNum}

**Qualified Players (${allWinners.length} total):**
${allWinners.map(w => `${EM_PINK_DASH} <@${w.userId}> (**${w.ign}**) - Origin: ${w.origin}`).join('\n')}

**Referee:** ${REFEREE_ROLE_ID ? `<@&${REFEREE_ROLE_ID}>` : '**[REFEREE ROLE NOT SET]**'}

Please coordinate your next match here.
        `;
        
        try {
            // Post the new lobby message to the public channel (Step 1)
            const newLobbyMessage = await lobbyChannel.send(lobbyMessageContent);
            
            // --- 3. CREATE THREAD (Private Thread - INDEPENDENTLY of the message) ---
            const thread = await lobbyChannel.threads.create({
                name: mergedLobbyTitle,
                autoArchiveDuration: 60,
                type: Discord.ChannelType.PrivateThread, 
                reason: `Lobby Match Thread for Round ${nextRound}`,
                // We do NOT use startMessage or message attachment here.
            });

            // Send the detailed welcome message as the very first post
            // The thread will NOT be publicly attached.
            await thread.send(threadMessageContent);

            // Add users to the thread
            const allUserIds = allWinners.map(w => w.userId).filter(id => id);
            for (const userId of allUserIds) {
                try {
                    const member = await guild.members.fetch(userId);
                    if (member) {
                        await thread.members.add(userId);
                    }
                } catch (e) {
                    console.warn(`Could not add user ${userId} to private thread:`, e.message);
                }
            }
            
            // --- 4. LOG DATA ---
            const mergedLobbyData = {
                matchId: newMatchId, // NEW: Use unified Match ID
                id: newMatchId.toString(), // Use string matchId as the primary key for result lookup
                name: mergedLobbyTitle, // NEW: Use descriptive name
                round: nextRound,
                lobbyNum: newLobbyNum,
                players: allWinners,
                messageId: newLobbyMessage.id,
                threadId: thread.id,
                sourceResults: [result1.id, result2.id],
                type: 'merged'
            };
            
            matchLobbyHistory.push(mergedLobbyData); // Add to the unified history
            
            const botData = loadData();
            botData.matchLobbyHistory = matchLobbyHistory;
            saveData(botData);

            // FINAL FIX: Send confirmation message as EPHEMERAL to the staff user.
            // This is the cleanest fix for detachment.
            return interaction.editReply({ 
                content: `✅ **Round ${nextRound} Lobby #${newLobbyNum}** successfully created and merged! Private thread: <#${thread.id}>`, 
                ephemeral: true 
            });

        } catch (error) {
            console.error("Error creating merged thread/lobby:", error);
            await interaction.editReply({ content: `❌ Failed to create merged lobby and thread. Check bot permissions (Manage Threads/Send Messages). Error: ${error.message}` });
        }
    }
});


// --- AUTOC0MPLETE HANDLER (UNIFIED LOOKUP) ---
client.on(Discord.Events.InteractionCreate, async interaction => {
    if (!interaction.isAutocomplete()) return;

    const botData = loadData();
    const focusedOption = interaction.options.getFocused(true);

    // --- Autocomplete for /winner (UNIFIED) ---
    if (interaction.commandName === 'winner') {
        if (focusedOption.name === 'lobby') {
            
            // Filter: All lobbies that have not yet had results reported
            const availableLobbies = botData.matchLobbyHistory
                .filter(l => !botData.matchResults.some(r => r.id === l.matchId.toString()))
                .map(l => ({
                    // Name is the display name
                    name: l.name + (l.map ? ` (Map: ${l.map})` : ''),
                    // Value is the guaranteed unique numeric matchId (as a string)
                    value: l.matchId.toString() 
                }));
            
            // Filter based on user input
            const filtered = availableLobbies.filter(choice => 
                choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
            );

            // Respond with the filtered list, capped at Discord's 25-choice limit
            await interaction.respond(filtered.slice(0, 25));
        }
    } 
    
    // --- Autocomplete handler for /merge_lobby_threads (Remains the same) ---
    if (interaction.commandName === 'merge_lobby_threads') {
        
        if (focusedOption.name === 'lobby_result_1' || focusedOption.name === 'lobby_result_2') {
            
            // 1. Generate options based on ALL reported match results
            const availableResults = botData.matchResults.map(r => ({
                name: `${r.name} - R${r.round}`,
                value: r.id // r.id is the MatchId as a string
            }));

            // 2. Filter based on user input
            const filtered = availableResults.filter(choice => 
                choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
            );

            await interaction.respond(filtered.slice(0, 25));
        }
    }
});


// --- SELECT MENU HANDLER (for /thread command execution) ---
client.on(Discord.Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'select_lobby_thread') return;
    
    await interaction.deferReply({ ephemeral: false });

    const lobbyId = parseInt(interaction.values[0]);
    // Find lobby by Match ID
    const lobby = matchLobbyHistory.find(l => l.matchId === lobbyId);
    
    if (!lobby) {
        return interaction.editReply({ content: 'Error: Lobby not found in history.', ephemeral: true });
    }
    
    const lobbyChannel = await client.channels.fetch(botConfig.lobbyChannelId);
    
    try {
        // Find the public message to attach the thread to
        const lobbyMessage = await lobbyChannel.messages.fetch(lobby.messageId);

        // --- 1. CREATE THREAD ATTACHED TO THE MESSAGE ---
        const thread = await lobbyMessage.startThread({
            name: lobby.name + (lobby.map ? ` | ${lobby.map}` : ''),
            autoArchiveDuration: 60, 
            type: Discord.ChannelType.PrivateThread, // Threads are Private
            reason: 'Tournament Lobby Thread',
        });
        
        const playerPings = lobby.players
            .map(p => p.userId ? `<@${p.userId}>` : `**${p.ign}**`)
            .join(' ');
            
        const refereePing = REFEREE_ROLE_ID ? `<@&${REFEREE_ROLE_ID}>` : '**[REFEREE ROLE NOT SET]**';
        
        // --- THREAD WELCOME MESSAGE ---
        const welcomeMessage = `
**Welcome to your Lobby Thread!** 🎉
**Match:** **${lobby.name}**
**Map:** **${lobby.map || 'Unmapped'}**

**Players:** ${playerPings}
**Referee:** ${refereePing}

Please use this thread for communication regarding your match, reporting results, and scheduling. Good luck!
        `;
        
        // Send the message *after* the thread is created (Discord copies the parent message content, so we just send the welcome message)
        await thread.send(welcomeMessage);
        
        const usersToAdd = lobby.players.map(p => p.userId).filter(id => id);
        
        for (const userId of usersToAdd) {
            try {
                const member = await interaction.guild.members.fetch(userId); 
                 if (member) {
                     await thread.members.add(userId);
                 }
            } catch (e) {
                console.warn(`Could not add user ${userId} to private thread:`, e.message);
            }
        }
        
        lobby.threadId = thread.id;
        const botData = loadData();
        botData.matchLobbyHistory = matchLobbyHistory;
        saveData(botData);

        await interaction.editReply({ content: `✅ **Private Thread** created successfully! ${thread.toString()}`, ephemeral: false });

    } catch (error) {
        console.error("Error creating lobby thread:", error);
        await interaction.editReply({ content: `❌ Failed to create thread. This usually means the bot is missing **'Manage Threads'** permissions.`, ephemeral: true });
    }
});


// --- REGISTRATION BUTTONS/MODALS ---
client.on(Discord.Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'register_setup') return;

    const row = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder()
            .setCustomId('register_button')
            .setLabel('Click to Register')
            .setStyle(Discord.ButtonStyle.Primary),
    );

    await interaction.reply({
        content: 'Click the button below to register your IGN and Region for the next spin wheel!',
        components: [row],
        ephemeral: false
    });
});

// FIX: Added async keyword to fix SyntaxError on showModal
client.on(Discord.Events.InteractionCreate, async interaction => {
    if (!interaction.isButton() || interaction.customId !== 'register_button') return;

    const modal = new Discord.ModalBuilder()
        .setCustomId('registration_modal')
        .setTitle('Tournament Registration');

    const ignInput = new Discord.TextInputBuilder()
        .setCustomId('ign_input')
        .setLabel("In-Game Name (IGN)")
        .setStyle(Discord.TextInputStyle.Short)
        .setRequired(true);

    const regionInput = new Discord.TextInputBuilder()
        .setCustomId('region_input')
        .setLabel(`Region (${REGIONS.join(', ')})`) 
        .setStyle(Discord.TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new Discord.ActionRowBuilder().addComponents(ignInput),
        new Discord.ActionRowBuilder().addComponents(regionInput)
    );

    await interaction.showModal(modal);
});

client.on(Discord.Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit() || interaction.customId !== 'registration_modal') return;

    const ign = interaction.fields.getTextInputValue('ign_input').trim();
    const region = interaction.fields.getTextInputValue('region_input').toUpperCase().trim();
    const userId = interaction.user.id;
    const username = interaction.user.tag;

    if (!REGIONS.includes(region)) {
        return interaction.reply({ 
            content: `❌ Invalid region entered. Please use one of: ${REGIONS.join(', ')}`, 
            ephemeral: true 
        });
    }

    let botData = loadData();

    const existingIndex = botData.registrations.findIndex(r => r.userId === userId);
    if (existingIndex !== -1) {
        botData.registrations[existingIndex] = { userId, username, ign, region };
    } else {
        botData.registrations.push({ userId, username, ign, region });
    }
    
    await assignParticipantRole(interaction.guild, userId);

    saveData(botData);
    
    interaction.reply({ content: `✅ Registration successful! IGN: **${ign}**, Region: **${region}**`, ephemeral: true });
});


// --- INIT ---

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    const commands = [
        { 
            name: 'setup', 
            description: 'Sets up tournament channels and the participant role.' 
        },
        { 
            name: 'register_setup', 
            description: 'Posts the registration button.' 
        },
        {
            name: 'manual_register',
            description: 'Manually registers a user by ping, IGN, and Region (Staff Only).',
            options: [
                {
                    name: 'user',
                    description: 'The user to register (ping).',
                    type: Discord.ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: 'ign',
                    description: 'The In-Game Name (IGN) of the user.',
                    type: Discord.ApplicationCommandOptionType.String,
                    required: true,
                    choices: REGIONS.map(region => ({ name: region, value: region })),
                },
            ],
        },
        {
            name: 'thread',
            description: 'Creates a dedicated private thread for a completed lobby.',
            options: [
                 {
                    name: 'open',
                    description: 'Run the command to select an available lobby.',
                    type: Discord.ApplicationCommandOptionType.Boolean,
                    required: false,
                 }
            ]
        },
        // NEW COMMAND: List all participants grouped by region
        {
            name: 'list_registrations',
            description: 'Lists all registered participants and regional totals.',
        },
        // RESTORED ORIGINAL /WINNER COMMAND (NOW USES NUMERIC ID)
        {
            name: 'winner',
            description: 'Logs the winners of a completed lobby match.',
            options: [
                {
                    name: 'lobby',
                    description: 'The match lobby ID to report results for.',
                    type: Discord.ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
                { name: 'winner1', description: 'The 1st place winner.', type: Discord.ApplicationCommandOptionType.User, required: true },
                { name: 'winner2', description: 'The 2nd place winner.', type: Discord.ApplicationCommandOptionType.User, required: false },
                { name: 'winner3', description: 'The 3rd place winner.', type: Discord.ApplicationCommandOptionType.User, required: false },
                { name: 'winner4', description: 'The 4th place winner.', type: Discord.ApplicationCommandOptionType.User, required: false },
                { name: 'winner5', description: 'The 5th place winner.', type: Discord.ApplicationCommandOptionType.User, required: false },
            ],
        },
        // /merge_lobby_threads COMMAND
        {
            name: 'merge_lobby_threads',
            description: 'Merges top winners from two results into a new round bracket.',
            options: [
                {
                    name: 'round_number',
                    description: 'The number of the NEW bracket round being created (e.g., 2).',
                    type: Discord.ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 2,
                },
                {
                    name: 'lobby_result_1',
                    description: 'The first match result to merge.',
                    type: Discord.ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true, 
                },
                {
                    name: 'lobby_result_2',
                    description: 'The second match result to merge.',
                    type: Discord.ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true, 
                },
            ],
        },
    ];

    try {
        await client.application.commands.set(commands);
        console.log("Registered slash commands.");
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
    
    app.listen(API_PORT, () => {
        console.log(`API Endpoint running on port ${API_PORT}.`);
    });
});

client.login(DISCORD_TOKEN);
