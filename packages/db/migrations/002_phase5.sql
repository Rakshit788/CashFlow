-- Idempotency keys for safe write operations
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  endpoint VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64),
  response_status INTEGER NOT NULL,
  response_body JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at);

-- Adjustments created when a recommendation is executed downstream
CREATE TABLE IF NOT EXISTS adjustments (
  id SERIAL PRIMARY KEY,
  exception_id INTEGER REFERENCES exceptions(id),
  approval_id INTEGER REFERENCES approvals(id),
  adjustment_type VARCHAR(50) NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  payment_id INTEGER REFERENCES payments(id),
  amount NUMERIC(12, 2),
  note TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'applied',
  created_by VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adjustments_exception_id ON adjustments(exception_id);
