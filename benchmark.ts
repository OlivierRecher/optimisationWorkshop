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
        return { success: true, status: resp.status, latency };
    } catch (err: any) {
        const latency = Date.now() - start;
        return {
            success: false,
            error: err?.code || err?.message || "unknown",
            status: err?.response?.status,
            latency
        };
    }
}

// Benchmarker un endpoint avec N requêtes concurrentes
async function benchmarkEndpoint(endpoint: string, concurrent: number, timeoutMs: number) {
    const method: "get" | "post" = (endpoint === "/deposit" || endpoint === "/withdraw") ? "post" : "get";
    const startAll = Date.now();
    const promises: Promise<any>[] = [];

    for (let i = 0; i < concurrent; i++) {
        promises.push(runSingleRequest(method, endpoint, timeoutMs));
    }

    const results = await Promise.all(promises);
    const duration = Date.now() - startAll;

    const latencies = results.map(r => r.latency);
    const successes = results.filter(r => r.success).length;
    const failures = results.length - successes;

    const successLatencies = results.filter(r => r.success).map(r => r.latency);

    const metrics = {
        endpoint,
        concurrent,
        totalRequests: results.length,
        successes,
        failures,
        durationMs: duration,
        throughputReqPerSec: +( (successes / (duration / 1000)) || 0 ).toFixed(2),
        latency: {
            min: Math.min(...latencies),
            max: Math.max(...latencies),
            avg: +avg(latencies).toFixed(2),
            p50: percentile(latencies, 50),
            p90: percentile(latencies, 90),
            p99: percentile(latencies, 99)
        }
    };

    return { metrics, raw: results };
}

// Affichage formatté simple
function printReportHeader() {
    console.log("\n=== Benchmark report ===");
    console.log(`Concurrency: ${concurrency}, Timeout: ${timeout}ms, Repeat: ${repeat}`);
    console.log(`Endpoints: ${endpoints.join(", ")}`);
    console.log("========================\n");
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

// Runner principal
async function runBenchmarks() {
    printReportHeader();
    const allResults: any[] = [];

    for (let r = 0; r < repeat; r++) {
        console.log(`--- Run ${r + 1}/${repeat} ---`);
        for (const ep of endpoints) {
            process.stdout.write(`Benchmarking ${ep} ... `);
            const { metrics } = await benchmarkEndpoint(ep, concurrency, timeout);
            process.stdout.write("done\n");
            printMetricsRow(metrics);
            allResults.push(metrics);
        }
    }

    // Sommaire global
    console.log("\n=== Sommaire final ===");
    console.log("endpoint             total   succ    fail    time(ms)    thr/s       avgLat(ms)  p90(ms)     p99(ms)");
    for (const m of allResults) {
        printMetricsRow(m);
    }
}

// Exécution
runBenchmarks()
  .then((res) => {
      console.log("\nBenchmark terminé");
      process.exit();
  })
  .catch(err => {
    console.error("Erreur lors du benchmark :", err);
    process.exit(1);
});
