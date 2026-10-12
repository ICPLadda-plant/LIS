import { useRef, useState } from 'react';
import { FileVideo, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { uploadQcPhoto, deleteQcPhoto, type ParameterValueField } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

interface PhotoFieldProps {
  field: ParameterValueField;
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}

const ACCEPTED_MEDIA = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';
const MEDIA_CACHE_BUSTER = 'lis_media=1';
const VIDEO_EXT_RE = /\.(mp4|webm|mov)(?:$|[?#])/i;

function publicMediaUrl(url: string) {
  return url
    .replace(/^\/LIS\/api\/uploads\//, '/LIS/uploads/')
    .replace(/^\/api\/uploads\//, '/uploads/');
}

function displayMediaUrl(url: string) {
  const publicUrl = publicMediaUrl(url);
  const separator = publicUrl.includes('?') ? '&' : '?';
  return `${publicUrl}${separator}${MEDIA_CACHE_BUSTER}`;
}

function isVideoUrl(url: string) {
  return VIDEO_EXT_RE.test(url);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function PhotoField({ field, value, onChange, disabled = false }: PhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const maxPhotos = field.maxPhotos ?? 5;
  const canAdd = !disabled && value.length < maxPhotos;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    setUploading(true);
    try {
      const { url } = await uploadQcPhoto(file);
      onChange([...value, url]);
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'อัปโหลดล้มเหลว'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(url: string) {
    if (deletingUrl) return;
    setDeletingUrl(url);
    try {
      await deleteQcPhoto(url);
      onChange(value.filter((u) => u !== url));
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'ลบไม่สำเร็จ'));
    } finally {
      setDeletingUrl(null);
    }
  }

  return (
    <div className="space-y-2">
      {/* Thumbnail grid */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((url) => {
            const displayUrl = displayMediaUrl(url);
            const isVideo = isVideoUrl(displayUrl);
            return (
              <div key={url} className="relative group">
                <button
                  type="button"
                  onClick={() => setLightbox(displayUrl)}
                  className="block w-20 h-20 rounded-md overflow-hidden border border-grey-200 bg-grey-50 hover:border-pink-300 transition-colors"
                >
                  {isVideo ? (
                    <span className="relative block h-full w-full">
                      <video
                        src={displayUrl}
                        muted
                        preload="metadata"
                        className="h-full w-full object-cover"
                        aria-label="QC video"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-foreground/30 text-background">
                        <FileVideo className="h-6 w-6" />
                      </span>
                    </span>
                  ) : (
                    <img
                      src={displayUrl}
                      alt="QC photo"
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleDelete(url)}
                    disabled={deletingUrl === url}
                    className={cn(
                      'absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5',
                      'flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
                      'hover:bg-red-600',
                      deletingUrl === url && 'opacity-50 cursor-not-allowed',
                    )}
                    title="ลบไฟล์"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add button */}
      {canAdd && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-dashed',
            'border-pink-300 text-pink-600 bg-pink-50 hover:bg-pink-100 transition-colors',
            uploading && 'opacity-60 cursor-not-allowed',
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มไฟล์'}
          {!uploading && (
            <span className="text-pink-400 text-xs">
              ({value.length}/{maxPhotos})
            </span>
          )}
        </button>
      )}

      {/* Count display when at max */}
      {!canAdd && !disabled && (
        <p className="text-xs text-grey-400">ครบ {maxPhotos} ไฟล์แล้ว</p>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MEDIA}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={() => setLightbox(null)}>
        <DialogContent className="sm:max-w-3xl p-2 bg-black/90 border-0">
          {lightbox && (
            <>
              <DialogTitle className="sr-only">ไฟล์ QC</DialogTitle>
              {isVideoUrl(lightbox) ? (
                <video
                  src={lightbox}
                  controls
                  className="w-full max-h-[80vh] rounded"
                />
              ) : (
                <img
                  src={lightbox}
                  alt="QC photo full"
                  className="w-full max-h-[80vh] object-contain rounded"
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
