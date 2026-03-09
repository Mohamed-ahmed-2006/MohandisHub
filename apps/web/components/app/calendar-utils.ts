import type { Reservation, ReservationSlot } from '@mohandishub/shared';

export type CalendarMonthCell = {
  date: Date | null;
  dateKey: string | null;
  dayOfMonth: number | null;
};

const pad2 = (value: number): string => value.toString().padStart(2, '0');

export const formatLocalDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const parseDateKey = (dateKey: string): Date => {
  const [yearPart = '', monthPart = '1', dayPart = '1'] = dateKey.split('-');
  const parsedYear = Number.parseInt(yearPart, 10);
  const parsedMonth = Number.parseInt(monthPart, 10);
  const parsedDay = Number.parseInt(dayPart, 10);
  const year = Number.isFinite(parsedYear) ? parsedYear : 1970;
  const month = Number.isFinite(parsedMonth) ? parsedMonth : 1;
  const day = Number.isFinite(parsedDay) ? parsedDay : 1;
  return new Date(year, month - 1, day);
};

export const isDateInMonth = (date: Date, monthStart: Date): boolean =>
  date.getFullYear() === monthStart.getFullYear() && date.getMonth() === monthStart.getMonth();

export const isDateKeyInMonth = (dateKey: string, monthStart: Date): boolean => {
  const parsed = parseDateKey(dateKey);
  return isDateInMonth(parsed, monthStart);
};

export const buildMonthMatrix = (monthStartInput: Date): CalendarMonthCell[][] => {
  const monthStart = new Date(monthStartInput.getFullYear(), monthStartInput.getMonth(), 1);
  const firstWeekday = monthStart.getDay();
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const cells: CalendarMonthCell[] = [];
  for (let index = 0; index < totalCells; index += 1) {
    const dayOfMonth = index - firstWeekday + 1;
    if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
      cells.push({ date: null, dateKey: null, dayOfMonth: null });
      continue;
    }
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayOfMonth);
    cells.push({
      date,
      dateKey: formatLocalDateKey(date),
      dayOfMonth,
    });
  }

  const matrix: CalendarMonthCell[][] = [];
  for (let row = 0; row < cells.length; row += 7) {
    matrix.push(cells.slice(row, row + 7));
  }
  return matrix;
};

const groupByDateKey = <T>(items: T[], resolveDate: (item: T) => Date): Record<string, T[]> => {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = formatLocalDateKey(resolveDate(item));
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
};

export const groupSlotsByDate = (slots: ReservationSlot[]): Record<string, ReservationSlot[]> =>
  groupByDateKey(slots, (slot) => new Date(slot.startAt));

export const groupReservationsByDate = (
  reservations: Reservation[],
): Record<string, Reservation[]> =>
  groupByDateKey(reservations, (reservation) => new Date(reservation.requestedStartAt));

export const chooseInitialSelectedDay = ({
  monthStart,
  today = new Date(),
  slotBuckets,
  reservationBuckets,
}: {
  monthStart: Date;
  today?: Date;
  slotBuckets: Record<string, ReservationSlot[]>;
  reservationBuckets: Record<string, Reservation[]>;
}): string => {
  if (isDateInMonth(today, monthStart)) {
    return formatLocalDateKey(today);
  }

  const mergedKeys = Array.from(
    new Set<string>([...Object.keys(slotBuckets), ...Object.keys(reservationBuckets)]),
  )
    .filter((key) => isDateKeyInMonth(key, monthStart))
    .sort();
  const firstKey = mergedKeys.at(0);
  if (firstKey) {
    return firstKey;
  }

  return formatLocalDateKey(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1));
};
