// Central TTS playback: one module-level player, requests audio from backend,
// plays a remote https URL (never a data: URI). Handles the premium 402 by
// surfacing a `locked` flag so callers can route to the paywall.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { requestTts, ttsUrl } from "@/src/api/client";

let player: AudioPlayer | null = null;

export function stopSpeech() {
  try {
    player?.pause();
    player?.remove();
  } catch {}
  player = null;
}

export type SpeakResult = { ok: boolean; locked?: boolean; error?: string };

export async function speak(text: string): Promise<SpeakResult> {
  try {
    const { url } = await requestTts(text);
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    stopSpeech();
    player = createAudioPlayer({ uri: ttsUrl(url) });
    player.play();
    return { ok: true };
  } catch (e: any) {
    if (e?.status === 402) return { ok: false, locked: true };
    return { ok: false, error: e?.message || "Riproduzione fallita" };
  }
}
