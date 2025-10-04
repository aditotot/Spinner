document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURATION ---
    const MAP_POOL = [
        "Steky' Speedway",
        "The Old Graveyard",
        "Smash Fort",
        "Smash Island",
        "Slick'n Slide",
        "Gravel Pit",
        "Graveyard",
        "Sky Arena Pinball"
    ];
    // NOTE: API_KEY_SECRET MUST USE YOUR ACTUAL KEY HERE!
    const API_KEY_SECRET = "wM2rY8@qJ6g!P$hTf9vE1xDkC4zU7bA5"; 

    // --- GLOBAL STATE ---
    let currentParticipants = []; 
    let currentRegion = null;     
    let isSpinning = false;
    let spinAnimation = null; 
    let rotationAngle = 0; 
    let spinSpeed = 0;     
    const DECELERATION = 0.985; 
    const WINNING_POSITION = 0; 

    let isMapMode = false;
    let availableLobbies = [];
    let selectedLobbyId = null;

    const PIN_IMAGE_FILE = 'center_pin.png'; 
    const PIN_WIDTH_DISPLAY = 160; 
    const CENTER_PIN_RADIUS = 60; 

    const pinImage = new Image();
    pinImage.src = PIN_IMAGE_FILE;
    let imageLoaded = false;

    // --- DOM ELEMENTS ---
    const statusDiv = document.getElementById('status');
    const remainingCountDiv = document.getElementById('remaining-count');
    const namesListUl = document.getElementById('namesList');
    const spinButton = document.getElementById('spinButton');
    const shuffleButton = document.getElementById('shuffleButton');
    const canvas = document.getElementById('wheelCanvas');
    const ctx = canvas.getContext('2d');
    const winnerModal = document.getElementById('winnerModal');
    const lobbySelect = document.getElementById('lobbySelect');
    const mapTargetContainer = document.getElementById('mapTargetContainer');

    // 🛠️ Modal element references
    const modalTitle = document.getElementById('modalTitle'); 
    const modalBody = document.getElementById('modalBody'); 

    // --- MANUAL CONTROLS ---
    const loadManualButton = document.getElementById('loadManual');
    const manualDataTextarea = document.getElementById('manualData');
    const resetButton = document.getElementById('resetButton');
    const closeModalButton = document.getElementById('closeModal');

    // 🚀 HIGH-RESOLUTION FIX: Set canvas internal resolution higher
    const ratio = window.devicePixelRatio || 1;
    const size = 500; 

    canvas.width = size * ratio;
    canvas.height = size * ratio;
    ctx.scale(ratio, ratio);

    const centerX = size / 2, centerY = size / 2, radius = 240;

    pinImage.onload = () => {
        imageLoaded = true;
        drawWheelPlaceholder(currentParticipants); 
    };

    // --- VISUAL & ANIMATION (Remains the same) ---
    function drawWheelPlaceholder(names) {
        ctx.clearRect(0, 0, size, size); 

        if (names.length === 0) {
            ctx.fillStyle = '#FF4500';
            ctx.fillRect(0, 0, size, size); 
            ctx.fillStyle = 'white';
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("NO PLAYERS LOADED", centerX, centerY);
        } else {
            const arc = (2 * Math.PI) / names.length;
            const colors = ['#00BFFF', '#FFD700', '#32CD32', '#FF6347', '#9370DB', '#FFA07A', '#4682B4', '#DA70D6'];

            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(rotationAngle); 

            names.forEach((name, i) => {
                const angle = i * arc;
                ctx.beginPath();
                ctx.arc(0, 0, radius, angle, angle + arc);
                ctx.lineTo(0, 0);
                ctx.fillStyle = colors[i % colors.length];
                ctx.fill();

                ctx.save();
                ctx.rotate(angle + arc / 2);
                ctx.fillStyle = 'white';
                ctx.textAlign = 'right';
                ctx.font = '16px Arial'; 
                ctx.fillText(name, radius - 10, 5);
                ctx.restore();
            });
            ctx.restore(); 
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#555';
        ctx.stroke();

        ctx.save();
        ctx.translate(centerX, centerY);

        if (imageLoaded) {
            const originalWidth = pinImage.naturalWidth;
            const originalHeight = pinImage.naturalHeight;
            const aspectRatio = originalHeight / originalWidth;
            const PIN_HEIGHT_DISPLAY = PIN_WIDTH_DISPLAY * aspectRatio; 

            ctx.save();
            const imageDrawX = -PIN_WIDTH_DISPLAY / 2;     
            const imageDrawY = -PIN_HEIGHT_DISPLAY / 2;    

            ctx.drawImage(pinImage, imageDrawX, imageDrawY, PIN_WIDTH_DISPLAY, PIN_HEIGHT_DISPLAY);         
            ctx.restore(); 
        } 

        ctx.fillStyle = 'white';
        ctx.font = 'bold 24px sans-serif'; 
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle'; 
        ctx.fillText("SPIN", 0, 0); 
        ctx.restore(); 

        if (!isSpinning && names.length > 0) {
            ctx.fillStyle = '#555';
            ctx.font = '18px Arial'; 
            ctx.textAlign = 'center';
            ctx.fillText("Click wheel to spin!", centerX, centerY - CENTER_PIN_RADIUS - 10);
        }
    }

    function getWinnerIndex() {
        const arc = (2 * Math.PI) / currentParticipants.length;
        let normalizedAngle = (rotationAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        let adjustedAngle = normalizedAngle - WINNING_POSITION; 
        adjustedAngle = (adjustedAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        let winnerIndex = Math.floor(adjustedAngle / arc);
        let finalIndex = currentParticipants.length - 1 - winnerIndex;
        return (finalIndex + currentParticipants.length) % currentParticipants.length;
    }

    function startSpinAnimation() {
        stopSpinAnimation();
        isSpinning = true;
        spinButton.disabled = true;
        spinSpeed = 0.5;

        spinAnimation = setInterval(() => {
            spinSpeed *= DECELERATION;

            if (spinSpeed <= 0.001) {
                spinSpeed = 0;

                stopSpinAnimation(); 

                // ⏳ Delay remains at 1000ms
                setTimeout(handleSpinEnd, 1000); 
                return;
            }

            rotationAngle = (rotationAngle + spinSpeed); 
            drawWheelPlaceholder(currentParticipants);
        }, 1000 / 60); 
    }

    // --- MAP SHUFFLE HELPER ---
    function shuffleMapsInternal() {
        for (let i = MAP_POOL.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [MAP_POOL[i], MAP_POOL[j]] = [MAP_POOL[j], MAP_POOL[i]];
        }
    }

    // --- NAME SHUFFLE HELPER ---
    function shuffleNamesInternal() {
        for (let i = currentParticipants.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [currentParticipants[i], currentParticipants[j]] = [currentParticipants[j], currentParticipants[i]];
        }
    }

    // --- CORE LOGIC: HANDLE SPIN END ---

    async function handleSpinEnd() {
        isSpinning = false;
        spinButton.disabled = true;

        const finalWinnerIndex = (currentParticipants.length === 1 && currentRegion !== 'MANUAL SPIN' && !isMapMode) 
            ? 0 
            : getWinnerIndex();

        const winnerItem = currentParticipants[finalWinnerIndex]; 

        winnerModal.dataset.winnerItem = winnerItem; 

        if (currentRegion === 'MANUAL SPIN') {

            modalTitle.innerHTML = `<span style="font-size: 2.5em; color: #FFA500; font-weight: bold; line-height: 1;">${winnerItem}</span>`;
            modalBody.innerHTML = `
                <p style="font-size: 1.2em; margin-top: 10px;">
                    Manual winner selected.
                </p>
                <button id="modalCloseBtn" style="background-color: #007bff; color: white; padding: 10px 20px; border-radius: 5px; margin-top: 20px;">Close</button>`;

            currentParticipants.splice(finalWinnerIndex, 1);
            if (currentParticipants.length > 0) {
                 shuffleNamesInternal(); 
            }
            updateUI(currentParticipants, currentRegion);

            document.getElementById('modalCloseBtn').addEventListener('click', () => {
                 winnerModal.style.display = 'none';
            });
            winnerModal.style.display = 'flex';

            spinButton.disabled = currentParticipants.length === 0;
            return;
        }

        // --- MAP ASSIGNMENT LOGIC (Fixed to use unified ID) ---
        if (isMapMode) {
            if (!selectedLobbyId) {
                statusDiv.textContent = "❌ Error: Please select a target lobby.";
                winnerModal.style.display = 'none'; 
                return;
            }

            let lobbyName;
            try {
                // Get the display name of the selected lobby for the modal
                const selectedOption = lobbySelect.options[lobbySelect.selectedIndex];
                lobbyName = selectedOption.text; 

                const response = await fetch(`/api/map/winner`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-KEY': API_KEY_SECRET 
                    },
                    body: JSON.stringify({
                        mapName: winnerItem,
                        // Send the numeric matchId as the lobbyId
                        lobbyId: selectedLobbyId 
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    if (response.status === 401 || errorText.includes('Unauthorized')) {
                         throw new Error(`Bot API rejected the map data (Unauthorized). Check API_KEY_SECRET.`);
                    }
                    throw new Error(`Bot API rejected the map data. Status: ${response.status}`);
                }

                const data = await response.json(); 

                // Shuffle maps immediately after the spin result
                shuffleMapsInternal();
                updateUI(MAP_POOL, 'MAPS');

                // Refresh the lobby list to remove the mapped lobby
                await fetchLobbyList(); 

                // 🛠️ FIX: Map-specific Modal Display
                modalTitle.innerHTML = `<span style="font-size: 2.5em; color: #4CAF50; font-weight: bold; line-height: 1;">${winnerItem}</span>`;
                modalBody.innerHTML = `
                    <p style="font-size: 1.5em; margin-top: 10px;">
                        MAP
                    </p>
                    <p style="font-size: 1.2em; margin-top: 5px; font-weight: bold;">
                        ✅ Allotted to ${data.lobby}
                    </p>
                    <button id="modalCloseBtn" style="background-color: #007bff; color: white; padding: 10px 20px; border-radius: 5px; margin-top: 20px;">Close</button>`;

            } catch (error) {
                statusDiv.textContent = `❌ CRITICAL ERROR: Failed to log map winner. ${error.message}`;

                // Display a specific error modal
                modalTitle.innerHTML = `<span style="font-size: 2.5em; color: #d9534f; font-weight: bold; line-height: 1;">MAP ERROR</span>`;
                modalBody.innerHTML = `
                    <p style="font-size: 1.2em; margin-top: 10px; color: #d9534f;">
                        <strong>${error.message.includes('API_KEY_SECRET') ? 'API KEY MISMATCH' : 'COMMUNICATION FAILURE'}</strong>
                    </p>
                    <p style="margin-top: 5px;">
                        ${error.message}
                    </p>
                    <button id="modalCloseBtn" style="background-color: #d9534f; color: white; padding: 10px 20px; border-radius: 5px; margin-top: 20px;">Close</button>`;

                console.error('Report Map Winner Error:', error);

            } finally {
                spinButton.disabled = !selectedLobbyId;
            }

        } else {
        // --- PLAYER ASSIGNMENT LOGIC (Remains the same) ---
            try {
                const namesRemainingAfterSpin = currentParticipants.length - 1; 

                const response = await fetch(`/api/spin_result`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        winnerIGN: winnerItem,
                        currentRegion: currentRegion,
                        namesRemaining: namesRemainingAfterSpin
                    })
                });

                if (!response.ok) throw new Error('Bot API rejected the winner data.');

                const data = await response.json(); 

                currentParticipants.splice(finalWinnerIndex, 1); 

                if (currentParticipants.length > 0) {
                     shuffleNamesInternal(); 
                }

                updateUI(currentParticipants, currentRegion);

                modalTitle.innerHTML = `<span style="font-size: 2.5em; color: #007bff; font-weight: bold; line-height: 1;">${winnerItem}</span>`;
                modalBody.innerHTML = `
                    <p style="font-size: 1.2em; margin-top: 10px;">
                        ✅ <strong>ALLOTTED:</strong> ${currentRegion} Lobby #${data.lobbyNum}
                    </p>
                    <p style="margin-top: 5px;">
                        <span style="font-size: 1.2em;">🔔</span> Check Discord for your ping!
                    </p>
                    <button id="modalCloseBtn" style="background-color: #007bff; color: white; padding: 10px 20px; border-radius: 5px; margin-top: 20px;">Close</button>`;

            } catch (error) {
                statusDiv.textContent = `❌ CRITICAL ERROR: Failed to log winner to Discord. ${error.message}`;
                console.error('Report Winner Error:', error);
            } finally {
                spinButton.disabled = currentParticipants.length === 0;
            }
        }

        // Re-attach listener for dynamically created button
        document.getElementById('modalCloseBtn').addEventListener('click', () => {
             winnerModal.style.display = 'none';
        });

        winnerModal.style.display = 'flex'; 
    }

    function stopSpinAnimation() {
        clearInterval(spinAnimation);
        spinAnimation = null;
        drawWheelPlaceholder(currentParticipants); 
    }


    // --- UTILITY FUNCTIONS ---

    function updateUI(items, mode) {
        currentParticipants = items;
        currentRegion = mode;
        isMapMode = (mode === 'MAPS');

        mapTargetContainer.style.display = isMapMode ? 'block' : 'none';

        let statusText = (mode === 'MANUAL SPIN') 
            ? `Manual Spin Mode. ${items.length} items loaded.`
            : (isMapMode ? 'Map Spin Mode. Select Lobby.' : `Region: ${mode}. Ready to spin!`);

        if (items.length === 0 && mode) {
            statusText = isMapMode ? `Map Pool Loaded (${items.length} maps)` : `Region ${mode} is completely divided!`;
            if (!isMapMode) spinButton.disabled = true;
        } 

        statusDiv.textContent = statusText;
        // Adjust spin button logic for map mode without selection
        spinButton.disabled = items.length === 0 || isSpinning || (isMapMode && !selectedLobbyId);
        shuffleButton.disabled = items.length === 0;

        remainingCountDiv.textContent = `Items remaining: ${items.length}`;

        const listEmoji = (mode === 'MAPS') ? '🗺️' : (mode === 'MANUAL SPIN' ? '📝' : '<span style="color: #007bff; font-size: 1.2em;">&diamond;</span>');
        namesListUl.innerHTML = items.map(name => `<li>${listEmoji} ${name}</li>`).join('');

        drawWheelPlaceholder(items);
    }

    // Fetch participants or load maps
    async function fetchItems(mode) {
        if (mode === 'MAPS') {
            isMapMode = true;
            shuffleMapsInternal(); 
            await fetchLobbyList(); // Refresh list on load
            updateUI(MAP_POOL, 'MAPS');
            return;
        }

        // Player Region Mode
        isMapMode = false;
        mapTargetContainer.style.display = 'none';
        selectedLobbyId = null; 

        try {
            if (mode === 'REGION 1' || mode === 'REGION 2') {
                const response = await fetch('/api/names/grouped');
                if (!response.ok) throw new Error('Could not load grouped names.');
                const data = await response.json();
                updateUI(data.groups[mode] || [], mode);
                return;
            }

            const response = await fetch(`/api/names/${mode}`);
            if (!response.ok) throw new Error(`Could not load names for region: ${mode}`);
            const data = await response.json();
            updateUI(data.names, mode);

        } catch (error) {
            statusDiv.textContent = `Error fetching names for ${mode}. Is the backend running?`;
            console.error('Fetch Names Error:', error);
            updateUI([], mode);
        }
    }

    // Fetch list of lobbies that need maps (CORRECTED)
    async function fetchLobbyList() {
        try {
            const response = await fetch(`/api/lobbies/unmapped`);
            if (!response.ok) throw new Error('Could not load unmapped lobbies.');

            const data = await response.json();

            // 🛠️ FIX: Data validation check to prevent client crashes
            if (!Array.isArray(data.lobbies)) {
                 throw new Error("Invalid format received from server. Expected 'lobbies' array.");
            }

            availableLobbies = data.lobbies;

            // Save currently selected lobby ID before refreshing options
            const previouslySelectedId = lobbySelect.value;

            lobbySelect.innerHTML = '<option value="">-- Select Lobby --</option>';
            // ID is now the numeric matchId (as a string)
            availableLobbies.forEach(lobby => {
                lobbySelect.innerHTML += `<option value="${lobby.id}">${lobby.name}</option>`;
            });

            // Attempt to re-select the lobby if it still exists 
            if (availableLobbies.some(l => l.id === previouslySelectedId)) {
                 lobbySelect.value = previouslySelectedId;
                 selectedLobbyId = previouslySelectedId;
            } else {
                 lobbySelect.value = ""; 
                 selectedLobbyId = null;
                 spinButton.disabled = true;
                 statusDiv.textContent = availableLobbies.length > 0 ? 'Map Spin Mode. Select Lobby.' : 'Map Spin Mode. No Lobbies Available.';
            }

        } catch (error) {
            statusDiv.textContent = `Error loading lobby list: ${error.message}`;
            console.error('Fetch Lobby List Error:', error);
        }
    }

    // --- EVENT LISTENERS ---

    // Region/Map Buttons
    document.querySelectorAll('.region-buttons button').forEach(button => {
        button.addEventListener('click', () => {
            fetchItems(button.dataset.region);
        });
    });

    // Lobby Select Change (New)
    lobbySelect.addEventListener('change', (e) => {
        selectedLobbyId = e.target.value || null;
        spinButton.disabled = isSpinning || !selectedLobbyId;

        const lobbyName = selectedLobbyId ? e.target.options[e.target.selectedIndex].text : 'Select Lobby.';
        statusDiv.textContent = isMapMode ? `Spinning map for ${lobbyName}` : `Region: ${currentRegion}. Ready to spin!`;
    });

    // Spin trigger function
    const triggerSpin = () => {
        if (isSpinning || currentParticipants.length === 0) return;
        if (isMapMode && !selectedLobbyId) {
            statusDiv.textContent = "❌ Please select a target lobby before spinning.";
            return;
        }

        if (currentParticipants.length === 1 && currentRegion !== 'MANUAL SPIN' && !isMapMode) {
            statusDiv.textContent = 'Auto-assigning final player...';
            handleSpinEnd();
            return;
        }

        statusDiv.textContent = isMapMode ? 'Spinning Map... 🌀' : 'Spinning... 🌀';
        startSpinAnimation();
    };

    spinButton.addEventListener('click', triggerSpin);

    // Canvas click listener
    canvas.addEventListener('click', triggerSpin); 

    // Shuffle Button (Adjusted for Map Mode)
    document.getElementById('shuffleButton').addEventListener('click', () => {
        if (currentParticipants.length === 0) return;

        if (isMapMode) {
            shuffleMapsInternal();
            updateUI(MAP_POOL, 'MAPS');
            statusDiv.textContent = `Maps shuffled.`;
        } else {
            shuffleNamesInternal();
            updateUI(currentParticipants, currentRegion);
            statusDiv.textContent = `Names shuffled for ${currentRegion}.`;
        }
    });

    // NEW LISTENER: Load Manual Data
    loadManualButton.addEventListener('click', () => {
        const manualInput = manualDataTextarea.value.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        updateUI(manualInput, 'MANUAL SPIN');
    });

    // NEW LISTENER: Reset Pool
    resetButton.addEventListener('click', () => {
        updateUI([], null);
        manualDataTextarea.value = '';
        statusDiv.textContent = 'Pool reset. Select a region or load manual data.';
    });

    // NEW LISTENER: Close Modal Button (Fallback, since button is dynamically created)
    closeModalButton.addEventListener('click', () => {
        winnerModal.style.display = 'none';
    });

    // Initial UI setup call
    drawWheelPlaceholder([]);
});
