import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatUsd } from '../currency.js';

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getInsights().then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>AI Insights</h1>
          <p className="page-sub">Business analytics computed from your real sales data, with AI-written suggestions on top.</p>
        </div>
      </div>

      {error && <div className="error-text"><i className="ti ti-alert-circle" aria-hidden="true" />{error}</div>}
      {!data && !error && <div className="empty-state"><i className="ti ti-sparkles" aria-hidden="true" />Crunching the numbers…</div>}

      {data && (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <div className="stat-top"><div className="stat-icon"><i className="ti ti-cash" aria-hidden="true" /></div></div>
              <div className="num">{formatUsd(data.last7DaysRevenue)}</div>
              <div className="label">Revenue, last 7 days</div>
            </div>
            <div className={`stat-card ${data.revenueTrendPct < 0 ? 'warn' : ''}`}>
              <div className="stat-top"><div className="stat-icon"><i className={`ti ${data.revenueTrendPct >= 0 ? 'ti-trending-up' : 'ti-trending-down'}`} aria-hidden="true" /></div></div>
              <div className="num">{data.revenueTrendPct === null ? '—' : `${data.revenueTrendPct >= 0 ? '+' : ''}${data.revenueTrendPct}%`}</div>
              <div className="label">vs previous 7 days</div>
            </div>
            <div className="stat-card">
              <div className="stat-top"><div className="stat-icon"><i className="ti ti-hourglass-low" aria-hidden="true" /></div></div>
              <div className="num">{data.slowMovers.length}</div>
              <div className="label">Slow-moving products</div>
            </div>
          </div>

          <div className="chart-card">
            <h3>
              AI suggestions
              <span className="ai-source-tag">
                <i className={`ti ${data.aiGenerated ? 'ti-sparkles' : 'ti-calculator'}`} aria-hidden="true" />
                {data.aiGenerated ? 'AI-generated' : 'Rule-based (AI unavailable right now)'}
              </span>
            </h3>
            <ul className="suggestion-list">
              {data.suggestions.map((s, i) => (
                <li className="suggestion-item" key={i}>
                  <i className="ti ti-bulb" aria-hidden="true" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="insight-grid">
            <div className="chart-card">
              <h3>Top sellers</h3>
              {data.topSellers.length === 0 ? (
                <p className="page-sub">No sales recorded yet.</p>
              ) : (
                <div className="mini-list">
                  {data.topSellers.map((p) => (
                    <div className="mini-list-row" key={p.id}>
                      <div>
                        <div className="name">{p.name}</div>
                        <div className="meta">{p.unitsSold} units sold</div>
                      </div>
                      <div className="value">{formatUsd(p.revenue)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="chart-card">
              <h3>Slow movers</h3>
              {data.slowMovers.length === 0 ? (
                <p className="page-sub">Nothing stagnant — everything's moving.</p>
              ) : (
                <div className="mini-list">
                  {data.slowMovers.map((p) => (
                    <div className="mini-list-row" key={p.id}>
                      <div>
                        <div className="name">{p.name}</div>
                        <div className="meta">{p.daysSinceLastSale === null ? 'never sold' : `${p.daysSinceLastSale}d since last sale`}</div>
                      </div>
                      <div className="value">{p.currentStock} in stock</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="chart-card">
              <h3>Category revenue</h3>
              {data.categoryPerformance.length === 0 ? (
                <p className="page-sub">No sales recorded yet.</p>
              ) : (
                (() => {
                  const max = Math.max(1, ...data.categoryPerformance.map((c) => c.revenue));
                  return data.categoryPerformance.map((c) => (
                    <div className="bar-row" key={c.category}>
                      <div className="bar-label">{c.category}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(c.revenue / max) * 100}%`, background: 'var(--teal)' }} />
                      </div>
                      <div className="bar-value">{formatUsd(c.revenue)}</div>
                    </div>
                  ));
                })()
              )}
            </div>

            <div className="chart-card">
              <h3>Margin leaders vs laggards</h3>
              <div className="mini-list">
                {data.marginLeaders.slice(0, 3).map((p) => (
                  <div className="mini-list-row" key={`lead-${p.id}`}>
                    <div className="name">{p.name}</div>
                    <div className="value" style={{ color: 'var(--moss)' }}>{p.marginPct}%</div>
                  </div>
                ))}
                {data.marginLaggards.slice(0, 3).map((p) => (
                  <div className="mini-list-row" key={`lag-${p.id}`}>
                    <div className="name">{p.name}</div>
                    <div className="value" style={{ color: 'var(--rust)' }}>{p.marginPct}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {data.anomalies.length > 0 && (
            <div className="chart-card">
              <h3>Revenue anomalies</h3>
              <ul className="suggestion-list">
                {data.anomalies.map((a, i) => (
                  <li className="suggestion-item" key={i}>
                    <i className={`ti ${a.direction === 'spike' ? 'ti-trending-up' : 'ti-trending-down'}`} aria-hidden="true" />
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
