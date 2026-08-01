// ---------------------------------------------------------------------------
// Contact-detail redaction for pre-activation bid chat
// ---------------------------------------------------------------------------
// Before a provider pays the MHC activation price, the customer and provider may
// discuss scope but MUST NOT exchange contact details — otherwise they can take
// the job off-platform and the activation gate (the only launch revenue rail)
// is trivially bypassed.
//
// Design constraints that shaped this:
//   * Arabic-Indic and Extended Arabic-Indic digits are normalised first,
//     because "٠١٢٣٤٥٦٧٨٩" is a fully valid way to write an Egyptian number.
//   * Separator-obfuscation ("0 1 0 - 1 2 3") is common, so digits are counted
//     only after separators are ignored.
//   * This is defence in depth, NOT a guarantee. A determined pair can always
//     smuggle a number past a regex (e.g. splitting it across messages). The
//     gate must therefore never *rely* on redaction alone — attachments are
//     disabled pre-activation and the award itself requires payment, which is
//     the actual enforcement.
// ---------------------------------------------------------------------------

/** Minimum run of digits that we treat as a possible phone number. */
const MIN_PHONE_DIGITS = 7;

const ARABIC_INDIC_OFFSET = 0x0660; // ٠ .. ٩
const EXTENDED_ARABIC_INDIC_OFFSET = 0x06f0; // ۰ .. ۹

/** Convert Arabic-Indic / Extended Arabic-Indic digits to ASCII 0-9. */
export const normalizeDigits = (input: string): string =>
  input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (char) => {
    const code = char.codePointAt(0)!;
    const base =
      code >= EXTENDED_ARABIC_INDIC_OFFSET ? EXTENDED_ARABIC_INDIC_OFFSET : ARABIC_INDIC_OFFSET;
    return String(code - base);
  });

const REDACTION_MARKER = '[contact hidden until activation]';

const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[A-Za-z0-9.-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[A-Za-z]{2,}/gi;

const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b[A-Za-z0-9-]+\.(?:com|net|org|io|me|co|eg|app|dev|link|site|info|biz|xyz)\b(?:\/[^\s]*)?/gi;

/**
 * Social handles and Latin-script messaging-app names.
 * `\b` is safe here because every alternative begins and ends with an ASCII letter.
 */
const SOCIAL_PATTERN =
  /(?:@[A-Za-z0-9._]{3,}|\b(?:whats\s*app|whatsapp|telegram|instagram|facebook|messenger|snapchat|viber|signal|skype|tiktok|linked\s*in)\b)/gi;

/**
 * Arabic-script messaging-app names. These CANNOT use `\b`: JavaScript's `\b` is
 * defined against `\w` (ASCII letters, digits, underscore), so an Arabic letter
 * counts as a non-word character and a pattern like `\bواتساب\b` never matches.
 * Matching these as bare substrings is required, not a shortcut.
 */
const SOCIAL_PATTERN_ARABIC =
  /(?:واتس\s*اب|واتساب|وتساب|تليجرام|تلجرام|تيليجرام|انستجرام|انستغرام|إنستجرام|فيسبوك|فيس\s*بوك|ماسنجر|سناب\s*شات|سنابشات|فايبر|سكايب|تيك\s*توك|لينكد\s*ان)/gi;

/** Digit words used to spell a number out, e.g. "zero one zero" / "صفر واحد". */
const SPELLED_DIGIT_WORDS =
  /(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|صفر|واحد|اثنان|اتنين|ثلاثة|تلاتة|أربعة|اربعة|خمسة|ستة|سبعة|ثمانية|تمانية|تسعة)/gi;

/**
 * Redact a run of digits only when, after ignoring separators, it is long enough
 * to be a phone number. Keeps legitimate numbers (prices, quantities,
 * dimensions, years) readable.
 */
const redactPhoneNumbers = (input: string): { text: string; redacted: boolean } => {
  let redacted = false;
  const candidatePattern = /[0-9][0-9\s._\-()[\]{}+*#/\\]*[0-9]|[0-9]/g;
  const text = input.replace(candidatePattern, (match) => {
    const digitsOnly = match.replace(/\D/g, '');
    if (digitsOnly.length >= MIN_PHONE_DIGITS) {
      redacted = true;
      return REDACTION_MARKER;
    }
    return match;
  });
  return { text, redacted };
};

/**
 * Catch a phone number spelled out in words. Only fires on a long consecutive
 * run so ordinary prose ("one or two doors") survives.
 */
const redactSpelledNumbers = (input: string): { text: string; redacted: boolean } => {
  const runPattern = new RegExp(
    `(?:${SPELLED_DIGIT_WORDS.source}[\\s,._-]+){${MIN_PHONE_DIGITS - 1},}(?:${SPELLED_DIGIT_WORDS.source})`,
    'gi',
  );
  let redacted = false;
  const text = input.replace(runPattern, () => {
    redacted = true;
    return REDACTION_MARKER;
  });
  return { text, redacted };
};

export type RedactionResult = {
  /** Text safe to show before activation. */
  content: string;
  /** True when anything was removed. */
  redacted: boolean;
};

/**
 * Redact contact details from a pre-activation message.
 *
 * Order matters: emails and URLs are matched before phone numbers, because an
 * email local part or URL path can contain long digit runs that would otherwise
 * be replaced first and corrupt the match.
 */
export const redactContactDetails = (input: string): RedactionResult => {
  if (!input) return { content: input, redacted: false };

  const normalized = normalizeDigits(input);
  let redacted = false;

  const applyPattern = (text: string, pattern: RegExp): string =>
    text.replace(pattern, () => {
      redacted = true;
      return REDACTION_MARKER;
    });

  let text = applyPattern(normalized, EMAIL_PATTERN);
  text = applyPattern(text, URL_PATTERN);
  text = applyPattern(text, SOCIAL_PATTERN);
  text = applyPattern(text, SOCIAL_PATTERN_ARABIC);

  const spelled = redactSpelledNumbers(text);
  text = spelled.text;
  redacted = redacted || spelled.redacted;

  const phones = redactPhoneNumbers(text);
  text = phones.text;
  redacted = redacted || phones.redacted;

  // Collapse repeated markers so a spammy message is not a wall of markers.
  const escapedMarker = REDACTION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(`(?:${escapedMarker}[\\s]*){2,}`, 'g'), `${REDACTION_MARKER} `);

  return { content: text.trim(), redacted };
};

/** True when the message contains contact details that would be redacted. */
export const containsContactDetails = (input: string): boolean =>
  redactContactDetails(input).redacted;

export { REDACTION_MARKER, MIN_PHONE_DIGITS };
