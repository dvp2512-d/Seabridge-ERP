/**
 * Company profile: the exporter's own details, printed on every outgoing
 * document. A single row, so GET returns it and PUT upserts it.
 *
 * Readable by anyone who can view settings, but only writable by roles with
 * SETTINGS_MANAGE - these values appear on legal documents such as the
 * commercial invoice, so they are not casually editable.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError } from '../middleware/errorHandler';

const router: Router = Router();

router.use(authenticate);

const profileSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required'),
  tradeName: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional(),
  originCountry: z.string().optional(),
  gstNumber: z.string().optional().nullable(),
  iecCode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  email: z.string().email('Enter a valid email').optional().nullable().or(z.literal('')),
  website: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankBranch: z.string().optional().nullable(),
  bankAccountNo: z.string().optional().nullable(),
  bankBeneficiary: z.string().optional().nullable(),
  bankSwiftCode: z.string().optional().nullable(),
  bankIfscCode: z.string().optional().nullable(),
  bankChargesNote: z.string().optional().nullable(),
  quotationTerms: z.string().optional().nullable(),
  invoiceDeclaration: z.string().optional().nullable(),
});

// Read the profile. Returns null when it has not been set up yet so the UI can
// show an empty form rather than an error.
router.get('/company', can('SETTINGS_VIEW'), async (_req, res, next) => {
  try {
    const profile = await prisma.companyProfile.findFirst();
    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

// Create or update the single profile row.
router.put('/company', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const validation = profileSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // Treat an empty email string as "not set" rather than storing ''.
    const data = { ...validation.data };
    if (data.email === '') data.email = null;

    const existing = await prisma.companyProfile.findFirst();
    const profile = existing
      ? await prisma.companyProfile.update({ where: { id: existing.id }, data })
      : await prisma.companyProfile.create({ data });

    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

export { router as settingsRouter };
