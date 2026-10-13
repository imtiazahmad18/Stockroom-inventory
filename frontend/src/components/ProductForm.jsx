import { useState } from 'react';
import { api } from '../api.js';

const empty = { sku: '', name: '', category_id: '', cost_price: '', sale_price: '', current_stock: '', reorder_level: '5' };

export default function ProductForm({ product, categories, onClose, onSaved }) {
  const [form, setForm] = useState(product ? { ...product, category_id: product.category_id || '' } : empty);
  const [error, setError] = useState('');
  const isEdit = Boolean(product);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.sku.trim() || !form.name.trim()) {
      setError('SKU and name are required.');
      return;
    }
    const payload = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      category_id: form.category_id || null,
      cost_price: Number(form.cost_price) || 0,
      sale_price: Number(form.sale_price) || 0,
      reorder_level: Number(form.reorder_level) || 0,
    };
    try {
      if (isEdit) {
        await api.updateProduct(product.id, payload);
      } else {
        await api.createProduct({ ...payload, current_stock: Number(form.current_stock) || 0 });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          <i className={isEdit ? 'ti ti-edit' : 'ti ti-package'} aria-hidden="true" />
          {isEdit ? 'Edit product' : 'Add product'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label>SKU</label>
              <input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. TS-001" />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Product name</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Cotton T-shirt, black" />
          </div>

          <div className="field-row">
            <div className="field">
              <label>Cost price (USD $)</label>
              <input type="number" step="0.01" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} />
            </div>
            <div className="field">
              <label>Sale price (USD $)</label>
              <input type="number" step="0.01" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            {!isEdit && (
              <div className="field">
                <label>Starting stock</label>
                <input type="number" value={form.current_stock} onChange={(e) => set('current_stock', e.target.value)} />
              </div>
            )}
            <div className="field">
              <label>Reorder level</label>
              <input type="number" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
            </div>
          </div>

          {error && <div className="error-text"><i className="ti ti-alert-circle" aria-hidden="true" />{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{isEdit ? 'Save changes' : 'Add product'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
