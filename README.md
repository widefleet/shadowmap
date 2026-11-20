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

- Endpoint and SIEM: [Microsoft Defender for Endpoint](#microsoft-defender-for-endpoint), [Microsoft Sentinel](#microsoft-sentinel)
- Cloud gateways: [Cloudflare Gateway](#cloudflare-gateway), [Zscaler Internet Access](#zscaler-internet-access), [Netskope](#netskope), [Cisco Umbrella and Secure Access](#cisco-umbrella-and-secure-access)
- Firewalls: [Palo Alto Networks](#palo-alto-networks), [Fortinet FortiGate](#fortinet-fortigate), [Check Point](#check-point), [Sophos Firewall](#sophos-firewall)
- Servers: [Windows Server DNS](#windows-server-dns), [Squid](#squid), [any other log](#any-other-log)

### Microsoft Defender for Endpoint

Needs Advanced Hunting, included in Defender for Endpoint Plan 2 and Microsoft 365 E5. Defender for Business and Plan 1 do not include it.

1. Print the query and copy it:
   ```sh
   npx shadowmap defender-query --days 7
   ```
2. Open [Advanced hunting](https://security.microsoft.com/advanced-hunting) in the Microsoft Defender portal, paste the query and select **Run query**.
3. Select **Export**. Defender saves an Excel workbook.
4. Scan it:
   ```sh
   npx shadowmap scan defender.xlsx
   ```

The query returns one row per device, host and day, so a week stays below the 100,000-row result limit. Advanced Hunting keeps 30 days.

### Microsoft Sentinel

The query reads the normalized DNS and web session data (ASIM) that Sentinel builds from every connected firewall, proxy and DNS server.

1. Print the query and copy it:
   ```sh
   npx shadowmap sentinel-query --days 7
   ```
2. Open your [Log Analytics workspaces](https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.OperationalInsights%2Fworkspaces) in the Azure portal, select the workspace that Sentinel uses and select **Logs**. Switch to **KQL mode**, paste the query and select **Run**.
3. Select **Export > Export to CSV - all columns**.
4. Scan it:
   ```sh
   npx shadowmap scan query_data.csv
   ```

The query returns one row per user, host and day; the Logs page exports up to 500,000 rows. If your workspace is connected to the Microsoft Defender portal, you can also run the query in [Advanced hunting](https://security.microsoft.com/advanced-hunting) and scan the exported workbook.

### Cloudflare Gateway

Cloudflare keeps about a month of Gateway analytics, and shadowmap reads them through the GraphQL Analytics API. You need `curl` and `jq`.

Gateway records activity only while logging is on. Check it under [Traffic settings](https://dash.cloudflare.com/?to=/:account/one/traffic-controls/traffic-settings) in Cloudflare One: in **Traffic logging**, **Log traffic activity** must be on, with **Capture all** for DNS and Network logs. If you turn it on now, scan after a week.

1. Create an [API token](https://dash.cloudflare.com/profile/api-tokens): select **Create Token > Create Custom Token** and add the permission **Account > Account Analytics > Read**.
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

### Cisco Umbrella and Secure Access

1. Open Activity Search: in the [Umbrella dashboard](https://dashboard.umbrella.com), go to **Reporting > Core Reports > Activity Search**; in [Cisco Secure Access](https://dashboard.sse.cisco.com), go to **Monitor > Reports > Activity Search**.
2. Select **Last 7 Days** and set **Requests** to **All**.
3. Under **Columns**, select **Destination**, **Identity**, **Internal IP**, **Date** and **Time**.
4. Select **Export CSV**, enter a title and the largest number of rows, and select **Export**. When **Exported Reports** shows a date instead of "Generating", download the file.
5. Scan it:
   ```sh
   npx shadowmap scan umbrella.csv
   ```

An export holds up to 100,000 rows. If your organization already sends logs to Amazon S3 under **Admin > Log Management**, turn on **Include Optional Log Headers in S3 Export** and scan the DNS logs instead: `gunzip -c dnslogs/*/*.csv.gz | npx shadowmap scan`.

### Palo Alto Networks

URL Filtering logs name each site a user visits, also for HTTPS without decryption. Allowed sites are only logged when their category's action in the URL Filtering profile is **alert**; with **allow**, nothing is logged.

1. Raise the export limit: go to **Device > Setup > Management**, edit **Logging and Reporting Settings**, open **Log Export and Reporting**, set **Max Rows in CSV Export** to `1048576` and commit.
2. Go to **Monitor > Logs > URL Filtering**, enter a filter for the last 7 days, such as `( receive_time geq '2026/11/13 00:00:00' )`, and apply it.
3. Select **Export to CSV**, then **Download file**.
4. Scan it:
   ```sh
   npx shadowmap scan url-log.csv
   ```

With logs in Strata Logging Service, open **Log Viewer** in [Strata Cloud Manager](https://stratacloudmanager.paloaltonetworks.com), choose the URL log, set 7 days and select **Export**, then **Download**. Scan the file with `gunzip -c *.gz | npx shadowmap scan`.

### Fortinet FortiGate

Web Filter logs name each site, also without deep inspection. Allowed sites are only logged when the web filter profile logs all URLs (`set log-all-url enable`) and the firewall policy logs **All Sessions**.

1. Go to **Log & Report > Security Events** and choose **Web Filter**.
2. Set the log location to **Disk** and filter the time to the last 7 days.
3. Select the download icon and **Download as a single file**.
4. Scan it:
   ```sh
   npx shadowmap scan webfilter.log
   ```

A download holds up to 400,000 entries. Some FortiOS 7.2 to 7.6.3 builds export only the last 24 hours; check the first date in the file. With FortiAnalyzer, go to **Log View**, select **More > Download**, choose **Text** or **CSV** and **All Pages**.

### Check Point

Application Control and URL Filtering logs name each site, also without HTTPS Inspection when **Categorize HTTPS websites** is on. Rules log only when their **Track** is set to **Log**.

1. Open SmartView at `https://<management-server>/smartview/`.
2. Set the time frame to the last 7 days and search for `blade:"URL Filtering" OR blade:"Application Control"`.
3. Select **Options > Export > Export to CSV**, choose **All columns** and download the file.
4. Scan it:
   ```sh
   npx shadowmap scan checkpoint.csv
   ```

SmartView exports up to 1,000,000 logs; Smart-1 Cloud exports up to 10,000.

### Sophos Firewall

Web filter logs need a Web Protection license. Each firewall rule must have **Log firewall traffic** on, and **System services > Log settings** must keep the web filter logs locally.

1. Select **Log viewer** in the upper-right corner and choose **Web filter**.
2. Set the time filter to the last 7 days.
3. Select **Export logs in CSV format**.
4. Scan it:
   ```sh
   npx shadowmap scan sophos.csv
   ```

In Sophos Central, go to **Firewall Management > Report Generator**, choose the template **Log viewer and search** and 7 days, select **Generate** and download the CSV. This needs a Central Firewall Reporting Advanced license.

### Windows Server DNS

1. In DNS Manager, right-click the server and open **Properties > Debug Logging**.
2. Select **Log packets for debugging**, then **Incoming**, **UDP**, **TCP**, **Queries/Transfers** and **Request**.
3. Keep the log under `C:\Windows\System32\dns\`; recent Windows updates ignore other paths. When the file reaches its maximum size, the oldest entries are overwritten. To keep a full week, run `Set-DnsServerDiagnostics -EnableLogFileRollover $true`.
4. After a week, turn debug logging off again, because it costs CPU and disk.
5. Copy `dns.log` and scan it:
   ```sh
   npx shadowmap scan dns.log
   ```

### Squid

Scan the current and rotated access logs together:

```sh
sudo zcat -f /var/log/squid/access.log* | npx shadowmap scan
```

Debian and Ubuntu keep about three days by default. For a full week, set `rotate 8` in `/etc/logrotate.d/squid` and scan after a week. An intercepting proxy logs IP addresses instead of host names unless its `logformat` includes `%ssl::>sni`.

### Any other log

Firewall, proxy and DNS exports or syslog files from other products work directly:

```sh
npx shadowmap scan firewall.log
```

shadowmap finds hostnames in CSV, Excel, JSON lines, key=value syslog and any other text. To count devices, the log needs a user, device or source IP field.

## Usage

```sh
shadowmap scan dns.log proxy-export.csv   # several files, formats may differ
cat firewall.log | shadowmap scan         # stdin
shadowmap scan --json export.csv          # machine-readable report
shadowmap defender-query --days 7         # query for Microsoft Defender
shadowmap sentinel-query --days 7         # query for Microsoft Sentinel
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
