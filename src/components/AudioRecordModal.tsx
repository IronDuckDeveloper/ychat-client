import { useEffect, useRef, useState } from 'react';
import { X, Mic, Square, RotateCcw, Check } from 'lucide-react';
import '../styles/cameraCaptureModal.scss'; // 🔥 Общие стили с фото/видео-модалками
import { useTranslation } from 'react-i18next';

interface AudioRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const pickSupportedAudioMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

// 🔥 Десктоп-аналог записи голосового: на мобильных input[capture] сам
// открывает нативный диктофон, здесь — запись через getUserMedia + MediaRecorder.
const AudioRecordModal = ({ isOpen, onClose, onCapture }: AudioRecordModalProps) => {
  const { t } = useTranslation();
  
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>('');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([4, 4, 4, 4, 4]);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const setupAnalyser = (stream: MediaStream) => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 32;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    updateLevels();
  };

  const updateLevels = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bars = Array.from({ length: 5 }, (_, i) => {
      const value = data[i * 2] || 0;
      return Math.max(4, Math.min(28, Math.round((value / 255) * 28)));
    });
    setLevels(bars);
    rafRef.current = requestAnimationFrame(updateLevels);
  };

  const teardownAnalyser = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevels([4, 4, 4, 4, 4]);
  };

  const startMic = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setupAnalyser(stream);
    } catch (err) {
      console.error('❌ Нет доступа к микрофону:', err);
      setError(t('audioModal.micError'));
    }
  };

  const stopMic = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    teardownAnalyser();
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetState = () => {
    setIsRecording(false);
    setElapsed(0);
    setRecordedUrl(null);
    setRecordedBlob(null);
    chunksRef.current = [];
  };

  useEffect(() => {
    if (isOpen) {
      resetState();
      startMic();
    } else {
      stopTimer();
      stopMic();
    }
    return () => {
      stopTimer();
      stopMic();
    };
  }, [isOpen]);

  const handleStartRecording = () => {
    if (!streamRef.current) return;

    mimeTypeRef.current = pickSupportedAudioMimeType();
    const recorder = new MediaRecorder(
      streamRef.current,
      mimeTypeRef.current ? { mimeType: mimeTypeRef.current } : undefined,
    );
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: mimeTypeRef.current || 'audio/webm',
      });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
      stopMic(); // превью держим на плеере, живой поток и анализатор больше не нужны
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setElapsed(0);

    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  };

  const handleStopRecording = () => {
    stopTimer();
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleRetake = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    resetState();
    startMic();
  };

  const handleConfirm = () => {
    if (!recordedBlob) return;
    const ext = mimeTypeRef.current.includes('mp4') ? 'm4a' : 'webm';
    const file = new File([recordedBlob], `voice_${Date.now()}.${ext}`, {
      type: recordedBlob.type,
    });
    onCapture(file);
  };

  const handleClose = () => {
    stopTimer();
    stopMic();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="camera-modal-overlay" onClick={handleClose}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <button className="camera-modal-close" onClick={handleClose} aria-label={t('audioModal.close')}>
          <X size={20} />
        </button>

        <div className="camera-modal-viewport audio-viewport">
          {error ? (
            <div className="camera-modal-error">{error}</div>
          ) : recordedUrl ? (
            <div className="audio-modal-preview">
              <audio src={recordedUrl} controls />
            </div>
          ) : (
            <div className="audio-modal-visualizer">
              <Mic size={32} className="audio-modal-mic-icon" />
              <div className="audio-modal-bars">
                {levels.map((h, i) => (
                  <span key={i} style={{ height: `${h}px` }} />
                ))}
              </div>
            </div>
          )}

          {isRecording && (
            <div className="camera-modal-rec-badge">
              <span className="camera-modal-rec-dot" />
              {formatDuration(elapsed)}
            </div>
          )}
        </div>

        <div className="camera-modal-controls">
          {error ? (
            <button className="camera-modal-retry" onClick={startMic}>
              {t('audioModal.retry')}
            </button>
          ) : recordedUrl ? (
            <>
              <button className="camera-modal-btn secondary" onClick={handleRetake}>
                <RotateCcw size={18} />
                {t('audioModal.retake')}
              </button>
              <button className="camera-modal-btn primary" onClick={handleConfirm}>
                <Check size={18} />
                {t('audioModal.confirm')}
              </button>
            </>
          ) : isRecording ? (
            <button
              className="camera-modal-shutter recording"
              onClick={handleStopRecording}
              aria-label={t('audioModal.stopRecording')}
            >
              <Square size={20} fill="currentColor" />
            </button>
          ) : (
            <button
              className="camera-modal-shutter"
              onClick={handleStartRecording}
              aria-label={t('audioModal.startRecording')}
            >
              <Mic size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudioRecordModal;