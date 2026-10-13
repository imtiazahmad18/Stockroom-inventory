import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { categoryColorClass } from '../colors.js';

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.listCategories().then(setCategories);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    try {
      await api.createCategory(name.trim());
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(category) {
    if (!confirm(`Delete "${category.name}"? Products in this category will become uncategorized, not deleted.`)) return;
    try {
      await api.deleteCategory(category.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Categories</h1>
          <p className="page-sub">Group products so the dashboard and chatbot can reason about them together.</p>
        </div>
      </div>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 360 }}>
        <input
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--paper)' }}
          placeholder="New category name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          <i className="ti ti-plus" aria-hidden="true" /> Add
        </button>
      </form>

      {error && <div className="error-text"><i className="ti ti-alert-circle" aria-hidden="true" />{error}</div>}

      <div className="table-wrap">
        {categories.length === 0 ? (
          <div className="empty-state">
            <i className="ti ti-tags" aria-hidden="true" />
            No categories yet.
          </div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th></th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className={`cat-badge ${categoryColorClass(c.name)}`}>
                      <span className="dot" />
                      {c.name}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-danger" onClick={() => handleDelete(c)} title="Delete category"> Delete
                        <i className="ti ti-trash" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
