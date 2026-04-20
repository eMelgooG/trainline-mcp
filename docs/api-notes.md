# Trainline Web API — Reverse-Engineering Notes

All endpoints are on `https://www.thetrainline.com`. No authentication required for search.

## Required headers

```
Accept: application/json
Accept-Encoding: gzip, deflate, br
Accept-Language: en-GB
User-Agent: <realistic browser UA>
```

---

## Station / location search

**Endpoint:** `GET /api/locations-search/v2/search`

**Query params:**

| Param | Example | Notes |
|-------|---------|-------|
| `searchTerm` | `London Euston` | Free-text or CRS code |
| `limit` | `5` | Max results |
| `locale` | `en-GB` | Language for names |

**Response shape:**
```json
{
  "searchLocations": [
    {
      "code": "EUS",
      "name": "London Euston",
      "countryCode": "GB"
    }
  ]
}
```

The `code` field is the station identifier used in journey search.

---

## Journey search

**Endpoint:** `POST /api/journey-search/`

**Request body:**
```json
{
  "passengers": [
    { "id": "p1", "type": "adult" }
  ],
  "transitDefinitions": [
    {
      "direction": "outward",
      "origin": "EUS",
      "destination": "MAN",
      "journeyDate": {
        "type": "departAfter",
        "time": "2026-05-10T08:00:00"
      }
    }
  ],
  "type": "single",
  "maximumJourneys": 10,
  "composition": ["through"]
}
```

**Key response fields:**
```
data.journeySearch.journeys  — dict keyed by journey ID
  .id
  .departAt                  — ISO 8601 datetime
  .arriveAt                  — ISO 8601 datetime
  .durationInMinutes
  .legs[]                    — array of legs (length - 1 = changes)
  .originName
  .destinationName

data.journeySearch.fares     — dict keyed by fare ID
  .fareType                  — references fareTypes dict
  .journeyId                 — links to a journey
  .fullPrice.amount          — numeric price
  .fullPrice.currencyCode    — e.g. "GBP"
  .availability.remaining    — seats left (optional)

data.fareTypes               — dict keyed by fare type ID
  .id
  .name                      — e.g. "Advance", "Off-Peak"
```

---

## Price calendar

No dedicated endpoint exists. Implemented by making one journey-search request per day with `maximumJourneys: 1` and reading the cheapest fare from the response. Requests are rate-limited to **3 concurrent** to avoid triggering bot detection.

---

## Bot detection notes

- 403 with `"captcha"` in the body means the session was flagged.
- Using a realistic `User-Agent` and keeping request rate low avoids this.
- No CSRF token or cookie is required for anonymous searches.
