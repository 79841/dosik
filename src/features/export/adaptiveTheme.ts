/**
 * One SVG that follows the theme of wherever it is shown (#202).
 *
 * A drawing with no background sits on the page's own: light-theme ink on a
 * dark chat is close to invisible, and whoever asks for the drawing (a model
 * in a chat) cannot know that page's theme. So the light drawing keeps its
 * colours as attributes — what any viewer reads — and a `<style>` block
 * carries the dark ones, switched on by the page:
 *
 * - `data-mode="dark"` (Claude's widgets), `data-theme="dark"` or `.dark` on
 *   an ancestor — the app's own theme, which can differ from the system's;
 * - otherwise the system setting (`prefers-color-scheme`) — a guess, since a
 *   page that names no theme may still be white; so then, and only then, the
 *   drawing lays its own dark backdrop, the way the chat view does when its
 *   host names no theme (#202). A page that says `class="light"` is
 *   not guessed at.
 *
 * The dark colours come from rendering the same document in the dark theme
 * and pairing the two markups tag by tag — not from a second colour table, so
 * the two can't drift. A CSS rule beats a presentation attribute, which is
 * what lets one override the other.
 */

/** attributes a theme may change — anything else differing means the two drawings are not the same picture */
const THEMED = new Set([
  "fill",
  "stroke",
  "flood-color",
  "stop-color",
  "color",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "flood-opacity",
]);

const TAG = /<[^>]+>/g;
const ATTRIBUTE = /\s([\w:-]+)="([^"]*)"/g;

const attributesOf = (tag: string): Map<string, string> =>
  new Map([...tag.matchAll(ATTRIBUTE)].map((m) => [m[1] as string, m[2] as string]));

const nameOf = (tag: string): string => /^<\/?([\w:-]+)/.exec(tag)?.[1] ?? "";

/** a short name for this drawing, so two of them on one page don't share rules */
const hashOf = (text: string): string => {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36).slice(0, 6);
};

/**
 * `tag` with `name` in its class list. A tag that has a class already (an
 * edge's `edge`, a label's `pill`) gets it added there — a second `class`
 * attribute is not well-formed XML.
 */
const withClass = (tag: string, name: string): string => {
  if (/\sclass="/.test(tag)) return tag.replace(/\sclass="([^"]*)"/, ` class="$1 ${name}"`);
  const end = tag.endsWith("/>") ? "/>" : ">";
  return `${tag.slice(0, -end.length)} class="${name}"${end}`;
};

const scoped = (selector: string) =>
  [`[data-mode="dark"] ${selector}`, `[data-theme="dark"] ${selector}`, `.dark ${selector}`].join(
    ", ",
  );

/**
 * `light` with `dark`'s colours as theme-switched rules. Both must be the same
 * drawing — same tags, same text, same attributes but for colours.
 */
export const mergeThemes = (
  light: string,
  dark: string,
  { backdrop }: { backdrop?: string } = {},
): string => {
  const lightTags = light.match(TAG) ?? [];
  const darkTags = dark.match(TAG) ?? [];
  if (lightTags.length !== darkTags.length || light.replace(TAG, "") !== dark.replace(TAG, "")) {
    throw new Error("the light and dark drawings differ in shape — they cannot be merged");
  }
  const prefix = `dk${hashOf(light)}`;
  /** one class per set of dark colours, shared by every tag that needs it */
  const classes = new Map<string, string>();
  const tags = lightTags.map((tag, at) => {
    const other = darkTags[at] as string;
    if (nameOf(tag) !== nameOf(other))
      throw new Error(`<${nameOf(tag)}> pairs with <${nameOf(other)}>`);
    const mine = attributesOf(tag);
    const theirs = attributesOf(other);
    const changes: string[] = [];
    for (const name of new Set([...mine.keys(), ...theirs.keys()])) {
      if (mine.get(name) === theirs.get(name)) continue;
      if (!THEMED.has(name) || !theirs.has(name)) {
        throw new Error(`<${nameOf(tag)}> differs in ${name}, which a theme does not change`);
      }
      changes.push(`${name}: ${theirs.get(name)}`);
    }
    if (changes.length === 0) return tag;
    const rule = changes.join("; ");
    if (!classes.has(rule)) classes.set(rule, `${prefix}-${classes.size}`);
    return withClass(tag, classes.get(rule) as string);
  });
  if (classes.size === 0) return light;

  const rules = [...classes].map(([rule, name]) => ({ selector: `.${name}`, rule }));
  const guessed = ":root:not([data-mode]):not([data-theme]):not(.light)";
  const root = `${prefix}-root`;
  const css = [
    ...rules.map(({ selector, rule }) => `${scoped(selector)} { ${rule} }`),
    "@media (prefers-color-scheme: dark) {",
    ...rules.map(({ selector, rule }) => `${guessed} ${selector} { ${rule} }`),
    // inline in a page, or the file opened on its own (then the svg is :root)
    ...(backdrop ? [`${guessed} .${root}, svg:root.${root} { background: ${backdrop} }`] : []),
    "}",
  ].join("\n");

  // the root svg is named, so the guessed-theme backdrop can find it
  tags[0] = withClass(tags[0] as string, root);
  // the text between tags is unchanged; put the merged tags back in their places
  let at = 0;
  const merged = light.replace(TAG, () => tags[at++] as string);
  // after <title> when there is one, so the drawing's name stays the first child
  const anchor = merged.indexOf("</title>");
  const insertAt = anchor >= 0 ? anchor + "</title>".length : merged.indexOf(">") + 1;
  return `${merged.slice(0, insertAt)}<style>${css}</style>${merged.slice(insertAt)}`;
};
