class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._consecutiveFramesAboveThreshold = 0;
    this._requiredConsecutiveFrames = 3;
    this._speechThreshold = 0.03;
    this._isSpeaking = false;
  }

  calculateRMS(audioData) {
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    return Math.sqrt(sum / audioData.length);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const channel = input[0];

    if (!channel) return true;

    // Calculate RMS and check for speech
    const rms = this.calculateRMS(channel);
    
    if (rms > this._speechThreshold) {
      this._consecutiveFramesAboveThreshold++;
      
      if (!this._isSpeaking && this._consecutiveFramesAboveThreshold >= this._requiredConsecutiveFrames) {
        this._isSpeaking = true;
        this.port.postMessage({ type: 'speechStart', rms });
      }
    } else {
      this._consecutiveFramesAboveThreshold = 0;
      if (this._isSpeaking) {
        this._isSpeaking = false;
        this.port.postMessage({ type: 'speechEnd' });
      }
    }

    // Send audio data to main thread
    this.port.postMessage({
      type: 'audioData',
      audioData: channel
    });

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor); 