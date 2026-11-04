/**
 * Fase 6: métricas do processo (desempenho do servidor). Amostras em reservatório por nome
 * (tempo do core, gravação no banco, projeção/envio, comando completo) e contadores. Expostas
 * em `GET /debug/metrics` (modo dev) e lidas pelo teste de carga (`npm run perf:server`).
 */
const MAX_SAMPLES = 20_000;

class Series {
  samples: number[] = [];
  count = 0;
  sum = 0;
  max = 0;
  add(v: number) {
    this.count++;
    this.sum += v;
    if (v > this.max) this.max = v;
    if (this.samples.length < MAX_SAMPLES) this.samples.push(v);
    else this.samples[Math.floor(Math.random() * this.count) % MAX_SAMPLES] = v;
  }
  summary() {
    const s = [...this.samples].sort((a, b) => a - b);
    const p = (q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0);
    const r = (v: number) => Math.round(v * 100) / 100;
    return { count: this.count, avg: r(this.count ? this.sum / this.count : 0), p50: r(p(0.5)), p95: r(p(0.95)), p99: r(p(0.99)), max: r(this.max) };
  }
}

const series = new Map<string, Series>();
const counters = new Map<string, number>();

export const metrics = {
  /** Tempo em ms. */
  time(name: string, ms: number): void {
    let s = series.get(name);
    if (!s) series.set(name, (s = new Series()));
    s.add(ms);
  },
  inc(name: string, by = 1): void {
    counters.set(name, (counters.get(name) ?? 0) + by);
  },
  snapshot() {
    const m = process.memoryUsage();
    const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
    return {
      series: Object.fromEntries([...series.entries()].map(([k, v]) => [k, v.summary()])),
      counters: Object.fromEntries(counters),
      memory: { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), heapTotalMb: mb(m.heapTotal), externalMb: mb(m.external) },
      cpu: process.cpuUsage(),
      uptimeS: Math.round(process.uptime()),
    };
  },
  reset(): void {
    series.clear();
    counters.clear();
  },
};

export const now = (): number => performance.now();
