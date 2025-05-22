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
    
    // Periodically log audio data stats
    if (this._logCounter === undefined) {
      this._logCounter = 0;
    }
    this._logCounter++;
    
    // Log every 100 frames (about 2 seconds)
    if (this._logCounter % 100 === 0) {
      // Create stats to send to main thread
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let sum = 0;
      let nonZeros = 0;
      
      for (let i = 0; i < channel.length; i++) {
        min = Math.min(min, channel[i]);
        max = Math.max(max, channel[i]);
        sum += channel[i];
        if (channel[i] !== 0) {
          nonZeros++;
        }
      }
      
      // Send stats to main thread
      this.port.postMessage({
        type: 'audioStats',
        stats: {
          length: channel.length,
          min: min,
          max: max,
          avg: sum / channel.length,
          rms: rms,
          nonZeroPercent: (nonZeros / channel.length) * 100
        }
      });
    }
    
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