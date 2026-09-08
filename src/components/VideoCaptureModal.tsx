import { useEffect, useRef, useState } from 'react';
import { X, Video, Square, RotateCcw, Check } from 'lucide-react';
import '../styles/cameraCaptureModal.scss'; // 🔥 Общие стили с фото-модалкой

interface VideoCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// Подбираем поддерживаемый браузером mimeType для записи
const pickSupportedMimeType = () => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

// 🔥 Десктоп-аналог съёмки видео: на мобильных input[capture] сам открывает
// нативную камеру для видео, здесь же — запись через getUserMedia + MediaRecorder.
const VideoCaptureModal = ({ isOpen, onClose, onCapture }: VideoCaptureModalProps) => {
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>('');

  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
    } catch (err) {
      console.error('❌ Нет доступа к камере/микрофону:', err);
      setError('Не удалось получить доступ к камере или микрофону. Проверьте разрешения браузера.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
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
      startCamera();
    } else {
      stopTimer();
      stopCamera();
    }
    return () => {
      stopTimer();
      stopCamera();
    };
  }, [isOpen]);

  const handleStartRecording = () => {
    if (!streamRef.current) return;

    mimeTypeRef.current = pickSupportedMimeType();
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
        type: mimeTypeRef.current || 'video/webm',
      });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
      stopCamera(); // превью держим на записанном ролике, живой поток больше не нужен
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
    startCamera();
  };

  const handleConfirm = () => {
    if (!recordedBlob) return;
    const ext = mimeTypeRef.current.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([recordedBlob], `video_${Date.now()}.${ext}`, {
      type: recordedBlob.type,
    });
    onCapture(file);
  };

  const handleClose = () => {
    stopTimer();
    stopCamera();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="camera-modal-overlay" onClick={handleClose}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <button className="camera-modal-close" onClick={handleClose} aria-label="Закрыть">
          <X size={20} />
        </button>

        <div className="camera-modal-viewport">
          {error ? (
            <div className="camera-modal-error">{error}</div>
          ) : recordedUrl ? (
            <video
              ref={previewVideoRef}
              className="camera-modal-preview"
              src={recordedUrl}
              controls
              playsInline
            />
          ) : (
            <video ref={liveVideoRef} className="camera-modal-video" playsInline muted />
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
            <button className="camera-modal-retry" onClick={startCamera}>
              Повторить попытку
            </button>
          ) : recordedUrl ? (
            <>
              <button className="camera-modal-btn secondary" onClick={handleRetake}>
                <RotateCcw size={18} />
                Переснять
              </button>
              <button className="camera-modal-btn primary" onClick={handleConfirm}>
                <Check size={18} />
                Отправить в превью
              </button>
            </>
          ) : isRecording ? (
            <button
              className="camera-modal-shutter recording"
              onClick={handleStopRecording}
              aria-label="Остановить запись"
            >
              <Square size={20} fill="currentColor" />
            </button>
          ) : (
            <button
              className="camera-modal-shutter"
              onClick={handleStartRecording}
              aria-label="Начать запись"
            >
              <Video size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoCaptureModal;