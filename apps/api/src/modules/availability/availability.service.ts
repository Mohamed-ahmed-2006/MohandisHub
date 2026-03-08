// ---------------------------------------------------------------------------
// Availability service — business logic
// ---------------------------------------------------------------------------

import { HttpError } from '../../utils/http-error.js';

import { AvailabilityRepository } from './availability.repository.js';
import type { SlotRow } from './availability.repository.js';
import type { CreateSlotInput, CreateSlotsInput, UpdateSlotInput } from './availability.validation.js';

function toSlot(row: SlotRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status as import('@mohandishub/shared').SlotStatus,
    bookingId: row.booking_id,
    createdAt: row.created_at,
  };
}

export class AvailabilityService {
  constructor(private readonly repo: AvailabilityRepository = new AvailabilityRepository()) {}

  async list(providerId: string, from: string, to: string, availableOnly?: boolean) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (toDate <= fromDate) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_RANGE',
        message: 'to must be after from.',
      });
    }
    const rows = availableOnly
      ? await this.repo.listAvailableByProvider(providerId, fromDate, toDate)
      : await this.repo.listByProvider(providerId, fromDate, toDate);
    return { items: rows.map(toSlot) };
  }

  async create(providerId: string, input: CreateSlotInput) {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (endAt <= startAt) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SLOT',
        message: 'endAt must be after startAt.',
      });
    }
    const row = await this.repo.create(providerId, startAt, endAt);
    return toSlot(row);
  }

  async createMany(providerId: string, input: CreateSlotsInput) {
    const results = [];
    for (const slot of input.slots) {
      const startAt = new Date(slot.startAt);
      const endAt = new Date(slot.endAt);
      if (endAt <= startAt) continue; // skip invalid
      const row = await this.repo.create(providerId, startAt, endAt);
      results.push(toSlot(row));
    }
    return { items: results };
  }

  async update(id: string, providerId: string, input: UpdateSlotInput) {
    const slot = await this.repo.findById(id);
    if (!slot) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Slot not found.',
      });
    }
    if (slot.provider_id !== providerId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Not your slot.',
      });
    }
    if (slot.status === 'booked') {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_BOOKED',
        message: 'Cannot modify a booked slot.',
      });
    }
    const updates: { status?: string; startAt?: Date; endAt?: Date } = {};
    if (input.status !== undefined) updates.status = input.status;
    if (input.startAt !== undefined) updates.startAt = new Date(input.startAt);
    if (input.endAt !== undefined) updates.endAt = new Date(input.endAt);
    const updated = await this.repo.update(id, updates);
    return updated ? toSlot(updated) : null;
  }

  async delete(id: string, providerId: string) {
    const slot = await this.repo.findById(id);
    if (!slot) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Slot not found.',
      });
    }
    if (slot.provider_id !== providerId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Not your slot.',
      });
    }
    if (slot.status === 'booked') {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_BOOKED',
        message: 'Cannot delete a booked slot.',
      });
    }
    const deleted = await this.repo.delete(id);
    if (!deleted) {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_BOOKED',
        message: 'Cannot delete a booked slot.',
      });
    }
    return { deleted: true };
  }
}
