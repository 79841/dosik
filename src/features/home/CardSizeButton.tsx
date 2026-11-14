import { ChevronDown, Grid2x2 } from "lucide-react";
import { useRef, useState } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { belowRightOf, Menu } from "../../shared/ui/Menu";
import { CARD_SIZES, type CardSize } from "./homeGrid";
import { useCardSize, useHomeMode } from "./homeMode";

const LABEL: Record<CardSize, string> = { small: "Small", medium: "Medium", large: "Large" };

/**
 * The cards' size (#236 D5, `Home-CardSize`): in Home's header row wherever
 * cards fill the sheet — the Cards dashboard, a Cards folder view, Recent.
 * Its menu is the shared radio menu — Small, Medium, Large, the current one
 * ticked — under the button's right end. One size for every card grid;
 * until one is picked, Medium.
 */
export const CardSizeButton = () => {
  const size = useCardSize();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = (returnFocus: boolean) => {
    setAt(null);
    if (returnFocus) button.current?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`Card size: ${LABEL[size]}`}
        // the canvas's tooltip (`Home-CardSize`): the glyph alone does not say it
        title="Card size"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => setAt(at ? null : belowRightOf(e.currentTarget))}
        className={`flex h-7 flex-none items-center gap-0.5 rounded-md pl-1.5 pr-1 transition-colors ${
          at ? "bg-selected text-ink" : "text-icon hover:bg-hover"
        } ${FOCUS_RING}`}
      >
        <Grid2x2 size={15} strokeWidth={1.75} aria-hidden="true" />
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className="text-muted" />
      </button>
      {at ? (
        <Menu
          at={at}
          label="Card size"
          opener={button}
          items={CARD_SIZES.map((choice) => ({
            label: LABEL[choice],
            checked: choice === size,
            onSelect: () => useHomeMode.getState().setSize(choice),
          }))}
          onSelect={(item) => {
            close(true);
            item.onSelect();
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
};
