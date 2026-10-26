import { useSyncExternalStore } from 'react';
import { OP, gateway } from './gateway.js';
import { getSettings, onSettingsChange } from './settings.js';
import { playSound } from './sounds.js';
import { showError } from './dialogs.js';
import { dispatch, getState } from './store.js';

// Voz em malha (mesh): cada participante abre uma RTCPeerConnection com cada outro.
// Quem entra no canal manda a oferta para quem já está lá; o gateway só repassa
// os sinais (op 30). Serve para grupos pequenos — o Discord real usa um SFU.
//
// Como no Discord, a transmissão é por detecção de voz: o microfone bruto alimenta o
// medidor, e uma cópia da trilha (a enviada aos outros) só fica ativa enquanto há fala.

const AUTO_THRESHOLD = 0.015;
const SPEAKING_HOLD_MS = 400;

const threshold = () => {
  const s = getSettings();
  return s.autoSensitivity ? AUTO_THRESHOLD : 10 ** (s.sensitivity / 20);
};

export function micConstraints() {
  const s = getSettings();
  return {
    audio: {
      deviceId: s.inputDevice !== 'default' ? { exact: s.inputDevice } : undefined,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
    },
  };
}

// RMS de uma amostra do analisador, de 0 a 1.
export function levelOf(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += ((v - 128) / 128) ** 2;
  return Math.sqrt(sum / buffer.length);
}

class Voice {
  guildId = null;
  channelId = null;
  muted = false;
  deafened = false;
  mutedBeforeDeafen = false;
  mic = null; // stream bruto do microfone (medidor)
  sendTrack = null; // cópia enviada aos outros, ligada/desligada pela detecção de voz
  sendStream = null;
  gateOpen = false;
  confirmed = false;
  peers = new Map(); // userId -> { pc, audio, pendingIce }
  meters = new Map(); // userId -> { analyser, source, buffer, speaking, lastLoud }
  audioContext = null;
  timer = null;
  listeners = new Set();
  snapshot = { guildId: null, channelId: null, muted: false, deafened: false };

  constructor() {
    gateway.on((t, d) => this.onEvent(t, d));
    let previous = getSettings();
    onSettingsChange((s) => {
      const micChanged = ['inputDevice', 'echoCancellation', 'noiseSuppression', 'autoGainControl'].some((k) => s[k] !== previous[k]);
      previous = s;
      if (micChanged && this.mic) this.reopenMic();
      this.applyOutput();
    });
  }

  emit() {
    this.snapshot = { guildId: this.guildId, channelId: this.channelId, muted: this.muted, deafened: this.deafened };
    for (const listener of this.listeners) listener();
  }

  async join(guildId, channelId) {
    if (this.channelId === channelId) return;
    if (this.channelId) this.leave();

    try {
      await this.openMic();
    } catch (e) {
      showError(`Não foi possível acessar o microfone: ${e.message}`);
      return;
    }

    this.guildId = guildId;
    this.channelId = channelId;
    this.confirmed = false;
    this.sendState();
    this.emit();
  }

  async openMic() {
    this.mic = await navigator.mediaDevices.getUserMedia(micConstraints());
    this.sendTrack = this.mic.getAudioTracks()[0].clone();
    this.sendStream = new MediaStream([this.sendTrack]);
    this.gateOpen = false;
    this.updateSendTrack();
    this.watch(getState().user.id, this.mic);
  }

  // Troca de microfone ou de processamento durante a chamada: substitui a trilha em cada conexão.
  async reopenMic() {
    const oldMic = this.mic;
    const oldTrack = this.sendTrack;
    this.unwatch(getState().user.id);
    try {
      await this.openMic();
    } catch (e) {
      showError(`Não foi possível trocar o microfone: ${e.message}`);
      return;
    }
    for (const { pc } of this.peers.values()) {
      for (const sender of pc.getSenders()) if (sender.track === oldTrack) sender.replaceTrack(this.sendTrack);
    }
    oldMic?.getTracks().forEach((t) => t.stop());
    oldTrack?.stop();
  }

  leave() {
    if (!this.channelId) return;
    gateway.send(OP.VOICE_STATE_UPDATE, { guild_id: this.guildId, channel_id: null });
    playSound('leave');
    this.cleanup();
  }

  sendState() {
    if (!this.channelId) return;
    gateway.send(OP.VOICE_STATE_UPDATE, {
      guild_id: this.guildId,
      channel_id: this.channelId,
      self_mute: this.muted,
      self_deaf: this.deafened,
    });
  }

  // Desativar o mudo enquanto ensurdecido também tira o ensurdecer (como no Discord).
  toggleMute() {
    if (this.deafened && this.muted) {
      this.deafened = false;
      this.muted = false;
    } else {
      this.muted = !this.muted;
    }
    playSound(this.muted ? 'mute' : 'unmute');
    this.applyLocalState();
  }

  toggleDeafen() {
    if (this.deafened) {
      this.deafened = false;
      this.muted = this.mutedBeforeDeafen;
    } else {
      this.mutedBeforeDeafen = this.muted;
      this.deafened = true;
      this.muted = true;
    }
    playSound(this.deafened ? 'mute' : 'unmute');
    this.applyLocalState();
  }

  applyLocalState() {
    this.updateSendTrack();
    this.applyOutput();
    this.sendState();
    this.emit();
  }

  updateSendTrack() {
    if (this.sendTrack) this.sendTrack.enabled = !this.muted && this.gateOpen;
  }

  applyOutput() {
    const { outputVolume, outputDevice } = getSettings();
    for (const { audio } of this.peers.values()) {
      if (!audio) continue;
      audio.muted = this.deafened;
      audio.volume = Math.min(outputVolume, 100) / 100;
      if (audio.setSinkId && audio.sinkId !== (outputDevice === 'default' ? '' : outputDevice)) {
        audio.setSinkId(outputDevice === 'default' ? '' : outputDevice).catch(() => {});
      }
    }
  }

  cleanup() {
    for (const userId of [...this.peers.keys()]) this.closePeer(userId);
    for (const userId of [...this.meters.keys()]) this.unwatch(userId);
    this.mic?.getTracks().forEach((track) => track.stop());
    this.sendTrack?.stop();
    this.mic = null;
    this.sendTrack = null;
    this.sendStream = null;
    this.guildId = null;
    this.channelId = null;
    this.confirmed = false;
    this.emit();
  }

  onEvent(t, d) {
    // Um READY novo significa reconexão: o servidor já nos tirou da voz.
    if (t === 'READY') return this.channelId && this.cleanup();
    if (t === 'VOICE_SIGNAL') return this.onSignal(d.from, d.payload);
    if (t !== 'VOICE_STATE_UPDATE' || !this.channelId) return;

    const me = getState().user.id;
    if (d.user_id === me) {
      if (d.channel_id === this.channelId && !this.confirmed) {
        // Confirmação do servidor: agora chamamos quem já estava no canal.
        this.confirmed = true;
        playSound('join');
        for (const vs of Object.values(getState().voiceStates)) {
          if (vs.channel_id === this.channelId && vs.user_id !== me) this.call(vs.user_id);
        }
      } else if (!d.channel_id && this.confirmed) {
        // O servidor nos desconectou (expulsão, canal excluído…).
        playSound('leave');
        this.cleanup();
      }
      return;
    }
    if (d.channel_id === this.channelId && !this.peers.has(d.user_id)) playSound('join');
    if (d.channel_id !== this.channelId && this.peers.has(d.user_id)) {
      playSound('leave');
      this.closePeer(d.user_id);
    }
  }

  createPeer(userId) {
    const pc = new RTCPeerConnection({ iceServers: [] }); // rede local: candidatos "host" bastam
    const peer = { pc, audio: null, pendingIce: [] };
    this.peers.set(userId, peer);

    pc.addTrack(this.sendTrack, this.sendStream);
    pc.onicecandidate = (e) => e.candidate && this.signal(userId, { type: 'ice', candidate: e.candidate });
    pc.ontrack = (e) => {
      if (peer.audio) return;
      peer.audio = new Audio();
      peer.audio.srcObject = e.streams[0];
      this.applyOutput();
      peer.audio.play().catch(() => {});
      this.watch(userId, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closePeer(userId);
    };
    return peer;
  }

  async call(userId) {
    const peer = this.createPeer(userId);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    this.signal(userId, { type: 'offer', sdp: peer.pc.localDescription });
  }

  async onSignal(from, message) {
    if (!this.sendTrack) return;
    let peer = this.peers.get(from);

    if (message.type === 'offer') {
      if (peer) this.closePeer(from);
      peer = this.createPeer(from);
      await peer.pc.setRemoteDescription(message.sdp);
      await this.flushIce(peer);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      this.signal(from, { type: 'answer', sdp: peer.pc.localDescription });
    } else if (message.type === 'answer' && peer) {
      await peer.pc.setRemoteDescription(message.sdp);
      await this.flushIce(peer);
    } else if (message.type === 'ice' && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate).catch(() => {});
      else peer.pendingIce.push(message.candidate);
    }
  }

  async flushIce(peer) {
    for (const candidate of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => {});
  }

  signal(to, payload) {
    gateway.send(OP.VOICE_SIGNAL, { to, payload });
  }

  closePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audio) peer.audio.srcObject = null;
    this.peers.delete(userId);
    this.unwatch(userId);
  }

  // --- detecção de voz (anel verde e liberação da trilha enviada) ---

  watch(userId, stream) {
    this.audioContext ??= new AudioContext();
    this.audioContext.resume().catch(() => {});
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.meters.set(userId, { analyser, source, buffer: new Uint8Array(analyser.fftSize), speaking: false, lastLoud: 0 });
    // setInterval (e não requestAnimationFrame) para continuar medindo com a janela minimizada.
    this.timer ??= setInterval(this.tick, 50);
  }

  unwatch(userId) {
    const meter = this.meters.get(userId);
    if (!meter) return;
    meter.source.disconnect();
    this.meters.delete(userId);
    if (meter.speaking) dispatch({ type: 'SPEAKING', d: { user_id: userId, speaking: false } });
  }

  tick = () => {
    const now = performance.now();
    const me = getState().user?.id;
    const limit = threshold();
    for (const [userId, meter] of this.meters) {
      const loud = levelOf(meter.analyser, meter.buffer) > limit;
      if (loud) meter.lastLoud = now;

      const active = now - meter.lastLoud < SPEAKING_HOLD_MS;
      if (userId === me && active !== this.gateOpen) {
        this.gateOpen = active;
        this.updateSendTrack();
      }
      const speaking = active && !(userId === me && this.muted);
      if (speaking !== meter.speaking) {
        meter.speaking = speaking;
        dispatch({ type: 'SPEAKING', d: { user_id: userId, speaking } });
      }
    }
    if (!this.meters.size) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };
}

export const voice = new Voice();

export const useVoice = () =>
  useSyncExternalStore(
    (listener) => {
      voice.listeners.add(listener);
      return () => voice.listeners.delete(listener);
    },
    () => voice.snapshot,
  );
