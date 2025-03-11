// Initialize the WebSocket connection
let room;
let isLive = false;
let screens = [];
let nextScreenId = 1;
let remoteScreens = []; // Track screens from other users
let liveUsers = new Map(); // Track live users and their screens
let currentViewingUserId = null; // Currently viewing user
let currentPage = 'home'; // Current active page: 'home', 'myScreens', 'viewUser'

document.addEventListener('DOMContentLoaded', () => {
    const addScreenBtn = document.getElementById('addScreenBtn');
    const goLiveBtn = document.getElementById('goLiveBtn');
    const screensContainer = document.getElementById('screens-container');
    const connectionStatus = document.getElementById('connectionStatus');
    const navItems = document.querySelectorAll('.nav-item');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const liveUsersContainer = document.getElementById('liveUsersContainer');
    
    // Initialize WebSocket connection
    room = new WebsimSocket();
    room.onopen = () => {
        console.log('WebSocket connection established');
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.add('online');
        
        // Subscribe to presence updates from all users
        room.party.subscribePresence(handlePresenceUpdates);
        
        // Initial presence update with offline status
        room.party.updatePresence({
            isLive: false,
            screens: []
        });
        
        // Process initial presence data immediately
        handlePresenceUpdates(room.party.presence);
    };

    room.onclose = () => {
        console.log('WebSocket connection closed');
        connectionStatus.textContent = 'Offline';
        connectionStatus.classList.remove('online');
        isLive = false;
        updateLiveButton();
        liveUsers.clear();
        renderLiveUsers();
    };

    room.onmessage = (event) => {
        const data = event.data;
        
        switch (data.type) {
            case 'chatMessage':
                // Handle incoming chat message
                if (currentViewingUserId === data.clientId || data.targetClientId === room.party.client.id) {
                    addChatMessage(data.username, data.message, data.clientId === room.party.client.id);
                }
                break;
            case 'connected':
            case 'disconnected':
                // Refresh our live users list when someone connects or disconnects
                setTimeout(refreshLiveUsers, 1000);
                break;
        }
    };

    // Setup navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.dataset.page;
            navigateTo(targetPage);
        });
    });

    // Event listeners
    addScreenBtn.addEventListener('click', () => addNewScreen());
    goLiveBtn.addEventListener('click', toggleLive);
    
    // Chat form submission
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput.value.trim() && currentViewingUserId) {
                // Send chat message
                room.send({
                    type: "chatMessage",
                    targetClientId: currentViewingUserId,
                    message: chatInput.value.trim(),
                    username: room.party.client.username,
                    clientId: room.party.client.id
                });
                
                // Add message to our own chat
                addChatMessage(room.party.client.username, chatInput.value.trim(), true);
                
                // Clear input
                chatInput.value = '';
            }
        });
    }

    // Setup drag and drop for screen containers
    setupDragAndDrop();
    
    // Set initial active page
    navigateTo('home');
});

function navigateTo(page, userId = null) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // Remove active class from all nav items
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    // Set the active nav item
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');
    
    currentPage = page;
    
    if (page === 'home') {
        // Show home page
        document.getElementById('homePage').classList.add('active');
        // Refresh list of live users
        refreshLiveUsers();
    } else if (page === 'myScreens') {
        // Show my screens page
        document.getElementById('myScreensPage').classList.add('active');
    } else if (page === 'viewUser') {
        // Show view user page
        document.getElementById('viewUserPage').classList.add('active');
        // Load the specific user's screens
        viewUserScreens(userId);
    }
}

function viewUserScreens(userId) {
    currentViewingUserId = userId;
    const user = liveUsers.get(userId);
    
    if (!user) {
        navigateTo('home');
        return;
    }
    
    // Set the viewing user's name
    const userNameElement = document.getElementById('viewingUserName');
    if (userNameElement) {
        userNameElement.textContent = user.username;
    }
    
    // Set the avatar
    const avatarElement = document.querySelector('#viewUserPage .avatar');
    if (avatarElement) {
        avatarElement.src = `https://images.websim.ai/avatar/${user.username}`;
        avatarElement.alt = user.username;
    }
    
    // Clear existing screens from this user
    remoteScreens = remoteScreens.filter(screen => screen.clientId !== userId);
    const viewScreensContainer = document.getElementById('viewScreensContainer');
    viewScreensContainer.innerHTML = '';
    
    // Check presence data for this user
    const userData = room.party.presence[userId];
    if (userData && userData.isLive && userData.screens) {
        updateUserScreens(userId, userData);
    }
    
    // Clear chat messages
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
    
    // Back button handler
    const backBtn = document.getElementById('backToHomeBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => navigateTo('home'));
    }
}

function addNewScreen() {
    const screenId = nextScreenId++;
    const screensContainer = document.getElementById('screens-container');
    
    const screenWrapper = document.createElement('div');
    screenWrapper.className = 'screen-wrapper';
    screenWrapper.dataset.id = screenId;
    screenWrapper.setAttribute('draggable', 'true');
    
    screenWrapper.innerHTML = `
        <div class="screen-header">
            <span class="grabber">⋮⋮</span>
            <div class="screen-title">Screen ${screenId}</div>
            <div class="screen-controls">
                <button class="screen-control-btn record-btn" data-id="${screenId}">Record</button>
                <button class="screen-control-btn stop-btn" data-id="${screenId}" disabled>Stop</button>
                <button class="screen-control-btn close-btn" data-id="${screenId}">×</button>
            </div>
        </div>
        <video class="screen-video" id="video-${screenId}" autoplay muted></video>
    `;
    
    screensContainer.appendChild(screenWrapper);
    
    // Add screen object to our array
    screens.push({
        id: screenId,
        element: screenWrapper,
        video: screenWrapper.querySelector(`#video-${screenId}`),
        stream: null,
        recording: false,
        frameInterval: null
    });
    
    // Setup event listeners for this screen
    const recordBtn = screenWrapper.querySelector('.record-btn');
    const stopBtn = screenWrapper.querySelector('.stop-btn');
    const closeBtn = screenWrapper.querySelector('.close-btn');
    
    recordBtn.addEventListener('click', () => startCapture(screenId));
    stopBtn.addEventListener('click', () => stopCapture(screenId));
    closeBtn.addEventListener('click', () => removeScreen(screenId));
    
    // Setup drag events for this screen
    screenWrapper.addEventListener('dragstart', handleDragStart);
    screenWrapper.addEventListener('dragend', handleDragEnd);
}

async function startCapture(screenId) {
    try {
        const screen = screens.find(s => s.id === screenId);
        
        // Request display media
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always"
            },
            audio: false
        });
        
        // Save the stream
        screen.stream = stream;
        screen.recording = true;
        
        // Display the stream
        screen.video.srcObject = stream;
        
        // Update UI
        const recordBtn = screen.element.querySelector('.record-btn');
        const stopBtn = screen.element.querySelector('.stop-btn');
        recordBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Handle stream ending
        stream.getVideoTracks()[0].addEventListener('ended', () => {
            stopCapture(screenId);
        });
        
        // Setup frame capture interval if we're live
        if (isLive) {
            setupFrameCapture(screenId);
            // Update presence with new screen data
            setTimeout(() => updatePresenceWithScreens(), 500);
        }
        
    } catch (error) {
        console.error('Error capturing screen:', error);
    }
}

function stopCapture(screenId) {
    const screen = screens.find(s => s.id === screenId);
    
    if (screen && screen.stream) {
        // Stop frame capture interval if it exists
        if (screen.frameInterval) {
            clearInterval(screen.frameInterval);
            screen.frameInterval = null;
        }

        // Stop all tracks
        screen.stream.getTracks().forEach(track => track.stop());
        screen.video.srcObject = null;
        screen.stream = null;
        screen.recording = false;
        
        // Update UI
        const recordBtn = screen.element.querySelector('.record-btn');
        const stopBtn = screen.element.querySelector('.stop-btn');
        recordBtn.disabled = false;
        stopBtn.disabled = true;
        
        // Update presence if we're live
        if (isLive) {
            updatePresenceWithScreens();
        }
    }
}

function removeScreen(screenId) {
    // Stop capture if needed
    stopCapture(screenId);
    
    // Remove from DOM
    const screenIndex = screens.findIndex(s => s.id === screenId);
    if (screenIndex !== -1) {
        screens[screenIndex].element.remove();
        screens.splice(screenIndex, 1);
    }
}

function toggleLive() {
    const goLiveBtn = document.getElementById('goLiveBtn');
    
    isLive = !isLive;
    
    if (isLive) {
        goLiveBtn.textContent = 'Stop Live';
        goLiveBtn.classList.add('active');
        
        // Update our presence to indicate we're live
        updatePresenceWithScreens();
        
        // Start sending screen data for each active screen
        screens.forEach(screen => {
            if (screen.recording) {
                setupFrameCapture(screen.id);
            }
        });
    } else {
        goLiveBtn.textContent = 'Go Live';
        goLiveBtn.classList.remove('active');
        
        // Update our presence to indicate we're not live
        room.party.updatePresence({
            isLive: false,
            screens: []
        });
        
        // Stop sending screen data
        screens.forEach(screen => {
            if (screen.frameInterval) {
                clearInterval(screen.frameInterval);
                screen.frameInterval = null;
            }
        });
        
        // Clear remote screens
        remoteScreens.forEach(screen => {
            screen.element.remove();
        });
        remoteScreens = [];
    }
}

// Update our presence with all current screens
function updatePresenceWithScreens() {
    const activeScreens = screens
        .filter(screen => screen.recording)
        .map(screen => ({
            id: screen.id,
            title: `Screen ${screen.id}`,
            frameData: getScreenFrameData(screen)
        }));
    
    room.party.updatePresence({
        isLive: isLive,
        screens: activeScreens,
        username: room.party.client.username
    });
}

// Get frame data from a screen
function getScreenFrameData(screen) {
    if (!screen.recording || !screen.video) return null;
    
    try {
        // Create a temporary canvas to capture the current frame
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Get video dimensions
        const videoWidth = screen.video.videoWidth;
        const videoHeight = screen.video.videoHeight;
        
        if (videoWidth && videoHeight) {
            // Set canvas size to match video
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            
            // Draw current video frame to canvas
            ctx.drawImage(screen.video, 0, 0, canvas.width, canvas.height);
            
            // Get the frame as a data URL (JPEG for better compression)
            return canvas.toDataURL('image/jpeg', 0.6);
        }
    } catch (error) {
        console.error('Error capturing frame:', error);
    }
    
    return null;
}

function setupFrameCapture(screenId) {
    const screen = screens.find(s => s.id === screenId);
    
    if (screen && screen.recording && isLive) {
        // Clear any existing interval
        if (screen.frameInterval) {
            clearInterval(screen.frameInterval);
        }
        
        // Set up interval to capture and send frames
        screen.frameInterval = setInterval(() => {
            if (!screen.recording || !isLive) {
                clearInterval(screen.frameInterval);
                screen.frameInterval = null;
                return;
            }
            
            // Update presence with latest screen data
            updatePresenceWithScreens();
            
        }, 500); // Update every 500ms (adjust for performance)
    }
}

function refreshLiveUsers() {
    // Process current presence data immediately
    handlePresenceUpdates(room.party.presence);
    
    // If we're viewing a user, check if they're still live
    if (currentViewingUserId && !liveUsers.has(currentViewingUserId)) {
        navigateTo('home');
    }
}

function handlePresenceUpdates(allPresence) {
    // Clear previous live users
    liveUsers.clear();
    
    // Loop through all users' presence data
    for (const clientId in allPresence) {
        const userData = allPresence[clientId];
        const peer = room.party.peers[clientId];
        
        // Skip ourselves
        if (clientId === room.party.client.id) continue;
        
        // If user is live, add to live users
        if (userData.isLive) {
            liveUsers.set(clientId, {
                clientId,
                username: peer?.username || userData.username || "Unknown User",
                preview: userData.preview || null,
                screens: userData.screens || []
            });
            
            // Update remote screens if we're viewing this user
            if (currentViewingUserId === clientId && currentPage === 'viewUser') {
                updateUserScreens(clientId, userData);
            }
        } else if (currentViewingUserId === clientId && currentPage === 'viewUser') {
            // If we're viewing a user who just went offline, go back to home
            navigateTo('home');
        }
    }
    
    // Update the UI
    renderLiveUsers();
}

function updateUserScreens(clientId, userData) {
    if (!userData.screens) return;
    
    // Clear existing screens from this user
    remoteScreens = remoteScreens.filter(screen => screen.clientId !== clientId);
    const viewScreensContainer = document.getElementById('viewScreensContainer');
    
    // Remove old screen elements
    const oldScreenElements = viewScreensContainer.querySelectorAll(`[data-client-id="${clientId}"]`);
    oldScreenElements.forEach(el => el.remove());
    
    // Add new screens
    userData.screens.forEach(screen => {
        // Create a new container for the remote screen
        const screenWrapper = document.createElement('div');
        screenWrapper.className = 'screen-wrapper remote-screen';
        screenWrapper.dataset.clientId = clientId;
        screenWrapper.dataset.screenId = screen.id;
        
        screenWrapper.innerHTML = `
            <div class="screen-header">
                <span class="grabber">⋮⋮</span>
                <div class="screen-title">${screen.title || `Screen from ${room.party.peers[clientId]?.username}`}</div>
                <div class="screen-controls">
                    <span class="screen-control-btn remote-username">${room.party.peers[clientId]?.username}</span>
                </div>
            </div>
            <img class="screen-video" id="remote-img-${clientId}-${screen.id}" src="${screen.frameData || ''}" alt="Remote screen" />
        `;
        
        viewScreensContainer.appendChild(screenWrapper);
        
        // Add to our remote screens array
        remoteScreens.push({
            clientId: clientId,
            screenId: screen.id,
            element: screenWrapper,
            imageElement: screenWrapper.querySelector(`#remote-img-${clientId}-${screen.id}`)
        });
        
        // Setup drag events
        screenWrapper.setAttribute('draggable', 'true');
        screenWrapper.addEventListener('dragstart', handleDragStart);
        screenWrapper.addEventListener('dragend', handleDragEnd);
    });
}

function renderLiveUsers() {
    const liveUsersContainer = document.getElementById('liveUsersContainer');
    if (!liveUsersContainer) return;
    
    liveUsersContainer.innerHTML = '';
    
    if (liveUsers.size === 0) {
        liveUsersContainer.innerHTML = '<p>No users are currently live</p>';
        return;
    }
    
    // Create cards for each live user
    liveUsers.forEach(user => {
        const card = document.createElement('div');
        card.className = 'live-user-card';
        card.dataset.clientId = user.clientId;
        card.addEventListener('click', () => navigateTo('viewUser', user.clientId));
        
        card.innerHTML = `
            <div class="live-user-preview">
                <img src="${user.preview || 'https://images.websim.ai/avatar/' + user.username}" alt="${user.username}">
                <div class="live-indicator">LIVE</div>
            </div>
            <div class="live-user-info">
                <div class="live-user-name">${user.username}</div>
                <div class="live-user-status">${user.screens.length} screen${user.screens.length !== 1 ? 's' : ''} sharing</div>
            </div>
        `;
        
        liveUsersContainer.appendChild(card);
    });
}

function addChatMessage(username, message, isSelf = false) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isSelf ? 'self' : 'other'}`;
    
    // Always show username, even for self messages
    messageElement.innerHTML = `
        <div class="username">${username}</div>
        ${message}
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setupDragAndDrop() {
    const screensContainer = document.getElementById('screens-container');
    const viewScreensContainer = document.getElementById('viewScreensContainer');
    
    const setupDragForContainer = (container) => {
        if (!container) return;
        
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggable = document.querySelector('.is-dragging');
            
            if (!draggable) return;
            
            // Find the closest screen element we're dragging over
            const afterElement = getDragAfterElement(container, e.clientY, e.clientX);
            
            if (afterElement == null) {
                container.appendChild(draggable);
            } else {
                container.insertBefore(draggable, afterElement);
            }
        });
    };
    
    // Setup drag for both containers
    setupDragForContainer(screensContainer);
    setupDragForContainer(viewScreensContainer);
}

function handleDragStart(e) {
    e.target.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    
    // Different data attributes for local vs remote screens
    if (e.target.dataset.id) {
        e.dataTransfer.setData('text/plain', e.target.dataset.id);
    } else {
        e.dataTransfer.setData('text/plain', `${e.target.dataset.clientId}-${e.target.dataset.screenId}`);
    }
    
    // Create a ghost drag image
    const dragImage = e.target.cloneNode(true);
    dragImage.style.opacity = '0.5';
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    
    // Remove the ghost image after drag
    setTimeout(() => {
        document.body.removeChild(dragImage);
    }, 0);
}

function handleDragEnd(e) {
    e.target.classList.remove('is-dragging');
    
    // Remove any placeholder
    const placeholder = document.querySelector('.drag-placeholder');
    if (placeholder) placeholder.remove();
}

function getDragAfterElement(container, y, x) {
    const draggableElements = [...container.querySelectorAll('.screen-wrapper:not(.is-dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offsetY = y - box.top - box.height / 2;
        const offsetX = x - box.left - box.width / 2;
        
        // Calculate distance from center
        const distance = Math.sqrt(offsetY * offsetY + offsetX * offsetX);
        
        if (distance < closest.distance) {
            return { element: child, distance: distance };
        } else {
            return closest;
        }
    }, { element: null, distance: Number.POSITIVE_INFINITY }).element;
}