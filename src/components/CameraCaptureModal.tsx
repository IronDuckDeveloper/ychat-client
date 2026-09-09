import { useEffect, useRef, useState } from 'react';
import { X, Camera, RotateCcw, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../styles/cameraCaptureModal.scss';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

const CameraCaptureModal = ({ isOpen, onClose, onCapture }: CameraCaptureModalProps) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('❌ Нет доступа к камере:', err);
      setError(t('cameraModal.cameraError'));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (isOpen) {
      setCapturedDataUrl(null);
      setCapturedBlob(null);
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  const handleTakeShot = () => {
    const video = videoRef.current;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setCapturedDataUrl(canvas.toDataURL('image/jpeg', 0.92));
        stopCamera();
      },
      'image/jpeg',
      0.92,
    );
  };

  const handleRetake = () => {
    setCapturedDataUrl(null);
    setCapturedBlob(null);
    startCamera();
  };

  const handleConfirm = () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `photo_${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });
    onCapture(file);
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="camera-modal-overlay" onClick={handleClose}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <button className="camera-modal-close" onClick={handleClose} aria-label={t('cameraModal.close')}>
          <X size={20} />
        </button>

        <div className="camera-modal-viewport">
          {error ? (
            <div className="camera-modal-error">{error}</div>
          ) : capturedDataUrl ? (
            <img src={capturedDataUrl} alt={t('cameraModal.photoAlt')} className="camera-modal-preview" />
          ) : (
            <video ref={videoRef} className="camera-modal-video" playsInline muted />
          )}
        </div>

        <div className="camera-modal-controls">
          {error ? (
            <button className="camera-modal-retry" onClick={startCamera}>
              {t('cameraModal.retry')}
            </button>
          ) : capturedDataUrl ? (
            <>
              <button className="camera-modal-btn secondary" onClick={handleRetake}>
                <RotateCcw size={18} />
                {t('cameraModal.retake')}
              </button>
              <button className="camera-modal-btn primary" onClick={handleConfirm}>
                <Check size={18} />
                {t('cameraModal.confirm')}
              </button>
            </>
          ) : (
            <button className="camera-modal-shutter" onClick={handleTakeShot} aria-label={t('cameraModal.takeShot')}>
              <Camera size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CameraCaptureModal;