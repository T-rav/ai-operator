// AudioWorkletProcessor and AudioWorkletGlobalScope are only available inside worklets
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._consecutiveFramesAboveThreshold = 0;
    this._consecutiveFramesBelowThreshold = 0;
    this._requiredConsecutiveFrames = 3;
    this._requiredSilenceFrames = 25; // About 500ms of silence needed to end speech
    this._speechThreshold = 0.015; // Lower threshold to better detect quiet speech
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
      this._consecutiveFramesBelowThreshold = 0;
      
      if (!this._isSpeaking && this._consecutiveFramesAboveThreshold >= this._requiredConsecutiveFrames) {
        this._isSpeaking = true;
        this.port.postMessage({ type: 'speechStart', rms });
      }
    } else {
      this._consecutiveFramesAboveThreshold = 0;
      if (this._isSpeaking) {
        this._consecutiveFramesBelowThreshold++;
        // Only end speech after enough silence frames
        if (this._consecutiveFramesBelowThreshold >= this._requiredSilenceFrames) {
          this._isSpeaking = false;
          this._consecutiveFramesBelowThreshold = 0;
          this.port.postMessage({ type: 'speechEnd' });
        }
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

// Register the processor in the worklet scope
registerProcessor('audio-processor', AudioProcessor); 