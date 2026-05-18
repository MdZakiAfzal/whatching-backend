import { DateTime } from 'luxon';
import AppError from '../utils/AppError';

export const isValidTimezone = (timezone: string) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const resolveScheduledBroadcastTime = ({
  scheduledAt,
  scheduledLocal,
  timezone,
  defaultTimezone,
}: {
  scheduledAt?: string;
  scheduledLocal?: string;
  timezone?: string;
  defaultTimezone: string;
}) => {
  if (!scheduledAt && !scheduledLocal) {
    return null;
  }

  if (scheduledAt && scheduledLocal) {
    throw new AppError('Provide either scheduledAt or scheduledLocal, not both.', 400);
  }

  if (scheduledAt) {
    const dateTime = DateTime.fromISO(scheduledAt, { zone: 'utc' });
    if (!dateTime.isValid) {
      throw new AppError('scheduledAt must be a valid ISO datetime.', 400);
    }

    if (dateTime.toMillis() <= Date.now()) {
      throw new AppError('scheduledAt must be in the future.', 400);
    }

    return {
      scheduledAt: dateTime.toUTC().toJSDate(),
      scheduledTimezone: timezone || defaultTimezone,
      scheduledLocalTime: dateTime.setZone(timezone || defaultTimezone).toISO(),
    };
  }

  const effectiveTimezone = timezone || defaultTimezone;
  if (!isValidTimezone(effectiveTimezone)) {
    throw new AppError('A valid IANA timezone is required for scheduledLocal.', 400);
  }

  const localDateTime = DateTime.fromISO(String(scheduledLocal), {
    zone: effectiveTimezone,
  });

  if (!localDateTime.isValid) {
    throw new AppError('scheduledLocal must be a valid ISO local datetime.', 400);
  }

  if (localDateTime.toMillis() <= Date.now()) {
    throw new AppError('scheduledLocal must be in the future.', 400);
  }

  return {
    scheduledAt: localDateTime.toUTC().toJSDate(),
    scheduledTimezone: effectiveTimezone,
    scheduledLocalTime: localDateTime.toISO(),
  };
};
