import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError, AppError } from '../middleware/errorHandler';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const router: Router = Router();

router.use(authenticate);

// Upload directory - relative to project root
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Allowed file types
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
];

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// List attachments for an entity
router.get('/', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const { entityType, entityId, documentId } = req.query;

    if (!entityType || !entityId) {
      throw new ValidationError([{ message: 'entityType and entityId are required' }]);
    }

    const where: any = {
      entityType: entityType as string,
      entityId: entityId as string,
    };

    if (documentId) {
      where.documentId = documentId as string;
    }

    const attachments = await prisma.attachment.findMany({
      where,
      include: {
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: attachments });
  } catch (error) {
    next(error);
  }
});

// Upload a file attachment
// Expects multipart/form-data with 'file' field and form fields: entityType, entityId, documentId?, description?
router.post('/upload', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    // Check if we have the file data in the body (base64 encoded)
    const schema = z.object({
      entityType: z.enum(['ORDER', 'INQUIRY', 'DOCUMENT', 'QUOTATION']),
      entityId: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'entityId must be alphanumeric'),
      documentId: z.string().optional(),
      description: z.string().optional(),
      fileName: z.string().min(1),
      mimeType: z.string().min(1),
      fileData: z.string().min(1), // base64 encoded file content
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;

    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      throw new AppError(`File type ${data.mimeType} is not allowed`, 400);
    }

    // Decode base64 file
    const fileBuffer = Buffer.from(data.fileData, 'base64');

    // Check file size
    if (fileBuffer.length > MAX_FILE_SIZE) {
      throw new AppError(`File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`, 400);
    }

    // Generate unique filename
    const ext = path.extname(data.fileName) || '.bin';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

    // Create entity subfolder
    const entityFolder = path.join(UPLOAD_DIR, data.entityType.toLowerCase(), data.entityId);
    
    // Validate resolved path stays within UPLOAD_DIR (defense in depth)
    const resolvedFolder = path.resolve(entityFolder);
    if (!resolvedFolder.startsWith(path.resolve(UPLOAD_DIR))) {
      throw new AppError('Invalid entity ID', 400);
    }
    
    if (!fs.existsSync(entityFolder)) {
      fs.mkdirSync(entityFolder, { recursive: true });
    }

    // Save file
    const filePath = path.join(entityFolder, uniqueName);
    fs.writeFileSync(filePath, fileBuffer);

    // Store relative path in database
    const relativePath = path.join(data.entityType.toLowerCase(), data.entityId, uniqueName);

    // Create attachment record
    const attachment = await prisma.attachment.create({
      data: {
        entityType: data.entityType,
        entityId: data.entityId,
        documentId: data.documentId,
        fileName: uniqueName,
        originalName: data.fileName,
        mimeType: data.mimeType,
        fileSize: fileBuffer.length,
        filePath: relativePath,
        description: data.description,
        uploadedById: req.user!.id,
      },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
    });

    res.status(201).json({ success: true, data: attachment });
  } catch (error) {
    next(error);
  }
});

// Download an attachment
router.get('/:id/download', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
    });

    if (!attachment) throw new NotFoundError('Attachment');

    const filePath = path.join(UPLOAD_DIR, attachment.filePath);
    
    // Validate resolved path stays within UPLOAD_DIR
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
      throw new AppError('Invalid file path', 400);
    }

    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('File');
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
    res.setHeader('Content-Length', attachment.fileSize);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

// Delete an attachment
router.delete('/:id', can('OPERATIONS_MANAGE'), async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
    });

    if (!attachment) throw new NotFoundError('Attachment');

    // Delete file from disk
    const filePath = path.join(UPLOAD_DIR, attachment.filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete record
    await prisma.attachment.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: 'Attachment deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as attachmentRouter };
