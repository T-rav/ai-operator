// Visualizer variables
let visualizerCanvas = null;
let visualizerCtx = null;

// Initialize visualizer
function initVisualizer() {
  visualizerCanvas = document.getElementById('visualizer');
  visualizerCtx = visualizerCanvas.getContext('2d');
  
  // Set canvas size
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

// Resize canvas when window size changes
function resizeCanvas() {
  if (!visualizerCanvas) return;
  
  visualizerCanvas.width = visualizerCanvas.offsetWidth;
  visualizerCanvas.height = 100;
}

// Draw audio visualizer animation
function drawVisualizer() {
  if (!AI_AUDIO.analyser || !AI_STATE.isPlaying) return;

  AI_AUDIO.animationFrame = requestAnimationFrame(drawVisualizer);
  
  // Clear canvas
  visualizerCtx.fillStyle = '#f5f7fa';
  visualizerCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

  // Draw waveform (blue)
  AI_AUDIO.analyser.getByteTimeDomainData(AI_AUDIO.dataArray);
  visualizerCtx.lineWidth = 2;
  visualizerCtx.strokeStyle = '#3498db';
  visualizerCtx.beginPath();
  
  const sliceWidth = visualizerCanvas.width / AI_AUDIO.dataArray.length;
  let x = 0;

  for (let i = 0; i < AI_AUDIO.dataArray.length; i++) {
    const v = AI_AUDIO.dataArray[i] / 128.0;
    const y = v * visualizerCanvas.height / 2;

    if (i === 0) {
      visualizerCtx.moveTo(x, y);
    } else {
      visualizerCtx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  visualizerCtx.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
  visualizerCtx.stroke();
}

// Stop visualizer animation
function stopVisualizer() {
  if (AI_AUDIO.animationFrame) {
    cancelAnimationFrame(AI_AUDIO.animationFrame);
    AI_AUDIO.animationFrame = null;
  }
}

// Export visualizer functions
window.AI_VISUALIZER = {
  initVisualizer,
  drawVisualizer,
  stopVisualizer,
  resizeCanvas
}; 