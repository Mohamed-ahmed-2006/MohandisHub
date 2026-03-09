import type { Reservation, ReservationSlot } from '@mohandishub/shared';
import { describe, expect, it } from 'vitest';

import {
  buildMonthMatrix,
  chooseInitialSelectedDay,
  formatLocalDateKey,
  groupReservationsByDate,
  groupSlotsByDate,
} from '../components/app/calendar-utils';

const dayCountInMatrix = (monthStart: Date): number =>
  buildMonthMatrix(monthStart)
    .flat()
    .filter((cell) => cell.dayOfMonth != null).length;

describe('buildMonthMatrix', () => {
  it('creates the expected day counts for 28/29/30/31-day months', () => {
    expect(dayCountInMatrix(new Date(2026, 1, 1))).toBe(28);
    expect(dayCountInMatrix(new Date(2024, 1, 1))).toBe(29);
    expect(dayCountInMatrix(new Date(2026, 3, 1))).toBe(30);
    expect(dayCountInMatrix(new Date(2026, 4, 1))).toBe(31);
  });

  it('aligns month start index for all weekdays', () => {
    const weekdayCoverage = new Set<number>();

    for (let year = 2024; year <= 2032; year += 1) {
      for (let month = 0; month < 12; month += 1) {
        const monthStart = new Date(year, month, 1);
        const firstRow = buildMonthMatrix(monthStart)[0];
        if (!firstRow) {
          throw new Error('Month matrix must include at least one week row');
        }
        const firstDayIndex = firstRow.findIndex((cell) => cell.dayOfMonth === 1);
        expect(firstDayIndex).toBe(monthStart.getDay());
        weekdayCoverage.add(monthStart.getDay());
      }
    }

    expect(weekdayCoverage.size).toBe(7);
  });
});

describe('date grouping', () => {
  it('groups slots and reservations by local YYYY-MM-DD key', () => {
    const slots = [
      {
        id: 's1',
        providerId: 'p1',
        startAt: '2026-03-15T09:00:00',
        endAt: '2026-03-15T10:00:00',
        status: 'available',
        supportsOnline: true,
        supportsOffline: false,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
      {
        id: 's2',
        providerId: 'p1',
        startAt: '2026-03-16T09:00:00',
        endAt: '2026-03-16T10:00:00',
        status: 'available',
        supportsOnline: true,
        supportsOffline: true,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ] as ReservationSlot[];

    const reservations = [
      { id: 'r1', requestedStartAt: '2026-03-15T11:30:00' },
      { id: 'r2', requestedStartAt: '2026-03-16T12:00:00' },
    ] as Reservation[];

    const groupedSlots = groupSlotsByDate(slots);
    const groupedReservations = groupReservationsByDate(reservations);

    const keyMarch15 = formatLocalDateKey(new Date('2026-03-15T09:00:00'));
    const keyMarch16 = formatLocalDateKey(new Date('2026-03-16T09:00:00'));

    expect(groupedSlots[keyMarch15]).toHaveLength(1);
    expect(groupedSlots[keyMarch16]).toHaveLength(1);
    expect(groupedReservations[keyMarch15]).toHaveLength(1);
    expect(groupedReservations[keyMarch16]).toHaveLength(1);
  });
});

describe('chooseInitialSelectedDay', () => {
  it('prefers today when today is in the selected month', () => {
    const selected = chooseInitialSelectedDay({
      monthStart: new Date(2026, 2, 1),
      today: new Date(2026, 2, 9),
      slotBuckets: {},
      reservationBuckets: {},
    });

    expect(selected).toBe('2026-03-09');
  });

  it('falls back to first day with data when today is outside month', () => {
    const selected = chooseInitialSelectedDay({
      monthStart: new Date(2026, 2, 1),
      today: new Date(2026, 3, 1),
      slotBuckets: { '2026-03-07': [] as ReservationSlot[] },
      reservationBuckets: { '2026-03-03': [] as Reservation[] },
    });

    expect(selected).toBe('2026-03-03');
  });

  it('falls back to day 1 when no today-in-month and no data exists', () => {
    const selected = chooseInitialSelectedDay({
      monthStart: new Date(2026, 2, 1),
      today: new Date(2026, 4, 1),
      slotBuckets: {},
      reservationBuckets: {},
    });

    expect(selected).toBe('2026-03-01');
  });
});
