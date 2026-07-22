import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { parseNeedReferenceUrls } from '../retention/retention.urls.js';

import { ModerationRepository } from './moderation.repository.js';

export class ModerationService {
  private readonly logRepo = new ModerationRepository();

  async clearNeedReferences(needId: string, adminId: string): Promise<{ filesRemoved: number }> {
    const pool = getPool();
    const { rows } = await pool.query<{ reference_url: string | null }>(
      `SELECT reference_url FROM needs WHERE id = $1`,
      [needId],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Need not found.' });
    }
    const urls = parseNeedReferenceUrls(row.reference_url);
    const filesRemoved = 0;
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
    const { rows } = await pool.query<{ attachment_url: string | null }>(
      `SELECT attachment_url FROM bid_messages WHERE id = $1`,
      [messageId],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Message not found.' });
    }
    const filesRemoved = 0;
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
    const { rows } = await pool.query<{ images: string[] | null }>(
      `SELECT images FROM services WHERE id = $1`,
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
    const next = images.filter((_, i) => i !== urlIndex);
    const filesRemoved = 0;
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
