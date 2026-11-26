import { File, FileText, X } from "lucide-react";
import { memo, useMemo } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { type ChatAttachment, formatSize } from "./attachments";

/**
 * One file going with a message (#275, the design's Chat-States 4): 22 tall on
 * the line tint, like the selection chip. A picture shows its thumbnail, a
 * text file a file-text glyph, anything else a file glyph; the name truncates
 * and its tooltip has the full name and size. In the composer its x takes it
 * off; on a sent message there is none (#277).
 */
export const AttachmentChip = memo(function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  /** given the attachment's id; stable, so a keystroke in the composer redraws no chip */
  onRemove?: (id: string) => void;
}) {
  const { id, name, kind, mime, base64, size } = attachment;
  // made once: a picture's base64 is megabytes
  const src = useMemo(
    () => (kind === "image" ? `data:${mime};base64,${base64}` : ""),
    [kind, mime, base64],
  );
  return (
    <span
      title={`${name} — ${formatSize(size)}`}
      className={`flex h-[22px] max-w-[168px] min-w-0 items-center gap-[5px] rounded-(--radius-control) bg-line text-[10.5px] font-medium text-ink ${
        onRemove ? "pr-[3px] pl-[7px]" : "px-[7px]"
      }`}
    >
      {kind === "image" ? (
        <img
          src={src}
          alt=""
          // many sent messages may hold pictures: decode them off the main path
          loading="lazy"
          decoding="async"
          // the board's thumbnail edge: a white screenshot on the line tint needs it
          className="h-3.5 w-3.5 flex-none rounded-[3px] object-cover outline-1 -outline-offset-1 outline-line-strong"
        />
      ) : kind === "text" ? (
        <FileText size={12} strokeWidth={2} aria-hidden="true" className="flex-none text-icon" />
      ) : (
        <File size={12} strokeWidth={2} aria-hidden="true" className="flex-none text-icon" />
      )}
      <span className="truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          title={`Remove ${name}`}
          aria-label={`Remove ${name}`}
          onClick={() => onRemove(id)}
          className={`flex h-4 w-4 flex-none items-center justify-center rounded-[3px] text-icon transition-colors hover:bg-hover ${FOCUS_RING}`}
        >
          <X size={11} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
});
