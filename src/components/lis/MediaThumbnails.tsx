import { useState } from "react";
import { FileVideo } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { displayMediaUrl, isVideoUrl } from "@/lib/mediaUrls";

interface MediaThumbnailsProps {
  urls: string[];
}

/** รูปย่อแบบ read-only ที่คลิกเปิดดูขนาดใหญ่ได้ */
export function MediaThumbnails({ urls }: MediaThumbnailsProps) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, index) => {
          const displayUrl = displayMediaUrl(url);
          const isVideo = isVideoUrl(displayUrl);
          return (
            <button
              key={`${url}-${index}`}
              type="button"
              onClick={() => setLightbox(displayUrl)}
              className="block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={isVideo ? "ดูวิดีโอขนาดใหญ่" : "ดูรูปขนาดใหญ่"}
              title="คลิกเพื่อดูขนาดใหญ่"
            >
              {isVideo ? (
                <span className="relative block h-full w-full">
                  <video src={displayUrl} muted preload="metadata" className="h-full w-full object-cover" aria-label="QC video" />
                  <span className="absolute inset-0 flex items-center justify-center bg-foreground/30 text-background">
                    <FileVideo className="h-5 w-5" />
                  </span>
                </span>
              ) : (
                <img src={displayUrl} alt="QC photo" loading="lazy" className="h-full w-full object-cover" />
              )}
            </button>
          );
        })}
      </div>

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="sm:max-w-3xl p-2 bg-black/90 border-0" aria-describedby={undefined}>
          {lightbox && (
            <>
              <DialogTitle className="sr-only">ไฟล์ QC</DialogTitle>
              {isVideoUrl(lightbox) ? (
                <video src={lightbox} controls autoPlay className="w-full max-h-[80vh] rounded" />
              ) : (
                <img src={lightbox} alt="QC photo full" className="w-full max-h-[80vh] object-contain rounded" />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
