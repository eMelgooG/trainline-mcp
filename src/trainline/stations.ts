import { client, LOCALE } from "./client.js";

export interface Station {
  code: string;
  name: string;
  countryCode?: string;
}

interface LocationsSearchResponse {
  searchLocations: Array<{
    code: string;
    name: string;
    countryCode?: string;
  }>;
}

/**
 * Resolve a free-text station name or CRS code to a list of matching stations.
 * Uses thetrainline.com locations-search API (no auth required).
 */
export async function searchStations(
  query: string,
  limit = 5
): Promise<Station[]> {
  const response = await client.get<LocationsSearchResponse>(
    "/api/locations-search/v2/search",
    {
      params: { searchTerm: query, limit, locale: LOCALE },
    }
  );

  return response.data.searchLocations.map((loc) => ({
    code: loc.code,
    name: loc.name,
    countryCode: loc.countryCode,
  }));
}

/**
 * Resolve a station name/code to its Trainline station code.
 * Throws if no match is found.
 */
export async function resolveStationCode(nameOrCode: string): Promise<string> {
  const results = await searchStations(nameOrCode, 1);
  if (results.length === 0) {
    throw new Error(`No station found matching "${nameOrCode}"`);
  }
  return results[0].code;
}
