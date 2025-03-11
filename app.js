// Initialize the WebSocket connection
let room;
let isLive = false;
let screens = [];
let nextScreenId = 1;
let remoteScreens = []; // Track screens from other users
let liveUsers = new Map(); // Track live users and their screens
let currentViewingUserId = null; // Currently viewing user
let currentPage = 'home'; // Current active page: 'home', 'myScreens', 'viewUser'
let lastSentFrames = new Map(); // Track last sent frames to reduce bandwidth
let frameBuffer = new Map(); // Buffer for smoother playback

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
                // Handle screen share metadata (not frames)
                updateRemoteScreensMetadata(data);
                break;
            case 'stopScreenShare':
                // Handle when a remote user stops sharing
                removeRemoteScreen(data);
                break;
            case 'goLive':
                // Only handle initial broadcasts, presence will handle the rest
                if (!liveUsers.has(data.clientId)) {
                    addLiveUser(data.clientId, data.username);
                }
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

    // Subscribe to presence updates
    room.party.subscribePresence((presence) => {
        for (const clientId in presence) {
            if (clientId === room.party.client.id) continue; // Skip our own presence
            
            const presenceData = presence[clientId];
            if (presenceData.isLive && !liveUsers.has(clientId)) {
                // Add live user if not already in our list
                addLiveUser(clientId, presenceData.username || room.party.peers[clientId]?.username);
            } else if (!presenceData.isLive && liveUsers.has(clientId)) {
                // Remove live user if no longer broadcasting
                removeLiveUser(clientId);
            }
            
            // Process screen frames from presence data
            if (presenceData.screens) {
                let screenCount = 0;
                Object.keys(presenceData.screens).forEach(screenId => {
                    const screenData = presenceData.screens[screenId];
                    if (screenData && screenData.active) {
                        screenCount++;
                        // Update remote screen or live user preview
                        updateRemoteScreenFromPresence(clientId, screenId, screenData);
                    }
                });
                
                // Update screen count for this user
                if (liveUsers.has(clientId)) {
                    const user = liveUsers.get(clientId);
                    user.screens = Object.keys(presenceData.screens).filter(
                        screenId => presenceData.screens[screenId].active
                    );
                    renderLiveUsers();
                }
            }
        }
        
        renderLiveUsers();
    });

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
    
    // Update user avatar
    const userAvatar = document.querySelector('#viewUserPage .avatar');
    if (userAvatar) {
        userAvatar.src = `https://images.websim.ai/avatar/${user.username}`;
        userAvatar.alt = user.username;
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
    
    // Immediately load any existing screens from presence data
    const presenceData = room.party.presence[userId];
    if (presenceData && presenceData.screens) {
        for (const screenId in presenceData.screens) {
            const screenData = presenceData.screens[screenId];
            if (screenData && screenData.active) {
                updateRemoteScreenFromPresence(userId, screenId, screenData);
            }
        }
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
        
        // Create a screens object with all active screens
        const screensPresence = {};
        screens.forEach(screen => {
            if (screen.recording) {
                screensPresence[screen.id] = {
                    title: `Screen ${screen.id} from ${room.party.client.username}`,
                    active: true,
                    timestamp: Date.now()
                };
                
                // Start capturing frames for each active screen
                setupFrameCapture(screen.id);
            }
        });
        
        // Update our presence to indicate we're live with all active screens
        room.party.updatePresence({
            isLive: true,
            username: room.party.client.username,
            screens: screensPresence
        });
        
        // Broadcast that we're going live (for backward compatibility)
        room.send({
            type: "goLive",
            clientId: room.party.client.id,
            username: room.party.client.username
        });
    } else {
        goLiveBtn.textContent = 'Go Live';
        goLiveBtn.classList.remove('active');
        
        // Stop all screen capture intervals
        screens.forEach(screen => {
            if (screen.frameInterval) {
                clearInterval(screen.frameInterval);
                screen.frameInterval = null;
            }
        });
        
        // Create a screens object with all screens marked as inactive
        const screensPresence = {};
        if (room.party.presence[room.party.client.id]?.screens) {
            // Get current screens presence and mark all as inactive
            for (const screenId in room.party.presence[room.party.client.id].screens) {
                screensPresence[screenId] = {
                    ...room.party.presence[room.party.client.id].screens[screenId],
                    active: false
                };
            }
        }
        
        // Update our presence to indicate we're not live
        room.party.updatePresence({
            isLive: false,
            screens: screensPresence
        });
        
        // Broadcast that we're stopping live (for backward compatibility)
        room.send({
            type: "stopLive",
            clientId: room.party.client.id
        });
        
        // Clear remote screens
        remoteScreens.forEach(screen => {
            screen.element.remove();
        });
        remoteScreens = [];
        
        // Clear frame tracking maps
        lastSentFrames.clear();
        frameBuffer.clear();
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
        
        // Initialize the screens object in our presence if it doesn't exist
        const currentPresence = room.party.presence[room.party.client.id] || {};
        const screensPresence = currentPresence.screens || {};
        
        // Make sure to include all active screens in presence
        let updatedScreensPresence = { ...screensPresence };
        updatedScreensPresence[screenId] = {
            title: `Screen ${screenId} from ${room.party.client.username}`,
            active: true,
            timestamp: Date.now()
        };
        
        room.party.updatePresence({
            isLive: true,
            username: room.party.client.username,
            screens: updatedScreensPresence
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
        
        // Send initial screen data right away when starting capture
        sendScreenData(screenId);
        
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
                const frameData = canvas.toDataURL('image/jpeg', 0.5); // Reduced quality for better performance
                
                // Only send if frame has changed significantly or enough time has passed
                const lastFrame = lastSentFrames.get(screenId);
                const shouldSendFrame = !lastFrame || 
                                        frameHasChangedSignificantly(lastFrame, frameData) || 
                                        Date.now() - (lastFrame.timestamp || 0) > 1000; // Force update every second
                
                if (shouldSendFrame) {
                    // Get current screens presence data
                    const currentPresence = room.party.presence[room.party.client.id] || {};
                    const screensPresence = { ...(currentPresence.screens || {}) };
                    
                    // Update screen with new frame
                    screensPresence[screenId] = {
                        title: `Screen ${screenId} from ${room.party.client.username}`,
                        active: true,
                        frameData: frameData,
                        timestamp: Date.now()
                    };
                    
                    // Update presence with ALL screens to ensure nothing is lost
                    room.party.updatePresence({
                        isLive: true,
                        username: room.party.client.username,
                        screens: screensPresence
                    });
                    
                    // Store this frame as the last sent frame
                    lastSentFrames.set(screenId, {
                        data: frameData,
                        timestamp: Date.now()
                    });
                }
            }
        }, 200); // Capture more frequently for smoother updates
    }
}

// Helper function to determine if a frame has changed significantly
function frameHasChangedSignificantly(lastFrame, newFrameData) {
    // Simple heuristic: if the data length has changed by more than 5%
    const lastLength = lastFrame.data.length;
    const newLength = newFrameData.length;
    
    return Math.abs(lastLength - newLength) / lastLength > 0.05;
}

// Function to handle remote screen updates from presence
function updateRemoteScreenFromPresence(clientId, screenId, screenData) {
    // Skip our own screens
    if (clientId === room.party.client.id) return;
    
    // If the presence indicates this screen is no longer active, remove it
    if (screenData && screenData.active === false) {
        const remoteScreen = remoteScreens.find(
            s => s.clientId === clientId && s.screenId === screenId
        );
        if (remoteScreen) {
            remoteScreen.element.remove();
            remoteScreens = remoteScreens.filter(
                s => !(s.clientId === clientId && s.screenId === screenId)
            );
        }
        return;
    }
    
    // Check if we have this screen
    const remoteScreen = remoteScreens.find(
        s => s.clientId === clientId && s.screenId === screenId
    );
    
    // Create screen if it doesn't exist
    if (!remoteScreen && screenData.active) {
        // Create the screen with metadata
        updateRemoteScreensMetadata({
            clientId,
            screenId,
            username: screenData.username || room.party.peers[clientId]?.username,
            title: screenData.title
        });
        
        // Add this screen to the user's screens count
        updateLiveUser(clientId, {
            screenId: screenId,
            username: room.party.peers[clientId]?.username
        });
    }
    
    // Update the screen with new frame data
    if (screenData.frameData) {
        // Add frame to buffer
        if (!frameBuffer.has(`${clientId}-${screenId}`)) {
            frameBuffer.set(`${clientId}-${screenId}`, []);
        }
        
        const buffer = frameBuffer.get(`${clientId}-${screenId}`);
        buffer.push({
            frameData: screenData.frameData,
            timestamp: screenData.timestamp || Date.now()
        });
        
        // Keep only the last 5 frames in buffer
        if (buffer.length > 5) buffer.shift();
        
        // Find the remote screen again in case it was just created
        const screen = remoteScreens.find(
            s => s.clientId === clientId && s.screenId === screenId
        );
        
        if (screen && screen.imageElement) {
            // Use the latest frame from buffer
            screen.imageElement.src = buffer[buffer.length - 1].frameData;
        }
        
        // Also update the live user preview
        updateLiveUserPreview(clientId, { frameData: screenData.frameData });
    }
}

// renamed from updateRemoteScreens to be clearer about its purpose
function updateRemoteScreensMetadata(data) {
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
    // Check current presence data for live users
    for (const clientId in room.party.presence) {
        if (clientId === room.party.client.id) continue;
        
        const presenceData = room.party.presence[clientId];
        if (presenceData.isLive) {
            // Add this user to live users if not already there
            if (!liveUsers.has(clientId)) {
                addLiveUser(clientId, presenceData.username || room.party.peers[clientId]?.username);
            }
            
            // Update screens info from presence
            if (presenceData.screens) {
                const activeScreens = Object.keys(presenceData.screens).filter(
                    screenId => presenceData.screens[screenId].active
                );
                
                if (liveUsers.has(clientId)) {
                    const user = liveUsers.get(clientId);
                    user.screens = activeScreens;
                    
                    // Also ensure the screens are properly displayed if we're viewing this user
                    if (currentViewingUserId === clientId) {
                        for (const screenId in presenceData.screens) {
                            const screenData = presenceData.screens[screenId];
                            if (screenData && screenData.active) {
                                updateRemoteScreenFromPresence(clientId, screenId, screenData);
                            }
                        }
                    }
                    
                    // Update preview if available
                    if (activeScreens.length > 0) {
                        const firstScreenData = presenceData.screens[activeScreens[0]];
                        if (firstScreenData.frameData) {
                            user.preview = firstScreenData.frameData;
                        }
                    }
                }
            }
        } else if (liveUsers.has(clientId)) {
            // Remove from live users if no longer live
            removeLiveUser(clientId);
        }
    }
    
    // Request live status from all users to ensure we have the latest
    room.send({
        type: "requestLiveStatus",
        clientId: room.party.client.id
    });
    
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