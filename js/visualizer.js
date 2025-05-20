// Audio visualizer functions

// Set canvas size
function resizeCanvas() {
  if (!visualizerCanvas) return;
  visualizerCanvas.width = visualizerCanvas.offsetWidth;
  visualizerCanvas.height = 100;
}

// Visualizer animation function
function drawVisualizer() {
  if (!analyser || !isPlaying || !visualizerCtx) return;

  animationFrame = requestAnimationFrame(drawVisualizer);
  
  // Clear canvas
  visualizerCtx.fillStyle = '#f5f7fa';
  visualizerCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

  // Draw waveform (blue)
  analyser.getByteTimeDomainData(dataArray);
  visualizerCtx.lineWidth = 2;
  visualizerCtx.strokeStyle = '#3498db';
  visualizerCtx.beginPath();
  drawWaveform(dataArray, visualizerCtx);
  visualizerCtx.stroke();
}

function drawWaveform(dataArray, ctx) {
  if (!visualizerCanvas) return;
  
  const sliceWidth = visualizerCanvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = v * visualizerCanvas.height / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  ctx.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
}

// Initialize visualizer event listener
window.addEventListener('resize', resizeCanvas);

// Call this function when the page loads
function initVisualizer() {
  if (visualizerCanvas && visualizerCtx) {
    resizeCanvas();
  }
} 