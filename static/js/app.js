// Global variables
let websocket = null;
let aiEnabled = true;
let audioContext = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let mediaStream = null;
let audioAnalyser = null;
let animationFrame = null;
let isStreamingAudio = false;
let streamingInterval = null;
let currentAudioResponse = null;
let audioQueue = [];
let isPlayingAudio = false;
let audioEnabled = false;
let websocketUrl = null;

// DOM elements
const toggleMicBtn = document.getElementById('toggle-mic');
const endSessionBtn = document.getElementById('end-session');
const transcriptContainer = document.getElementById('transcript-container');
const audioVisualizer = document.getElementById('audio-visualizer');

// Initialize WebSocket connection to Pipecat server
function initializeWebSocket() {
    // Get the WebSocket URL from the server config
    fetch('/api/config')
        .then(response => response.json())
        .then(config => {
            websocketUrl = config.websocket_url;
            console.log('WebSocket URL:', websocketUrl);
            connectWebSocket();
            
            // Set up a periodic ping to keep the connection alive
            setInterval(() => {
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    // Send a small ping message to keep the connection alive
                    try {
                        // Send a simple ping message as a JSON string
                        const pingMessage = JSON.stringify({ type: 'ping' });
                        websocket.send(pingMessage);
                        console.log('Sent ping to keep connection alive');
                    } catch (error) {
                        console.error('Error sending ping:', error);
                    }
                }
            }, 30000); // Send a ping every 30 seconds
        })
        .catch(error => {
            console.error('Error fetching config:', error);
            // Use default WebSocket URL if config fetch fails
            websocketUrl = `ws://${window.location.hostname}:8765/ws`;
            connectWebSocket();
        });
}

// Connect to the Pipecat WebSocket server
function connectWebSocket() {
    if (websocket && websocket.readyState !== WebSocket.CLOSED) {
        console.log('WebSocket already connected, state:', websocket.readyState);
        return;
    }
    
    // If the URL contains 0.0.0.0, replace it with localhost
    if (websocketUrl.includes('0.0.0.0')) {
        websocketUrl = websocketUrl.replace('0.0.0.0', 'localhost');
        console.log('Adjusted WebSocket URL to use localhost:', websocketUrl);
    }
    
    // Ensure the URL has the correct format
    if (!websocketUrl.startsWith('ws://')) {
        websocketUrl = 'ws://' + websocketUrl;
    }
    if (!websocketUrl.endsWith('/ws')) {
        websocketUrl = websocketUrl.endsWith('/') ? websocketUrl + 'ws' : websocketUrl + '/ws';
    }
    
    console.log('Connecting to WebSocket server at:', websocketUrl);
    
    try {
        // Create a new WebSocket connection
        websocket = new WebSocket(websocketUrl);
        
        // Set binary type to arraybuffer for better compatibility
        websocket.binaryType = 'arraybuffer';
        
        websocket.onopen = (event) => {
            console.log('Connected to Pipecat WebSocket server', event);
            updateAiStatus(true);
            
            // Don't send any handshake message - Pipecat expects binary audio data only
            console.log('WebSocket connection established, ready to send audio data');
            
            // Start sending audio immediately if we're in streaming mode
            if (isStreamingAudio && mediaRecorder && mediaRecorder.state !== 'recording') {
                console.log('Automatically starting audio streaming after connection');
                startAudioStreaming();
            }
        };
        
        websocket.onclose = (event) => {
            console.log('WebSocket closed - Code:', event.code, 'Reason:', event.reason, 'Clean:', event.wasClean);
            updateAiStatus(false);
            stopAudioStreaming();
            
            // Log detailed information about the connection state
            console.log('Connection was in state:', websocket.readyState, 'before closing');
            console.log('Audio streaming was:', isStreamingAudio ? 'active' : 'inactive');
            
            // Attempt to reconnect after a delay
            setTimeout(() => {
                if (aiEnabled) {
                    console.log('Attempting to reconnect WebSocket...');
                    connectWebSocket();
                }
            }, 3000);
        };
        
        websocket.onerror = (error) => {
            console.error('WebSocket error occurred:', error);
            // Log more details about the connection state
            console.log('Connection state at error:', websocket.readyState);
        };
        
        websocket.onmessage = (event) => {
            try {
                console.log('Received message from server, type:', typeof event.data);
                
                // Parse the message from Pipecat
                const data = event.data;
                if (data instanceof ArrayBuffer || data instanceof Blob) {
                    // Handle binary audio data
                    console.log('Received binary audio data, size:', data.byteLength || data.size);
                    handleIncomingAudio(data);
                } else {
                    // Handle text data (JSON)
                    console.log('Received text message:', data.substring(0, 100) + '...');
                    const jsonData = JSON.parse(data);
                    handlePipecatMessage(jsonData);
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
                console.log('Raw message data:', event.data);
            }
        };
    } catch (error) {
        console.error('Error creating WebSocket connection:', error);
        
        // Try with a fallback URL using localhost and explicit port
        websocketUrl = `ws://localhost:8765/ws`;
        console.log('Trying fallback WebSocket URL:', websocketUrl);
        setTimeout(connectWebSocket, 1000);
    }
}

// Initialize media devices and UI elements
function initializeMediaDevices() {
    // Set up event listeners for control buttons
    toggleMicBtn.addEventListener('click', toggleMicrophone);
    endSessionBtn.addEventListener('click', endSession);
    
    // Disable end session button until connected
    endSessionBtn.disabled = true;
    
    // Initialize the audio visualizer
    initializeAudioVisualizer();
}

// Toggle microphone on/off
function toggleMicrophone() {
    if (audioEnabled) {
        // Turn off microphone
        stopAudioCapture();
        toggleMicBtn.textContent = 'Start';
        toggleMicBtn.classList.remove('active');
        audioEnabled = false;
    } else {
        // Turn on microphone
        startAudioCapture();
        toggleMicBtn.textContent = 'Stop';
        toggleMicBtn.classList.add('active');
        audioEnabled = true;
    }
}



// End the current session
function endSession() {
    // Stop all media tracks
    stopAudioCapture();
    
    // Reset UI
    toggleMicBtn.textContent = 'Start';
    toggleMicBtn.classList.remove('active');
    
    // Update status
    audioEnabled = false;
    
    // Close WebSocket connection
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
    }
    
    addMessageToTranscript('System', 'Session ended', 'system');
}

// Start audio capture
function startAudioCapture() {
    if (mediaStream && mediaStream.getAudioTracks().length > 0) {
        // If we already have a stream with audio, just enable it
        mediaStream.getAudioTracks().forEach(track => track.enabled = true);
        setupAudioProcessing();
        return;
    }
    
    // Request audio access
    navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000 // Optimized for speech recognition
        }
    })
    .then(stream => {
        // If we already have a video stream, add the audio tracks to it
        if (mediaStream && mediaStream.getVideoTracks().length > 0) {
            const videoTrack = mediaStream.getVideoTracks()[0];
            mediaStream = new MediaStream([videoTrack, ...stream.getAudioTracks()]);
            localVideo.srcObject = mediaStream;
        } else {
            mediaStream = stream;
        }
        
        setupAudioProcessing();
        endSessionBtn.disabled = false;
    })
    .catch(error => {
        console.error('Error accessing microphone:', error);
        addMessageToTranscript('System', 'Error accessing microphone. Please check permissions.', 'system');
        toggleMicBtn.textContent = 'Start Microphone';
        toggleMicBtn.classList.remove('active');
        audioEnabled = false;
    });
}

// Stop audio capture
function stopAudioCapture() {
    if (mediaStream) {
        // Stop all audio tracks
        mediaStream.getAudioTracks().forEach(track => {
            track.enabled = false;
            track.stop();
        });
    }
    
    // Stop audio processing
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
    }
    
    if (isStreamingAudio) {
        stopAudioStreaming();
    }
    
    // Clean up audio context
    if (audioContext) {
        try {
            audioContext.close().catch(err => console.error('Error closing audio context:', err));
            audioContext = null;
            audioAnalyser = null;
            
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
        } catch (e) {
            console.error('Error cleaning up audio context:', e);
        }
    }
}



// Setup audio processing for streaming to the server
function setupAudioProcessing() {
    console.log('Setting up audio processing...');
    
    // Initialize audio context if needed
    try {
        // Close previous context if it exists to prevent memory leaks
        if (audioContext) {
            audioContext.close().catch(err => console.error('Error closing audio context:', err));
        }
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Created new audio context, state:', audioContext.state);
        
        // Resume the audio context if it's suspended (needed for some browsers)
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed successfully');
            }).catch(err => {
                console.error('Failed to resume AudioContext:', err);
            });
        }
    } catch (e) {
        console.error('Error initializing AudioContext:', e);
    }
    
    // Setup the audio visualizer
    setupAudioVisualizer(mediaStream);
    
    // Create a media recorder optimized for real-time streaming
    let options;
    
    // Pipecat works best with raw PCM audio data
    try {
        console.log('Setting up audio recording with format compatible with Pipecat');
        
        // First try PCM format if supported
        if (MediaRecorder.isTypeSupported('audio/wav')) {
            options = { mimeType: 'audio/wav', audioBitsPerSecond: 16000 };
            console.log('Using WAV format for recording');
        } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 };
            console.log('Using WebM with Opus codec for recording');
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            options = { mimeType: 'audio/webm', audioBitsPerSecond: 16000 };
            console.log('Using WebM format for recording');
        } else {
            // Fallback options if WebM is not supported
            console.log('WebM not supported, trying alternative formats');
            if (MediaRecorder.isTypeSupported('audio/mp3')) {
                options = { mimeType: 'audio/mp3', audioBitsPerSecond: 16000 };
                console.log('Using MP3 format for recording');
            } else {
                // Last resort fallback
                console.log('No specific format supported, using browser default');
                options = { audioBitsPerSecond: 16000 };
            }
        }
    } catch (e) {
        console.error('Error checking audio format support:', e);
        // Default fallback
        options = { audioBitsPerSecond: 16000 };
    }
    
    mediaRecorder = new MediaRecorder(mediaStream, options);
    
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
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/wav' });
            console.log('Sending audio blob to server, size:', audioBlob.size);
            sendAudioToServer(audioBlob);
            audioChunks = [];
        } else if (isStreamingAudio && websocket && websocket.readyState === WebSocket.OPEN) {
            // In streaming mode, signal the end of the stream by sending an empty chunk
            const emptyChunk = new Blob([], { type: 'audio/webm' });
            websocket.send(emptyChunk);
        }
        
        // Restart recording if AI is still enabled
        if (aiEnabled && !isRecording && audioEnabled) {
            if (isStreamingAudio) {
                startAudioStreaming();
            } else {
                startRecording();
            }
        }
    };
    
    // Start streaming audio to Pipecat WebSocket server
    startAudioStreaming();
    console.log('Started real-time audio streaming with Pipecat');
}



// Setup audio visualizer
function setupAudioVisualizer(stream) {
    console.log('Setting up audio visualizer...');
    
    // Initialize audio context if it doesn't exist
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Created new audio context for visualizer');
        } catch (e) {
            console.error('Failed to create audio context:', e);
            return;
        }
    }
    
    // Cancel any existing animation frame to prevent multiple visualizers
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    
    // Create a new analyzer node
    try {
        // Create a new analyzer
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        
        // Try to get Jitsi track first if no stream provided
        if (!stream) {
            const jitsiTrack = getJitsiAudioTrack();
            if (jitsiTrack) {
                console.log('Using Jitsi audio track for visualizer');
                stream = new MediaStream([jitsiTrack]);
            }
        }
        
        // If we still don't have a stream, create a silent audio node
        if (!stream) {
            console.log('No audio stream available, creating silent oscillator for visualization');
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.setValueAtTime(0, audioContext.currentTime); // Silent
            const gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(0, audioContext.currentTime); // Silent
            oscillator.connect(gainNode);
            gainNode.connect(audioAnalyser);
            oscillator.start();
        } else {
            // Create a source from the stream
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(audioAnalyser);
        }
        
        console.log('Audio visualizer setup complete');
        
        // Start drawing the visualizer
        drawAudioVisualizer();
    } catch (e) {
        console.error('Error setting up audio visualizer:', e);
    }
}

// Draw audio visualizer
function drawAudioVisualizer() {
    console.log('Drawing audio visualizer...');
    
    // Check if we have the necessary components
    if (!audioAnalyser || !audioContext) {
        console.warn('Audio analyzer or context not available for visualization');
        return;
    }
    
    // Get the canvas element by ID
    const canvas = document.getElementById('audio-visualizer');
    if (!canvas) {
        console.error('Audio visualizer canvas not found');
        return;
    }
    
    // Make sure canvas is properly sized
    if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = 600;
        canvas.height = 100;
    }
    
    // Clear any existing animation frame to prevent multiple animations
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Fill with initial data to ensure something is displayed
    for (let i = 0; i < bufferLength; i++) {
        dataArray[i] = Math.floor(Math.random() * 20); // Random low values for initial state
    }
    
    // Initial clear of canvas
    canvasCtx.fillStyle = '#f5f5f5';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Log that we're starting visualization
    console.log('Starting audio visualization with buffer length:', bufferLength);
    
    function draw() {
        // Safety check to ensure we still have the analyzer
        if (!audioAnalyser || !audioContext) {
            console.warn('Audio analyzer no longer available, stopping visualization');
            return;
        }
        
        // Request next frame first to ensure smooth animation
        animationFrame = requestAnimationFrame(draw);
        
        try {
            // Get frequency data
            audioAnalyser.getByteFrequencyData(dataArray);
            
            // Clear canvas
            canvasCtx.fillStyle = '#f5f5f5';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Check if we're getting any audio data (not all zeros)
            let hasAudioData = false;
            for (let i = 0; i < bufferLength; i++) {
                if (dataArray[i] > 0) {
                    hasAudioData = true;
                    break;
                }
            }
            
            if (!hasAudioData) {
                // If no audio data, draw a flat line
                canvasCtx.beginPath();
                canvasCtx.moveTo(0, canvas.height / 2);
                canvasCtx.lineTo(canvas.width, canvas.height / 2);
                canvasCtx.strokeStyle = 'rgb(150, 150, 150)';
                canvasCtx.stroke();
                return;
            }
            
            // Draw frequency bars
            const barWidth = (canvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                barHeight = dataArray[i] / 2;
                
                // Use a gradient color based on frequency
                canvasCtx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
                canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                x += barWidth + 1;
            }
        } catch (e) {
            console.error('Error in audio visualization:', e);
            // Don't cancel animation frame here, just log the error and continue
        }
    }
    
    // Start the visualization loop
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
        
        // Before starting to stream, make sure we have a valid WebSocket connection
        if (!websocket || websocket.readyState !== WebSocket.OPEN) {
            console.log('WebSocket not connected, attempting to connect before streaming...');
            connectWebSocket();
            
            // Wait a short time for the connection to establish
            setTimeout(() => {
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    console.log('WebSocket connected, now starting audio streaming');
                    startAudioRecording();
                } else {
                    console.error('Could not establish WebSocket connection for streaming');
                }
            }, 1000);
        } else {
            // WebSocket is already connected, start recording immediately
            startAudioRecording();
        }
    }
}

// Start the actual audio recording process
function startAudioRecording() {
    // Use a shorter timeslice (50ms) to get more frequent ondataavailable events
    // This allows for more real-time streaming with lower latency
    mediaRecorder.start(50);
    
    // Set a longer timeout for streaming mode (30 seconds)
    // This gives more time for natural conversation pauses
    clearTimeout(streamingInterval);
    streamingInterval = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log('Stopping streaming after timeout...');
            mediaRecorder.stop();
            isRecording = false;
        }
    }, 30000);
}

// Stop audio streaming
function stopAudioStreaming() {
    isStreamingAudio = false;
    clearTimeout(streamingInterval);
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
    }
    
    // Send an empty audio chunk to signal the end of audio streaming
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        // Create an empty audio chunk to signal the end of streaming
        const emptyChunk = new Blob([], { type: 'audio/webm' });
        websocket.send(emptyChunk);
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

// Send audio chunk to Pipecat WebSocket server for real-time streaming
function sendAudioChunkToServer(audioChunk) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        try {
            // Convert the Blob to ArrayBuffer for Pipecat compatibility
            const reader = new FileReader();
            
            reader.onload = function() {
                try {
                    // Get the ArrayBuffer from the reader result
                    const audioData = reader.result;
                    
                    // Create a simple wrapper for the audio data
                    // This is a minimal implementation to get it working
                    // We're just sending the raw audio data without any metadata
                    // Pipecat will handle the rest on the server side
                    websocket.send(audioData);
                    
                    // Log less frequently to reduce console spam
                    if (Math.random() < 0.01) { // Only log about 1% of chunks
                        console.log('Sent audio chunk, size:', audioData.byteLength, 'bytes');
                    }
                } catch (error) {
                    console.error('Error sending audio data:', error);
                }
            };
            
            reader.onerror = function() {
                console.error('Error reading audio chunk as ArrayBuffer');
            };
            
            // Start reading the Blob as an ArrayBuffer
            reader.readAsArrayBuffer(audioChunk);
        } catch (error) {
            console.error('Error processing audio chunk:', error);
        }
    } else if (!websocket || websocket.readyState === WebSocket.CLOSED) {
        // Try to reconnect if the websocket is closed
        console.log('WebSocket is closed, attempting to reconnect...');
        connectWebSocket();
    }
}

// Handle incoming audio from Pipecat
function handleIncomingAudio(audioBlob) {
    // Create an audio URL and play it
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    // Play the audio
    audio.oncanplaythrough = () => {
        audio.play()
            .catch(error => console.error('Error playing audio:', error));
    };
    
    // Clean up URL object after playing
    audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
    };
}

// Handle Pipecat JSON messages
function handlePipecatMessage(message) {
    console.log('Received Pipecat message:', message);
    
    // Handle different message types based on the frame type
    if (message.frame_type === 'text') {
        // Handle text frames (transcripts or AI responses)
        handlePipecatTextFrame(message);
    } else if (message.frame_type === 'end') {
        // Handle end of conversation
        console.log('Conversation ended by server');
        endSession();
    }
}

// Handle Pipecat text frames
function handlePipecatTextFrame(message) {
    if (!message.text) return;
    
    // Determine if this is a user transcript or AI response based on metadata
    if (message.metadata && message.metadata.source === 'stt') {
        // This is a transcript of user speech
        if (message.metadata.is_final) {
            // Final transcript, add to the transcript area
            addMessageToTranscript('You', message.text, 'user');
        } else {
            // Partial transcript, update a temporary area
            updatePartialTranscript(message.text);
        }
    } else if (message.metadata && message.metadata.source === 'llm') {
        // This is an AI response
        addMessageToTranscript('AI Operator', message.text, 'ai');
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

// Variable to store the complete AI response text
let completeAiResponseText = '';

// Handle audio data for visualization
function handleAudioData(data) {
    console.log('Received audio data for visualization:', data);
    
    // If we don't have an audio visualizer set up yet, initialize it
    if (!audioAnalyser || !audioContext) {
        initializeAudioVisualizer();
    }
    
    // Update the visualizer with the received data
    if (audioAnalyser) {
        // Create some fake frequency data based on the buffer size and speech detection
        const bufferLength = audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // If speech is detected, create more active visualization
        if (data.has_speech) {
            // Generate more active visualization for speech
            for (let i = 0; i < bufferLength; i++) {
                // Create a wave-like pattern with higher values
                dataArray[i] = 50 + Math.floor(Math.sin(i / 2) * 50 + Math.random() * 50);
            }
        } else {
            // Generate subtle background noise for silence
            for (let i = 0; i < bufferLength; i++) {
                dataArray[i] = Math.floor(Math.random() * 20);
            }
        }
        
        // Override the analyzer's getByteFrequencyData method temporarily
        const originalMethod = audioAnalyser.getByteFrequencyData;
        audioAnalyser.getByteFrequencyData = function(array) {
            array.set(dataArray);
            
            // Restore the original method after a short delay
            setTimeout(() => {
                audioAnalyser.getByteFrequencyData = originalMethod;
            }, 100);
        };
    }
}

// Handle welcome message from the server
function handleWelcomeMessage(data) {
    console.log('Received welcome message:', data.text);
    
    // Add the welcome message to the transcript
    addMessageToTranscript('AI', data.text, 'ai');
    
    // Make sure audio is initialized and ready
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContext.resume().then(() => {
                console.log('Audio context resumed for welcome message');
            });
        } catch (e) {
            console.error('Failed to create audio context for welcome message:', e);
        }
    } else {
        audioContext.resume().then(() => {
            console.log('Existing audio context resumed for welcome message');
        });
    }
}

// Handle streaming text response from the server
function handleStreamingResponse(data) {
    console.log('Received streaming response:', data);
    const { text, is_final } = data;
    
    // Check if we already have a streaming response element
    let responseElement = document.getElementById('streaming-response');
    
    if (is_final) {
        // If this is the final chunk, store the complete text in a global variable
        // so the audio handler can access it
        if (responseElement) {
            const content = responseElement.querySelector('.content');
            if (content) {
                completeAiResponseText = content.textContent;
                console.log('Stored complete AI response:', completeAiResponseText);
            }
            // Don't remove the element yet, let the audio handler do it
        }
        return;
    }
    
    // For non-final chunks, append the text to build the complete response
    
    if (!responseElement) {
        // Create a new streaming response element
        responseElement = document.createElement('div');
        responseElement.id = 'streaming-response';
        responseElement.className = 'message ai streaming';
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = 'AI';  // This will be displayed in the avatar
        
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

// Handle streaming audio from the server (legacy non-real-time method)
function handleStreamingAudio(data) {
    console.log('Received streaming audio chunk:', data.chunk_index, 'of', data.total_chunks, 'is_final:', data.is_final);
    const { audio, chunk_index, total_chunks, is_final } = data;
    
    if (!audio) return;
    
    // Convert the base64 audio to a blob - OpenAI TTS API returns MP3
    const audioBlob = base64ToBlob(audio, 'audio/mp3');
    console.log('Created audio blob with MIME type: audio/mp3');
    
    // Add to the audio queue for sequential playback
    audioQueue.push({
        blob: audioBlob,
        index: chunk_index,
        total: total_chunks,
        isFinal: is_final
    });
    
    // Log that we received audio for playback
    console.log('Preparing to play audio chunk:', chunk_index, 'of', total_chunks);
    
    // Start playing if not already playing
    if (!isPlayingAudio) {
        playNextAudioChunk();
    }
}



// Play the next audio chunk in the queue
function playNextAudioChunk() {
    if (audioQueue.length === 0) {
        console.log('Audio queue is empty, stopping playback');
        isPlayingAudio = false;
        return;
    }
    
    isPlayingAudio = true;
    const audioItem = audioQueue.shift();
    
    // Create an audio element
    const audioUrl = URL.createObjectURL(audioItem.blob);
    console.log(`Created audio URL for chunk ${audioItem.index + 1}/${audioItem.total}: ${audioUrl}`);
    const audio = new Audio(audioUrl);
    
    // Add error handler
    audio.onerror = (e) => {
        console.error(`Error playing audio chunk ${audioItem.index + 1}/${audioItem.total}:`, e);
        console.error('Audio error code:', audio.error ? audio.error.code : 'unknown');
        console.error('Audio error message:', audio.error ? audio.error.message : 'unknown');
        
        // Continue with next chunk despite error
        setTimeout(() => {
            URL.revokeObjectURL(audioUrl);
            playNextAudioChunk();
        }, 50);
    };
    
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
        console.log('Final audio chunk, adding permanent message to transcript');
        const streamingElement = document.getElementById('streaming-response');
        
        // Use the stored complete text if available
        if (completeAiResponseText) {
            console.log('Using stored complete AI response:', completeAiResponseText);
            // Add the complete response to the transcript
            addMessageToTranscript('AI Operator', completeAiResponseText, 'ai');
            
            // Reset the stored text for the next response
            completeAiResponseText = '';
            
            // Remove the streaming element if it exists
            if (streamingElement) {
                streamingElement.remove();
            }
        } else if (streamingElement) {
            // Fallback to the streaming element content if available
            const content = streamingElement.querySelector('.content');
            if (content) {
                console.log('Found streaming content:', content.textContent);
                // Add the complete response to the transcript
                addMessageToTranscript('AI Operator', content.textContent, 'ai');
                // Remove the streaming element
                streamingElement.remove();
            } else {
                console.error('No content element found in streaming response');
                // Only add a fallback message if this isn't the welcome message
                const messages = document.querySelectorAll('.message.ai');
                if (messages.length > 1) { // If we already have at least one AI message (welcome message)
                    addMessageToTranscript('AI Operator', 'I heard you, but I need more information to respond properly.', 'ai');
                }
            }
        } else {
            console.log('No streaming response element found for final audio chunk');
            // Don't add a fallback message here - it's likely the welcome message or another valid response
            // that doesn't have a streaming element yet
        }
    }
    
    // Play the audio
    console.log(`Playing audio chunk ${audioItem.index + 1}/${audioItem.total}`);
    audio.play()
        .then(() => {
            console.log(`Started playing audio chunk ${audioItem.index + 1}/${audioItem.total}`);
        })
        .catch(error => {
            console.error(`Failed to play audio chunk ${audioItem.index + 1}/${audioItem.total}:`, error);
            // Try to continue with next chunk despite error
            setTimeout(() => {
                URL.revokeObjectURL(audioUrl);
                playNextAudioChunk();
            }, 50);
        });
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

// Update AI status
function updateAiStatus(isOnline) {
    aiEnabled = isOnline;
    
    if (!isOnline && mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
    }
}

// Add message to the transcript container
function addMessageToTranscript(sender, message, type) {
    console.log('Adding message to transcript:', { sender, type, messageLength: message?.length });
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(type); // Use the CSS class for styling (user, ai, system)
    
    // Create avatar element
    const avatarElement = document.createElement('div');
    avatarElement.classList.add('avatar');
    
    // Use specific text for different sender types
    if (sender === 'You') {
        avatarElement.textContent = sender;
    } else if (sender === 'AI Operator' || sender === 'AI') {
        avatarElement.textContent = 'AI';
    } else {
        avatarElement.textContent = sender.charAt(0).toUpperCase(); // First letter of sender name
    }
    
    // Create content element
    const contentElement = document.createElement('div');
    contentElement.classList.add('content');
    contentElement.textContent = message;
    
    // Add elements to message container
    messageElement.appendChild(avatarElement);
    messageElement.appendChild(contentElement);
    
    // Add to transcript container
    transcriptContainer.appendChild(messageElement);
    
    // Scroll to the bottom of the transcript container
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    
    // Log for debugging
    console.log(`Added ${type} message from ${sender}: ${message.substring(0, 30)}...`);
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Fetch configuration from the server
    fetch('/api/config')
        .then(response => response.json())
        .then(config => {
            window.botDisplayName = config.bot_display_name;
            
            // Initialize Pipecat WebSocket connection
            initializeWebSocket();
            
            // Initialize media devices (which also initializes the audio visualizer)
            initializeMediaDevices();
            
            // Enable AI operator
            aiEnabled = true;
            updateAiStatus(true);
            
            // Add welcome message to transcript
            addMessageToTranscript('System', 'Application initialized. Click "Start" to begin.', 'system');
        })
        .catch(error => {
            console.error('Error fetching configuration:', error);
            addMessageToTranscript('System', 'Error initializing application. Please reload the page.', 'system');
        });
});

// Initialize audio visualizer without waiting for audio stream
function initializeAudioVisualizer() {
    console.log('Initializing audio visualizer on page load');
    
    // Create audio context if it doesn't exist
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('Failed to create audio context:', e);
            return;
        }
    }
    
    // Create analyzer
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    
    // Create silent oscillator for initial visualization
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.setValueAtTime(0, audioContext.currentTime);
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(audioAnalyser);
    oscillator.start();
    
    // Start drawing
    drawAudioVisualizer();
}
