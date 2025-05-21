// Configuration constants
const SAMPLE_RATE = 16000;
const NUM_CHANNELS = 1;
const PLAY_TIME_RESET_THRESHOLD_MS = 1.0;
const AI_DISPLAY_SPEED = 50; // ms per character (slower = more natural)

// The protobuf type. Will be loaded later.
let Frame = null;

// WebSocket connection
let ws = null;

// Audio context and processing
let audioContext = null;
let source = null;
let microphoneStream = null;
let scriptProcessor = null;
let playTime = 0;
let lastMessageTime = 0;
let isPlaying = false;

// Visualizer variables
let visualizerCanvas = null;
let visualizerCtx = null;
let analyser = null;
let dataArray = null;
let animationFrame = null;

// Transcript container
let transcriptContainer = null;

// Speech detection variables
let isSpeaking = false;
let silenceTimeout = null;

// AI response tracking
let isAIResponding = false;

// Progressive text display
let aiMessageQueue = [];
let aiFullTranscript = "";
let aiCurrentIndex = 0;
let aiDisplayTimer = null;
let isDisplayingMessage = false;
let currentSpeechId = null; // Track current speech ID
let lastUserSpeakTimestamp = 0; // Track last user input time
let needNewAIRegion = true; // Flag to indicate a new AI region is needed

// UI elements
let startBtn = null;
let stopBtn = null;

// DOM ready function to initialize variables with DOM elements
document.addEventListener('DOMContentLoaded', function() {
    visualizerCanvas = document.getElementById('visualizer');
    if (visualizerCanvas) {
        visualizerCtx = visualizerCanvas.getContext('2d');
    }
    
    transcriptContainer = document.getElementById('transcript-container');
    startBtn = document.getElementById('startAudioBtn');
    stopBtn = document.getElementById('stopAudioBtn');
    
    // Initialize event listeners
    if (startBtn) startBtn.addEventListener('click', startAudioBtnHandler);
    if (stopBtn) stopBtn.addEventListener('click', stopAudioBtnHandler);
    
    // Initialize disabled state
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    
    // Load the protobuf definition
    protobuf.load('frames.proto', (err, root) => {
        if (err) {
            throw err;
        }
        Frame = root.lookupType('pipecat.Frame');
        const progressText = document.getElementById('progressText');
        if (progressText) {
            progressText.textContent = 'We are ready! Make sure to run the server and then click `Start Audio`.';
        }
        
        if (startBtn) startBtn.disabled = false;
    });
}); 