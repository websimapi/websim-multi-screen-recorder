// Initialize the WebSocket connection
let room;
let isLive = false;
let screens = [];
let nextScreenId = 1;
let remoteScreens = []; // Track screens from other users
let liveUsers = new Map(); // Track live users and their screens
let currentViewingUserId = null; // Currently viewing user
let currentPage = 'home'; // Current active page: 'home', 'myScreens', 'viewUser'
let targetFPS = 24; // Target frames per second
let streamQuality = 0.5; // Default quality (0.1-1.0)
let adaptiveQuality = true; // Adapt quality based on performance

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
    const qualitySlider = document.getElementById('qualitySlider');
    const fpsIndicator = document.getElementById('fpsIndicator');
    
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
            case 'audioOffer':
                handleAudioOffer(data);
                break;
            case 'audioAnswer':
                handleAudioAnswer(data);
                break;
            case 'audioCandidate':
                handleAudioCandidate(data);
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
    
    // Handle quality slider changes
    if (qualitySlider) {
        qualitySlider.addEventListener('input', (e) => {
            streamQuality = parseFloat(e.target.value);
        });
    }
    
    // Setup FPS indicator update
    setInterval(() => {
        if (fpsIndicator && screens.length > 0) {
            let totalFps = 0;
            let screenCount = 0;
            
            screens.forEach(screen => {
                if (screen.frameStats && screen.recording) {
                    totalFps += screen.frameStats.fps;
                    screenCount++;
                }
            });
            
            const avgFps = screenCount > 0 ? Math.round(totalFps / screenCount) : 0;
            fpsIndicator.textContent = `${avgFps} FPS`;
            
            // Visual indicator of performance
            if (avgFps >= targetFPS) {
                fpsIndicator.style.backgroundColor = '#16a34a';
            } else if (avgFps >= targetFPS * 0.7) {
                fpsIndicator.style.backgroundColor = '#ca8a04';
            } else {
                fpsIndicator.style.backgroundColor = '#e22626';
            }
        }
    }, 1000);
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
                <button class="screen-control-btn audio-btn" data-id="${screenId}"><i class="fas fa-volume-up"></i></button>
                <button class="screen-control-btn close-btn" data-id="${screenId}">×</button>
            </div>
        </div>
        <video class="screen-video" id="video-${screenId}" autoplay></video>
    `;
    
    screensContainer.appendChild(screenWrapper);
    
    // Add screen object to our array
    screens.push({
        id: screenId,
        element: screenWrapper,
        video: screenWrapper.querySelector(`#video-${screenId}`),
        stream: null,
        recording: false,
        frameInterval: null,
        hasAudio: false
    });
    
    // Setup event listeners for this screen
    const recordBtn = screenWrapper.querySelector('.record-btn');
    const stopBtn = screenWrapper.querySelector('.stop-btn');
    const closeBtn = screenWrapper.querySelector('.close-btn');
    const audioBtn = screenWrapper.querySelector('.audio-btn');
    
    recordBtn.addEventListener('click', () => startCapture(screenId));
    stopBtn.addEventListener('click', () => stopCapture(screenId));
    closeBtn.addEventListener('click', () => removeScreen(screenId));
    audioBtn.addEventListener('click', () => toggleAudio(screenId));
    
    // Setup drag events for this screen
    screenWrapper.addEventListener('dragstart', handleDragStart);
    screenWrapper.addEventListener('dragend', handleDragEnd);
}

async function startCapture(screenId) {
    try {
        const screen = screens.find(s => s.id === screenId);
        
        // Request display media with audio
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always"
            },
            audio: true // Enable audio capture
        });
        
        // Save the stream
        screen.stream = stream;
        screen.recording = true;
        
        // Display the stream
        screen.video.srcObject = stream;
        screen.video.muted = false; // Unmute to hear audio locally
        
        // Update UI
        const recordBtn = screen.element.querySelector('.record-btn');
        const stopBtn = screen.element.querySelector('.stop-btn');
        const audioBtn = screen.element.querySelector('.audio-btn');
        recordBtn.disabled = true;
        stopBtn.disabled = false;
        if (audioBtn) audioBtn.classList.toggle('active', stream.getAudioTracks().length > 0);
        
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
        // Stop animation frame if it exists
        if (screen.animationFrameId) {
            cancelAnimationFrame(screen.animationFrameId);
            screen.animationFrameId = null;
        }
        
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
        screen.frameBuffer = null;
        screen.frameStats = null;
        
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
        // Check if there are audio tracks
        const hasAudio = screen.stream.getAudioTracks().length > 0;
        screen.hasAudio = hasAudio;
        
        // Send initial notification that the screen is being shared
        room.send({
            type: "screenShare",
            screenId: screenId,
            clientId: room.party.client.id,
            username: room.party.client.username,
            title: `Screen ${screenId} from ${room.party.client.username}`,
            hasAudio: hasAudio
        });
    }
}

function toggleAudio(screenId) {
    const screen = screens.find(s => s.id === screenId);
    if (!screen || !screen.stream) return;
    
    const audioBtn = screen.element.querySelector('.audio-btn');
    const audioTracks = screen.stream.getAudioTracks();
    
    if (audioTracks.length > 0) {
        const isEnabled = !audioTracks[0].enabled;
        audioTracks[0].enabled = isEnabled;
        audioBtn.classList.toggle('active', isEnabled);
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
        
        // Initialize frame buffer and statistics
        screen.frameBuffer = [];
        screen.frameStats = {
            lastFrameTime: performance.now(),
            frameCount: 0,
            fps: 0,
            droppedFrames: 0,
            adaptiveScaleFactor: 0.4,
            consecutiveSlowFrames: 0,
            videoSize: {
                width: 0,
                height: 0
            }
        };
        
        // Setup audio streaming if available
        if (screen.stream.getAudioTracks().length > 0) {
            setupAudioStreaming(screen);
        }
        
        // Calculate frame interval based on target FPS
        const frameInterval = 1000 / targetFPS;
        
        // Set up requestAnimationFrame loop instead of interval
        const captureFrame = () => {
            if (!screen.recording || !isLive) {
                screen.frameStats = null;
                screen.frameBuffer = null;
                return;
            }
            
            const now = performance.now();
            const elapsed = now - screen.frameStats.lastFrameTime;
            
            // Only capture if enough time has elapsed since last frame
            if (elapsed >= frameInterval) {
                // Get video dimensions
                const videoWidth = screen.video.videoWidth;
                const videoHeight = screen.video.videoHeight;
                
                if (videoWidth && videoHeight) {
                    // Only resize canvas if video dimensions change
                    if (screen.frameStats.videoSize.width !== videoWidth || 
                        screen.frameStats.videoSize.height !== videoHeight) {
                        screen.frameStats.videoSize.width = videoWidth;
                        screen.frameStats.videoSize.height = videoHeight;
                    }
                    
                    // Use adaptive scaling based on performance
                    let scaleFactor = screen.frameStats.adaptiveScaleFactor;
                    
                    // Calculate scaled dimensions - maintain aspect ratio
                    const scaledWidth = Math.floor(videoWidth * scaleFactor);
                    const scaledHeight = Math.floor(videoHeight * scaleFactor);
                    
                    // Set canvas size to scaled dimensions
                    canvas.width = scaledWidth;
                    canvas.height = scaledHeight;
                    
                    // Clear canvas first
                    ctx.clearRect(0, 0, scaledWidth, scaledHeight);
                    
                    // Draw current video frame to canvas with scaling
                    ctx.drawImage(screen.video, 0, 0, scaledWidth, scaledHeight);
                    
                    // Calculate current quality based on performance
                    let quality = streamQuality;
                    if (adaptiveQuality && screen.frameStats.consecutiveSlowFrames > 5) {
                        quality = Math.max(0.2, quality - 0.1);
                        screen.frameStats.adaptiveScaleFactor = Math.max(0.2, scaleFactor - 0.05);
                        screen.frameStats.consecutiveSlowFrames = 0;
                    } else if (adaptiveQuality && screen.frameStats.fps >= targetFPS && screen.frameStats.frameCount % 30 === 0) {
                        quality = Math.min(0.8, quality + 0.05);
                        screen.frameStats.adaptiveScaleFactor = Math.min(0.6, scaleFactor + 0.02);
                    }
                    
                    // Get the frame as a data URL (JPEG with compression)
                    const frameData = canvas.toDataURL('image/jpeg', quality);
                    
                    // Add to frame buffer
                    screen.frameBuffer.push({
                        timestamp: now,
                        data: frameData,
                        screenId: screenId,
                        clientId: room.party.client.id,
                        username: room.party.client.username,
                        dimensions: {width: scaledWidth, height: scaledHeight}
                    });
                    
                    // Keep buffer size reasonable
                    if (screen.frameBuffer.length > targetFPS) {
                        screen.frameBuffer.shift();
                    }
                    
                    // Update stats
                    screen.frameStats.frameCount++;
                    const fpsWindow = 1000; // Calculate FPS over 1 second
                    if (now - screen.frameStats.lastFrameTime > fpsWindow) {
                        screen.frameStats.fps = (screen.frameStats.frameCount * 1000) / (now - screen.frameStats.lastFrameTime);
                        screen.frameStats.lastFrameTime = now;
                        screen.frameStats.frameCount = 0;
                    }
                    
                    // If frame took too long, increment slow frames counter
                    if (elapsed > frameInterval * 1.5) {
                        screen.frameStats.consecutiveSlowFrames++;
                    } else {
                        screen.frameStats.consecutiveSlowFrames = 0;
                    }
                }
            }
            
            // Request next frame
            screen.animationFrameId = requestAnimationFrame(captureFrame);
        };
        
        // Start the animation frame loop
        screen.animationFrameId = requestAnimationFrame(captureFrame);
        
        // Set up separate interval to send buffered frames
        screen.frameInterval = setInterval(() => {
            if (!screen.recording || !isLive || !screen.frameBuffer || screen.frameBuffer.length === 0) {
                return;
            }
            
            // Send oldest frame from buffer
            const frame = screen.frameBuffer.shift();
            if (frame) {
                room.send({
                    type: "screenFrame",
                    screenId: frame.screenId,
                    clientId: frame.clientId,
                    username: frame.username,
                    frameData: frame.data,
                    timestamp: frame.timestamp,
                    dimensions: frame.dimensions
                });
            }
        }, 1000 / 15); // Send at a lower rate than capture
    }
}

function setupAudioStreaming(screen) {
    // Create peer connection for audio
    screen.audioConnection = new RTCPeerConnection();
    
    // Add audio tracks to the connection
    screen.stream.getAudioTracks().forEach(track => {
        screen.audioConnection.addTrack(track, screen.stream);
    });
    
    // Create data channel for signaling
    screen.audioDataChannel = screen.audioConnection.createDataChannel('audio-signaling');
    
    // Create offer
    screen.audioConnection.createOffer().then(offer => {
        screen.audioConnection.setLocalDescription(offer);
        
        // Send offer to remote peers
        room.send({
            type: "audioOffer",
            screenId: screen.id,
            clientId: room.party.client.id,
            sdp: offer.sdp
        });
    });
    
    // Handle ICE candidates
    screen.audioConnection.onicecandidate = event => {
        if (event.candidate) {
            room.send({
                type: "audioCandidate",
                screenId: screen.id,
                clientId: room.party.client.id,
                candidate: event.candidate
            });
        }
    };
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
        
        // Update audio status if provided
        if (data.hasAudio !== undefined) {
            existingScreen.hasAudio = data.hasAudio;
            const audioIndicator = existingScreen.element.querySelector('.audio-indicator');
            if (audioIndicator) {
                audioIndicator.style.display = data.hasAudio ? 'inline-block' : 'none';
            }
        }
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
                <span class="audio-indicator" style="display: ${data.hasAudio ? 'inline-block' : 'none'}">
                    <i class="fas fa-volume-up"></i>
                </span>
                <span class="screen-control-btn remote-username">${data.username}</span>
            </div>
        </div>
        <div class="video-container">
            <img class="screen-video" id="remote-img-${data.clientId}-${data.screenId}" alt="Remote screen" style="display:block;" />
            ${data.hasAudio ? `<audio id="remote-audio-${data.clientId}-${data.screenId}" autoplay></audio>` : ''}
        </div>
    `;
    
    screensContainer.appendChild(screenWrapper);
    
    // Add to our remote screens array
    remoteScreens.push({
        clientId: data.clientId,
        screenId: data.screenId,
        element: screenWrapper,
        imageElement: screenWrapper.querySelector(`#remote-img-${data.clientId}-${data.screenId}`),
        audioElement: data.hasAudio ? screenWrapper.querySelector(`#remote-audio-${data.clientId}-${data.screenId}`) : null,
        hasAudio: data.hasAudio || false
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
        // Initialize frame buffer if it doesn't exist
        if (!remoteScreen.frameBuffer) {
            remoteScreen.frameBuffer = [];
            remoteScreen.lastRenderTime = 0;
            remoteScreen.frameStats = {
                lastFrameTime: performance.now(),
                frameCount: 0,
                frameSize: { width: 0, height: 0 }
            };
            
            // Set up frame rendering loop
            const renderNextFrame = () => {
                if (!remoteScreen.frameBuffer || remoteScreen.frameBuffer.length === 0) {
                    remoteScreen.animationFrameId = requestAnimationFrame(renderNextFrame);
                    return;
                }
                
                const now = performance.now();
                // Render at targetFPS
                if (now - remoteScreen.lastRenderTime >= (1000 / targetFPS)) {
                    // Get the next frame
                    const frame = remoteScreen.frameBuffer.shift();
                    
                    // Update the image
                    if (frame && remoteScreen.imageElement) {
                        // Set a fixed size if we don't have one yet
                        if (!remoteScreen.frameStats.frameSize.width) {
                            const img = new Image();
                            img.onload = () => {
                                remoteScreen.frameStats.frameSize = {
                                    width: img.width,
                                    height: img.height
                                };
                                // Set fixed dimensions to prevent shifting
                                remoteScreen.imageElement.style.width = `${img.width}px`;
                                remoteScreen.imageElement.style.height = `${img.height}px`;
                            };
                            img.src = frame;
                        }
                        remoteScreen.imageElement.src = frame;
                    }
                    
                    remoteScreen.lastRenderTime = now;
                }
                
                // Continue the loop
                remoteScreen.animationFrameId = requestAnimationFrame(renderNextFrame);
            };
            
            // Start the rendering loop
            remoteScreen.animationFrameId = requestAnimationFrame(renderNextFrame);
        }
        
        // Add frame to buffer
        if (remoteScreen.frameBuffer.length < targetFPS * 2) { // Limit buffer size
            remoteScreen.frameBuffer.push(data.frameData);
        }
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
        // Stop the rendering loop if it exists
        if (remoteScreens[index].animationFrameId) {
            cancelAnimationFrame(remoteScreens[index].animationFrameId);
        }
        
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

function handleAudioOffer(data) {
    // Skip our own offers
    if (data.clientId === room.party.client.id) return;
    
    // Find the remote screen
    const remoteScreen = remoteScreens.find(
        s => s.clientId === data.clientId && s.screenId === data.screenId
    );
    
    if (remoteScreen && remoteScreen.hasAudio) {
        // Create peer connection if it doesn't exist
        if (!remoteScreen.audioConnection) {
            remoteScreen.audioConnection = new RTCPeerConnection();
            
            // Handle incoming tracks
            remoteScreen.audioConnection.ontrack = event => {
                if (remoteScreen.audioElement) {
                    remoteScreen.audioElement.srcObject = new MediaStream([event.track]);
                }
            };
            
            // Handle ICE candidates
            remoteScreen.audioConnection.onicecandidate = event => {
                if (event.candidate) {
                    room.send({
                        type: "audioCandidate",
                        screenId: remoteScreen.screenId,
                        clientId: room.party.client.id,
                        targetClientId: remoteScreen.clientId,
                        candidate: event.candidate
                    });
                }
            };
        }
        
        // Set remote description from offer
        const offer = new RTCSessionDescription({
            type: 'offer',
            sdp: data.sdp
        });
        
        remoteScreen.audioConnection.setRemoteDescription(offer)
            .then(() => remoteScreen.audioConnection.createAnswer())
            .then(answer => {
                remoteScreen.audioConnection.setLocalDescription(answer);
                
                // Send answer back
                room.send({
                    type: "audioAnswer",
                    screenId: remoteScreen.screenId,
                    clientId: room.party.client.id,
                    targetClientId: remoteScreen.clientId,
                    sdp: answer.sdp
                });
            });
    }
}

function handleAudioAnswer(data) {
    // Skip answers not meant for us
    if (data.targetClientId !== room.party.client.id) return;
    
    // Find our screen
    const screen = screens.find(s => s.id === parseInt(data.screenId));
    
    if (screen && screen.audioConnection) {
        // Set remote description from answer
        const answer = new RTCSessionDescription({
            type: 'answer',
            sdp: data.sdp
        });
        
        screen.audioConnection.setRemoteDescription(answer);
    }
}

function handleAudioCandidate(data) {
    // Handle candidate for host
    if (data.targetClientId === room.party.client.id) {
        const screen = screens.find(s => s.id === parseInt(data.screenId));
        
        if (screen && screen.audioConnection) {
            screen.audioConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
    // Handle candidate for viewer
    else if (data.clientId !== room.party.client.id) {
        const remoteScreen = remoteScreens.find(
            s => s.clientId === data.clientId && s.screenId === parseInt(data.screenId)
        );
        
        if (remoteScreen && remoteScreen.audioConnection) {
            remoteScreen.audioConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
}