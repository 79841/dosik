/**
 * Base64 → bytes, for handing a rendered image to something that wants the
 * real thing (the clipboard, #143).
 *
 * The renderers produce base64 because that is what the file-writing command
 * takes across the Tauri boundary; nothing in the app needed the bytes
 * themselves until the clipboard did.
 */
export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
