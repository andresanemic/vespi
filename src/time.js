'use strict';

// One internal time contract for clocks, expirations, receipts, and deadlines.
const MIN_TIME = -62167219200000;
const MAX_TIME = 253402300799999;

function parseTime(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isInteger(value) && value >= MIN_TIME && value <= MAX_TIME
      ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= MIN_TIME && parsed <= MAX_TIME ? parsed : null;
}

module.exports = { parseTime };
