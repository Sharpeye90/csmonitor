const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour"))
  };
}

export function resolvePlayedOn(uploadedAt: Date, timeZone: string) {
  const parts = getLocalParts(uploadedAt, timeZone);
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  const adjusted = parts.hour < 6 ? new Date(utcMidnight - ONE_DAY_MS) : new Date(utcMidnight);

  return adjusted;
}

export function formatRuDate(date: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(typeof date === "string" ? new Date(date) : date);
}
