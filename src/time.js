const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatShanghai(date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeLocalDateTime(value) {
  const match = String(value).trim().match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
  );
  if (!match) return null;

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function normalizeReportedTime(value) {
  if (value === undefined || value === null || value === '') return formatShanghai(new Date());

  if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
    const raw = Number(value);
    const millis = raw < 10000000000 ? raw * 1000 : raw;
    return formatShanghai(new Date(millis));
  }

  const text = String(value).trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (!hasTimezone) {
    const local = normalizeLocalDateTime(text);
    if (local) return local;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatShanghai(parsed);

  return formatShanghai(new Date());
}

function todayInShanghai() {
  return formatShanghai(new Date()).slice(0, 10);
}

function shanghaiDateExpr(column) {
  if (process.env.DATABASE_URL) {
    return `
      CASE
        WHEN ${column} ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
        THEN DATE((${column})::timestamptz AT TIME ZONE 'Asia/Shanghai')
        ELSE DATE((${column})::timestamp)
      END
    `;
  }

  return `
    CASE
      WHEN substr(${column}, -1) = 'Z'
        OR substr(${column}, -6, 1) = '+'
        OR substr(${column}, -6, 1) = '-'
      THEN date(${column}, '+8 hours')
      ELSE date(${column})
    END
  `;
}

module.exports = { normalizeReportedTime, todayInShanghai, shanghaiDateExpr };
