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

## Claude Desktop integration

Add the following to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "trainline": {
      "command": "node",
      "args": ["/absolute/path/to/trainline-mcp/build/index.js"]
    }
  }
}
```

**Config file locations:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Example prompts

- *"Find me trains from London Euston to Manchester Piccadilly on 2026-05-10"*
- *"What's the cheapest day to travel from Edinburgh to London next week?"*
- *"Show me trains from EUS to BHM after 8am on 2026-05-15 for 2 adults"*

## License

[MIT](LICENSE)
