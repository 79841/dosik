import { isMacPlatform } from "../lib/windowChrome";
import { useWindowFrame } from "../lib/windowFrame";
import { WindowControls } from "./WindowControls";

/**
 * The caption buttons again, inside a modal dialog (the canvas's Win-Settings
 * and Win-Caption). A dialog opened with `showModal()` leaves everything
 * outside it inert — the band's buttons too, under the scrim — so off macOS
 * each dialog carries this copy, pinned over the band's own at the window's
 * top-right corner: above the scrim, undimmed, pressable. Close asks the
 * window to close with the dialog still up. The copy stays out of the tab
 * order and comes last in the dialog, so its first focus and Tab round are
 * its own. On macOS the native lights stay above any dialog by themselves.
 */
export const DialogCaption = ({ mac = isMacPlatform() }: { mac?: boolean }) => {
  const fullscreen = useWindowFrame((s) => s.fullscreen);
  if (mac || fullscreen) return null;
  return (
    <div data-dialog-caption className="fixed top-0 right-0">
      <WindowControls platform="other" tabbable={false} />
    </div>
  );
};
