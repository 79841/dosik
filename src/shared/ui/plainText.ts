/**
 * Props for every field the user types into (#174). The macOS web view
 * capitalises the first letter of a field and of each new line, corrects
 * words and underlines "misspellings" — wrong for labels, identifiers like
 * `name:string`, folder names and API keys alike. Spread onto each text
 * `<input>` and `<textarea>`, last; `plainText.test.ts` checks none is left
 * out. On desktop WebKit the lever is most likely `spellCheck` (macOS text
 * checking — capitalisation included — runs only where spellcheck is on);
 * `autocapitalize` and `autocorrect` cover the touch keyboards.
 */
export const PLAIN_TEXT = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;
