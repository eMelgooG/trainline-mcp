# trainline-mcp

An MCP (Model Context Protocol) server for [thetrainline.com](https://www.thetrainline.com), letting AI assistants search train journeys and find the cheapest fares across a date range.

> **Disclaimer:** This project uses thetrainline.com's internal web API. It is unofficial, unsupported by Trainline, and may break if they change their API. Use responsibly and respect their [Terms of Service](https://www.thetrainline.com/info/terms).

## Tools

| Tool | Description |
|------|-------------|
| `search_stations` | Find stations by name or CRS code |
| `search_journeys` | List available trains between two stations on a date |
| `get_price_calendar` | Cheapest fare per day over a date range |

## Setup

### Requirements

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/eMelgooG/trainline-mcp.git
cd trainline-mcp
npm install
npm run build
```

### Optional environment variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `TRAINLINE_USER_AGENT` | Chrome 124 UA | Browser User-Agent sent to Trainline |
| `TRAINLINE_LOCALE` | `en-GB` | Locale for station names and prices |
| `TRAINLINE_USER_DATA_DIR` | `./.trainline-profile` | Persistent Chrome profile directory |

## How authentication works

Trainline is protected by DataDome bot detection. On first use, a real Chrome
window opens so you can sign in (and solve a CAPTCHA if prompted). The session
— cookies, localStorage, and DataDome trust fingerprint — is persisted to
`.trainline-profile/`, so subsequent runs skip the login and rarely get
challenged.

> **First run:** The very first request can take 2–3 minutes while Chrome launches cold, DataDome fingerprints the fresh profile, and the session is established. Subsequent requests are fast (~2–3 seconds).

The browser window stays open while the MCP server runs — it's the live
session used for every API call. It closes automatically when the server
stops. If DataDome challenges mid-session, the CAPTCHA will appear in that
window and the server will wait (up to 5 minutes) for you to solve it before
retrying your request.

## Integration

### GitHub Copilot CLI

Add the following to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "trainline": {
      "command": "node",
      "args": ["C:\\trainline-mcp\\build\\index.js"]
    }
  }
}
```

- Windows: `%USERPROFILE%\.copilot\mcp-config.json`
- macOS/Linux: `~/.copilot/mcp-config.json`

The change takes effect after restarting any active Copilot CLI session.


## Example prompts

- *"Find me trains from London Euston to Manchester Piccadilly on 2026-05-10"*
- *"What's the cheapest day to travel from Edinburgh to London next week?"*
- *"Show me trains from EUS to BHM after 8am on 2026-05-15 for 2 adults"*

## License

[MIT](LICENSE)
