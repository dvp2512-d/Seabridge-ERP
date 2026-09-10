import { z } from 'zod';

/**
 * An email address that is genuinely optional.
 *
 * Web forms submit an untouched input as `''`, not as an absent key. A plain
 * `z.string().email().optional()` rejects that, which is why adding a supplier,
 * CHA, transporter or buyer contact without an email used to fail with
 * "Validation failed" - the field looked optional on screen but was not.
 *
 * Accepts a valid address, an empty string, or nothing, and normalises an empty
 * string to null so the column holds "not set" rather than an empty string. On an
 * update an empty string therefore clears a stored address, while omitting the
 * key entirely leaves it untouched - so a partial update cannot wipe an email it
 * never sent.
 */
export const optionalEmail = z
  .union([z.string().email('Enter a valid email address'), z.literal('')])
  .nullish()
  .transform((value) => (value === '' ? null : value));

/**
 * A 0-5 star rating. Coerced because a form sends the value as a string.
 */
export const optionalRating = z.coerce.number().min(0).max(5).optional();
