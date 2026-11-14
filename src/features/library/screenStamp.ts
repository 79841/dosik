import { focusStillWith } from "../../shared/lib/focusGuard";
import { type AppView, useAppStore } from "./appStore";
import { type HomeView, sameHomeView } from "./homeView";

/** the screen a slow action was asked from: the view, the active tab, what Home shows */
export interface ScreenStamp {
  view: AppView;
  activeTab: string | null;
  homeView: HomeView;
}

/** what a slow action — a move, a delete, a new folder or project — notes as it starts */
export const screenStamp = (): ScreenStamp => {
  const { view, activeTab, homeView } = useAppStore.getState();
  return { view, activeTab, homeView };
};

/**
 * Whether a slow action that ends now may still place the focus, or take
 * Home on (#218 D15): the screen is the one it was asked from, and — given
 * `where` — the focus is nowhere or still in there. The screen as well as
 * the focus: macOS WebKit leaves the focus on the page after a click on a
 * tab or on empty canvas, so the focus alone cannot tell that the user went
 * on (#229). `homeView` is what the action itself moved Home to
 * (a delete does), in place of the stamp's; `null` leaves Home's view out.
 */
export const stillOnScreen = (
  stamp: ScreenStamp,
  {
    where,
    homeView = stamp.homeView,
  }: { where?: (Element | null | undefined)[]; homeView?: HomeView | null } = {},
): boolean => {
  const now = useAppStore.getState();
  return (
    now.view === stamp.view &&
    now.activeTab === stamp.activeTab &&
    (homeView === null || sameHomeView(now.homeView, homeView)) &&
    (where === undefined || focusStillWith(...where))
  );
};
