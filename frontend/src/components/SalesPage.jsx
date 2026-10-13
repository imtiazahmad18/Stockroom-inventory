import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatUsd } from '../currency.js';

export default function SalesPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [summary, setSummary] = useState(null);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    const [p, s, sum] = await Promise.all([
      api.listProducts(),
      api.listSales(),
      api.salesSummary(),
    ]);
    setProducts(p);
    setSales(s);
    setSummary(sum);
  }

  useEffect(() => { load(); }, []);

  const selectedProduct = products.find((p) => String(p.id) === String(productId));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!productId) {
      setError('Pick a product first.');
      return;
    }
    try {
      await api.recordSale({ product_id: Number(productId), quantity: Number(quantity) });
      setSuccess('Sale recorded.');
      setQuantity('1');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Sales</h1>
          <p className="page-sub">Record a sale — stock updates automatically, and the low-stock trigger fires if needed.</p>
        </div>
      </div>

      {summary && (
        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-top"><div className="stat-icon"><i className="ti ti-receipt" aria-hidden="true" /></div></div>
            <div className="num">{summary.saleCount}</div>
            <div className="label">Sales recorded</div>
          </div>
          <div className="stat-card">
            <div className="stat-top"><div className="stat-icon"><i className="ti ti-currency-dollar" aria-hidden="true" /></div></div>
            <div className="num">{formatUsd(summary.revenue)}</div>
            <div className="label">Total revenue</div>
          </div>
          <div className="stat-card">
            <div className="stat-top"><div className="stat-icon"><i className="ti ti-trending-up" aria-hidden="true" /></div></div>
            <div className="num">{formatUsd(summary.profit)}</div>
            <div className="label">Profit (revenue − cost)</div>
          </div>
        </div>
      )}

      <div className="chart-card">
        <h3>Record a sale</h3>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label>Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.current_stock} in stock
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 120 }}>
              <label>Quantity</label>
              <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>

          {selectedProduct && (
            <p className="page-sub" style={{ marginTop: -6, marginBottom: 14 }}>
              Sale price {formatUsd(selectedProduct.sale_price)} each · total {formatUsd(Number(selectedProduct.sale_price) * Number(quantity || 0))}
            </p>
          )}

          {error && <div className="error-text"><i className="ti ti-alert-circle" aria-hidden="true" />{error}</div>}
          {success && <div className="error-text" style={{ color: 'var(--moss)' }}><i className="ti ti-circle-check" aria-hidden="true" />{success}</div>}

          <button className="btn btn-primary" type="submit">
            <i className="ti ti-cash-register" aria-hidden="true" /> Record sale
          </button>
        </form>
      </div>

      <div className="table-wrap">
        {sales.length === 0 ? (
          <div className="empty-state">
            <i className="ti ti-receipt-off" aria-hidden="true" />
            No sales recorded yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Date</th></tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>{s.product_name}</td>
                  <td className="sku">{s.sku}</td>
                  <td className="stock-num">{s.quantity}</td>
                  <td className="stock-num">{formatUsd(s.sale_price)}</td>
                  <td className="stock-num">{formatUsd(s.quantity * s.sale_price)}</td>
                  <td className="page-sub">{s.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
