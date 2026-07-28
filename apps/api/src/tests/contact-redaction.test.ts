import { describe, expect, it } from 'vitest';

import {
  containsContactDetails,
  normalizeDigits,
  redactContactDetails,
  REDACTION_MARKER,
} from '../utils/contact-redaction.js';

describe('normalizeDigits', () => {
  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts Extended Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('leaves Arabic letters untouched', () => {
    expect(normalizeDigits('مرحبا')).toBe('مرحبا');
  });
});

describe('redactContactDetails — must catch contact details', () => {
  it('redacts an Egyptian mobile number', () => {
    const { content, redacted } = redactContactDetails('call me on 01012345678');
    expect(redacted).toBe(true);
    expect(content).not.toContain('01012345678');
    expect(content).toContain(REDACTION_MARKER);
  });

  it('redacts a number written with Arabic-Indic digits', () => {
    expect(containsContactDetails('رقمي ٠١٠١٢٣٤٥٦٧٨')).toBe(true);
  });

  it('redacts a number broken up with spaces and dashes', () => {
    expect(containsContactDetails('0 1 0 - 1 2 3 - 4 5 6 7')).toBe(true);
  });

  it('redacts an international format number', () => {
    expect(containsContactDetails('+20 100 123 4567')).toBe(true);
  });

  it('redacts a plain email address', () => {
    const { content, redacted } = redactContactDetails('email me at ahmed@gmail.com');
    expect(redacted).toBe(true);
    expect(content).not.toContain('ahmed@gmail.com');
  });

  it('redacts an obfuscated email', () => {
    expect(containsContactDetails('ahmed (at) gmail (dot) com')).toBe(true);
  });

  it('redacts a URL', () => {
    expect(containsContactDetails('see https://example.com/portfolio')).toBe(true);
  });

  it('redacts a bare domain', () => {
    expect(containsContactDetails('my site is mywork.net')).toBe(true);
  });

  it('redacts WhatsApp mentions in English and Arabic', () => {
    expect(containsContactDetails('message me on WhatsApp')).toBe(true);
    expect(containsContactDetails('كلمني على واتساب')).toBe(true);
  });

  it('redacts a social handle', () => {
    expect(containsContactDetails('follow @ahmed.designs')).toBe(true);
  });

  it('redacts a phone number spelled out in words', () => {
    expect(
      containsContactDetails('zero one zero one two three four five six seven eight'),
    ).toBe(true);
  });
});

describe('redactContactDetails — must NOT over-redact legitimate text', () => {
  it('keeps a price', () => {
    const { content, redacted } = redactContactDetails('I can do it for 5000 EGP');
    expect(redacted).toBe(false);
    expect(content).toBe('I can do it for 5000 EGP');
  });

  it('keeps dimensions', () => {
    const { redacted } = redactContactDetails('the room is 4 by 5 meters, ceiling 320 cm');
    expect(redacted).toBe(false);
  });

  it('keeps a delivery estimate', () => {
    const { redacted } = redactContactDetails('I need 14 days to finish');
    expect(redacted).toBe(false);
  });

  it('keeps a year', () => {
    const { redacted } = redactContactDetails('the building was built in 1998');
    expect(redacted).toBe(false);
  });

  it('keeps ordinary Arabic prose with a small number', () => {
    const { redacted } = redactContactDetails('المساحة 120 متر والسعر 8000 جنيه');
    expect(redacted).toBe(false);
  });

  it('keeps a short quantity list', () => {
    const { redacted } = redactContactDetails('I need 3 doors and 12 windows');
    expect(redacted).toBe(false);
  });

  it('returns empty input unchanged', () => {
    expect(redactContactDetails('')).toEqual({ content: '', redacted: false });
  });
});

describe('redactContactDetails — known limitations (documented, not asserted as safe)', () => {
  it('does not redact a 6-digit run (below the phone threshold)', () => {
    // Documents the deliberate trade-off: 6 digits is far more likely to be a
    // price or measurement than a phone number. A determined user could split a
    // number across messages; the real enforcement is the paywalled award.
    expect(containsContactDetails('123456')).toBe(false);
  });
});
