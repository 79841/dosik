/**
 * A project's badge in the DOM (#236): its letter is `aria-hidden`, so what is
 * read — and what a test compares — is the text around it.
 */
const BADGE = '[class*="bg-badge-"]';

/** the first project badge inside `el` */
export const badgeIn = (el: Element): HTMLElement | null => el.querySelector<HTMLElement>(BADGE);

/** every project badge inside `el` */
export const badgesIn = (el: Element): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>(BADGE),
];

/** `el`'s text without the badges' letters */
export const spoken = (el: Element): string => {
  const copy = el.cloneNode(true) as Element;
  for (const badge of copy.querySelectorAll(BADGE)) badge.remove();
  return copy.textContent ?? "";
};
