const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Define the absolute minimum data structure required
const INITIAL_DATA = {
    registrations: [],
    spinLogs: [],
    config: { lobbyChannelId: null, participantRoleId: null, resultsChannelId: null },
    activeLobbies: {},
    matchLobbyHistory: [], // <--- UNIFIED HISTORY KEY ADDED
    matchResults: [] 
};

function loadData() {
    try {
        // 1. Check if the file exists. If not, create it with initial data.
        if (!fs.existsSync(DATA_FILE)) {
            console.log("Data file not found. Creating a fresh data.json file.");
            saveData(INITIAL_DATA);
            return INITIAL_DATA;
        }

        // 2. If file exists, try to read and parse it.
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        const loaded = JSON.parse(data);
        
        // 3. Ensure all keys are present, defaulting to empty if missing (for resilience)
        return {
            registrations: loaded.registrations || INITIAL_DATA.registrations,
            spinLogs: loaded.spinLogs || INITIAL_DATA.spinLogs,
            config: loaded.config || INITIAL_DATA.config,
            activeLobbies: loaded.activeLobbies || INITIAL_DATA.activeLobbies,
            matchLobbyHistory: loaded.matchLobbyHistory || INITIAL_DATA.matchLobbyHistory, // <--- UNIFIED HISTORY KEY RETRIEVED
            matchResults: loaded.matchResults || INITIAL_DATA.matchResults
        };
    } catch (error) {
        // Handle SyntaxError (corruption) by initializing fresh data
        console.error("Error loading or parsing data file (Corrupted). Initializing fresh data structure:", error.message);
        return INITIAL_DATA;
    }
}

function saveData(data) {
    try {
        const jsonContent = JSON.stringify(data, null, 2);
        fs.writeFileSync(DATA_FILE, jsonContent, 'utf8');
    } catch (error) {
        console.error("Error saving data:", error);
    }
}

function getGroupedParticipants() {
    const data = loadData();
    const region1 = ['USW', 'USE', 'SA', 'EU'];
    
    const region1Names = [];
    const region2Names = [];

    data.registrations.forEach(reg => {
        const formattedName = reg.ign;
        if (region1.includes(reg.region)) {
            region1Names.push(formattedName);
        } else {
            region2Names.push(formattedName);
        }
    });

    return {
        'REGION 1': region1Names,
        'REGION 2': region2Names
    };
}

module.exports = {
    loadData,
    saveData,
    getGroupedParticipants
};
