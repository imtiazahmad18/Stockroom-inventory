import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { categoryColorClass } from '../colors.js';
import ProductForm from './ProductForm.jsx';
import { formatUsd } from '../currency.js';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [error, setError] = useState('');

  async function load() {
    try {
      const [p, c] = await Promise.all([
        api.listProducts(search ? { search } : {}),
        api.listCategories(),
      ]);
      setProducts(p);
      setCategories(c);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [search]);

  async function handleDelete(product) {
    if (!confirm(`Delete "${product.name}"? This can't be undone.`)) return;
    await api.deleteProduct(product.id);
    load();
  }

  async function handleStockChange(product, delta) {
    try {
      await api.adjustStock(product.id, delta, delta > 0 ? 'restock' : 'correction');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p className="page-sub">{products.length} product{products.length !== 1 ? 's' : ''} in the catalog</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <i className="ti ti-plus" aria-hidden="true" /> Add product
        </button>
      </div>

      <div className="field search-wrap" style={{ maxWidth: 320, marginBottom: 18 }}>
        <i className="ti ti-search" aria-hidden="true" />
        <input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="error-text"><i className="ti ti-alert-circle" aria-hidden="true" />{error}</div>}

      <div className="table-wrap">
        {products.length === 0 ? (
          <div className="empty-state">
            <i className="ti ti-package" aria-hidden="true" />
            No products yet — add your first one to get started.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isLow = p.current_stock <= p.reorder_level;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="sku">{p.sku}</td>
                    <td>
                      {p.category_name ? (
                        <span className={`cat-badge ${categoryColorClass(p.category_name)}`}>
                          <span className="dot" />
                          {p.category_name}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="stock-num">{formatUsd(p.sale_price)}</td>
                    <td>
                      <span className="stock-num">{p.current_stock}</span>
                      {isLow && (
                        <span className="low-badge">
                          <i className="ti ti-alert-triangle" aria-hidden="true" /> Low stock
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="stock-btn" onClick={() => handleStockChange(p, 1)} title="Add one to stock">+1</button>
                        <button className="stock-btn" onClick={() => handleStockChange(p, -1)} title="Remove one from stock">-1</button>
                        <button onClick={() => setEditing(p)} title="Edit"><i className="ti ti-edit" aria-hidden="true" />Edit</button>
                        <button className="btn-danger" onClick={() => handleDelete(p)} title="Delete"><i className="ti ti-trash" aria-hidden="true" />Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}
