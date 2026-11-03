import { ImageOff } from "lucide-react";
import { useState } from "react";

export function MenuPhoto({
  src,
  compact = false,
  preview = false,
}: {
  src: string;
  compact?: boolean;
  preview?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  let supported =
    /^\/menu\/[a-z0-9-]+\.jpg$/.test(src) ||
    /^\/api\/menu-images\/[a-f0-9]{64}\.webp$/.test(src) ||
    (preview && src.startsWith("blob:"));
  if (!supported && src) {
    try {
      supported = new URL(src).protocol === "https:";
    } catch {
      /* Incomplete editor input has no image request. */
    }
  }
  return (
    <span
      className={"menu-photo" + (compact ? " menu-photo--compact" : "")}
      aria-hidden="true"
    >
      {src && supported && failed !== src ? (
        <img
          src={src}
          alt=""
          width={640}
          height={480}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
        />
      ) : (
        <span className="menu-photo-fallback">
          <ImageOff size={compact ? 18 : 28} />
          {!compact && <span>{src ? "โหลดรูปไม่ได้" : "ยังไม่มีรูป"}</span>}
        </span>
      )}
    </span>
  );
}
