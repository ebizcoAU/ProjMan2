// CustomerService — customers CRUD (migration_v003).
//
// Desk-configured, like the org profile: the console owns customers, the field app
// reads them through pull. Console writes stamp updated_at + server_updated_at so
// they reach devices on the next cycle.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');

const CUSTOMER_FIELDS = ['name', 'abn', 'contact_name', 'phone', 'email', 'address', 'notes'];

async function listCustomers({ orgId }) {
  const [rows] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM projects p
                   WHERE p.customer_id = c.id AND p.is_deleted = 0) AS project_count
       FROM customers c
      WHERE c.org_id = ? AND c.is_deleted = 0
      ORDER BY c.name`,
    [orgId]
  );
  return { customers: rows };
}

async function createCustomer({ orgId, data }) {
  const id = uuidv4();
  const fields = { name: data.name };
  for (const key of CUSTOMER_FIELDS) {
    if (data[key] !== undefined) fields[key] = data[key] === '' ? null : data[key];
  }
  const columns = Object.keys(fields);

  await pool.query(
    `INSERT INTO customers (id, org_id${columns.map((c) => `, \`${c}\``).join('')},
                            updated_at, server_updated_at)
     VALUES (?, ?${columns.map(() => ', ?').join('')}, ?, NOW(3))`,
    [id, orgId, ...Object.values(fields), Date.now()]
  );
  return { id };
}

async function updateCustomer({ orgId, id, data }) {
  const fields = {};
  for (const key of CUSTOMER_FIELDS) {
    if (data[key] !== undefined) fields[key] = data[key] === '' ? null : data[key];
  }
  const columns = Object.keys(fields);
  if (columns.length === 0) throw new ServiceError('NO_FIELDS', 'Nothing to update', 400);

  const [result] = await pool.query(
    `UPDATE customers
        SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
            updated_at = ?, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ? AND is_deleted = 0`,
    [...Object.values(fields), Date.now(), id, orgId]
  );
  if (result.affectedRows === 0) throw new ServiceError('NOT_FOUND', 'Customer not found', 404);
  return { id };
}

module.exports = { listCustomers, createCustomer, updateCustomer };
