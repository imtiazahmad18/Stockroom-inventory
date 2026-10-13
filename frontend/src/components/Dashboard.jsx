import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { categoryColorVar } from '../colors.js';
import { formatUsd } from '../currency.js';

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.listProducts().then(setProducts);
    api.listProducts({ lowStock: 'true' }).then(setLowStock);
    api.salesSummary().then(setSummary);
  }, []);

  const totalValue = products.reduce((sum, p) => sum + p.current_stock * p.sale_price, 0);

  const byCategory = {};
  products.forEach((p) => {
    const key = p.category_name || 'Uncategorized';
    byCategory[key] = (byCategory[key] || 0) + p.current_stock;
  });
  const maxStock = Math.max(1, ...Object.values(byCategory));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">A snapshot of what's on the shelf right now.</p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon"><i className="ti ti-box" aria-hidden="true" /></div>
          </div>
          <div className="num">{products.length}</div>
          <div className="label">Products tracked</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon"><i className="ti ti-building-warehouse" aria-hidden="true" /></div>
          </div>
          <div className="num">{formatUsd(totalValue)}</div>
          <div className="label">Stock value (at sale price)</div>
        </div>
        <div className={`stat-card ${lowStock.length ? 'warn' : ''}`}>
          <div className="stat-top">
            <div className="stat-icon"><i className="ti ti-alert-triangle" aria-hidden="true" /></div>
          </div>
          <div className="num">{lowStock.length}</div>
          <div className="label">Items at or below reorder level</div>
        </div>
      </div>

      {summary && (
        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-top">
              <div className="stat-icon"><i className="ti ti-receipt" aria-hidden="true" /></div>
            </div>
            <div className="num">{summary.saleCount}</div>
            <div className="label">Total sales</div>
          </div>
          <div className="stat-card">
            <div className="stat-top">
              <div className="stat-icon"><i className="ti ti-currency-dollar" aria-hidden="true" /></div>
            </div>
            <div className="num">{formatUsd(summary.revenue)}</div>
            <div className="label">Revenue</div>
          </div>
          <div className="stat-card">
            <div className="stat-top">
              <div className="stat-icon"><i className="ti ti-trending-up" aria-hidden="true" /></div>
            </div>
            <div className="num">{formatUsd(summary.profit)}</div>
            <div className="label">Profit</div>
          </div>
        </div>
      )}

      {products.length > 0 && (
        <div className="chart-card">
          <h3>Stock on hand by category</h3>
          {Object.entries(byCategory).map(([name, stock]) => {
            const fillColor = categoryColorVar(name === 'Uncategorized' ? null : name);
            return (
              <div className="bar-row" key={name}>
                <div className="bar-label">{name}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(stock / maxStock) * 100}%`, background: fillColor }}
                  />
                </div>
                <div className="bar-value">{stock}</div>
              </div>
            );
          })}
        </div>
      )}

      {lowStock.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>SKU</th><th>Stock</th><th>Reorder level</th></tr>
            </thead>
            <tbody>
              {lowStock.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="sku">{p.sku}</td>
                  <td className="stock-num">{p.current_stock}</td>
                  <td className="stock-num">{p.reorder_level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lowStock.length === 0 && products.length > 0 && (
        <div className="empty-state">
          <i className="ti ti-circle-check" aria-hidden="true" />
          Nothing is low on stock yet.
        </div>
      )}
      {products.length === 0 && (
        <div className="empty-state">
          <i className="ti ti-package" aria-hidden="true" />
          Add your first product to see stats here.
        </div>
      )}
    </>
  );
}
