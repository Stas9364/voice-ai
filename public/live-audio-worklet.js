/**
 * AudioWorklet for capturing microphone input (replaces deprecated ScriptProcessorNode).
 * Sends Float32Array chunks to the main thread via port.postMessage.
 */
class LiveAudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      this.port.postMessage(Float32Array.from(channel));
    }
    return true;
  }
}

registerProcessor("live-audio-processor", LiveAudioProcessor);
