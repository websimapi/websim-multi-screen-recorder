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
        
        // Request current live users from all peers when connection is established
        room.send({
            type: "requestLiveStatus",
            clientId: room.party.client.id
        });
        
        // Refresh live users when connection is established
        setTimeout(refreshLiveUsers, 500);
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
            case 'screenShare':
                // Handle incoming screen share data
                updateRemoteScreens(data);
                updateLiveUser(data.clientId, data);
                break;
            case 'screenFrame':
                // Handle incoming screen frame data
                updateRemoteScreenFrame(data);
                updateLiveUserPreview(data.clientId, data);
                break;
            case 'stopScreenShare':
                // Handle when a remote user stops sharing
                removeRemoteScreen(data);
                break;
            case 'goLive':
                // Handle when a user starts broadcasting
                addLiveUser(data.clientId, data.username);
                break;
            case 'stopLive':
                // Handle when a user stops broadcasting
                removeLiveUser(data.clientId);
                break;
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
            case 'requestLiveStatus':
                // If we are live, respond to the request with our status
                if (isLive) {
                    room.send({
                        type: "goLive",
                        clientId: room.party.client.id,
                        username: room.party.client.username
                    });
                }
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
    
    // Clear existing screens from this user
    remoteScreens = remoteScreens.filter(screen => screen.clientId !== userId);
    const viewScreensContainer = document.getElementById('viewScreensContainer');
    viewScreensContainer.innerHTML = '';
    
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
            sendScreenData(screenId);
            setupFrameCapture(screenId);
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

        // Notify others if we're live
        if (isLive) {
            room.send({
                type: "stopScreenShare",
                screenId: screenId,
                clientId: room.party.client.id
            });
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
        
        // Broadcast that we're going live
        room.send({
            type: "goLive",
            clientId: room.party.client.id,
            username: room.party.client.username
        });
        
        // Start sending screen data for each active screen
        screens.forEach(screen => {
            if (screen.recording) {
                sendScreenData(screen.id);
                setupFrameCapture(screen.id);
            }
        });
    } else {
        goLiveBtn.textContent = 'Go Live';
        goLiveBtn.classList.remove('active');
        
        // Broadcast that we're stopping live
        room.send({
            type: "stopLive",
            clientId: room.party.client.id
        });
        
        // Stop sending screen data
        screens.forEach(screen => {
            if (screen.frameInterval) {
                clearInterval(screen.frameInterval);
                screen.frameInterval = null;
            }
            
            // Notify others that we've stopped sharing this screen
            if (screen.recording) {
                room.send({
                    type: "stopScreenShare",
                    screenId: screen.id,
                    clientId: room.party.client.id
                });
            }
        });
        
        // Clear remote screens
        remoteScreens.forEach(screen => {
            screen.element.remove();
        });
        remoteScreens = [];
    }
}

function updateLiveButton() {
    const goLiveBtn = document.getElementById('goLiveBtn');
    
    if (isLive) {
        goLiveBtn.textContent = 'Stop Live';
        goLiveBtn.classList.add('active');
    } else {
        goLiveBtn.textContent = 'Go Live';
        goLiveBtn.classList.remove('active');
    }
}

function sendScreenData(screenId) {
    const screen = screens.find(s => s.id === screenId);
    
    if (screen && screen.recording && isLive) {
        // Send initial notification that the screen is being shared
        room.send({
            type: "screenShare",
            screenId: screenId,
            clientId: room.party.client.id,
            username: room.party.client.username,
            title: `Screen ${screenId} from ${room.party.client.username}`
        });
    }
}

function setupFrameCapture(screenId) {
    const screen = screens.find(s => s.id === screenId);
    
    if (screen && screen.recording && isLive) {
        // Clear any existing interval
        if (screen.frameInterval) {
            clearInterval(screen.frameInterval);
        }
        
        // Create a canvas to capture video frames
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set up interval to capture and send frames
        screen.frameInterval = setInterval(() => {
            if (!screen.recording || !isLive) {
                clearInterval(screen.frameInterval);
                screen.frameInterval = null;
                return;
            }
            
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
                const frameData = canvas.toDataURL('image/jpeg', 0.6);
                
                // Send the frame data
                room.send({
                    type: "screenFrame",
                    screenId: screenId,
                    clientId: room.party.client.id,
                    username: room.party.client.username,
                    frameData: frameData
                });
            }
        }, 500); // Send frame every 500ms (adjust for performance)
    }
}

function updateRemoteScreens(data) {
    // Skip our own screens
    if (data.clientId === room.party.client.id) return;
    
    // If we're not viewing this user's screens, return
    if (currentPage === 'viewUser' && currentViewingUserId !== data.clientId) return;
    
    // Check if we already have this remote screen
    const existingScreen = remoteScreens.find(
        s => s.clientId === data.clientId && s.screenId === data.screenId
    );
    
    if (existingScreen) {
        // If the screen exists but might need to be updated
        existingScreen.element.querySelector('.screen-title').textContent = 
            data.title || `Screen from ${data.username}`;
        return;
    }
    
    // Determine the container to add the screen to
    let screensContainer;
    if (currentPage === 'viewUser') {
        screensContainer = document.getElementById('viewScreensContainer');
    } else {
        return; // Don't add screens when not in view mode
    }
    
    // Create a new container for the remote screen
    const screenWrapper = document.createElement('div');
    screenWrapper.className = 'screen-wrapper remote-screen';
    screenWrapper.dataset.clientId = data.clientId;
    screenWrapper.dataset.screenId = data.screenId;
    
    screenWrapper.innerHTML = `
        <div class="screen-header">
            <span class="grabber">⋮⋮</span>
            <div class="screen-title">${data.title || `Screen from ${data.username}`}</div>
            <div class="screen-controls">
                <span class="screen-control-btn remote-username">${data.username}</span>
            </div>
        </div>
        <img class="screen-video" id="remote-img-${data.clientId}-${data.screenId}" alt="Remote screen" />
    `;
    
    screensContainer.appendChild(screenWrapper);
    
    // Add to our remote screens array
    remoteScreens.push({
        clientId: data.clientId,
        screenId: data.screenId,
        element: screenWrapper,
        imageElement: screenWrapper.querySelector(`#remote-img-${data.clientId}-${data.screenId}`)
    });
    
    // Setup drag events
    screenWrapper.setAttribute('draggable', 'true');
    screenWrapper.addEventListener('dragstart', handleDragStart);
    screenWrapper.addEventListener('dragend', handleDragEnd);
}

function updateRemoteScreenFrame(data) {
    // Skip our own frames
    if (data.clientId === room.party.client.id) return;
    
    // Find the remote screen
    const remoteScreen = remoteScreens.find(
        s => s.clientId === data.clientId && s.screenId === data.screenId
    );
    
    if (remoteScreen && remoteScreen.imageElement) {
        // Update the image with the new frame
        remoteScreen.imageElement.src = data.frameData;
    } else if (currentPage === 'viewUser' && currentViewingUserId === data.clientId) {
        // If we don't have this screen yet but we're viewing this user, create it
        updateRemoteScreens(data);
    }
}

function removeRemoteScreen(data) {
    const index = remoteScreens.findIndex(
        s => s.clientId === data.clientId && s.screenId === data.screenId
    );
    
    if (index !== -1) {
        // Remove from DOM
        remoteScreens[index].element.remove();
        // Remove from array
        remoteScreens.splice(index, 1);
    }
}

// Drag and drop functionality
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

// Live users management
function addLiveUser(clientId, username) {
    if (clientId === room.party.client.id) return; // Skip ourselves
    
    liveUsers.set(clientId, {
        clientId,
        username,
        preview: null,
        screens: []
    });
    
    renderLiveUsers();
}

function removeLiveUser(clientId) {
    if (liveUsers.has(clientId)) {
        liveUsers.delete(clientId);
        renderLiveUsers();
        
        // If we're currently viewing this user, go back to home
        if (currentViewingUserId === clientId) {
            navigateTo('home');
        }
    }
}

function updateLiveUser(clientId, screenData) {
    if (clientId === room.party.client.id) return; // Skip ourselves
    
    if (!liveUsers.has(clientId)) {
        // Add new live user if not exists
        addLiveUser(clientId, screenData.username);
    }
    
    const user = liveUsers.get(clientId);
    
    // Add screen to user's screens if not already there
    if (!user.screens.includes(screenData.screenId)) {
        user.screens.push(screenData.screenId);
    }
    
    renderLiveUsers();
}

function updateLiveUserPreview(clientId, data) {
    if (clientId === room.party.client.id) return; // Skip ourselves
    
    if (liveUsers.has(clientId)) {
        const user = liveUsers.get(clientId);
        // Update preview image
        user.preview = data.frameData;
        
        // Update preview in DOM if it exists
        const previewImg = document.querySelector(`.live-user-card[data-client-id="${clientId}"] img`);
        if (previewImg) {
            previewImg.src = data.frameData;
        }
    }
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

function refreshLiveUsers() {
    // This would typically query the server for who is live
    // For now, we rely on messages to build our list
    renderLiveUsers();
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