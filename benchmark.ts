import axios from "axios";

const BASE_URL = "http://localhost:3000";

// Simple parsing d'arguments CLI (pas de dépendances externes)
function getArg(nameShort: string, nameLong: string, defaultValue: string) {
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === nameShort || argv[i] === nameLong) {
            return argv[i + 1] || "";
        }
        const pair = argv[i].split("=");
        if (pair[0] === nameShort || pair[0] === nameLong) {
            return pair[1] || "";
        }
    }
    return defaultValue;
}

const DEFAULT_ENDPOINTS = [
    "/compute",
    "/counter",
    "/slow",
    "/factorial/10",
    "/fibonacci/10",
    "/deposit",
    "/withdraw",
    "/account"
];

const concurrency = Number(getArg("-c", "--concurrency", "10"));
const timeout = Number(getArg("-t", "--timeout", "5000")); // ms
const repeat = Number(getArg("-r", "--repeat", "1"));
const totalRequests = Number(getArg("-n", "--total", "100")); // nouveau : nombre total de requêtes par run
const endpointsArg = getArg("-e", "--endpoints", "");
const endpoints = endpointsArg ? endpointsArg.split(",").map(s => s.trim()) : DEFAULT_ENDPOINTS;

// Utilitaires statistiques
function avg(arr: number[]) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function percentile(arr: number[], p: number) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function pickRandom<T>(arr: T[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Exécute une requête et mesure latence
async function runSingleRequest(method: "get" | "post", endpoint: string, timeoutMs: number) {
    const url = BASE_URL + endpoint;
    const start = Date.now();
    try {
        const config: any = { timeout: timeoutMs };
        let resp;
        if (method === "post") {
            resp = await axios.post(url, { amount: 1 }, config);
        } else {
            resp = await axios.get(url, { timeout: timeoutMs });
        }
        const latency = Date.now() - start;
        return { success: true, status: resp.status, latency, endpoint };
    } catch (err: any) {
        const latency = Date.now() - start;
        return {
            success: false,
            error: err?.code || err?.message || "unknown",
            status: err?.response?.status,
            latency,
            endpoint
        };
    }
}

// Envoie des requêtes en batches (taille = concurrency), chaque requête choisit un endpoint aléatoire
async function runRandomRequests(total: number, concurrencyLimit: number, timeoutMs: number) {
    const results: any[] = [];
    let sent = 0;
    const startAll = Date.now();

    while (sent < total) {
        const batchSize = Math.min(concurrencyLimit, total - sent);
        const batchPromises: Promise<any>[] = [];
        for (let i = 0; i < batchSize; i++) {
            const ep = pickRandom(endpoints);
            const method: "get" | "post" = (ep === "/deposit" || ep === "/withdraw") ? "post" : "get";
            batchPromises.push(runSingleRequest(method, ep, timeoutMs));
        }
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        sent += batchSize;
    }

    const duration = Date.now() - startAll;
    return { results, durationMs: duration };
}

// Agrège les résultats par endpoint et calcule métriques
function aggregateByEndpoint(results: any[], durationMs: number) {
    const groups: { [ep: string]: any[] } = {};
    for (const r of results) {
        groups[r.endpoint] = groups[r.endpoint] || [];
        groups[r.endpoint].push(r);
    }

    const metricsByEndpoint: any[] = [];
    for (const ep of Object.keys(groups)) {
        const group = groups[ep];
        const latencies = group.map(g => g.latency);
        const successes = group.filter(g => g.success).length;
        const failures = group.length - successes;
        metricsByEndpoint.push({
            endpoint: ep,
            totalRequests: group.length,
            successes,
            failures,
            durationMs,
            throughputReqPerSec: +( (successes / (durationMs / 1000)) || 0 ).toFixed(2),
            latency: {
                min: latencies.length ? Math.min(...latencies) : 0,
                max: latencies.length ? Math.max(...latencies) : 0,
                avg: +avg(latencies).toFixed(2),
                p50: percentile(latencies, 50),
                p90: percentile(latencies, 90),
                p99: percentile(latencies, 99)
            }
        });
    }

    // Ensure endpoints with zero hits are present
    for (const ep of endpoints) {
        if (!metricsByEndpoint.find(m => m.endpoint === ep)) {
            metricsByEndpoint.push({
                endpoint: ep,
                totalRequests: 0,
                successes: 0,
                failures: 0,
                durationMs,
                throughputReqPerSec: 0,
                latency: { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p99: 0 }
            });
        }
    }

    // Tri pour affichage stable
    metricsByEndpoint.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
    return metricsByEndpoint;
}

// Affichage formatté simple
function printReportHeader() {
    console.log("\n=== Benchmark report (random endpoints) ===");
    console.log(`Concurrency: ${concurrency}, Timeout: ${timeout}ms, Repeat: ${repeat}, Total per run: ${totalRequests}`);
    console.log(`Endpoints pool: ${endpoints.join(", ")}`);
    console.log("==========================================\n");
}

function printMetricsRow(m: any) {
    const pad = (s: any, n = 12) => String(s).padEnd(n, " ");
    console.log(
        pad(m.endpoint, 20) +
        pad(m.totalRequests, 8) +
        pad(m.successes, 8) +
        pad(m.failures, 8) +
        pad(`${m.durationMs}ms`, 12) +
        pad(`${m.throughputReqPerSec}/s`, 12) +
        pad(`avg:${m.latency.avg}ms`, 12) +
        pad(`p90:${m.latency.p90}ms`, 12) +
        pad(`p99:${m.latency.p99}ms`, 12)
    );
}

// Runner principal (random requests)
async function runBenchmarks() {
    printReportHeader();
    const allRunsSummary: any[] = [];

    for (let r = 0; r < repeat; r++) {
        console.log(`--- Run ${r + 1}/${repeat} (total requests: ${totalRequests}) ---`);
        const { results, durationMs } = await runRandomRequests(totalRequests, concurrency, timeout);
        const metricsByEndpoint = aggregateByEndpoint(results, durationMs);

        for (const m of metricsByEndpoint) {
            printMetricsRow(m);
        }

        allRunsSummary.push({ run: r + 1, durationMs, metricsByEndpoint });
        console.log("");
    }

    // Sommaire final
    console.log("\n=== Sommaire final ===");
    console.log("endpoint             total   succ    fail    time(ms)    thr/s       avgLat(ms)  p90(ms)     p99(ms)");
    // fusionner toutes les runs pour un sommaire global
    const merged: { [ep: string]: any[] } = {};
    for (const run of allRunsSummary) {
        for (const m of run.metricsByEndpoint) {
            merged[m.endpoint] = merged[m.endpoint] || [];
            merged[m.endpoint].push(m);
        }
    }
    const globalMetrics = Object.keys(merged).map(ep => {
        const list = merged[ep];
        const totalRequestsAll = list.reduce((s, x) => s + x.totalRequests, 0);
        const successesAll = list.reduce((s, x) => s + x.successes, 0);
        const failuresAll = list.reduce((s, x) => s + x.failures, 0);
        // concat latencies
        const latenciesAll: number[] = [];
        for (const l of list) {
            // we don't have the raw latencies list here, approximate using avg * count
            for (let i = 0; i < l.totalRequests; i++) {
                latenciesAll.push(l.latency.avg || 0);
            }
        }
        const durationSum = allRunsSummary.reduce((s, x) => s + x.durationMs, 0) || 1;
        return {
            endpoint: ep,
            totalRequests: totalRequestsAll,
            successes: successesAll,
            failures: failuresAll,
            durationMs: durationSum,
            throughputReqPerSec: +( (successesAll / (durationSum / 1000)) || 0 ).toFixed(2),
            latency: {
                min: latenciesAll.length ? Math.min(...latenciesAll) : 0,
                max: latenciesAll.length ? Math.max(...latenciesAll) : 0,
                avg: +(avg(latenciesAll) || 0).toFixed(2),
                p50: percentile(latenciesAll, 50),
                p90: percentile(latenciesAll, 90),
                p99: percentile(latenciesAll, 99)
            }
        };
    });

    for (const m of globalMetrics) {
        printMetricsRow(m);
    }
}

// Exécution
runBenchmarks()
  .then(() => {
      process.exit(0);
  })
  .catch(err => {
    console.error("Erreur lors du benchmark :", err);
    process.exit(1);
});
