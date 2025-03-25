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
let isStreamingAudio = false;
let streamingInterval = null;
let currentAudioResponse = null;
let audioQueue = [];
let isPlayingAudio = false;

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
        updateAiStatus(true);
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateAiStatus(false);
        stopAudioStreaming();
    });
    
    // Legacy handler
    socket.on('ai_response', handleAiResponse);
    
    // New streaming handlers
    socket.on('partial_transcript', handlePartialTranscript);
    socket.on('streaming_response', handleStreamingResponse);
    socket.on('streaming_audio', handleStreamingAudio);
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
        
        if (isStreamingAudio) {
            stopAudioStreaming();
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
            
            // Create a media recorder to capture audio with higher quality and smaller chunks
            // for real-time streaming - using WAV format which is directly supported by OpenAI
            let options;
            
            // Try to use WAV format first (directly supported by OpenAI)
            try {
                if (MediaRecorder.isTypeSupported('audio/wav')) {
                    options = { mimeType: 'audio/wav', audioBitsPerSecond: 128000 };
                } else if (MediaRecorder.isTypeSupported('audio/mp3')) {
                    options = { mimeType: 'audio/mp3', audioBitsPerSecond: 128000 };
                } else {
                    // Fallback to WebM if WAV is not supported
                    options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 };
                }
            } catch (e) {
                console.error('Error checking audio format support:', e);
                // Default fallback
                options = { audioBitsPerSecond: 128000 };
            }
            mediaRecorder = new MediaRecorder(stream, options);
            
            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    if (isStreamingAudio) {
                        // In streaming mode, immediately send each chunk
                        sendAudioChunkToServer(event.data);
                    } else {
                        // In batch mode, collect chunks
                        audioChunks.push(event.data);
                    }
                }
            };
            
            mediaRecorder.onstop = () => {
                if (!isStreamingAudio && audioChunks.length > 0 && aiEnabled) {
                    // In batch mode, send the complete audio blob
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    console.log('Sending audio blob to server, size:', audioBlob.size);
                    sendAudioToServer(audioBlob);
                    audioChunks = [];
                } else if (isStreamingAudio) {
                    // In streaming mode, signal the end of the stream
                    socket.emit('end_audio_stream');
                }
                
                // Restart recording if AI is still enabled
                if (aiEnabled && !isRecording) {
                    if (isStreamingAudio) {
                        startAudioStreaming();
                    } else {
                        startRecording();
                    }
                }
            };
            
            // Set up audio visualizer
            setupAudioVisualizer(stream);
            
            // Start streaming audio instead of batch recording
            startAudioStreaming();
            console.log('Started audio streaming');
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

// Start recording audio (batch mode)
function startRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'recording') {
        console.log('Starting batch recording...');
        audioChunks = [];
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

// Start streaming audio to server in real-time
function startAudioStreaming() {
    if (mediaRecorder && mediaRecorder.state !== 'recording') {
        console.log('Starting audio streaming...');
        isStreamingAudio = true;
        isRecording = true;
        
        // Use a shorter timeslice (100ms) to get more frequent ondataavailable events
        // This allows for more real-time streaming
        mediaRecorder.start(100);
        
        // Set a longer timeout for streaming mode (10 seconds)
        // This gives more time for natural conversation pauses
        clearTimeout(streamingInterval);
        streamingInterval = setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                console.log('Stopping streaming after timeout...');
                mediaRecorder.stop();
                isRecording = false;
            }
        }, 10000);
    }
}

// Stop audio streaming
function stopAudioStreaming() {
    isStreamingAudio = false;
    clearTimeout(streamingInterval);
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
    }
}

// Send audio to the server for processing (batch mode)
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

// Send audio chunk to server for real-time streaming
function sendAudioChunkToServer(audioChunk) {
    if (socket && socket.connected) {
        // Convert chunk to base64 to send over socket.io
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            // Send both the audio data and the format information
            socket.emit('audio_chunk', {
                data: base64Audio,
                format: audioChunk.type || 'audio/webm' // Include the MIME type
            });
            console.log('Sending audio chunk with format:', audioChunk.type || 'audio/webm');
        };
        reader.readAsDataURL(audioChunk);
    }
}

// Handle AI response from the server (legacy batch mode)
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

// Handle partial transcript from the server
function handlePartialTranscript(data) {
    const { text, is_final } = data;
    
    if (text) {
        if (is_final) {
            // Final transcript, add to the transcript area
            addMessageToTranscript('You', text, 'user');
        } else {
            // Partial transcript, update a temporary area
            updatePartialTranscript(text);
        }
    }
}

// Update the partial transcript display
function updatePartialTranscript(text) {
    // Check if we already have a partial transcript element
    let partialElement = document.getElementById('partial-transcript');
    
    if (!partialElement) {
        // Create a new partial transcript element
        partialElement = document.createElement('div');
        partialElement.id = 'partial-transcript';
        partialElement.className = 'message user partial';
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = 'You';
        
        const content = document.createElement('div');
        content.className = 'content';
        
        partialElement.appendChild(avatar);
        partialElement.appendChild(content);
        
        // Add it to the transcript container
        transcriptContainer.appendChild(partialElement);
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
    
    // Update the content
    const content = partialElement.querySelector('.content');
    if (content) {
        content.textContent = text + '...';
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
}

// Remove the partial transcript element
function clearPartialTranscript() {
    const partialElement = document.getElementById('partial-transcript');
    if (partialElement) {
        partialElement.remove();
    }
}

// Handle streaming text response from the server
function handleStreamingResponse(data) {
    const { text, is_final } = data;
    
    // Check if we already have a streaming response element
    let responseElement = document.getElementById('streaming-response');
    
    if (is_final) {
        // If this is the final chunk, remove the streaming element
        // The complete response will be added by the audio handler
        if (responseElement) {
            responseElement.remove();
        }
        return;
    }
    
    if (!responseElement) {
        // Create a new streaming response element
        responseElement = document.createElement('div');
        responseElement.id = 'streaming-response';
        responseElement.className = 'message ai streaming';
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = 'AI';
        
        const content = document.createElement('div');
        content.className = 'content';
        content.textContent = '';
        
        responseElement.appendChild(avatar);
        responseElement.appendChild(content);
        
        // Add it to the transcript container
        transcriptContainer.appendChild(responseElement);
    }
    
    // Update the content by appending the new text
    const content = responseElement.querySelector('.content');
    if (content) {
        content.textContent += text;
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
}

// Handle streaming audio from the server
function handleStreamingAudio(data) {
    const { audio, chunk_index, total_chunks, is_final } = data;
    
    if (!audio) return;
    
    // Convert the base64 audio to a blob
    const audioBlob = base64ToBlob(audio, 'audio/mpeg');
    
    // Add to the audio queue for sequential playback
    audioQueue.push({
        blob: audioBlob,
        index: chunk_index,
        total: total_chunks,
        isFinal: is_final
    });
    
    // Start playing if not already playing
    if (!isPlayingAudio) {
        playNextAudioChunk();
    }
}

// Play the next audio chunk in the queue
function playNextAudioChunk() {
    if (audioQueue.length === 0) {
        isPlayingAudio = false;
        return;
    }
    
    isPlayingAudio = true;
    const audioItem = audioQueue.shift();
    
    // Create an audio element
    const audioUrl = URL.createObjectURL(audioItem.blob);
    const audio = new Audio(audioUrl);
    
    // When this chunk finishes, play the next one
    audio.onended = () => {
        // Small delay between chunks for more natural speech
        setTimeout(() => {
            playNextAudioChunk();
        }, 50);
        
        // Clean up the URL object
        URL.revokeObjectURL(audioUrl);
    };
    
    // If this is the final chunk and there's a streaming response element,
    // replace it with a permanent message
    if (audioItem.isFinal) {
        const streamingElement = document.getElementById('streaming-response');
        if (streamingElement) {
            const content = streamingElement.querySelector('.content');
            if (content) {
                // Add the complete response to the transcript
                addMessageToTranscript('AI Operator', content.textContent, 'ai');
                // Remove the streaming element
                streamingElement.remove();
            }
        }
    }
    
    // Play the audio
    audio.play();
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
