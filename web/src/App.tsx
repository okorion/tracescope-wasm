import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEngine } from "./engine";
import type {
  Handle,
  MemoryStats,
  Overview,
  SlotView,
  SpanView,
  TraceDetail,
  TraceSummary,
} from "./types";
import "./styles/app.css";

type Controller = ReturnType<typeof useEngine>;
type MainTab = "overview" | "explorer" | "developer";
type DevTab = "memory" | "lifecycle" | "arena";
const scenarioOptions = [
  {
    id: "normal",
    name: "Normal Traffic",
    note: "일정한 부하 · 약 100 spans/s",
    short: "지속 부하",
  },
  {
    id: "burst",
    name: "Traffic Burst",
    note: "15–25초 · 약 1,000 spans/s",
    short: "순간 트래픽 급증",
  },
  {
    id: "slow_database",
    name: "Slow Database",
    note: "10–30초 · DB 응답 지연",
    short: "데이터베이스 병목",
  },
  {
    id: "error_storm",
    name: "Error Storm",
    note: "10–25초 · 오류와 Timeout 증가",
    short: "오류 급증",
  },
  {
    id: "pinned",
    name: "Pinned Traces",
    note: "초기 Trace 3개 자동 보존",
    short: "의도된 데이터 보존",
  },
];
const colors = [
  "#b2a1ff",
  "#6ed7d0",
  "#77a9f7",
  "#e1b778",
  "#ed91b6",
  "#91b79e",
];
const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
const decimal = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const duration = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${decimal(value)} ms`;
const bytes = (value: number | null) =>
  value === null
    ? "측정 불가"
    : value >= 1048576
      ? `${(value / 1048576).toFixed(2)} MiB`
      : `${decimal(value / 1024)} KiB`;
const clock = (value: number) =>
  `${Math.floor(value / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((value / 1000) % 60)
    .toString()
    .padStart(2, "0")}.${Math.floor(value % 1000)
    .toString()
    .padStart(3, "0")}`;
const sameHandle = (a: Handle | null, b: Handle | null) =>
  a !== null &&
  b !== null &&
  a.index === b.index &&
  a.generation === b.generation;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M14 18h7m-3.5-3.5v7" />
      </>
    ),
    trace: (
      <>
        <path d="M5 4v16M5 7h13M5 12h9M5 17h15" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="14" cy="12" r="2" />
        <circle cx="20" cy="17" r="2" />
      </>
    ),
    code: (
      <>
        <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M4 9a8 8 0 1 1 1 8M4 3v6h6" />
      </>
    ),
    step: (
      <>
        <path d="m5 5 10 7-10 7ZM19 5v14" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    pin: (
      <>
        <path d="m9 3 6 0-1 5 4 4v2H6v-2l4-4-1-5ZM12 14v7" />
      </>
    ),
    memory: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </>
    ),
    activity: <path d="M2 12h4l3-8 6 16 3-8h4" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v1" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.activity}
    </svg>
  );
}

function Status({ status }: { status: string }) {
  const label =
    (
      {
        active: "진행 중",
        ok: "정상",
        error: "오류",
        timeout: "Timeout",
        occupied: "Occupied",
        free: "Free",
        retired: "Retired",
      } as Record<string, string>
    )[status] ?? status;
  return (
    <span className={`status status-${status}`}>
      <i />
      {label}
    </span>
  );
}

function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="trace" size={26} />
      </div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

function Chart({
  title,
  subtitle,
  series,
  labels,
  unit,
  height = 180,
}: {
  title: string;
  subtitle?: string;
  series: { name: string; values: number[]; color: string }[];
  labels: number[];
  unit: string;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const all = series.flatMap((item) => item.values);
  const max = Math.max(1, ...all) * 1.15;
  const width = 700,
    left = 48,
    right = 14,
    top = 15,
    bottom = 30;
  const h = height,
    plotH = h - top - bottom,
    plotW = width - left - right;
  const firstTime = labels[0] ?? 0,
    timeRange = Math.max(1, (labels[labels.length - 1] ?? 0) - firstTime);
  const points = (values: number[]) =>
    values
      .map(
        (value, index) =>
          `${left + (((labels[index] ?? firstTime) - firstTime) / timeRange) * plotW},${top + plotH - (value / max) * plotH}`,
      )
      .join(" ");
  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="unit-label">{unit}</span>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`${title} 시계열 차트, ${labels.length}개 측정 시점`}
      >
        <svg viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none">
          <defs>
            {series.map((line, index) => (
              <linearGradient
                key={line.name}
                id={`${id}-${index}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={line.color} stopOpacity=".19" />
                <stop offset="100%" stopColor={line.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio}>
              <line
                x1={left}
                y1={top + plotH * ratio}
                x2={width - right}
                y2={top + plotH * ratio}
                stroke="#292b37"
                strokeDasharray="3 5"
              />
              <text x={left - 9} y={top + plotH * ratio + 4} textAnchor="end">
                {decimal(max * (1 - ratio))}
              </text>
            </g>
          ))}
          {series.map(
            (line, index) =>
              line.values.length > 1 && (
                <g key={line.name}>
                  {series.length === 1 && (
                    <polygon
                      points={`${left},${top + plotH} ${points(line.values)} ${left + plotW},${top + plotH}`}
                      fill={`url(#${id}-${index})`}
                    />
                  )}
                  <polyline
                    points={points(line.values)}
                    fill="none"
                    stroke={line.color}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </g>
              ),
          )}
          {[0, 0.5, 1].map((ratio) => (
            <text
              key={ratio}
              x={left + plotW * ratio}
              y={h - 5}
              textAnchor={
                ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"
              }
            >
              {labels.length
                ? `${decimal((firstTime + timeRange * ratio) / 1000)}s`
                : "0s"}
            </text>
          ))}
        </svg>
        {labels.length < 2 && (
          <div className="chart-empty">
            가상 시간의 측정값을 기다리고 있습니다
          </div>
        )}
      </div>
      <div className="chart-legend">
        {series.map((line) => (
          <span key={line.name}>
            <i style={{ background: line.color }} />
            {line.name}
            <b>
              {line.values.length
                ? decimal(line.values[line.values.length - 1])
                : "—"}
            </b>
          </span>
        ))}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  hint: string;
  accent?: string;
}) {
  return (
    <div className={`metric ${accent ?? ""}`}>
      <span className="metric-label">{label}</span>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <span className="metric-hint">{hint}</span>
    </div>
  );
}

function RequestTable({
  traces,
  onSelect,
  selected,
  compact = false,
}: {
  traces: TraceSummary[];
  onSelect: (id: string) => void;
  selected?: string | null;
  compact?: boolean;
}) {
  if (!traces.length)
    return (
      <Empty title="표시할 Trace가 없습니다">
        시뮬레이션을 실행하거나 검색 조건을 바꿔 보세요.
      </Empty>
    );
  return (
    <div className="table-scroll">
      <table className={`request-table ${compact ? "compact" : ""}`}>
        <thead>
          <tr>
            <th>REQUEST / TRACE ID</th>
            <th>서비스</th>
            <th>상태</th>
            <th>소요 시간</th>
            {!compact && <th>SPANS</th>}
            <th>시작 시각</th>
            <th>
              <span className="sr-only">상세 보기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <tr
              key={trace.id}
              className={selected === trace.id ? "selected" : ""}
            >
              <td>
                <button
                  className="request-link"
                  onClick={() => onSelect(trace.id)}
                  data-testid="trace-row"
                >
                  <strong>
                    {trace.operation}
                    {trace.pinned && <Icon name="pin" size={12} />}
                  </strong>
                  <span className="mono">{trace.id}</span>
                </button>
              </td>
              <td>
                <span className="service-name">
                  <i />
                  {trace.service}
                </span>
              </td>
              <td>
                <Status status={trace.status} />
              </td>
              <td className="mono">{duration(trace.duration_ms)}</td>
              {!compact && <td className="mono muted">{trace.span_count}</td>}
              <td className="mono muted">{clock(trace.start_ms)}</td>
              <td>
                <button
                  className="icon-button row-open"
                  aria-label={`${trace.id} 상세 보기`}
                  onClick={() => onSelect(trace.id)}
                >
                  <Icon name="chevron" size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveOverview({
  overview,
  onSelect,
}: {
  overview: Overview;
  onSelect: (id: string) => void;
}) {
  const history = overview.history;
  return (
    <>
      <div className="metrics primary-metrics">
        <Metric
          label="Request throughput"
          value={decimal(overview.rps)}
          unit="req/s"
          hint="최근 10초 · 요청 유입"
          accent="accent-purple"
        />
        <Metric
          label="P95 latency"
          value={decimal(overview.p95_ms)}
          unit="ms"
          hint={`P50 ${duration(overview.p50_ms)}  ·  P99 ${duration(overview.p99_ms)}`}
          accent="accent-cyan"
        />
        <Metric
          label="Error rate"
          value={decimal(overview.error_rate)}
          unit="%"
          hint="최근 10초 · 완료된 요청"
          accent={overview.error_rate > 10 ? "accent-red" : ""}
        />
        <Metric
          label="Active requests"
          value={number(overview.active_requests)}
          hint={`${number(overview.completed_requests)}개 요청 완료 · 누적`}
        />
      </div>
      <div className="two-col charts-row">
        <Chart
          title="Request throughput"
          subtitle="가상 시간에 따른 요청 유입"
          series={[
            {
              name: "Requests",
              values: history.map((p) => p.rps),
              color: "#ad98ff",
            },
          ]}
          labels={history.map((p) => p.time_ms)}
          unit="req/s"
        />
        <Chart
          title="Latency distribution"
          subtitle="완료된 요청의 응답 시간 백분위"
          series={[
            {
              name: "P50",
              values: history.map((p) => p.p50_ms),
              color: "#69cbc8",
            },
            {
              name: "P95",
              values: history.map((p) => p.p95_ms),
              color: "#ae9afa",
            },
            {
              name: "P99",
              values: history.map((p) => p.p99_ms),
              color: "#dfa66e",
            },
          ]}
          labels={history.map((p) => p.time_ms)}
          unit="ms"
        />
      </div>
      <div className="overview-bottom">
        <section className="panel service-panel">
          <div className="panel-head">
            <div>
              <h3>Services</h3>
              <p>서비스별 Span 처리 상태</p>
            </div>
            <span className="count-badge">{overview.services.length}</span>
          </div>
          <div className="service-list">
            {overview.services.map((service, index) => (
              <div className="service-row" key={service.name}>
                <span
                  className="service-glyph"
                  style={{
                    color: colors[index % colors.length],
                    background: `${colors[index % colors.length]}12`,
                  }}
                >
                  <Icon name={index % 2 ? "memory" : "code"} size={17} />
                </span>
                <div className="service-info">
                  <strong>{service.name}</strong>
                  <span>{number(service.completed_spans)} spans 완료</span>
                </div>
                <div className="service-stats">
                  <span>
                    {number(service.active_spans)} <small>진행 중</small>
                  </span>
                  <span
                    className={service.error_count ? "error-text" : "muted"}
                  >
                    {number(service.error_count)} 오류
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="panel-footnote">
            진행 중은 현재 값, 완료·오류는 누적 값입니다.
          </div>
        </section>
        <section className="panel recent-panel">
          <div className="panel-head">
            <div>
              <h3>Recent traces</h3>
              <p>요청을 선택하면 실행 흐름을 확인할 수 있습니다</p>
            </div>
            <span className="live-mini">
              <i />
              LIVE
            </span>
          </div>
          <RequestTable
            traces={overview.recent.slice(0, 6)}
            onSelect={onSelect}
            compact
          />
        </section>
      </div>
    </>
  );
}

function SpanDetails({
  span,
  traceStart,
  onInspect,
}: {
  span: SpanView;
  traceStart: number;
  onInspect: (handle: Handle) => void;
}) {
  return (
    <div className="span-details" data-testid="span-detail">
      <div className="span-details-header">
        <div>
          <span className="eyebrow">SELECTED SPAN</span>
          <h4>{span.operation}</h4>
          <span className="mono muted">{span.id}</span>
        </div>
        <button
          className="button subtle"
          onClick={() => onInspect(span.handle)}
          data-testid="inspect-span"
        >
          <Icon name="memory" size={15} />
          Arena에서 확인
          <Icon name="arrow" size={14} />
        </button>
      </div>
      <dl className="detail-facts">
        <div>
          <dt>서비스</dt>
          <dd>{span.service}</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>
            <Status status={span.status} />
          </dd>
        </div>
        <div>
          <dt>시작 / 종료</dt>
          <dd className="mono">
            +{duration(span.start_ms - traceStart)} /{" "}
            {span.end_ms === null
              ? "진행 중"
              : `+${duration(span.end_ms - traceStart)}`}
          </dd>
        </div>
        <div>
          <dt>Handle</dt>
          <dd className="mono">
            {span.handle.index}:{span.handle.generation}
          </dd>
        </div>
        <div>
          <dt>Parent handle</dt>
          <dd className="mono">
            {span.parent
              ? `${span.parent.index}:${span.parent.generation}`
              : "Root span"}
          </dd>
        </div>
        <div>
          <dt>실행 시간</dt>
          <dd className="mono">{duration(span.duration_ms)}</dd>
        </div>
      </dl>
      <div className="attributes">
        <span className="eyebrow">ATTRIBUTES</span>
        {Object.entries(span.attributes).length ? (
          <div className="attribute-list">
            {Object.entries(span.attributes).map(([key, value]) => (
              <div key={key}>
                <code>{key}</code>
                <span>{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">추가 속성이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function Waterfall({
  trace,
  selectedSpan,
  onSpan,
}: {
  trace: TraceDetail;
  selectedSpan: Handle | null;
  onSpan: (handle: Handle) => void;
}) {
  const max = Math.max(
    1,
    trace.duration_ms,
    ...trace.spans.map(
      (span) => span.start_ms - trace.start_ms + span.duration_ms,
    ),
  );
  const spanMap = new Map(
    trace.spans.map((span) => [
      `${span.handle.index}:${span.handle.generation}`,
      span,
    ]),
  );
  const depth = (span: SpanView) => {
    let cursor = span,
      level = 0;
    const seen = new Set<string>();
    while (cursor.parent && level < 16) {
      const key = `${cursor.parent.index}:${cursor.parent.generation}`;
      if (seen.has(key)) break;
      seen.add(key);
      const parent = spanMap.get(key);
      if (!parent) break;
      level++;
      cursor = parent;
    }
    return level;
  };
  const services = [...new Set(trace.spans.map((span) => span.service))];
  return (
    <div className="waterfall" data-testid="waterfall">
      <div className="waterfall-ruler">
        <span>서비스 / OPERATION</span>
        <div>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <span key={ratio}>{duration(max * ratio)}</span>
          ))}
        </div>
        <span>소요 시간</span>
      </div>
      {trace.spans.map((span) => (
        <button
          key={span.id}
          className={`waterfall-row ${sameHandle(selectedSpan, span.handle) ? "selected" : ""}`}
          onClick={() => onSpan(span.handle)}
          data-testid="span-row"
          aria-label={`${span.service} ${span.operation} Span 선택`}
        >
          <span
            className="waterfall-label"
            style={{ paddingLeft: 16 + depth(span) * 14 }}
          >
            <i
              style={{
                background:
                  colors[services.indexOf(span.service) % colors.length],
              }}
            />
            <span>
              <strong>{span.service}</strong>
              <small>{span.operation}</small>
            </span>
          </span>
          <span className="waterfall-track">
            <span
              className={`waterfall-bar ${span.status === "active" ? "in-progress" : ""}`}
              style={{
                left: `${((span.start_ms - trace.start_ms) / max) * 100}%`,
                width: `${(span.duration_ms / max) * 100}%`,
                minWidth: "2px",
                background:
                  span.status === "error" || span.status === "timeout"
                    ? "#d7858e"
                    : colors[services.indexOf(span.service) % colors.length],
              }}
              title={`${clock(span.start_ms)} → ${span.end_ms === null ? "진행 중" : clock(span.end_ms)}`}
            />
          </span>
          <span className="waterfall-duration mono">
            {duration(span.duration_ms)}
            {(span.status === "error" || span.status === "timeout") && (
              <i className="error-dot" />
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function Explorer({
  engine,
  selectedTrace,
  onSelect,
  selectedSpan,
  onSpan,
  onInspect,
}: {
  engine: Controller;
  selectedTrace: string | null;
  onSelect: (id: string) => void;
  selectedSpan: Handle | null;
  onSpan: (handle: Handle) => void;
  onInspect: (handle: Handle) => void;
}) {
  const [search, setSearch] = useState(""),
    [service, setService] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(0),
    [pinMessage, setPinMessage] = useState("");
  const { revision, overview } = engine.state;
  const query = useMemo(
    () => engine.query(search, service, status, sort, page),
    [engine.query, search, service, status, sort, page, revision],
  );
  const trace = useMemo(
    () => (selectedTrace ? engine.detail(selectedTrace) : null),
    [engine.detail, selectedTrace, revision],
  );
  const span =
    trace?.spans.find((item) => sameHandle(item.handle, selectedSpan)) ?? null;
  const pages = Math.max(1, Math.ceil(query.total / query.page_size));
  useEffect(() => {
    setPage(0);
  }, [search, service, status, sort]);
  useEffect(() => {
    setPage((current) => Math.min(current, pages - 1));
  }, [pages]);
  const pin = () => {
    if (trace)
      setPinMessage(
        engine.pin(trace.id, !trace.pinned)
          ? ""
          : "Pin을 변경할 수 없습니다. 최대 128개 Trace를 보존할 수 있습니다.",
      );
  };
  return (
    <div className="explorer-layout">
      <section className="panel">
        <div className="explorer-filters">
          <label className="search-field">
            <Icon name="search" size={17} />
            <input
              placeholder="Trace ID 또는 요청 검색"
              aria-label="Trace 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              data-testid="trace-search"
            />
          </label>
          <select
            aria-label="서비스 필터"
            value={service}
            onChange={(event) => setService(event.target.value)}
          >
            <option value="">모든 서비스</option>
            {overview?.services.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label="상태 필터"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">모든 상태</option>
            <option value="active">진행 중</option>
            <option value="completed">완료</option>
            <option value="error">오류</option>
            <option value="pinned">Pinned</option>
          </select>
          <select
            aria-label="정렬"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">최신순</option>
            <option value="duration">소요 시간순</option>
          </select>
        </div>
        <RequestTable
          traces={query.items}
          selected={selectedTrace}
          onSelect={onSelect}
        />
        <div className="pagination">
          <span>
            검색 결과 <b>{number(query.total)}</b>개{" "}
            <span className="muted">· 현재 보존 중인 Trace</span>
          </span>
          <div>
            <button
              className="button subtle small"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              이전
            </button>
            <span className="mono">
              {page + 1} / {pages}
            </span>
            <button
              className="button subtle small"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </button>
          </div>
        </div>
      </section>
      <section className="panel trace-detail-panel">
        {trace ? (
          <>
            <div className="panel-head trace-title">
              <div>
                <span className="eyebrow">TRACE DETAIL</span>
                <h3>{trace.operation}</h3>
                <span className="mono muted">{trace.id}</span>
              </div>
              <div className="trace-title-actions">
                <Status status={trace.status} />
                <button
                  className={`button ${trace.pinned ? "pinned-button" : "subtle"}`}
                  onClick={pin}
                  data-testid="pin-trace"
                  aria-pressed={trace.pinned}
                >
                  <Icon name="pin" size={16} />
                  {trace.pinned ? "Unpin" : "Pin trace"}
                </button>
              </div>
            </div>
            {pinMessage && (
              <div className="notice" role="status">
                {pinMessage}
              </div>
            )}
            <div className="trace-summary-strip">
              <span>
                <small>소요 시간</small>
                <strong>{duration(trace.duration_ms)}</strong>
              </span>
              <span>
                <small>Spans</small>
                <strong>{trace.span_count}</strong>
              </span>
              <span>
                <small>시작</small>
                <strong className="mono">{clock(trace.start_ms)}</strong>
              </span>
              <span>
                <small>종료</small>
                <strong className="mono">
                  {trace.end_ms === null ? "진행 중" : clock(trace.end_ms)}
                </strong>
              </span>
              <span>
                <small>보존</small>
                <strong>
                  {trace.pinned
                    ? "Pinned · 직접 해제까지"
                    : `완료 후 ${overview?.retention_seconds ?? 60}초`}
                </strong>
              </span>
            </div>
            <div className="waterfall-heading">
              <h4>Request waterfall</h4>
              <span>Span을 선택하여 속성과 메모리 슬롯 확인</span>
            </div>
            <Waterfall
              trace={trace}
              selectedSpan={selectedSpan}
              onSpan={onSpan}
            />
            {span ? (
              <SpanDetails
                span={span}
                traceStart={trace.start_ms}
                onInspect={onInspect}
              />
            ) : (
              <div className="selection-hint">
                <Icon name="info" size={16} />
                Waterfall의 Span을 선택하면 상세 정보가 표시됩니다.
              </div>
            )}
          </>
        ) : (
          <Empty
            title={
              selectedTrace
                ? "이 Trace의 보존 기간이 끝났습니다"
                : "요청의 실행 흐름을 살펴보세요"
            }
          >
            {selectedTrace
              ? "목록에서 다른 Trace를 선택하세요. Pin한 Trace는 보존 기간이 지나도 유지됩니다."
              : "위 목록에서 요청을 선택하면 서비스 호출, 소요 시간과 오류를 확인할 수 있습니다."}
          </Empty>
        )}
      </section>
    </div>
  );
}

function MemoryView({
  memory,
  overview,
  engine,
}: {
  memory: MemoryStats;
  overview: Overview;
  engine: Controller;
}) {
  const { wasmBytes, memoryHistory } = engine.state;
  const history = overview.history;
  const detailed = [
    ["Active Span Count", memory.active_spans, "개 · 보존 중인 Span 포함"],
    ["Active Trace Count", memory.active_traces, "개 · 저장소의 전체 Trace"],
    ["Arena Capacity", memory.arena_capacity, "slots · 확보한 논리 슬롯"],
    ["Occupied Slots", memory.occupied_slots, "slots · 값을 보유한 슬롯"],
    ["Free Slots", memory.free_slots, "slots · 다음 할당에서 재사용"],
    ["Retired Slots", memory.retired_slots, "slots · Generation 상한 도달"],
    [
      "Cumulative Allocations",
      memory.cumulative_allocations,
      "회 · 누적 객체 생성",
    ],
    [
      "Cumulative Releases",
      memory.cumulative_releases,
      "회 · 누적 명시적 제거",
    ],
    ["Reused Slot Count", memory.reused_slots, "회 · Free List에서 할당"],
    [
      "Pending Scheduled Events",
      memory.pending_events,
      "개 · 미래와 처리 대기 이벤트",
    ],
    ["Retained Trace Count", memory.retained_traces, "개 · 완료 후 보존 중"],
    ["Pinned Trace Count", memory.pinned_traces, "개 · 수동/시나리오 보존"],
    ["Trace Index Entries", memory.trace_index_entries, "개 · Trace 인덱스"],
    [
      "Service Index Entries",
      memory.service_index_entries,
      "개 · 서비스별 Trace 인덱스",
    ],
    [
      "Lifecycle Buffer",
      memory.lifecycle_len,
      `개 · 최대 ${number(memory.lifecycle_capacity)}개`,
    ],
    ["Processed Events", memory.processed_events, "개 · 실제 처리한 이벤트"],
  ] as const;
  return (
    <>
      <div className="metrics memory-headline">
        <Metric
          label="WASM linear memory"
          value={bytes(wasmBytes)}
          hint="실제 WebAssembly.Memory buffer"
          accent="accent-purple"
        />
        <Metric
          label="Live spans"
          value={number(memory.active_spans)}
          unit="개"
          hint="진행 중 + Retention + Pinned"
        />
        <Metric
          label="Reusable slots"
          value={number(memory.free_slots)}
          unit="slots"
          hint={`전체 ${number(memory.arena_capacity)} slots`}
          accent="accent-cyan"
        />
        <Metric
          label="Slot reuse ratio"
          value={decimal(memory.reuse_ratio)}
          unit="%"
          hint={`${number(memory.reused_slots)} / ${number(memory.cumulative_allocations)} 할당`}
        />
      </div>
      <div className="memory-explanation">
        <Icon name="info" size={17} />
        <p>
          슬롯을 회수하면 객체가 제거되고 Free List에 반환됩니다. WASM Linear
          Memory는 확보한 메모리를 재사용하므로 객체가 줄어도 즉시 축소되지
          않습니다. Arena 슬롯 수와 전체 힙 사용량은 서로 다릅니다.
        </p>
      </div>
      <div className="two-col charts-row">
        <Chart
          title="Object & slot lifecycle"
          subtitle="가상 시간 · 최근 120개 측정값"
          unit="count"
          labels={history.map((p) => p.time_ms)}
          series={[
            {
              name: "Live spans",
              values: history.map((p) => p.live_spans),
              color: "#b2a1ff",
            },
            {
              name: "Capacity",
              values: history.map((p) => p.arena_capacity),
              color: "#7ca9ed",
            },
            {
              name: "Free slots",
              values: history.map((p) => p.free_slots),
              color: "#6ed7d0",
            },
          ]}
        />
        <Chart
          title="WASM linear memory"
          subtitle="실제 Memory buffer 크기 · 화면 갱신 시 측정"
          unit="MiB"
          labels={memoryHistory.map((p) => p.time_ms)}
          series={[
            {
              name: "Linear memory",
              values: memoryHistory.map((p) => p.bytes / 1048576),
              color: "#b2a1ff",
            },
          ]}
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Engine counters</h3>
            <p>현재 Rust 엔진의 제한된 진단 Snapshot</p>
          </div>
          <span className="mono tag">SINGLE ENGINE</span>
        </div>
        <div className="counter-grid">
          {detailed.map(([label, value, hint]) => (
            <div className="counter" key={label}>
              <span>{label}</span>
              <strong className="mono">{number(value)}</strong>
              <small>{hint}</small>
            </div>
          ))}
        </div>
        <div className="queue-status">
          <span>
            <i className={memory.due_events > 0 ? "warn-dot" : "green-dot"} />
            {memory.due_events > 0
              ? "이벤트 처리 대기 중"
              : "예약 이벤트 정상 처리 중"}
          </span>
          <span>
            Due <b className="mono">{number(memory.due_events)}</b>
          </span>
          <span>
            시간 지연 <b className="mono">{duration(memory.backlog_ms)}</b>
          </span>
          <span>
            진단 시계열{" "}
            <b className="mono">{number(memory.history_len)} / 120</b>
          </span>
        </div>
      </section>
      <div className="developer-settings">
        <div>
          <h3>Retention & diagnostics</h3>
          <p>
            완료된 Trace만 만료됩니다. Pinned Trace와 진행 중인 요청은
            유지됩니다.
          </p>
        </div>
        <label className="setting-control">
          보존 기간
          <select
            aria-label="보존 기간"
            value={overview.retention_seconds}
            onChange={(event) => engine.retention(Number(event.target.value))}
          >
            {[5, 15, 30, 60, 120].map((value) => (
              <option key={value} value={value}>
                {value}초
              </option>
            ))}
          </select>
        </label>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={memory.diagnostics_enabled}
            onChange={(event) => engine.diagnostics(event.target.checked)}
            data-testid="diagnostics-toggle"
          />
          <span className="toggle-track" />
          상세 Lifecycle 기록
        </label>
      </div>
      {wasmBytes === null && (
        <div className="notice">
          Unsupported Diagnostics · 이 환경에서는 WASM Memory buffer 크기를 읽을
          수 없습니다.
        </div>
      )}
    </>
  );
}

function LifecycleView({ engine }: { engine: Controller }) {
  const { revision, memory } = engine.state;
  const [kind, setKind] = useState(""),
    [probeResult, setProbeResult] = useState<ReturnType<
      Controller["probe"]
    > | null>(null);
  const result = useMemo(
    () => engine.lifecycle(0, 150),
    [engine.lifecycle, revision],
  );
  const events = [...result.events]
    .reverse()
    .filter((event) => !kind || event.kind === kind);
  const kinds = [
    "Allocated",
    "Started",
    "Completed",
    "Retained",
    "Pinned",
    "Unpinned",
    "Expired",
    "Released",
    "Slot Reused",
    "Invalid Handle Access",
  ];
  return (
    <>
      <div className="lifecycle-intro">
        <div>
          <span className="eyebrow">EXPLICIT OBJECT LIFETIME</span>
          <div className="lifecycle-chain">
            {[
              "Allocate",
              "Active",
              "Retained",
              "Expire",
              "Release",
              "Reuse",
            ].map((phase, index) => (
              <span key={phase}>
                <b className={index === 5 ? "cyan-text" : ""}>{phase}</b>
                {index < 5 && <Icon name="arrow" size={15} />}
              </span>
            ))}
          </div>
          <p>Rust의 실제 이벤트 기록으로 객체의 생성과 회수를 추적합니다.</p>
        </div>
        <button
          className="button subtle"
          onClick={() => setProbeResult(engine.probe())}
          data-testid="stale-probe"
        >
          <Icon name="code" size={16} />
          Stale Handle 검증
        </button>
      </div>
      {probeResult && (
        <div className="probe-result" role="status">
          <span className="status status-ok">
            <i />
            검증 결과
          </span>
          <p>{probeResult.message}</p>
          <code>
            {probeResult.handle.index}:{probeResult.handle.generation} →{" "}
            {probeResult.valid ? "Valid" : "Rejected"}
            {probeResult.reused_handle &&
              ` · 재사용 ${probeResult.reused_handle.index}:${probeResult.reused_handle.generation}`}
          </code>
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Lifecycle event stream</h3>
            <p>
              최근 {result.events.length}개 표시 · Ring Buffer 최대{" "}
              {number(memory?.lifecycle_capacity ?? 2048)}개
            </p>
          </div>
          <select
            aria-label="Lifecycle 이벤트 필터"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">모든 이벤트</option>
            {kinds.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        {!memory?.diagnostics_enabled && (
          <div className="notice">
            상세 기록이 꺼져 있습니다. Memory 탭에서 활성화할 수 있습니다.
          </div>
        )}
        {events.length ? (
          <div className="table-scroll lifecycle-table-wrap">
            <table className="lifecycle-table">
              <thead>
                <tr>
                  <th>가상 시각</th>
                  <th>이벤트</th>
                  <th>객체 / 상세</th>
                  <th>HANDLE</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.cursor}>
                    <td className="mono muted">{clock(event.time_ms)}</td>
                    <td>
                      <span
                        className={`event-label event-${event.kind.toLowerCase().replaceAll(" ", "-")}`}
                      >
                        <i />
                        {event.kind}
                      </span>
                    </td>
                    <td>
                      <span className="event-message">{event.message}</span>
                      <span className="event-object mono">
                        {event.trace_id ?? "diagnostic"}
                        {event.span_id ? ` / ${event.span_id}` : ""}
                      </span>
                    </td>
                    <td className="mono">
                      {event.handle
                        ? `${event.handle.index}:${event.handle.generation}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="기록된 이벤트가 없습니다">
            시뮬레이션을 실행하거나 상세 Lifecycle 기록을 활성화하세요.
          </Empty>
        )}
        <div className="panel-footnote">
          최신 이벤트부터 표시합니다. 상한을 넘긴 오래된 이벤트는 Ring
          Buffer에서 교체됩니다. 누적 교체 {number(result.dropped)}개.
        </div>
      </section>
    </>
  );
}

function ArenaCanvas({
  slots,
  selected,
  onSelect,
}: {
  slots: SlotView[];
  selected: Handle | null;
  onSelect: (handle: Handle) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const columns = 32,
    pitch = 22,
    pad = 16,
    width = columns * pitch + pad * 2,
    rows = Math.max(4, Math.ceil(slots.length / columns)),
    height = rows * pitch + pad * 2;
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = width * ratio;
    element.height = height * ratio;
    context.scale(ratio, ratio);
    context.fillStyle = "#11121a";
    context.fillRect(0, 0, width, height);
    slots.forEach((slot, index) => {
      const x = pad + (index % columns) * pitch,
        y = pad + Math.floor(index / columns) * pitch;
      context.fillStyle =
        slot.state === "occupied"
          ? slot.reused
            ? "#8e82bc"
            : "#7865b3"
          : slot.state === "free"
            ? "#2b726f"
            : "#7c6040";
      context.beginPath();
      context.roundRect(x, y, 16, 16, 3);
      context.fill();
      if (slot.index === selected?.index) {
        context.strokeStyle = "#e7ddff";
        context.lineWidth = 2;
        context.beginPath();
        context.roundRect(x - 2, y - 2, 20, 20, 4);
        context.stroke();
      }
    });
  }, [slots, selected, width, height]);
  return (
    <canvas
      ref={canvas}
      className="arena-canvas"
      style={{ aspectRatio: `${width}/${height}` }}
      aria-label={`${slots.length}개 Arena 슬롯. 아래 슬롯 번호 입력으로도 선택할 수 있습니다.`}
      data-testid="arena-canvas"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * width - pad,
          y = ((event.clientY - rect.top) / rect.height) * height - pad;
        if (
          x < 0 ||
          y < 0 ||
          x >= columns * pitch ||
          x % pitch > 16 ||
          y % pitch > 16
        )
          return;
        const slot =
          slots[Math.floor(y / pitch) * columns + Math.floor(x / pitch)];
        if (slot) onSelect({ index: slot.index, generation: slot.generation });
      }}
    />
  );
}

function ArenaView({
  engine,
  selected,
  onSelect,
}: {
  engine: Controller;
  selected: Handle | null;
  onSelect: (handle: Handle) => void;
}) {
  const { revision, memory } = engine.state;
  const [start, setStart] = useState(() =>
      selected ? Math.floor(selected.index / 512) * 512 : 0,
    ),
    [lookup, setLookup] = useState(""),
    [lookupMessage, setLookupMessage] = useState("");
  const [inspection, setInspection] = useState<ReturnType<
    Controller["inspect"]
  > | null>(null);
  const inspected = useRef<{
    handle: Handle;
    result: ReturnType<Controller["inspect"]>;
  } | null>(null);
  const snapshot = useMemo(
    () => engine.arena(start, 512),
    [engine.arena, start, revision],
  );
  useEffect(() => {
    if (selected) setStart(Math.floor(selected.index / 512) * 512);
  }, [selected?.index]);
  useEffect(() => {
    if (!selected) {
      setInspection(null);
      inspected.current = null;
      return;
    }
    const currentSlot = engine.arena(selected.index, 1).slots[0] ?? null;
    const currentValid =
      currentSlot?.state === "occupied" &&
      currentSlot.generation === selected.generation;
    const previous = inspected.current;
    const next =
      previous &&
      sameHandle(previous.handle, selected) &&
      previous.result.valid === currentValid
        ? { ...previous.result, slot: currentSlot }
        : engine.inspect(selected);
    inspected.current = { handle: selected, result: next };
    setInspection(next);
  }, [selected, revision, engine.inspect]);
  const slot = inspection?.slot;
  const lookupSlot = () => {
    const index = Number(lookup);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= snapshot.total ||
      lookup.trim() === ""
    ) {
      setLookupMessage(
        `0–${Math.max(0, snapshot.total - 1)} 범위의 슬롯 번호를 입력하세요.`,
      );
      return;
    }
    const found = engine.arena(index, 1).slots[0];
    if (found) {
      onSelect({ index: found.index, generation: found.generation });
      setLookupMessage("");
    }
  };
  return (
    <>
      <div className="arena-summary">
        <div>
          <span className="legend-swatch occupied" />
          <span>
            Occupied <b>{number(memory?.occupied_slots ?? 0)}</b>
          </span>
        </div>
        <div>
          <span className="legend-swatch free" />
          <span>
            Free <b>{number(memory?.free_slots ?? 0)}</b>
          </span>
        </div>
        <div>
          <span className="legend-swatch retired" />
          <span>
            Retired <b>{number(memory?.retired_slots ?? 0)}</b>
          </span>
        </div>
        <span className="arena-summary-note">
          최대 512개 슬롯씩 Canvas에 표시
        </span>
      </div>
      <div className="arena-layout">
        <section className="panel arena-grid-panel">
          <div className="panel-head">
            <div>
              <h3>Arena slot map</h3>
              <p>슬롯을 선택하여 현재 값과 Generation 확인</p>
            </div>
            <span className="mono tag">
              {snapshot.total ? start : 0}—
              {Math.max(0, Math.min(start + 512, snapshot.total) - 1)}
            </span>
          </div>
          {snapshot.slots.length ? (
            <ArenaCanvas
              slots={snapshot.slots}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <Empty title="아직 할당한 슬롯이 없습니다">
              시뮬레이션을 시작하면 실제 Arena 슬롯이 표시됩니다.
            </Empty>
          )}
          <div className="pagination">
            <span>
              총 <b>{number(snapshot.total)}</b> slots
            </span>
            <div>
              <button
                className="button subtle small"
                disabled={start === 0}
                onClick={() => setStart((value) => Math.max(0, value - 512))}
              >
                이전
              </button>
              <span className="mono">
                {Math.floor(start / 512) + 1} /{" "}
                {Math.max(1, Math.ceil(snapshot.total / 512))}
              </span>
              <button
                className="button subtle small"
                disabled={start + 512 >= snapshot.total}
                onClick={() => setStart((value) => value + 512)}
              >
                다음
              </button>
            </div>
          </div>
          <div className="slot-lookup">
            <label htmlFor="slot-index">슬롯 번호로 선택</label>
            <input
              id="slot-index"
              type="number"
              min="0"
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") lookupSlot();
              }}
              placeholder="Index"
            />
            <button className="button subtle small" onClick={lookupSlot}>
              조회
            </button>
          </div>
          {lookupMessage && <div className="notice">{lookupMessage}</div>}
        </section>
        <section className="panel slot-inspector" data-testid="slot-inspector">
          <div className="panel-head">
            <div>
              <h3>Slot inspector</h3>
              <p>선택한 Handle의 실제 조회 결과</p>
            </div>
            <Icon name="memory" size={20} />
          </div>
          {selected && inspection ? (
            <>
              <div className="slot-handle">
                <span className="eyebrow">HANDLE</span>
                <strong className="mono">
                  {selected.index}
                  <span>:</span>
                  {selected.generation}
                </strong>
                <span
                  className={`validity ${inspection.valid ? "valid" : "invalid"}`}
                >
                  {inspection.valid ? "유효한 Handle" : "무효화된 Handle"}
                </span>
              </div>
              <p className="inspection-reason">{inspection.reason}</p>
              {slot && (
                <dl className="slot-facts">
                  <div>
                    <dt>현재 슬롯 상태</dt>
                    <dd>
                      <Status status={slot.state} />
                    </dd>
                  </div>
                  <div>
                    <dt>현재 Generation</dt>
                    <dd className="mono">{slot.generation}</dd>
                  </div>
                  <div>
                    <dt>재사용 여부</dt>
                    <dd>{slot.reused ? "재사용됨" : "첫 할당"}</dd>
                  </div>
                  <div>
                    <dt>누적 할당</dt>
                    <dd className="mono">{number(slot.allocations)}회</dd>
                  </div>
                  {inspection.valid && (
                    <>
                      <div>
                        <dt>Span ID</dt>
                        <dd className="mono">{slot.span_id ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Trace ID</dt>
                        <dd className="mono">{slot.trace_id ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Parent</dt>
                        <dd className="mono">
                          {slot.parent
                            ? `${slot.parent.index}:${slot.parent.generation}`
                            : "Root / 없음"}
                        </dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>최근 할당</dt>
                    <dd className="mono">
                      {slot.last_allocated_ms === null
                        ? "—"
                        : clock(slot.last_allocated_ms)}
                    </dd>
                  </div>
                  <div>
                    <dt>최근 해제</dt>
                    <dd className="mono">
                      {slot.last_released_ms === null
                        ? "—"
                        : clock(slot.last_released_ms)}
                    </dd>
                  </div>
                </dl>
              )}
              {!inspection.valid && (
                <div className="slot-invalid-note">
                  선택했던 객체는 현재 Handle로 접근할 수 없습니다. 재사용된
                  슬롯의 객체는 다른 Generation을 갖습니다.
                </div>
              )}
            </>
          ) : (
            <Empty title="슬롯을 선택하세요">
              Trace Explorer에서 Span을 선택해 같은 Handle을 확인할 수도
              있습니다.
            </Empty>
          )}
        </section>
      </div>
      <div className="memory-explanation">
        <Icon name="info" size={17} />
        <p>
          해제된 슬롯은 Free List에 들어가고 다음 할당에 재사용됩니다.
          Generation이 달라지면 이전 Handle의 접근은 거부됩니다. Generation
          상한에 도달한 슬롯은 Retired 상태로 남습니다.
        </p>
      </div>
    </>
  );
}

function DeveloperTools({
  engine,
  tab,
  onTab,
  selected,
  onSelect,
}: {
  engine: Controller;
  tab: DevTab;
  onTab: (tab: DevTab) => void;
  selected: Handle | null;
  onSelect: (handle: Handle) => void;
}) {
  const { memory, overview } = engine.state;
  return (
    <>
      <div className="developer-topline">
        <div className="subtabs" role="tablist" aria-label="개발자 도구">
          {(["memory", "lifecycle", "arena"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => onTab(id)}
              data-testid={`dev-${id}`}
            >
              <Icon
                name={
                  id === "memory"
                    ? "memory"
                    : id === "lifecycle"
                      ? "activity"
                      : "overview"
                }
                size={16}
              />
              {id[0].toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
        <span className="engine-indicator">
          <i />
          제품과 동일한 Rust 엔진
        </span>
      </div>
      {memory &&
        overview &&
        (tab === "memory" ? (
          <MemoryView memory={memory} overview={overview} engine={engine} />
        ) : tab === "lifecycle" ? (
          <LifecycleView engine={engine} />
        ) : (
          <ArenaView engine={engine} selected={selected} onSelect={onSelect} />
        ))}
    </>
  );
}

export default function App() {
  const engine = useEngine();
  const { ready, error, overview, notice, memory } = engine.state;
  const [epoch, setEpoch] = useState(0);
  const [tab, setTab] = useState<MainTab>("overview"),
    [devTab, setDevTab] = useState<DevTab>("memory"),
    [selectedTrace, setSelectedTrace] = useState<string | null>(null),
    [selectedSpan, setSelectedSpan] = useState<Handle | null>(null);
  const selectedScenario =
    scenarioOptions.find((item) => item.id === overview?.scenario) ??
    scenarioOptions[0];
  const navigateTrace = (id: string) => {
    setSelectedTrace(id);
    setSelectedSpan(null);
    setTab("explorer");
  };
  const inspectSpan = (handle: Handle) => {
    setSelectedSpan(handle);
    setDevTab("arena");
    setTab("developer");
  };
  const clearSelection = () => {
    setSelectedTrace(null);
    setSelectedSpan(null);
  };
  const reset = () => {
    engine.reset();
    clearSelection();
    setEpoch((value) => value + 1);
  };
  const title =
    tab === "overview"
      ? "Live Overview"
      : tab === "explorer"
        ? "Trace Explorer"
        : "Developer Tools";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setTab("overview");
          }}
          aria-label="TraceScope Live Overview"
        >
          <span className="brand-mark">
            <svg viewBox="0 0 30 30" fill="none">
              <path
                d="M4 9h8v12h14M4 15h15V5M4 21h8"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="4" cy="9" r="2.5" fill="currentColor" />
              <circle cx="19" cy="5" r="2.5" fill="currentColor" />
              <circle cx="26" cy="21" r="2.5" fill="currentColor" />
            </svg>
          </span>
          <span>
            TraceScope
            <span className="brand-caption">OBSERVE THE LIFECYCLE</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-icon">T</span>
          <div>
            <strong>Local workspace</strong>
            <span>Browser · Rust / WASM</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="주요 화면">
          {(
            [
              { id: "overview", label: "Live Overview", icon: "overview" },
              { id: "explorer", label: "Trace Explorer", icon: "trace" },
              { id: "developer", label: "Developer Tools", icon: "code" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              data-testid={`nav-${item.id}`}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
              {tab === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-card">
            <div>
              <Icon name="memory" size={16} />
              <strong>Rust engine</strong>
              <i className={ready && !error ? "green-dot" : "warn-dot"} />
            </div>
            <p>
              명시적 수명 관리
              <br />
              실제 슬롯 할당과 재사용
            </p>
            <span className="mono">wasm-bindgen · browser local</span>
          </div>
          <div className="local-only">
            <span className="privacy-lock">⌁</span>합성 데이터 · 외부 수집 없음
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <Icon name="chevron" size={12} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="simulated-label">
              <i />
              Simulated Live
            </span>
            <span className="topbar-divider" />
            <span className="version-label">RUST + WEBASSEMBLY</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === "developer"
                  ? "UNDER THE HOOD"
                  : "REAL-TIME TRACE ANALYSIS"}
              </div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {tab === "overview"
                  ? "요청의 흐름부터 병목까지, 실행 중인 트래픽을 한눈에."
                  : tab === "explorer"
                    ? "하나의 요청을 따라 서비스 호출과 실행 시간을 확인하세요."
                    : "객체가 생성되고, 보존되고, 다시 사용되는 과정을 관찰하세요."}
              </p>
            </div>
            <div className="clock-card">
              <span>VIRTUAL CLOCK</span>
              <strong className="mono" data-testid="virtual-clock">
                {clock(overview?.now_ms ?? 0)}
              </strong>
              <small>
                <i className={overview?.running ? "green-dot" : "paused-dot"} />
                {overview?.running
                  ? "Running"
                  : ready
                    ? "Paused"
                    : "Initializing"}
              </small>
            </div>
          </div>
          {error ? (
            <div className="error-state" role="alert">
              <Icon name="info" size={28} />
              <h2>엔진을 시작할 수 없습니다</h2>
              <p>{error}</p>
              <button
                className="button primary"
                onClick={() => window.location.reload()}
              >
                다시 불러오기
              </button>
            </div>
          ) : !ready ? (
            <div className="loading-state">
              <span className="loading-ring" />
              <h2>Rust 엔진을 준비하고 있습니다</h2>
              <p>WebAssembly 모듈을 불러오는 중입니다.</p>
            </div>
          ) : (
            <>
              <section
                className="simulation-controls"
                aria-label="시뮬레이션 제어"
              >
                <div className="scenario-control">
                  <span className="scenario-icon">
                    <Icon name="activity" size={18} />
                  </span>
                  <div>
                    <label htmlFor="scenario-select">SCENARIO</label>
                    <select
                      id="scenario-select"
                      value={overview?.scenario ?? "normal"}
                      onChange={(event) => {
                        engine.scenario(event.target.value);
                        clearSelection();
                        setEpoch((value) => value + 1);
                      }}
                      data-testid="scenario-select"
                    >
                      {scenarioOptions.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <span className="scenario-description">
                  {selectedScenario.note}
                </span>
                <div className="playback-controls">
                  <button
                    className={`button ${overview?.running ? "subtle pause-button" : "primary"}`}
                    onClick={() =>
                      overview?.running ? engine.pause() : engine.play()
                    }
                    data-testid="play-pause"
                  >
                    <Icon
                      name={overview?.running ? "pause" : "play"}
                      size={15}
                    />
                    {overview?.running ? "Pause" : "Play"}
                  </button>
                  <button
                    className="icon-button control-button"
                    aria-label="1초 앞으로 진행"
                    title="1초 앞으로 진행 · 일시정지 상태에서 사용"
                    onClick={() => engine.step(1000)}
                    disabled={overview?.running}
                    data-testid="step-forward"
                  >
                    <Icon name="step" size={16} />
                  </button>
                  <button
                    className="icon-button control-button"
                    aria-label="시뮬레이션 초기화"
                    title="현재 시나리오 초기화"
                    onClick={reset}
                    data-testid="reset"
                  >
                    <Icon name="reset" size={16} />
                  </button>
                  <span className="control-divider" />
                  <label className="speed-control">
                    <span className="sr-only">실행 속도</span>
                    <select
                      aria-label="실행 속도"
                      value={overview?.speed ?? 1}
                      onChange={(event) =>
                        engine.speed(Number(event.target.value))
                      }
                    >
                      <option value={0.25}>0.25×</option>
                      <option value={1}>1×</option>
                      <option value={4}>4×</option>
                    </select>
                  </label>
                </div>
              </section>
              {notice && (
                <div className="notice" role="status">
                  <Icon name="info" size={16} />
                  {notice}
                </div>
              )}
              {memory && memory.due_events > 0 && (
                <div className="notice warning" role="status">
                  <span>
                    이벤트 처리 대기 {number(memory.due_events)}개 · 가상 시간
                    지연 {duration(memory.backlog_ms)}
                  </span>
                  {!overview?.running && (
                    <button
                      className="button subtle small"
                      onClick={() => engine.step(0)}
                      data-testid="drain-backlog"
                    >
                      대기 이벤트 처리
                    </button>
                  )}
                </div>
              )}
              {overview &&
                (tab === "overview" ? (
                  <LiveOverview overview={overview} onSelect={navigateTrace} />
                ) : tab === "explorer" ? (
                  <Explorer
                    key={epoch}
                    engine={engine}
                    selectedTrace={selectedTrace}
                    onSelect={navigateTrace}
                    selectedSpan={selectedSpan}
                    onSpan={setSelectedSpan}
                    onInspect={inspectSpan}
                  />
                ) : (
                  <DeveloperTools
                    key={epoch}
                    engine={engine}
                    tab={devTab}
                    onTab={setDevTab}
                    selected={selectedSpan}
                    onSelect={setSelectedSpan}
                  />
                ))}
              <footer className="app-footer">
                <span>
                  <i className="green-dot" />
                  모든 Trace 데이터는 브라우저의 Rust 엔진에서 생성됩니다.
                </span>
                <span>
                  Retention {overview?.retention_seconds ?? 60}s
                  <span className="footer-separator">/</span>Seed 기반 결정론적
                  시뮬레이션
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
