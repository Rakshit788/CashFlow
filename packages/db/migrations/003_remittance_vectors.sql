CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS remittance_documents (
  id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
  source_key VARCHAR(160) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remittance_documents_customer
  ON remittance_documents(customer_id);

CREATE INDEX IF NOT EXISTS idx_remittance_documents_embedding
  ON remittance_documents USING hnsw (embedding vector_cosine_ops);
