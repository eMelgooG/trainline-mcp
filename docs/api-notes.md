# Trainline Web API — Reverse-Engineering Notes

All endpoints are on `https://www.thetrainline.com`. No authentication required for search, but requests must come through a real browser session to pass DataDome bot detection (see Bot Detection section below).

## Required headers

```
Accept: application/json
Accept-Encoding: gzip, deflate, br
Accept-Language: en-GB
User-Agent: <realistic browser UA>
x-version: <current Trainline app version>
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

### Response — UK operators (e.g. Avanti, LNER)

Fares are keyed by fare ID and linked to journeys via `fareLegs`:

```
data.journeySearch.journeys   — dict keyed by journey ID
  .id
  .departAt                   — ISO 8601 datetime
  .arriveAt
  .durationInMinutes
  .legs[]                     — array of leg IDs (length - 1 = changes)

data.journeySearch.fares      — dict keyed by fare ID
  .fareType
  .journeyId                  — links to a journey
  .fullPrice.amount
  .fullPrice.currencyCode     — e.g. "GBP"
  .fareLegs[].legId           — matches legs in the journey

data.fareTypes                — dict keyed by fare type ID
  .name                       — e.g. "Advance", "Off-Peak"
```

### Response — Continental operators (e.g. Trenitalia, SNCF)

Fares are nested inside `sections` → `alternatives` rather than a top-level `fares` dict:

```
data.journeySearch.journeys
  .sections[]                 — array of section IDs

data.journeySearch.sections   — dict keyed by section ID
  .alternatives[]             — array of alternative IDs (one per fare option)

data.journeySearch.alternatives — dict keyed by alternative ID
  .fullPrice.amount
  .fullPrice.currencyCode     — e.g. "EUR"
  .legs[]                     — leg IDs for this alternative
```

> **Important:** Always check both schemas. A response may contain `fares` (UK) or `alternatives` (continental) or both if the route crosses operators.

---

## Price calendar

No dedicated endpoint exists. Implemented by making one journey-search request per day with `maximumJourneys: 1` and reading the cheapest fare from the response.

---

## Bot detection (DataDome)

Trainline uses **DataDome** for bot detection. Raw HTTP requests will receive a `403` with a DataDome challenge body.

### How the bypass works

- All API calls are made via `page.evaluate()` inside a **persistent Playwright/Chromium browser context**
- On first launch, a real Chrome window opens for the user to log in and solve any CAPTCHA manually
- The session (cookies, localStorage, DataDome fingerprint) is persisted to `.trainline-profile/` on disk
- Subsequent runs reuse the profile — no CAPTCHA is triggered in normal use
- If a mid-session `403` occurs, the server waits up to 5 minutes for the user to solve the CAPTCHA in the open browser window, then retries automatically

### Resilience observed

- 100 rapid sequential calls (Rome → Naples, 5 batches of 20) — **0 blocks, 0 CAPTCHAs**
- DataDome trust is robust once a real human session is established

### First run

The very first request on a fresh profile can take **2–3 minutes** while Chrome launches cold and DataDome fingerprints the new session. Subsequent requests respond in ~2–3 seconds.

