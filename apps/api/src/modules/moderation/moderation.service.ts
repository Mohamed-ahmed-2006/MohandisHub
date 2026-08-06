import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { parseNeedReferenceUrls } from '../retention/retention.urls.js';
import { PublicUploadDeletionService } from '../upload/public-upload-deletion.service.js';

import { ModerationRepository } from './moderation.repository.js';

export class ModerationService {
  constructor(
    private readonly logRepo: ModerationRepository = new ModerationRepository(),
    private readonly uploadDeletion: PublicUploadDeletionService = new PublicUploadDeletionService(),
  ) {}

  private async deleteTrustedReferences(
    urls: string[],
    resourceOwnerId: string,
    adminId: string,
  ): Promise<number> {
    let filesRemoved = 0;
    for (const referenceUrl of urls) {
      try {
        const result = await this.uploadDeletion.deleteTrustedReference({
          referenceUrl,
          expectedOwnerId: resourceOwnerId,
          actorId: adminId,
          allowAdmin: true,
        });
        filesRemoved += result.filesRemoved;
      } catch (error) {
        if (error instanceof HttpError && error.code === 'UNTRUSTED_PUBLIC_UPLOAD_REFERENCE') {
          continue;
        }
        throw error;
      }
    }
    return filesRemoved;
  }

  async clearNeedReferences(needId: string, adminId: string): Promise<{ filesRemoved: number }> {
    const pool = getPool();
    const { rows } = await pool.query<{ reference_url: string | null; customer_id: string }>(
      `SELECT reference_url, customer_id FROM needs WHERE id = $1`,
      [needId],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Need not found.' });
    }
    const urls = parseNeedReferenceUrls(row.reference_url);
    const filesRemoved = await this.deleteTrustedReferences(urls, row.customer_id, adminId);
    await pool.query(`UPDATE needs SET reference_url = NULL, updated_at = now() WHERE id = $1`, [
      needId,
    ]);
    await this.logRepo.insertLog({
      adminUserId: adminId,
      action: 'clear_need_references',
      entityType: 'need',
      entityId: needId,
      detail: { filesRemoved, urlsCount: urls.length },
    });
    return { filesRemoved };
  }

  async clearBidAttachment(messageId: string, adminId: string): Promise<{ filesRemoved: number }> {
    const pool = getPool();
    const { rows } = await pool.query<{ attachment_url: string | null; sender_id: string }>(
      `SELECT attachment_url, sender_id FROM bid_messages WHERE id = $1`,
      [messageId],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Message not found.' });
    }
    const u = row.attachment_url?.trim();
    const filesRemoved = u ? await this.deleteTrustedReferences([u], row.sender_id, adminId) : 0;
    await pool.query(`UPDATE bid_messages SET attachment_url = NULL WHERE id = $1`, [messageId]);
    await this.logRepo.insertLog({
      adminUserId: adminId,
      action: 'clear_bid_attachment',
      entityType: 'bid_message',
      entityId: messageId,
      detail: { filesRemoved },
    });
    return { filesRemoved };
  }

  async removeServiceImage(
    serviceId: string,
    urlIndex: number,
    adminId: string,
  ): Promise<{ filesRemoved: number }> {
    const pool = getPool();
    const { rows } = await pool.query<{ images: string[] | null; provider_id: string }>(
      `SELECT images, provider_id FROM services WHERE id = $1`,
      [serviceId],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Service not found.' });
    }
    const images = row.images ?? [];
    if (urlIndex < 0 || urlIndex >= images.length) {
      throw new HttpError({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Invalid image index.',
      });
    }
    const removed = images[urlIndex]!;
    const next = images.filter((_, i) => i !== urlIndex);
    const filesRemoved = removed
      ? await this.deleteTrustedReferences([removed], row.provider_id, adminId)
      : 0;
    await pool.query(`UPDATE services SET images = $2::text[], updated_at = now() WHERE id = $1`, [
      serviceId,
      next,
    ]);
    await this.logRepo.insertLog({
      adminUserId: adminId,
      action: 'remove_service_image',
      entityType: 'service',
      entityId: serviceId,
      detail: { urlIndex, filesRemoved },
    });
    return { filesRemoved };
  }

  async listLogsForExport(params: { from?: Date; to?: Date; limit: number }) {
    return this.logRepo.listLogs(params);
  }
}
