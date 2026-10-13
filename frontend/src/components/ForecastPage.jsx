import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatUsd } from '../currency.js';

export default function ForecastPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getForecast().then(setData).catch((err) => setError(err.message));
  }, []);

  const maxDay = data?.revenueForecast
    ? Math.max(...data.revenueForecast.next7Days.map((d) => d.predictedRevenue), 1)
    : 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Forecast</h1>
          <p className="page-sub">Simple trend-based projections from your sales history — a rough estimate, not a guarantee.</p>
        </div>
      </div>

      {error && <div className="error-text"><i className="ti ti-alert-circle" aria-hidden="true" />{error}</div>}
      {!data && !error && <div className="empty-state"><i className="ti ti-chart-line" aria-hidden="true" />Loading forecast…</div>}

      {data && (
        <>
          <div className="chart-card">
            <h3>Revenue forecast</h3>
            {!data.revenueForecast ? (
              <p className="page-sub">Not enough sales history yet — record sales across at least 2 different days to see a trend.</p>
            ) : (
              <>
                <p className="page-sub" style={{ marginBottom: 14 }}>
                  Based on {data.revenueForecast.basedOnDays} day(s) of sales, averaging {formatUsd(data.revenueForecast.dailyAverage)}/day.
                  Trend looks <strong>{data.revenueForecast.trend}</strong>. Projected next 7 days: <strong>{formatUsd(data.revenueForecast.next7DaysTotal)}</strong>.
                  {data.revenueForecast.seasonalityApplied && ' Adjusted for day-of-week patterns.'}
                </p>
                {data.revenueForecast.next7Days.map((d) => (
                  <div className="bar-row" key={d.day}>
                    <div className="bar-label">Day {d.day}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(d.predictedRevenue / maxDay) * 100}%`, background: 'var(--moss)' }} />
                    </div>
                    <div className="bar-value">{formatUsd(d.predictedRevenue)}</div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="table-wrap">
            {data.productForecast.length === 0 ? (
              <div className="empty-state"><i className="ti ti-package" aria-hidden="true" />No products yet.</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>Stock</th><th>Daily sales rate</th><th>Est. days remaining</th><th>Risk</th><th>Suggested reorder</th></tr>
                </thead>
                <tbody>
                  {data.productForecast.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="sku">{p.sku}</td>
                      <td className="stock-num">{p.currentStock}</td>
                      <td className="stock-num">{p.dailyVelocity || '—'}</td>
                      <td>
                        {p.daysRemaining === null ? (
                          <span className="page-sub">{p.note || 'No sales yet'}</span>
                        ) : (
                          <span className="stock-num">{p.daysRemaining} days</span>
                        )}
                      </td>
                      <td>
                        <span className={`risk-badge risk-${p.riskLevel}`}>
                          {p.riskLevel === 'critical' && <i className="ti ti-alert-triangle" aria-hidden="true" />}
                          {p.riskLevel}
                        </span>
                      </td>
                      <td className="stock-num">{p.suggestedReorderQty > 0 ? `+${p.suggestedReorderQty}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
