// Global variables
let socket = null;
let aiEnabled = true;
let audioContext = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let mediaStream = null;
let audioAnalyser = null;
let animationFrame = null;
let jitsiApi = null;

// DOM elements
const endMeetingBtn = document.getElementById('end-meeting');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const transcriptContainer = document.getElementById('transcript-container');
const audioVisualizer = document.getElementById('audio-visualizer');

// Initialize Socket.IO connection
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateAiStatus(false);
    });
    
    socket.on('ai_response', handleAiResponse);
}

// Initialize Jitsi Meet API
function initializeJitsiMeet(roomName) {
    // Create a completely random room name to avoid authentication issues
    const randomId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const simpleRoomName = 'aiop-' + randomId;
    
    // Get the domain from the server URL
    const domain = 'meet.jit.si';
    
    // Clear any existing content
    const meetingContainer = document.getElementById('meeting-container');
    meetingContainer.innerHTML = '';
    
    // Enhanced configuration for the Jitsi API to bypass authentication
    const options = {
        roomName: simpleRoomName,
        width: '100%',
        height: '600px',
        parentNode: meetingContainer,
        configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            prejoinPageEnabled: false,
            disableModeratorIndicator: true,
            enableClosePage: false,
            disableDeepLinking: true,
            // Disable authentication requirements
            enableUserRolesBasedOnToken: false,
            enableInsecureRoomNameWarning: false,
            requireDisplayName: false,
            enableNoisyMicDetection: false,
            enableNoAudioDetection: false,
            enableLobbyChat: false,
            p2p: {
                enabled: true,
                preferredCodec: 'VP9',
                disableH264: true,
                useStunTurn: true
            },
        },
        interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: [
                'microphone', 'camera', 'desktop', 'fullscreen',
                'hangup', 'chat', 'settings', 'raisehand',
                'videoquality', 'filmstrip', 'tileview'
            ],
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            DISABLE_FOCUS_INDICATOR: true,
            DEFAULT_REMOTE_DISPLAY_NAME: 'Participant',
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            GENERATE_ROOMNAMES_ON_WELCOME_PAGE: false,
            DISPLAY_WELCOME_PAGE_CONTENT: false,
            DISPLAY_WELCOME_PAGE_TOOLBAR_ADDITIONAL_CONTENT: false,
        },
        userInfo: {
            displayName: 'User'
        },
        configOverwrite: {
            // Basic configuration to avoid authentication
            prejoinPageEnabled: false,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            enableWelcomePage: false,
            enableClosePage: false,
            disableProfile: true,
            disableDeepLinking: true,
            p2p: {
                enabled: true
            }
        },
        interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: [
                'microphone', 'camera', 'desktop', 'fullscreen',
                'hangup', 'chat', 'settings', 'raisehand',
                'videoquality', 'filmstrip', 'tileview'
            ],
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            DEFAULT_BACKGROUND: '#ffffff',
            DEFAULT_REMOTE_DISPLAY_NAME: 'Participant',
            TOOLBAR_ALWAYS_VISIBLE: true,
            // Hide authentication-related UI elements
            SETTINGS_SECTIONS: ['devices', 'language'],
            SHOW_PROMOTIONAL_CLOSE_PAGE: false,
            AUTHENTICATION_ENABLE: false,
            GENERATE_ROOMNAMES_ON_WELCOME_PAGE: false,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true
        },
        userInfo: {
            displayName: 'User'
        }
    };
    
    jitsiApi = new JitsiMeetExternalAPI(domain, options);
    
    // Add event listeners
    jitsiApi.addListener('videoConferenceJoined', handleVideoConferenceJoined);
    jitsiApi.addListener('videoConferenceLeft', handleVideoConferenceLeft);
    jitsiApi.addListener('audioMuteStatusChanged', handleAudioMuteStatusChanged);
    jitsiApi.addListener('participantJoined', handleParticipantJoined);
    jitsiApi.addListener('participantLeft', handleParticipantLeft);
    
    endMeetingBtn.disabled = false;
}

// Event handler for when the local user joins the conference
function handleVideoConferenceJoined(event) {
    console.log('Video conference joined', event);
    
    // Get the local audio track to capture for AI processing
    if (aiEnabled) {
        setupAudioCapture();
    }
}

// Event handler for when the local user leaves the conference
function handleVideoConferenceLeft(event) {
    console.log('Video conference left', event);
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    updateAiStatus(false);
}

// Event handler for audio mute status changes
function handleAudioMuteStatusChanged(event) {
    console.log('Audio mute status changed', event);
    
    if (event.muted) {
        // Stop recording if the user mutes their microphone
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            isRecording = false;
        }
    } else if (aiEnabled) {
        // Resume recording if the user unmutes their microphone and AI is enabled
        setupAudioCapture();
    }
}

// Event handler for when a participant joins the conference
function handleParticipantJoined(event) {
    console.log('Participant joined', event);
    addMessageToTranscript('System', `${event.displayName} joined the meeting`, 'system');
}

// Event handler for when a participant leaves the conference
function handleParticipantLeft(event) {
    console.log('Participant left', event);
    addMessageToTranscript('System', `${event.displayName} left the meeting`, 'system');
}

// Setup audio capture from the Jitsi Meet conference
function setupAudioCapture() {
    console.log('Setting up audio capture...');
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Get the local audio stream from Jitsi Meet
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
            console.log('Got audio stream, setting up recorder...');
            mediaStream = stream;
            
            // Create a media recorder to capture audio with higher quality
            const options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 };
            mediaRecorder = new MediaRecorder(stream, options);
            
            mediaRecorder.ondataavailable = event => {
                console.log('Audio data available, size:', event.data.size);
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                console.log('Media recorder stopped, chunks:', audioChunks.length);
                if (audioChunks.length > 0 && aiEnabled) {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    console.log('Sending audio blob to server, size:', audioBlob.size);
                    sendAudioToServer(audioBlob);
                    audioChunks = [];
                }
                
                // Restart recording if AI is still enabled
                if (aiEnabled && !isRecording) {
                    startRecording();
                }
            };
            
            // Set up audio visualizer
            setupAudioVisualizer(stream);
            
            // Start recording
            startRecording();
            console.log('Started recording');
        })
        .catch(error => {
            console.error('Error accessing microphone:', error);
            addMessageToTranscript('System', 'Error accessing microphone. Please check permissions.', 'system');
        });
}

// Setup audio visualizer
function setupAudioVisualizer(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Create an analyzer node
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    
    // Create a source from the stream
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioAnalyser);
    
    // Start drawing the visualizer
    drawAudioVisualizer();
}

// Draw audio visualizer
function drawAudioVisualizer() {
    if (!audioAnalyser) return;
    
    // Get the canvas element by ID
    const canvas = document.getElementById('audio-visualizer');
    if (!canvas) {
        console.error('Audio visualizer canvas not found');
        return;
    }
    
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        if (!audioAnalyser) return;
        
        animationFrame = requestAnimationFrame(draw);
        
        audioAnalyser.getByteFrequencyData(dataArray);
        
        canvasCtx.fillStyle = '#f5f5f5';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            
            canvasCtx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    draw();
}

// Start recording audio
function startRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'recording') {
        console.log('Starting recording...');
        mediaRecorder.start();
        isRecording = true;
        
        // Stop recording after 3 seconds to process the audio
        // This is a good balance for real-time conversation
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                console.log('Stopping recording after timeout...');
                mediaRecorder.stop();
                isRecording = false;
            }
        }, 3000);
    }
}

// Send audio to the server for processing
function sendAudioToServer(audioBlob) {
    if (socket && socket.connected) {
        // Convert blob to base64 to send over socket.io
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            socket.emit('audio_data', base64Audio);
        };
        reader.readAsDataURL(audioBlob);
    }
}

// Handle AI response from the server
function handleAiResponse(data) {
    if (data.text) {
        addMessageToTranscript('AI Operator', data.text, 'ai');
    }
    
    if (data.audio) {
        // Play the audio response
        const audioBlob = base64ToBlob(data.audio, 'audio/mpeg');
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
    }
}

// Convert base64 to Blob
function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    
    return new Blob(byteArrays, { type: mimeType });
}

// Update AI status indicator
function updateAiStatus(isOnline) {
    aiEnabled = isOnline;
    
    if (isOnline) {
        statusIndicator.classList.remove('offline');
        statusIndicator.classList.add('online');
        statusText.textContent = 'Online';
    } else {
        statusIndicator.classList.remove('online');
        statusIndicator.classList.add('offline');
        statusText.textContent = 'Offline';
        
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            isRecording = false;
        }
    }
}

// Add message to the transcript container
function addMessageToTranscript(sender, message, type) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(`${type}-message`);
    
    const headerElement = document.createElement('div');
    headerElement.classList.add('message-header');
    headerElement.textContent = sender;
    
    const contentElement = document.createElement('div');
    contentElement.classList.add('message-content');
    contentElement.textContent = message;
    
    messageElement.appendChild(headerElement);
    messageElement.appendChild(contentElement);
    
    transcriptContainer.appendChild(messageElement);
    
    // Scroll to the bottom of the transcript container
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Fetch configuration from the server
    fetch('/api/config')
        .then(response => response.json())
        .then(config => {
            window.jitsiServerUrl = config.jitsi_server_url;
            window.jitsiRoomName = config.jitsi_room_name;
            window.botDisplayName = config.bot_display_name;
            
            // Initialize Socket.IO connection
            initializeSocket();
            
            // Automatically start the meeting
            setTimeout(() => {
                // Remove the iframe that might be causing issues
                const iframe = document.getElementById('jitsi-iframe');
                if (iframe) {
                    iframe.parentNode.removeChild(iframe);
                }
                
                // Initialize Jitsi with the API
                initializeJitsiMeet(window.jitsiRoomName);
                endMeetingBtn.disabled = false;
                
                // Always enable AI operator after a short delay
                setTimeout(() => {
                    aiEnabled = true;
                    updateAiStatus(true);
                    setupAudioCapture();
                }, 3000);
            }, 1000);
        })
        .catch(error => {
            console.error('Error fetching configuration:', error);
        });
    
    // End meeting button click handler
    endMeetingBtn.addEventListener('click', () => {
        if (jitsiApi) {
            jitsiApi.dispose();
            jitsiApi = null;
        }
        
        // Reload the page to restart everything
        window.location.reload();
    });
    
    // AI is always enabled by default
});
