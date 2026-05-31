import { AudioSettings } from "../../../shared/types";

export class AudioMixer {
  private context?: AudioContext;
  private destination?: MediaStreamAudioDestinationNode;
  private micGain?: GainNode;
  private systemGain?: GainNode;
  private ownedStreams: MediaStream[] = [];
  private keyDown = false;
  private keyHandler?: (event: KeyboardEvent) => void;
  private keyUpHandler?: (event: KeyboardEvent) => void;

  async build(systemStream: MediaStream | undefined, settings: AudioSettings): Promise<MediaStream> {
    this.dispose();
    this.context = new AudioContext();
    this.destination = this.context.createMediaStreamDestination();
    await this.context.resume().catch(() => undefined);

    if (settings.system && systemStream?.getAudioTracks().length) {
      this.systemGain = this.context.createGain();
      this.systemGain.gain.value = 1;
      this.context.createMediaStreamSource(systemStream).connect(this.systemGain).connect(this.destination);
    }

    if (settings.microphone) {
      await this.enableMicrophone(settings);
    }

    return this.destination.stream;
  }

  async enableMicrophone(settings: AudioSettings): Promise<boolean> {
    if (!this.context || !this.destination) {
      return false;
    }
    if (this.micGain) {
      this.micGain.gain.value = settings.pushToTalk ? 0 : settings.gain;
      return true;
    }

    try {
      const micStream = await getMicrophoneStream(settings);
      this.ownedStreams.push(micStream);
      this.micGain = this.context.createGain();
      this.micGain.gain.value = settings.pushToTalk ? 0 : settings.gain;
      this.context.createMediaStreamSource(micStream).connect(this.micGain).connect(this.destination);

      if (settings.pushToTalk) {
        this.installPushToTalk(settings.pushToTalkKey, settings.gain);
      }
      return true;
    } catch (error) {
      console.warn("Microphone capture is unavailable; continuing without microphone audio.", error);
      return false;
    }
  }

  private installPushToTalk(key: string, gain: number): void {
    const normalized = normalizeKey(key);
    this.keyHandler = (event) => {
      if (normalizeKey(event.code || event.key) === normalized || normalizeKey(event.key) === normalized) {
        this.keyDown = true;
        if (this.micGain) {
          this.micGain.gain.value = gain;
        }
      }
    };
    this.keyUpHandler = (event) => {
      if (normalizeKey(event.code || event.key) === normalized || normalizeKey(event.key) === normalized) {
        this.keyDown = false;
        if (this.micGain) {
          this.micGain.gain.value = 0;
        }
      }
    };
    window.addEventListener("keydown", this.keyHandler);
    window.addEventListener("keyup", this.keyUpHandler);
  }

  setMicMuted(muted: boolean, gain = 1): boolean {
    if (this.micGain) {
      this.micGain.gain.value = muted ? 0 : gain;
      return true;
    }
    return false;
  }

  setSystemMuted(muted: boolean): boolean {
    if (this.systemGain) {
      this.systemGain.gain.value = muted ? 0 : 1;
      return true;
    }
    return false;
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
    }
    if (this.keyUpHandler) {
      window.removeEventListener("keyup", this.keyUpHandler);
    }
    this.keyHandler = undefined;
    this.keyUpHandler = undefined;
    this.keyDown = false;
    for (const stream of this.ownedStreams) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.ownedStreams = [];
    void this.context?.close();
    this.micGain = undefined;
    this.systemGain = undefined;
    this.context = undefined;
    this.destination = undefined;
  }
}

async function getMicrophoneStream(settings: AudioSettings): Promise<MediaStream> {
  const constraints = microphoneConstraints(settings, true);
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
  } catch (error) {
    if (!settings.microphoneDeviceId) {
      throw error;
    }
    console.warn("Selected microphone is unavailable; falling back to the system default microphone.", error);
    return navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(settings, false), video: false });
  }
}

function microphoneConstraints(settings: AudioSettings, includeDevice: boolean): MediaTrackConstraints {
  return {
    deviceId: includeDevice && settings.microphoneDeviceId ? { exact: settings.microphoneDeviceId } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, "");
}
