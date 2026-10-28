import { useSyncExternalStore } from 'react';
import { OP, gateway } from './gateway.js';
import { getSettings, onSettingsChange, updateSettings } from './settings.js';
import { playSound } from './sounds.js';
import { showError } from './dialogs.js';
import { dispatch, getState } from './store.js';

// Voz em malha (mesh): cada participante abre uma RTCPeerConnection com cada outro.
// Quem entra no canal manda a oferta para quem já está lá; o gateway só repassa
// os sinais (op 30). Serve para grupos pequenos — o Discord real usa um SFU.
//
// Como no Discord, a transmissão é por detecção de voz: o microfone bruto alimenta o
// medidor, e uma cópia da trilha (a enviada aos outros) só fica ativa enquanto há fala.
//
// Cada conexão nasce com quatro transceptores fixos (voz, câmera, tela e som da tela, nessa
// ordem), e ligar ou desligar a câmera/tela só troca a trilha (replaceTrack), sem renegociar.
// Quem mostra ou esconde o vídeo é o estado de voz (self_video / self_stream), como no Discord.
//
// O som recebido passa pelo Web Audio: cada pessoa tem um ganho para a voz e outro para a
// transmissão (volume do usuário, 0–200%, e silenciar só para mim), e todos somam num ganho
// principal (volume de saída e ensurdecer) que toca no dispositivo de saída escolhido.

const AUTO_THRESHOLD = 0.015;
const SPEAKING_HOLD_MS = 400;

const threshold = () => {
  const s = getSettings();
  return s.autoSensitivity ? AUTO_THRESHOLD : 10 ** (s.sensitivity / 20);
};

const VIDEO_SLOTS = ['camera', 'screen']; // transceptores 1 e 2 (o 0 é a voz)
const SCREEN_AUDIO = 3; // transceptor do som da tela

// Volume e silenciar por pessoa, salvos no dispositivo (como no Discord, não vão para a conta).
const AUDIO_DEFAULTS = { volume: 100, muted: false, streamVolume: 100, streamMuted: false };

export const userAudio = (userId) => ({ ...AUDIO_DEFAULTS, ...getSettings().userAudio?.[userId] });

export function setUserAudio(userId, patch) {
  const all = getSettings().userAudio ?? {};
  const next = { ...userAudio(userId), ...patch };
  const isDefault = Object.keys(AUDIO_DEFAULTS).every((k) => next[k] === AUDIO_DEFAULTS[k]);
  const { [userId]: _, ...rest } = all;
  updateSettings({ userAudio: isDefault ? rest : { ...rest, [userId]: next } });
}

// Som da tela compartilhada: sem o processamento de voz e em estéreo. `restrictOwnAudio` tira
// do loopback o som do próprio app (as vozes da chamada), senão os outros ouviriam o próprio eco.
const SCREEN_AUDIO_CONSTRAINTS = {
  restrictOwnAudio: true,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
};

// Opus em estéreo e com mais banda só na seção do som da tela (a quarta m=).
function screenAudioSdp(description) {
  const parts = description.sdp.split(/(?=\r\nm=)/);
  const section = parts[SCREEN_AUDIO + 1];
  const opus = section?.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!opus) return description;
  parts[SCREEN_AUDIO + 1] = section.replace(new RegExp(`(a=fmtp:${opus} [^\\r\\n]*)`), (line) =>
    line.includes('stereo=') ? line : `${line};stereo=1;sprop-stereo=1;maxaveragebitrate=128000`);
  return { type: description.type, sdp: parts.join('') };
}

export function cameraConstraints() {
  const { videoDevice } = getSettings();
  return {
    video: {
      deviceId: videoDevice !== 'default' ? { exact: videoDevice } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  };
}

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
  camera = null; // trilha da câmera, quando ligada
  screen = null; // trilha da tela compartilhada, quando ligada
  screenAudio = null; // som da tela compartilhada, quando escolhido
  peers = new Map(); // userId -> { pc, pendingIce, video: { camera, screen }, sound: { voice, stream } }
  meters = new Map(); // userId -> { analyser, source, buffer, speaking, lastLoud }
  audioContext = null;
  master = null; // ganho principal: volume de saída e ensurdecer
  timer = null;
  listeners = new Set();
  snapshot = { guildId: null, channelId: null, muted: false, deafened: false, video: false, streaming: false, screenAudio: false, tracks: 0 };
  trackVersion = 0; // muda a cada trilha de vídeo nova (local ou remota), para a interface reler

  constructor() {
    gateway.on((t, d) => this.onEvent(t, d));
    let previous = getSettings();
    onSettingsChange((s) => {
      const micChanged = ['inputDevice', 'echoCancellation', 'noiseSuppression', 'autoGainControl'].some((k) => s[k] !== previous[k]);
      const cameraChanged = s.videoDevice !== previous.videoDevice;
      previous = s;
      if (micChanged && this.mic) this.reopenMic();
      if (cameraChanged && this.camera) this.reopenCamera();
      this.applyOutput();
    });
  }

  emit() {
    this.snapshot = {
      guildId: this.guildId,
      channelId: this.channelId,
      muted: this.muted,
      deafened: this.deafened,
      video: !!this.camera,
      streaming: !!this.screen,
      screenAudio: !!this.screenAudio,
      tracks: this.trackVersion,
    };
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
      self_video: !!this.camera,
      self_stream: !!this.screen,
    });
  }

  context() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.master = this.audioContext.createGain();
      this.master.connect(this.audioContext.destination);
      this.applyOutput();
    }
    this.audioContext.resume().catch(() => {});
    return this.audioContext;
  }

  // --- câmera e tela ---

  // Trilha de vídeo de alguém na chamada (eu incluso): 'camera' ou 'screen'.
  videoTrack(userId, slot) {
    if (userId === getState().user?.id) return this[slot];
    return this.peers.get(userId)?.video[slot] ?? null;
  }

  setVideo(slot, track) {
    const old = this[slot];
    this[slot] = track;
    if (old && old !== track) old.stop();
    const index = VIDEO_SLOTS.indexOf(slot) + 1;
    for (const { pc } of this.peers.values()) pc.getTransceivers()[index]?.sender.replaceTrack(track).catch(() => {});
    this.trackVersion++;
    this.sendState();
    this.emit();
  }

  async toggleVideo() {
    if (!this.channelId) return;
    if (this.camera) return this.setVideo('camera', null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
      if (!this.channelId) return stream.getTracks().forEach((t) => t.stop());
      this.setVideo('camera', stream.getVideoTracks()[0]);
    } catch (e) {
      showError(`Não foi possível acessar a câmera: ${e.message}`);
    }
  }

  async reopenCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
      if (!this.camera) return stream.getTracks().forEach((t) => t.stop());
      this.setVideo('camera', stream.getVideoTracks()[0]);
    } catch (e) {
      showError(`Não foi possível trocar a câmera: ${e.message}`);
    }
  }

  setScreenAudio(track) {
    const old = this.screenAudio;
    this.screenAudio = track;
    if (old && old !== track) old.stop();
    for (const { pc } of this.peers.values()) pc.getTransceivers()[SCREEN_AUDIO]?.sender.replaceTrack(track).catch(() => {});
  }

  // No desktop a fonte já foi escolhida no seletor (native.screen.select) antes desta chamada;
  // no navegador, o próprio getDisplayMedia mostra o seletor (com a opção de compartilhar o áudio).
  async startScreen({ frameRate = 30, audio = true } = {}) {
    if (!this.channelId) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: frameRate } },
        audio: audio ? SCREEN_AUDIO_CONSTRAINTS : false,
      });
      const track = stream.getVideoTracks()[0];
      const sound = stream.getAudioTracks()[0] ?? null;
      if (!this.channelId) return stream.getTracks().forEach((t) => t.stop());
      track.contentHint = 'detail'; // prioriza nitidez do texto sobre fluidez
      if (sound) sound.contentHint = 'music';
      track.addEventListener('ended', () => this.screen === track && this.stopScreen());
      this.setScreenAudio(sound);
      this.setVideo('screen', track);
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') showError(`Não foi possível compartilhar a tela: ${e.message}`);
    }
  }

  stopScreen() {
    this.setScreenAudio(null);
    if (this.screen) this.setVideo('screen', null);
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
    if (!this.audioContext) return;
    const { outputVolume, outputDevice } = getSettings();
    this.master.gain.value = this.deafened ? 0 : outputVolume / 100;
    const sink = outputDevice === 'default' ? '' : outputDevice;
    if (this.audioContext.setSinkId && this.audioContext.sinkId !== sink) this.audioContext.setSinkId(sink).catch(() => {});
    for (const [userId, peer] of this.peers) {
      const prefs = userAudio(userId);
      if (peer.sound.voice) peer.sound.voice.gain.gain.value = prefs.muted ? 0 : prefs.volume / 100;
      if (peer.sound.stream) peer.sound.stream.gain.gain.value = prefs.streamMuted ? 0 : prefs.streamVolume / 100;
    }
  }

  // Toca uma trilha recebida pelo ganho dela. O Chromium só entrega áudio remoto do WebRTC ao
  // Web Audio se o stream também estiver num elemento de mídia; esse fica mudo.
  playTrack(track) {
    const ctx = this.context();
    const stream = new MediaStream([track]);
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    element.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    source.connect(gain).connect(this.master);
    return { stream, element, source, gain };
  }

  cleanup() {
    for (const userId of [...this.peers.keys()]) this.closePeer(userId);
    for (const userId of [...this.meters.keys()]) this.unwatch(userId);
    this.mic?.getTracks().forEach((track) => track.stop());
    this.sendTrack?.stop();
    this.camera?.stop();
    this.screen?.stop();
    this.screenAudio?.stop();
    this.camera = null;
    this.screen = null;
    this.screenAudio = null;
    this.trackVersion++;
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

  // Quem oferta cria os transceptores (voz, câmera, tela, som da tela); quem responde os recebe
  // da oferta e só preenche as trilhas (attachTracks), na mesma ordem.
  createPeer(userId, offering) {
    const pc = new RTCPeerConnection({ iceServers: [] }); // rede local: candidatos "host" bastam
    const peer = { pc, pendingIce: [], video: { camera: null, screen: null }, sound: { voice: null, stream: null } };
    this.peers.set(userId, peer);

    if (offering) {
      pc.addTransceiver('audio', { direction: 'sendrecv', streams: [this.sendStream] });
      for (const _ of VIDEO_SLOTS) pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.attachTracks(pc);
    }
    pc.onicecandidate = (e) => e.candidate && this.signal(userId, { type: 'ice', candidate: e.candidate });
    pc.ontrack = (e) => {
      const index = pc.getTransceivers().indexOf(e.transceiver);
      if (e.track.kind === 'video') {
        const slot = VIDEO_SLOTS[index - 1];
        if (!slot) return;
        peer.video[slot] = e.track;
        this.trackVersion++;
        this.emit();
        return;
      }
      const kind = index === SCREEN_AUDIO ? 'stream' : index === 0 ? 'voice' : null;
      if (!kind || peer.sound[kind]) return;
      peer.sound[kind] = this.playTrack(e.track);
      this.applyOutput();
      if (kind === 'voice') this.watch(userId, peer.sound.voice.stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closePeer(userId);
    };
    return peer;
  }

  attachTracks(pc) {
    const [audio, ...videos] = pc.getTransceivers();
    audio.direction = 'sendrecv';
    audio.sender.replaceTrack(this.sendTrack).catch(() => {});
    VIDEO_SLOTS.forEach((slot, i) => {
      if (!videos[i]) return;
      videos[i].direction = 'sendrecv';
      videos[i].sender.replaceTrack(this[slot]).catch(() => {});
    });
    const sound = pc.getTransceivers()[SCREEN_AUDIO];
    if (sound) {
      sound.direction = 'sendrecv';
      sound.sender.replaceTrack(this.screenAudio).catch(() => {});
    }
  }

  async call(userId) {
    const peer = this.createPeer(userId, true);
    await peer.pc.setLocalDescription(screenAudioSdp(await peer.pc.createOffer()));
    this.signal(userId, { type: 'offer', sdp: peer.pc.localDescription });
  }

  async onSignal(from, message) {
    if (!this.sendTrack) return;
    let peer = this.peers.get(from);

    if (message.type === 'offer') {
      if (peer) this.closePeer(from);
      peer = this.createPeer(from, false);
      await peer.pc.setRemoteDescription(message.sdp);
      this.attachTracks(peer.pc);
      await this.flushIce(peer);
      await peer.pc.setLocalDescription(screenAudioSdp(await peer.pc.createAnswer()));
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
    for (const sound of Object.values(peer.sound)) {
      if (!sound) continue;
      sound.source.disconnect();
      sound.gain.disconnect();
      sound.element.srcObject = null;
    }
    this.peers.delete(userId);
    if (peer.video.camera || peer.video.screen) {
      this.trackVersion++;
      this.emit();
    }
    this.unwatch(userId);
  }

  // --- detecção de voz (anel verde e liberação da trilha enviada) ---

  watch(userId, stream) {
    const ctx = this.context();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
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
      // Quem eu silenciei não acende o anel de fala (como no Discord).
      const speaking = active && (userId === me ? !this.muted : !userAudio(userId).muted);
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
