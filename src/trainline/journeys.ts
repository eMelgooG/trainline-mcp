import { browserPost } from "./client.js";
import { resolveStationCode } from "./stations.js";

export interface JourneyResult {
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  originName: string;
  destinationName: string;
  changes: number;
  cheapestPrice: number | null;
  currency: string | null;
  fareType: string | null;
  seatsRemaining: number | null;
  journeyId: string;
}

interface Fare {
  id: string;
  fullPrice: { amount: number; currencyCode: string };
  fareLegs: Array<{ legId: string }>;
  fareType: string;
  availability?: { status?: string; remaining?: number };
}

interface Journey {
  id: string;
  departAt: string;
  arriveAt: string;
  duration?: string;
  legs: string[];
}

interface TrainlineJourneySearchResponse {
  data: {
    journeySearch: {
      journeys: Record<string, Journey>;
      fares: Record<string, Fare>;
    };
    fareTypes?: Record<string, { id: string; name: string }>;
  };
}

function buildRequestBody(
  originCode: string,
  destinationCode: string,
  isoDatetime: string,
  adults: number,
  maxJourneys: number
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
        journeyDate: { type: "departAfter", time: isoDatetime },
      },
    ],
    type: "single",
    maximumJourneys: maxJourneys,
    composition: ["through"],
  };
}

// ISO 8601 duration "PT2H6M" → minutes
function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return 0;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mn = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + mn;
}

function findCheapestFareForJourney(
  journey: Journey,
  fares: Fare[]
): Fare | null {
  const journeyLegIds = new Set(journey.legs);
  // A fare is "for this journey" if it covers exactly this journey's legs
  const matching = fares.filter(
    (f) =>
      f.fareLegs.length === journey.legs.length &&
      f.fareLegs.every((fl) => journeyLegIds.has(fl.legId))
  );
  if (matching.length === 0) return null;
  return matching.reduce((min, f) =>
    f.fullPrice.amount < min.fullPrice.amount ? f : min
  );
}

export async function searchJourneys(params: {
  origin: string;
  destination: string;
  date: string;
  time?: string;
  adults?: number;
  maxResults?: number;
}): Promise<JourneyResult[]> {
  const {
    origin,
    destination,
    date,
    time = "00:00",
    adults = 1,
    maxResults = 10,
  } = params;

  const [originCode, destinationCode] = await Promise.all([
    resolveStationCode(origin),
    resolveStationCode(destination),
  ]);

  const isoDatetime = `${date}T${time}:00`;

  const body = buildRequestBody(
    originCode,
    destinationCode,
    isoDatetime,
    adults,
    maxResults
  );

  const response = await browserPost<TrainlineJourneySearchResponse>(
    "/api/journey-search/",
    body
  );

  const { journeys, fares } = response.data.journeySearch;
  const fareTypes = response.data.fareTypes ?? {};
  const allFares = Object.values(fares);

  return Object.values(journeys).map((journey) => {
    const cheapestFare = findCheapestFareForJourney(journey, allFares);

    const durationMinutes = journey.duration
      ? parseIsoDuration(journey.duration)
      : Math.round(
          (new Date(journey.arriveAt).getTime() -
            new Date(journey.departAt).getTime()) /
            60_000
        );

    const fareTypeName = cheapestFare
      ? fareTypes[cheapestFare.fareType]?.name ?? null
      : null;

    return {
      journeyId: journey.id,
      departureTime: journey.departAt,
      arrivalTime: journey.arriveAt,
      durationMinutes,
      originName: origin,
      destinationName: destination,
      changes: Math.max(0, journey.legs.length - 1),
      cheapestPrice: cheapestFare?.fullPrice.amount ?? null,
      currency: cheapestFare?.fullPrice.currencyCode ?? null,
      fareType: fareTypeName,
      seatsRemaining: cheapestFare?.availability?.remaining ?? null,
    };
  });
}
