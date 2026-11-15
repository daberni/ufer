const syncUrl = process.env.SYNC_URL || "http://app:3000/api/cron";
const syncHour = Number(process.env.SYNC_HOUR || 6);

if (!Number.isInteger(syncHour) || syncHour < 0 || syncHour > 23) {
  throw new Error("SYNC_HOUR must be between 0 and 23.");
}

if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
  throw new Error("CRON_SECRET must contain at least 32 characters.");
}

let completedDay;
let running = false;
const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

async function tick() {
  const parts = Object.fromEntries(clock.formatToParts(new Date()).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;

  if (running || completedDay === day || Number(parts.hour) !== syncHour) {
    return;
  }

  running = true;
  completedDay = day;

  try {
    const response = await fetch(syncUrl, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`
      },
      signal: AbortSignal.timeout(10 * 60_000)
    });
    const result = await response.json();

    if (!response.ok) {
      console.error(JSON.stringify({
        event: "daily-sync-failed",
        day,
        httpStatus: response.status,
        traceId: result.traceId,
        instance: result.instance
      }));

      return;
    }

    console.log(JSON.stringify({
      event: "daily-sync",
      day,
      httpStatus: response.status,
      status: result.status,
      inserted: result.inserted
    }));
  } catch {
    console.error(JSON.stringify({
      event: "daily-sync-failed",
      day
    }));
  } finally {
    running = false;
  }
}

await tick();
setInterval(tick, 60_000);
