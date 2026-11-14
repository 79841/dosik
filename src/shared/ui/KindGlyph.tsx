import { Folder, FolderOpen, Workflow } from "lucide-react";

interface GlyphProps {
  /** 16 in a row; a card or a frame head passes its own */
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * The glyphs that stand for a folder or a diagram, duotone by kind (#236 D2):
 * a folder is blue over its tint, a diagram pink with its two squares tinted.
 * They keep their colour on a selected row. Action icons (New folder, Open
 * file…) are not these — they stay `icon` grey.
 */
export const FolderGlyph = ({
  open = false,
  size = 16,
  strokeWidth = 1.75,
  className = "",
}: GlyphProps & { open?: boolean }) => {
  const Icon = open ? FolderOpen : Folder;
  return (
    <Icon
      data-folder-icon={open ? "open" : "closed"}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      className={`flex-none fill-glyph-folder-soft text-glyph-folder ${className}`}
    />
  );
};

export const DiagramGlyph = ({ size = 16, strokeWidth = 1.75, className = "" }: GlyphProps) => (
  <Workflow
    size={size}
    strokeWidth={strokeWidth}
    aria-hidden="true"
    className={`flex-none text-glyph-diagram [&_rect]:fill-glyph-diagram-soft ${className}`}
  />
);
