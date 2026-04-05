// UTF-8 char boundary helpers for safe string slicing.
//
// All pipeline code that computes byte positions via arithmetic (byte offsets,
// chunk sizes, overlap steps, etc.) MUST snap those positions to valid char
// boundaries before slicing. These helpers make that a one-liner instead of
// scattered inline `while !is_char_boundary` loops.

/// Snap a byte position backwards to the nearest valid UTF-8 char boundary.
/// Returns a position <= `pos` that is safe to use in `&text[..pos]` or `&text[start..pos]`.
#[inline]
pub fn floor_char_boundary(text: &str, pos: usize) -> usize {
    let mut p = pos.min(text.len());
    while p > 0 && !text.is_char_boundary(p) {
        p -= 1;
    }
    p
}

/// Snap a byte position forward to the next valid UTF-8 char boundary.
/// Returns a position >= `pos` that is safe to use in `&text[pos..]` or `&text[pos..end]`.
#[inline]
pub fn ceil_char_boundary(text: &str, pos: usize) -> usize {
    let mut p = pos.min(text.len());
    while p < text.len() && !text.is_char_boundary(p) {
        p += 1;
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ascii_passthrough() {
        let text = "hello world";
        assert_eq!(floor_char_boundary(text, 5), 5);
        assert_eq!(ceil_char_boundary(text, 5), 5);
    }

    #[test]
    fn test_floor_snaps_back() {
        // '●' is U+25CF, encoded as 3 bytes: E2 97 8F
        let text = "ab●cd"; // bytes: a(0) b(1) E2(2) 97(3) 8F(4) c(5) d(6)
        assert_eq!(floor_char_boundary(text, 2), 2); // start of ●
        assert_eq!(floor_char_boundary(text, 3), 2); // mid ● → snaps to start
        assert_eq!(floor_char_boundary(text, 4), 2); // mid ● → snaps to start
        assert_eq!(floor_char_boundary(text, 5), 5); // start of 'c'
    }

    #[test]
    fn test_ceil_snaps_forward() {
        let text = "ab●cd";
        assert_eq!(ceil_char_boundary(text, 2), 2); // start of ●
        assert_eq!(ceil_char_boundary(text, 3), 5); // mid ● → snaps to 'c'
        assert_eq!(ceil_char_boundary(text, 4), 5); // mid ● → snaps to 'c'
        assert_eq!(ceil_char_boundary(text, 5), 5); // start of 'c'
    }

    #[test]
    fn test_emoji_4_bytes() {
        let text = "a🎉b"; // a(0) F0(1) 9F(2) 8E(3) 89(4) b(5)
        assert_eq!(floor_char_boundary(text, 2), 1); // mid emoji → snaps to start
        assert_eq!(ceil_char_boundary(text, 2), 5);  // mid emoji → snaps past
    }

    #[test]
    fn test_beyond_len() {
        let text = "hi";
        assert_eq!(floor_char_boundary(text, 100), 2);
        assert_eq!(ceil_char_boundary(text, 100), 2);
    }

    #[test]
    fn test_zero() {
        let text = "●hello";
        assert_eq!(floor_char_boundary(text, 0), 0);
        assert_eq!(ceil_char_boundary(text, 0), 0);
    }

    #[test]
    fn test_empty_string() {
        assert_eq!(floor_char_boundary("", 0), 0);
        assert_eq!(ceil_char_boundary("", 0), 0);
        assert_eq!(floor_char_boundary("", 5), 0);
        assert_eq!(ceil_char_boundary("", 5), 0);
    }
}
