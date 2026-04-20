import { resolveStationCode } from "./stations.js";
import { client } from "./client.js";

export interface CalendarDay {
  date: string;
  cheapestPrice: number | null;
  currency: string | null;
}

interface TrainlineJourneySearchResponse {
  data: {
    journeySearch: {
      fares: Record<
        string,
        {
          fullPrice: { amount: number; currencyCode: string };
        }
      >;
    };
  };
}

function buildSingleDayBody(
  originCode: string,
  destinationCode: string,
  isoDate: string,
  adults: number
) {
  const passengers = Array.from({ length: adults }, (_, i) => ({
    id: `p${i + 1}`,
    type: "adult",
  }));

  return {
    passengers,
    transitDefinitions: [
      {
        direction: "outward",
        origin: originCode,
        destination: destinationCode,
        journeyDate: { type: "departAfter", time: `${isoDate}T00:00:00` },
      },
    ],
    type: "single",
    maximumJourneys: 1,
    composition: ["through"],
  };
}

async function fetchCheapestForDate(
  originCode: string,
  destinationCode: string,
  date: string,
  adults: number
): Promise<{ price: number | null; currency: string | null }> {
  try {
    const body = buildSingleDayBody(originCode, destinationCode, date, adults);
    const response = await client.post<TrainlineJourneySearchResponse>(
      "/api/journey-search/",
      body
    );

    const fares = Object.values(
      response.data.data.journeySearch.fares ?? {}
    );
    if (fares.length === 0) return { price: null, currency: null };

    const cheapest = fares.reduce((min, f) =>
      f.fullPrice.amount < min.fullPrice.amount ? f : min
    );
    return {
      price: cheapest.fullPrice.amount,
      currency: cheapest.fullPrice.currencyCode,
    };
  } catch {
    return { price: null, currency: null };
  }
}

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Max concurrent requests to avoid rate-limiting */
const CONCURRENCY = 3;

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  await Promise.all(Array.from({ length: limit }, runNext));
  return results;
}

/**
 * Return the cheapest available fare for each day in a date range.
 */
export async function getPriceCalendar(params: {
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  adults?: number;
}): Promise<CalendarDay[]> {
  const { origin, destination, startDate, endDate, adults = 1 } = params;

  const [originCode, destinationCode] = await Promise.all([
    resolveStationCode(origin),
    resolveStationCode(destination),
  ]);

  const dates = dateRange(startDate, endDate);

  const tasks = dates.map(
    (date) => () =>
      fetchCheapestForDate(originCode, destinationCode, date, adults)
  );

  const priceResults = await runWithConcurrencyLimit(tasks, CONCURRENCY);

  return dates.map((date, i) => ({
    date,
    cheapestPrice: priceResults[i].price,
    currency: priceResults[i].currency,
  }));
}
