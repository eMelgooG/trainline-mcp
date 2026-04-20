#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchJourneys } from "./trainline/journeys.js";
import { getPriceCalendar } from "./trainline/calendar.js";
import { searchStations } from "./trainline/stations.js";

const server = new McpServer({
  name: "trainline-mcp",
  version: "1.0.0",
});

// ── Tool: search_stations ────────────────────────────────────────────────────
server.registerTool(
  "search_stations",
  {
    description:
      "Search for train stations by name or CRS code on thetrainline.com. " +
      "Useful for finding the exact station name before searching journeys.",
    inputSchema: z.object({
      query: z.string().describe("Station name or CRS code to search for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe("Maximum number of results to return"),
    }),
  },
  async ({ query, limit }) => {
    const stations = await searchStations(query, limit);
    if (stations.length === 0) {
      return {
        content: [{ type: "text", text: `No stations found for "${query}".` }],
      };
    }
    const lines = stations.map(
      (s) =>
        `• ${s.name}${s.countryCode ? ` (${s.countryCode})` : ""} — code: ${s.code}`
    );
    return {
      content: [
        {
          type: "text",
          text: `Found ${stations.length} station(s) for "${query}":\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ── Tool: search_journeys ────────────────────────────────────────────────────
server.registerTool(
  "search_journeys",
  {
    description:
      "Search for available train journeys on thetrainline.com between two stations on a given date. " +
      "Returns departure/arrival times, duration, price, and operator.",
    inputSchema: z.object({
      origin: z
        .string()
        .describe("Departure station name or CRS code (e.g. 'London Euston' or 'EUS')"),
      destination: z
        .string()
        .describe("Arrival station name or CRS code (e.g. 'Manchester Piccadilly' or 'MAN')"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Travel date in YYYY-MM-DD format"),
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .default("00:00")
        .describe("Earliest departure time in HH:MM format (default: 00:00)"),
      adults: z
        .number()
        .int()
        .min(1)
        .max(9)
        .optional()
        .default(1)
        .describe("Number of adult passengers (default: 1)"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe("Maximum number of journeys to return (default: 10)"),
    }),
  },
  async (params) => {
    const journeys = await searchJourneys(params);

    if (journeys.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No journeys found from ${params.origin} to ${params.destination} on ${params.date}.`,
          },
        ],
      };
    }

    const lines = journeys.map((j, i) => {
      const dep = new Date(j.departureTime).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const arr = new Date(j.arrivalTime).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const hrs = Math.floor(j.durationMinutes / 60);
      const mins = j.durationMinutes % 60;
      const duration = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      const changes =
        j.changes === 0 ? "Direct" : `${j.changes} change${j.changes > 1 ? "s" : ""}`;
      const price =
        j.cheapestPrice !== null && j.currency
          ? `${j.currency} ${j.cheapestPrice.toFixed(2)}${j.fareType ? ` (${j.fareType})` : ""}`
          : "Price unavailable";
      const seats =
        j.seatsRemaining !== null ? ` — ${j.seatsRemaining} seats left` : "";

      return `${i + 1}. ${dep} → ${arr}  [${duration}, ${changes}]  ${price}${seats}`;
    });

    return {
      content: [
        {
          type: "text",
          text:
            `Journeys from ${params.origin} to ${params.destination} on ${params.date}` +
            ` (${params.adults ?? 1} adult${(params.adults ?? 1) > 1 ? "s" : ""}):\n\n` +
            lines.join("\n"),
        },
      ],
    };
  }
);

// ── Tool: get_price_calendar ─────────────────────────────────────────────────
server.registerTool(
  "get_price_calendar",
  {
    description:
      "Find the cheapest available train fare for each day over a date range on thetrainline.com. " +
      "Useful for finding the cheapest day to travel.",
    inputSchema: z.object({
      origin: z
        .string()
        .describe("Departure station name or CRS code"),
      destination: z
        .string()
        .describe("Arrival station name or CRS code"),
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Start of date range in YYYY-MM-DD format"),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("End of date range in YYYY-MM-DD format (max 14 days from startDate recommended)"),
      adults: z
        .number()
        .int()
        .min(1)
        .max(9)
        .optional()
        .default(1)
        .describe("Number of adult passengers (default: 1)"),
    }),
  },
  async (params) => {
    const { startDate, endDate } = params;

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      return {
        content: [{ type: "text", text: "endDate must be on or after startDate." }],
      };
    }

    const days =
      Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 31) {
      return {
        content: [
          {
            type: "text",
            text: "Date range is too large. Please limit to 31 days at a time.",
          },
        ],
      };
    }

    const calendar = await getPriceCalendar(params);

    const lines = calendar.map((day) => {
      const price =
        day.cheapestPrice !== null && day.currency
          ? `${day.currency} ${day.cheapestPrice.toFixed(2)}`
          : "No service";
      return `${day.date}: ${price}`;
    });

    const available = calendar.filter((d) => d.cheapestPrice !== null);
    const cheapest =
      available.length > 0
        ? available.reduce((min, d) =>
            d.cheapestPrice! < min.cheapestPrice! ? d : min
          )
        : null;

    const summary = cheapest
      ? `\n\nCheapest day: ${cheapest.date} at ${cheapest.currency} ${cheapest.cheapestPrice!.toFixed(2)}`
      : "";

    return {
      content: [
        {
          type: "text",
          text:
            `Price calendar from ${params.origin} to ${params.destination}:\n\n` +
            lines.join("\n") +
            summary,
        },
      ],
    };
  }
);

// ── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
