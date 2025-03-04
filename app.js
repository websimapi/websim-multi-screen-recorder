// Initialize the WebSocket connection
let room;
let isLive = false;
let screens = [];
let nextScreenId = 1;

document.addEventListener('DOMContentLoaded', () => {
    const addScreenBtn = document.getElementById('addScreenBtn');
    const goLiveBtn = document.getElementById('goLiveBtn');
    const screensContainer = document.getElementById('screens-container');
    const connectionStatus = document.getElementById('connectionStatus');

    // Initialize WebSocket connection
    room = new WebsimSocket();
    room.onopen = () => {
        console.log('WebSocket connection established');
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.add('online');
    };

    room.onclose = () => {
        console.log('WebSocket connection closed');
        connectionStatus.textContent = 'Offline';
        connectionStatus.classList.remove('online');
        isLive = false;
        updateLiveButton();
    };

    room.onmessage = (event) => {
        const data = event.data;
        
        if (data.type === 'screenShare') {
            // Handle incoming screen share data
            updateRemoteScreens(data);
        }
    };

    // Event listeners
    addScreenBtn.addEventListener('click', () => addNewScreen());
    goLiveBtn.addEventListener('click', toggleLive);

    // Setup drag and drop for screen containers
    setupDragAndDrop();
});

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
        recording: false
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
        
        // If we're live, broadcast the stream
        if (isLive) {
            sendScreenData(screenId);
        }
        
    } catch (error) {
        console.error('Error capturing screen:', error);
    }
}

function stopCapture(screenId) {
    const screen = screens.find(s => s.id === screenId);
    
    if (screen && screen.stream) {
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
        
        // Start sending screen data for each active screen
        screens.forEach(screen => {
            if (screen.recording) {
                sendScreenData(screen.id);
            }
        });
    } else {
        goLiveBtn.textContent = 'Go Live';
        goLiveBtn.classList.remove('active');
        
        // Stop sending screen data
        screens.forEach(screen => {
            // Could add logic to stop sending if needed
        });
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
        // For now, we just send a notification that the screen is being shared
        // In a real implementation, we might use WebRTC to share the actual video stream
        room.send({
            type: "screenShare",
            screenId: screenId,
            clientId: room.party.client.id,
            username: room.party.client.username,
            title: `Screen ${screenId} from ${room.party.client.username}`
        });
    }
}

function updateRemoteScreens(data) {
    // In a real implementation, this would handle incoming video streams
    console.log(`Received screen share from ${data.username}:`, data);
    
    // Here we would add remote screens or update existing ones
    // For now, we just log the event
}

// Drag and drop functionality
function setupDragAndDrop() {
    const screensContainer = document.getElementById('screens-container');
    
    screensContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggable = document.querySelector('.is-dragging');
        
        // Find the closest screen element we're dragging over
        const afterElement = getDragAfterElement(screensContainer, e.clientY, e.clientX);
        
        if (afterElement == null) {
            screensContainer.appendChild(draggable);
        } else {
            screensContainer.insertBefore(draggable, afterElement);
        }
    });
}

function handleDragStart(e) {
    e.target.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.target.dataset.id);
    
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

