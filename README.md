# shadowmap

Find the apps your colleagues build and use with vibe-coding tools. shadowmap reads the logs you already have and lists who builds on Lovable, Bolt, v0 or Replit, and which apps on `*.lovable.app`, `*.vercel.app`, `*.pages.dev`, ChatGPT Sites or Claude artifacts are in use, with device counts and dates.

It runs locally, sends nothing anywhere and only reads logs. It never blocks anything.

```sh
npx shadowmap scan export.csv
```

```
PLATFORM  ACTIVITY     APPS  DEVICES  DAYS  EVENTS
Lovable   builds apps  -     4        5     61
Lovable   hosted apps  3     12       7     418
Vercel    hosted apps  2     5        6     97
Supabase  app backend  2     9        7     233

APP                                 PLATFORM  DEVICES  DAYS  FIRST SEEN  LAST SEEN
crm-dashboard.lovable.app           Lovable   9        7     2026-11-13  2026-11-20
invoice-helper.vercel.app           Vercel    4        6     2026-11-14  2026-11-20
8c1f2e.frame.claudeusercontent.com  Claude    2        2     2026-11-17  2026-11-18
```

## Get your logs

A week of logs shows which apps people use regularly. Pick the source you have.

### Microsoft Defender for Endpoint

Needs Advanced Hunting, included in Defender for Endpoint Plan 2 and Microsoft 365 E5. Defender for Business and Plan 1 do not include it.

1. Print the query and copy it:
   ```sh
   npx shadowmap defender-query --days 7
   ```
2. In the Microsoft Defender portal, open **Hunting > Advanced hunting**, paste the query and select **Run query**.
3. Select **Export**. Defender saves an Excel workbook.
4. Scan it:
   ```sh
   npx shadowmap scan defender.xlsx
   ```

The query returns one row per device, host and day, so a week stays below the 100,000-row result limit. Advanced Hunting keeps 30 days.

### Zscaler Internet Access

1. Open **Analytics > Web Insights > Logs**. In the Experience Center, open **Logs > Insights > Internet & SaaS**.
2. Set the time range to the last 7 days.
3. Select **Export CSV** and choose the largest record limit. Long queries move to **Job Center**; download the file there.
4. Scan it:
   ```sh
   npx shadowmap scan zscaler.csv
   ```

An export stops at the chosen record limit. If the file has exactly that many rows, export one day at a time and scan all files together.

### Netskope

1. Open **Skope IT > Events > Page Events**.
2. Keep the default date range of the last 7 days.
3. Select **Export**, include the columns **Time**, **Username**, **Domain** and **URL**, and confirm. Netskope emails a download link.
4. Scan it:
   ```sh
   npx shadowmap scan netskope.csv
   ```

### Cloudflare Gateway

Cloudflare keeps about a month of Gateway analytics, and shadowmap reads them through the GraphQL Analytics API. You need `curl` and `jq`.

Gateway records activity only while logging is on. Check it in Cloudflare One under **Traffic controls > Traffic settings > Traffic logging**: **Log traffic activity** must be on, with **Capture all** for DNS and Network logs. If you turn it on now, scan after a week.

1. Create an API token: open **My Profile > API Tokens**, select **Create Token > Create Custom Token** and add the permission **Account > Account Analytics > Read**.
2. Copy your account ID: in the dashboard, press `Ctrl+K` (`Cmd+K` on macOS) and run **Copy account ID**.
3. Query the last 30 days and scan the result:
   ```sh
   export CLOUDFLARE_API_TOKEN=<token>
   npx shadowmap cloudflare-query --account <account-id> --days 30 > query.json
   curl -s https://api.cloudflare.com/client/v4/graphql \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d @query.json \
     | jq -c 'if .errors then error(.errors[0].message) else .data.viewer.accounts[0][][] end' \
     | npx shadowmap scan
   ```

DNS queries name the app and the day, but no user. Network logs from devices running the Cloudflare One Client (WARP) add the user, read from the server name of each TLS connection, so no TLS decryption is needed. Where neither names a user, devices show as `?`, as they do when logs exclude personal data. Each of the two datasets returns at most 10,000 rows. On large networks, query fewer days.

To keep complete logs beyond 30 days, set up [Logpush](https://developers.cloudflare.com/cloudflare-one/insights/logs/logpush/) for the datasets **Gateway DNS** and **Gateway Network** and scan the files with `gunzip -c *.log.gz | npx shadowmap scan`.

### Windows Server DNS

1. In DNS Manager, right-click the server and open **Properties > Debug Logging**.
2. Select **Log packets for debugging**, then **Incoming**, **UDP**, **TCP**, **Queries/Transfers** and **Request**.
3. Keep the log under `C:\Windows\System32\dns\`; recent Windows updates ignore other paths. When the file reaches its maximum size, the oldest entries are overwritten. To keep a full week, run `Set-DnsServerDiagnostics -EnableLogFileRollover $true`.
4. After a week, turn debug logging off again, because it costs CPU and disk.
5. Copy `dns.log` and scan it:
   ```sh
   npx shadowmap scan dns.log
   ```

### Any other log

Firewall and proxy exports or syslog files from FortiGate, Sophos, Palo Alto, Squid and others work directly:

```sh
npx shadowmap scan firewall.log
```

shadowmap finds hostnames in any text format. To count devices, the log needs a user, device or source IP field.

## Usage

```sh
shadowmap scan dns.log proxy-export.csv   # several files, formats may differ
cat firewall.log | shadowmap scan         # stdin
shadowmap scan --json export.csv          # machine-readable report
shadowmap defender-query --days 7         # query for Microsoft Defender
shadowmap cloudflare-query --account ID   # request body for Cloudflare Gateway
shadowmap catalog                         # platforms and domains shadowmap knows
```

Requires Node.js 24 or newer.

shadowmap recognizes CSV exports (comma, semicolon or tab, with or without a report preamble), Excel workbooks (`.xlsx`, first sheet), JSON lines, key=value syslog, Squid access logs and Windows DNS debug logs. Any other text log works too: shadowmap then finds hostnames anywhere in the line, but cannot count devices.

**Devices** counts distinct devices, users or client IP addresses, whichever the log names first. **Days** counts the distinct days with activity.

## What it detects

| Activity    | Meaning                                                   | Examples                                                                                          |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| builds apps | Someone works in an app builder                           | lovable.dev, bolt.new, v0.app, replit.com, base44.com                                             |
| hosted apps | Someone opens a deployed app; the subdomain names the app | `*.lovable.app`, `*.vercel.app`, `*.netlify.app`, `*.pages.dev`, `*.base44.app`, `*.chatgpt.site` |
| app backend | Backend service generated apps commonly use               | `*.supabase.co`, `*.convex.cloud`                                                                 |

The full list is in [`src/platforms.ts`](src/platforms.ts). Apps on a custom domain are only found when the log also records the hosting platform's name, for example as a CNAME.

What shadowmap cannot see: private devices, phones on mobile data and traffic that bypasses your DNS server or proxy.

## Use as a library

```ts
import { Scanner, linesOf } from "shadowmap";

const scanner = new Scanner();

await scanner.scan(linesOf(file.stream()));

const report = scanner.report();
```

The scanner has no Node.js dependencies and runs in browsers.

## Contributing

Missing a platform? Add it to [`src/platforms.ts`](src/platforms.ts) and open a pull request.

```sh
pnpm install
pnpm check
```

## License

MIT
