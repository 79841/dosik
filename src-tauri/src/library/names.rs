//! What the folder-backed library names things on disk: a project, a folder
//! or a diagram is called what its folder or file is called, so a name the
//! user types becomes a file name — cleaned so every file system takes it,
//! and made unique among its siblings.
//!
//! The MCP server names things by the same rules; `rules.json` holds the
//! cases both must agree on.

use std::cmp::Ordering;

/// a name is at most this many characters — what the name fields allow
pub const MAX_NAME_CHARS: usize = 80;
/// and at most this many bytes of UTF-8: a file name is 255 bytes at most on
/// most file systems, and the extension and a " 2" must still fit
pub const MAX_NAME_BYTES: usize = 240;

pub const UNTITLED_DIAGRAM: &str = "Untitled Diagram";
pub const UNTITLED_FOLDER: &str = "Untitled Folder";
pub const UNTITLED_PROJECT: &str = "Untitled Project";

/// characters no file name may hold on one platform or another
const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// names Windows keeps for devices, whatever follows a dot
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// `raw` as a file name: forbidden and control characters become `-`; dots
/// and spaces at either end go (a leading dot hides a file, a trailing one
/// Windows drops); a Windows device name gets a `-`; at most
/// `MAX_NAME_CHARS` and `MAX_NAME_BYTES`; nothing left is `default`.
pub fn clean(raw: &str, default: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let name = fit(trim_ends(&replaced), MAX_NAME_CHARS, MAX_NAME_BYTES);
    // a truncation can leave a device name behind, and the `-` a long one
    let name = fit(&avoid_reserved(&name), MAX_NAME_CHARS, MAX_NAME_BYTES);
    if name.is_empty() {
        default.to_string()
    } else {
        name
    }
}

fn trim_ends(name: &str) -> &str {
    name.trim_matches(|c: char| c == '.' || c.is_whitespace())
}

/// `name` cut to `chars` characters and `bytes` bytes, never inside a
/// character, without the dots and spaces the cut leaves at its end
fn fit(name: &str, chars: usize, bytes: usize) -> String {
    let mut out = String::new();
    for (count, c) in name.chars().enumerate() {
        if count == chars || out.len() + c.len_utf8() > bytes {
            break;
        }
        out.push(c);
    }
    trim_ends(&out).to_string()
}

/// `name` with a `-` after a Windows device name — `con` and `con.txt` are
/// both the console there
fn avoid_reserved(name: &str) -> String {
    let stem_end = name.find('.').unwrap_or(name.len());
    let stem = name[..stem_end].trim_end();
    if RESERVED.contains(&stem.to_lowercase().as_str()) {
        format!("{stem}-{}", &name[stem.len()..])
    } else {
        name.to_string()
    }
}

/// `name` as two names are compared for a clash: lower case, and Hangul in
/// composed form — macOS ignores case, and hands back names Finder made in
/// decomposed form, both of which open the same file
pub fn fold(name: &str) -> String {
    compose_hangul(name).to_lowercase()
}

/// whether two names clash in one folder
pub fn same(a: &str, b: &str) -> bool {
    fold(a) == fold(b)
}

/// Composes conjoining Hangul jamo into syllables — the algorithmic part of
/// NFC, which is all a Korean name needs; other scripts are left as they are.
fn compose_hangul(name: &str) -> String {
    const S_BASE: u32 = 0xAC00;
    const L_BASE: u32 = 0x1100;
    const V_BASE: u32 = 0x1161;
    const T_BASE: u32 = 0x11A7;
    let mut out: Vec<char> = Vec::with_capacity(name.len());
    for c in name.chars() {
        let code = c as u32;
        if let Some(last) = out.last_mut() {
            let prev = *last as u32;
            let composed =
                if (L_BASE..L_BASE + 19).contains(&prev) && (V_BASE..V_BASE + 21).contains(&code) {
                    char::from_u32(S_BASE + ((prev - L_BASE) * 21 + (code - V_BASE)) * 28)
                } else if (S_BASE..S_BASE + 11172).contains(&prev)
                    && (prev - S_BASE).is_multiple_of(28)
                    && (T_BASE + 1..T_BASE + 28).contains(&code)
                {
                    char::from_u32(prev + (code - T_BASE))
                } else {
                    None
                };
            if let Some(syllable) = composed {
                *last = syllable;
                continue;
            }
        }
        out.push(c);
    }
    out.into_iter().collect()
}

/// `wanted`, or the first of `wanted 2`, `wanted 3`, … that `taken` does not
/// hold — cut so the number still fits the limits. `taken` leaves out the
/// item being renamed: a name it already has, in any case, is no clash.
pub fn unique_name(wanted: &str, mut taken: impl FnMut(&str) -> bool) -> String {
    if !taken(wanted) {
        return wanted.to_string();
    }
    let mut n: u64 = 2;
    loop {
        let suffix = format!(" {n}");
        let base = fit(
            wanted,
            MAX_NAME_CHARS - suffix.len(),
            MAX_NAME_BYTES - suffix.len(),
        );
        let candidate = format!("{base}{suffix}");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The order names sort in when nothing else says: ignoring case, numbers
/// by value (`Flow 2` before `Flow 10`); names that still tie go by their
/// characters, so the order never depends on how they were found.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (fa, fb) = (fold(a), fold(b));
    let (mut x, mut y) = (fa.chars().peekable(), fb.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(cx), Some(cy)) if cx.is_ascii_digit() && cy.is_ascii_digit() => {
                let nx = digits(&mut x);
                let ny = digits(&mut y);
                let by_value = nx
                    .trim_start_matches('0')
                    .len()
                    .cmp(&ny.trim_start_matches('0').len())
                    .then_with(|| nx.trim_start_matches('0').cmp(ny.trim_start_matches('0')));
                if by_value != Ordering::Equal {
                    return by_value;
                }
            }
            (Some(cx), Some(cy)) => {
                if cx != cy {
                    return cx.cmp(&cy);
                }
                x.next();
                y.next();
            }
        }
    }
}

fn digits(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut run = String::new();
    while let Some(c) = chars.next_if(char::is_ascii_digit) {
        run.push(c);
    }
    run
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::Value;

    /// the cases the app and the MCP server share
    pub(crate) fn rules() -> Value {
        serde_json::from_str(include_str!("rules.json")).expect("rules.json is JSON")
    }

    fn cases(section: &str) -> Vec<Value> {
        rules()[section].as_array().expect(section).clone()
    }

    fn text(case: &Value, key: &str) -> String {
        case[key]
            .as_str()
            .unwrap_or_else(|| panic!("{key} in {case}"))
            .to_string()
    }

    #[test]
    fn the_limits_are_the_shared_ones() {
        let rules = rules();
        assert_eq!(rules["limits"]["chars"], MAX_NAME_CHARS);
        assert_eq!(rules["limits"]["bytes"], MAX_NAME_BYTES);
    }

    #[test]
    fn names_are_cleaned_by_the_shared_rules() {
        for case in cases("clean") {
            let out = clean(&text(&case, "in"), &text(&case, "default"));
            assert_eq!(out, text(&case, "out"), "{case}");
            assert!(out.chars().count() <= MAX_NAME_CHARS, "{case}");
            assert!(out.len() <= MAX_NAME_BYTES, "{case}");
        }
    }

    #[test]
    fn names_clash_by_the_shared_rules() {
        for case in cases("same") {
            let want = case["same"].as_bool().unwrap();
            assert_eq!(same(&text(&case, "a"), &text(&case, "b")), want, "{case}");
        }
    }

    #[test]
    fn unique_names_follow_the_shared_rules() {
        for case in cases("unique") {
            let except = case["except"].as_str().map(fold);
            let taken: Vec<String> = case["taken"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| fold(t.as_str().unwrap()))
                .filter(|t| Some(t) != except.as_ref())
                .collect();
            let out = unique_name(&text(&case, "wanted"), |c| taken.contains(&fold(c)));
            assert_eq!(out, text(&case, "out"), "{case}");
            assert!(out.chars().count() <= MAX_NAME_CHARS, "{case}");
            assert!(out.len() <= MAX_NAME_BYTES, "{case}");
        }
    }

    #[test]
    fn names_sort_by_the_shared_rules() {
        for case in cases("natural") {
            let want: Vec<&str> = case
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            let mut got = want.clone();
            got.reverse();
            got.sort_by(|a, b| natural_cmp(a, b));
            assert_eq!(got, want);
        }
    }

    #[test]
    fn a_cleaned_name_is_clean_again() {
        for case in cases("clean") {
            let once = clean(&text(&case, "in"), "x");
            assert_eq!(clean(&once, "x"), once, "{case}");
        }
    }

    #[test]
    fn decomposed_hangul_composes_and_other_text_stays() {
        // 한글, as Finder may store it
        let nfd = "\u{1112}\u{1161}\u{11AB}\u{1100}\u{1173}\u{11AF}";
        assert_eq!(compose_hangul(nfd), "\u{D55C}\u{AE00}");
        // a lone leading consonant and Latin with a combining accent are left alone
        assert_eq!(compose_hangul("\u{1100}x"), "\u{1100}x");
        assert_eq!(compose_hangul("e\u{0301}"), "e\u{0301}");
        // a syllable that already has a final consonant takes no second one
        assert_eq!(compose_hangul("\u{AC01}\u{11A8}"), "\u{AC01}\u{11A8}");
    }

    #[test]
    fn natural_order_is_total_and_stable() {
        assert_eq!(natural_cmp("a", "a"), Ordering::Equal);
        assert_eq!(natural_cmp("a01", "a1"), Ordering::Less);
        assert_eq!(natural_cmp("a1", "a01"), Ordering::Greater);
        assert_eq!(natural_cmp("", "a"), Ordering::Less);
        assert_eq!(
            natural_cmp("99999999999999999999999", "100000000000000000000000"),
            Ordering::Less
        );
    }
}
