import { client } from "./client.js";
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

interface TrainlineJourneySearchResponse {
  data: {
    journeySearch: {
      journeys: Record<
        string,
        {
          id: string;
          departAt: string;
          arriveAt: string;
          durationInMinutes?: number;
          legs?: unknown[];
          originName?: string;
          destinationName?: string;
        }
      >;
      fares: Record<
        string,
        {
          id: string;
          fareType: string;
          journeyId: string;
          fullPrice: { amount: number; currencyCode: string };
          availability: { remaining?: number };
        }
      >;
      fareTypes?: Record<string, { id: string; name: string }>;
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

/**
 * Search for train journeys between two stations on a given date.
 */
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

  const response = await client.post<TrainlineJourneySearchResponse>(
    "/api/journey-search/",
    body
  );

  const { journeys, fares, fareTypes: journeyFareTypes } =
    response.data.data.journeySearch;
  const fareTypes = journeyFareTypes ?? response.data.data.fareTypes ?? {};

  const faresByJourney: Record<
    string,
    Array<(typeof fares)[string]>
  > = {};
  for (const fare of Object.values(fares)) {
    if (!faresByJourney[fare.journeyId]) faresByJourney[fare.journeyId] = [];
    faresByJourney[fare.journeyId].push(fare);
  }

  return Object.values(journeys).map((journey) => {
    const journeyFares = faresByJourney[journey.id] ?? [];
    const cheapestFare =
      journeyFares.length > 0
        ? journeyFares.reduce((min, f) =>
            f.fullPrice.amount < min.fullPrice.amount ? f : min
          )
        : null;

    const durationMs =
      new Date(journey.arriveAt).getTime() -
      new Date(journey.departAt).getTime();
    const durationMinutes =
      journey.durationInMinutes ?? Math.round(durationMs / 60_000);

    const fareTypeName = cheapestFare
      ? (fareTypes[cheapestFare.fareType]?.name ?? cheapestFare.fareType)
      : null;

    return {
      journeyId: journey.id,
      departureTime: journey.departAt,
      arrivalTime: journey.arriveAt,
      durationMinutes,
      originName: journey.originName ?? origin,
      destinationName: journey.destinationName ?? destination,
      changes: journey.legs ? Math.max(0, journey.legs.length - 1) : 0,
      cheapestPrice: cheapestFare?.fullPrice.amount ?? null,
      currency: cheapestFare?.fullPrice.currencyCode ?? null,
      fareType: fareTypeName,
      seatsRemaining: cheapestFare?.availability.remaining ?? null,
    };
  });
}
